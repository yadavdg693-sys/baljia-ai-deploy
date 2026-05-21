// Fal.ai Media Generation Service
// Multi-model AI media generation: images, videos, audio
// Env: FAL_KEY

import { createLogger } from '@/lib/logger';

const log = createLogger('FalAI');

const FAL_API_BASE = 'https://queue.fal.run';
const DEFAULT_POLL_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

export function isFalConfigured(): boolean {
  return !!process.env.FAL_KEY;
}

// ══════════════════════════════════════════════
// GENERIC FAL API CALLER
// ══════════════════════════════════════════════

async function falRun<T>(
  modelId: string,
  input: Record<string, unknown>
): Promise<T> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error('FAL_KEY not configured');

  // Submit to queue
  const submitRes = await fetch(`${FAL_API_BASE}/${modelId}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!submitRes.ok) {
    const text = await submitRes.text();
    throw new Error(`Fal.ai submit failed: ${text}`);
  }

  const submitted = await submitRes.json() as T & {
    request_id?: string;
    status?: string;
    status_url?: string;
    response_url?: string;
  };

  if (!submitted.request_id && !submitted.status_url && !submitted.response_url) {
    log.info('Fal.ai generation complete', { model: modelId });
    return submitted;
  }

  const deadline = Date.now() + Number(process.env.FAL_POLL_TIMEOUT_MS ?? DEFAULT_POLL_TIMEOUT_MS);
  while (Date.now() < deadline) {
    const statusUrl = submitted.status_url
      ?? (submitted.request_id ? `${FAL_API_BASE}/${modelId}/requests/${submitted.request_id}/status` : null);
    if (!statusUrl) break;

    const statusRes = await fetch(statusUrl, {
      headers: { Authorization: `Key ${apiKey}` },
    });
    if (!statusRes.ok) {
      const text = await statusRes.text();
      throw new Error(`Fal.ai status failed: ${text}`);
    }

    const status = await statusRes.json() as {
      status?: string;
      response_url?: string;
      error?: string;
    };

    if (status.status === 'FAILED' || status.status === 'ERROR') {
      throw new Error(`Fal.ai generation failed: ${status.error ?? status.status}`);
    }

    if (status.status === 'COMPLETED' || status.status === 'completed') {
      const responseUrl = status.response_url ?? submitted.response_url;
      if (!responseUrl) throw new Error('Fal.ai completed without a response URL');
      const responseRes = await fetch(responseUrl, {
        headers: { Authorization: `Key ${apiKey}` },
      });
      if (!responseRes.ok) {
        const text = await responseRes.text();
        throw new Error(`Fal.ai result fetch failed: ${text}`);
      }
      const result = await responseRes.json() as T;
      log.info('Fal.ai generation complete', { model: modelId });
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Fal.ai generation timed out for ${modelId}`);
}

// ══════════════════════════════════════════════
// IMAGE GENERATION — Flux, SDXL, etc.
// ══════════════════════════════════════════════

interface FalImageResult {
  images: Array<{ url: string; content_type: string }>;
  seed: number;
}

export async function generateImage(
  prompt: string,
  options: {
    model?: 'flux-pro' | 'flux-dev' | 'flux-schnell' | 'stable-diffusion-xl';
    width?: number;
    height?: number;
    numImages?: number;
  } = {}
): Promise<Array<{ url: string }>> {
  const model = options.model ?? 'flux-schnell';
  const modelMap: Record<string, string> = {
    'flux-pro': 'fal-ai/flux-pro/v1.1',
    'flux-dev': 'fal-ai/flux/dev',
    'flux-schnell': 'fal-ai/flux/schnell',
    'stable-diffusion-xl': 'fal-ai/stable-diffusion-v35-large',
  };

  const result = await falRun<FalImageResult>(modelMap[model] ?? modelMap['flux-schnell'], {
    prompt,
    image_size: { width: options.width ?? 1024, height: options.height ?? 1024 },
    num_images: options.numImages ?? 1,
  });

  return result.images.map((img) => ({ url: img.url }));
}

// ══════════════════════════════════════════════
// VIDEO GENERATION — Kling, Minimax, etc.
// ══════════════════════════════════════════════

interface FalVideoResult {
  video: { url: string };
}

export async function generateVideo(
  prompt: string,
  options: {
    model?: 'kling' | 'minimax';
    duration?: number;
    aspectRatio?: '16:9' | '9:16' | '1:1';
  } = {}
): Promise<{ url: string }> {
  const modelMap: Record<string, string> = {
    'kling': 'fal-ai/kling-video/v2/master',
    'minimax': 'fal-ai/minimax-video/video-01-live',
  };

  const model = options.model ?? 'kling';

  const result = await falRun<FalVideoResult>(modelMap[model] ?? modelMap['kling'], {
    prompt,
    duration: (options.duration ?? 5).toString(),
    aspect_ratio: options.aspectRatio ?? '16:9',
  });

  return { url: result.video.url };
}

// ══════════════════════════════════════════════
// TEXT-TO-SPEECH
// ══════════════════════════════════════════════

interface FalTTSResult {
  audio: { url: string };
}

export async function textToSpeech(
  text: string,
  options: { voice?: string } = {}
): Promise<{ url: string }> {
  const result = await falRun<FalTTSResult>('fal-ai/f5-tts', {
    gen_text: text,
    ref_audio_url: options.voice,
  });

  return { url: result.audio.url };
}

// ══════════════════════════════════════════════
// IMAGE UPSCALE
// ══════════════════════════════════════════════

interface FalUpscaleResult {
  image: { url: string };
}

export async function upscaleImage(
  imageUrl: string,
  scale: 2 | 4 = 2
): Promise<{ url: string }> {
  const result = await falRun<FalUpscaleResult>('fal-ai/aura-sr', {
    image_url: imageUrl,
    upscaling_factor: scale,
  });

  return { url: result.image.url };
}
