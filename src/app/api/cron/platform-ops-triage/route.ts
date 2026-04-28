// Hourly cron: triage all open bugs in platform_feedback.
// Wired into wrangler.toml as `0 * * * *` and cf-worker-entry.ts dispatch.
// Render path: add an equivalent cron job pointing at this route too.

import { NextRequest, NextResponse } from 'next/server';
import { triageOpenBugs } from '@/lib/services/platform-ops.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('Cron:PlatformOpsTriage');

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (process.env.PLATFORM_OPS_PAUSED === 'true') {
    log.info('Platform-ops paused via env var, skipping');
    return NextResponse.json({ ok: true, skipped: true, reason: 'PLATFORM_OPS_PAUSED' });
  }

  try {
    const start = Date.now();
    const results = await triageOpenBugs();
    const elapsed = Math.round((Date.now() - start) / 1000);

    const triaged = results.filter((r) => r.status === 'done').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const totalCostCents = results.reduce((s, r) => s + r.costCents, 0);

    log.info('Triage cron complete', {
      bugs_processed: results.length,
      triaged, failed, skipped,
      cost_dollars: (totalCostCents / 100).toFixed(2),
      elapsed_seconds: elapsed,
    });

    return NextResponse.json({
      ok: true,
      bugs_processed: results.length,
      triaged, failed, skipped,
      cost_cents: totalCostCents,
      elapsed_seconds: elapsed,
      results: results.map((r) => ({
        feedback_id: r.feedbackId,
        run_id: r.runId,
        status: r.status,
        reproduces: r.diagnosis?.reproduces,
        risk: r.diagnosis?.estimated_risk,
        cost_cents: r.costCents,
        reason: r.reason,
      })),
    });
  } catch (err) {
    log.error('Triage cron threw', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cron failed' }, { status: 500 });
  }
}
