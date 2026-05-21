import { z } from 'zod';

const websiteUrlInput = z.string().trim().max(500).refine((value) => {
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(withProtocol);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}, 'Enter a valid website URL');

const optionalWebsiteUrlInput = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}, websiteUrlInput.optional());

const optionalTrimmedText = (max: number) => z.preprocess((value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  return value;
}, z.string().max(max).optional());

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
  business_url: websiteUrlInput.optional(),
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
export const runAdsSchema = z.object({
  company_id: z.string().min(1),
  promoted_item: z.string().trim().min(2).max(500),
  goal: z.enum(['traffic', 'leads', 'awareness']),
  daily_budget: z.coerce.number().min(10).max(1000),
  landing_url: optionalWebsiteUrlInput,
  audience: optionalTrimmedText(500),
  age_min: z.coerce.number().int().min(13).max(65).default(18),
  age_max: z.coerce.number().int().min(13).max(65).default(65),
  country: z.string().trim().length(2).default('US'),
  creative_brief: optionalTrimmedText(1000),
  approval_mode: z.enum(['review_before_launch', 'autopilot']).default('review_before_launch'),
});

export const PROMO_VIDEO_GOALS = ['attention', 'launch', 'product_hunt', 'explain', 'demo', 'pitch'] as const;
export const PROMO_VIDEO_DURATIONS = [15, 30, 60, 90] as const;
export const PROMO_VIDEO_ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const;
export const PROMO_VIDEO_STYLES = ['product_demo', 'clean_saas', 'cinematic_ui'] as const;
export const PROMO_VIDEO_VISUAL_MODES = ['actual_site', 'cinematic'] as const;
export const PROMO_VIDEO_VOICE_MODES = ['deepgram', 'founder_avatar'] as const;

export const promoVideoRequestSchema = z.object({
  company_id: z.string().min(1),
  goal: z.enum(PROMO_VIDEO_GOALS).default('demo'),
  duration_seconds: z.coerce.number().int().refine(
    (value) => (PROMO_VIDEO_DURATIONS as readonly number[]).includes(value),
    'Choose 15, 30, 60, or 90 seconds',
  ).default(30),
  aspect_ratio: z.enum(PROMO_VIDEO_ASPECT_RATIOS).default('9:16'),
  style: z.enum(PROMO_VIDEO_STYLES).default('product_demo'),
  visual_mode: z.enum(PROMO_VIDEO_VISUAL_MODES).default('cinematic'),
  voice_mode: z.enum(PROMO_VIDEO_VOICE_MODES).default('deepgram'),
  cta: optionalTrimmedText(160),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  tag: z.string().min(1).max(100).optional(),
  queue_order: z.number().int().min(0).optional(),
});

// Update payload for recurring tasks — title/description/cadence/is_active.
// id and company_id are not editable; cadence change recomputes monthly_credits_estimate.
export const updateRecurringTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  tag: z.string().min(1).max(100).optional(),
  cadence: z.enum(['daily', 'weekly', 'biweekly', 'monthly']).optional(),
  is_active: z.boolean().optional(),
});

// Dashboard link create/upsert payload (label is unique per company).
export const upsertLinkSchema = z.object({
  label: z.string().min(1).max(100),
  url: z.string().url().max(500),
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
