import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callAnthropicWithTimeout, callGeminiWithTimeout, withLLMTimeout } from '@/lib/llm-safety';

// Suppress logger output during tests
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('LLM Safety', () => {
  describe('withLLMTimeout', () => {
    it('returns result when call completes within timeout', async () => {
      const fn = vi.fn(async () => 'success');

      const result = await withLLMTimeout(fn, 5000, 'test');
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('passes AbortSignal to the function', async () => {
      let receivedSignal: AbortSignal | null = null;
      const fn = vi.fn(async (signal: AbortSignal) => {
        receivedSignal = signal;
        return 'done';
      });

      await withLLMTimeout(fn, 5000, 'test');
      expect(receivedSignal).not.toBeNull();
      expect(receivedSignal!.aborted).toBe(false);
    });

    it('throws timeout error when call exceeds timeout', async () => {
      // The function must respect the AbortSignal for the timeout to work
      const slowFn = vi.fn(async (signal: AbortSignal) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve('too slow'), 2000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        });
      });

      await expect(
        withLLMTimeout(slowFn, 50, 'slow_test')
      ).rejects.toThrow('LLM call timed out after 50ms');
    });

    it('times out even when provider SDK ignores AbortSignal', async () => {
      const hangingFn = vi.fn(async () => new Promise(() => {}));

      await expect(
        withLLMTimeout(hangingFn, 25, 'ignored_abort_test')
      ).rejects.toThrow('LLM call timed out after 25ms');
    });

    it('propagates non-timeout errors', async () => {
      const failFn = vi.fn(async () => {
        throw new Error('API key invalid');
      });

      await expect(
        withLLMTimeout(failFn, 5000, 'fail_test')
      ).rejects.toThrow('API key invalid');
    });

    it('cleans up timer after successful completion', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      await withLLMTimeout(async () => 'ok', 5000, 'cleanup');

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('cleans up timer after error', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      try {
        await withLLMTimeout(async () => { throw new Error('fail'); }, 5000, 'cleanup_err');
      } catch {
        // expected
      }

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('callAnthropicWithTimeout', () => {
    it('uses streaming accumulator for large Anthropic output budgets', async () => {
      const finalMessage = { id: 'msg_1', content: [] };
      const create = vi.fn();
      const stream = vi.fn(() => ({
        finalMessage: vi.fn(async () => finalMessage),
      }));

      const result = await callAnthropicWithTimeout(
        { messages: { create, stream } },
        { model: 'claude-sonnet-4-6', max_tokens: 32_000, messages: [] },
        { timeoutMs: 5_000, label: 'test_anthropic_large' },
      );

      expect(result).toBe(finalMessage);
      expect(stream).toHaveBeenCalledOnce();
      expect(create).not.toHaveBeenCalled();
      const streamArgs = stream.mock.calls[0] as unknown[];
      expect(streamArgs[1]).toMatchObject({ signal: expect.any(AbortSignal) });
    });

    it('uses non-streaming create for small Anthropic output budgets', async () => {
      const message = { id: 'msg_2', content: [] };
      const create = vi.fn(async () => message);
      const stream = vi.fn();

      const result = await callAnthropicWithTimeout(
        { messages: { create, stream } },
        { model: 'claude-haiku-4-5', max_tokens: 4_096, messages: [] },
        { timeoutMs: 5_000, label: 'test_anthropic_small' },
      );

      expect(result).toBe(message);
      expect(create).toHaveBeenCalledOnce();
      expect(stream).not.toHaveBeenCalled();
      const createArgs = create.mock.calls[0] as unknown[];
      expect(createArgs[1]).toMatchObject({ signal: expect.any(AbortSignal) });
    });
  });

  describe('callGeminiWithTimeout', () => {
    it('retries per-minute Gemini quota errors when the provider includes RetryInfo', async () => {
      vi.useFakeTimers();
      try {
        const retryable = new Error(
          '[429 Too Many Requests] You exceeded your current quota, please check your plan and billing details. ' +
          'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_paid_tier_input_token_count. ' +
          'Please retry in 0.01s. [{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"0.01s"}]',
        );
        const callFn = vi.fn()
          .mockRejectedValueOnce(retryable)
          .mockResolvedValueOnce('ok');

        const resultPromise = callGeminiWithTimeout(callFn, {
          timeoutMs: 5_000,
          label: 'test_gemini_retryinfo',
        });

        await vi.advanceTimersByTimeAsync(1_100);

        await expect(resultPromise).resolves.toBe('ok');
        expect(callFn).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('backs off longer for generic Gemini resource-exhausted 429s without RetryInfo', async () => {
      vi.useFakeTimers();
      try {
        const retryable = new Error(
          '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent: ' +
          '[429 Too Many Requests] Resource has been exhausted (e.g. check quota).',
        );
        const callFn = vi.fn()
          .mockRejectedValueOnce(retryable)
          .mockResolvedValueOnce('ok');

        const resultPromise = callGeminiWithTimeout(callFn, {
          timeoutMs: 5_000,
          label: 'test_gemini_resource_exhausted',
        });

        await vi.advanceTimersByTimeAsync(64_999);
        expect(callFn).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1_100);

        await expect(resultPromise).resolves.toBe('ok');
        expect(callFn).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
