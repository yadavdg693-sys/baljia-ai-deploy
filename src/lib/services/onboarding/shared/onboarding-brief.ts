import { appendMemorySection } from './memory-sections';
import { OnboardingBriefSchema } from './schemas';
import type { OnboardingBrief, PipelineContext } from '../types';

export async function saveOnboardingBrief(ctx: PipelineContext): Promise<void> {
  const geo = ctx.founderEnrichment?.geo;
  const location = geo?.country
    ? [geo.city, geo.region, geo.country].filter(Boolean).join(', ')
    : null;

  const subject = getSubject(ctx);
  const brief = OnboardingBriefSchema.parse({
    journey: ctx.journey,
    founder: {
      name: ctx.founderName,
      email: ctx.founderEmail,
      location,
      timezone: ctx.browserTimezone ?? geo?.timezone ?? null,
      enrichment_confidence: ctx.founderEnrichment?.confidence ?? 'low',
      angle: ctx.founderAngle,
    },
    input: ctx.input ?? null,
    subject,
    evidence: {
      has_founder_angle: !!ctx.founderAngle,
      has_business_profile: !!ctx.businessProfile,
      has_founder_background: !!ctx.enrichedFounderSummary,
    },
    confidence: confidenceFor(ctx),
  }) as OnboardingBrief;

  ctx.onboardingBrief = brief;

  await appendMemorySection(ctx.companyId, '## Onboarding Brief', [
    `Journey: ${brief.journey}`,
    `Subject: ${brief.subject.kind} (${brief.subject.source})`,
    `Name: ${brief.subject.name ?? '(unnamed)'}`,
    `Summary: ${brief.subject.summary}`,
    `Founder location: ${brief.founder.location ?? 'unknown'}`,
    `Founder angle: ${brief.founder.angle ?? 'none'}`,
    `Confidence: ${brief.confidence}`,
  ]);
}

function getSubject(ctx: PipelineContext): OnboardingBrief['subject'] {
  if (ctx.businessProfile) {
    return {
      kind: 'business',
      name: ctx.businessProfile.business_name,
      summary: ctx.businessProfile.description,
      source: 'website',
    };
  }

  if (ctx.inventedIdea) {
    return {
      kind: 'invented_idea',
      name: null,
      summary: ctx.inventedIdea.invented_idea,
      source: 'system_invented',
    };
  }

  return {
    kind: 'idea',
    name: null,
    summary: ctx.refinedIdea?.refined_idea ?? ctx.input ?? ctx.strategy,
    source: 'founder_input',
  };
}

function confidenceFor(ctx: PipelineContext): OnboardingBrief['confidence'] {
  if (ctx.businessProfile || ctx.refinedIdea || ctx.inventedIdea) {
    return ctx.founderEnrichment?.confidence === 'high' || ctx.founderAngle ? 'high' : 'medium';
  }
  return 'low';
}
