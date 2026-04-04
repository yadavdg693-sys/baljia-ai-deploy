// AWS Bedrock — LLM fallback routing
// Used when Anthropic/Gemini are down or rate limited
// Accesses Claude, Llama, Mistral, etc. via AWS Bedrock
//
// Env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION

import { createLogger } from '@/lib/logger';
import crypto from 'crypto';

const log = createLogger('Bedrock');

export function isBedrockConfigured(): boolean {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION
  );
}

// ══════════════════════════════════════════════
// AWS SIGNATURE V4 — minimal implementation
// ══════════════════════════════════════════════

function sign(key: Buffer, msg: string): Buffer {
  return crypto.createHmac('sha256', key).update(msg).digest();
}

function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = sign(Buffer.from('AWS4' + key), dateStamp);
  const kRegion = sign(kDate, region);
  const kService = sign(kRegion, service);
  return sign(kService, 'aws4_request');
}

function awsSign(method: string, url: string, body: string, service = 'bedrock-runtime'): Record<string, string> {
  const accessKey = process.env.AWS_ACCESS_KEY_ID!;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY!;
  const region = process.env.AWS_REGION ?? 'us-east-1';

  const parsedUrl = new URL(url);
  const now = new Date();
  const amzdate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const datestamp = amzdate.substring(0, 8);

  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');

  const canonicalHeaders = `content-type:application/json\nhost:${parsedUrl.host}\nx-amz-date:${amzdate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';

  const canonicalRequest = [
    method, parsedUrl.pathname, '', canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n');

  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzdate, credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = getSignatureKey(secretKey, datestamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'Content-Type': 'application/json',
    'X-Amz-Date': amzdate,
    Authorization: authorization,
  };
}

// ══════════════════════════════════════════════
// MODEL IDS — available on Bedrock
// ══════════════════════════════════════════════

export type BedrockModel =
  | 'claude-sonnet'      // anthropic.claude-3-5-sonnet-20241022-v2:0
  | 'claude-haiku'       // anthropic.claude-3-5-haiku-20241022-v1:0
  | 'llama-3'            // meta.llama3-1-70b-instruct-v1:0
  | 'mistral-large'      // mistral.mistral-large-2407-v1:0
  ;

const MODEL_MAP: Record<BedrockModel, string> = {
  'claude-sonnet': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'claude-haiku': 'anthropic.claude-3-5-haiku-20241022-v1:0',
  'llama-3': 'meta.llama3-1-70b-instruct-v1:0',
  'mistral-large': 'mistral.mistral-large-2407-v1:0',
};

// ══════════════════════════════════════════════
// INVOKE — run inference on Bedrock
// ══════════════════════════════════════════════

interface BedrockOptions {
  model?: BedrockModel;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export async function invoke(
  prompt: string,
  options: BedrockOptions = {}
): Promise<string> {
  if (!isBedrockConfigured()) {
    throw new Error('AWS Bedrock not configured — set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION');
  }

  const region = process.env.AWS_REGION ?? 'us-east-1';
  const modelArg = options.model ?? 'claude-haiku';
  const modelId = MODEL_MAP[modelArg] ?? MODEL_MAP['claude-haiku'];

  // Anthropic models use the Messages API format
  const isAnthropic = modelId.startsWith('anthropic.');

  let body: string;
  if (isAnthropic) {
    body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      system: options.systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });
  } else {
    // Llama/Mistral use a simpler format
    const fullPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\nUser: ${prompt}\nAssistant:`
      : prompt;
    body = JSON.stringify({
      prompt: fullPrompt,
      max_gen_len: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
    });
  }

  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${modelId}/invoke`;
  const headers = awsSign('POST', url, body);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    log.error('Bedrock invoke failed', { model: modelArg, status: response.status, error: text.substring(0, 200) });
    throw new Error(`Bedrock error (${response.status}): ${text.substring(0, 200)}`);
  }

  const result = await response.json() as Record<string, unknown>;

  // Extract response text based on model type
  let output: string;
  if (isAnthropic) {
    const content = (result as { content?: Array<{ text?: string }> }).content;
    output = content?.[0]?.text ?? '';
  } else {
    output = (result as { generation?: string }).generation ?? JSON.stringify(result);
  }

  log.info('Bedrock invoke complete', { model: modelArg, outputLength: output.length });
  return output;
}
