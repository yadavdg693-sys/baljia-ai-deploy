// invent_idea — Surprise Me journey (the "Baljia magic" path)
// Generates a specific buildable startup idea from founder's background + geo.
// Requires founderAngle or enrichedFounderSummary (fullHeader must run first).

import { getCapabilityConstraint } from '@/lib/platform-capabilities';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import { appendMemorySection } from './memory-sections';
import type { PipelineContext, InventedIdea } from '../types';

export async function inventIdea(ctx: PipelineContext): Promise<void> {
  const backgroundContext = [ctx.founderAngle, ctx.enrichedFounderSummary]
    .filter(Boolean)
    .join('\n')
    .slice(0, 800);

  if (!backgroundContext) {
    throw new Error('invent_idea: no founder background available (fullHeader must populate founderAngle or enrichedFounderSummary first)');
  }

  const geo = ctx.founderEnrichment?.geo;
  const locationLine = geo?.country
    ? `Founder location: ${[geo.city, geo.country].filter(Boolean).join(', ')} — the idea should leverage local market dynamics where it makes sense.`
    : '';

  const prompt = `You are Baljia, an AI cofounder. The founder hasn't specified an idea — your job is to INVENT a specific, buildable startup idea grounded in their background.

${getCapabilityConstraint()}

Founder background:
${backgroundContext}

${locationLine}

Rules:
- Idea must be a credible fit for THIS founder (leverage their specific domain expertise)
- Idea must be buildable on the platform (no mobile apps, no hardware, no Instagram/TikTok posting)
- Be specific about the CUSTOMER (role + industry + situation), not generic ("small businesses")
- Be specific about the PRODUCT (what it does, not what it is)

Return a JSON object with these exact keys:
{
  "invented_idea": "<one sentence: what the product does and exactly who it's for>",
  "changes_made": "<one sentence: how you pivoted from 'no idea' to this specific idea based on founder background>",
  "rationale": "<one sentence: why this founder + this idea + this platform = credible>"
}`;

  const result = await callSmallLLMJson<InventedIdea>(prompt, {
    maxTokens: 500,
    retryOnce: true,
    sanitizeFields: ['invented_idea', 'changes_made', 'rationale'],
  });

  if (!result.invented_idea?.trim()) {
    throw new Error('invent_idea: LLM returned empty invented_idea');
  }

  ctx.inventedIdea = {
    invented_idea: result.invented_idea.trim().slice(0, 300),
    changes_made: (result.changes_made ?? '').trim().slice(0, 250),
    rationale: (result.rationale ?? '').trim().slice(0, 250),
  };

  // Strategy label for downstream stages
  ctx.strategy = ctx.inventedIdea.invented_idea;

  await emitActivity(ctx, `Invented: "${ctx.inventedIdea.invented_idea.slice(0, 120)}"`, 'llm');

  await appendMemorySection(ctx.companyId, '## Idea (Invented)', [
    `Invented: ${ctx.inventedIdea.invented_idea}`,
    `Changes: ${ctx.inventedIdea.changes_made}`,
    `Rationale: ${ctx.inventedIdea.rationale}`,
    `Founder angle: ${ctx.founderAngle ?? 'none'}`,
  ]);
}
