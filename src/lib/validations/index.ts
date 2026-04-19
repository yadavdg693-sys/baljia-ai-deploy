import { z } from 'zod';

export const waitlistSchema = z.object({
  email: z.string().email().max(255),
});

export const quickStartSchema = z.object({
  email: z.string().email().max(255),
  journey: z.enum(['surprise_me', 'build_my_idea', 'grow_my_company']),
  idea: z.string().max(2000).optional(),
  business_url: z.string().max(500).optional(),
  timezone: z.string().max(100).optional(),
});

export const onboardingSchema = z.object({
  journey: z.enum(['surprise_me', 'build_my_idea', 'grow_my_company']),
  idea: z.string().max(2000).optional(),
  business_url: z.string().url().optional(),
  timezone: z.string().max(100).optional(),
});

export const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  tag: z.string().min(1).max(100),
  priority: z.number().int().min(0).max(100).default(50),
  source: z.enum([
    'founder_requested',
    'ceo_suggested',
    'night_shift_generated',
    'auto_remediation',
    'recurring',
    'onboarding',
  ]).default('founder_requested'),
});

// FIX: M-UX-013 — status removed to prevent direct manipulation via PATCH.
// Status changes must go through taskService.startTask/completeTask/failTask
export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

export const chatMessageSchema = z.object({
  message: z.string().min(1).max(10000),
  session_id: z.string().uuid().optional(),
});

export const updateDocumentSchema = z.object({
  content: z.string().max(100000),
});

export const documentSuggestionReviewSchema = z.object({
  action: z.enum(['accept', 'edit', 'skip']),
  edited_content: z.string().max(100000).optional(),
});

export const purchaseCreditsSchema = z.object({
  amount: z.number().int().min(1).max(1000),
});

export const updateCompanySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  one_liner: z.string().max(500).optional(),
});

export const createRecurringTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  tag: z.string().min(1).max(100),
  cadence: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
  priority: z.number().int().min(0).max(100).default(50),
});

// Fix #44: require edited_content when action is 'edit'
export const documentSuggestionReviewSchemaStrict = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }),
  z.object({ action: z.literal('skip') }),
  z.object({ action: z.literal('edit'), edited_content: z.string().min(1).max(100000) }),
]);

export const leadCaptureSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().max(255).optional(),
  source: z.string().max(100).optional(),
});
