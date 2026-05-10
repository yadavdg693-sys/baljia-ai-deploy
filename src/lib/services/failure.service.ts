// Failure Fingerprinting — migrated to Drizzle + Neon
// Phase 5: + regression guard, known issue registry, self-healing auto-resolve
import { db, failureFingerprints, taskFailureLinks } from '@/lib/db';
import { eq, gte, desc, sql, and, ne } from 'drizzle-orm';
import * as eventService from '@/lib/services/event.service';
import type { FailureFingerprint } from '@/types';

// 64-bit FNV-1a hash via two 32-bit words — ES2017-compatible, no BigInt needed.
function generateHash(input: string): string {
  let hi = 0x84222325 | 0;
  let lo = 0xcbf29ce4 | 0;

  for (let i = 0; i < input.length; i++) {
    const byte = input.charCodeAt(i);
    lo ^= byte;
    const lo_prev = lo >>> 0;
    const hi_prev = hi >>> 0;
    lo = Math.imul(lo_prev, 0x1000193) + Math.imul(hi_prev, 0) | 0;
    hi = Math.imul(hi_prev, 0x1000193) + (Math.imul(lo_prev, 0x100) >>> 0) | 0;
  }

  const hiHex = (hi >>> 0).toString(16).padStart(8, '0');
  const loHex = (lo >>> 0).toString(16).padStart(8, '0');
  return `${hiHex}${loHex}`;
}


// Canonical 8-class taxonomy (SPEC-CTRL-106)
function categorizeError(errorMessage: string, _tag: string): string {
  const msg = errorMessage.toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('idle') || msg.includes('stall')) return 'timeout';
  if (msg.includes('credential') || msg.includes('oauth') || msg.includes('api key') || msg.includes('token expired') || msg.includes('auth')) return 'connector_failure';
  if (msg.includes('external') || msg.includes('fetch') || msg.includes('network') || msg.includes('econnrefused') || msg.includes('503') || msg.includes('502')) return 'external_block';
  if (msg.includes('scope') || msg.includes('too large') || msg.includes('split') || msg.includes('decompos')) return 'scope_overflow';
  if (msg.includes('tool') || msg.includes('rpc') || msg.includes('not supported') || msg.includes('capability')) return 'capability_miss';
  if (msg.includes('policy') || msg.includes('content safety') || msg.includes('guardrail') || msg.includes('blocked')) return 'policy_violation';
  if (msg.includes('verification') || msg.includes('verifier') || msg.includes('quality check')) return 'verification_reject';
  return 'infra_error';
}

function normalizePattern(errorMessage: string): string {
  return errorMessage
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '<TIMESTAMP>')
    .replace(/\d+\.\d+\.\d+\.\d+/g, '<IP>')
    .replace(/\b\d{4,}\b/g, '<NUM>')
    .trim();
}

export async function captureFailure(input: {
  taskId: string;
  companyId: string;
  errorMessage: string;
  tag: string;
  agentId: number;
}): Promise<FailureFingerprint & { occurrence_count: number; id: string }> {
  const pattern = normalizePattern(input.errorMessage);
  const hash = generateHash(pattern);
  const category = categorizeError(input.errorMessage, input.tag);

  const [existing] = await db.select().from(failureFingerprints)
    .where(eq(failureFingerprints.fingerprint, hash))
    .limit(1);

  if (existing) {
    const existingAgents: number[] = (existing.affected_agents as number[] | null) ?? [];
    const updatedAgents = existingAgents.includes(input.agentId)
      ? existingAgents : [...existingAgents, input.agentId];

    // Regression detection: fixed fingerprint reappearing
    const isRegression = existing.fix_status === 'fixed';
    const regressionUpdates: Record<string, unknown> = {};
    if (isRegression) {
      regressionUpdates.regression_sensitive = true;
    }

    const [updated] = await db.update(failureFingerprints)
      .set({
        occurrence_count: (existing.occurrence_count ?? 0) + 1,
        last_seen_at: new Date(),
        affected_agents: updatedAgents,
        ...regressionUpdates,
      })
      .where(eq(failureFingerprints.id, existing.id))
      .returning();

    // Emit regression event if a fixed issue reappeared
    if (isRegression) {
      try {
        await eventService.emit(input.companyId, 'regression_detected', {
          fingerprint_id: existing.id,
          category: existing.category,
          description: existing.description,
          task_id: input.taskId,
        });
      } catch { /* non-blocking */ }
    }

    try {
      await db.insert(taskFailureLinks).values({ task_id: input.taskId, fingerprint_id: existing.id });
    } catch { /* ignore duplicate links */ }

    return (updated ?? existing) as unknown as FailureFingerprint & { occurrence_count: number; id: string };
  }

  const [data] = await db.insert(failureFingerprints).values({
    fingerprint: hash,
    category,
    description: pattern,
    occurrence_count: 1,
    affected_agents: [input.agentId],
    affected_tools: [],
    fix_status: 'open',
    regression_sensitive: false,
  }).returning();

  try {
    await db.insert(taskFailureLinks).values({ task_id: input.taskId, fingerprint_id: data.id });
  } catch { /* ignore */ }

  return data as unknown as FailureFingerprint & { occurrence_count: number; id: string };
}

export async function getTopFailures(limit = 10): Promise<FailureFingerprint[]> {
  return db.select().from(failureFingerprints)
    .orderBy(desc(failureFingerprints.occurrence_count))
    .limit(limit) as unknown as Promise<FailureFingerprint[]>;
}

export async function getRecentFailures(since: string): Promise<FailureFingerprint[]> {
  return db.select().from(failureFingerprints)
    .where(gte(failureFingerprints.last_seen_at, new Date(since)))
    .orderBy(desc(failureFingerprints.last_seen_at)) as unknown as Promise<FailureFingerprint[]>;
}

// ══════════════════════════════════════════════
// REGISTER FIX — enhanced with fix_notes, root_cause, fix_applied_at
// ══════════════════════════════════════════════

export async function registerFix(
  fingerprintId: string,
  status: 'investigating' | 'fixed' | 'wont_fix',
  fixNotes?: string,
  rootCause?: string,
): Promise<void> {
  const updates: Record<string, unknown> = { fix_status: status };
  if (status === 'fixed') updates.fix_applied_at = new Date();
  if (fixNotes) updates.fix_notes = fixNotes;
  if (rootCause) updates.root_cause = rootCause;
  await db.update(failureFingerprints)
    .set(updates)
    .where(eq(failureFingerprints.id, fingerprintId));
}

export async function checkKnownFailure(errorMessage: string): Promise<{
  isKnown: boolean;
  fingerprint: FailureFingerprint | null;
  isFixed: boolean;
}> {
  const pattern = normalizePattern(errorMessage);
  const hash = generateHash(pattern);

  const [data] = await db.select().from(failureFingerprints)
    .where(eq(failureFingerprints.fingerprint, hash))
    .limit(1);

  if (!data) return { isKnown: false, fingerprint: null, isFixed: false };

  return {
    isKnown: true,
    fingerprint: data as unknown as FailureFingerprint,
    isFixed: data.fix_status === 'fixed',
  };
}

// ══════════════════════════════════════════════
// REGRESSION GUARD (SPEC-OPS-001)
// Detect fixed fingerprints that reappeared after fix_applied_at
// ══════════════════════════════════════════════

export async function detectRegressions(): Promise<FailureFingerprint[]> {
  return db.select().from(failureFingerprints)
    .where(and(
      eq(failureFingerprints.fix_status, 'fixed'),
      sql`${failureFingerprints.last_seen_at} > ${failureFingerprints.fix_applied_at}`
    ))
    .orderBy(desc(failureFingerprints.last_seen_at)) as unknown as Promise<FailureFingerprint[]>;
}

// ══════════════════════════════════════════════
// KNOWN ISSUE REGISTRY (SPEC-OPS-001)
// ══════════════════════════════════════════════

/** Get open fingerprints relevant to a tag — used by CEO before scoping similar tasks */
export async function getKnownIssuesForTag(tag: string): Promise<FailureFingerprint[]> {
  // Match by category mapping from tag, or by description containing the tag
  return db.select().from(failureFingerprints)
    .where(and(
      ne(failureFingerprints.fix_status, 'fixed'),
      ne(failureFingerprints.fix_status, 'wont_fix'),
      sql`(${failureFingerprints.category} = ${categorizeError('', tag)} OR ${failureFingerprints.description} ILIKE ${'%' + tag + '%'})`,
    ))
    .orderBy(desc(failureFingerprints.occurrence_count))
    .limit(10) as unknown as Promise<FailureFingerprint[]>;
}

/**
 * Engineering-agent helper: returns BOTH unresolved issues and FIXED issues
 * (with fix_notes) that match a free-text context. Used by `read_known_issues`
 * tool — agent calls before doing risky work to avoid repeating known mistakes.
 *
 * Filters by description / affected_tools containing any token from `context`.
 */
export async function getRelevantKnownIssuesForAgent(
  context: string,
  agentId: number = 30,
  limit = 5,
): Promise<FailureFingerprint[]> {
  const tokens = context.toLowerCase().split(/[^a-z0-9_-]+/).filter((t) => t.length >= 4);
  if (tokens.length === 0) return [];
  // ILIKE ANY array — match if description contains any token
  const ilikeArr = tokens.map((t) => `%${t}%`);
  return db.select().from(failureFingerprints)
    .where(and(
      ne(failureFingerprints.fix_status, 'wont_fix'),
      sql`(${failureFingerprints.description} ILIKE ANY (ARRAY[${sql.join(ilikeArr.map((p) => sql`${p}`), sql`, `)}]::text[])
           OR ${failureFingerprints.affected_agents}::text ILIKE ${'%' + agentId + '%'})`,
    ))
    .orderBy(desc(failureFingerprints.occurrence_count), desc(failureFingerprints.last_seen_at))
    .limit(limit) as unknown as Promise<FailureFingerprint[]>;
}

/** Format known issues for the engineering agent's tool result. Compact, ≤ 800 chars target. */
export function formatKnownIssuesForAgent(issues: FailureFingerprint[]): string {
  if (issues.length === 0) return 'KNOWN ISSUES: none match this context.';
  const lines = [`KNOWN ISSUES: ${issues.length} relevant entr${issues.length === 1 ? 'y' : 'ies'}`, ''];
  for (const fp of issues) {
    const status = fp.fix_status === 'fixed' ? '[FIXED]' : `[${(fp.fix_status ?? 'open').toUpperCase()}]`;
    const desc = (fp.description ?? '').slice(0, 120);
    lines.push(`- ${status} ${desc}`);
    if (fp.fix_notes) lines.push(`  fix: ${fp.fix_notes.slice(0, 200)}`);
  }
  return lines.join('\n');
}

/** Grouped summary for platform ops dashboard */
export async function getKnownIssuesSummary(): Promise<{
  open: number;
  investigating: number;
  fixed: number;
  regressions: number;
}> {
  const data = await db.select({
    fix_status: failureFingerprints.fix_status,
    regression_sensitive: failureFingerprints.regression_sensitive,
  }).from(failureFingerprints);

  let open = 0, investigating = 0, fixed = 0, regressions = 0;
  for (const fp of data) {
    if (fp.fix_status === 'open') open++;
    else if (fp.fix_status === 'investigating') investigating++;
    else if (fp.fix_status === 'fixed') fixed++;
    if (fp.regression_sensitive) regressions++;
  }

  return { open, investigating, fixed, regressions };
}

export async function getFailureSummary(): Promise<{
  total_fingerprints: number;
  total_occurrences: number;
  fixed: number;
  unfixed: number;
  by_category: Record<string, number>;
}> {
  const data = await db.select({
    category: failureFingerprints.category,
    occurrence_count: failureFingerprints.occurrence_count,
    fix_status: failureFingerprints.fix_status,
  }).from(failureFingerprints);

  if (!data.length) return { total_fingerprints: 0, total_occurrences: 0, fixed: 0, unfixed: 0, by_category: {} };

  const by_category: Record<string, number> = {};
  let total_occurrences = 0;
  let fixed = 0;

  for (const fp of data) {
    const cat = fp.category ?? 'unknown';
    by_category[cat] = (by_category[cat] ?? 0) + 1;
    total_occurrences += fp.occurrence_count ?? 0;
    if (fp.fix_status === 'fixed') fixed++;
  }

  return { total_fingerprints: data.length, total_occurrences, fixed, unfixed: data.length - fixed, by_category };
}

// ══════════════════════════════════════════════
// SELF-HEALING AUTO-RESOLVE (SPEC-OPS-001)
// When a retry task succeeds, mark linked fingerprints as fixed
// ══════════════════════════════════════════════

export async function checkAutoResolve(taskId: string): Promise<number> {
  const links = await db.select({ fingerprint_id: taskFailureLinks.fingerprint_id })
    .from(taskFailureLinks)
    .where(eq(taskFailureLinks.task_id, taskId));

  let resolved = 0;
  for (const link of links) {
    // Only auto-resolve fingerprints still in 'open' or 'investigating' state
    const [fp] = await db.select({ fix_status: failureFingerprints.fix_status })
      .from(failureFingerprints)
      .where(eq(failureFingerprints.id, link.fingerprint_id))
      .limit(1);

    if (fp && (fp.fix_status === 'open' || fp.fix_status === 'investigating')) {
      await registerFix(link.fingerprint_id, 'fixed', 'Auto-resolved: retry task succeeded');
      resolved++;
    }
  }
  return resolved;
}
