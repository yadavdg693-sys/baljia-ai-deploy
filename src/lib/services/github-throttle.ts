// In-process throttle for GitHub API calls.
//
// Protects against:
//   1. Secondary rate limit "≥80 concurrent requests" by capping concurrency
//      to a conservative budget (20).
//   2. Burst-induced 429s by auto-retrying with Retry-After backoff.
//
// Does NOT protect against the primary 5,000/hour token-bucket — for that,
// switch to a GitHub App installation token (Tier 3) or use ETag conditional
// requests (which don't count against the limit when they 304).
//
// Scope: in-process. Multiple platform processes running concurrently won't
// coordinate. Distributed throttling would need Redis; deferred until needed.

const DEFAULT_MAX_CONCURRENT = 20; // well under GitHub's 80 secondary limit
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_AFTER_FALLBACK_MS = 5_000;

class Semaphore {
  private inflight = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly maxConcurrent: number) {}

  async acquire(): Promise<() => void> {
    if (this.inflight >= this.maxConcurrent) {
      await new Promise<void>((resolve) => { this.queue.push(resolve); });
    }
    this.inflight++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inflight--;
      const next = this.queue.shift();
      if (next) next();
    };
  }

  // For tests + observability.
  get stats(): { inflight: number; queued: number } {
    return { inflight: this.inflight, queued: this.queue.length };
  }
}

const semaphore = new Semaphore(
  Number(process.env.GITHUB_MAX_CONCURRENT) || DEFAULT_MAX_CONCURRENT
);

/**
 * Throttled GitHub API fetch.
 *
 * Use this instead of bare `fetch()` for any call to api.github.com so that
 * (a) we never exceed the secondary concurrent-request limit and (b) 429
 * responses trigger a Retry-After backoff instead of leaking up to callers.
 */
export async function githubFetch(input: string, init?: RequestInit): Promise<Response> {
  const release = await semaphore.acquire();
  try {
    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
      const res = await fetch(input, init);
      lastResponse = res;
      // Retry on 429 (rate limited) and 403 with rate-limit headers.
      const isThrottled = res.status === 429
        || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0'
                                || /rate limit/i.test(res.headers.get('x-github-media-type') ?? '')));
      if (!isThrottled || attempt === DEFAULT_MAX_RETRIES) {
        return res;
      }

      // Respect Retry-After if present (seconds, per HTTP spec). Otherwise fall back.
      const retryAfterRaw = res.headers.get('retry-after');
      const retryAfterMs = retryAfterRaw
        ? Math.max(1_000, Number(retryAfterRaw) * 1_000)
        : DEFAULT_RETRY_AFTER_FALLBACK_MS * (attempt + 1); // back off harder on each retry

      // Drain the body so the connection can be reused.
      try { await res.arrayBuffer(); } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, retryAfterMs));
    }
    return lastResponse as Response;
  } finally {
    release();
  }
}

/** Test/observability helper. */
export function githubThrottleStats(): { inflight: number; queued: number } {
  return semaphore.stats;
}
