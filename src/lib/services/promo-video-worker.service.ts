import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, companies, documents, promoVideoJobs } from '@/lib/db';
import * as eventService from '@/lib/services/event.service';
import { isDeepgramConfigured, textToSpeech as deepgramTextToSpeech } from '@/lib/services/deepgram.service';
import { founderAvatarTextToSpeech, isFounderAvatarVoiceConfigured } from '@/lib/services/heygen-voice.service';
import { isSupertonicConfigured, textToSpeech as supertonicTextToSpeech } from '@/lib/services/supertonic.service';
import { takeScreenshot } from '@/lib/services/screenshot.service';
import { uploadFile } from '@/lib/services/storage.service';
import { callSmallLLMJson } from '@/lib/services/onboarding/shared/json-mode';
import { createLogger } from '@/lib/logger';
import {
  getPromoVideoDimensions,
  getDefaultPromoVideoCta,
  normalizeSceneDurations,
  PROMO_VIDEO_ASPECT_LABELS,
  PROMO_VIDEO_GOAL_LABELS,
  PROMO_VIDEO_STATUS_LABELS,
  PROMO_VIDEO_STYLE_LABELS,
  PROMO_VIDEO_VISUAL_MODE_LABELS,
  PROMO_VIDEO_VOICE_LABELS,
  normalizePromoVideoVoiceMode,
  resolvePromoVideoLiveUrl,
} from './promo-video-core.service';
import type {
  PromoVideoAiUsage,
  PromoVideoAiUsageEntry,
  PromoVideoAspectRatio,
  PromoVideoCaptureAsset,
  PromoVideoFocusRect,
  PromoVideoGoal,
  PromoVideoPoint,
  PromoVideoScene,
  PromoVideoStatus,
  PromoVideoStoryboard,
  PromoVideoStyle,
  PromoVideoVisualMode,
  PromoVideoVoiceMode,
  Task,
} from '@/types';

const log = createLogger('PromoVideoWorker');
const FPS = 30;

type PromoVideoJobRow = typeof promoVideoJobs.$inferSelect;

interface PromoVideoExecutionResult {
  log: Record<string, unknown>[];
  phase: 'preview' | 'final';
  outputUrl: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
}

interface VoiceoverAsset {
  url: string;
  key: string | null;
  provider: VoiceoverProvider;
}

type VoiceoverProvider = 'deepgram' | 'supertonic' | 'founder_avatar';

interface ProductBrief {
  companyName: string;
  oneLiner: string | null;
  originalIdea: string | null;
  liveUrl: string;
  goal: PromoVideoGoal;
  durationSeconds: number;
  aspectRatio: PromoVideoAspectRatio;
  style: PromoVideoStyle;
  visualMode: PromoVideoVisualMode;
  voiceMode: PromoVideoVoiceMode;
  cta: string;
  documents: Array<{ title: string; type: string; excerpt: string }>;
}

interface PageCaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageCaptureAction {
  text: string;
  rect: PageCaptureRect;
}

interface PageCaptureSection {
  tag: string;
  text: string;
  summary: string;
  buttons: string[];
  actions: PageCaptureAction[];
  rect: PageCaptureRect;
  y: number;
  height: number;
}

interface PageCaptureSignals {
  title: string;
  description: string;
  h1: string;
  sections: PageCaptureSection[];
  actions: PageCaptureAction[];
}

interface CaptureStop {
  id: string;
  label: string;
  y: number;
  primaryText?: string;
  summary?: string;
  buttons?: string[];
  focusRect?: PageCaptureRect;
  cursorTarget?: PageCaptureRect;
  shotType?: PromoVideoCaptureAsset['shotType'];
  clickText?: string;
}

type StoryboardCandidateScene = {
  id?: string;
  duration_seconds: number;
  headline: string;
  caption: string;
  narration: string;
  asset_ref?: string | null;
  motion: PromoVideoScene['motion'];
  scene_type?: PromoVideoScene['scene_type'];
  callout?: string | null;
  cta?: string | null;
};

const storyboardSchema = z.object({
  title: z.string().min(1).max(120),
  scenes: z.array(z.object({
    duration_seconds: z.coerce.number().int().min(1).max(30),
    headline: z.string().min(1).max(80),
    caption: z.string().min(1).max(160),
    narration: z.string().min(1).max(280),
    asset_ref: z.string().nullable().optional(),
    motion: z.enum(['push', 'pan', 'zoom', 'hold', 'reveal']).default('hold'),
    scene_type: z.enum(['hook', 'pain', 'product_reveal', 'walkthrough', 'benefit', 'proof', 'cta']).optional(),
    callout: z.string().max(90).nullable().optional(),
    cta: z.string().max(120).nullable().optional(),
  })).min(3).max(8),
});

const INTERNAL_VIDEO_LANGUAGE_PATTERNS = [
  /\bremotion\b/i,
  /\br2\b/i,
  /\bbrowserbase\b/i,
  /\bscreenshotone\b/i,
  /\bffmpeg\b/i,
  /\bdeepgram\b/i,
  /\bsupertonic\b/i,
  /\bsupertone\b/i,
  /\bheygen\b/i,
  /\bfounder avatar voice\b/i,
  /\bworkers?\b/i,
  /\btasks?\b/i,
  /\bpipelines?\b/i,
  /\brender(?:ed|ing|er|s)?\b/i,
  /\bscreenshots?\b/i,
  /\bcaptured assets?\b/i,
  /\bproduct captures?\b/i,
  /\bmedia storage\b/i,
  /\bmp4\b/i,
  /\bthumbnails?\b/i,
  /\bapi keys?\b/i,
  /\btemplates?\b/i,
  /\bstock footage\b/i,
  /\bhow (?:this|the) video\b/i,
  /\bthis video was generated\b/i,
];

function estimateNarrationSeconds(value: string): number {
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 1;
  return Math.ceil(words / 2.35) + 1;
}

function fitSceneDurationsToNarration(scenes: PromoVideoScene[], targetDurationSeconds: number): PromoVideoScene[] {
  if (scenes.length === 0) return scenes;
  const minDurations = scenes.map((scene) => Math.min(18, Math.max(2, estimateNarrationSeconds(scene.narration))));
  const minimumTotal = minDurations.reduce((sum, duration) => sum + duration, 0);
  if (minimumTotal >= targetDurationSeconds) {
    return normalizeSceneDurations(
      scenes.map((scene, index) => ({ ...scene, duration_seconds: minDurations[index] ?? scene.duration_seconds })),
      targetDurationSeconds,
    );
  }

  const extra = targetDurationSeconds - minimumTotal;
  const requestedTotal = scenes.reduce((sum, scene) => sum + Math.max(1, scene.duration_seconds), 0);
  let remainingExtra = extra;
  return scenes.map((scene, index) => {
    const slotsAfter = scenes.length - index - 1;
    const requestedShare = Math.round((Math.max(1, scene.duration_seconds) / requestedTotal) * extra);
    const sceneExtra = slotsAfter === 0 ? remainingExtra : Math.min(Math.max(0, requestedShare), remainingExtra);
    remainingExtra -= sceneExtra;
    return { ...scene, duration_seconds: (minDurations[index] ?? 2) + sceneExtra };
  });
}

function hasInternalVideoLanguage(value: string | null | undefined, brief: ProductBrief): boolean {
  if (!value) return false;
  if (brief.companyName.trim().toLowerCase() !== 'baljia' && /\bbaljia\b/i.test(value)) return true;
  return INTERNAL_VIDEO_LANGUAGE_PATTERNS.some((pattern) => pattern.test(value));
}

function storyboardHasInternalVideoLanguage(storyboard: PromoVideoStoryboard, brief: ProductBrief): boolean {
  if (hasInternalVideoLanguage(storyboard.title, brief)) return true;
  return storyboard.scenes.some((scene) => [
    scene.headline,
    scene.caption,
    scene.narration,
    scene.callout,
    scene.cta,
  ].some((value) => hasInternalVideoLanguage(value, brief)));
}

function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/access_key=[^&\s]+/gi, 'access_key=[redacted]')
    .replace(/api[_-]?key[=:]\s*[^,\s]+/gi, 'api_key=[redacted]')
    .slice(0, 600) || 'Promo video generation failed.';
}

function estimateLlmTokens(value: string): number {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return 0;
  return Math.ceil(compact.length / 4);
}

function normalizeAiUsage(value: unknown): PromoVideoAiUsage {
  if (!value || typeof value !== 'object') {
    return {
      llm_calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      is_estimate: true,
      entries: [],
    };
  }

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

async function appendAiUsage(
  job: PromoVideoJobRow,
  entry: Omit<PromoVideoAiUsageEntry, 'created_at' | 'total_tokens' | 'is_estimate'>,
): Promise<void> {
  const current = normalizeAiUsage(job.ai_usage);
  const nextEntry: PromoVideoAiUsageEntry = {
    ...entry,
    total_tokens: entry.input_tokens + entry.output_tokens,
    is_estimate: true,
    created_at: new Date().toISOString(),
  };
  const entries = [...current.entries, nextEntry];
  const inputTokens = entries.reduce((sum, item) => sum + item.input_tokens, 0);
  const outputTokens = entries.reduce((sum, item) => sum + item.output_tokens, 0);
  const usage: PromoVideoAiUsage = {
    llm_calls: entries.length,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    is_estimate: true,
    entries,
  };

  await db.update(promoVideoJobs)
    .set({ ai_usage: usage as unknown as Record<string, unknown>, updated_at: new Date() })
    .where(eq(promoVideoJobs.id, job.id));
}

async function emitPromoEvent(
  companyId: string,
  eventType: 'promo_video_progress' | 'promo_video_completed' | 'promo_video_failed',
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await eventService.emit(companyId, eventType, payload);
  } catch (error) {
    log.warn('Promo video event emit failed', {
      companyId,
      eventType,
      error: friendlyError(error),
    });
  }
}

async function updateJob(
  job: PromoVideoJobRow,
  status: PromoVideoStatus,
  patch: Partial<typeof promoVideoJobs.$inferInsert> = {},
): Promise<PromoVideoJobRow> {
  const [updated] = await db.update(promoVideoJobs)
    .set({
      ...patch,
      status,
      updated_at: new Date(),
      completed_at: status === 'ready' || status === 'failed' ? new Date() : patch.completed_at,
    })
    .where(eq(promoVideoJobs.id, job.id))
    .returning();

  await emitPromoEvent(job.company_id, status === 'failed' ? 'promo_video_failed' : 'promo_video_progress', {
    job_id: job.id,
    task_id: job.task_id,
    status,
    label: PROMO_VIDEO_STATUS_LABELS[status],
  });

  return updated;
}

async function loadCompanyAndDocs(companyId: string): Promise<{
  company: {
    name: string;
    slug: string;
    one_liner: string | null;
    original_idea: string | null;
    subdomain: string | null;
    custom_domain: string | null;
  };
  docs: Array<{ title: string | null; doc_type: string; content: string | null }>;
}> {
  const [company] = await db.select({
    name: companies.name,
    slug: companies.slug,
    one_liner: companies.one_liner,
    original_idea: companies.original_idea,
    subdomain: companies.subdomain,
    custom_domain: companies.custom_domain,
  })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) throw new Error('Company not found for promo video job.');

  const docs = await db.select({
    title: documents.title,
    doc_type: documents.doc_type,
    content: documents.content,
  })
    .from(documents)
    .where(eq(documents.company_id, companyId))
    .limit(8);

  return {
    company,
    docs: docs.filter((doc) => !/code_graph|codebase_map|internal|deploy|repo|schema/i.test(`${doc.doc_type} ${doc.title ?? ''}`)),
  };
}

async function captureProductAssets(
  job: PromoVideoJobRow,
  liveUrl: string,
): Promise<PromoVideoCaptureAsset[]> {
  const dimensions = getPromoVideoDimensions(job.aspect_ratio as PromoVideoAspectRatio);
  const localAssets = await captureProductAssetsWithPlaywright(job, liveUrl, dimensions).catch((error) => {
    log.warn('Local product capture failed, trying screenshot service fallback', { jobId: job.id, error: friendlyError(error) });
    return null;
  });
  if (localAssets?.some((asset) => asset.url)) return localAssets;

  const screenshot = await takeScreenshot({
    url: liveUrl,
    viewportWidth: Math.min(dimensions.width, 1440),
    viewportHeight: Math.min(dimensions.height, 1800),
    fullPage: false,
    format: 'png',
    delay: 2500,
    blockAds: true,
  }).catch((error) => {
    log.warn('Primary product screenshot failed', { jobId: job.id, error: friendlyError(error) });
    return null;
  });

  const screenshotUrl = screenshot?.url ?? null;
  return [
    { id: 'hero', label: 'Landing hero', kind: screenshotUrl ? 'screenshot' : 'fallback', url: screenshotUrl, width: dimensions.width, height: dimensions.height, summary: 'Landing page hero and product promise.' },
    { id: 'feature', label: 'Main feature screen', kind: screenshotUrl ? 'screenshot' : 'fallback', url: screenshotUrl, width: dimensions.width, height: dimensions.height, summary: 'Primary feature screen.' },
    { id: 'proof', label: 'Proof/result section', kind: screenshotUrl ? 'screenshot' : 'fallback', url: screenshotUrl, width: dimensions.width, height: dimensions.height, summary: 'Proof, benefits, or results section.' },
    { id: 'cta', label: 'Final CTA', kind: screenshotUrl ? 'screenshot' : 'fallback', url: screenshotUrl, width: dimensions.width, height: dimensions.height, summary: 'Final call to action.' },
  ];
}

function captureViewport(dimensions: { width: number; height: number }): { width: number; height: number } {
  const ratio = dimensions.width / dimensions.height;
  if (ratio > 1.4) return { width: 1440, height: 810 };
  if (ratio < 0.8) return { width: 1080, height: 1800 };
  return { width: 1080, height: 1080 };
}

function compactText(value: string | null | undefined, maxLength = 180): string {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  const slice = clean.slice(0, maxLength + 1);
  const lastSpace = slice.lastIndexOf(' ');
  return `${slice.slice(0, lastSpace > 60 ? lastSpace : maxLength).trim()}...`;
}

function uniqueShortValues(values: string[], maxItems = 5): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = compactText(value, 48);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isPageCaptureRect(value: PageCaptureRect | undefined | null): value is PageCaptureRect {
  return Boolean(
    value
      && Number.isFinite(value.x)
      && Number.isFinite(value.y)
      && Number.isFinite(value.width)
      && Number.isFinite(value.height)
      && value.width > 0
      && value.height > 0,
  );
}

function normalizeRectForViewport(
  rect: PageCaptureRect | undefined,
  scrollY: number,
  viewport: { width: number; height: number },
): PromoVideoFocusRect | undefined {
  if (!isPageCaptureRect(rect)) return undefined;
  const left = Math.max(0, Math.min(viewport.width, rect.x));
  const top = Math.max(0, Math.min(viewport.height, rect.y - scrollY));
  const right = Math.max(0, Math.min(viewport.width, rect.x + rect.width));
  const bottom = Math.max(0, Math.min(viewport.height, rect.y - scrollY + rect.height));
  const width = right - left;
  const height = bottom - top;
  if (width < 12 || height < 10) return undefined;
  return {
    x: clamp01(left / viewport.width),
    y: clamp01(top / viewport.height),
    width: clamp01(width / viewport.width),
    height: clamp01(height / viewport.height),
  };
}

function normalizePointForViewport(
  rect: PageCaptureRect | undefined,
  scrollY: number,
  viewport: { width: number; height: number },
): PromoVideoPoint | undefined {
  if (!isPageCaptureRect(rect)) return undefined;
  return {
    x: clamp01((rect.x + rect.width / 2) / viewport.width),
    y: clamp01((rect.y - scrollY + rect.height / 2) / viewport.height),
  };
}

function centerOfFocusRect(rect: PromoVideoFocusRect | undefined): PromoVideoPoint | undefined {
  if (!rect) return undefined;
  return {
    x: clamp01(rect.x + rect.width / 2),
    y: clamp01(rect.y + rect.height / 2),
  };
}

function sectionCorpus(section: PageCaptureSection): string {
  return `${section.text} ${section.summary} ${section.buttons.join(' ')}`.toLowerCase();
}

function scoreSection(section: PageCaptureSection, patterns: RegExp[]): number {
  const corpus = sectionCorpus(section);
  return patterns.reduce((score, pattern) => score + (pattern.test(corpus) ? 1 : 0), 0);
}

function findSemanticSection(
  signals: PageCaptureSignals,
  patterns: RegExp[],
  options: { prefer?: 'first' | 'last'; minY?: number } = {},
): PageCaptureSection | null {
  const scored = signals.sections
    .filter((section) => section.y >= (options.minY ?? 0))
    .map((section) => ({ section, score: scoreSection(section, patterns) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return options.prefer === 'last' ? b.section.y - a.section.y : a.section.y - b.section.y;
    });
  return scored[0]?.section ?? null;
}

function labelFromSection(prefix: string, section: PageCaptureSection | null, fallback: string): string {
  const text = compactText(section?.text, 64);
  return text ? `${prefix}: ${text}` : fallback;
}

const PRIMARY_ACTION_PATTERNS = [
  /\bbrowse listings?\b/i,
  /\bbook sessions?\b/i,
  /\bbook\b/i,
  /\bget started\b/i,
  /\btry\b/i,
  /\bstart\b/i,
];

const BOOKING_ACTION_PATTERNS = [
  /\bbook\b/i,
  /\bbrowse\b/i,
  /\bsession\b/i,
  /\bslot\b/i,
  /\bschedule\b/i,
  /\breserve\b/i,
  /\bget started\b/i,
  /\bstart\b/i,
  /\btry\b/i,
];

const WORKFLOW_ACTION_PATTERNS = [
  /\bcreate\b/i,
  /\blisting\b/i,
  /\bavailability\b/i,
  /\bapprove\b/i,
  /\bmanage\b/i,
  /\bslot\b/i,
  /\bsubscribe\b/i,
  /\bdashboard\b/i,
];

const CTA_ACTION_PATTERNS = [
  /\bget started\b/i,
  /\bsign up\b/i,
  /\bbook\b/i,
  /\bstart\b/i,
  /\btry\b/i,
  /\bjoin\b/i,
];

function findBestAction(actions: PageCaptureAction[], patterns: RegExp[]): PageCaptureAction | null {
  const scored = actions
    .map((action, index) => ({
      action,
      index,
      score: patterns.reduce((score, pattern) => score + (pattern.test(action.text) ? 1 : 0), 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.action ?? null;
}

function captureStopFromSection(
  id: string,
  labelPrefix: string,
  section: PageCaptureSection | null,
  fallback: { label: string; y: number; summary?: string },
  options: {
    actionPatterns?: RegExp[];
    fallbackActions?: PageCaptureAction[];
    shotType?: PromoVideoCaptureAsset['shotType'];
  } = {},
): CaptureStop {
  const primaryText = compactText(section?.text, 96);
  const summary = compactText(section?.summary ?? fallback.summary, 220);
  const action = options.actionPatterns
    ? findBestAction([
      ...(section?.actions ?? []),
      ...(options.fallbackActions ?? []),
    ], options.actionPatterns)
    : null;
  const focusRect = action?.rect ?? section?.rect;
  return {
    id,
    label: labelFromSection(labelPrefix, section, fallback.label),
    y: section?.y ?? fallback.y,
    primaryText: primaryText || undefined,
    summary: summary || undefined,
    buttons: uniqueShortValues([...(section?.buttons ?? []), action?.text ?? '']),
    focusRect,
    cursorTarget: action?.rect,
    shotType: options.shotType,
    clickText: action?.text,
  };
}

function buildSemanticCaptureStops(
  signals: PageCaptureSignals,
  maxScroll: number,
  viewport: { width: number; height: number },
): CaptureStop[] {
  const sections = signals.sections;
  const heroSection = sections.find((section) => /^h1$/i.test(section.tag)) ?? sections[0] ?? null;
  const actionSection = findSemanticSection(signals, [
    /\bbook\b/,
    /\bbrowse\b/,
    /\bschedule\b/,
    /\breserve\b/,
    /\bsession\b/,
    /\bget started\b/,
    /\bstart\b/,
    /\btry\b/,
    /\bsign up\b/,
  ]);
  const operatorSection = findSemanticSection(signals, [
    /\bvendor\b/,
    /\bprovider\b/,
    /\bseller\b/,
    /\blisting\b/,
    /\bavailability\b/,
    /\bapprove\b/,
    /\bmanage\b/,
    /\bdashboard\b/,
    /\bpayout\b/,
    /\banalytics\b/,
    /\bsubscription\b/,
  ]);
  const proofSection = findSemanticSection(signals, [
    /\bproof\b/,
    /\bcompare\b/,
    /\bcomparison\b/,
    /\btrust\b/,
    /\bvetted\b/,
    /\bverified\b/,
    /\brating\b/,
    /\breview\b/,
    /\btestimonial\b/,
    /\bresult\b/,
    /\bwhy\b/,
    /\bbenefit\b/,
    /\btraditional\b/,
  ], { minY: viewport.height * 0.35 });
  const ctaSection = findSemanticSection(signals, [
    /\bready\b/,
    /\bget started\b/,
    /\bsign up\b/,
    /\bbook\b/,
    /\bstart\b/,
    /\btry\b/,
    /\bcontact\b/,
    /\bjoin\b/,
    /\bdemo\b/,
  ], { prefer: 'last', minY: viewport.height * 0.45 });

  const rawStops = [
    captureStopFromSection('hero', 'Hero', heroSection, {
      label: 'Hero: product promise',
      y: 0,
      summary: signals.description || signals.h1 || signals.title,
    }, {
      actionPatterns: PRIMARY_ACTION_PATTERNS,
      fallbackActions: signals.actions,
      shotType: 'wide',
    }),
    captureStopFromSection('booking', 'Action', actionSection, {
      label: 'Action: primary customer flow',
      y: maxScroll * 0.25,
      summary: 'Primary product action and next step.',
    }, {
      actionPatterns: BOOKING_ACTION_PATTERNS,
      fallbackActions: signals.actions,
      shotType: 'click',
    }),
    captureStopFromSection('vendor_tools', 'Workflow', operatorSection, {
      label: 'Workflow: product tools',
      y: maxScroll * 0.5,
      summary: 'Product workflow and operator controls.',
    }, {
      actionPatterns: WORKFLOW_ACTION_PATTERNS,
      fallbackActions: signals.actions,
      shotType: 'focus',
    }),
    captureStopFromSection('proof', 'Proof', proofSection, {
      label: 'Proof: value and trust',
      y: maxScroll * 0.72,
      summary: 'Evidence, benefits, and reasons to trust the product.',
    }, {
      shotType: 'focus',
    }),
    captureStopFromSection('cta', 'CTA', ctaSection, {
      label: 'CTA: final next step',
      y: maxScroll,
      summary: 'Final call to action.',
    }, {
      actionPatterns: CTA_ACTION_PATTERNS,
      fallbackActions: signals.actions,
      shotType: 'cta',
    }),
  ];

  const stops: CaptureStop[] = [];
  const usedIds = new Set<string>();
  const usedY: number[] = [];
  for (const stop of rawStops) {
    if (usedIds.has(stop.id)) continue;
    let y = Math.max(0, Math.min(maxScroll, Math.round(stop.y - 96)));
    const canReuseNearbyViewport = stop.shotType === 'click' || stop.shotType === 'cta';
    while (!canReuseNearbyViewport && usedY.some((existing) => Math.abs(existing - y) < 180) && y < maxScroll) {
      y = Math.min(maxScroll, y + Math.round(Math.min(360, viewport.height * 0.28)));
    }
    usedIds.add(stop.id);
    usedY.push(y);
    stops.push({ ...stop, y });
  }

  if (stops.length >= 4) return stops;
  const fallbackStops = [
    { id: 'hero', label: 'Landing hero', ratio: 0 },
    { id: 'feature', label: 'Main feature screen', ratio: 0.32 },
    { id: 'proof', label: 'Proof/result section', ratio: 0.68 },
    { id: 'cta', label: 'Final CTA', ratio: 1 },
  ];
  for (const fallback of fallbackStops) {
    if (usedIds.has(fallback.id)) continue;
    stops.push({
      id: fallback.id,
      label: fallback.label,
      y: Math.round(maxScroll * fallback.ratio),
      shotType: fallback.id === 'cta' ? 'cta' : fallback.id === 'hero' ? 'wide' : 'focus',
    });
    if (stops.length >= 4) break;
  }
  return stops;
}

interface PlaywrightLikePage {
  evaluate<Result, Arg = unknown>(pageFunction: string | ((arg: Arg) => Result | Promise<Result>), arg?: Arg): Promise<Result>;
  waitForLoadState(state: 'domcontentloaded' | 'networkidle', options?: { timeout?: number }): Promise<void>;
  waitForTimeout(timeout: number): Promise<void>;
}

interface ProductCapturePage extends PlaywrightLikePage {
  reload(options?: { waitUntil?: 'domcontentloaded' | 'networkidle'; timeout?: number }): Promise<unknown>;
}

async function waitForProductPageReady(page: ProductCapturePage): Promise<void> {
  const deadline = Date.now() + 120_000;
  let reloads = 0;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
      const renderColdStart = /service waking up|application loading|incoming http request detected|start building on render today/i.test(text);
      const productSignals = document.querySelectorAll('h1,h2,h3,a,button,[role="button"]').length;
      return {
        textLength: text.length,
        renderColdStart,
        productSignals,
      };
    }).catch(() => ({ textLength: 0, renderColdStart: true, productSignals: 0 }));

    if (!state.renderColdStart && state.textLength > 40 && state.productSignals > 0) return;

    await page.waitForTimeout(5000);
    if (state.renderColdStart && reloads < 3) {
      reloads += 1;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    }
  }
}

async function preparePageForPromoCapture(page: PlaywrightLikePage): Promise<void> {
  await page.evaluate(() => {
    const styleId = 'baljia-promo-capture-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        html { scroll-behavior: auto !important; }
        *:focus,
        *:focus-visible {
          outline: none !important;
          box-shadow: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }).catch(() => undefined);
}

function isSafeCaptureClick(label: string | undefined): boolean {
  const text = (label ?? '').toLowerCase();
  if (!text) return false;
  if (/\b(sign in|log in|login|checkout|payment|pay|billing|subscribe|delete|remove|cancel)\b/i.test(text)) return false;
  return /\b(browse|book|view|see|demo|try|get started|start|schedule|reserve)\b/i.test(text);
}

async function clickActionByText(page: PlaywrightLikePage, label: string | undefined): Promise<boolean> {
  const targetLabel = compactText(label, 80);
  if (!isSafeCaptureClick(targetLabel)) return false;
  return page.evaluate((text) => {
    const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 20
        && rect.height > 12
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && Number(style.opacity || '1') > 0.05;
    };
    const textLower = text.toLowerCase();
    const candidates = Array.from(document.querySelectorAll('a,button,[role="button"]'))
      .filter(isVisible)
      .filter((element) => clean(element.textContent).toLowerCase().includes(textLower));
    const target = candidates[0] as HTMLElement | undefined;
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const alreadyInView = rect.top >= 0
      && rect.left >= 0
      && rect.bottom <= window.innerHeight
      && rect.right <= window.innerWidth;
    if (!alreadyInView) {
      target.scrollIntoView({ block: 'center', inline: 'center' });
    }
    target.click();
    return true;
  }, targetLabel).catch(() => false);
}

async function captureProductAssetsWithPlaywright(
  job: PromoVideoJobRow,
  liveUrl: string,
  dimensions: { width: number; height: number },
): Promise<PromoVideoCaptureAsset[]> {
  const { chromium } = await runtimeImport<typeof import('@playwright/test')>('@playwright/test');
  const viewport = captureViewport(dimensions);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: 1,
      colorScheme: 'light',
    });
    await page.goto(liveUrl, { waitUntil: 'networkidle', timeout: 45_000 }).catch(async () => {
      await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    });
    await page.waitForTimeout(1500);
    await waitForProductPageReady(page);
    await preparePageForPromoCapture(page);

    const pageHeight = await page.evaluate(() => Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      window.innerHeight,
    ));
    const maxScroll = Math.max(0, pageHeight - viewport.height);
    const signals = await page.evaluate(`(() => {
      const clean = (value, maxLength = 500) => {
        const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
        return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() + '...' : normalized;
      };
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 20
          && rect.height > 12
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && Number(style.opacity || '1') > 0.05;
      };
      const rectFor = (element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: Math.max(0, rect.left + window.scrollX),
          y: Math.max(0, rect.top + window.scrollY),
          width: Math.max(0, rect.width),
          height: Math.max(0, rect.height),
        };
      };
      const readActions = (root) => Array.from(root.querySelectorAll('a,button,[role="button"]'))
        .filter(isVisible)
        .map((element) => ({
          text: clean(element.textContent, 80),
          rect: rectFor(element),
        }))
        .filter((action) => action.text)
        .slice(0, 8);
      const sectionFor = (heading) => heading.closest('section, article, main > div, [data-section], [role="region"]')
        ?? heading.parentElement
        ?? heading;
      const headingSections = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]'))
        .filter(isVisible)
        .map((heading) => {
          const root = sectionFor(heading);
          const rect = root.getBoundingClientRect();
          const headingRect = heading.getBoundingClientRect();
          const actions = readActions(root);
          return {
            tag: heading.tagName.toLowerCase(),
            text: clean(heading.textContent, 140),
            summary: clean(root.innerText || root.textContent, 420),
            buttons: actions.map((action) => action.text),
            actions,
            rect: {
              x: Math.max(0, headingRect.left + window.scrollX),
              y: Math.max(0, headingRect.top + window.scrollY),
              width: Math.max(0, headingRect.width),
              height: Math.max(0, headingRect.height),
            },
            y: Math.max(0, headingRect.top + window.scrollY),
            height: Math.max(0, rect.height),
          };
        })
        .filter((section) => section.text || section.summary);
      const actionRows = Array.from(document.querySelectorAll('a,button,[role="button"]'))
        .filter(isVisible)
        .map((element) => ({
          text: clean(element.textContent, 80),
          rect: rectFor(element),
        }))
        .filter((action) => action.text);
      const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
      return {
        title: clean(document.title, 120),
        description: clean(metaDescription, 220),
        h1: headingSections.find((section) => section.tag === 'h1')?.text ?? '',
        sections: headingSections,
        actions: actionRows.slice(0, 40),
      };
    })()`) as PageCaptureSignals;
    const stops = buildSemanticCaptureStops(signals, maxScroll, viewport);

    const assets: PromoVideoCaptureAsset[] = [];
    for (const stop of stops) {
      await page.evaluate((scrollY) => window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' }), stop.y);
      await page.waitForTimeout(850);
      let didClick = false;
      if (stop.shotType === 'click' && stop.clickText) {
        didClick = await clickActionByText(page, stop.clickText);
        if (didClick) {
          await page.waitForLoadState('networkidle', { timeout: 3500 }).catch(() => undefined);
          await page.waitForTimeout(700);
        }
      }
      await preparePageForPromoCapture(page);
      const actualScrollY = await page.evaluate(() => window.scrollY).catch(() => stop.y);
      const focusRect = normalizeRectForViewport(stop.focusRect, actualScrollY, viewport);
      const cursorTarget = normalizePointForViewport(stop.cursorTarget, actualScrollY, viewport) ?? centerOfFocusRect(focusRect);
      const content = await page.screenshot({ type: 'png', fullPage: false });
      const upload = await uploadFile({
        companyId: job.company_id,
        category: 'media',
        filename: `promo-video-${job.id}-${stop.id}.png`,
        content,
        contentType: 'image/png',
        isPublic: true,
      });
      assets.push({
        id: stop.id,
        label: stop.label,
        kind: 'screenshot',
        url: upload.publicUrl ?? upload.url,
        width: viewport.width,
        height: viewport.height,
        primaryText: stop.primaryText,
        summary: stop.summary,
        buttons: stop.buttons,
        focusRect,
        cursorTarget,
        shotType: didClick ? 'click' : stop.shotType,
      });
    }

    return assets;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function buildBrief(
  company: Awaited<ReturnType<typeof loadCompanyAndDocs>>['company'],
  docs: Awaited<ReturnType<typeof loadCompanyAndDocs>>['docs'],
  job: PromoVideoJobRow,
  liveUrl: string,
): ProductBrief {
  return {
    companyName: company.name,
    oneLiner: company.one_liner,
    originalIdea: company.original_idea,
    liveUrl,
    goal: job.goal as PromoVideoGoal,
    durationSeconds: job.duration_seconds,
    aspectRatio: job.aspect_ratio as PromoVideoAspectRatio,
    style: job.style as PromoVideoStyle,
    visualMode: job.visual_mode as PromoVideoVisualMode,
    voiceMode: normalizePromoVideoVoiceMode(job.voice_mode),
    cta: getDefaultPromoVideoCta(job.goal as PromoVideoGoal, company.name, job.cta),
    documents: docs
      .filter((doc) => doc.content?.trim())
      .slice(0, 5)
      .map((doc) => ({
        title: doc.title ?? doc.doc_type,
        type: doc.doc_type,
        excerpt: doc.content!.replace(/\s+/g, ' ').slice(0, 700),
      })),
  };
}

function fallbackDurations(total: number): number[] {
  if (total === 15) return [4, 6, 5];
  if (total === 30) return [5, 6, 7, 6, 6];
  if (total === 60) return [8, 10, 12, 10, 10, 10];
  return [12, 16, 18, 16, 14, 14];
}

function assetById(assets: PromoVideoCaptureAsset[], id: string): PromoVideoCaptureAsset | null {
  return assets.find((asset) => asset.id === id) ?? null;
}

function pickAsset(assets: PromoVideoCaptureAsset[], ids: string[]): PromoVideoCaptureAsset | null {
  for (const id of ids) {
    const asset = assetById(assets, id);
    if (asset) return asset;
  }
  return assets.find((asset) => asset.url) ?? assets[0] ?? null;
}

function assetText(asset: PromoVideoCaptureAsset | null): string {
  return [asset?.label, asset?.primaryText, asset?.summary, ...(asset?.buttons ?? [])]
    .filter(Boolean)
    .join(' ');
}

function actionFromAsset(asset: PromoVideoCaptureAsset | null, fallback: string): string {
  return compactText(asset?.buttons?.[0] ?? asset?.primaryText ?? fallback, 42);
}

function isNoisyCapturedText(value: string | null | undefined): boolean {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  return /\b(job ite|afety|e timate|chedu|tatu|con truct|tart|fir t)\b/i.test(text)
    || /,[^\s]/.test(text);
}

function captionFromAsset(asset: PromoVideoCaptureAsset | null, fallback: string): string {
  const raw = asset?.summary ?? asset?.primaryText;
  return compactText(isNoisyCapturedText(raw) ? fallback : raw, 145);
}

function headlineFromAsset(asset: PromoVideoCaptureAsset | null, fallback: string): string {
  const raw = asset?.primaryText ?? asset?.label?.replace(/^[^:]+:\s*/, '') ?? fallback;
  return compactText(isNoisyCapturedText(raw) ? fallback : raw, 52);
}

function isBookingMarketplaceBrief(brief: ProductBrief, assets: PromoVideoCaptureAsset[]): boolean {
  const corpus = [
    brief.companyName,
    brief.oneLiner,
    brief.originalIdea,
    brief.documents.map((doc) => doc.excerpt).join(' '),
    assets.map(assetText).join(' '),
  ].filter(Boolean).join(' ').toLowerCase();
  return /\b(tutor|booking|book|session|marketplace|vendor|availability|listing)\b/.test(corpus);
}

function makeFallbackScene(input: {
  id: string;
  duration: number;
  headline: string;
  caption: string;
  narration: string;
  asset: PromoVideoCaptureAsset | null;
  motion: PromoVideoScene['motion'];
  sceneType: NonNullable<PromoVideoScene['scene_type']>;
  callout: string;
  cta?: string;
}): PromoVideoScene {
  return {
    id: input.id,
    duration_seconds: input.duration,
    headline: compactText(input.headline, 74),
    caption: compactText(input.caption, 154),
    narration: compactText(input.narration, 270),
    asset_ref: input.asset?.id ?? null,
    motion: input.motion,
    scene_type: input.sceneType,
    callout: compactText(input.callout, 86),
    cta: input.cta ? compactText(input.cta, 116) : undefined,
  };
}

function fallbackStoryboard(brief: ProductBrief, assets: PromoVideoCaptureAsset[]): PromoVideoStoryboard {
  const rawPositioning = brief.oneLiner ?? brief.originalIdea ?? `${brief.companyName} helps customers get results faster.`;
  const positioning = hasInternalVideoLanguage(rawPositioning, brief)
    ? `${brief.companyName} helps customers get results faster.`
    : rawPositioning;
  const durations = fallbackDurations(brief.durationSeconds);
  const hero = pickAsset(assets, ['hero']);
  const booking = pickAsset(assets, ['booking', 'feature', 'hero']);
  const workflow = pickAsset(assets, ['vendor_tools', 'feature', 'booking']);
  const proof = pickAsset(assets, ['proof', 'vendor_tools', 'feature']);
  const cta = pickAsset(assets, ['cta', 'hero']);
  const isBookingMarketplace = isBookingMarketplaceBrief(brief, assets);

  const introScenes: PromoVideoScene[] = isBookingMarketplace
    ? [
        makeFallbackScene({
          id: 'scene_1',
          duration: durations[0] ?? 5,
          headline: 'Book expert help faster',
          caption: captionFromAsset(hero, positioning),
          narration: `${brief.companyName} opens with a clear promise: find expert help and book it on your schedule.`,
          asset: hero,
          motion: 'push',
          sceneType: 'hook',
          callout: actionFromAsset(hero, 'Browse listings'),
        }),
        makeFallbackScene({
          id: 'scene_2',
          duration: durations[1] ?? 6,
          headline: 'Pick the right expert',
          caption: captionFromAsset(booking, 'Visitors can compare specialists, see available times, and choose a session.'),
          narration: 'Customers can move from browsing to booking without the usual back-and-forth.',
          asset: booking,
          motion: 'pan',
          sceneType: 'walkthrough',
          callout: actionFromAsset(booking, 'Book session'),
        }),
        makeFallbackScene({
          id: 'scene_3',
          duration: durations[2] ?? 7,
          headline: 'Run the marketplace',
          caption: captionFromAsset(workflow, 'Operators can manage listings, availability, approvals, and payouts.'),
          narration: 'Behind the customer flow, the marketplace gives operators the tools to manage supply and keep quality high.',
          asset: workflow,
          motion: 'zoom',
          sceneType: 'benefit',
          callout: actionFromAsset(workflow, 'Create listing'),
        }),
        makeFallbackScene({
          id: 'scene_4',
          duration: durations[3] ?? 6,
          headline: 'Make trust obvious',
          caption: captionFromAsset(proof, 'Comparison and proof sections make the value easy to understand.'),
          narration: 'Proof sections make the difference clear, from vetted experts to smoother booking and better marketplace control.',
          asset: proof,
          motion: 'reveal',
          sceneType: 'proof',
          callout: actionFromAsset(proof, 'Why it wins'),
        }),
      ]
    : [
        makeFallbackScene({
          id: 'scene_1',
          duration: durations[0] ?? 5,
          headline: headlineFromAsset(hero, `Meet ${brief.companyName}`),
          caption: compactText(positioning, 145),
          narration: `${brief.companyName} opens with a clear promise: ${compactText(positioning, 150)}`,
          asset: hero,
          motion: 'push',
          sceneType: 'hook',
          callout: actionFromAsset(hero, 'Clear promise'),
        }),
        makeFallbackScene({
          id: 'scene_2',
          duration: durations[1] ?? 6,
          headline: headlineFromAsset(booking, 'Start the flow'),
          caption: captionFromAsset(booking, 'The primary action is visible and easy to follow.'),
          narration: 'The demo moves into the core product flow, showing the action a customer is meant to take.',
          asset: booking,
          motion: 'pan',
          sceneType: 'walkthrough',
          callout: actionFromAsset(booking, 'Primary action'),
        }),
        makeFallbackScene({
          id: 'scene_3',
          duration: durations[2] ?? 7,
          headline: headlineFromAsset(workflow, 'See how it works'),
          caption: captionFromAsset(workflow, 'The product turns the promise into a usable workflow.'),
          narration: 'The next screen shows how the product turns that promise into a practical workflow.',
          asset: workflow,
          motion: 'zoom',
          sceneType: 'product_reveal',
          callout: actionFromAsset(workflow, 'Core workflow'),
        }),
        makeFallbackScene({
          id: 'scene_4',
          duration: durations[3] ?? 6,
          headline: headlineFromAsset(proof, 'Built for results'),
          caption: captionFromAsset(proof, 'Proof and benefit sections explain why the product matters.'),
          narration: 'The value becomes easier to trust when the page connects the workflow to clear outcomes.',
          asset: proof,
          motion: 'reveal',
          sceneType: 'proof',
          callout: actionFromAsset(proof, 'Outcome'),
        }),
      ];

  const resultScene = makeFallbackScene({
    id: 'scene_5',
    duration: durations[4] ?? 6,
    headline: isBookingMarketplace ? 'From interest to booking' : 'From interest to action',
    caption: isBookingMarketplace
      ? 'The page gives visitors a direct path from discovery to a booked session.'
      : 'The page gives visitors a direct path from interest to action.',
    narration: isBookingMarketplace
      ? `${brief.companyName} keeps the path simple: discover the right expert, pick a time, and book.`
      : `${brief.companyName} keeps the path focused from first impression to next step.`,
    asset: proof,
    motion: 'hold',
    sceneType: 'benefit',
    callout: isBookingMarketplace ? 'Book with confidence' : 'Clear next step',
  });
  const ctaScene = (id: string, duration: number): PromoVideoScene => makeFallbackScene({
    id,
    duration,
    headline: brief.cta,
    caption: captionFromAsset(cta, 'A simple next step moves visitors from interest to action.'),
    narration: `When the visitor is ready, the action is direct: ${brief.cta}.`,
    asset: cta,
    motion: 'hold',
    sceneType: 'cta',
    callout: actionFromAsset(cta, brief.cta),
    cta: brief.cta,
  });

  const rawScenes: PromoVideoScene[] = brief.durationSeconds === 15
    ? [introScenes[0], introScenes[1], ctaScene('scene_3', durations[2] ?? 5)]
    : brief.durationSeconds === 30
      ? [...introScenes, ctaScene('scene_5', durations[4] ?? 6)]
      : [...introScenes, resultScene, ctaScene('scene_6', durations[5] ?? 10)];

  const normalized = fitSceneDurationsToNarration(rawScenes, brief.durationSeconds);
  return {
    title: `${brief.companyName} promo`,
    duration_seconds: brief.durationSeconds as PromoVideoStoryboard['duration_seconds'],
    aspect_ratio: brief.aspectRatio,
    style: brief.style,
    scenes: normalized,
  };
}

function normalizeStoryboard(
  candidate: { title: string; scenes: StoryboardCandidateScene[] },
  brief: ProductBrief,
  assets: PromoVideoCaptureAsset[],
): PromoVideoStoryboard {
  const assetIds = new Set(assets.map((asset) => asset.id));
  const rawScenes = candidate.scenes.map((scene, index) => {
    const isFinalCta = scene.scene_type === 'cta' || index === candidate.scenes.length - 1;
    return {
      id: scene.id || `scene_${index + 1}`,
      duration_seconds: scene.duration_seconds,
      headline: scene.headline.slice(0, 80),
      caption: scene.caption.slice(0, 160),
      narration: scene.narration.slice(0, 280),
      asset_ref: scene.asset_ref && assetIds.has(scene.asset_ref) ? scene.asset_ref : assets[index % Math.max(assets.length, 1)]?.id ?? null,
      motion: scene.motion,
      scene_type: scene.scene_type,
      callout: scene.callout ? scene.callout.slice(0, 90) : undefined,
      cta: isFinalCta ? brief.cta.slice(0, 120) : scene.cta ? scene.cta.slice(0, 120) : undefined,
    };
  });

  return {
    title: candidate.title.slice(0, 120),
    duration_seconds: brief.durationSeconds as PromoVideoStoryboard['duration_seconds'],
    aspect_ratio: brief.aspectRatio,
    style: brief.style,
    scenes: fitSceneDurationsToNarration(rawScenes, brief.durationSeconds),
  };
}

async function buildStoryboard(
  job: PromoVideoJobRow,
  brief: ProductBrief,
  assets: PromoVideoCaptureAsset[],
): Promise<PromoVideoStoryboard> {
  const assetList = assets.map((asset) => [
    `${asset.id}: ${asset.label}`,
    asset.primaryText ? `  primary text: ${asset.primaryText}` : null,
    asset.summary ? `  visible summary: ${asset.summary}` : null,
    asset.buttons?.length ? `  visible actions: ${asset.buttons.join(', ')}` : null,
    asset.shotType ? `  suggested shot: ${asset.shotType}` : null,
    asset.cursorTarget ? '  has cursor target for a specific product action' : null,
  ].filter(Boolean).join('\n')).join('\n');
  const prompt = `Create an external-facing promo storyboard for the founder's product.

Company: ${brief.companyName}
Positioning: ${brief.oneLiner ?? brief.originalIdea ?? 'No one-liner set'}
Live URL: ${brief.liveUrl}
Goal: ${PROMO_VIDEO_GOAL_LABELS[brief.goal]}
Length: ${brief.durationSeconds}s
Format: ${PROMO_VIDEO_ASPECT_LABELS[brief.aspectRatio]}
Style: ${PROMO_VIDEO_STYLE_LABELS[brief.style]}
Visual direction: ${PROMO_VIDEO_VISUAL_MODE_LABELS[brief.visualMode]}
Voice mode: ${PROMO_VIDEO_VOICE_LABELS[brief.voiceMode]}
CTA: ${brief.cta}

Visual references:
${assetList}

Product notes:
${brief.documents.map((doc) => `- ${doc.title}: ${doc.excerpt}`).join('\n') || '- Use the company positioning and live URL.'}

Creative direction:
- The finished video is a product demo for customers or investors, not an explanation of how the video is made.
- Narration should explain the founder's product, the visible product flow, the customer benefit, and the CTA.
- Use a YouTube-style promo arc: hook, pain, product reveal, walkthrough, outcome, CTA.
- ${brief.goal === 'product_hunt'
    ? 'Product Hunt launch mode: open with what it is, show the product early, highlight one sharp differentiator, and end with a maker-friendly launch CTA.'
    : 'Keep the story focused on the chosen goal and the most visible customer value.'}
- Match each scene to what is visible in the selected asset. If a button or action is visible, use it as the callout.
- When an asset has a cursor target, make the narration describe that action or screen state directly.
- ${brief.visualMode === 'actual_site'
    ? 'Ground the storyboard in the live product screens and do not invent fictional UI.'
    : 'You may translate product concepts into polished motion graphics while keeping claims specific to the product.'}
- Never mention internal tooling or production mechanics in the title, headlines, captions, narration, or CTA.
- Banned output words and phrases: Baljia unless it is the company name, Remotion, R2, Browserbase, ScreenshotOne, worker, task, pipeline, render, rendering, storage, screenshot, captured assets, product captures, MP4, thumbnail, API key, FFmpeg, Deepgram, HeyGen, template, stock footage, how the video is made.

Return JSON with:
{
  "title": "short title",
  "scenes": [
    {
      "duration_seconds": number,
      "headline": "short on-screen headline",
      "caption": "caption always visible",
      "narration": "customer-facing narration",
      "asset_ref": "one of the visual reference ids",
      "motion": "push|pan|zoom|hold|reveal",
      "scene_type": "hook|pain|product_reveal|walkthrough|benefit|proof|cta",
      "callout": "short label for a button, feature, or outcome shown on screen",
      "cta": "optional CTA only on final scene"
    }
  ]
}

The scene duration_seconds must sum to exactly ${brief.durationSeconds}. Use 3-6 scenes. Keep it specific to the product and avoid generic hype.`;

  try {
    const response = await callSmallLLMJson<z.infer<typeof storyboardSchema>>(prompt, {
      schema: storyboardSchema,
      maxTokens: 1800,
      retryOnce: true,
      sanitizeArrayOfObjects: ['scenes'],
    });
    await appendAiUsage(job, {
      stage: 'storyboard',
      model: 'small-llm-json',
      input_tokens: estimateLlmTokens(prompt),
      output_tokens: estimateLlmTokens(JSON.stringify(response)),
      success: true,
    }).catch((error) => {
      log.warn('Failed to record promo video AI usage', { jobId: job.id, error: friendlyError(error) });
    });
    const storyboard = normalizeStoryboard(response, brief, assets);
    if (storyboardHasInternalVideoLanguage(storyboard, brief)) {
      log.warn('Storyboard contained internal video language, using deterministic fallback');
      return fallbackStoryboard(brief, assets);
    }
    return storyboard;
  } catch (error) {
    await appendAiUsage(job, {
      stage: 'storyboard',
      model: 'small-llm-json',
      input_tokens: estimateLlmTokens(prompt),
      output_tokens: 0,
      success: false,
    }).catch((usageError) => {
      log.warn('Failed to record failed promo video AI usage', { jobId: job.id, error: friendlyError(usageError) });
    });
    log.warn('Storyboard LLM failed, using deterministic fallback', { error: friendlyError(error) });
    return fallbackStoryboard(brief, assets);
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderThumbnailSvg(brief: ProductBrief, storyboard: PromoVideoStoryboard): Buffer {
  const { width, height } = getPromoVideoDimensions(brief.aspectRatio);
  const firstScene = storyboard.scenes[0];
  const title = escapeXml(firstScene?.headline ?? brief.companyName);
  const caption = escapeXml(firstScene?.caption ?? brief.oneLiner ?? '');
  const cta = escapeXml(brief.cta);
  const fontSize = brief.aspectRatio === '1:1' ? 72 : 82;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#15110a"/>
  <rect x="${width * 0.06}" y="${height * 0.07}" width="${width * 0.88}" height="${height * 0.58}" rx="28" fill="#f8f4ea"/>
  <rect x="${width * 0.09}" y="${height * 0.11}" width="${width * 0.82}" height="${height * 0.5}" rx="20" fill="#272017"/>
  <circle cx="${width * 0.15}" cy="${height * 0.16}" r="12" fill="#f59e0b"/>
  <circle cx="${width * 0.19}" cy="${height * 0.16}" r="12" fill="#10b981"/>
  <circle cx="${width * 0.23}" cy="${height * 0.16}" r="12" fill="#ef4444"/>
  <text x="${width * 0.08}" y="${height * 0.76}" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="800">${title}</text>
  <text x="${width * 0.08}" y="${height * 0.82}" fill="#f6d36b" font-family="Inter, Arial, sans-serif" font-size="${Math.round(fontSize * 0.34)}" font-weight="650">${caption.slice(0, 95)}</text>
  <text x="${width * 0.08}" y="${height * 0.9}" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="${Math.round(fontSize * 0.42)}" font-weight="700">${cta}</text>
</svg>`;
  return Buffer.from(svg);
}

async function runtimeImport<T>(specifier: string): Promise<T> {
  const importer = new Function('specifier', 'return import(specifier)') as (value: string) => Promise<T>;
  return importer(specifier);
}

async function renderPromoMp4(
  job: PromoVideoJobRow,
  brief: ProductBrief,
  storyboard: PromoVideoStoryboard,
  assets: PromoVideoCaptureAsset[],
  audioUrl: string | null,
  phase: 'preview' | 'final',
): Promise<Buffer> {
  const [{ mkdir, readFile, rm }, path, os] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
    import('node:os'),
  ]);
  const [{ bundle }, { renderMedia, selectComposition }] = await Promise.all([
    runtimeImport<typeof import('@remotion/bundler')>('@remotion/bundler'),
    runtimeImport<typeof import('@remotion/renderer')>('@remotion/renderer'),
  ]);

  const { width, height } = getPromoVideoDimensions(job.aspect_ratio as PromoVideoAspectRatio);
  const tempDir = path.join(os.tmpdir(), `baljia-promo-${job.id}`);
  await mkdir(tempDir, { recursive: true });
  const outputLocation = path.join(tempDir, 'promo.mp4');

  try {
    const serveUrl = await bundle({
      entryPoint: path.join(process.cwd(), 'src', 'remotion', 'promo', 'Root.tsx'),
    });
    const inputProps = {
      title: storyboard.title,
      companyName: brief.companyName,
      liveUrl: brief.liveUrl,
      cta: brief.cta,
      scenes: storyboard.scenes,
      assets,
      width,
      height,
      fps: FPS,
      durationInFrames: job.duration_seconds * FPS,
      style: job.style,
      aspectRatio: job.aspect_ratio,
      audioUrl,
      phase,
      visualMode: resolveRenderVisualMode(job),
    };
    const composition = await selectComposition({
      serveUrl,
      id: 'PromoVideo',
      inputProps,
    });

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation,
      inputProps,
      chromiumOptions: {
        disableWebSecurity: true,
      },
    });

    return await readFile(outputLocation);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function storyboardNarration(storyboard: PromoVideoStoryboard): string {
  return storyboard.scenes
    .map((scene, index) => {
      const pause = index === storyboard.scenes.length - 1 ? '' : ' ';
      return `${scene.narration.trim()}${pause}`;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function requestedVoiceoverProvider(): VoiceoverProvider | null {
  const provider = process.env.PROMO_VIDEO_TTS_PROVIDER?.trim().toLowerCase();
  if (provider === 'deepgram' || provider === 'supertonic' || provider === 'founder_avatar') return provider;
  return null;
}

function voiceoverProviderOrder(voiceMode: PromoVideoVoiceMode): VoiceoverProvider[] {
  const requested = requestedVoiceoverProvider();
  if (requested) return [requested];
  if (voiceMode === 'supertonic') return ['supertonic'];
  return [voiceMode === 'founder_avatar' ? 'founder_avatar' : 'deepgram'];
}

function shouldReuseExistingVoiceover(job: PromoVideoJobRow): boolean {
  if (!job.audio_url) return false;
  if (process.env.PROMO_VIDEO_REGENERATE_VOICEOVER === 'true') return false;
  return process.env.PROMO_VIDEO_REUSE_EXISTING_VOICEOVER === 'true' && requestedVoiceoverProvider() === null;
}

function resolveRenderVisualMode(job: PromoVideoJobRow): 'capture' | 'designed_mockup' | 'cinematic_story' {
  const override = process.env.PROMO_VIDEO_VISUAL_MODE;
  if (override === 'cinematic_story' || override === 'designed_mockup' || override === 'capture') return override;
  const visualMode = job.visual_mode as PromoVideoVisualMode;
  return visualMode === 'cinematic' ? 'cinematic_story' : 'capture';
}

async function maybeGenerateVoiceover(job: PromoVideoJobRow, brief: ProductBrief, storyboard: PromoVideoStoryboard): Promise<VoiceoverAsset | null> {
  const existingAudioUrl = job.audio_url;
  if (existingAudioUrl && shouldReuseExistingVoiceover(job)) {
    return {
      url: existingAudioUrl,
      key: job.audio_key,
      provider: brief.voiceMode === 'founder_avatar'
        ? 'founder_avatar'
        : brief.voiceMode === 'supertonic'
          ? 'supertonic'
          : 'deepgram',
    };
  }
  const narration = storyboardNarration(storyboard);
  if (!narration) return null;
  const requestedProvider = requestedVoiceoverProvider();

  for (const provider of voiceoverProviderOrder(brief.voiceMode)) {
    if (provider === 'deepgram') {
      if (!isDeepgramConfigured()) continue;
      try {
        const result = await deepgramTextToSpeech(narration);
        const upload = await uploadFile({
          companyId: job.company_id,
          category: 'media',
          filename: `promo-video-${job.id}-voiceover-deepgram.mp3`,
          content: result.audio,
          contentType: result.contentType,
          isPublic: true,
        });
        return {
          url: upload.publicUrl ?? upload.url,
          key: upload.key,
          provider,
        };
      } catch (error) {
        log.warn('Deepgram voiceover generation failed', { error: friendlyError(error) });
        if (requestedProvider) throw new Error(`Deepgram voiceover generation failed: ${friendlyError(error)}`);
      }
    }

    if (provider === 'supertonic') {
      if (!isSupertonicConfigured() && brief.voiceMode !== 'supertonic') continue;
      try {
        const result = await supertonicTextToSpeech(narration);
        const upload = await uploadFile({
          companyId: job.company_id,
          category: 'media',
          filename: `promo-video-${job.id}-voiceover-supertonic.wav`,
          content: result.audio,
          contentType: result.contentType,
          isPublic: true,
        });
        return {
          url: upload.publicUrl ?? upload.url,
          key: upload.key,
          provider,
        };
      } catch (error) {
        log.warn('Supertonic voiceover generation failed', { error: friendlyError(error) });
        if (requestedProvider || brief.voiceMode === 'supertonic') {
          throw new Error(`Supertonic voiceover generation failed: ${friendlyError(error)}`);
        }
      }
    }

    if (provider === 'founder_avatar') {
      if (!isFounderAvatarVoiceConfigured()) continue;
      try {
        const result = await founderAvatarTextToSpeech(narration);
        const upload = await uploadFile({
          companyId: job.company_id,
          category: 'media',
          filename: `promo-video-${job.id}-voiceover-founder-avatar.mp3`,
          content: result.audio,
          contentType: result.contentType,
          isPublic: true,
        });
        return {
          url: upload.publicUrl ?? upload.url,
          key: upload.key,
          provider,
        };
      } catch (error) {
        log.warn('Founder avatar voice generation failed', { error: friendlyError(error) });
        if (requestedProvider) throw new Error(`Founder avatar voice generation failed: ${friendlyError(error)}`);
      }
    }
  }

  if (requestedProvider) throw new Error(`${requestedProvider} voiceover provider is not configured`);
  if (brief.voiceMode === 'supertonic') throw new Error('Supertonic voice is not configured');
  if (brief.voiceMode === 'founder_avatar') throw new Error('Founder avatar voice is not configured');
  throw new Error('Deepgram voiceover provider is not configured');

}

function parseStoredFocusRect(value: unknown): PromoVideoFocusRect | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const rect = value as Record<string, unknown>;
  const x = typeof rect.x === 'number' ? rect.x : null;
  const y = typeof rect.y === 'number' ? rect.y : null;
  const width = typeof rect.width === 'number' ? rect.width : null;
  const height = typeof rect.height === 'number' ? rect.height : null;
  if (x === null || y === null || width === null || height === null) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return {
    x: clamp01(x),
    y: clamp01(y),
    width: clamp01(width),
    height: clamp01(height),
  };
}

function parseStoredPoint(value: unknown): PromoVideoPoint | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const point = value as Record<string, unknown>;
  const x = typeof point.x === 'number' ? point.x : null;
  const y = typeof point.y === 'number' ? point.y : null;
  if (x === null || y === null) return undefined;
  return {
    x: clamp01(x),
    y: clamp01(y),
  };
}

function storedCaptureAssets(job: PromoVideoJobRow): PromoVideoCaptureAsset[] {
  const rawAssets = Array.isArray(job.capture_assets) ? job.capture_assets : [];
  const assets: PromoVideoCaptureAsset[] = [];
  for (const raw of rawAssets) {
    const value = raw as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id : null;
    const label = typeof value.label === 'string' ? value.label : null;
    const kind = value.kind === 'screenshot' || value.kind === 'static' || value.kind === 'fallback' ? value.kind : 'fallback';
    if (!id || !label) continue;
    assets.push({
      id,
      label,
      kind,
      url: typeof value.url === 'string' ? value.url : null,
      width: typeof value.width === 'number' ? value.width : undefined,
      height: typeof value.height === 'number' ? value.height : undefined,
      primaryText: typeof value.primaryText === 'string' ? value.primaryText : undefined,
      summary: typeof value.summary === 'string' ? value.summary : undefined,
      buttons: Array.isArray(value.buttons) ? value.buttons.filter((item): item is string => typeof item === 'string') : undefined,
      focusRect: parseStoredFocusRect(value.focusRect),
      cursorTarget: parseStoredPoint(value.cursorTarget),
      shotType: value.shotType === 'wide' || value.shotType === 'focus' || value.shotType === 'click' || value.shotType === 'cta'
        ? value.shotType
        : undefined,
    });
  }
  return assets;
}

function storedStoryboard(job: PromoVideoJobRow, brief: ProductBrief, assets: PromoVideoCaptureAsset[]): PromoVideoStoryboard | null {
  const raw = job.storyboard as Record<string, unknown> | null;
  if (!raw || !Array.isArray(raw.scenes)) return null;
  const parsed = storyboardSchema.safeParse({
    title: raw.title,
    scenes: raw.scenes,
  });
  if (!parsed.success) return null;
  const normalized = normalizeStoryboard(parsed.data, brief, assets);
  return storyboardHasInternalVideoLanguage(normalized, brief) ? null : normalized;
}

async function uploadPromoArtifacts(input: {
  job: PromoVideoJobRow;
  brief: ProductBrief;
  storyboard: PromoVideoStoryboard;
  mp4: Buffer;
  phase: 'preview' | 'final';
}) {
  const suffix = input.phase === 'preview' ? 'preview' : 'final';
  return Promise.all([
    uploadFile({
      companyId: input.job.company_id,
      category: 'media',
      filename: `promo-video-${input.job.id}-${suffix}.mp4`,
      content: input.mp4,
      contentType: 'video/mp4',
      isPublic: true,
    }),
    uploadFile({
      companyId: input.job.company_id,
      category: 'media',
      filename: `promo-video-${input.job.id}-thumbnail.svg`,
      content: renderThumbnailSvg(input.brief, input.storyboard),
      contentType: 'image/svg+xml',
      isPublic: true,
    }),
  ]);
}

export async function runPromoVideoTask(input: { task: Task; executionId: string }): Promise<PromoVideoExecutionResult> {
  const executionLog: Record<string, unknown>[] = [];
  const taskId = input.task.id;
  const [initialJob] = await db.select()
    .from(promoVideoJobs)
    .where(eq(promoVideoJobs.task_id, taskId))
    .limit(1);

  if (!initialJob) throw new Error(`Promo video job not found for task ${taskId}`);

  let job = initialJob;
  const appendLog = (event: string, data: Record<string, unknown> = {}) => {
    executionLog.push({ event, at: new Date().toISOString(), ...data });
  };

  try {
    const { company, docs } = await loadCompanyAndDocs(job.company_id);
    const liveUrl = resolvePromoVideoLiveUrl(company);

    appendLog('promo_video_started', { job_id: job.id, live_url: liveUrl, visual_mode: job.visual_mode });

    const shouldRenderFinal = job.status === 'finalizing' || Boolean(job.preview_url && job.storyboard);
    if (shouldRenderFinal) {
      let assets = storedCaptureAssets(job);
      if (assets.length === 0) {
        appendLog('stored_assets_missing_recapturing');
        assets = await captureProductAssets(job, liveUrl);
        job = await updateJob(job, 'finalizing', { capture_assets: assets as unknown as Record<string, unknown>[] });
      }

      const brief = buildBrief(company, docs, job, liveUrl);
      const storyboard = storedStoryboard(job, brief, assets) ?? await buildStoryboard(job, brief, assets);

      job = await updateJob(job, 'rendering', {
        brief: brief as unknown as Record<string, unknown>,
        storyboard: storyboard as unknown as Record<string, unknown>,
      });
      const voiceover = await maybeGenerateVoiceover(job, brief, storyboard);
      const audioUrl = voiceover?.url ?? null;
      if (voiceover) appendLog('voiceover_generated', { provider: voiceover.provider });

      const mp4 = await renderPromoMp4(job, brief, storyboard, assets, audioUrl, 'final');
      appendLog('final_render_completed', { bytes: mp4.byteLength, audio: Boolean(audioUrl) });

      job = await updateJob(job, 'uploading');
      const [videoUpload, thumbnailUpload] = await uploadPromoArtifacts({
        job,
        brief,
        storyboard,
        mp4,
        phase: 'final',
      });

      job = await updateJob(job, 'ready', {
        audio_key: voiceover?.key ?? null,
        audio_url: audioUrl,
        output_key: videoUpload.key,
        output_url: videoUpload.publicUrl ?? videoUpload.url,
        thumbnail_key: thumbnailUpload.key,
        thumbnail_url: thumbnailUpload.publicUrl ?? thumbnailUpload.url,
        error_message: null,
      });

      appendLog('promo_video_ready', {
        output_url: job.output_url,
        thumbnail_url: job.thumbnail_url,
        voiceover: Boolean(audioUrl),
      });
      await emitPromoEvent(job.company_id, 'promo_video_completed', {
        job_id: job.id,
        task_id: job.task_id,
        output_url: job.output_url,
        thumbnail_url: job.thumbnail_url,
      });

      return {
        log: executionLog,
        phase: 'final',
        outputUrl: job.output_url ?? videoUpload.url,
        previewUrl: job.preview_url,
        thumbnailUrl: job.thumbnail_url ?? thumbnailUpload.url,
      };
    }

    job = await updateJob(job, 'capturing');
    const assets = await captureProductAssets(job, liveUrl);
    appendLog('product_capture_completed', { assets: assets.map((asset) => ({ id: asset.id, kind: asset.kind, has_url: Boolean(asset.url) })) });
    job = await updateJob(job, 'capturing', { capture_assets: assets as unknown as Record<string, unknown>[] });

    job = await updateJob(job, 'writing_script');
    const brief = buildBrief(company, docs, job, liveUrl);
    const storyboard = await buildStoryboard(job, brief, assets);
    appendLog('storyboard_created', {
      scenes: storyboard.scenes.length,
      duration_seconds: storyboard.scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0),
    });
    job = await updateJob(job, 'writing_script', {
      brief: brief as unknown as Record<string, unknown>,
      storyboard: storyboard as unknown as Record<string, unknown>,
    });

    job = await updateJob(job, 'preview_rendering');
    let previewVoiceover: VoiceoverAsset | null = null;
    let previewAudioUrl: string | null = null;
    try {
      previewVoiceover = await maybeGenerateVoiceover(job, brief, storyboard);
      previewAudioUrl = previewVoiceover?.url ?? null;
      if (previewVoiceover) appendLog('preview_voiceover_generated', { provider: previewVoiceover.provider });
    } catch (error) {
      appendLog('preview_voiceover_failed', { error: friendlyError(error) });
    }

    const mp4 = await renderPromoMp4(job, brief, storyboard, assets, previewAudioUrl, 'preview');
    appendLog('preview_render_completed', { bytes: mp4.byteLength, audio: Boolean(previewAudioUrl) });

    job = await updateJob(job, 'uploading');
    const [previewUpload, thumbnailUpload] = await uploadPromoArtifacts({
      job,
      brief,
      storyboard,
      mp4,
      phase: 'preview',
    });

    job = await updateJob(job, 'preview_ready', {
      preview_key: previewUpload.key,
      preview_url: previewUpload.publicUrl ?? previewUpload.url,
      audio_key: previewVoiceover?.key ?? null,
      audio_url: previewAudioUrl,
      output_key: null,
      output_url: null,
      thumbnail_key: thumbnailUpload.key,
      thumbnail_url: thumbnailUpload.publicUrl ?? thumbnailUpload.url,
      error_message: null,
    });

    appendLog('promo_video_preview_ready', {
      preview_url: job.preview_url,
      thumbnail_url: job.thumbnail_url,
    });

    return {
      log: executionLog,
      phase: 'preview',
      outputUrl: null,
      previewUrl: job.preview_url ?? previewUpload.url,
      thumbnailUrl: job.thumbnail_url ?? thumbnailUpload.url,
    };
  } catch (error) {
    const message = friendlyError(error);
    appendLog('promo_video_failed', { error: message });
    await updateJob(job, 'failed', { error_message: message }).catch((updateError) => {
      log.error('Failed to mark promo video job failed', { jobId: job.id, error: friendlyError(updateError) });
    });
    throw new Error(message);
  }
}
