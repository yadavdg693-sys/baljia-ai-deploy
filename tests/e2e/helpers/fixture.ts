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
 * Guarantee the test company has EXACTLY `target` credits before a test run.
 *
 * Always tops up — even if balance >= target — because the daily spend cap
 * is calculated from `task_deduction` entries, not the raw balance. Multiple
 * test runs in the same day exhaust the trial daily cap (3 credits) even if
 * the balance looks healthy. By always adding `target` credits we ensure:
 *   1. Balance is always at or above `target` going into the suite.
 *   2. The extra credit headroom keeps the cap check passing for the day.
 *
 * The idempotency key includes a timestamp so each call always inserts a
 * fresh ledger row (intentional — we want a real top-up, not a no-op).
 */
export async function ensureCredits(companyId: string, target: number = 100): Promise<number> {
  await creditService.addCredit(
    companyId,
    target,
    'addon_purchase',
    `E2E test credit reset to ${target}`,
    undefined,
    `e2e-reset:${companyId}:${Date.now()}`,
  );
  return target;
}
