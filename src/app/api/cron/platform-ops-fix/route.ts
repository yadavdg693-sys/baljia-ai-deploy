// Hourly cron: drives the support-auto-PR + writer + verifier loop.
// 1. Aggregate repeated support escalations into platform_feedback rows
// 2. Run GPT-5.5 + Opus 4.7 debate on support-sourced rows; safe consensus
//    rows become status='approved_to_fix'
// 3. Run writer agent on approved bugs → opens PR
// 4. Run verifier agent on open PRs without a vote → posts independent review

import { NextRequest, NextResponse } from 'next/server';
import { runPlatformOpsFixCycle } from '@/lib/services/platform-ops-fix-cycle.service';
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

  const summary = await runPlatformOpsFixCycle();
  log.info('Fix cron complete', {
    support_aggregation: summary.support_aggregation,
    support_debate: summary.support_debate,
    writer: summary.writer,
    verifier: summary.verifier,
    elapsed_seconds: summary.elapsed_seconds,
  });

  return NextResponse.json({
    ok: true,
    support_aggregation: summary.support_aggregation,
    support_debate: summary.support_debate,
    writer_runs: summary.writer.results.map((r) => ({ feedback_id: r.feedbackId, status: r.status, pr_url: r.prUrl, cost_cents: r.costCents })),
    verifier_runs: summary.verifier.results.map((r) => ({ feedback_id: r.feedbackId, status: r.status, vote: r.vote, cost_cents: r.costCents })),
    elapsed_seconds: summary.elapsed_seconds,
  });
}
