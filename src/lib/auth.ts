// Custom Auth — JWT sign/verify + cookie helpers
// Replaces Supabase Auth with jose (edge-compatible)
// FIX: G-SEC-003 — JWT session revocation via userSessions table

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { cookies } from 'next/headers';
import { db, users, userSessions } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

const COOKIE_NAME = 'baljia-session';
const JWT_EXPIRY = '30d';
const JWT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionPayload extends JWTPayload {
  sub: string; // userId
  jti: string; // session ID for revocation
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET env var is required');
  return new TextEncoder().encode(secret);
}

/** Generate a crypto-safe random JTI */
function generateJti(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── JWT ──────────────────────────────────────────

export async function signJWT(userId: string): Promise<string> {
  const jti = generateJti();
  const expiresAt = new Date(Date.now() + JWT_EXPIRY_MS);

  // Record session in DB for revocation support
  await db.insert(userSessions).values({
    user_id: userId,
    jti,
    is_active: true,
    expires_at: expiresAt,
  });

  return new SignJWT({ sub: userId, jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret());
}

export async function verifyJWT(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret()) as { payload: SessionPayload };
    if (!payload.sub) return null;

    // Check session revocation if jti is present
    if (payload.jti) {
      const [session] = await db.select({ is_active: userSessions.is_active })
        .from(userSessions)
        .where(and(eq(userSessions.jti, payload.jti), eq(userSessions.is_active, true)))
        .limit(1);

      if (!session) return null; // Session revoked or not found
    }

    return { userId: payload.sub };
  } catch {
    return null;
  }
}

/** Revoke a specific session by JTI */
export async function revokeSession(jti: string): Promise<void> {
  await db.update(userSessions)
    .set({ is_active: false, revoked_at: new Date() })
    .where(eq(userSessions.jti, jti));
}

/** Revoke all sessions for a user (e.g. password change, security event) */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db.update(userSessions)
    .set({ is_active: false, revoked_at: new Date() })
    .where(and(eq(userSessions.user_id, userId), eq(userSessions.is_active, true)));
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
