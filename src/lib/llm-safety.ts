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
// Anthropic's SDK refuses non-streaming requests when max_tokens implies an
// operation that could exceed 10 minutes. Engineering turns intentionally use
// a large output budget for whole-file tool calls, so route those through the
// SDK's streaming accumulator and still return a normal final Message.
const ANTHROPIC_STREAMING_TOKEN_THRESHOLD = 20_000;

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
  label: string = 'llm_call',
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timeoutFired = false;
  let externalAbortFired = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // If the caller (worker-launcher) aborts mid-flight (watchdog kill or
  // MAX_EXECUTION_MS), forward the abort to the inner SDK fetch so it
  // cancels promptly instead of waiting for the full timeout. Without this
  // the agent's HTTP request to Anthropic/Gemini/OpenRouter keeps draining
  // tokens after the parent gave up.
  let externalAbortReject: ((reason?: unknown) => void) | null = null;
  const externalAbortHandler = () => {
    externalAbortFired = true;
    controller.abort();
    externalAbortReject?.(new Error(`LLM call aborted by parent watchdog/timeout (${label})`));
  };
  const externalAbortPromise = externalSignal
    ? new Promise<never>((_, reject) => {
        externalAbortReject = reject;
        if (externalSignal.aborted) externalAbortHandler();
        else externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
      })
    : null;

  const startTime = Date.now();
  const operation = Promise.resolve().then(() => fn(controller.signal));
  // Some provider SDK paths, especially streaming accumulators, can ignore or
  // delay AbortSignal rejection. Race the SDK promise against our own timeout
  // so the agent loop is bounded even when the underlying HTTP call misbehaves.
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timeoutFired = true;
      controller.abort();
      reject(new Error(`LLM call timed out after ${timeoutMs}ms (${label})`));
    }, timeoutMs);
  });

  try {
    const raceInputs: Promise<T | never>[] = [operation, timeoutPromise];
    if (externalAbortPromise) raceInputs.push(externalAbortPromise);
    const result = await Promise.race(raceInputs);
    const durationMs = Date.now() - startTime;
    log.debug(`${label} completed`, { durationMs, timeoutMs });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (controller.signal.aborted || timeoutFired || externalAbortFired) {
      if (externalSignal?.aborted || externalAbortFired) {
        log.warn(`${label} aborted by parent`, { durationMs });
        throw new Error(`LLM call aborted by parent watchdog/timeout (${label})`);
      }
      log.error(`${label} timed out`, { durationMs, timeoutMs });
      throw new Error(`LLM call timed out after ${timeoutMs}ms (${label})`);
    }

    log.error(`${label} failed`, { durationMs }, error);
    throw error;
  } finally {
    operation.catch(() => {});
    if (timer) clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', externalAbortHandler);
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
    if (isRetryableRateQuotaMessage(msg)) return true;
    if (isQuotaOrBillingErrorMessage(msg)) return false;
    // Rate limit, server error, overloaded
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit')) return true;
    if (msg.includes('500') || msg.includes('internal server error')) return true;
    if (msg.includes('502') || msg.includes('bad gateway')) return true;
    if (msg.includes('503') || msg.includes('service unavailable')) return true;
    if (msg.includes('529') || msg.includes('overloaded')) return true;
    if (msg.includes('connection') || msg.includes('econnreset') || msg.includes('epipe')) return true;
    if (msg.includes('fetch failed') || msg.includes('network')) return true;
    if (msg.includes('timeout') && !msg.includes('timed out after')) return true;
    if (
      msg.includes('partial-json-parser') ||
      msg.includes('invalid json') ||
      msg.includes('unterminated string') ||
      (msg.includes('expected') && msg.includes('json')) ||
      (msg.includes('tool_use') && msg.includes('json')) ||
      (msg.includes('malformed') && msg.includes('tool'))
    ) return true;

    // Anthropic/Google SDK may include numeric status on the error object
    const statusCode = (error as { status?: number }).status;
    if (statusCode && [429, 500, 502, 503, 529].includes(statusCode)) return true;
  }
  return false;
}

function isRetryableRateQuotaMessage(message: string): boolean {
  const hasRetryHint =
    /\bretryinfo\b|\bretrydelay\b|please retry in|retry after/i.test(message);
  const looksLikeRateQuota =
    /429|too many requests|quota exceeded|rate limit|rate_limit/i.test(message);
  const isBalanceOrHardLimit =
    /insufficient balance|suspended due to insufficient balance|adjust the key's total limit|can only afford/i.test(message);

  return hasRetryHint && looksLikeRateQuota && !isBalanceOrHardLimit;
}

function isQuotaOrBillingErrorMessage(message: string): boolean {
  return /insufficient balance|requires more credits|exceeded_current_quota|billing|recharge|suspended due to insufficient balance|can only afford|adjust the key's total limit/i.test(message);
}

function retryDelayMs(error: unknown, attempt: number): number {
  const base = RETRY_BACKOFF_MS * Math.pow(2, attempt);
  const headerDelay = retryAfterHeaderMs(error);
  const bodyDelay = retryInfoBodyDelayMs(error);
  const providerDelay = providerSpecificRetryDelayMs(error);
  const hinted = Math.max(headerDelay ?? 0, bodyDelay ?? 0, providerDelay ?? 0);
  if (!hinted) return base;
  return Math.min(90_000, Math.max(base, hinted + 1_000));
}

function retryAfterHeaderMs(error: unknown): number | null {
  const headers = (error as { headers?: Headers | Record<string, unknown> } | null)?.headers;
  if (!headers) return null;

  const raw = typeof (headers as Headers).get === 'function'
    ? (headers as Headers).get('retry-after')
    : (headers as Record<string, unknown>)['retry-after'];
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return null;
}

function retryInfoBodyDelayMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const match =
    message.match(/retryDelay["']?\s*:\s*["']?(\d+(?:\.\d+)?)s/i) ??
    message.match(/please retry in\s+(\d+(?:\.\d+)?)s/i) ??
    message.match(/retry after\s+(\d+(?:\.\d+)?)s/i);
  if (!match?.[1]) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1_000) : null;
}

function providerSpecificRetryDelayMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const looksLikeGemini =
    /googlegenerativeai|generativelanguage\.googleapis\.com|gemini/i.test(message);
  const genericResourceExhausted =
    /429|too many requests/i.test(message) &&
    /resource has been exhausted|check quota/i.test(message);
  if (!looksLikeGemini || !genericResourceExhausted) return null;

  const configured = Number(process.env.GEMINI_RESOURCE_EXHAUSTED_RETRY_MS ?? '');
  if (Number.isFinite(configured) && configured > 0) return configured;
  return 65_000;
}

/**
 * Call Anthropic Claude with timeout + retry.
 * Wraps anthropic.messages.create() with safety guards.
 */
export async function callAnthropicWithTimeout(
  anthropic: {
    messages: {
      create: (...args: any[]) => Promise<any>;
      stream?: (...args: any[]) => { finalMessage: () => Promise<any> };
    };
  },
  params: Record<string, unknown>,
  options?: { timeoutMs?: number; label?: string; externalSignal?: AbortSignal }
): Promise<unknown> {
  const label = options?.label ?? 'anthropic.messages.create';
  const timeoutMs = options?.timeoutMs ?? LLM_CALL_TIMEOUT_MS;
  const externalSignal = options?.externalSignal;
  const maxTokens = typeof params.max_tokens === 'number' ? params.max_tokens : 0;
  const shouldStream = maxTokens > ANTHROPIC_STREAMING_TOKEN_THRESHOLD && typeof anthropic.messages.stream === 'function';

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
        (signal) => {
          if (shouldStream) {
            return anthropic.messages.stream!(params, { signal }).finalMessage() as Promise<unknown>;
          }
          return anthropic.messages.create(params, { signal }) as Promise<unknown>;
        },
        timeoutMs,
        `${label} (attempt ${attempt + 1})`,
        externalSignal,
      );
      recordSuccess('anthropic');
      return result;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES && isTransientError(error)) {
        recordFailure('anthropic');
        const backoff = retryDelayMs(error, attempt);
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
  options?: { timeoutMs?: number; label?: string; externalSignal?: AbortSignal }
): Promise<unknown> {
  const label = options?.label ?? 'openrouter.chat.completions';
  const timeoutMs = options?.timeoutMs ?? LLM_CALL_TIMEOUT_MS;
  const externalSignal = options?.externalSignal;

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
        `${label} (attempt ${attempt + 1})`,
        externalSignal,
      );
      recordSuccess('openrouter');
      return result;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES && isTransientError(error)) {
        recordFailure('openrouter');
        const backoff = retryDelayMs(error, attempt);
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
 * Call Moonshot with timeout + retry.
 * Uses OpenAI-compatible chat completions but keeps a separate circuit breaker
 * from OpenRouter so one provider's outage does not demote the other.
 */
export async function callMoonshotWithTimeout(
  callFn: (signal: AbortSignal) => Promise<unknown>,
  options?: { timeoutMs?: number; label?: string; externalSignal?: AbortSignal }
): Promise<unknown> {
  const label = options?.label ?? 'moonshot.chat.completions';
  const timeoutMs = options?.timeoutMs ?? LLM_CALL_TIMEOUT_MS;
  const externalSignal = options?.externalSignal;

  if (isCircuitOpen('moonshot')) {
    throw new Error('Circuit breaker OPEN for Moonshot - too many consecutive failures. Retry after cooldown.');
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await withLLMTimeout(
        (signal) => callFn(signal),
        timeoutMs,
        `${label} (attempt ${attempt + 1})`,
        externalSignal,
      );
      recordSuccess('moonshot');
      return result;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES && isTransientError(error)) {
        recordFailure('moonshot');
        const backoff = retryDelayMs(error, attempt);
        log.warn(`${label} transient failure, retrying in ${backoff}ms`, {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
        });
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      if (isTransientError(error)) recordFailure('moonshot');
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
  options?: { timeoutMs?: number; label?: string; externalSignal?: AbortSignal }
): Promise<unknown> {
  const label = options?.label ?? 'gemini.generate';
  const timeoutMs = options?.timeoutMs ?? LLM_CALL_TIMEOUT_MS;
  const externalSignal = options?.externalSignal;

  // G-EXEC-002: Circuit breaker check
  if (isCircuitOpen('gemini')) {
    throw new Error(`Circuit breaker OPEN for Gemini — too many consecutive failures. Retry after cooldown.`);
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Gemini SDK doesn't support AbortSignal — race the call against
      // timeout AND the external (worker-launcher) abort signal. The
      // underlying fetch keeps running until the SDK call resolves, but
      // the outer code stops waiting and returns control to the agent
      // loop within milliseconds of the abort firing.
      const result = await Promise.race([
        callFn(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`LLM call timed out after ${timeoutMs}ms (${label})`)),
            timeoutMs
          )
        ),
        ...(externalSignal
          ? [new Promise<never>((_, reject) => {
              if (externalSignal.aborted) reject(new Error(`LLM call aborted by parent (${label})`));
              else externalSignal.addEventListener('abort', () => reject(new Error(`LLM call aborted by parent (${label})`)), { once: true });
            })]
          : []),
      ]);
      recordSuccess('gemini');
      return result;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES && isTransientError(error)) {
        recordFailure('gemini');
        const backoff = retryDelayMs(error, attempt);
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
