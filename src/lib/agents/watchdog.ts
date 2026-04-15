// Watchdog Monitor — prevents runaway agents
// Architecture: Domain 5.4 max ~4 hours per task, max 200 turns
// Tracks progress, detects idle/stuck, can kill execution
// H-AGENT-020: Tool-call loop detection — kill agent on repeated same-tool calls

import type { WatchdogEvent } from '@/types';

// Timeouts
const IDLE_WARNING_MS = 2 * 60 * 1000;   // 2 min idle → warning
const STUCK_DETECT_MS = 5 * 60 * 1000;   // 5 min idle → stuck
const MAX_EXECUTION_MS = 4 * 60 * 60 * 1000; // 4 hours absolute max

// Loop detection: if same tool called this many times consecutively, kill
const LOOP_THRESHOLD = 5;
// Rolling window of recent tool names to track
const TOOL_HISTORY_SIZE = 8;

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
  private recentTools: string[] = [];
  // Active monitor interval (Step 6.6)
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private onKillCallback: (() => void) | null = null;

  constructor(taskId: string, maxTurns: number, companyId: string) {
    this.taskId = taskId;
    this.maxTurns = maxTurns;
    this.companyId = companyId;
    this.startedAt = Date.now();
    this.lastActivityAt = Date.now();
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

  recordToolCall(toolName: string): WatchdogVerdict {
    this.recentTools.push(toolName);
    // Keep only the most recent N entries
    if (this.recentTools.length > TOOL_HISTORY_SIZE) {
      this.recentTools.shift();
    }

    // Check for loop: same tool called LOOP_THRESHOLD times consecutively
    if (this.recentTools.length >= LOOP_THRESHOLD) {
      const tail = this.recentTools.slice(-LOOP_THRESHOLD);
      const allSame = tail.every((t) => t === tail[0]);
      if (allSame) {
        this.addEvent('loop_detected', toolName,
          `Tool "${toolName}" called ${LOOP_THRESHOLD} times consecutively — killing agent`);
        this.killed = true;
        return 'kill';
      }
    }

    return 'continue';
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
    return [...this.recentTools];
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
