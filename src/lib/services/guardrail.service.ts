// Guardrail Service — Escalation Response Ladder
// Architecture: observe → degrade → cooldown → suspend
// Monitors company health metrics and applies graduated interventions
//
// Source: Domain 12.4 "Guardrail system"
// - observe: log and alert, continue execution
// - degrade: reduce capabilities (lower max_turns, skip non-critical tasks)
// - cooldown: pause new task creation, finish running tasks
// - suspend: halt all execution, require manual intervention
//
// FIX: Guardrail state is now persisted to DB on every escalation/clear.
// Previously: in-memory Map — state lost on every serverless cold start.
// Now: Map is a hot-path cache; DB is the source of truth.

import { db, companies, platformEvents } from '@/lib/db';
import { eq, desc, and, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('Guardrail');

export type GuardrailLevel = 'observe' | 'degrade' | 'cooldown' | 'suspend';

interface GuardrailState {
  level: GuardrailLevel;
  reason: string;
  since: string;          // ISO timestamp
  auto_resume_at?: string; // ISO timestamp for auto-resume (cooldown)
}

// Hot-path in-memory cache (per-company). Populated on first read, cleared on cold start.
// The DB is the source of truth — cache is a performance optimisation.
const guardrailCache = new Map<string, GuardrailState>();

// ── DB persistence helpers ──

async function persistGuardrailState(companyId: string, state: GuardrailState): Promise<void> {
  try {
    await db.insert(platformEvents).values({
      company_id: companyId,
      event_type: 'guardrail_state',
      payload: state as unknown as Record<string, unknown>,
      is_public_safe: false,
    });
  } catch (err) {
    log.warn('Failed to persist guardrail state to DB', { companyId, error: err instanceof Error ? err.message : 'Unknown' });
  }
}

async function loadGuardrailFromDb(companyId: string): Promise<GuardrailState | null> {
  try {
    const [latest] = await db
      .select({ payload: platformEvents.payload, created_at: platformEvents.created_at })
      .from(platformEvents)
      .where(
        and(
          eq(platformEvents.company_id, companyId),
          sql`${platformEvents.event_type} IN ('guardrail_state', 'guardrail_escalation', 'guardrail_cleared')`
        )
      )
      .orderBy(desc(platformEvents.created_at))
      .limit(1);

    if (!latest) return null;

    const payload = latest.payload as Record<string, unknown>;

    // A 'guardrail_cleared' event means observe level
    if (payload.restored_to === 'observe') {
      return { level: 'observe', reason: 'restored', since: latest.created_at?.toISOString() ?? new Date().toISOString() };
    }

    const level = (payload.level ?? 'observe') as GuardrailLevel;
    const auto_resume_at = payload.auto_resume_at as string | undefined;

    // Check for expired auto-resume
    if (auto_resume_at && new Date(auto_resume_at) <= new Date()) {
      return null; // expired, treat as observe
    }

    return {
      level,
      reason: (payload.reason as string) ?? 'unknown',
      since: (payload.since as string) ?? new Date().toISOString(),
      auto_resume_at,
    };
  } catch (err) {
    log.warn('Failed to load guardrail state from DB', { companyId, error: err instanceof Error ? err.message : 'Unknown' });
    return null;
  }
}

/**
 * Get the current guardrail level for a company.
 * Checks in-memory cache first, then falls back to DB (survives cold starts).
 * Returns 'observe' (normal) if no escalation is active.
 */
export async function getGuardrailLevel(companyId: string): Promise<GuardrailState> {
  const cached = guardrailCache.get(companyId);

  // Check cached auto-resume
  if (cached?.auto_resume_at && new Date(cached.auto_resume_at) <= new Date()) {
    log.info('Guardrail auto-resuming (cached)', { companyId, previousLevel: cached.level });
    guardrailCache.delete(companyId);
    await persistGuardrailState(companyId, { level: 'observe', reason: 'auto-resumed', since: new Date().toISOString() });
    await db.update(companies).set({ execution_state: 'active' }).where(eq(companies.id, companyId));
    return { level: 'observe', reason: 'auto-resumed', since: new Date().toISOString() };
  }

  if (cached) return cached;

  // Cache miss — load from DB (cold start recovery)
  const fromDb = await loadGuardrailFromDb(companyId);
  if (fromDb) {
    guardrailCache.set(companyId, fromDb);
    return fromDb;
  }

  return { level: 'observe', reason: 'normal', since: new Date().toISOString() };
}

/**
 * Escalate the guardrail level for a company.
 * Persists to DB immediately so it survives restarts.
 */
export async function escalateGuardrail(
  companyId: string,
  level: GuardrailLevel,
  reason: string,
  autoResumeMinutes?: number,
): Promise<void> {
  const now = new Date().toISOString();
  const auto_resume_at = autoResumeMinutes
    ? new Date(Date.now() + autoResumeMinutes * 60_000).toISOString()
    : undefined;

  const state: GuardrailState = { level, reason, since: now, auto_resume_at };

  // Update cache immediately
  guardrailCache.set(companyId, state);

  log.warn('Guardrail escalated', { companyId, level, reason, autoResumeMinutes });

  // Persist to platform events for both audit trail AND cold-start recovery
  await persistGuardrailState(companyId, state);

  // Apply side effects based on level
  switch (level) {
    case 'cooldown':
      await db.update(companies)
        .set({ execution_state: 'cooldown' })
        .where(eq(companies.id, companyId));
      break;

    case 'suspend':
      await db.update(companies)
        .set({ execution_state: 'suspended' })
        .where(eq(companies.id, companyId));
      break;

    case 'degrade':
    case 'observe':
      await db.update(companies)
        .set({ execution_state: 'active' })
        .where(eq(companies.id, companyId));
      break;
  }
}

/**
 * De-escalate (clear) guardrail state for a company.
 * Persists the cleared state to DB.
 */
export async function clearGuardrail(companyId: string): Promise<void> {
  guardrailCache.delete(companyId);

  await db.update(companies)
    .set({ execution_state: 'active' })
    .where(eq(companies.id, companyId));

  await db.insert(platformEvents).values({
    company_id: companyId,
    event_type: 'guardrail_cleared',
    payload: { restored_to: 'observe' },
    is_public_safe: false,
  });

  log.info('Guardrail cleared', { companyId });
}

/**
 * Check if a task can be executed given the current guardrail level.
 * NOTE: Now async because getGuardrailLevel may hit DB on cache miss.
 */
export async function canExecuteTask(
  companyId: string,
  taskPriority: number,
): Promise<{ allowed: boolean; reason: string }> {
  const state = await getGuardrailLevel(companyId);

  switch (state.level) {
    case 'observe':
      return { allowed: true, reason: 'Normal operation' };

    case 'degrade':
      if (taskPriority >= 5) {
        return { allowed: true, reason: 'Degraded mode: high-priority task allowed' };
      }
      return { allowed: false, reason: `Degraded mode: only high-priority tasks allowed. Reason: ${state.reason}` };

    case 'cooldown':
      return { allowed: false, reason: `System is in cooldown. Reason: ${state.reason}. Auto-resume: ${state.auto_resume_at ?? 'manual'}` };

    case 'suspend':
      return { allowed: false, reason: `System is suspended. Reason: ${state.reason}. Manual intervention required.` };
  }
}

