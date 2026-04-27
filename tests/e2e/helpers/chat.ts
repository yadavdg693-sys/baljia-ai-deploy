// Helpers for driving the FounderChatRail in Playwright tests.
// Encapsulates: typing, sending, waiting for the streaming response to settle,
// and reading the assistant's final reply.

import type { Page, Locator } from '@playwright/test';

const INPUT = '.chat-sidebar__input';
const SEND = '.chat-sidebar__send';
const ASSISTANT_BUBBLE = '.thought-row p';
const FOUNDER_BUBBLE = '.founder-bubble';

/**
 * Send a chat message and wait for the assistant response to fully stream.
 * Returns the final assistant reply text (last visible thought row).
 *
 * Strategy:
 *   1. Snapshot how many assistant bubbles exist before sending.
 *   2. Type + send.
 *   3. Wait for a NEW assistant bubble to appear AND its text to stop being
 *      the placeholder "thinking..." italic.
 *   4. Wait until the input is re-enabled (component clears `isStreaming` only
 *      after the SSE stream closes).
 */
export async function sendChat(page: Page, message: string, opts: { timeoutMs?: number } = {}): Promise<string> {
  const timeout = opts.timeoutMs ?? 60_000;

  // Wait for hydration — chat rail is a 'use client' component and the form
  // handlers won't be attached until React has mounted.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => { /* tolerate */ });

  // Pre-condition: input must exist AND be enabled (not mid-stream from a prior turn).
  const input = page.locator(INPUT);
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    (sel: string) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      return el != null && !el.disabled;
    },
    INPUT,
    { timeout: 10_000 },
  );

  const before = await page.locator(ASSISTANT_BUBBLE).count();

  // Type into the input. .fill() triggers React's onChange so `draft` state updates.
  await input.click();
  await input.fill(message);

  // Verify React draft state caught up before submit (defensive — without this,
  // a fast submit can fire while draft is still '').
  await page.waitForFunction(
    (args: { sel: string; expected: string }) => {
      const el = document.querySelector(args.sel) as HTMLInputElement | null;
      return el != null && el.value === args.expected;
    },
    { sel: INPUT, expected: message },
    { timeout: 5_000 },
  );

  // Submit via Enter — more reliable than clicking the send button across layouts.
  await input.press('Enter');

  // Wait for the user bubble to render — confirms the message left the client.
  // Use a substring match on the first 50 chars to avoid quote-escaping issues.
  const messageHead = message.slice(0, 50);
  await page.locator(FOUNDER_BUBBLE, { hasText: messageHead }).first().waitFor({ timeout: 15_000 });

  // Wait for at least one new assistant bubble to appear.
  await page.waitForFunction(
    (args: { sel: string; before: number }) => document.querySelectorAll(args.sel).length > args.before,
    { sel: ASSISTANT_BUBBLE, before },
    { timeout },
  );

  // Wait for the input to be re-enabled — FounderChatRail clears `isStreaming`
  // in the finally block of handleSend after the SSE stream closes.
  await page.waitForFunction(
    (sel: string) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      return el != null && !el.disabled;
    },
    INPUT,
    { timeout },
  );

  // Read the LAST assistant bubble's text — that's the final reply.
  const bubbles = page.locator(ASSISTANT_BUBBLE);
  const total = await bubbles.count();
  return (await bubbles.nth(total - 1).textContent()) ?? '';
}

/** Open the chat rail if it's collapsed (defensive — usually it's open). */
export async function ensureChatOpen(page: Page): Promise<void> {
  const expandBtn = page.locator('.chat-sidebar__expand-btn');
  if (await expandBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await expandBtn.click();
  }
  await page.locator(INPUT).waitFor({ timeout: 5_000 });
}

/** Locator for the chat thread's most-recent assistant bubble. */
export function lastAssistantBubble(page: Page): Locator {
  return page.locator(ASSISTANT_BUBBLE).last();
}
