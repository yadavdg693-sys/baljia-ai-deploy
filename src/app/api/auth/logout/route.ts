// POST /api/auth/logout — clear session cookie + revoke JWT session
import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, revokeSession } from '@/lib/auth';
import { jwtVerify } from 'jose';

export async function POST(request: NextRequest) {
  // Revoke the session in DB before clearing the cookie
  const token = request.cookies.get('baljia-session')?.value;
  if (token) {
    try {
      const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
      const { payload } = await jwtVerify(token, secret);
      if (payload.jti) {
        await revokeSession(payload.jti as string);
      }
    } catch {
      // Token already expired or invalid — still clear cookie
    }
  }

  const response = NextResponse.json({ ok: true, redirect: '/login' });
  clearSessionCookie(response);
  return response;
}
