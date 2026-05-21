import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

type SupportPayload = Record<string, unknown>;

export interface SupportEscalationEvent {
  id: string;
  company_id: string | null;
  event_type: string;
  payload: SupportPayload;
  created_at: Date | string | null;
}

export interface SupportEscalationCluster {
  fingerprint: string;
  companyId: string;
  affectedCompanyIds: string[];
  area: string;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  events: SupportEscalationEvent[];
  summaries: string[];
  customerEmails: string[];
  latestAt: Date;
}

interface ClusterOptions {
  minOccurrences?: number;
}

interface FeedbackDraft {
  company_id: string;
  type: 'bug';
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open';
  source: 'support';
  area: string;
  fingerprint: string;
  metadata: Record<string, unknown>;
  occurrence_count: number;
  last_seen_at: Date;
}

export interface SupportAggregationResult {
  fingerprint: string;
  feedbackId?: string;
  status: 'created' | 'updated' | 'skipped';
  occurrenceCount: number;
  reason?: string;
}

const SUPPORT_EVENT_TYPES = ['support_escalation', 'support_engineering_escalation'] as const;
const TERMINAL_FEEDBACK_STATUSES = new Set(['resolved', 'rejected', 'wont_fix']);

const SEVERITY_RANK: Record<SupportEscalationCluster['severity'], number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'after', 'be', 'but', 'by', 'for', 'from',
  'in', 'into', 'is', 'it', 'of', 'on', 'or', 'our', 'the', 'their', 'this', 'to',
  'up', 'user', 'customer', 'customers', 'client', 'clients', 'says', 'say',
]);

function payloadString(payload: SupportPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function eventSummary(event: SupportEscalationEvent): string {
  const payload = event.payload ?? {};
  return (
    payloadString(payload, 'summary') ??
    payloadString(payload, 'title') ??
    payloadString(payload, 'description') ??
    'Untitled support escalation'
  );
}

function normalizeSeverity(value: unknown): SupportEscalationCluster['severity'] {
  const raw = typeof value === 'string' ? value.toLowerCase() : '';
  if (raw === 'critical') return 'critical';
  if (raw === 'high') return 'high';
  if (raw === 'low') return 'low';
  return 'medium';
}

function highestSeverity(events: SupportEscalationEvent[]): SupportEscalationCluster['severity'] {
  return events.reduce<SupportEscalationCluster['severity']>((highest, event) => {
    const severity = normalizeSeverity(event.payload?.urgency ?? event.payload?.severity);
    return SEVERITY_RANK[severity] > SEVERITY_RANK[highest] ? severity : highest;
  }, 'low');
}

function inferArea(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(bill|billing|checkout|credit|refund|stripe|payment|invoice)\b/.test(lower)) return 'billing';
  if (/\b(email|inbox|postmark|reply|deliver|mx|thread)\b/.test(lower)) return 'email';
  if (/\b(onboarding|signup|magic link|login|auth|claim)\b/.test(lower)) return 'onboarding';
  if (/\b(render|deploy|github|repo|build|branch|pr|engineering)\b/.test(lower)) return 'engineering';
  if (/\b(task|dashboard|board|queue|approve|run now|completed|failed)\b/.test(lower)) return 'dashboard';
  if (/\b(agent|ceo|support|browser|research|worker)\b/.test(lower)) return 'agents';
  return 'platform';
}

function compactIssueKey(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/s$/, ''))
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .slice(0, 10);

  return words.length > 0 ? words.join('-') : 'unknown-issue';
}

function stableHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

export function supportEscalationFingerprint(input: {
  area?: string | null;
  title?: string | null;
  summary?: string | null;
  fingerprint?: string | null;
}): string {
  if (input.fingerprint?.trim()) return `support:${input.fingerprint.trim().toLowerCase()}`;
  const summary = input.summary?.trim() || input.title?.trim() || 'unknown issue';
  const area = input.area?.trim() || inferArea(summary);
  const key = compactIssueKey(summary);
  return `support:${area}:${key}:${stableHash(`${area}:${key}`)}`;
}

function eventDate(event: SupportEscalationEvent): Date {
  if (event.created_at instanceof Date) return event.created_at;
  if (typeof event.created_at === 'string') {
    const parsed = new Date(event.created_at);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value?.trim()).map((value) => value.trim()))];
}

export function clusterSupportEscalationEvents(
  events: SupportEscalationEvent[],
  options: ClusterOptions = {},
): SupportEscalationCluster[] {
  const minOccurrences = options.minOccurrences ?? 3;
  const buckets = new Map<string, SupportEscalationEvent[]>();

  for (const event of events) {
    if (!event.company_id) continue;
    if (!SUPPORT_EVENT_TYPES.includes(event.event_type as (typeof SUPPORT_EVENT_TYPES)[number])) continue;
    const summary = eventSummary(event);
    const area = payloadString(event.payload, 'area') ?? inferArea(summary);
    const fingerprint = supportEscalationFingerprint({
      area,
      summary,
      fingerprint: payloadString(event.payload, 'fingerprint'),
    });
    const bucket = buckets.get(fingerprint) ?? [];
    bucket.push(event);
    buckets.set(fingerprint, bucket);
  }

  const clusters: SupportEscalationCluster[] = [];
  for (const [fingerprint, bucket] of buckets) {
    if (bucket.length < minOccurrences) continue;
    const sorted = [...bucket].sort((a, b) => eventDate(a).getTime() - eventDate(b).getTime());
    const summaries = uniqueStrings(sorted.map(eventSummary));
    const firstSummary = summaries[0] ?? eventSummary(sorted[0]!);
    const area = payloadString(sorted[0]!.payload, 'area') ?? inferArea(firstSummary);
    const affectedCompanyIds = uniqueStrings(sorted.map((event) => event.company_id ?? null));
    const latestAt = eventDate(sorted[sorted.length - 1]!);
    clusters.push({
      fingerprint,
      companyId: affectedCompanyIds[0]!,
      affectedCompanyIds,
      area,
      title: firstSummary,
      severity: highestSeverity(sorted),
      events: sorted,
      summaries,
      customerEmails: uniqueStrings(sorted.map((event) => payloadString(event.payload, 'customer_email'))),
      latestAt,
    });
  }

  return clusters.sort((a, b) => {
    const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDelta !== 0) return severityDelta;
    return b.latestAt.getTime() - a.latestAt.getTime();
  });
}

export function buildSupportFeedbackDraft(cluster: SupportEscalationCluster): FeedbackDraft {
  const eventIds = cluster.events.map((event) => event.id);
  const sampleSummaries = cluster.summaries.slice(0, 5).map((summary) => `- ${summary}`).join('\n');
  const customerLine = cluster.customerEmails.length > 0
    ? `\nCustomers: ${cluster.customerEmails.slice(0, 8).join(', ')}`
    : '';
  const title = `[Support] ${cluster.title.slice(0, 180)}`;

  return {
    company_id: cluster.companyId,
    type: 'bug',
    title,
    description: [
      `Aggregated from ${cluster.events.length} support escalations with the same fingerprint.`,
      ``,
      `Area: ${cluster.area}`,
      `Severity: ${cluster.severity}`,
      customerLine.trim(),
      ``,
      `Sample summaries:`,
      sampleSummaries,
      ``,
      `Source event IDs: ${eventIds.join(', ')}`,
      ``,
      `This row is eligible for the GPT-5.5 + Opus 4.7 platform-ops debate before any autonomous PR is opened.`,
    ].filter(Boolean).join('\n'),
    severity: cluster.severity,
    status: 'open',
    source: 'support',
    area: cluster.area,
    fingerprint: cluster.fingerprint,
    metadata: {
      kind: 'support_escalation_cluster',
      event_ids: eventIds,
      customer_emails: cluster.customerEmails,
      affected_company_ids: cluster.affectedCompanyIds,
      summaries: cluster.summaries,
      autonomous_pr_candidate: true,
    },
    occurrence_count: cluster.events.length,
    last_seen_at: cluster.latestAt,
  };
}

function metadataEventIds(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const ids = (metadata as { event_ids?: unknown }).event_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export async function aggregateSupportEscalations(options: {
  lookbackHours?: number;
  minOccurrences?: number;
  limit?: number;
} = {}): Promise<SupportAggregationResult[]> {
  const lookbackHours = options.lookbackHours ?? 72;
  const limit = options.limit ?? 200;
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const { db, platformEvents, platformFeedback } = await import('@/lib/db');

  const rows = await db
    .select({
      id: platformEvents.id,
      company_id: platformEvents.company_id,
      event_type: platformEvents.event_type,
      payload: platformEvents.payload,
      created_at: platformEvents.created_at,
    })
    .from(platformEvents)
    .where(and(
      inArray(platformEvents.event_type, [...SUPPORT_EVENT_TYPES]),
      sql`${platformEvents.created_at} >= ${since.toISOString()}::timestamptz`,
    ))
    .orderBy(desc(platformEvents.created_at))
    .limit(limit);

  const clusters = clusterSupportEscalationEvents(rows as SupportEscalationEvent[], {
    minOccurrences: options.minOccurrences,
  });

  const results: SupportAggregationResult[] = [];
  for (const cluster of clusters) {
    const draft = buildSupportFeedbackDraft(cluster);
    const [existing] = await db
      .select({
        id: platformFeedback.id,
        status: platformFeedback.status,
        occurrence_count: platformFeedback.occurrence_count,
        metadata: platformFeedback.metadata,
      })
      .from(platformFeedback)
      .where(eq(platformFeedback.fingerprint, draft.fingerprint))
      .limit(1);

    if (existing && TERMINAL_FEEDBACK_STATUSES.has(existing.status ?? '')) {
      results.push({
        fingerprint: draft.fingerprint,
        feedbackId: existing.id,
        status: 'skipped',
        occurrenceCount: existing.occurrence_count ?? 0,
        reason: `existing feedback is terminal (${existing.status})`,
      });
      continue;
    }

    if (existing) {
      const seenIds = metadataEventIds(existing.metadata);
      const nextIds = uniqueStrings([...seenIds, ...(draft.metadata.event_ids as string[])]);
      if (nextIds.length === seenIds.length) {
        results.push({
          fingerprint: draft.fingerprint,
          feedbackId: existing.id,
          status: 'skipped',
          occurrenceCount: existing.occurrence_count ?? nextIds.length,
          reason: 'all source escalation events already recorded',
        });
        continue;
      }

      const nextMetadata = {
        ...(typeof existing.metadata === 'object' && existing.metadata ? existing.metadata : {}),
        ...draft.metadata,
        event_ids: nextIds,
      };
      await db.update(platformFeedback).set({
        title: draft.title,
        description: draft.description,
        severity: draft.severity,
        area: draft.area,
        metadata: nextMetadata,
        occurrence_count: nextIds.length,
        last_seen_at: draft.last_seen_at,
      }).where(eq(platformFeedback.id, existing.id));
      results.push({
        fingerprint: draft.fingerprint,
        feedbackId: existing.id,
        status: 'updated',
        occurrenceCount: nextIds.length,
      });
      continue;
    }

    const [created] = await db.insert(platformFeedback).values(draft).returning({ id: platformFeedback.id });
    results.push({
      fingerprint: draft.fingerprint,
      feedbackId: created?.id,
      status: 'created',
      occurrenceCount: draft.occurrence_count,
    });
  }

  return results;
}
