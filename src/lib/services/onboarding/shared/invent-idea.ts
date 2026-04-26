// invent_idea — Surprise Me journey (the "Baljia magic" path)
// Generates a specific buildable startup idea from founder's background + geo.
// Falls back to a sampled bucket of pre-vetted Polsia-derived ideas when no
// background exists, using GeoIP (when present) to pick the regionally-fitting one.

import { getCapabilityConstraint } from '@/lib/platform-capabilities';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import { appendMemorySection } from './memory-sections';
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

Return a JSON object with these exact keys:
{
  "invented_idea": "<one sentence: what the product does and exactly who it's for>",
  "changes_made": "<one sentence: how you pivoted from 'no idea' to this specific idea based on founder background>",
  "rationale": "<one sentence: why this founder + this idea + this platform = credible>"
}`;
}

function buildBucketPrompt(locationLine: string): string {
  const sample = sampleBucket(25);
  const bucketList = sample.map(formatBucketEntry).join('\n');
  return `You are Baljia, an AI cofounder. The founder hasn't shared a background or idea — pick the most fitting idea from this pre-vetted bucket and adapt it.

${getCapabilityConstraint()}

${locationLine}

Bucket of real shipped startup ideas (each is platform-buildable; categories shown in brackets):
${bucketList}

Rules:
- Pick ONE entry that best fits the founder's location market dynamics (if any). Without location, pick the entry with the clearest customer.
- Rewrite it as a SPECIFIC product — concrete customer (role + industry + situation) and concrete product behavior. Do NOT return the generic bucket text.
- Buildable only (no mobile, no hardware, no social posting).

Return a JSON object with these exact keys:
{
  "invented_idea": "<one sentence: specific customer + what the product does>",
  "changes_made": "<one sentence: which bucket entry (by category + target) you picked and how you adapted it>",
  "rationale": "<one sentence: why this fits the founder's location/context>"
}`;
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
