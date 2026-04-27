// Test fixture: pick a real, fully-onboarded company to run CEO chat tests
// against. Falls back gracefully so the suite works in dev environments that
// haven't run the smoke-test seed script.

import { db, companies, chatSessions } from '@/lib/db';
import { and, eq, desc } from 'drizzle-orm';
import type { BrowserContext } from '@playwright/test';
import { signJWT } from '@/lib/auth';
import * as creditService from '@/lib/services/credit.service';

const COOKIE_NAME = 'baljia-session';

export interface E2ECompany {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
}

/**
 * Find the most-recently-active completed company in the DB. Used to pick a
 * stable test target without requiring a fresh onboarding run per test.
 */
export async function pickTestCompany(): Promise<E2ECompany> {
  const [c] = await db
    .select({
      id: companies.id,
      slug: companies.slug,
      name: companies.name,
      owner_id: companies.owner_id,
    })
    .from(companies)
    .where(eq(companies.onboarding_status, 'completed'))
    .orderBy(desc(companies.updated_at))
    .limit(1);

  if (!c?.owner_id) {
    throw new Error(
      'No completed company found in DB. Run an onboarding (or `npx tsx --env-file=.env.local src/scripts/seed-db.ts`) before the E2E suite.',
    );
  }

  return { id: c.id, slug: c.slug ?? 'test', name: c.name ?? 'Test Co', ownerId: c.owner_id };
}

/** Sign a JWT for the company's owner and inject it as a session cookie. */
export async function authenticateAs(context: BrowserContext, baseURL: string, ownerId: string): Promise<void> {
  const token = await signJWT(ownerId);
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
}

/**
 * Deactivate any existing chat session for this user+company so the next
 * chat call starts a fresh session. Long histories cause the LLM to
 * hallucinate replies (claiming it "created the task" without actually
 * invoking the tool) — clearing the session prevents that.
 */
export async function resetChatSession(companyId: string, userId: string): Promise<void> {
  await db.update(chatSessions)
    .set({ is_active: false })
    .where(and(eq(chatSessions.company_id, companyId), eq(chatSessions.user_id, userId)));
}

/**
 * Make sure the test company has at least `min` credits so credit-gated tools
 * don't trip on empty balance during the run. Uses the same `addCredit`
 * service path the production billing flow uses (handles balance_after etc.).
 */
export async function ensureCredits(companyId: string, min: number): Promise<number> {
  const balance = await creditService.getBalance(companyId);
  if (balance >= min) return balance;

  const topup = min - balance;
  await creditService.addCredit(
    companyId,
    topup,
    'addon_purchase',
    `E2E test top-up to ${min}`,
    undefined,
    `e2e-topup:${companyId}:${Date.now()}`,
  );
  return min;
}
