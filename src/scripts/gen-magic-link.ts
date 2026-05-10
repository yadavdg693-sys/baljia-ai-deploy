// Generate a magic link directly (skip Postmark entirely) for local testing.
// Usage: npx tsx --env-file=.env.local src/scripts/gen-magic-link.ts <email>
//
// Bypasses auth.service.createMagicLink so it works regardless of NODE_ENV
// and BALJIA_FORCE_EMAIL settings. Creates user (if missing) + token row +
// prints the verify URL pointing at http://localhost:3000.

import { db, users, magicLinkTokens } from '@/lib/db';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';

void (async () => {
  const email = (process.argv[2] ?? '').toLowerCase().trim();
  if (!email) {
    console.error('Usage: gen-magic-link.ts <email>');
    process.exit(1);
  }

  // Upsert user
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const [newUser] = await db.insert(users).values({ email, auth_provider: 'magic_link' }).returning({ id: users.id });
    userId = newUser.id;
  }

  // Generate token (mirrors auth.service.ts)
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

  await db.insert(magicLinkTokens).values({
    user_id: userId,
    token: tokenHash,
    expires_at: expiresAt,
  });

  // Always use localhost:3000 for dev (the running dev server)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const verifyUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(rawToken)}`;

  console.log(`\nMagic link for ${email} (expires in 15 min):`);
  console.log(verifyUrl);
  console.log('');
  process.exit(0);
})();
