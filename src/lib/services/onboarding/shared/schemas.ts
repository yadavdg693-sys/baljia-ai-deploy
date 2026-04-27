import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const nullableNonEmpty = z.string().trim().min(1).nullable();
const confidence = z.enum(['high', 'medium', 'low']);

export const RefinedIdeaSchema = z.object({
  refined_idea: nonEmpty,
  changes_made: nonEmpty,
  rationale: nonEmpty,
});

export const InventedIdeaSchema = z.object({
  invented_idea: nonEmpty,
  changes_made: nonEmpty,
  rationale: nonEmpty,
});

export const BusinessProfilePromptSchema = z.object({
  business_name: nonEmpty,
  description: nonEmpty,
  revenue_model: nullableNonEmpty,
  target_customer: nullableNonEmpty,
  existing_validation: nullableNonEmpty,
});

export const MissionDocSchema = z.object({
  mission: nonEmpty,
  what_were_building: nonEmpty,
  where_were_headed: nonEmpty,
});

const taggedStatSchema = z.object({
  stat: nonEmpty,
  confidence,
});

const marketCompetitorSchema = z.object({
  name: nonEmpty,
  what_they_do: nonEmpty,
  pricing: nonEmpty,
  gap: nonEmpty,
});

const growMarketCompetitorSchema = z.object({
  name: nonEmpty,
  focus_area: nonEmpty,
  positioning_or_size: nonEmpty,
  gap: nonEmpty,
});

const gapFillingQuerySchema = z.object({
  query: nonEmpty,
  fills: nonEmpty,
});

const firstPrioritySchema = z.object({
  slot: z.enum(['engineering', 'research', 'outreach', 'discovery', 'validation']),
  title: nonEmpty,
  rationale: nonEmpty,
});

export const BuildMarketResearchSchema = z.object({
  overview: nonEmpty,
  market_size: z.array(taggedStatSchema).default([]),
  competitors: z.array(marketCompetitorSchema).min(1),
  demand_signals: z.array(nonEmpty).default([]),
  opportunity: nonEmpty,
  why_this_fits_you: nonEmpty,
  data_gaps: z.array(nonEmpty).default([]),
  gap_filling_queries: z.array(gapFillingQuerySchema).default([]),
  proceed_or_pause: z.enum(['proceed', 'narrow_first', 'validate_first']).optional(),
  proceed_note: z.string().optional(),
  first_priorities: z.array(firstPrioritySchema).length(3),
});

export const GrowMarketResearchSchema = z.object({
  business_overview: nonEmpty,
  revenue_model: nonEmpty,
  notable_validation: z.string().nullable(),
  market_size: z.array(taggedStatSchema).default([]),
  market_analysis: z.object({
    industry_landscape: nonEmpty,
    key_trends: z.array(nonEmpty).default([]),
    market_timing: nonEmpty,
  }),
  competitors: z.array(growMarketCompetitorSchema).min(1),
  competitive_advantages: z.array(nonEmpty).default([]),
  gaps_to_exploit: z.array(nonEmpty).default([]),
  why_this_fits_you: nonEmpty,
  ai_leverage_points: z.array(nonEmpty).default([]),
  retention_check: z.object({
    signal: z.enum(['healthy', 'warning', 'unknown']),
    rationale: nonEmpty,
    priority: z.enum(['scale_acquisition', 'fix_retention_first', 'measure_first']),
  }).optional(),
  funnel_diagnosis: z.object({
    likely_bottleneck: z.enum(['awareness', 'acquisition', 'activation', 'retention', 'monetization', 'referral']),
    rationale: nonEmpty,
  }).optional(),
  data_gaps: z.array(nonEmpty).default([]),
  gap_filling_queries: z.array(gapFillingQuerySchema).default([]),
  first_priorities: z.array(firstPrioritySchema).length(3),
});

export const SurpriseMarketResearchSchema = z.object({
  idea_overview: nonEmpty,
  market_validation: z.object({
    size_and_growth: z.array(taggedStatSchema).default([]),
    why_now: z.array(nonEmpty).default([]),
    demand_signals: z.array(nonEmpty).default([]),
  }),
  competitors: z.array(marketCompetitorSchema).min(1),
  why_this_fits_you: nonEmpty,
  idea_refinements: z.array(z.object({
    title: nonEmpty,
    rationale: nonEmpty,
  })).default([]),
  data_gaps: z.array(nonEmpty).default([]),
  gap_filling_queries: z.array(gapFillingQuerySchema).default([]),
  first_priorities: z.array(firstPrioritySchema).length(3),
});

const starterTaskSchema = z.object({
  title: nonEmpty.max(72),
  description: nonEmpty.max(320),
  reasoning: nonEmpty.max(260),
});

export const StarterTasksSchema = z.object({
  engineering: starterTaskSchema.extend({
    complexity: z.number().int().min(5).max(9).optional(),
  }),
  research: starterTaskSchema,
  outreach: starterTaskSchema,
});

export const LandingContentSchema = z.object({
  brand: z.object({
    name: nonEmpty,
    tagline: nonEmpty,
  }),
  hero: z.object({
    headline: nonEmpty,
    subhead: nonEmpty,
  }),
  what_it_does: z.object({
    heading: nonEmpty,
    capabilities: z.array(z.object({
      title: nonEmpty,
      description: nonEmpty,
    })).length(3),
  }),
  how_it_works: z.object({
    heading: nonEmpty,
    steps: z.array(z.object({
      number: z.number().int(),
      title: nonEmpty,
      description: nonEmpty,
    })).length(3),
  }),
  what_makes_different: z.object({
    heading: nonEmpty,
    points: z.array(nonEmpty).length(3),
  }),
  closing: z.object({
    headline: nonEmpty,
    body: nonEmpty,
  }),
});

export const OnboardingBriefSchema = z.object({
  journey: z.enum(['build_my_idea', 'grow_my_company', 'surprise_me']),
  founder: z.object({
    name: z.string().nullable(),
    email: z.string(),
    location: z.string().nullable(),
    timezone: z.string().nullable(),
    enrichment_confidence: z.enum(['high', 'medium', 'low']),
    angle: z.string().nullable(),
  }),
  input: z.string().nullable(),
  subject: z.object({
    kind: z.enum(['idea', 'business', 'invented_idea']),
    name: z.string().nullable(),
    summary: nonEmpty,
    source: z.enum(['founder_input', 'website', 'system_invented']),
  }),
  evidence: z.object({
    has_founder_angle: z.boolean(),
    has_business_profile: z.boolean(),
    has_founder_background: z.boolean(),
  }),
  confidence: z.enum(['high', 'medium', 'low']),
});
