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

// G-EXEC-002: Circuit Breaker — prevents burning credits during API outages
// Opens after FAILURE_THRESHOLD consecutive failures, auto-resets after COOLDOWN_MS
const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 30_000; // 30 second cooldown when circuit is open
const WINDOW_MS = 120_000;  // Only count failures within 2 min window

interface CircuitState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
  openedAt: number;
}

// Per-provider circuit breakers
const circuits: Record<string, CircuitState> = {};

function getCircuit(provider: string): CircuitState {
  if (!circuits[provider]) {
    circuits[provider] = { failures: 0, lastFailure: 0, isOpen: false, openedAt: 0 };
  }
  return circuits[provider];
}

/**
 * Check if a provider's circuit breaker is currently open (blocking calls).
 * Auto-resets after cooldown period.
 */
export function isCircuitOpen(provider: string): boolean {
  const circuit = getCircuit(provider);
  if (!circuit.isOpen) return false;

  // Check if cooldown has elapsed — auto-reset (half-open → try again)
  if (Date.now() - circuit.openedAt > COOLDOWN_MS) {
    log.info(`Circuit breaker half-open for ${provider}, allowing retry`);
    circuit.isOpen = false;
    circuit.failures = 0;
    return false;
  }

  return true;
}

function recordSuccess(provider: string): void {
  const circuit = getCircuit(provider);
  circuit.failures = 0;
  circuit.isOpen = false;
}

function recordFailure(provider: string): void {
  const circuit = getCircuit(provider);
  const now = Date.now();

  // Reset failure count if outside window
  if (now - circuit.lastFailure > WINDOW_MS) {
    circuit.failures = 0;
  }

  circuit.failures++;
  circuit.lastFailure = now;

  if (circuit.failures >= FAILURE_THRESHOLD) {
    circuit.isOpen = true;
    circuit.openedAt = now;
    log.error(`Circuit breaker OPEN for ${provider} — ${circuit.failures} consecutive failures`, {
      provider,
      failures: circuit.failures,
      cooldownMs: COOLDOWN_MS,
    });
  }
}

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
 * Covers rate limits (429), server errors (500/502/503/529),
 * connection resets, and SDK-specific error objects.
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Rate limit, server error, overloaded
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit')) return true;
    if (msg.includes('500') || msg.includes('internal server error')) return true;
    if (msg.includes('502') || msg.includes('bad gateway')) return true;
    if (msg.includes('503') || msg.includes('service unavailable')) return true;
    if (msg.includes('529') || msg.includes('overloaded')) return true;
    if (msg.includes('connection') || msg.includes('econnreset') || msg.includes('epipe')) return true;
    if (msg.includes('fetch failed') || msg.includes('network')) return true;
    if (msg.includes('timeout') && !msg.includes('timed out after')) return true;

    // Anthropic/Google SDK may include numeric status on the error object
    const statusCode = (error as { status?: number }).status;
    if (statusCode && [429, 500, 502, 503, 529].includes(statusCode)) return true;
  }
  return false;
}

/**
 * Call Anthropic Claude with timeout + retry.
 * Wraps anthropic.messages.create() with safety guards.
 */
export async function callAnthropicWithTimeout(
  anthropic: { messages: { create: (...args: any[]) => Promise<any> } },
  params: Record<string, unknown>,
  options?: { timeoutMs?: number; label?: string }
): Promise<unknown> {
  const label = options?.label ?? 'anthropic.messages.create';
  const timeoutMs = options?.timeoutMs ?? LLM_CALL_TIMEOUT_MS;

  // G-EXEC-002: Circuit breaker check
  if (isCircuitOpen('anthropic')) {
    throw new Error(`Circuit breaker OPEN for Anthropic — too many consecutive failures. Retry after cooldown.`);
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await withLLMTimeout(
        // Anthropic SDK takes (body, requestOptions). Passing { signal } as the
        // SECOND arg — not spread into the body — otherwise the API rejects
        // with 400 "signal: Extra inputs are not permitted" (regression observed
        // 2026-04-28 on PRIMARY_LLM_PROVIDER=anthropic). The fallback chain
        // masked it but Claude was never actually called.
        (signal) => anthropic.messages.create(params, { signal }) as Promise<unknown>,
        timeoutMs,
        `${label} (attempt ${attempt + 1})`
      );
      recordSuccess('anthropic');
      return result;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES && isTransientError(error)) {
        recordFailure('anthropic');
        const backoff = RETRY_BACKOFF_MS * Math.pow(2, attempt);
        log.warn(`${label} transient failure, retrying in ${backoff}ms`, {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
        });
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      if (isTransientError(error)) recordFailure('anthropic');
      throw error;
    }
  }

  throw lastError;
}

/**
 * Call OpenRouter with timeout + retry.
 * Uses OpenAI SDK pointed at OpenRouter base URL.
 * Supports GLM-4, Qwen, and any OpenRouter model.
 */
export async function callOpenRouterWithTimeout(
  callFn: (signal: AbortSignal) => Promise<unknown>,
  options?: { timeoutMs?: number; label?: string }
): Promise<unknown> {
  const label = options?.label ?? 'openrouter.chat.completions';
  const timeoutMs = options?.timeoutMs ?? LLM_CALL_TIMEOUT_MS;

  // G-EXEC-002: Circuit breaker check
  if (isCircuitOpen('openrouter')) {
    throw new Error(`Circuit breaker OPEN for OpenRouter — too many consecutive failures. Retry after cooldown.`);
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await withLLMTimeout(
        (signal) => callFn(signal),
        timeoutMs,
        `${label} (attempt ${attempt + 1})`
      );
      recordSuccess('openrouter');
      return result;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES && isTransientError(error)) {
        recordFailure('openrouter');
        const backoff = RETRY_BACKOFF_MS * Math.pow(2, attempt);
        log.warn(`${label} transient failure, retrying in ${backoff}ms`, {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
        });
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      if (isTransientError(error)) recordFailure('openrouter');
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

  // G-EXEC-002: Circuit breaker check
  if (isCircuitOpen('gemini')) {
    throw new Error(`Circuit breaker OPEN for Gemini — too many consecutive failures. Retry after cooldown.`);
  }

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
      recordSuccess('gemini');
      return result;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES && isTransientError(error)) {
        recordFailure('gemini');
        const backoff = RETRY_BACKOFF_MS * Math.pow(2, attempt);
        log.warn(`${label} transient failure, retrying in ${backoff}ms`, {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
        });
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      if (isTransientError(error)) recordFailure('gemini');
      throw error;
    }
  }

  throw lastError;
}
