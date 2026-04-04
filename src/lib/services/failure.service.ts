// Failure Fingerprinting — migrated to Drizzle + Neon
import { db, failureFingerprints, taskFailureLinks } from '@/lib/db';
import { eq, gte, desc, sql } from 'drizzle-orm';
import type { FailureFingerprint } from '@/types';

function generateHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).padStart(8, '0');
}

function categorizeError(errorMessage: string, tag: string): string {
  const msg = errorMessage.toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('idle')) return 'timeout';
  if (msg.includes('tool') || msg.includes('rpc') || msg.includes('api')) return 'tool_failure';
  if (msg.includes('external') || msg.includes('fetch') || msg.includes('network')) return 'external';
  if (msg.includes('scope') || msg.includes('too large') || msg.includes('split')) return 'scope';
  if (['unknown', 'misc'].includes(tag)) return 'routing';
  return 'tool_failure';
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
    const existingAgents: number[] = existing.affected_agents ? JSON.parse(existing.affected_agents) : [];
    const updatedAgents = existingAgents.includes(input.agentId)
      ? existingAgents : [...existingAgents, input.agentId];

    const [updated] = await db.update(failureFingerprints)
      .set({
        occurrence_count: (existing.occurrence_count ?? 0) + 1,
        last_seen_at: new Date(),
        affected_agents: JSON.stringify(updatedAgents),
      })
      .where(eq(failureFingerprints.id, existing.id))
      .returning();

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
    affected_agents: JSON.stringify([input.agentId]),
    affected_tools: '[]',
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

export async function registerFix(fingerprintId: string, status: 'investigating' | 'fixed' | 'wont_fix'): Promise<void> {
  await db.update(failureFingerprints)
    .set({ fix_status: status })
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
