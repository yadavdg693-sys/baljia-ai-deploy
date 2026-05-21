import { createLogger } from '@/lib/logger';

const log = createLogger('HeyGenVoice');

const HEYGEN_API_BASE = 'https://api.heygen.com';

export interface HeyGenFounderVoiceOptions {
  voiceId?: string;
  speed?: number;
  locale?: string;
  language?: string;
}

export interface HeyGenFounderVoiceResult {
  audio: Buffer;
  contentType: string;
  voiceId: string;
}

type HeyGenSpeechResponse = {
  data?: {
    audio_url?: string;
    url?: string;
    speech_url?: string;
  };
  audio_url?: string;
  url?: string;
  speech_url?: string;
  error?: string | { message?: string; details?: string; code?: string };
};

export function isFounderAvatarVoiceConfigured(): boolean {
  return Boolean(process.env.HEYGEN_API_KEY && process.env.HEYGEN_FOUNDER_VOICE_ID);
}

function getFounderVoiceId(voiceId?: string): string {
  const resolved = voiceId?.trim() || process.env.HEYGEN_FOUNDER_VOICE_ID?.trim();
  if (!resolved) throw new Error('HEYGEN_FOUNDER_VOICE_ID not configured');
  return resolved;
}

function friendlyHeyGenError(value: string): string {
  return value
    .replace(/x-api-key\s*[:=]\s*[^"',\s]+/gi, 'X-Api-Key=[redacted]')
    .replace(/heygen[_-]?api[_-]?key["':=\s]+[^"',\s]+/gi, 'HEYGEN_API_KEY=[redacted]')
    .replace(/api[_-]?key["':=\s]+[^"',\s]+/gi, 'api_key=[redacted]')
    .slice(0, 800);
}

function responseErrorMessage(error: HeyGenSpeechResponse['error']): string | null {
  if (!error) return null;
  if (typeof error === 'string') return error;
  return error.message ?? error.details ?? error.code ?? 'Unknown HeyGen voice error';
}

function extractAudioUrl(response: HeyGenSpeechResponse): string | null {
  return response.data?.audio_url
    ?? response.data?.url
    ?? response.data?.speech_url
    ?? response.audio_url
    ?? response.url
    ?? response.speech_url
    ?? null;
}

async function fetchAudio(url: string): Promise<{ audio: Buffer; contentType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    const detail = friendlyHeyGenError(await response.text().catch(() => ''));
    throw new Error(`HeyGen founder voice audio download failed (${response.status}): ${detail || response.statusText}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength === 0) throw new Error('HeyGen founder voice returned empty audio');
  return {
    audio,
    contentType: response.headers.get('content-type') ?? 'audio/mpeg',
  };
}

export async function founderAvatarTextToSpeech(
  text: string,
  options: HeyGenFounderVoiceOptions = {},
): Promise<HeyGenFounderVoiceResult> {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) throw new Error('HEYGEN_API_KEY not configured');

  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new Error('HeyGen founder voice requires non-empty text');

  const voiceId = getFounderVoiceId(options.voiceId);
  const response = await fetch(`${HEYGEN_API_BASE}/v3/voices/speech`, {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      Accept: 'application/json, audio/mpeg',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: trimmed,
      voice_id: voiceId,
      input_type: 'text',
      speed: options.speed ?? Number(process.env.HEYGEN_FOUNDER_VOICE_SPEED ?? 1),
      locale: options.locale ?? process.env.HEYGEN_FOUNDER_VOICE_LOCALE,
      language: options.language ?? process.env.HEYGEN_FOUNDER_VOICE_LANGUAGE,
    }),
  });

  if (!response.ok) {
    const detail = friendlyHeyGenError(await response.text().catch(() => ''));
    throw new Error(`HeyGen founder voice failed (${response.status}): ${detail || response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().startsWith('audio/')) {
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.byteLength === 0) throw new Error('HeyGen founder voice returned empty audio');
    log.info('HeyGen founder voice generated', { bytes: audio.byteLength, voiceId });
    return { audio, contentType, voiceId };
  }

  const parsed = await response.json().catch(async () => {
    throw new Error('HeyGen founder voice returned invalid JSON');
  }) as HeyGenSpeechResponse;
  const apiError = responseErrorMessage(parsed.error);
  if (apiError) throw new Error(`HeyGen founder voice failed: ${friendlyHeyGenError(apiError)}`);

  const audioUrl = extractAudioUrl(parsed);
  if (!audioUrl) throw new Error('HeyGen founder voice completed without an audio URL');

  const downloaded = await fetchAudio(audioUrl);
  log.info('HeyGen founder voice generated', { bytes: downloaded.audio.byteLength, voiceId });
  return {
    ...downloaded,
    voiceId,
  };
}
