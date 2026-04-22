// Browser smoke tests — verifies the frontend actually renders and integrates
// with the backend. Uses an existing completed company from the DB (seeded by
// scripts/smoke-test-onboarding.ts) to exercise the dashboard without needing
// to run a fresh onboarding for every test (~4 min apiece).

import { test, expect } from '@playwright/test';
import { ensureSmokeSession, SMOKE_EMAIL } from './helpers/auth';
import { db, companies, users } from '@/lib/db';
import { eq, and, desc, inArray } from 'drizzle-orm';

// ───────────────────── Public pages (no auth required) ─────────────────────

test.describe('Public pages', () => {
  test('landing page renders', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    // Smoke: page returns 200 and has some Baljia branding
    const body = await page.textContent('body');
    expect(body?.toLowerCase()).toContain('baljia');
  });

  test('login page renders with email input', async ({ page }) => {
    await page.goto('/login');
    // Login should have either a magic-link email input or OAuth button
    const hasEmailOrGoogle = await page.locator('input[type="email"], button:has-text("Google"), button:has-text("Sign in")').first().isVisible({ timeout: 5_000 });
    expect(hasEmailOrGoogle).toBe(true);
  });

  test('faq page renders', async ({ page }) => {
    await page.goto('/faq');
    await expect(page).toHaveURL(/\/faq/);
  });
});

// ───────────────────── Authenticated pages ─────────────────────

test.describe('Authenticated UI', () => {
  test('onboarding page shows journey choices when user has no company', async ({ page, context, baseURL }) => {
    // Use a user with NO company so onboarding renders the chooser
    // (smoke user has already completed onboarding; use a fresh email)
    const freshEmail = 'playwright-onboarding@baljia.app';
    const [existing] = await db.select({ id: users.id })
      .from(users).where(eq(users.email, freshEmail)).limit(1);

    let userId: string;
    if (existing) {
      userId = existing.id;
    } else {
      const [created] = await db.insert(users)
        .values({ email: freshEmail, name: 'Playwright Onboarding', auth_provider: 'magic_link' })
        .returning({ id: users.id });
      userId = created.id;
    }

    // Clean up any company this test user may have from a prior failed run
    await db.delete(companies).where(eq(companies.owner_id, userId));

    // Inject session cookie
    const { signJWT } = await import('@/lib/auth');
    const token = await signJWT(userId);
    const url = new URL(baseURL!);
    await context.addCookies([{
      name: 'baljia-session', value: token, domain: url.hostname, path: '/',
      httpOnly: true, secure: false, sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    }]);

    await page.goto('/onboarding');

    // Expect to see the journey chooser (Level 1)
    const buttons = await page.locator('button').allTextContents();
    const hasJourneyOption = buttons.some((t) =>
      /build.*idea|grow.*company|surprise/i.test(t),
    );
    expect(hasJourneyOption).toBe(true);
  });

  test('dashboard renders for most recent smoke-test company', async ({ page, context, baseURL }) => {
    // Find the smoke-test user + their most recent completed company
    const [smokeUser] = await db.select({ id: users.id })
      .from(users).where(eq(users.email, SMOKE_EMAIL)).limit(1);
    if (!smokeUser) test.skip(true, 'no smoke-test user — run scripts/smoke-test-onboarding.ts first');

    const [company] = await db.select({ id: companies.id, name: companies.name, slug: companies.slug })
      .from(companies)
      .where(and(eq(companies.owner_id, smokeUser.id), eq(companies.onboarding_status, 'completed')))
      .orderBy(desc(companies.created_at))
      .limit(1);
    if (!company) test.skip(true, 'no completed smoke-test company — run backend smoke test first');

    await ensureSmokeSession(context, baseURL!);

    await page.goto(`/dashboard/${company.id}`);

    // Dashboard should show the company name somewhere
    const bodyText = await page.textContent('body', { timeout: 15_000 });
    expect(bodyText).toBeTruthy();
    expect(bodyText!.toLowerCase()).toContain(company.name.toLowerCase());

    // And should show task-related UI (at least one task card or task title)
    // The 3 starter tasks should render as clickable items
    const hasTaskLikeUI = /scout|cold outreach|build/i.test(bodyText!);
    expect(hasTaskLikeUI).toBe(true);
  });

  test('public company landing page serves generated HTML', async ({ page, baseURL }) => {
    // The landing page is served by Next.js middleware via wildcard subdomain.
    // Locally, without wildcard DNS, we hit /company/[slug] as the explicit route.
    const [smokeUser] = await db.select({ id: users.id })
      .from(users).where(eq(users.email, SMOKE_EMAIL)).limit(1);
    if (!smokeUser) test.skip(true, 'no smoke-test user');

    const [company] = await db.select({ slug: companies.slug, name: companies.name })
      .from(companies)
      .where(and(eq(companies.owner_id, smokeUser.id), eq(companies.onboarding_status, 'completed')))
      .orderBy(desc(companies.created_at))
      .limit(1);
    if (!company?.slug) test.skip(true, 'no company slug');

    await page.goto(`/company/${company.slug}`);
    const body = await page.textContent('body', { timeout: 10_000 });
    expect(body).toBeTruthy();
    // Landing page should include the company name or a recognizable marker
    const hasCompanyContent = body!.toLowerCase().includes(company.name.toLowerCase())
      || body!.toLowerCase().includes('baljia');
    expect(hasCompanyContent).toBe(true);
  });
});
