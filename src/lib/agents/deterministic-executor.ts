// Deterministic Executor — fast-path for mechanical tasks
// Uses Haiku model with tight turn cap (≤10 turns)
// Tags: css, seo, seo-meta, domain, tracking, favicon, deploy, config, copy
//
// These are tasks where the "what to do" is clear from the tag alone.
// The executor still uses an LLM (Haiku) for flexibility, but with:
//   - A tighter system prompt that discourages reasoning/deliberation
//   - A 10-turn cap (vs 200 for full_agent)
//   - Haiku instead of Sonnet (cheaper, faster)

import { runAgentLoop } from './agent-factory';
import type { AgentInput, AgentResult } from './agent-factory';
import { OPENROUTER_MODELS } from '@/lib/llm-provider';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_DETERMINISTIC_TURNS = 10;

const DETERMINISTIC_SYSTEM_PROMPT = `## Execution Mode: DETERMINISTIC (fast-path)

You are executing a mechanical, straightforward task. Follow these rules strictly:

1. Do NOT deliberate, explore alternatives, or make design decisions
2. Apply the change directly based on the task description and tag
3. Use the minimum number of tool calls needed
4. If the task is ambiguous or unclear, immediately report it as blocked — do NOT guess
5. Complete in under ${MAX_DETERMINISTIC_TURNS} turns
6. Create a brief report summarizing exactly what was changed

This is a deterministic task — speed and precision over creativity.`;

/**
 * Execute a deterministic task using Haiku with a tight turn cap.
 * Same interface as executeAgent — drop-in replacement for deterministic execution_mode.
 */
export async function executeDeterministic(input: AgentInput): Promise<AgentResult> {
  return runAgentLoop(input, {
    claudeModel: HAIKU_MODEL,
    openRouterModel: OPENROUTER_MODELS.DETERMINISTIC,
    geminiModel: 'gemini-2.0-flash-lite',  // Lighter Gemini for deterministic mode
    maxTurns: Math.min(input.task.max_turns, MAX_DETERMINISTIC_TURNS),
    systemPromptOverride: DETERMINISTIC_SYSTEM_PROMPT,
  });
}
