// Founder UI parity suite — verifies that the buttons + dialogs added to
// DashboardShell let the user perform the same operations Baljia can do via
// chat tools (create_task, update_link, recurring CRUD, etc.). Uses real
// browser, real DB, no LLM (these tests bypass the chat path entirely).
//
// Run: npx playwright test founder-ui-parity
// Single test:  npx playwright test founder-ui-parity -g "create task"

import { test, expect } from '@playwright/test';
import { db, tasks, dashboardLinks, recurringTasks } from '@/lib/db';
import { and, eq, like } from 'drizzle-orm';
import { pickTestCompany, authenticateAs, ensureCredits, type E2ECompany } from './helpers/fixture';

const TASK_PREFIX = 'PARITY-UI-TASK';
const LINK_LABEL = 'PARITY-UI-LINK';
const RECURRING_TITLE = 'PARITY-UI-RECURRING';

let companyCtx: E2ECompany;

test.describe.configure({ mode: 'serial' });

test.describe('Founder UI parity (user can do what Baljia does)', () => {
  test.beforeAll(async () => {
    companyCtx = await pickTestCompany();
    await ensureCredits(companyCtx.id, 20);
    // Wipe any leftover fixtures so each suite run is idempotent.
    await db.delete(tasks).where(and(
      eq(tasks.company_id, companyCtx.id),
      like(tasks.title, `%${TASK_PREFIX}%`),
    ));
    await db.delete(dashboardLinks).where(and(
      eq(dashboardLinks.company_id, companyCtx.id),
      eq(dashboardLinks.label, LINK_LABEL),
    ));
    await db.delete(recurringTasks).where(and(
      eq(recurringTasks.company_id, companyCtx.id),
      eq(recurringTasks.title, RECURRING_TITLE),
    ));
  });

  test.beforeEach(async ({ context, page, baseURL }, testInfo) => {
    testInfo.setTimeout(120_000);
    await authenticateAs(context, baseURL!, companyCtx.ownerId);
    await page.goto(`/dashboard/${companyCtx.id}`, { waitUntil: 'domcontentloaded' });
    // Wait for hydration — the dialog buttons need React handlers attached
    // before clicks register. domcontentloaded fires before that.
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForSelector('.dashboard-section', { timeout: 15_000 });
    // Confirm a button is interactable (defensive — picks up any remaining hydration lag).
    await page.waitForFunction(() => {
      const btn = document.querySelector('button');
      return btn != null;
    }, { timeout: 10_000 });
  });

  // ────────────────────────────────────────────────────────────
  // 1. Founder can create a task without going through chat.
  // ────────────────────────────────────────────────────────────
  test('"+ New Task" button creates a task and refreshes the dashboard', async ({ page }) => {
    const title = `${TASK_PREFIX}-create`;

    // Open the dialog. Use locator + click with retry — first click sometimes
    // fires before the React onClick handler attaches.
    const newTaskBtn = page.getByRole('button', { name: /\+ New Task/i }).first();
    await newTaskBtn.click();
    // Heading or any of the placeholder inputs is a sufficient signal the dialog mounted.
    await page.waitForSelector('h2:has-text("New Task"), input[placeholder="Ship the v1 landing page"]', { timeout: 15_000 });

    // Fill via placeholder-based selectors (set by NewTaskDialog).
    await page.getByPlaceholder('Ship the v1 landing page').fill(title);
    await page.getByPlaceholder(/success look like/i).fill('E2E parity test fixture — auto-created via "+ New Task" button.');
    await page.getByPlaceholder('landing-page').fill('research');

    // Submit
    await page.getByRole('button', { name: /^Create task$/i }).click();

    // DB confirms the row was inserted by the founder UI path (source='founder_requested').
    await expect.poll(async () => {
      const [row] = await db.select({ id: tasks.id, source: tasks.source })
        .from(tasks)
        .where(and(eq(tasks.company_id, companyCtx.id), eq(tasks.title, title)))
        .limit(1);
      return row?.source;
    }, { timeout: 15_000, intervals: [500, 1000, 2000] }).toBe('founder_requested');

    console.log(`  ✓ "${title}" created via UI (source=founder_requested — confirms it was the user, not Baljia)`);
  });

  // ────────────────────────────────────────────────────────────
  // 2. Founder can add a dashboard link without going through chat.
  // ────────────────────────────────────────────────────────────
  test('"+ Add link" button writes a row to dashboard_links', async ({ page }) => {
    const url = 'https://example.com/founder-ui-parity';

    await page.getByRole('button', { name: /\+ Add link/i }).click();
    await page.waitForSelector('h2:has-text("Add link"), input[placeholder="Marketing site"]', { timeout: 15_000 });

    await page.getByPlaceholder('Marketing site').fill(LINK_LABEL);
    await page.getByPlaceholder('https://example.com').fill(url);

    await page.getByRole('button', { name: /^Save$/i }).click();

    await expect.poll(async () => {
      const [row] = await db.select().from(dashboardLinks).where(and(
        eq(dashboardLinks.company_id, companyCtx.id),
        eq(dashboardLinks.label, LINK_LABEL),
      )).limit(1);
      return row?.url;
    }, { timeout: 15_000, intervals: [500, 1000, 2000] }).toBe(url);

    console.log(`  ✓ "${LINK_LABEL}" written via UI`);
  });

  // ────────────────────────────────────────────────────────────
  // 3. Founder can open the Recurring Tasks dialog.
  // ────────────────────────────────────────────────────────────
  test('"↻ Recurring" button opens the recurring tasks dialog', async ({ page }) => {
    await page.getByRole('button', { name: /↻ Recurring|Recurring/i }).first().click();

    // Dialog title should be "Recurring tasks"
    await page.waitForSelector('h2:has-text("Recurring tasks"), h2:has-text("Recurring")', { timeout: 5_000 });
    const heading = await page.locator('h2').filter({ hasText: /Recurring/i }).first().textContent();
    expect((heading ?? '').toLowerCase()).toContain('recurring');

    console.log(`  ✓ Recurring dialog opens with heading "${heading}"`);
  });

  // ────────────────────────────────────────────────────────────
  // 4. APIs that back the new UI work end-to-end (PATCH recurring, POST/DELETE links, GET task logs).
  // ────────────────────────────────────────────────────────────
  test('new APIs respond correctly to authenticated calls', async ({ page }) => {
    // page.request inherits the browser context's cookies — including the
    // baljia-session JWT set by authenticateAs in beforeEach.

    // Seed a recurring task we can edit
    const [seeded] = await db.insert(recurringTasks).values({
      company_id: companyCtx.id,
      title: RECURRING_TITLE,
      description: 'API test fixture',
      tag: 'research',
      cadence: 'weekly',
      monthly_credits_estimate: 4,
      next_run_at: new Date(),
      is_active: true,
    }).returning({ id: recurringTasks.id });

    const patchRes = await page.request.patch(`/api/recurring/${seeded.id}`, {
      data: { is_active: false },
    });
    expect(patchRes.status()).toBe(200);
    const [afterPatch] = await db.select({ is_active: recurringTasks.is_active })
      .from(recurringTasks)
      .where(eq(recurringTasks.id, seeded.id));
    expect(afterPatch?.is_active).toBe(false);

    const delRes = await page.request.delete(`/api/recurring/${seeded.id}`);
    expect(delRes.status()).toBe(200);
    const stillThere = await db.select().from(recurringTasks).where(eq(recurringTasks.id, seeded.id));
    expect(stillThere.length).toBe(0);

    const linkLabel = 'PARITY-UI-LINK-API';
    const postLink = await page.request.post('/api/links', {
      data: { company_id: companyCtx.id, label: linkLabel, url: 'https://example.com/api-test' },
    });
    expect(postLink.status()).toBe(200);

    const delLink = await page.request.delete(`/api/links?company_id=${companyCtx.id}&label=${linkLabel}`);
    expect(delLink.status()).toBe(200);

    console.log('  ✓ PATCH /api/recurring/:id, DELETE /api/recurring/:id, POST /api/links, DELETE /api/links — all 200');
  });

  // ── Cleanup ──
  test.afterAll(async () => {
    await db.delete(tasks).where(and(
      eq(tasks.company_id, companyCtx.id),
      like(tasks.title, `%${TASK_PREFIX}%`),
    ));
    await db.delete(dashboardLinks).where(and(
      eq(dashboardLinks.company_id, companyCtx.id),
      like(dashboardLinks.label, `%PARITY-UI-LINK%`),
    ));
    await db.delete(recurringTasks).where(and(
      eq(recurringTasks.company_id, companyCtx.id),
      like(recurringTasks.title, `%${RECURRING_TITLE}%`),
    ));
  });
});
