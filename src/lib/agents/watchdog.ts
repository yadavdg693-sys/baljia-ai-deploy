// Watchdog Monitor — prevents runaway agents
// Architecture: Domain 5.4 max ~4 hours per task, max 200 turns
// Tracks progress, detects idle/stuck, can kill execution

import type { WatchdogEvent } from '@/types';

// Timeouts
const IDLE_WARNING_MS = 2 * 60 * 1000;   // 2 min idle → warning
const STUCK_DETECT_MS = 5 * 60 * 1000;   // 5 min idle → stuck
const MAX_EXECUTION_MS = 4 * 60 * 60 * 1000; // 4 hours absolute max

export class Watchdog {
  private taskId: string;
  private maxTurns: number;
  private companyId: string;
  private events: WatchdogEvent[] = [];
  private turnCount = 0;
  private lastActivityAt: number;
  private startedAt: number;
  private killed = false;

  constructor(taskId: string, maxTurns: number, companyId: string) {
    this.taskId = taskId;
    this.maxTurns = maxTurns;
    this.companyId = companyId;
    this.startedAt = Date.now();
    this.lastActivityAt = Date.now();
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
