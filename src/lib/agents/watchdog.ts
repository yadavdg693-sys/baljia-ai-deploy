// Watchdog Monitor — prevents runaway agents
// Architecture: Domain 5.4 max ~4 hours per task, max 200 turns
// Tracks progress, detects idle/stuck, can kill execution
// H-AGENT-020: Tool-call loop detection — kill agent on repeated same-tool calls
// Cost ceiling: Per-run USD budget visible to the agent + hard kill on exceed.

import type { WatchdogEvent } from '@/types';
import { computeCostUsd } from './cost-ceilings';

// Timeouts
const IDLE_WARNING_MS = 5 * 60 * 1000;   // 5 min idle → warning
// Render deploy/status tools poll internally for up to 10-15 minutes. Keep the
// stuck window above that so real infrastructure waits are not killed mid-tool.
const STUCK_DETECT_MS = 20 * 60 * 1000;  // 20 min idle → stuck
const MAX_EXECUTION_MS = 4 * 60 * 60 * 1000; // 4 hours absolute max

// Loop detection: if same tool called this many times consecutively, kill.
// Raised from 5 → 8: the engineering agent legitimately calls read_skill
// 4-5 times in one turn (reading all relevant skills in parallel).
// 8 consecutive identical calls is a genuine infinite loop FOR MOST TOOLS.
const LOOP_THRESHOLD = 8;
// Rolling window of recent tool names to track
// Must be ≥ the largest detection threshold or that threshold is unreachable.
// We track POLLING_LOOP_THRESHOLD (50) consecutive identical calls as the
// outer bound; bump the history buffer past that. Small overhead — each
// entry is a short tool-name string.
const TOOL_HISTORY_SIZE = 60;

// Polling tools that legitimately need many consecutive calls (waiting on
// async infrastructure to finish). Render builds take 2-5 min, the agent
// polls every ~3-5 sec, so 8 consecutive calls is normal — not a loop.
// Use a much higher threshold for these specifically.
const POLLING_TOOLS = new Set<string>([
  'render_get_deploy_status',
  'render_get_logs',
  'check_url_health',
  'verify_custom_domain',
]);

// Multi-step tools that the engineering agent legitimately calls many times
// in a row with DIFFERENT args (e.g. one migration per table, one commit
// per file). The standard loop detector tracks tool NAME only, so these
// look identical even though each call is doing different work. Equityzen
// task at turn 14 was loop-killed mid-migration sequence — these tools need
// the same exemption polling tools get.
const MULTI_STEP_TOOLS = new Set<string>([
  'run_migration',
  'github_create_commit',
  'github_push_file',
  'github_read_file',
  'github_create_branch',
  'github_create_pr',
  'query_company_db',
  'static_code_scan',
  'review_pushed_code',
  'read_skill',
  'get_capability_pack',
  'get_reference_repo_patterns',
]);
// Bumped 25 → 50 on 2026-05-11 after iteration 4: agent polled
// render_get_deploy_status 25× consecutively waiting for a slow Render
// build to finish. Render builds legitimately take 5-12 min; with each
// poll a separate turn, the old threshold killed legitimate work.
const POLLING_LOOP_THRESHOLD = 50;

// Cost ceiling: emit warning event the first time spend crosses this fraction.
const COST_WARNING_FRACTION = 0.8;

export class Watchdog {
  private taskId: string;
  private maxTurns: number;
  private companyId: string;
  private events: WatchdogEvent[] = [];
  private turnCount = 0;
  private lastActivityAt: number;
  private startedAt: number;
  private killed = false;

  // H-AGENT-020: Track recent tool calls for loop detection
  private recentTools: Array<{ name: string; signature: string }> = [];
  // Active monitor interval (Step 6.6)
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private onKillCallback: (() => void) | null = null;

  // Cost tracking (null ceiling = tracking off, ceiling never trips)
  private costCeilingUsd: number | null;
  private cumulativeInputTokens = 0;
  private cumulativeOutputTokens = 0;
  private cumulativeCostUsd = 0;
  private modelBreakdown: Record<string, { in: number; out: number; usd: number }> = {};
  private costWarnedAt80 = false;

  constructor(taskId: string, maxTurns: number, companyId: string, costCeilingUsd?: number | null) {
    this.taskId = taskId;
    this.maxTurns = maxTurns;
    this.companyId = companyId;
    this.startedAt = Date.now();
    this.lastActivityAt = Date.now();
    this.costCeilingUsd = costCeilingUsd ?? null;
  }

  /** Override max turns (used by execution mode dispatch to cap deterministic/template runs) */
  setMaxTurns(turns: number): void {
    this.maxTurns = turns;
  }

  // ── Called by agent on each turn ──

  recordTurn(toolName: string | null): WatchdogVerdict {
    this.turnCount++;
    this.lastActivityAt = Date.now();

    this.addEvent('progress', toolName, `Turn ${this.turnCount}/${this.maxTurns}`);

    // Check turn limit
    if (this.turnCount >= this.maxTurns) {
      this.addEvent('killed', toolName, `Max turns reached (${this.maxTurns})`);
      this.killed = true;
      return 'kill';
    }

    // Check absolute time limit
    const elapsed = Date.now() - this.startedAt;
    if (elapsed >= MAX_EXECUTION_MS) {
      this.addEvent('killed', toolName, `Max execution time reached (4h)`);
      this.killed = true;
      return 'kill';
    }

    return 'continue';
  }

  // ── H-AGENT-020: Record tool calls for loop detection ──
  // Call this for each tool call within a turn (a turn may have multiple tool calls).

  recordToolCall(toolName: string, input?: unknown): WatchdogVerdict {
    this.lastActivityAt = Date.now();
    this.recentTools.push({ name: toolName, signature: toolCallSignature(toolName, input) });
    // Keep only the most recent N entries
    if (this.recentTools.length > TOOL_HISTORY_SIZE) {
      this.recentTools.shift();
    }

    // Polling tools (render_get_deploy_status, check_url_health waiting for
    // first 200, etc.) legitimately need many consecutive calls. Multi-step
    // tools (run_migration with different SQL, github_create_commit on
    // different files) legitimately repeat too. Use a higher threshold for
    // both; otherwise legitimate work trips the loop detector.
    const isPolling = POLLING_TOOLS.has(toolName);
    const isMultiStep = MULTI_STEP_TOOLS.has(toolName);
    const threshold = isPolling || isMultiStep ? POLLING_LOOP_THRESHOLD : LOOP_THRESHOLD;
    const reason = isPolling ? 'polling-tool threshold' : isMultiStep ? 'multi-step-tool threshold' : 'standard threshold';

    // Check for loop: same tool called `threshold` times consecutively
    if (this.recentTools.length >= threshold) {
      const tail = this.recentTools.slice(-threshold);
      const allSame = tail.every((t) => t.signature === tail[0]?.signature);
      if (allSame) {
        this.addEvent('loop_detected', toolName,
          `Tool "${toolName}" called ${threshold} times consecutively — killing agent (${reason})`);
        this.killed = true;
        return 'kill';
      }
    }

    return 'continue';
  }

  // ── Cost tracking — call after each LLM response with that turn's usage ──

  /**
   * Touch activity for long-running non-turn work such as Render polling,
   * browser verification, report writing, or DB progress flushes. Unlike
   * recordTurn/recordToolCall this does not affect turn count or loop history.
   */
  recordHeartbeat(reason: string, toolName: string | null = null): void {
    this.lastActivityAt = Date.now();
    this.addEvent('heartbeat', toolName, reason);
  }

  recordTokens(inputTokens: number, outputTokens: number, model: string): WatchdogVerdict {
    if (!Number.isFinite(inputTokens) || inputTokens < 0) inputTokens = 0;
    if (!Number.isFinite(outputTokens) || outputTokens < 0) outputTokens = 0;

    const turnCostUsd = computeCostUsd(inputTokens, outputTokens, model);

    this.cumulativeInputTokens += inputTokens;
    this.cumulativeOutputTokens += outputTokens;
    this.cumulativeCostUsd += turnCostUsd;

    const slot = this.modelBreakdown[model] ?? { in: 0, out: 0, usd: 0 };
    slot.in += inputTokens;
    slot.out += outputTokens;
    slot.usd += turnCostUsd;
    this.modelBreakdown[model] = slot;

    if (this.costCeilingUsd === null) return 'continue';

    const fraction = this.cumulativeCostUsd / this.costCeilingUsd;

    if (fraction >= 1) {
      this.addEvent('cost_kill', null,
        `Cost ceiling exceeded: $${this.cumulativeCostUsd.toFixed(4)} / $${this.costCeilingUsd.toFixed(2)}`);
      this.killed = true;
      return 'kill';
    }

    if (fraction >= COST_WARNING_FRACTION && !this.costWarnedAt80) {
      this.costWarnedAt80 = true;
      this.addEvent('cost_warning', null,
        `Cost at ${Math.round(fraction * 100)}% of ceiling: $${this.cumulativeCostUsd.toFixed(4)} / $${this.costCeilingUsd.toFixed(2)}`);
      return 'warn';
    }

    return 'continue';
  }

  /**
   * One-line summary suitable for injection into the agent's per-turn context.
   * Format: `BUDGET: turn N/M (P%) · $X.XXXX/$Y.YY spent (Q%)`
   * If no ceiling is set, the cost portion is omitted.
   */
  getBudgetSummary(): string {
    const turnPct = this.maxTurns > 0 ? Math.round((this.turnCount / this.maxTurns) * 100) : 0;
    const turnPart = `turn ${this.turnCount}/${this.maxTurns} (${turnPct}%)`;
    const nearTurnLimit = turnPct >= 80;
    if (this.costCeilingUsd === null) {
      return nearTurnLimit
        ? `BUDGET: ${turnPart} - NEAR LIMIT: stop optional work; finish only if lane-required evidence is clean, otherwise report the blocker from current evidence.`
        : `BUDGET: ${turnPart}`;
    }
    const costPct = Math.round((this.cumulativeCostUsd / this.costCeilingUsd) * 100);
    const costPart = `$${this.cumulativeCostUsd.toFixed(4)}/$${this.costCeilingUsd.toFixed(2)} spent (${costPct}%)`;
    if (nearTurnLimit || costPct >= 80) {
      return `BUDGET: ${turnPart} - ${costPart} - NEAR LIMIT: stop optional work; finish only if lane-required evidence is clean, otherwise report the blocker from current evidence.`;
    }
    return `BUDGET: ${turnPart} · ${costPart}`;
  }

  /** Structured cost snapshot — persisted into task_executions.token_usage. */
  getCostStatus(): {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    ceiling_usd: number | null;
    model_breakdown: Record<string, { in: number; out: number; usd: number }>;
  } {
    return {
      input_tokens: this.cumulativeInputTokens,
      output_tokens: this.cumulativeOutputTokens,
      cost_usd: Number(this.cumulativeCostUsd.toFixed(6)),
      ceiling_usd: this.costCeilingUsd,
      model_breakdown: { ...this.modelBreakdown },
    };
  }

  // ── Periodic health check (call between turns) ──

  checkHealth(): WatchdogVerdict {
    const idleMs = Date.now() - this.lastActivityAt;

    if (idleMs >= STUCK_DETECT_MS) {
      this.addEvent('stuck_detected', null, `No activity for ${Math.round(idleMs / 1000)}s`);
      this.killed = true;
      return 'kill';
    }

    if (idleMs >= IDLE_WARNING_MS) {
      this.addEvent('idle_warning', null, `Idle for ${Math.round(idleMs / 1000)}s`);
      return 'warn';
    }

    return 'continue';
  }

  // ── State queries ──

  wasKilled(): boolean {
    return this.killed;
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  getEvents(): WatchdogEvent[] {
    return [...this.events];
  }

  getElapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  getLoopToolHistory(): string[] {
    return this.recentTools.map((entry) => entry.name);
  }

  /**
   * Start active monitoring with periodic health checks (30s interval).
   * Automatically kills the agent if stuck/idle is detected.
   * Call stopMonitor() in a finally block to clean up.
   */
  startActiveMonitor(onKill?: () => void): void {
    this.onKillCallback = onKill ?? null;
    if (this.monitorInterval) return; // Already running

    this.monitorInterval = setInterval(() => {
      const verdict = this.checkHealth();
      if (verdict === 'kill' && this.onKillCallback) {
        this.onKillCallback();
        this.stopMonitor();
      }
    }, 30_000); // 30 second intervals
  }

  /** Stop the active monitor interval. Safe to call multiple times. */
  stopMonitor(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  // ── Internal ──

  private addEvent(type: WatchdogEvent['type'], tool: string | null, message: string): void {
    this.events.push({
      timestamp: new Date().toISOString(),
      type,
      tool,
      message,
    });
  }
}

export type WatchdogVerdict = 'continue' | 'warn' | 'kill';

function toolCallSignature(toolName: string, input: unknown): string {
  if (input === undefined) return toolName;
  return `${toolName}:${hashString(stableSerialize(input))}`;
}

function stableSerialize(value: unknown, depth = 0): string {
  if (depth > 6) return '[depth]';
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item, depth + 1)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key], depth + 1)}`).join(',')}}`;
  }
  return String(value);
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}
