// TEMP: pre-Phase-3a strategy selection.
// Replaced by per-journey idea processing (refine_idea/fetch_business_url/invent_idea) in Phase 3a.
// Keeps pipeline functional during Phase 0 refactor.

import { getCapabilityConstraint } from '@/lib/platform-capabilities';
import { callSmallLLM } from '../llm/small-llm';
import { appendMemorySection } from './memory-sections';
import type { PipelineContext } from '../types';

export async function selectStrategy(ctx: PipelineContext): Promise<void> {
  const capabilityConstraint = getCapabilityConstraint();

  if (ctx.journey !== 'surprise_me') {
    ctx.strategy = ctx.journey;
    if (ctx.founderAngle) {
      ctx.strategy = `${ctx.journey} | ${ctx.founderAngle.slice(0, 80).replace(/\.\s.*$/, '')}`;
    }
    return;
  }

  // Surprise Me: generate a specific AI-enabled startup idea from founder background
  const backgroundContext = [ctx.founderAngle, ctx.enrichedFounderSummary]
    .filter(Boolean)
    .join('\n')
    .slice(0, 500);

  if (!backgroundContext) {
    throw new Error('Strategy generation failed: no founder background available for "surprise_me" journey');
  }

  const prompt = `Based on this founder's background, suggest a specific AI-enabled startup idea they should build.

${capabilityConstraint}

Background:
${backgroundContext}

Reply in this format (2 lines, nothing else):
IDEA: <one sentence: what it does and exactly who it's for>
REASONING: <one sentence: why this founder + this idea + this platform = credible>`;

  const response = await callSmallLLM(prompt);
  const ideaMatch = response.match(/IDEA:\s*(.+)/i);
  const reasoningMatch = response.match(/REASONING:\s*(.+)/i);

  const idea = ideaMatch?.[1]?.trim().slice(0, 200);
  if (!idea) {
    throw new Error('Strategy generation failed: LLM returned no parseable IDEA');
  }
  ctx.strategy = idea;

  const reasoning = reasoningMatch?.[1]?.trim() ?? '';
  if (reasoning) {
    await appendMemorySection(ctx.companyId, '## Strategy Rationale', [
      `Journey: ${ctx.journey}`,
      `Idea: ${ctx.strategy}`,
      `Why: ${reasoning}`,
      `Founder angle: ${ctx.founderAngle ?? 'none'}`,
    ]);
  }
}
