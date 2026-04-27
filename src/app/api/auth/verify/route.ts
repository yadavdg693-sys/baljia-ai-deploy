// GET /api/auth/verify?token=xxx[&redirect=/path] — verify magic link token
// Optional redirect param jumps the verified user straight to /dashboard/{slug}
// (used by the onboarding completion-email magic link). Only relative paths
// starting with a single "/" are honored to prevent open redirect attacks.
import { NextRequest, NextResponse } from 'next/server';
import * as authService from '@/lib/services/auth.service';
import { signJWT, setSessionCookie } from '@/lib/auth';

function safeRedirectPath(raw: string | null): string {
  if (!raw) return '/portfolio';
  // Must be a relative path: starts with "/", not "//", not containing a scheme
  if (!raw.startsWith('/')) return '/portfolio';
  if (raw.startsWith('//')) return '/portfolio';
  if (raw.includes(':')) return '/portfolio';
  return raw;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const redirectParam = request.nextUrl.searchParams.get('redirect');

  if (!token) {
    return NextResponse.redirect(new URL('/login?error=missing_token', request.url));
  }

  const result = await authService.verifyMagicLink(token);

  if (!result) {
    return NextResponse.redirect(new URL('/login?error=invalid_link', request.url));
  }

  const jwt = await signJWT(result.userId);
  const redirectTarget = safeRedirectPath(redirectParam);
  const response = NextResponse.redirect(new URL(redirectTarget, request.url));
  setSessionCookie(response, jwt);

  return response;
}
