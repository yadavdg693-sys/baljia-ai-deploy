// refine_idea — Build My Idea journey
// Active transform: takes founder's raw idea text and converts it into a
// buildable scope using platform capabilities. Never soft-fails.
// See memory/project_idea_processing_active_transform.md

import { getCapabilityConstraint } from '@/lib/platform-capabilities';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import { appendMemorySection } from './memory-sections';
import type { PipelineContext, RefinedIdea } from '../types';

export async function refineIdea(ctx: PipelineContext): Promise<void> {
  if (!ctx.input) {
    throw new Error('refine_idea requires ctx.input (founder idea text)');
  }

  const geo = ctx.founderEnrichment?.geo;
  const locationLine = geo?.country
    ? `Founder location: ${[geo.city, geo.country].filter(Boolean).join(', ')} — shape refinements to local market dynamics where relevant.`
    : '';

  const prompt = `You are Baljia, an AI cofounder. The founder submitted this raw idea: "${ctx.input}"

Your job is to REFINE it into a buildable scope. This is an active transform, not a validation:
- If the idea is vague, make it specific. Pick the sharpest version the platform can build.
- If the idea is too ambitious, narrow it to a concrete MVP that ships in 3 hours.
- If the idea conflicts with platform limits, substitute with the closest thing we CAN build.
- Never say "this can't be built" — find what WOULD work and transform toward that.

${getCapabilityConstraint()}

${locationLine}

Return a JSON object with these exact keys:
{
  "refined_idea": "<one sentence: what the refined product does and for whom, specific enough to build>",
  "changes_made": "<one sentence: what was transformed from the raw input to get here>",
  "rationale": "<one sentence: why this refined version is the highest-leverage buildable version>"
}`;

  const result = await callSmallLLMJson<RefinedIdea>(prompt, { maxTokens: 400, retryOnce: true });

  if (!result.refined_idea?.trim()) {
    throw new Error('refine_idea: LLM returned empty refined_idea');
  }

  ctx.refinedIdea = {
    refined_idea: result.refined_idea.trim().slice(0, 300),
    changes_made: (result.changes_made ?? '').trim().slice(0, 200),
    rationale: (result.rationale ?? '').trim().slice(0, 200),
  };

  // Strategy label for downstream stages (mission, tasks) that still read ctx.strategy
  ctx.strategy = ctx.refinedIdea.refined_idea;

  await emitActivity(
    ctx,
    `Refined: "${ctx.refinedIdea.refined_idea.slice(0, 100)}"`,
    'llm',
  );
  if (ctx.refinedIdea.changes_made) {
    await emitActivity(ctx, `Changes: ${ctx.refinedIdea.changes_made.slice(0, 120)}`, 'llm');
  }

  await appendMemorySection(ctx.companyId, '## Idea (Refined)', [
    `Refined: ${ctx.refinedIdea.refined_idea}`,
    `Changes: ${ctx.refinedIdea.changes_made}`,
    `Rationale: ${ctx.refinedIdea.rationale}`,
  ]);
}
