// OpenAI Codex OAuth — start + complete flow (ADMIN-ONLY platform setup)
// POST /api/auth/codex         → start OAuth, returns { jobId, authUrl }
// GET  /api/auth/codex?jobId=X → poll status, returns session on completion
//
// SECURITY: This route binds the platform's primary LLM credentials to an
// OpenAI account (see codex-oauth.ts:213 — saveCodexCredentials is called on
// completion, overwriting data/baljia-openai-codex-oauth.json which
// getCodexApiKeySync() reads for every platform LLM call).
//
// Without a gate, any visitor could bind the platform's LLM calls to their
// own OpenAI account (AUDIT_FINDINGS #F2). So both POST and GET require a
// shared-secret header matching env.ADMIN_SETUP_TOKEN.
//
// Usage (platform operator only):
//   1. Set ADMIN_SETUP_TOKEN=<long-random-string> in .env.local
//   2. curl -X POST http://localhost:3000/api/auth/codex \
//        -H "X-Admin-Setup-Token: <token>"
//   3. Follow the returned authUrl to complete in browser
//   4. curl "http://localhost:3000/api/auth/codex?jobId=<id>" \
//        -H "X-Admin-Setup-Token: <token>"

import { NextRequest, NextResponse } from 'next/server';
import { createCodexLoginManager, deriveCodexOperatorProfile } from '@/lib/codex-oauth';
import { findOrCreateCodexUser } from '@/lib/services/auth.service';
import { signJWT, setSessionCookie } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const log = createLogger('AuthCodex');

const loginManager = createCodexLoginManager();

/**
 * Admin gate — require X-Admin-Setup-Token header matching env.ADMIN_SETUP_TOKEN.
 * If the env var isn't set at all, refuse requests (fail-closed, never expose
 * the flow by accident). Constant-time comparison to prevent timing attacks.
 */
function requireAdminToken(request: NextRequest): NextResponse | null {
  const expected = process.env.ADMIN_SETUP_TOKEN;
  if (!expected || expected.length < 16) {
    log.warn('Codex OAuth blocked: ADMIN_SETUP_TOKEN not configured or too short');
    return NextResponse.json(
      { error: 'Platform setup endpoint is disabled. Set ADMIN_SETUP_TOKEN (≥16 chars) in .env.local to enable.' },
      { status: 503 },
    );
  }
  const provided = request.headers.get('x-admin-setup-token') ?? '';
  // Constant-time comparison
  if (provided.length !== expected.length) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  if (mismatch !== 0) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

// ── POST: Start OAuth flow ──────────────────────

export async function POST(request: NextRequest) {
  const denied = requireAdminToken(request);
  if (denied) return denied;

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
  const denied = requireAdminToken(request);
  if (denied) return denied;

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
