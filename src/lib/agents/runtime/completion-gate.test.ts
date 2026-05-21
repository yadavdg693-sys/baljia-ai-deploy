import { describe, expect, it } from 'vitest';

import {
  evaluateGateOnExit,
  MAX_SAME_GATE_REASON_CONTINUATIONS,
  MAX_TOTAL_FINALIZATION_CONTINUATIONS,
  type GateState,
} from './completion-gate';

const canaryTask = {
  title: 'CANARY ecommerce-store strict replay',
  description: 'World-class canary run with final replay.',
  tag: 'engineering',
} as never;

const fastTask = {
  title: 'Fix button copy',
  description: 'Small existing UI repair.',
  tag: 'engineering',
} as never;

describe('runtime completion gate continuation budget', () => {
  it('continues through a finalization sweep with different blocker types', () => {
    const reasons = [
      'Cannot mark complete: render_deploy triggered a deploy, but you have not run render_get_logs afterward.',
      'Cannot mark complete: render_deploy triggered a deploy, but you have not run check_url_health afterward.',
      'Cannot mark complete: you pushed code AFTER your last successful verify_user_journey.',
      'Cannot mark complete: you pushed code AFTER your last successful verify_db_state.',
      'Cannot mark complete: you pushed code AFTER your last successful verify_browser_ui.',
      'Cannot mark complete: you pushed code AFTER your last successful verify_interaction_contract.',
      'Cannot mark complete: you pushed code AFTER your last design_audit.',
      'Cannot mark complete: create_report ran before the latest required verification evidence.',
      'Cannot mark complete: write_codebase_map ran before the latest app-changing push/deploy.',
    ];
    const state: GateState = { forcedContinuations: 0 };
    const logs: Record<string, unknown>[] = [];

    for (const reason of reasons) {
      const result = evaluateGateOnExit({
        agentId: 30,
        logEntries: logs,
        task: canaryTask,
        turnCount: logs.length + 1,
        state,
        gate: () => reason,
        pushLog: (target, entry) => target.push(entry),
      });

      expect(result.shouldBreak).toBe(false);
      expect(result.gateMessage).toContain(reason);
      expect(result.gateMessage).toContain('COMPLETION_GATE_BLOCKED');
    }

    expect(state.totalForcedContinuations).toBe(reasons.length);
    expect(logs.at(-1)?.event).toBe('completion_gate_block');
    expect(logs.at(-1)?.attempt).toBe(reasons.length);
  });

  it('turns capability-plan blockers into explicit next-tool instructions', () => {
    const state: GateState = { forcedContinuations: 0 };
    const logs: Record<string, unknown>[] = [];
    const reason = 'Cannot mark complete: this CEO-assigned build/extend task has no capability plan. Call `match_capabilities` with the task/company context before coding.';

    const result = evaluateGateOnExit({
      agentId: 30,
      logEntries: logs,
      task: canaryTask,
      turnCount: 1,
      state,
      gate: () => reason,
      pushLog: (target, entry) => target.push(entry),
    });

    expect(result.shouldBreak).toBe(false);
    expect(result.gateMessage).toContain('must call the `match_capabilities` tool');
    expect(logs.at(-1)?.reason_key).toBe('match_capabilities');
  });

  it('still stops when the same blocker repeats without progress', () => {
    const state: GateState = { forcedContinuations: 0 };
    const logs: Record<string, unknown>[] = [];
    const repeatedReason = 'Cannot mark complete: verify_browser_ui last returned FAIL.';
    let last = { shouldBreak: false, gateMessage: repeatedReason as string | null };

    for (let i = 0; i < MAX_SAME_GATE_REASON_CONTINUATIONS + 1; i++) {
      last = evaluateGateOnExit({
        agentId: 30,
        logEntries: logs,
        task: canaryTask,
        turnCount: i + 1,
        state,
        gate: () => repeatedReason,
        pushLog: (target, entry) => target.push(entry),
      });
    }

    expect(last.shouldBreak).toBe(true);
    expect(logs.at(-1)?.event).toBe('completion_gate_exhausted');
    expect(logs.at(-1)?.reason_key).toBe('verify_browser_ui');
  });

  it('has an absolute finalization cap', () => {
    const state: GateState = { forcedContinuations: 0 };
    const logs: Record<string, unknown>[] = [];
    let last = { shouldBreak: false, gateMessage: 'x' as string | null };

    for (let i = 0; i < MAX_TOTAL_FINALIZATION_CONTINUATIONS + 1; i++) {
      last = evaluateGateOnExit({
        agentId: 30,
        logEntries: logs,
        task: canaryTask,
        turnCount: i + 1,
        state,
        gate: () => `Cannot mark complete: synthetic missing step ${i}.`,
        pushLog: (target, entry) => target.push(entry),
      });
    }

    expect(last.shouldBreak).toBe(true);
    expect(logs.at(-1)?.event).toBe('completion_gate_exhausted');
  });

  it('uses tight continuation caps for fast lane tasks', () => {
    const state: GateState = { forcedContinuations: 0 };
    const logs: Record<string, unknown>[] = [];
    const reason = 'Cannot mark complete: verify_browser_ui last returned FAIL.';

    const first = evaluateGateOnExit({
      agentId: 30,
      logEntries: logs,
      task: fastTask,
      turnCount: 1,
      state,
      gate: () => reason,
      pushLog: (target, entry) => target.push(entry),
    });
    const second = evaluateGateOnExit({
      agentId: 30,
      logEntries: logs,
      task: fastTask,
      turnCount: 2,
      state,
      gate: () => reason,
      pushLog: (target, entry) => target.push(entry),
    });

    expect(first.shouldBreak).toBe(false);
    expect(second.shouldBreak).toBe(true);
    expect(logs.at(-1)?.event).toBe('completion_gate_exhausted');
    expect(logs.at(-1)?.lane).toBe('fast');
  });
});
