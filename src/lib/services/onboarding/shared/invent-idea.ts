// invent_idea - Surprise Me journey (the "Baljia magic" path).
// Generates a specific buildable startup idea from founder background and geo.
// If no background exists, the model invents from first principles instead of
// depending on an external idea-bucket file.

import { getCapabilityConstraint } from '@/lib/platform-capabilities';
import { callSmallLLMJson } from './json-mode';
import { InventedIdeaSchema } from './schemas';
import { saveOnboardingBrief } from './onboarding-brief';
import { emitActivity, recordOnboardingIssue } from '../stage-runner';
import { appendMemorySection } from './memory-sections';
import { stripInlineMarkdown } from './founder-doc-style';
import type { PipelineContext, InventedIdea } from '../types';

function buildPersonalizedPrompt(backgroundContext: string, locationLine: string): string {
  return `You are Baljia, an AI cofounder. The founder hasn't specified an idea - your job is to INVENT a specific, buildable startup idea grounded in their background.

${getCapabilityConstraint()}

Founder background:
${backgroundContext}

${locationLine}

Rules:
- Idea must be a credible fit for THIS founder (leverage their specific domain expertise)
- Idea must be buildable on the platform (no mobile apps, no hardware, no Instagram/TikTok posting)
- Be specific about the CUSTOMER (role + industry + situation), not generic ("small businesses")
- Be specific about the PRODUCT (what it does, not what it is)

Return a JSON object with exactly these keys:
- invented_idea: string. One sentence explaining what the product does and exactly who it is for.
- changes_made: string. One sentence explaining how you moved from no idea to this specific idea based on founder background.
- rationale: string. One sentence explaining why this founder, idea, and platform fit together credibly.`;
}

function buildOpenDiscoveryPrompt(locationLine: string): string {
  return `You are Baljia, an AI cofounder. The founder has not shared a background or idea. Invent one specific, buildable startup idea from first principles.

${getCapabilityConstraint()}

${locationLine}

Discovery lanes you may consider, but must not name as a list:
- B2B workflows that still run through spreadsheets, inboxes, calls, or manual research.
- Local service businesses that lose leads, bookings, quotes, follow-ups, or reviews.
- Creator, coaching, education, or content businesses that need packaging and delivery workflows.
- Marketplaces or directories where matching, trust, intake, or scheduling is the bottleneck.
- Ecommerce or retail operators that need better drops, bundles, inventory, or customer reactivation.

Rules:
- Pick ONE narrow customer and ONE urgent recurring workflow.
- Make the product behavior concrete enough that Engineering could build an MVP.
- Use the founder's location market dynamics when available, but do not invent local facts.
- Avoid generic AI/startup wording. Do not return a category label as the idea.
- Buildable only (no mobile, no hardware, no social posting).

Return a JSON object with exactly these keys:
- invented_idea: string. One sentence with a specific customer and what the product does.
- changes_made: string. One sentence explaining how you invented a narrow customer/workflow direction from limited context.
- rationale: string. One sentence explaining why this fits the founder's location or available context.`;
}

function fallbackInventedIdea(ctx: PipelineContext, usedOpenDiscovery: boolean): InventedIdea {
  const geo = ctx.founderEnrichment?.geo;
  const location = [geo?.city, geo?.country].filter(Boolean).join(', ');
  const market = location ? ` in ${location}` : '';

  return InventedIdeaSchema.parse({
    invented_idea: `A lead qualification workspace for local service businesses${market} that turns inbound requests into prioritized follow-ups and quote-ready next steps.`,
    changes_made: usedOpenDiscovery
      ? 'Baljia invented a narrow workflow business from limited context because the founder did not provide a specific idea or background.'
      : 'Baljia used a generic fallback because idea invention did not produce a reliable result.',
    rationale: location
      ? `This gives onboarding a concrete hypothesis to validate in ${location} before expanding the product scope.`
      : 'This gives onboarding a concrete hypothesis that can be validated and refined instead of failing.',
  }) as InventedIdea;
}

export async function inventIdea(ctx: PipelineContext): Promise<void> {
  const backgroundContext = [ctx.founderAngle, ctx.enrichedFounderSummary]
    .filter(Boolean)
    .join('\n')
    .slice(0, 800);

  const geo = ctx.founderEnrichment?.geo;
  const locationLine = geo?.country
    ? `Founder location: ${[geo.city, geo.country].filter(Boolean).join(', ')} - leverage local market dynamics where it makes sense.`
    : '';

  const usedOpenDiscovery = !backgroundContext;
  const prompt = usedOpenDiscovery
    ? buildOpenDiscoveryPrompt(locationLine)
    : buildPersonalizedPrompt(backgroundContext, locationLine);

  let result: InventedIdea;
  try {
    result = await callSmallLLMJson<InventedIdea>(prompt, {
      maxTokens: 500,
      retryOnce: true,
      schema: InventedIdeaSchema,
      sanitizeFields: ['invented_idea', 'changes_made', 'rationale'],
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await recordOnboardingIssue(ctx, {
      stage: 'invent_idea',
      kind: 'invent_idea_llm_fallback',
      severity: 'medium',
      error,
      message: 'Surprise idea invention failed, so onboarding used a deterministic fallback idea.',
      fallbackUsed: true,
    });
    result = fallbackInventedIdea(ctx, usedOpenDiscovery);
  }

  if (!result.invented_idea?.trim()) {
    await recordOnboardingIssue(ctx, {
      stage: 'invent_idea',
      kind: 'invent_idea_empty_fallback',
      severity: 'medium',
      message: 'Surprise idea invention returned an empty idea, so onboarding used a deterministic fallback idea.',
      fallbackUsed: true,
    });
    result = fallbackInventedIdea(ctx, usedOpenDiscovery);
  }

  // Trust the LLM's length - the prompt and JSON schema constrain this to one
  // sentence per field. Don't char-slice here; that produces mid-word
  // fragments. Strip LLM-inline-markdown artifacts (**bold**, *italic*)
  // since these fields render in plain-text contexts.
  const invented_idea_clean = stripInlineMarkdown(result.invented_idea);
  const changes_made_clean = stripInlineMarkdown(result.changes_made ?? '');
  const rationale_clean = stripInlineMarkdown(result.rationale ?? '');
  if (invented_idea_clean.length > 600) {
    await recordOnboardingIssue(ctx, {
      stage: 'invent_idea',
      kind: 'invent_idea_overlong_field',
      severity: 'low',
      message: `invented_idea is ${invented_idea_clean.length} chars (expected <= ~300). Tighten the prompt instead of truncating.`,
    });
  }
  ctx.inventedIdea = {
    invented_idea: invented_idea_clean,
    changes_made: changes_made_clean,
    rationale: rationale_clean,
  };

  // Strategy label for downstream stages.
  ctx.strategy = ctx.inventedIdea.invented_idea;

  await emitActivity(ctx, `Invented: "${ctx.inventedIdea.invented_idea.slice(0, 120)}"`, 'llm');

  await appendMemorySection(ctx.companyId, '## Idea (Invented)', [
    `Invented: ${ctx.inventedIdea.invented_idea}`,
    `Changes: ${ctx.inventedIdea.changes_made}`,
    `Rationale: ${ctx.inventedIdea.rationale}`,
    `Founder angle: ${ctx.founderAngle ?? 'none'}`,
  ]);
  await saveOnboardingBrief(ctx);
}
