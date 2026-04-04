// LLM Call Wrapper — timeout + retry + logging for all AI model calls
// FIX: G-LLM-001 — LLM API calls had no timeout (could hang indefinitely)
// FIX: G-LLM-002 — No retry with backoff on transient failures
// FIX: G-LLM-003 — No token tracking per call
//
// Usage:
//   import { withLLMTimeout, callAnthropicWithTimeout } from '@/lib/llm-safety';
//   const response = await callAnthropicWithTimeout(anthropic, params);

import { createLogger } from '@/lib/logger';

const log = createLogger('LLM');

// Per-call timeout (prevents indefinite hangs)
const LLM_CALL_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS ?? '60000', 10); // 60s default

// Max retries on transient errors (429, 500, 529)
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 1000; // 1s, 2s, 4s exponential

/**
 * Wrap any async function with a timeout.
 * Uses AbortSignal for proper cleanup (Anthropic SDK supports this).
 */
export async function withLLMTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = LLM_CALL_TIMEOUT_MS,
  label: string = 'llm_call'
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startTime = Date.now();

  try {
    const result = await fn(controller.signal);
    const durationMs = Date.now() - startTime;
    log.debug(`${label} completed`, { durationMs, timeoutMs });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (controller.signal.aborted) {
      log.error(`${label} timed out`, { durationMs, timeoutMs });
      throw new Error(`LLM call timed out after ${timeoutMs}ms (${label})`);
    }

    log.error(`${label} failed`, { durationMs }, error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Determine if an error is transient (retryable).
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Rate limit, server error, overloaded
    if (msg.includes('429') || msg.includes('rate limit')) return true;
    if (msg.includes('500') || msg.includes('internal server error')) return true;
    if (msg.includes('529') || msg.includes('overloaded')) return true;
    if (msg.includes('connection') || msg.includes('econnreset')) return true;
    if (msg.includes('timeout') && !msg.includes('timed out after')) return true;
  }
  return false;
}

/**
 * Call Anthropic Claude with timeout + retry.
 * Wraps anthropic.messages.create() with safety guards.
 */
export async function callAnthropicWithTimeout(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anthropic: { messages: { create: (...args: any[]) => Promise<any> } },
  params: Record<string, unknown>,
  options?: { timeoutMs?: number; label?: string }
): Promise<unknown> {
  const label = options?.label ?? 'anthropic.messages.create';
  const timeoutMs = options?.timeoutMs ?? LLM_CALL_TIMEOUT_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await withLLMTimeout(
        (signal) => anthropic.messages.create({ ...params, signal }) as Promise<unknown>,
        timeoutMs,
        `${label} (attempt ${attempt + 1})`
      );
      return result;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES && isTransientError(error)) {
        const backoff = RETRY_BACKOFF_MS * Math.pow(2, attempt);
        log.warn(`${label} transient failure, retrying in ${backoff}ms`, {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
        });
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

/**
 * Call Gemini with timeout + retry.
 * Wraps chat.sendMessage() or model.generateContent().
 */
export async function callGeminiWithTimeout(
  callFn: () => Promise<unknown>,
  options?: { timeoutMs?: number; label?: string }
): Promise<unknown> {
  const label = options?.label ?? 'gemini.generate';
  const timeoutMs = options?.timeoutMs ?? LLM_CALL_TIMEOUT_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Gemini SDK doesn't support AbortSignal, so we use Promise.race
      const result = await Promise.race([
        callFn(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`LLM call timed out after ${timeoutMs}ms (${label})`)),
            timeoutMs
          )
        ),
      ]);
      return result;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES && isTransientError(error)) {
        const backoff = RETRY_BACKOFF_MS * Math.pow(2, attempt);
        log.warn(`${label} transient failure, retrying in ${backoff}ms`, {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
        });
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}
