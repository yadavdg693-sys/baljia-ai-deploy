import { createLogger } from '@/lib/logger';

const log = createLogger('Deepgram');

const DEEPGRAM_API_BASE = 'https://api.deepgram.com/v1';
const DEFAULT_MODEL = 'aura-2-thalia-en';
const DEFAULT_ENCODING = 'mp3';

export interface DeepgramTextToSpeechOptions {
  model?: string;
  encoding?: string;
}

export interface DeepgramAudioResult {
  audio: Buffer;
  contentType: string;
  model: string;
}

export function isDeepgramConfigured(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY);
}

function friendlyDeepgramError(value: string): string {
  return value
    .replace(/Authorization\s*:\s*Token\s+[^"',\s]+/gi, 'Authorization: Token [redacted]')
    .replace(/deepgram[_-]?api[_-]?key["':=\s]+[^"',\s]+/gi, 'DEEPGRAM_API_KEY=[redacted]')
    .replace(/api[_-]?key["':=\s]+[^"',\s]+/gi, 'api_key=[redacted]')
    .slice(0, 800);
}

export async function textToSpeech(
  text: string,
  options: DeepgramTextToSpeechOptions = {},
): Promise<DeepgramAudioResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY not configured');

  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new Error('Deepgram text-to-speech requires non-empty text');

  const model = options.model?.trim() || process.env.DEEPGRAM_TTS_MODEL?.trim() || DEFAULT_MODEL;
  const encoding = options.encoding?.trim() || process.env.DEEPGRAM_TTS_ENCODING?.trim() || DEFAULT_ENCODING;
  const url = new URL(`${DEEPGRAM_API_BASE}/speak`);
  url.searchParams.set('model', model);
  url.searchParams.set('encoding', encoding);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: trimmed }),
  });

  if (!response.ok) {
    const detail = friendlyDeepgramError(await response.text().catch(() => ''));
    throw new Error(`Deepgram text-to-speech failed (${response.status}): ${detail || response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audio = Buffer.from(arrayBuffer);
  if (audio.byteLength === 0) throw new Error('Deepgram text-to-speech returned empty audio');

  log.info('Deepgram voiceover generated', {
    bytes: audio.byteLength,
    model,
  });

  return {
    audio,
    contentType: response.headers.get('content-type') ?? 'audio/mpeg',
    model,
  };
}
