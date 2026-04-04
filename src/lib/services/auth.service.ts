// Auth Service — magic link + Google OAuth business logic
// Replaces Supabase Auth with custom JWT-based auth

import { db, users, magicLinkTokens } from '@/lib/db';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { sendEmail } from '@/lib/services/email.service';
import { createLogger } from '@/lib/logger';
import crypto from 'crypto';

const log = createLogger('Auth');
const MAGIC_LINK_EXPIRY_MINUTES = 15;

// ── Magic Link ───────────────────────────────────

export async function createMagicLink(email: string): Promise<{ success: boolean }> {
  const normalizedEmail = email.toLowerCase().trim();

  // Upsert user — only fill blank fields
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const [newUser] = await db
      .insert(users)
      .values({ email: normalizedEmail, auth_provider: 'magic_link' })
      .returning({ id: users.id });
    userId = newUser.id;
  }

  // Generate secure token
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000);

  await db.insert(magicLinkTokens).values({
    user_id: userId,
    token,
    expires_at: expiresAt,
  });

  // Build verify URL
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const verifyUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;

  // Send via Postmark
  await sendEmail({
    to: normalizedEmail,
    from: 'hello@baljia.app',
    subject: 'Your Baljia login link',
    textBody: `Click this link to sign in to Baljia:\n\n${verifyUrl}\n\nThis link expires in ${MAGIC_LINK_EXPIRY_MINUTES} minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
    tag: 'magic-link',
    companyId: 'platform',
  });

  log.info('Magic link sent', { email: normalizedEmail });
  return { success: true };
}

export async function verifyMagicLink(token: string): Promise<{ userId: string; email: string } | null> {
  const [record] = await db
    .select({
      id: magicLinkTokens.id,
      user_id: magicLinkTokens.user_id,
      expires_at: magicLinkTokens.expires_at,
    })
    .from(magicLinkTokens)
    .where(
      and(
        eq(magicLinkTokens.token, token),
        isNull(magicLinkTokens.used_at),
        gt(magicLinkTokens.expires_at, new Date()),
      ),
    )
    .limit(1);

  if (!record) return null;

  // Mark token as used
  await db
    .update(magicLinkTokens)
    .set({ used_at: new Date() })
    .where(eq(magicLinkTokens.id, record.id));

  // Mark user email as verified
  await db
    .update(users)
    .set({ email_verified: true })
    .where(eq(users.id, record.user_id));

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, record.user_id))
    .limit(1);

  if (!user) return null;

  log.info('Magic link verified', { userId: user.id });
  return { userId: user.id, email: user.email };
}

// ── Google OAuth ─────────────────────────────────

interface GoogleProfile {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export async function findOrCreateGoogleUser(profile: GoogleProfile): Promise<{ userId: string; email: string }> {
  // Try find by google_id first
  const [byGoogleId] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.google_id, profile.id))
    .limit(1);

  if (byGoogleId) {
    log.info('Google login — existing user by google_id', { userId: byGoogleId.id });
    return { userId: byGoogleId.id, email: byGoogleId.email };
  }

  // Try find by email
  const [byEmail] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, profile.email.toLowerCase()))
    .limit(1);

  if (byEmail) {
    // Link Google account to existing user
    await db
      .update(users)
      .set({
        google_id: profile.id,
        email_verified: true,
        auth_provider: 'google',
        name: byEmail.email ? undefined : profile.name, // only fill blank name
      })
      .where(eq(users.id, byEmail.id));

    log.info('Google login — linked to existing user', { userId: byEmail.id });
    return { userId: byEmail.id, email: byEmail.email };
  }

  // Create new user
  const [newUser] = await db
    .insert(users)
    .values({
      email: profile.email.toLowerCase(),
      name: profile.name,
      google_id: profile.id,
      auth_provider: 'google',
      email_verified: true,
    })
    .returning({ id: users.id, email: users.email });

  log.info('Google login — new user created', { userId: newUser.id });
  return { userId: newUser.id, email: newUser.email };
}

// ── Helpers ──────────────────────────────────────

export async function getUserById(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user ?? null;
}
