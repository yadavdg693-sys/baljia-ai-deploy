// Template Executor — known-pattern tasks with project-specific customization
// Uses Haiku model with moderate turn cap (≤30 turns)
// Tags: landing-page, auth, billing, settings, legal, pricing-page, etc.
//
// These are tasks with well-known solutions (standard auth flow, CRUD layout,
// form template) that need customization with company-specific details.
// The executor uses Haiku (cheaper than Sonnet) with:
//   - Same tool surface as full_agent
//   - A 30-turn cap (vs 200 for full_agent)
//   - A system prompt that encourages following established patterns

import { runAgentLoop } from './agent-factory';
import type { AgentInput, AgentResult } from './agent-factory';
import { OPENROUTER_MODELS } from '@/lib/llm-provider';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TEMPLATE_TURNS = 30;

const TEMPLATE_SYSTEM_PROMPT = `## Execution Mode: TEMPLATE + PARAMS

This task follows a known, established pattern. Your job is to customize it with project-specific details.

Rules:
1. Use standard, well-established patterns (standard auth flows, CRUD layouts, form templates, etc.)
2. Customize with company branding, naming, and specific requirements from the briefing
3. Don't over-engineer — follow the well-known solution path
4. Complete in under ${MAX_TEMPLATE_TURNS} turns
5. Create a report summarizing what was built and any customizations applied

Efficiency over novelty. Follow the template, apply the params.`;

/**
 * Execute a template_plus_params task using Haiku with a moderate turn cap.
 * Same interface as executeAgent — drop-in replacement for template execution_mode.
 */
export async function executeTemplate(input: AgentInput): Promise<AgentResult> {
  return runAgentLoop(input, {
    claudeModel: HAIKU_MODEL,
    openRouterModel: OPENROUTER_MODELS.TEMPLATE,
    geminiModel: 'gemini-2.0-flash-lite',  // Lighter Gemini for template mode
    maxTurns: Math.min(input.task.max_turns, MAX_TEMPLATE_TURNS),
    systemPromptOverride: TEMPLATE_SYSTEM_PROMPT,
  });
}
