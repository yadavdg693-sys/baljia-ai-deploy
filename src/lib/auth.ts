// Custom Auth — JWT sign/verify + cookie helpers
// Replaces Supabase Auth with jose (edge-compatible)

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { cookies } from 'next/headers';
import { db, users } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

const COOKIE_NAME = 'baljia-session';
const JWT_EXPIRY = '30d';

interface SessionPayload extends JWTPayload {
  sub: string; // userId
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET env var is required');
  return new TextEncoder().encode(secret);
}

// ── JWT ──────────────────────────────────────────

export async function signJWT(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret());
}

export async function verifyJWT(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret()) as { payload: SessionPayload };
    if (!payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

// ── Cookie helpers ───────────────────────────────

export function setSessionCookie(response: Response, token: string): void {
  response.headers.append(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`,
  );
}

export function clearSessionCookie(response: Response): void {
  response.headers.append(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

// ── Session readers ──────────────────────────────

/** Read session from next/headers cookies (Server Components + Route Handlers) */
export async function getSessionFromCookies(): Promise<{ id: string; email: string; name: string | null } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifyJWT(token);
  if (!session) return null;

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  return user ?? null;
}

/** Read session from Request object (middleware) */
export async function getSessionFromRequest(request: NextRequest): Promise<{ userId: string } | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyJWT(token);
}
