// GitHub webhook for platform-ops auto-resolution.
// When a PR opened by the writer agent is MERGED, mark the linked
// platform_feedback row as resolved.
//
// Configure GitHub webhook → POST to /api/webhooks/github with secret.
// Set GITHUB_WEBHOOK_SECRET env var to authenticate.

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, platformFeedback, platformOpsRuns } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('GitHubWebhook');

interface PullRequestEvent {
  action: string;
  pull_request: {
    number: number;
    merged: boolean;
    merge_commit_sha: string | null;
    body: string | null;
    title: string;
    html_url: string;
  };
}

// Verify GitHub HMAC-SHA256 signature on the raw body.
function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    const headerBuf = Buffer.from(header);
    const expectedBuf = Buffer.from(expected);
    if (headerBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(headerBuf, expectedBuf);
  } catch { return false; }
}

export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    log.warn('GITHUB_WEBHOOK_SECRET not configured — webhook rejected');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  const sig = request.headers.get('x-hub-signature-256');
  if (!verifySignature(rawBody, sig, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = request.headers.get('x-github-event');
  if (event !== 'pull_request') {
    return NextResponse.json({ ok: true, ignored: `event: ${event}` });
  }

  const payload = JSON.parse(rawBody) as PullRequestEvent;
  if (payload.action !== 'closed' || !payload.pull_request.merged) {
    return NextResponse.json({ ok: true, ignored: `action: ${payload.action} merged: ${payload.pull_request.merged}` });
  }

  const prNumber = payload.pull_request.number;
  log.info('PR merged', { prNumber, title: payload.pull_request.title });

  // Find the writer run that opened this PR
  const [writerRun] = await db.select().from(platformOpsRuns)
    .where(and(eq(platformOpsRuns.pr_number, prNumber), eq(platformOpsRuns.agent_role, 'writer')))
    .orderBy(desc(platformOpsRuns.created_at)).limit(1);

  if (!writerRun) {
    return NextResponse.json({ ok: true, ignored: `no platform_ops_runs row for PR #${prNumber}` });
  }

  // Update run row with merge commit
  await db.update(platformOpsRuns).set({
    commit_sha: payload.pull_request.merge_commit_sha,
  }).where(eq(platformOpsRuns.id, writerRun.id));

  // Mark linked bug resolved
  await db.update(platformFeedback).set({
    status: 'resolved',
    resolution: 'auto_fixed',
  }).where(eq(platformFeedback.id, writerRun.feedback_id));

  log.info('Bug auto-resolved on PR merge', {
    feedbackId: writerRun.feedback_id,
    prNumber,
    commitSha: payload.pull_request.merge_commit_sha,
  });

  return NextResponse.json({
    ok: true,
    resolved_feedback_id: writerRun.feedback_id,
    pr_number: prNumber,
  });
}
