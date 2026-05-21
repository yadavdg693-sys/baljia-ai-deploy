import { describe, expect, it } from 'vitest';
import { isTransientProviderError, providerAttemptEvent, shouldResumeProviderAfterProgress } from './provider-loop';

describe('provider attempt events', () => {
  it('preserves provider fallback observability fields', () => {
    expect(providerAttemptEvent({
      provider: 'openai',
      model: 'gpt-5.4',
      status: 'failed',
      latencyMs: 1234,
      error: 'rate limit',
    })).toEqual({
      event: 'provider_failed',
      provider: 'openai',
      model: 'gpt-5.4',
      latency_ms: 1234,
      error: 'rate limit',
      metadata: null,
    });
  });

  it('resumes after progress for provider credential failures when another provider is available', () => {
    expect(shouldResumeProviderAfterProgress({
      message: '401 {"type":"authentication_error","message":"Invalid authentication credentials"}',
      hasNextProvider: true,
    })).toBe(true);

    expect(shouldResumeProviderAfterProgress({
      message: '401 {"type":"authentication_error","message":"Invalid authentication credentials"}',
      hasNextProvider: false,
    })).toBe(false);

    expect(shouldResumeProviderAfterProgress({
      message: 'tool contract failed: missing required route',
      hasNextProvider: true,
    })).toBe(false);
  });

  it('resumes after progress for Anthropic internal api_error failures when another provider exists', () => {
    expect(shouldResumeProviderAfterProgress({
      message: '{"type":"error","error":{"type":"api_error","message":"Internal server error"},"request_id":"req_123"}',
      hasNextProvider: true,
    })).toBe(true);
  });

  it('resumes after progress for streamed tool JSON parse failures', () => {
    expect(shouldResumeProviderAfterProgress({
      message: "Expected ',' or ']' after array element in JSON at position 4802 (line 1 column 4803)",
      hasNextProvider: true,
    })).toBe(true);
  });

  it('resumes after progress for provider runtime null-deref slice failures', () => {
    expect(shouldResumeProviderAfterProgress({
      message: "Cannot read properties of undefined (reading 'slice')",
      hasNextProvider: true,
    })).toBe(true);
  });

  it('does not classify quota/billing failures as transient retries, but can fall through to another provider', () => {
    const message = '402 This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 1658.';

    expect(isTransientProviderError(message)).toBe(false);
    expect(shouldResumeProviderAfterProgress({
      message,
      hasNextProvider: true,
    })).toBe(true);
  });
});
