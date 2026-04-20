// Browser-auth helper for Playwright smoke tests.
// Creates/finds a smoke test user, signs a JWT, sets the session cookie on the
// Playwright browser context — so tests can reach authenticated pages without
// navigating through the magic-link flow.

import type { BrowserContext } from '@playwright/test';
import { signJWT } from '@/lib/auth';
import { db, users } from '@/lib/db';
import { eq } from 'drizzle-orm';

export const SMOKE_EMAIL = 'smoke-test@baljia.app';
const COOKIE_NAME = 'baljia-session';

export async function ensureSmokeSession(context: BrowserContext, baseURL: string): Promise<{ id: string }> {
  const [existing] = await db.select({ id: users.id })
    .from(users).where(eq(users.email, SMOKE_EMAIL)).limit(1);

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const [created] = await db.insert(users)
      .values({ email: SMOKE_EMAIL, name: 'Smoke Test', auth_provider: 'magic_link' })
      .returning({ id: users.id });
    userId = created.id;
  }

  const token = await signJWT(userId);
  const url = new URL(baseURL);

  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: token,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    },
  ]);

  return { id: userId };
}
