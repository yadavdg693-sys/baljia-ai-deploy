export interface ProviderAttemptRecord {
  provider: string;
  model?: string;
  status: 'started' | 'succeeded' | 'failed' | 'skipped';
  latencyMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export function providerAttemptEvent(attempt: ProviderAttemptRecord): Record<string, unknown> {
  return {
    event: `provider_${attempt.status}`,
    provider: attempt.provider,
    model: attempt.model ?? null,
    latency_ms: attempt.latencyMs ?? null,
    error: attempt.error ?? null,
    metadata: attempt.metadata ?? null,
  };
}

export function isTransientProviderError(message: string): boolean {
  const normalized = message.toLowerCase();
  if (isQuotaOrBillingProviderError(normalized)) return false;
  return /api connection|connection error|api_error|internal server error|sse error|econnreset|etimedout|timeout|fetch failed|socket hang up|rate limit|429|500|502|503|504|temporarily unavailable|overloaded|network|partial-json-parser|invalid json|unterminated string|expected .*json|expected .* after .* json|tool_use.*json|malformed .*tool|cannot read properties of undefined .*slice/i.test(normalized);
}

export function isQuotaOrBillingProviderError(message: string): boolean {
  const normalized = message.toLowerCase();
  return /insufficient balance|requires more credits|exceeded_current_quota|billing|recharge|suspended due to insufficient balance|can only afford|adjust the key's total limit/i.test(normalized);
}

export function isCredentialProviderError(message: string): boolean {
  const normalized = message.toLowerCase();
  return /401|403|authentication_error|invalid authentication credentials|invalid api key|api key|unauthorized|forbidden|credential/i.test(normalized);
}

export function shouldResumeProviderAfterProgress(params: {
  message: string;
  hasNextProvider: boolean;
  abortSignalAborted?: boolean;
  watchdogKilled?: boolean;
}): boolean {
  if (params.abortSignalAborted || params.watchdogKilled || !params.hasNextProvider) return false;
  return isTransientProviderError(params.message) || isCredentialProviderError(params.message) || isQuotaOrBillingProviderError(params.message);
}
