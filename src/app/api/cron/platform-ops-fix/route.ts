// Hourly cron: drives the writer + verifier loop.
// 1. Run writer agent on bugs in status='approved_to_fix' → opens PR
// 2. Run verifier agent on bugs in status='pr_open' that don't yet have
//    a verifier vote → posts independent review on the PR

import { NextRequest, NextResponse } from 'next/server';
import { db, platformFeedback, platformOpsRuns } from '@/lib/db';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { processApprovedBugs } from '@/lib/services/platform-ops-writer.service';
import { verifyOpenPr } from '@/lib/services/platform-ops-verifier.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('Cron:PlatformOpsFix');

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.PLATFORM_OPS_PAUSED === 'true') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'PLATFORM_OPS_PAUSED' });
  }
  // Phase B kill switch — turn off writer/verifier separately while
  // letting Phase A (triage) keep running.
  if (process.env.PLATFORM_OPS_WRITE_DISABLED === 'true') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'PLATFORM_OPS_WRITE_DISABLED' });
  }

  const start = Date.now();

  // 1. Writer pass — pick up approved bugs
  const writerResults = await processApprovedBugs({ maxBugs: 3 });

  // 2. Verifier pass — find PRs that don't have a verifier verdict yet
  const prOpenBugs = await db
    .select({ id: platformFeedback.id })
    .from(platformFeedback)
    .where(eq(platformFeedback.status, 'pr_open'))
    .limit(5);

  const verifierResults = [];
  for (const b of prOpenBugs) {
    // Skip if a verifier run already exists with a vote
    const [existingVerifier] = await db.select({ id: platformOpsRuns.id })
      .from(platformOpsRuns)
      .where(and(
        eq(platformOpsRuns.feedback_id, b.id),
        eq(platformOpsRuns.agent_role, 'verifier'),
        sql`${platformOpsRuns.verifier_vote} IS NOT NULL`,
      ))
      .limit(1);
    if (existingVerifier) continue;

    const r = await verifyOpenPr(b.id);
    verifierResults.push(r);
    await new Promise((r) => setTimeout(r, 1000));
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  log.info('Fix cron complete', {
    writer: { processed: writerResults.length, succeeded: writerResults.filter((r) => r.status === 'done').length },
    verifier: { processed: verifierResults.length, succeeded: verifierResults.filter((r) => r.status === 'done').length },
    elapsed_seconds: elapsed,
  });

  return NextResponse.json({
    ok: true,
    writer_runs: writerResults.map((r) => ({ feedback_id: r.feedbackId, status: r.status, pr_url: r.prUrl, cost_cents: r.costCents })),
    verifier_runs: verifierResults.map((r) => ({ feedback_id: r.feedbackId, status: r.status, vote: r.vote, cost_cents: r.costCents })),
    elapsed_seconds: elapsed,
  });
}
