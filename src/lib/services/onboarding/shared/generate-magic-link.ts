// Magic-link generator for the completion email CTA.
// 60-minute TTL (longer than the standard 15min login link since the email may
// sit in the founder's inbox for a while). Redirects to /dashboard/{slug}.
//
// Does NOT send an email — the token URL is embedded in the completion email.

import crypto from 'crypto';
import { db, users, magicLinkTokens } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { emitActivity } from '../stage-runner';
import type { PipelineContext } from '../types';

const ONBOARDING_MAGIC_LINK_TTL_MINUTES = 60;

// Module-scoped state exposed to downstream stages (read by sendCompletionEmail)
export interface MagicLinkExtension {
  magicLinkUrl?: string;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function generateOnboardingMagicLink(ctx: PipelineContext): Promise<void> {
  if (!ctx.founderEmail) {
    throw new Error('generate_magic_link: ctx.founderEmail missing');
  }

  // Resolve user by email (created during onboarding OR pre-existing from login)
  const normalizedEmail = ctx.founderEmail.toLowerCase().trim();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (!user) {
    throw new Error(`generate_magic_link: no user found for ${normalizedEmail}`);
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ONBOARDING_MAGIC_LINK_TTL_MINUTES * 60 * 1000);

  await db.insert(magicLinkTokens).values({
    user_id: user.id,
    token: tokenHash,
    expires_at: expiresAt,
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://baljia.ai';
  // redirect target: the founder's dashboard (scoped by slug so we hit the right company)
  const redirect = ctx.slug ? `/dashboard/${ctx.slug}` : '/dashboard';
  const url = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(redirect)}`;

  (ctx as PipelineContext & MagicLinkExtension).magicLinkUrl = url;
  await emitActivity(ctx, `Magic link generated (60 min TTL) → ${redirect}`, 'magic_link');
}
