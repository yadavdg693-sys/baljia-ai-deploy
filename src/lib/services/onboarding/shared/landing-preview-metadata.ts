import { createHash } from 'node:crypto';
import type { LandingPageBrief, PipelineContext } from '../types';

type LandingSourceContext = Pick<
  PipelineContext,
  | 'journey'
  | 'input'
  | 'oneLiner'
  | 'missionDoc'
  | 'refinedIdea'
  | 'inventedIdea'
  | 'businessProfile'
  | 'onboardingBrief'
>;

export type LandingPreviewFreshnessStatus = 'fresh' | 'stale' | 'unknown';

export interface LandingPreviewFreshness {
  status: LandingPreviewFreshnessStatus;
  currentSourceIdeaHash: string;
  storedSourceIdeaHash: string | null;
  generatorVersion: LandingPageBrief['generator_version'] | null;
  shouldRegenerate: boolean;
}

export function createLandingSourceIdeaHash(ctx: LandingSourceContext): string {
  const source = {
    journey: ctx.journey,
    input: ctx.input ?? null,
    oneLiner: ctx.oneLiner ?? null,
    missionDoc: ctx.missionDoc ?? null,
    refinedIdea: ctx.refinedIdea ?? null,
    inventedIdea: ctx.inventedIdea ?? null,
    businessProfile: ctx.businessProfile ?? null,
    onboardingBrief: ctx.onboardingBrief ?? null,
  };
  return createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 16);
}

export function getLandingPreviewFreshness(
  ctx: LandingSourceContext & { landingPageBrief?: LandingPageBrief },
): LandingPreviewFreshness {
  const currentSourceIdeaHash = createLandingSourceIdeaHash(ctx);
  const storedSourceIdeaHash = ctx.landingPageBrief?.source_idea_hash ?? null;
  const generatorVersion = ctx.landingPageBrief?.generator_version ?? null;

  if (!storedSourceIdeaHash) {
    return {
      status: 'unknown',
      currentSourceIdeaHash,
      storedSourceIdeaHash,
      generatorVersion,
      shouldRegenerate: false,
    };
  }

  const status = storedSourceIdeaHash === currentSourceIdeaHash ? 'fresh' : 'stale';
  return {
    status,
    currentSourceIdeaHash,
    storedSourceIdeaHash,
    generatorVersion,
    shouldRegenerate: status === 'stale',
  };
}
