import { and, desc, eq, sql } from 'drizzle-orm';

import type { SupportAggregationResult } from './support-escalation-aggregator.service';
import type { DebateRunResult } from './platform-ops-debate.service';

interface WriterResult {
  feedbackId: string;
  status: 'done' | 'failed' | 'skipped';
  prUrl?: string;
  costCents: number;
}

interface VerifierResult {
  feedbackId: string;
  status: 'done' | 'failed' | 'skipped';
  vote?: string;
  costCents: number;
}

export interface PlatformOpsFixCycleDeps {
  supportAutoPrDisabled?: boolean;
  aggregateSupportEscalations?: () => Promise<SupportAggregationResult[]>;
  debateOpenSupportFeedback?: () => Promise<DebateRunResult[]>;
  processApprovedBugs?: () => Promise<WriterResult[]>;
  loadPrOpenFeedbackIds?: () => Promise<string[]>;
  hasVerifierVote?: (feedbackId: string) => Promise<boolean>;
  verifyOpenPr?: (feedbackId: string) => Promise<VerifierResult>;
}

export interface PlatformOpsFixCycleSummary {
  support_aggregation: {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    skipped_reason?: string;
    results: SupportAggregationResult[];
  };
  support_debate: {
    processed: number;
    succeeded: number;
    skipped: number;
    skipped_reason?: string;
    results: DebateRunResult[];
  };
  writer: {
    processed: number;
    succeeded: number;
    results: WriterResult[];
  };
  verifier: {
    processed: number;
    succeeded: number;
    results: VerifierResult[];
  };
  elapsed_seconds: number;
}

async function defaultAggregateSupportEscalations(): Promise<SupportAggregationResult[]> {
  const { aggregateSupportEscalations } = await import('./support-escalation-aggregator.service');
  return aggregateSupportEscalations({
    minOccurrences: Number(process.env.PLATFORM_OPS_SUPPORT_MIN_ESCALATIONS ?? '3'),
    limit: Number(process.env.PLATFORM_OPS_SUPPORT_AGGREGATION_LIMIT ?? '200'),
  });
}

async function defaultDebateOpenSupportFeedback(): Promise<DebateRunResult[]> {
  const { debateOpenSupportFeedback } = await import('./platform-ops-debate.service');
  return debateOpenSupportFeedback({
    maxItems: Number(process.env.PLATFORM_OPS_SUPPORT_DEBATE_MAX ?? '3'),
  });
}

async function defaultProcessApprovedBugs(): Promise<WriterResult[]> {
  const { processApprovedBugs } = await import('./platform-ops-writer.service');
  return processApprovedBugs({ maxBugs: 3 });
}

async function defaultLoadPrOpenFeedbackIds(): Promise<string[]> {
  const { db, platformFeedback } = await import('@/lib/db');
  const rows = await db
    .select({ id: platformFeedback.id })
    .from(platformFeedback)
    .where(eq(platformFeedback.status, 'pr_open'))
    .orderBy(desc(platformFeedback.last_seen_at))
    .limit(5);
  return rows.map((row) => row.id);
}

async function defaultHasVerifierVote(feedbackId: string): Promise<boolean> {
  const { db, platformOpsRuns } = await import('@/lib/db');
  const [existingVerifier] = await db.select({ id: platformOpsRuns.id })
    .from(platformOpsRuns)
    .where(and(
      eq(platformOpsRuns.feedback_id, feedbackId),
      eq(platformOpsRuns.agent_role, 'verifier'),
      sql`${platformOpsRuns.verifier_vote} IS NOT NULL`,
    ))
    .limit(1);
  return !!existingVerifier;
}

async function defaultVerifyOpenPr(feedbackId: string): Promise<VerifierResult> {
  const { verifyOpenPr } = await import('./platform-ops-verifier.service');
  return verifyOpenPr(feedbackId);
}

function countAggregation(results: SupportAggregationResult[], status: SupportAggregationResult['status']): number {
  return results.filter((result) => result.status === status).length;
}

export async function runPlatformOpsFixCycle(
  deps: PlatformOpsFixCycleDeps = {},
): Promise<PlatformOpsFixCycleSummary> {
  const start = Date.now();
  const supportAutoPrDisabled = deps.supportAutoPrDisabled ?? process.env.PLATFORM_OPS_SUPPORT_AUTOPR_DISABLED === 'true';

  let supportAggregationResults: SupportAggregationResult[] = [];
  let supportDebateResults: DebateRunResult[] = [];

  if (!supportAutoPrDisabled) {
    supportAggregationResults = await (deps.aggregateSupportEscalations ?? defaultAggregateSupportEscalations)();
    supportDebateResults = await (deps.debateOpenSupportFeedback ?? defaultDebateOpenSupportFeedback)();
  }

  const writerResults = await (deps.processApprovedBugs ?? defaultProcessApprovedBugs)();

  const loadPrOpenFeedbackIds = deps.loadPrOpenFeedbackIds ?? defaultLoadPrOpenFeedbackIds;
  const hasVerifierVote = deps.hasVerifierVote ?? defaultHasVerifierVote;
  const verifyOpenPr = deps.verifyOpenPr ?? defaultVerifyOpenPr;

  const verifierResults: VerifierResult[] = [];
  for (const feedbackId of await loadPrOpenFeedbackIds()) {
    if (await hasVerifierVote(feedbackId)) continue;
    verifierResults.push(await verifyOpenPr(feedbackId));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return {
    support_aggregation: {
      processed: supportAggregationResults.length,
      created: countAggregation(supportAggregationResults, 'created'),
      updated: countAggregation(supportAggregationResults, 'updated'),
      skipped: supportAutoPrDisabled ? 1 : countAggregation(supportAggregationResults, 'skipped'),
      skipped_reason: supportAutoPrDisabled ? 'PLATFORM_OPS_SUPPORT_AUTOPR_DISABLED' : undefined,
      results: supportAggregationResults,
    },
    support_debate: {
      processed: supportDebateResults.length,
      succeeded: supportDebateResults.filter((result) => result.status === 'done').length,
      skipped: supportAutoPrDisabled ? 1 : supportDebateResults.filter((result) => result.status === 'skipped').length,
      skipped_reason: supportAutoPrDisabled ? 'PLATFORM_OPS_SUPPORT_AUTOPR_DISABLED' : undefined,
      results: supportDebateResults,
    },
    writer: {
      processed: writerResults.length,
      succeeded: writerResults.filter((result) => result.status === 'done').length,
      results: writerResults,
    },
    verifier: {
      processed: verifierResults.length,
      succeeded: verifierResults.filter((result) => result.status === 'done').length,
      results: verifierResults,
    },
    elapsed_seconds: Math.round((Date.now() - start) / 1000),
  };
}
