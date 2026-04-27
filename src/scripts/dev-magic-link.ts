// Dev shortcut: mint a magic link for a given email and print the URL.
// Skips Postmark entirely. Usage:
//   npx tsx src/scripts/dev-magic-link.ts you@example.com
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
import { db, users, magicLinkTokens } from '@/lib/db';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';

async function main() {
  const email = (process.argv[2] ?? '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    console.error('Usage: npx tsx src/scripts/dev-magic-link.ts you@example.com');
    process.exit(1);
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const userId = existing?.id ?? (await db.insert(users).values({ email, auth_provider: 'magic_link' }).returning({ id: users.id }))[0].id;

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.insert(magicLinkTokens).values({ user_id: userId, token: tokenHash, expires_at: expiresAt });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  console.log(`\nMagic link for ${email} (15 min):\n${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}\n`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
