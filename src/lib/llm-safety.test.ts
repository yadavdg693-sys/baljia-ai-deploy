import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withLLMTimeout } from '@/lib/llm-safety';

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
});
