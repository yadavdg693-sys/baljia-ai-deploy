// Tracked wrappers for platform-wide services (Tavily, email) that don't know
// about onboarding. These read the current stage from AsyncLocalStorage and
// auto-attribute cost to the right stage. Drop-in replacements for the originals.
//
// Keeping these thin and local to the onboarding module avoids coupling
// src/lib/tavily.ts or src/lib/services/email.service.ts to onboarding internals.

import { tavilySearchText as rawTavilySearchText } from '@/lib/tavily';
import { sendEmail as rawSendEmail } from '@/lib/services/email.service';
import { onboardingContext } from '../context';
import { recordTavilyCall, recordEmailSend } from './cost-tracker';

export async function trackedTavilySearch(
  ...args: Parameters<typeof rawTavilySearchText>
): ReturnType<typeof rawTavilySearchText> {
  const store = onboardingContext.getStore();
  if (store) recordTavilyCall(store.ctx, store.stage);
  return rawTavilySearchText(...args);
}

export async function trackedSendEmail(
  ...args: Parameters<typeof rawSendEmail>
): ReturnType<typeof rawSendEmail> {
  const store = onboardingContext.getStore();
  if (store) recordEmailSend(store.ctx, store.stage);
  return rawSendEmail(...args);
}
