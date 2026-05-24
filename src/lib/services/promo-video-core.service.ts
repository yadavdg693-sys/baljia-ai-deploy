import { desc, eq } from 'drizzle-orm';
import { db, promoVideoJobs } from '@/lib/db';
import {
  PROMO_VIDEO_ASPECT_RATIOS,
  PROMO_VIDEO_DURATIONS,
  PROMO_VIDEO_GOALS,
  PROMO_VIDEO_STYLES,
  PROMO_VIDEO_VISUAL_MODES,
  PROMO_VIDEO_VOICE_MODES,
} from '@/lib/validations';
import type {
  PromoVideoAiUsage,
  PromoVideoAspectRatio,
  PromoVideoCaptureAsset,
  PromoVideoDuration,
  PromoVideoGoal,
  PromoVideoJob,
  PromoVideoStatus,
  PromoVideoStoryboard,
  PromoVideoStyle,
  PromoVideoVisualMode,
  PromoVideoVoiceMode,
} from '@/types';

export const PROMO_VIDEO_STATUS_LABELS: Record<PromoVideoStatus, string> = {
  queued: 'Queued',
  capturing: 'Studying product',
  writing_script: 'Writing story',
  preview_rendering: 'Creating preview',
  preview_ready: 'Preview ready',
  finalizing: 'Approved',
  rendering: 'Creating video',
  uploading: 'Finishing up',
  ready: 'Ready',
  failed: 'Failed',
};

export const PROMO_VIDEO_GOAL_LABELS: Record<PromoVideoGoal, string> = {
  attention: 'Get attention',
  launch: 'Announce launch',
  product_hunt: 'Product Hunt launch',
  explain: 'Explain product',
  demo: 'Show product demo',
  pitch: 'Pitch customers/investors',
};

export const PROMO_VIDEO_STYLE_LABELS: Record<PromoVideoStyle, string> = {
  product_demo: 'Product demo',
  clean_saas: 'Clean SaaS promo',
  cinematic_ui: 'Cinematic UI',
};

export const PROMO_VIDEO_VISUAL_MODE_LABELS: Record<PromoVideoVisualMode, string> = {
  actual_site: 'Actual site demo',
  cinematic: 'Cinematic promo',
};

export const PROMO_VIDEO_VOICE_LABELS: Record<PromoVideoVoiceMode, string> = {
  deepgram: 'Deepgram voice',
  supertonic: 'Supertonic voice',
  founder_avatar: 'Founder avatar voice',
};

export const PROMO_VIDEO_ASPECT_LABELS: Record<PromoVideoAspectRatio, string> = {
  '9:16': '9:16 vertical',
  '16:9': '16:9 landscape',
  '1:1': '1:1 square',
};

export function getPromoVideoCreditCost(durationSeconds: number): number {
  if (durationSeconds === 60) return 3;
  if (durationSeconds === 90) return 4;
  return 2;
}

export function getDefaultPromoVideoCta(goal: PromoVideoGoal, companyName: string, cta?: string | null): string {
  const trimmed = cta?.trim();
  if (trimmed) return trimmed;
  if (goal === 'product_hunt') return `Try ${companyName} on Product Hunt`;
  return `Try ${companyName}`;
}

export function isPromoVideoDuration(value: number): value is PromoVideoDuration {
  return (PROMO_VIDEO_DURATIONS as readonly number[]).includes(value);
}

export function normalizePublicUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export type PromoVideoCompanyUrlSource = {
  slug: string;
  subdomain: string | null;
  custom_domain: string | null;
};

export function resolvePromoVideoLiveUrl(company: PromoVideoCompanyUrlSource): string {
  if (company.custom_domain?.trim()) return normalizePublicUrl(company.custom_domain.trim());
  if (company.subdomain?.trim()) return `https://${company.subdomain.trim()}.baljia.app`;
  return `https://${company.slug}.baljia.app`;
}

export function getPromoVideoDimensions(aspectRatio: PromoVideoAspectRatio): { width: number; height: number } {
  if (aspectRatio === '16:9') return { width: 1920, height: 1080 };
  if (aspectRatio === '1:1') return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

export function normalizeSceneDurations<T extends { duration_seconds: number }>(
  scenes: T[],
  targetDurationSeconds: number,
): T[] {
  if (scenes.length === 0) return scenes;
  const rawTotal = scenes.reduce((sum, scene) => sum + Math.max(1, Number(scene.duration_seconds) || 1), 0);
  let remaining = targetDurationSeconds;
  const normalized = scenes.map((scene, index) => {
    const slotsAfter = scenes.length - index - 1;
    if (slotsAfter === 0) {
      return { ...scene, duration_seconds: Math.max(1, remaining) };
    }
    const proportional = Math.round((Math.max(1, scene.duration_seconds) / rawTotal) * targetDurationSeconds);
    const duration = Math.max(1, Math.min(proportional, remaining - slotsAfter));
    remaining -= duration;
    return { ...scene, duration_seconds: duration };
  });
  return normalized;
}

export function isSupportedPromoVideoOption(input: {
  goal: string;
  duration_seconds: number;
  aspect_ratio: string;
  style: string;
  visual_mode?: string;
  voice_mode: string;
}): boolean {
  return (PROMO_VIDEO_GOALS as readonly string[]).includes(input.goal)
    && (PROMO_VIDEO_DURATIONS as readonly number[]).includes(input.duration_seconds)
    && (PROMO_VIDEO_ASPECT_RATIOS as readonly string[]).includes(input.aspect_ratio)
    && (PROMO_VIDEO_STYLES as readonly string[]).includes(input.style)
    && (!input.visual_mode || (PROMO_VIDEO_VISUAL_MODES as readonly string[]).includes(input.visual_mode))
    && (PROMO_VIDEO_VOICE_MODES as readonly string[]).includes(input.voice_mode);
}

export function normalizePromoVideoVoiceMode(value: string | null | undefined): PromoVideoVoiceMode {
  if (value === 'supertonic') return 'supertonic';
  if (value === 'founder_avatar') return 'founder_avatar';
  return 'deepgram';
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function normalizePromoVideoAiUsage(value: unknown): PromoVideoAiUsage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const entries = Array.isArray(raw.entries)
    ? raw.entries
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
      .map((entry) => ({
        stage: String(entry.stage ?? 'unknown'),
        model: String(entry.model ?? 'unknown'),
        input_tokens: Number(entry.input_tokens ?? 0),
        output_tokens: Number(entry.output_tokens ?? 0),
        total_tokens: Number(entry.total_tokens ?? 0),
        is_estimate: entry.is_estimate !== false,
        success: typeof entry.success === 'boolean' ? entry.success : undefined,
        created_at: String(entry.created_at ?? new Date().toISOString()),
      }))
    : [];

  const inputTokens = Number(raw.input_tokens ?? entries.reduce((sum, entry) => sum + entry.input_tokens, 0));
  const outputTokens = Number(raw.output_tokens ?? entries.reduce((sum, entry) => sum + entry.output_tokens, 0));
  return {
    llm_calls: Number(raw.llm_calls ?? entries.length),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: Number(raw.total_tokens ?? inputTokens + outputTokens),
    is_estimate: raw.is_estimate !== false,
    entries,
  };
}

export function mapPromoVideoJob(
  row: typeof promoVideoJobs.$inferSelect,
  options: { includeCaptureAssets?: boolean } = {},
): PromoVideoJob {
  return {
    id: row.id,
    company_id: row.company_id,
    task_id: row.task_id,
    status: row.status as PromoVideoStatus,
    goal: row.goal as PromoVideoGoal,
    duration_seconds: row.duration_seconds as PromoVideoDuration,
    aspect_ratio: row.aspect_ratio as PromoVideoAspectRatio,
    style: row.style as PromoVideoStyle,
    visual_mode: row.visual_mode as PromoVideoVisualMode,
    voice_mode: normalizePromoVideoVoiceMode(row.voice_mode),
    cta: row.cta,
    brief: (row.brief ?? null) as Record<string, unknown> | null,
    storyboard: (row.storyboard ?? null) as PromoVideoStoryboard | null,
    capture_assets: options.includeCaptureAssets
      ? (row.capture_assets ?? null) as PromoVideoCaptureAsset[] | null
      : undefined,
    ai_usage: normalizePromoVideoAiUsage(row.ai_usage),
    preview_key: row.preview_key,
    preview_url: row.preview_url,
    audio_key: row.audio_key,
    audio_url: row.audio_url,
    output_key: row.output_key,
    output_url: row.output_url,
    thumbnail_key: row.thumbnail_key,
    thumbnail_url: row.thumbnail_url,
    error_message: row.error_message,
    created_at: toIso(row.created_at) ?? new Date().toISOString(),
    updated_at: toIso(row.updated_at),
    completed_at: toIso(row.completed_at),
  };
}

export async function listPromoVideoJobs(companyId: string, limit = 20): Promise<PromoVideoJob[]> {
  const rows = await db.select()
    .from(promoVideoJobs)
    .where(eq(promoVideoJobs.company_id, companyId))
    .orderBy(desc(promoVideoJobs.created_at))
    .limit(limit);

  return rows.map((row) => mapPromoVideoJob(row));
}

export async function getPromoVideoJobByTaskId(taskId: string): Promise<PromoVideoJob | null> {
  const [row] = await db.select()
    .from(promoVideoJobs)
    .where(eq(promoVideoJobs.task_id, taskId))
    .limit(1);

  return row ? mapPromoVideoJob(row, { includeCaptureAssets: true }) : null;
}
