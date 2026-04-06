// POST /api/auth/logout — clear session cookie
import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';

export async function POST() {
  // Return JSON with redirect URL instead of a 307 redirect from a POST
  // (307 preserves POST method, which is wrong for logout → login flow)
  const response = NextResponse.json({ ok: true, redirect: '/login' });
  clearSessionCookie(response);
  return response;
}
