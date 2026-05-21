// Per-run cost tracking primitives for the agent watchdog.
//
// Two responsibilities:
//   1. Convert (input, output, model) → USD via a model price table.
//   2. Resolve the per-agent USD ceiling that the watchdog enforces.
//
// Pricing rates mirror the Sonnet-only constants in
// platform-ops.service.ts:91-92 — kept inline here (rather than extracted
// into a shared pricing service) until a third consumer needs them.

import type { Task } from '@/types';
import { getTaskLanePolicy } from './task-lane';

export interface ModelPricing {
  input: number;   // USD per token
  output: number;  // USD per token
}

// Public list-prices in USD per token (USD per million ÷ 1_000_000), as of
// 2026-04. Each Bedrock variant maps to the same family rate. The 'default'
// row is a safe fallback so an unknown model never trips a hard kill from
// undefined math.
export const MODEL_PRICING_USD_PER_TOKEN: Record<string, ModelPricing> = {
  // Anthropic Claude direct model IDs
  'claude-sonnet-4-6':                    { input: 3 / 1_000_000,  output: 15 / 1_000_000 },
  'claude-opus-4-6':                      { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-opus-4-7':                      { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-haiku-4-5-20251001':            { input: 1 / 1_000_000,  output: 5 / 1_000_000 },

  // Bedrock-prefixed variants
  'us.anthropic.claude-sonnet-4-20250514-v1:0':   { input: 3 / 1_000_000,  output: 15 / 1_000_000 },
  'us.anthropic.claude-haiku-4-5-20251001-v1:0':  { input: 1 / 1_000_000,  output: 5 / 1_000_000 },

  // Other providers (rough public rates — refine when/if real bills land)
  'gpt-5.4':                              { input: 5 / 1_000_000,  output: 15 / 1_000_000 },
  'gemini-2.5-flash':                     { input: 0.10 / 1_000_000, output: 0.30 / 1_000_000 },

  // Conservative fallback — assume mid-tier rates so unknown models can't
  // cost-bypass the ceiling silently.
  'default':                              { input: 3 / 1_000_000,  output: 15 / 1_000_000 },
};

export function computeCostUsd(inputTokens: number, outputTokens: number, model: string): number {
  const rate = MODEL_PRICING_USD_PER_TOKEN[model] ?? MODEL_PRICING_USD_PER_TOKEN['default'];
  return inputTokens * rate.input + outputTokens * rate.output;
}

// Per-agent USD ceiling — backstop against runaway runs. Sized roughly:
//   - Engineering: longest tool-call chains on Sonnet, file generation
//   - Browser: Browserbase per-minute on top of LLM tokens
//   - Research / Data: shorter chains, fewer giant payloads
//   - Support / Twitter / MetaAds / ColdOutreach: short, structured runs
//   - CEO chat: 5-turn reactive ceiling on Opus
const AGENT_COST_CEILINGS_USD: Record<number, number> = {
  0:  0.20,  // CEO/chat (Opus, 5 turns reactive)
  29: 0.50,  // Research
  30: 1.50,  // Engineering — base; scaled by task complexity, see below
  32: 0.30,  // Support
  33: 0.50,  // Data
  40: 0.30,  // Twitter
  41: 0.30,  // MetaAds
  42: 1.00,  // Browser (Browserbase + LLM)
  54: 0.30,  // ColdOutreach
};

const DEFAULT_AGENT_COST_CEILING_USD = 0.50;

// Engineering tasks at high complexity need budget for the full
// commit → deploy → check_url_health → render_get_logs → fix → redeploy
// iteration loop. The flat $1.50 ceiling fits a "Hello World deploy" but
// truncates real MVP work mid-iteration. Scale per task complexity (1-10).
// Bumped 2026-05-11 after the equityzen Q&A endpoint task: agent reached
// deploy + journey-verify in 54 turns, ~$2 spend, but had no headroom for
// the 2-3 fix iterations that would have addressed the 502 and the static-
// scan findings. New ceilings give each complexity tier ~2 extra fix loops.
const ENGINEERING_CEILING_BY_COMPLEXITY: Record<number, number> = {
  1: 1.50, 2: 1.50, 3: 2.00, 4: 2.50, 5: 3.00,
  6: 5.00, 7: 7.00, 8: 9.00, 9: 11.00, 10: 13.00,
};

/**
 * Returns the per-agent USD cost ceiling, OR `null` to disable the ceiling
 * entirely. The Watchdog treats `null` as "no ceiling, no kill, no warning" —
 * the run still tracks tokens and persists `task_executions.token_usage`,
 * but the agent isn't killed when spend exceeds anything.
 *
 * Set `DISABLE_COST_CEILING=true` (or `=1`) in env to disable for testing.
 * The agent still sees its turn count in the BUDGET summary; just no $-cap.
 */
export function getCostCeilingForAgent(agentId: number, complexity?: number | null): number | null {
  if (process.env.DISABLE_COST_CEILING === 'true' || process.env.DISABLE_COST_CEILING === '1') {
    return null;
  }
  if (agentId === 30 && typeof complexity === 'number' && complexity >= 1 && complexity <= 10) {
    return ENGINEERING_CEILING_BY_COMPLEXITY[Math.round(complexity)] ?? AGENT_COST_CEILINGS_USD[30];
  }
  return AGENT_COST_CEILINGS_USD[agentId] ?? DEFAULT_AGENT_COST_CEILING_USD;
}

export function getCostCeilingForTask(agentId: number, task?: Pick<Task,
  'title' | 'description' | 'tag' | 'source' | 'complexity' |
  'execution_mode' | 'verification_level' | 'estimated_credits' | 'max_turns'
> | null): number | null {
  if (process.env.DISABLE_COST_CEILING === 'true' || process.env.DISABLE_COST_CEILING === '1') {
    return null;
  }
  if (agentId !== 30 || !task) {
    return getCostCeilingForAgent(agentId, task?.complexity);
  }

  const policy = getTaskLanePolicy(task);
  if (policy.costCeilingUsd !== 'complexity') {
    if (policy.lane === 'standard') {
      const complexityCeiling = getCostCeilingForAgent(agentId, task.complexity ?? policy.defaultComplexity) ?? policy.costCeilingUsd;
      return Math.min(Math.max(complexityCeiling, 1.5), 2.5);
    }
    if (policy.lane === 'strict') {
      const complexityCeiling = getCostCeilingForAgent(agentId, task.complexity ?? policy.defaultComplexity) ?? policy.costCeilingUsd;
      return Math.min(Math.max(complexityCeiling, 5), 7);
    }
    return policy.costCeilingUsd;
  }

  return getCostCeilingForAgent(agentId, task.complexity ?? policy.defaultComplexity);
}
