// Helpers for asserting against DashboardShell state in Playwright tests.
// Operates on the rendered DOM (.task-preview-card, .links-list, etc.) rather
// than reaching into React internals.

import type { Page, Locator } from '@playwright/test';

const TASK_CARD = '.task-preview-card';
const TASK_TITLE = '.task-preview-card h3';
const LINK_ITEM = '.links-list .link-item, .links-list a';

/** Number of task cards currently rendered in the dashboard preview list. */
export async function getTaskCount(page: Page): Promise<number> {
  return page.locator(TASK_CARD).count();
}

/** All task titles currently rendered (top-5 preview list). */
export async function getTaskTitles(page: Page): Promise<string[]> {
  const titles = await page.locator(TASK_TITLE).allTextContents();
  return titles.map((t) => t.trim());
}

/**
 * Wait until a task with the given title appears in the dashboard.
 * Returns the time-to-visible in ms (useful for asserting refresh latency).
 */
export async function waitForTaskByTitle(
  page: Page,
  titleFragment: string,
  opts: { timeoutMs?: number } = {},
): Promise<number> {
  const timeout = opts.timeoutMs ?? 15_000;
  const t0 = Date.now();
  await page.locator(TASK_CARD, { has: page.locator('h3', { hasText: titleFragment }) })
    .first()
    .waitFor({ timeout });
  return Date.now() - t0;
}

/** Get the rendered status pill text for a task by title (e.g. "Awaiting approval"). */
export async function getTaskStatus(page: Page, titleFragment: string): Promise<string | null> {
  const card = page.locator(TASK_CARD, { has: page.locator('h3', { hasText: titleFragment }) }).first();
  if ((await card.count()) === 0) return null;
  const pill = card.locator('.micro-pill').last();
  if ((await pill.count()) === 0) return null;
  return ((await pill.textContent()) ?? '').trim();
}

/** Locator for a specific task card by title. */
export function taskCard(page: Page, titleFragment: string): Locator {
  return page.locator(TASK_CARD, { has: page.locator('h3', { hasText: titleFragment }) }).first();
}

/** Wait for a dashboard link with the given label text. */
export async function waitForLinkByLabel(page: Page, label: string, opts: { timeoutMs?: number } = {}): Promise<void> {
  const timeout = opts.timeoutMs ?? 15_000;
  await page.locator(LINK_ITEM, { hasText: label }).first().waitFor({ timeout });
}

/** Whether a credit balance display is rendered (e.g. "Credits: 10"). */
export async function getCreditDisplay(page: Page): Promise<string | null> {
  const node = page.locator('.refresh-note');
  if ((await node.count()) === 0) return null;
  return ((await node.textContent()) ?? '').trim();
}
