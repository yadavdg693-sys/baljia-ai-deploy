// GET /api/auth/verify?token=xxx — verify magic link token
import { NextRequest, NextResponse } from 'next/server';
import * as authService from '@/lib/services/auth.service';
import { signJWT, setSessionCookie } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(new URL('/login?error=missing_token', request.url));
  }

  const result = await authService.verifyMagicLink(token);

  if (!result) {
    return NextResponse.redirect(new URL('/login?error=invalid_link', request.url));
  }

  const jwt = await signJWT(result.userId);
  const response = NextResponse.redirect(new URL('/callback', request.url));
  setSessionCookie(response, jwt);

  return response;
}
