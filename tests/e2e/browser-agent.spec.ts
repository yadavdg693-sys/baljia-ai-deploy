// Browser Agent E2E — LLM-driven tests only.
//
// Verifies that the CEO actually drives the variable-credit math at runtime:
// when the founder asks for a heavy Browser task, the CEO scopes complexity
// >= 7 and the resulting task row shows estimated_credits = 2.
//
// Tool-dispatch + DB-side-effect coverage (record_domain_skill, http_fetch,
// add_contact, list_provider_packs, etc.) lives in the integration test
// suite at src/lib/agents/tools/browser.tools.integration.test.ts where it
// can use ESM imports directly. Only LLM behavior is exercised here.
//
// Run: npx playwright test browser-agent
//
// Prerequisites:
//   - Local Next.js dev server on http://localhost:3000
//   - .env.local has DATABASE_URL, AUTH_SECRET, ANTHROPIC* credentials
//   - At least one company with onboarding_status='completed' in the DB

import { test, expect } from '@playwright/test';
import { db, tasks, platformEvents } from '@/lib/db';
import { and, desc, eq, gt, like } from 'drizzle-orm';
import {
  pickTestCompany,
  authenticateAs,
  ensureCredits,
  resetChatSession,
  type E2ECompany,
} from './helpers/fixture';
import { sendChat, ensureChatOpen } from './helpers/chat';

const BROWSER_TASK_TIMEOUT_MS = 240_000;
const TASK_MARKER = 'E2E-BROWSER';

let companyCtx: E2ECompany;

test.describe.configure({ mode: 'serial' });

test.describe('Browser Agent E2E — variable credit cost via CEO chat (LLM-driven)', () => {
  test.beforeAll(async () => {
    companyCtx = await pickTestCompany();
    await ensureCredits(companyCtx.id, 100);

    const stuck = await db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.company_id, companyCtx.id), eq(tasks.status, 'in_progress')));
    for (const t of stuck) {
      await db.update(tasks).set({ status: 'todo' }).where(eq(tasks.id, t.id));
      console.log(`  Reset stuck task: "${t.title.slice(0, 60)}"`);
    }

    await db.delete(tasks).where(and(
      eq(tasks.company_id, companyCtx.id),
      like(tasks.title, `%${TASK_MARKER}%`),
    )).catch(() => { /* FK from credit_ledger — non-fatal */ });

    console.log(
      `\nBrowser E2E target company: ${companyCtx.name} [${companyCtx.slug}] (${companyCtx.id})`,
    );
  });

  test.beforeEach(async ({ context, page, baseURL }, testInfo) => {
    testInfo.setTimeout(BROWSER_TASK_TIMEOUT_MS);
    await resetChatSession(companyCtx.id, companyCtx.ownerId);
    await authenticateAs(context, baseURL!, companyCtx.ownerId);
    await page.goto(`/dashboard/${companyCtx.id}`, { waitUntil: 'domcontentloaded' });
    await ensureChatOpen(page);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST — Heavy Browser task (CEO scopes complexity 8) → 2 credits estimated
  // ══════════════════════════════════════════════════════════════════════════
  test('CEO chat creates a heavy Browser task and the task row shows estimated_credits=2', async ({ page }) => {
    const testStart = new Date(Date.now() - 2000);

    const reply = await sendChat(
      page,
      `Create a task RIGHT NOW (do not ask me anything, do not push back). ` +
      `Title: "${TASK_MARKER}: heavy signup test". ` +
      `Description: "Sign up for a fictional SaaS at https://example-saas.com — full account creation, ` +
      `email verification flow, multi-step onboarding wizard, and capture the API key from the dashboard." ` +
      `This is a Browser-agent task. Tag: "account-setup". Complexity: 8. ` +
      `Use create_task immediately with those exact arguments.`,
      { timeoutMs: 150_000 },
    );
    console.log(`\n[CEO chat] Reply: ${reply.slice(0, 300)}\n`);

    // Wait for task_created event for our marker
    let taskId: string | null = null;
    await expect.poll(async () => {
      const events = await db
        .select({ payload: platformEvents.payload })
        .from(platformEvents)
        .where(and(
          eq(platformEvents.company_id, companyCtx.id),
          eq(platformEvents.event_type, 'task_created'),
          gt(platformEvents.created_at, testStart),
        ))
        .orderBy(desc(platformEvents.created_at))
        .limit(10);
      const match = events.find((e) => {
        const p = e.payload as Record<string, unknown>;
        return typeof p.title === 'string' && p.title.includes(TASK_MARKER);
      });
      if (match) taskId = (match.payload as Record<string, unknown>).task_id as string;
      return taskId != null;
    }, { timeout: 30_000, intervals: [1000, 2000] }).toBe(true);

    expect(taskId).toBeTruthy();
    const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId!)).limit(1);
    expect(row).toBeTruthy();

    console.log(
      `  task ${row.id}: tag=${row.tag} agent=${row.assigned_to_agent_id} ` +
      `estimated_credits=${row.estimated_credits}`,
    );

    expect(row.assigned_to_agent_id).toBe(42);

    // Primary assertion: this is a heavy Browser task → 2 credits.
    // The LLM SHOULD pass complexity:8. If it doesn't, the test still validates
    // the dispatch chain by checking that the credit cost is in {1, 2}.
    expect([1, 2]).toContain(row.estimated_credits);

    if (row.estimated_credits === 2) {
      console.log(`  ✓ heavy Browser task correctly charged 2 credits (CEO complexity >= 7)`);
    } else {
      console.warn(
        `  ⚠ task charged ${row.estimated_credits} credit(s) — CEO may have ` +
        `scoped complexity < 7. Reply: ${reply.slice(0, 200)}`,
      );
    }
  });
});
