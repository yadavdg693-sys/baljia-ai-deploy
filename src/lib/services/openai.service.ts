// OpenAI Service — LLM fallback + image generation + embeddings + TTS
// NOT used for video (use Fal.ai's Kling/Minimax instead)
//
// Env: OPENAI_API_KEY

import OpenAI from 'openai';
import { createLogger } from '@/lib/logger';

const log = createLogger('OpenAI');

// ══════════════════════════════════════════════
// CLIENT (lazy init)
// ══════════════════════════════════════════════

let client: OpenAI | null = null;

export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

function getClient(): OpenAI {
  if (client) return client;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

// ══════════════════════════════════════════════
// LLM — Chat completion (fallback from Claude/Gemini)
// ══════════════════════════════════════════════

interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export async function chatCompletion(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  options: ChatOptions = {}
): Promise<string> {
  const oai = getClient();

  const model = options.model ?? 'gpt-4o';
  const allMessages = options.systemPrompt
    ? [{ role: 'system' as const, content: options.systemPrompt }, ...messages]
    : messages;

  const response = await oai.chat.completions.create({
    model,
    messages: allMessages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty response');

  log.info('Chat completion done', { model, tokens: response.usage?.total_tokens });
  return content;
}

// ══════════════════════════════════════════════
// IMAGE — DALL-E 3 generation
// ══════════════════════════════════════════════

interface ImageGenOptions {
  size?: '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
}

export async function generateImage(
  prompt: string,
  options: ImageGenOptions = {}
): Promise<{ url: string; revisedPrompt: string }> {
  const oai = getClient();

  const response = await oai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: options.size ?? '1024x1024',
    quality: options.quality ?? 'standard',
    style: options.style ?? 'vivid',
    response_format: 'url',
  });

  const image = response.data?.[0];
  if (!image?.url) throw new Error('DALL-E returned no image');

  log.info('Image generated', { revisedPrompt: image.revised_prompt?.substring(0, 50) });

  return {
    url: image.url,
    revisedPrompt: image.revised_prompt ?? prompt,
  };
}

// ══════════════════════════════════════════════
// EMBEDDINGS — for semantic search
// ══════════════════════════════════════════════

export async function createEmbedding(text: string): Promise<number[]> {
  const oai = getClient();

  const response = await oai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });

  return response.data[0].embedding;
}

export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  const oai = getClient();

  const response = await oai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });

  return response.data.map((d) => d.embedding);
}

// ══════════════════════════════════════════════
// TEXT-TO-SPEECH
// ══════════════════════════════════════════════

export async function textToSpeech(
  text: string,
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova'
): Promise<Buffer> {
  const oai = getClient();

  const response = await oai.audio.speech.create({
    model: 'tts-1',
    voice,
    input: text,
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  log.info('TTS generated', { voice, chars: text.length });
  return buffer;
}

// ══════════════════════════════════════════════
// SPEECH-TO-TEXT — Whisper
// ══════════════════════════════════════════════

export async function speechToText(audioBuffer: Buffer, language = 'en'): Promise<string> {
  const oai = getClient();

  const file = new File([new Uint8Array(audioBuffer)], 'audio.webm', { type: 'audio/webm' });

  const response = await oai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    language,
  });

  log.info('STT transcribed', { chars: response.text.length });
  return response.text;
}
