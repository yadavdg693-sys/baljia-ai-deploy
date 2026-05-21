// HeyGen video generation service
// Primary use: prompt-to-video ads via Video Agent, then save the temporary URL to R2.
// Env: HEYGEN_API_KEY

import { createLogger } from '@/lib/logger';

const log = createLogger('HeyGen');

const HEYGEN_API_BASE = 'https://api.heygen.com';
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

type AspectRatio = '16:9' | '9:16' | '1:1';

type HeyGenError =
  | string
  | null
  | {
      message?: string;
      code?: string;
      details?: string;
    };

interface HeyGenVideoGenerateResponse {
  error?: HeyGenError;
  data?: {
    video_id?: string;
    id?: string;
    video_url?: string;
    url?: string;
    download_url?: string;
  };
  video_id?: string;
  id?: string;
  video_url?: string;
  url?: string;
  download_url?: string;
}

interface HeyGenVideoStatusResponse {
  error?: HeyGenError;
  data?: {
    status?: string;
    video_url?: string;
    url?: string;
    download_url?: string;
    error?: HeyGenError;
  };
  status?: string;
  video_url?: string;
  url?: string;
  download_url?: string;
}

export function isHeyGenConfigured(): boolean {
  return !!process.env.HEYGEN_API_KEY;
}

function getApiKey(): string {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) throw new Error('HEYGEN_API_KEY is not configured');
  return apiKey;
}

function errorMessage(error: HeyGenError | undefined): string | null {
  if (!error) return null;
  if (typeof error === 'string') return error;
  return error.message ?? error.details ?? error.code ?? 'Unknown HeyGen error';
}

function extractVideoId(response: HeyGenVideoGenerateResponse): string | null {
  return response.data?.video_id ?? response.data?.id ?? response.video_id ?? response.id ?? null;
}

function extractVideoUrl(response: HeyGenVideoGenerateResponse | HeyGenVideoStatusResponse): string | null {
  return response.data?.video_url
    ?? response.data?.url
    ?? response.data?.download_url
    ?? response.video_url
    ?? response.url
    ?? response.download_url
    ?? null;
}

function buildVideoAgentPrompt(prompt: string, options: { duration: number; aspectRatio: AspectRatio }): string {
  return [
    prompt,
    '',
    `Create this as a paid social video ad for Facebook and Instagram.`,
    `Target length: ${options.duration} seconds.`,
    `Format: ${options.aspectRatio} vertical-first short-form ad.`,
    'Style: native UGC/direct-to-camera spokesperson or avatar, selfie-like framing, natural delivery, not a cinematic montage.',
    'Structure: first-2-second hook, product/context reveal, concrete benefit, simple CTA.',
    'Captions: add large bold white caption fragments in the lower-middle safe zone, timed to speech, 2-5 words per beat.',
    'Keep the product/company context from the prompt. Do not copy any competitor wording, brand, face, or testimonial. Do not fabricate unsupported claims.',
  ].join('\n');
}

async function heygenRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-API-KEY', getApiKey());
  headers.set('Content-Type', 'application/json');

  const response = await fetch(`${HEYGEN_API_BASE}${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  let parsed: T & { error?: HeyGenError };
  try {
    parsed = text ? JSON.parse(text) as T & { error?: HeyGenError } : {} as T & { error?: HeyGenError };
  } catch {
    throw new Error(`HeyGen returned invalid JSON${response.ok ? '' : ` (HTTP ${response.status})`}: ${text.slice(0, 200)}`);
  }
  const apiError = errorMessage(parsed.error);

  if (!response.ok || apiError) {
    throw new Error(apiError ?? `HeyGen request failed with HTTP ${response.status}`);
  }

  return parsed;
}

async function pollVideoStatus(videoId: string): Promise<{ url: string; status: string }> {
  const deadline = Date.now() + Number(process.env.HEYGEN_POLL_TIMEOUT_MS ?? DEFAULT_POLL_TIMEOUT_MS);

  while (Date.now() < deadline) {
    const status = await heygenRequest<HeyGenVideoStatusResponse>(
      `/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
      { method: 'GET' },
    );
    const currentStatus = (status.data?.status ?? status.status ?? '').toLowerCase();

    if (currentStatus === 'completed' || currentStatus === 'complete' || currentStatus === 'success') {
      const url = extractVideoUrl(status);
      if (!url) throw new Error('HeyGen completed without a video URL');
      return { url, status: currentStatus };
    }

    if (currentStatus === 'failed' || currentStatus === 'failure' || currentStatus === 'error') {
      throw new Error(errorMessage(status.data?.error) ?? 'HeyGen video generation failed');
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`HeyGen video generation timed out for ${videoId}`);
}

export async function generateHeyGenAdVideo(
  prompt: string,
  options: {
    duration?: number;
    aspectRatio?: AspectRatio;
  } = {},
): Promise<{ url: string; videoId: string; model: 'video-agent' }> {
  const duration = Math.min(Math.max(Number(options.duration ?? 15), 4), 15);
  const aspectRatio = options.aspectRatio ?? '9:16';

  const submitted = await heygenRequest<HeyGenVideoGenerateResponse>('/v1/video_agent/generate', {
    method: 'POST',
    body: JSON.stringify({
      prompt: buildVideoAgentPrompt(prompt, { duration, aspectRatio }),
    }),
  });

  const immediateUrl = extractVideoUrl(submitted);
  const videoId = extractVideoId(submitted);
  if (immediateUrl && videoId) {
    log.info('HeyGen ad video generated immediately', { videoId, duration, aspectRatio });
    return { url: immediateUrl, videoId, model: 'video-agent' };
  }

  if (!videoId) {
    throw new Error('HeyGen response did not include a video_id');
  }

  const completed = await pollVideoStatus(videoId);
  log.info('HeyGen ad video generated', { videoId, status: completed.status, duration, aspectRatio });

  return { url: completed.url, videoId, model: 'video-agent' };
}
