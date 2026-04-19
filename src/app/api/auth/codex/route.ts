// OpenAI Codex OAuth — start + complete flow
// POST /api/auth/codex         → start OAuth, returns { jobId, authUrl }
// GET  /api/auth/codex?jobId=X → poll status, returns session on completion

import { NextRequest, NextResponse } from 'next/server';
import { createCodexLoginManager, deriveCodexOperatorProfile, saveCodexCredentials } from '@/lib/codex-oauth';
import { findOrCreateCodexUser } from '@/lib/services/auth.service';
import { signJWT, setSessionCookie } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const log = createLogger('AuthCodex');

const loginManager = createCodexLoginManager();

// ── POST: Start OAuth flow ──────────────────────

export async function POST() {
  try {
    const job = await loginManager.start();

    if (job.error) {
      return NextResponse.json({ error: job.error }, { status: 500 });
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      authUrl: job.authUrl,
    });
  } catch (err) {
    log.error('Failed to start Codex OAuth', {}, err);
    return NextResponse.json(
      { error: 'Failed to start OpenAI Codex authentication' },
      { status: 500 },
    );
  }
}

// ── GET: Poll / complete OAuth flow ─────────────

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  try {
    const job = loginManager.get(jobId);
    if (!job) {
      return NextResponse.json({ error: 'OAuth session not found' }, { status: 404 });
    }

    // Still in progress
    if (job.status !== 'completed') {
      return NextResponse.json({
        jobId: job.id,
        status: job.status,
        authUrl: job.authUrl,
        error: job.error,
        completed: false,
      });
    }

    // Completed — create platform user + session
    if (!job.credentials) {
      return NextResponse.json({ error: 'OAuth completed but no credentials received' }, { status: 500 });
    }

    const operator = deriveCodexOperatorProfile(job.credentials);
    const { userId, email } = await findOrCreateCodexUser({
      accountId: operator.providerUserId,
      email: operator.email,
      name: operator.name,
      planType: operator.identity.planType,
    });

    const token = await signJWT(userId);
    loginManager.remove(jobId);

    const response = NextResponse.json({
      status: 'completed',
      completed: true,
      user: { id: userId, email },
      identity: {
        email: operator.email,
        name: operator.name,
        accountId: operator.identity.accountId,
        planType: operator.identity.planType,
      },
    });

    setSessionCookie(response, token);
    log.info('Codex OAuth login successful', { userId, email: operator.email });
    return response;
  } catch (err) {
    log.error('Codex OAuth completion failed', {}, err);
    return NextResponse.json(
      { error: 'Failed to complete OpenAI Codex authentication' },
      { status: 500 },
    );
  }
}
