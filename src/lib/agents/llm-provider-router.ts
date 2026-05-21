// llm-provider-router.ts — in-process scoring + ordering for the LLM
// provider chain (openai → anthropic → openrouter → gemini).
//
// Today's (pre-router) behavior: providers are tried in a fixed order; if
// Claude is flaky for an hour, every task pays the timeout penalty before
// falling through. This router records per-provider success rate + EMA
// latency and demotes a provider that has been failing recently. After a
// cooldown the provider is re-tried (a single probe restores its score on
// success), so transient outages self-recover.
//
// Pattern adapted from Clude_gitlawb's smart_router.py (which solved the
// same problem for a multi-LLM CLI). Kept in-process for now; distributed
// scoring would need Redis.

const HALF_LIFE_MS  = 5 * 60 * 1000;     // 5-min EMA half-life on latency
const COOLDOWN_MS   = 60 * 1000;          // re-probe an unhealthy provider after 60s
const MIN_ATTEMPTS_BEFORE_DEMOTE = 3;     // require N attempts before scoring kicks in
const FAILURE_RATE_THRESHOLD = 0.6;       // ≥60% recent failures → unhealthy

interface ProviderStats {
  attempts: number;
  failures: number;
  // Sliding-window failure rate via Laplace smoothing — biased toward 50%
  // when we have few samples, which is the right default (don't punish a
  // provider for one bad run).
  failureRate: number;
  latencyEmaMs: number;            // exponential moving average of success-call latency
  unhealthyUntil: number;          // unix ms; 0 means healthy
  // Track consecutive successes since the last failure. Used to decay
  // historical failure counts so a provider that's recovered from an outage
  // doesn't stay demoted forever.
  consecutiveSuccesses: number;
}

const stats = new Map<string, ProviderStats>();

function getStats(name: string): ProviderStats {
  let s = stats.get(name);
  if (!s) {
    s = { attempts: 0, failures: 0, failureRate: 0, latencyEmaMs: 1000, unhealthyUntil: 0, consecutiveSuccesses: 0 };
    stats.set(name, s);
  }
  return s;
}

/**
 * Record the outcome of a provider attempt. Call this after every LLM call
 * so the router can adapt. Latency is the wall-clock time of the call;
 * success=false includes timeouts, network errors, 5xx, and content errors.
 */
export function recordProviderOutcome(name: string, success: boolean, latencyMs: number): void {
  const s = getStats(name);
  s.attempts++;
  if (!success) {
    s.failures++;
    s.consecutiveSuccesses = 0;
  } else {
    s.consecutiveSuccesses++;
    // Recovery decay: every 5 consecutive successes, drop one historical failure.
    // Without this, a provider that had 10 failures during an outage stays demoted
    // forever even after recovering — the cumulative failure rate never falls
    // below the threshold. The decay lets a recovered provider regain its slot
    // after ~25-50 successful calls, which feels right for "outage forgiveness."
    if (s.consecutiveSuccesses % 5 === 0 && s.failures > 0) {
      s.failures--;
      // Don't decay attempts — we want the smoothing denominator to still
      // give weight to recent samples, just not to past failures.
    }
  }
  // Laplace-smoothed failure rate: (failures + 1) / (attempts + 2)
  s.failureRate = (s.failures + 1) / (s.attempts + 2);

  if (success && latencyMs > 0) {
    const alpha = 0.3;
    s.latencyEmaMs = alpha * latencyMs + (1 - alpha) * s.latencyEmaMs;
  }

  // Recovery dominates: 3 consecutive successes clear an active cooldown
  // even if cumulative failure rate is still high. Without this, the
  // demotion branch below would re-arm cooldown forever after an outage.
  if (success && s.consecutiveSuccesses >= 3) {
    s.unhealthyUntil = 0;
  } else if (s.attempts >= MIN_ATTEMPTS_BEFORE_DEMOTE && s.failureRate >= FAILURE_RATE_THRESHOLD) {
    s.unhealthyUntil = Date.now() + COOLDOWN_MS;
  }
}

/** Higher score = pick first. Demoted providers get a large negative score. */
function score(name: string, preferredOrder: number): number {
  const s = getStats(name);
  const now = Date.now();
  const isUnhealthy = now < s.unhealthyUntil;
  if (isUnhealthy) return -1_000 - preferredOrder;

  // Base score is preferred-order rank (4 for first preferred, 1 for last) so the
  // configured order dominates when all providers are healthy.
  const orderScore = (10 - preferredOrder) * 10;

  // provider averaging 5s gets -25, one averaging 30s gets -150 — enough
  // to flip the order if the preferred one is much slower.
  // Latency is a tie-breaker; hard failures/cooldown are what should demote a
  // preferred provider. This keeps canaries from jumping to unproven paid
  // fallbacks only because the working provider is slower.
  const latencyPenalty = Math.min(s.latencyEmaMs / 1000, 8);

  // Penalty for past failures even when not currently unhealthy.
  const failurePenalty = s.failureRate * 30;

  return orderScore - latencyPenalty - failurePenalty;
}

/**
 * Return the provider names in the order they should be tried. The first-pass
 * fixed-order chain is replaced with a score-based sort that respects the
 * configured preferred order under healthy conditions and demotes flaky
 * providers under unhealthy conditions.
 */
export function pickProviderOrder(availableInPreferredOrder: string[]): string[] {
  return availableInPreferredOrder
    .map((name, idx) => ({ name, score: score(name, idx) }))
    .sort((a, b) => b.score - a.score)
    .map((p) => p.name);
}

/** Test/observability helper. */
export function _resetForTests(): void {
  stats.clear();
}
export function _statsSnapshot(): Record<string, ProviderStats> {
  return Object.fromEntries(stats.entries());
}
