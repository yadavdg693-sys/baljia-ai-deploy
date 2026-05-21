import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, platformFeedback } from '@/lib/db';

export type PlatformFeedbackSource = 'user' | 'agent' | 'system' | 'onboarding';
export type PlatformFeedbackSeverity = 'low' | 'medium' | 'high' | 'critical';

const ACTIVE_STATUSES = ['open', 'awaiting_approval', 'approved_to_fix', 'pr_open'] as const;

function hashStable(input: string): string {
  let hi = 0x84222325 | 0;
  let lo = 0xcbf29ce4 | 0;

  for (let i = 0; i < input.length; i++) {
    const byte = input.charCodeAt(i);
    lo ^= byte;
    const loPrev = lo >>> 0;
    const hiPrev = hi >>> 0;
    lo = Math.imul(loPrev, 0x1000193) | 0;
    hi = (Math.imul(hiPrev, 0x1000193) + (Math.imul(loPrev, 0x100) >>> 0)) | 0;
  }

  return `${(hi >>> 0).toString(16).padStart(8, '0')}${(lo >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeFingerprintText(value: string): string {
  return value
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<timestamp>')
    .replace(/\b\d{4,}\b/g, '<num>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function severityRank(severity: string | null | undefined): number {
  switch (severity) {
    case 'critical': return 4;
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 0;
  }
}

function maxSeverity(a: string | null | undefined, b: PlatformFeedbackSeverity): PlatformFeedbackSeverity {
  return severityRank(a) >= severityRank(b) ? (a as PlatformFeedbackSeverity) : b;
}

export function buildPlatformFeedbackFingerprint(input: {
  source: PlatformFeedbackSource;
  area: string;
  title: string;
  description?: string | null;
}): string {
  const normalized = normalizeFingerprintText([
    input.source,
    input.area,
    input.title,
    input.description ?? '',
  ].join('|'));
  return hashStable(normalized);
}

export async function registerPlatformIssue(input: {
  companyId: string;
  type?: 'bug' | 'feature' | 'question' | 'onboarding_issue';
  title: string;
  description?: string;
  severity?: PlatformFeedbackSeverity;
  source?: PlatformFeedbackSource;
  area?: string;
  fingerprint?: string;
  metadata?: Record<string, unknown>;
}): Promise<typeof platformFeedback.$inferSelect> {
  const now = new Date();
  const source = input.source ?? 'system';
  const area = input.area ?? 'platform';
  const severity = input.severity ?? 'medium';
  const fingerprint = input.fingerprint ?? buildPlatformFeedbackFingerprint({
    source,
    area,
    title: input.title,
    description: input.description,
  });
  const metadata = {
    ...(input.metadata ?? {}),
    last_company_id: input.companyId,
    last_seen_at: now.toISOString(),
  };

  const [existing] = await db
    .select()
    .from(platformFeedback)
    .where(and(
      eq(platformFeedback.fingerprint, fingerprint),
      inArray(platformFeedback.status, [...ACTIVE_STATUSES]),
    ))
    .orderBy(desc(platformFeedback.last_seen_at))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(platformFeedback)
      .set({
        severity: maxSeverity(existing.severity, severity),
        occurrence_count: sql`${platformFeedback.occurrence_count} + 1`,
        last_seen_at: now,
        metadata: {
          ...((existing.metadata ?? {}) as Record<string, unknown>),
          ...metadata,
        },
      })
      .where(eq(platformFeedback.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const [created] = await db
    .insert(platformFeedback)
    .values({
      company_id: input.companyId,
      type: input.type ?? 'bug',
      title: input.title,
      description: input.description,
      severity,
      status: 'open',
      source,
      area,
      fingerprint,
      metadata,
      occurrence_count: 1,
      last_seen_at: now,
    })
    .returning();

  return created;
}
