// invent_idea — Surprise Me journey (the "Baljia magic" path)
// Generates a specific buildable startup idea from founder's background + geo.
// Falls back to a sampled bucket of pre-vetted Polsia-derived ideas when no
// background exists, using GeoIP (when present) to pick the regionally-fitting one.

import { getCapabilityConstraint } from '@/lib/platform-capabilities';
import { callSmallLLMJson } from './json-mode';
import { InventedIdeaSchema } from './schemas';
import { saveOnboardingBrief } from './onboarding-brief';
import { emitActivity, recordOnboardingIssue } from '../stage-runner';
import { appendMemorySection } from './memory-sections';
import { stripInlineMarkdown } from './founder-doc-style';
import type { PipelineContext, InventedIdea } from '../types';
import bucketRaw from '../../../../../data/business-ideas-bucket.json';

interface BucketEntry {
  idea_id: string;
  category: string;
  target_user: string;
  business_idea: string;
  source_text: string;
  business_model_guess: string;
  opportunity_score: number;
  evidence_strength: 'high' | 'medium' | 'low';
}

// Filter once at module load: high-signal, high-opportunity entries only.
const BUCKET: BucketEntry[] = (bucketRaw as BucketEntry[]).filter(
  (e) =>
    typeof e.opportunity_score === 'number' &&
    e.opportunity_score >= 40 &&
    (e.evidence_strength === 'high' || e.evidence_strength === 'medium') &&
    e.source_text &&
    e.target_user &&
    e.category,
);

function sampleBucket(n: number): BucketEntry[] {
  // Partial Fisher-Yates: shuffle just enough to pick n distinct items.
  const arr = [...BUCKET];
  const take = Math.min(n, arr.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, take);
}

function formatBucketEntry(e: BucketEntry, i: number): string {
  const text = e.source_text.replace(/\s+/g, ' ').trim().slice(0, 220);
  return `${i + 1}. [${e.category}] target: ${e.target_user} — ${text}`;
}

function buildPersonalizedPrompt(backgroundContext: string, locationLine: string): string {
  return `You are Baljia, an AI cofounder. The founder hasn't specified an idea — your job is to INVENT a specific, buildable startup idea grounded in their background.

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

function buildBucketPrompt(locationLine: string): string {
  const sample = sampleBucket(25);
  const bucketList = sample.map(formatBucketEntry).join('\n');
  return `You are Baljia, an AI cofounder. The founder has not shared a background or idea. Use the reference bucket below to derive one fitting, specific startup idea, but do not copy the bucket text verbatim.

${getCapabilityConstraint()}

${locationLine}

Reference bucket of platform-buildable startup patterns (categories shown in brackets):
${bucketList}

Rules:
- Pick ONE entry that best fits the founder's location market dynamics (if any). Without location, pick the entry with the clearest customer.
- Rewrite it as a SPECIFIC product — concrete customer (role + industry + situation) and concrete product behavior. Do NOT return the generic bucket text.
- Buildable only (no mobile, no hardware, no social posting).

Return a JSON object with exactly these keys:
- invented_idea: string. One sentence with a specific customer and what the product does.
- changes_made: string. One sentence naming the source category and explaining how you adapted it.
- rationale: string. One sentence explaining why this fits the founder's location or available context.`;
}

function fallbackInventedIdea(ctx: PipelineContext, usedBucket: boolean): InventedIdea {
  const entry = sampleBucket(1)[0];
  const geo = ctx.founderEnrichment?.geo;
  const location = [geo?.city, geo?.country].filter(Boolean).join(', ');

  if (entry) {
    return InventedIdeaSchema.parse({
      invented_idea: `A focused ${entry.category.toLowerCase()} product for ${entry.target_user} that solves one urgent workflow from the founder's starting context.`,
      changes_made: `Baljia used a vetted ${entry.category} startup pattern because the founder did not provide a specific idea.`,
      rationale: location
        ? `This is a practical hypothesis to validate in ${location} before expanding the product scope.`
        : 'This is a practical hypothesis to validate with real customers before expanding the product scope.',
    }) as InventedIdea;
  }

  return InventedIdeaSchema.parse({
    invented_idea: 'A focused workflow product for a narrow customer segment that solves one recurring operational pain.',
    changes_made: usedBucket
      ? 'Baljia used a generic fallback because no founder idea or usable idea bucket entry was available.'
      : 'Baljia used a generic fallback because idea invention did not produce a reliable result.',
    rationale: 'This gives onboarding a concrete hypothesis that can be validated and refined instead of failing.',
  }) as InventedIdea;
}

export async function inventIdea(ctx: PipelineContext): Promise<void> {
  const backgroundContext = [ctx.founderAngle, ctx.enrichedFounderSummary]
    .filter(Boolean)
    .join('\n')
    .slice(0, 800);

  const geo = ctx.founderEnrichment?.geo;
  const locationLine = geo?.country
    ? `Founder location: ${[geo.city, geo.country].filter(Boolean).join(', ')} — leverage local market dynamics where it makes sense.`
    : '';

  const usedBucket = !backgroundContext;
  const prompt = usedBucket
    ? buildBucketPrompt(locationLine)
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
    result = fallbackInventedIdea(ctx, usedBucket);
  }

  if (!result.invented_idea?.trim()) {
    await recordOnboardingIssue(ctx, {
      stage: 'invent_idea',
      kind: 'invent_idea_empty_fallback',
      severity: 'medium',
      message: 'Surprise idea invention returned an empty idea, so onboarding used a deterministic fallback idea.',
      fallbackUsed: true,
    });
    result = fallbackInventedIdea(ctx, usedBucket);
  }

  // Trust the LLM's length — the prompt + JSON schema constrain this to one
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
      message: `invented_idea is ${invented_idea_clean.length} chars (expected ≤ ~300). Tighten the prompt instead of truncating.`,
    });
  }
  ctx.inventedIdea = {
    invented_idea: invented_idea_clean,
    changes_made: changes_made_clean,
    rationale: rationale_clean,
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
  await saveOnboardingBrief(ctx);
}
