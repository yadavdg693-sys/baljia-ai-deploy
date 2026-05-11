import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const nullableNonEmpty = z.string().trim().min(1).nullable();
const confidence = z.enum(['high', 'medium', 'low']);

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function looseText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'summary', 'description', 'title', 'value', 'content', 'rationale']) {
      if (typeof record[key] === 'string') return record[key] as string;
    }
  }
  return '';
}

function cleanText(value: unknown, fallback: string, max = 4000): string {
  const cleaned = looseText(value).replace(/\s+/g, ' ').trim();
  const text = cleaned || fallback;
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function resilientText(fallback: string, max = 4000) {
  return z.preprocess((value) => cleanText(value, fallback, max), z.string().trim().min(1).max(max));
}

function nullableText(value: unknown): string | null {
  const cleaned = looseText(value).replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function stringArray(value: unknown, fallback: string[] = [], min = 0): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n|;/)
      : [];
  const cleaned = raw
    .map((item) => cleanText(item, '', 500))
    .filter(Boolean);
  while (cleaned.length < min) {
    cleaned.push(fallback[cleaned.length] ?? fallback[0] ?? 'No clear signal surfaced yet.');
  }
  return cleaned;
}

function objectArray(value: unknown, fallback: Record<string, unknown>): Record<string, unknown>[] {
  const raw = Array.isArray(value) ? value : [];
  const objects = raw.map(objectOrEmpty).filter((item) => Object.keys(item).length > 0);
  return objects.length ? objects : [fallback];
}

const DEFAULT_FIRST_PRIORITIES = [
  'Build the first useful asset or feature for the target customer.',
  'Research the sharpest competitors, substitutes, pricing, and positioning gaps.',
  'Find and contact the first likely customers with a specific pitch.',
];

function normalizePriorityValue(value: unknown, index = 0): string {
  let text = '';
  if (typeof value === 'string') {
    text = value;
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const candidate =
      record.priority ?? record.title ?? record.summary ?? record.text ?? record.description ?? record.action;
    text = typeof candidate === 'string' ? candidate : JSON.stringify(record);
  } else if (value != null) {
    text = String(value);
  }

  const clean = text
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^"?short priority\s*[-–—:]\s*one concrete sentence"?$/i.test(clean)) {
    return DEFAULT_FIRST_PRIORITIES[index] ?? DEFAULT_FIRST_PRIORITIES[0];
  }

  return clean || (DEFAULT_FIRST_PRIORITIES[index] ?? DEFAULT_FIRST_PRIORITIES[0]);
}

function normalizePriorityArray(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const normalized = raw.slice(0, 3).map((item, index) => normalizePriorityValue(item, index));
  while (normalized.length < 3) {
    normalized.push(DEFAULT_FIRST_PRIORITIES[normalized.length]);
  }
  return normalized;
}

const priorityLine = z.preprocess((value) => normalizePriorityValue(value), nonEmpty);
const firstPrioritiesSchema = z.preprocess(
  normalizePriorityArray,
  z.array(priorityLine).length(3),
);

const starterTaskDescription = resilientText('Define and complete one concrete onboarding task with a narrow scope and a useful output.', 700);

export const RefinedIdeaSchema = z.preprocess(objectOrEmpty, z.object({
  refined_idea: resilientText('The founder idea is being preserved and clarified around its strongest customer problem.', 500),
  changes_made: resilientText('The direction was clarified without changing the founder input.', 300),
  rationale: resilientText('This direction gives the founder a concrete customer, workflow, and next step.', 300),
}));

export const InventedIdeaSchema = z.preprocess(objectOrEmpty, z.object({
  invented_idea: resilientText('A focused business idea matched to the founder context and a clear customer pain.', 500),
  changes_made: resilientText('The idea was sharpened into a clearer customer problem and offer.', 300),
  rationale: resilientText('This gives the founder a concrete business direction to validate.', 300),
}));

export const BusinessProfilePromptSchema = z.preprocess(objectOrEmpty, z.object({
  business_name: resilientText('Existing Business', 160),
  description: resilientText('An existing business submitted by the founder for growth planning.', 800),
  revenue_model: z.preprocess(nullableText, z.string().nullable()),
  target_customer: z.preprocess(nullableText, z.string().nullable()),
  existing_validation: z.preprocess(nullableText, z.string().nullable()),
  business_type: z.preprocess(nullableText, z.string().nullable()).default(null),
  services_or_products: z.preprocess((value) => stringArray(value), z.array(nonEmpty)).default([]),
  location_or_market: z.preprocess(nullableText, z.string().nullable()).default(null),
  visible_offer: z.preprocess(nullableText, z.string().nullable()).default(null),
  main_cta: z.preprocess(nullableText, z.string().nullable()).default(null),
  proof_signals: z.preprocess((value) => stringArray(value), z.array(nonEmpty)).default([]),
}));

export const MissionDocSchema = z.preprocess(objectOrEmpty, z.object({
  // Dashboard-friendly one-liner. Goes in the topbar — must fit in a single
  // line of UI chrome (~14 words / ~80 chars max). Descriptive, not
  // aspirational. Pattern: "{noun} for {audience} that {verb}."
  one_liner: resilientText('A focused product for a clearly defined customer.', 120),
  mission: resilientText('Help the target customer solve the core problem with less friction.', 300),
  what_were_building: resilientText('We are building the simplest useful version of the offer for the target customer. It focuses on the core workflow, the buyer pain, and a clear outcome.', 900),
  where_were_headed: resilientText('The goal is to turn this idea into a company customers can understand, trust, and try. The early work should prove demand, sharpen the offer, and create a useful first experience. From there, the company can expand based on real customer signals.', 1200),
}));

const taggedStatSchema = z.object({
  stat: resilientText('No credible market statistic surfaced yet.', 500),
  confidence: z.preprocess((value) => value === 'high' || value === 'medium' || value === 'low' ? value : 'low', confidence),
});

const marketCompetitorSchema = z.object({
  name: resilientText('Current manual workflow', 120),
  what_they_do: resilientText('Customers currently solve this with manual work, spreadsheets, services, or generic tools.', 500),
  pricing: resilientText('Pricing was not clear from available research.', 300),
  gap: resilientText('The gap is a more focused, easier-to-buy solution for the target customer.', 500),
});

const growMarketCompetitorSchema = z.object({
  name: resilientText('Current alternatives', 120),
  focus_area: resilientText('Existing providers, consultants, tools, or manual workflows serving this customer need.', 500),
  positioning_or_size: resilientText('Positioning or pricing was not clear from available research.', 300),
  gap: resilientText('The business can win by making its offer, proof, and buying path clearer.', 500),
});

export const BuildMarketResearchSchema = z.preprocess(objectOrEmpty, z.object({
  overview: resilientText('This idea needs a focused first version, a clear target customer, and evidence from early demand signals.', 2000),
  market_validation: resilientText('**The market needs validation.**\n- The founder has a clear direction to test.\n- Customer pain and willingness to pay should be checked through research and outreach.\n- The first version should focus on one useful workflow.\n\nWhy now: The next step is to prove demand with specific customers.', 2000),
  competitors: z.preprocess(
    (value) => objectArray(value, {
      name: 'Current manual workflow',
      what_they_do: 'Customers currently use manual work, spreadsheets, agencies, freelancers, or generic tools.',
      pricing: 'Pricing varies or was not clear from available research.',
      gap: 'A focused offer can be easier to adopt than broad or manual alternatives.',
    }),
    z.array(marketCompetitorSchema).min(1),
  ),
  opportunity: resilientText('The opportunity is to focus the idea around a narrow customer, one painful workflow, and a first useful outcome that can be validated quickly.', 1600),
  market_positioning: resilientText('**The strongest angle is a focused first workflow.**\n- The customer should immediately understand the problem being solved.\n- The offer should be narrow enough to try.\n- The first proof should come from real conversations and usage.', 2000),
  why_this_fits_you: resilientText('This direction fits because it preserves the founder input and turns it into a practical company direction to validate.', 1000),
  first_priorities: firstPrioritiesSchema,
}));

export const GrowMarketResearchSchema = z.preprocess(objectOrEmpty, z.object({
  business_type: resilientText('existing business', 160),
  main_growth_bottleneck: resilientText('The main bottleneck is unclear; measure the path from interest to qualified demand before scaling.', 500),
  customer_wedge: resilientText('Focus on the customer segment with the clearest visible need and easiest path to trust.', 500),
  offer_packaging_direction: resilientText('Clarify the offer, proof, and buying path before scaling acquisition.', 700),
  market_tension: resilientText('Customers want a clearer reason to choose this business over current alternatives.', 500),
  business_overview: resilientText('This is an existing business submitted by the founder. The first growth plan should preserve its current offer, customers, and proof while improving the path to more qualified demand.', 2000),
  revenue_model: resilientText('Revenue model was not clear from available website context.', 500),
  notable_validation: z.preprocess(nullableText, z.string().nullable()).default(null),
  market_size: z.preprocess((value) => Array.isArray(value) ? value : [], z.array(taggedStatSchema)).default([]),
  market_analysis: z.preprocess(objectOrEmpty, z.object({
    industry_landscape: resilientText('The business competes against existing providers, generic tools, and manual buying workflows in its category.', 1200),
    key_trends: z.preprocess(
      (value) => stringArray(value, ['Buyers expect clearer proof, faster response, and simpler evaluation before they contact a provider.'], 1),
      z.array(nonEmpty).min(1),
    ),
    market_timing: resilientText('Moderate - the business should validate its sharpest growth lever before scaling acquisition.', 500),
  })),
  growth_opportunity: resilientText('The strongest opportunity is to sharpen the offer, improve proof, and create a clearer path from visitor or prospect interest to a qualified conversation.', 1200),
  competitors: z.preprocess(
    (value) => objectArray(value, {
      name: 'Current alternatives',
      focus_area: 'Existing providers, consultants, tools, or manual workflows.',
      positioning_or_size: 'Positioning or pricing was not clear from available research.',
      gap: 'The business can win by making its offer, proof, and buying path clearer.',
    }),
    z.array(growMarketCompetitorSchema).min(1),
  ),
  business_edge: resilientText('The business has existing context and proof it can turn into a sharper growth story.', 500),
  business_gap: resilientText('The biggest gap is the need for a clearer offer, proof, and conversion path.', 500),
  competitive_advantages: z.preprocess(
    (value) => stringArray(value, ['Existing business context and a real offer to improve.']),
    z.array(nonEmpty),
  ).default([]),
  gaps_to_exploit: z.preprocess(
    (value) => stringArray(value, ['Clarify the offer and make the next buying step easier.']),
    z.array(nonEmpty),
  ).default([]),
  threats: z.preprocess(
    (value) => stringArray(value, ['Customers may choose lower-cost substitutes if the offer, proof, or buying path stays unclear.']),
    z.array(nonEmpty),
  ).default([]),
  what_not_to_do_yet: resilientText('Do not scale broad acquisition until the sharpest offer, proof, and conversion path are clearer.', 700),
  why_this_fits_you: resilientText('This direction fits because it works from the existing business instead of inventing a new one.', 1000),
  ai_leverage_points: z.preprocess(
    (value) => stringArray(value, ['Lead qualification - Turn inbound interest into clearer next steps.', 'Reporting - Summarize progress and outcomes for prospects or customers.'], 1),
    z.array(nonEmpty).min(1),
  ),
  first_priorities: firstPrioritiesSchema,
  retention_check: z.preprocess(objectOrEmpty, z.object({
    signal: z.preprocess((value) => value === 'healthy' || value === 'warning' || value === 'unknown' ? value : 'unknown', z.enum(['healthy', 'warning', 'unknown'])),
    rationale: resilientText('Retention signal is unclear from available public context.', 500),
    priority: z.preprocess((value) => value === 'scale_acquisition' || value === 'fix_retention_first' || value === 'measure_first' ? value : 'measure_first', z.enum(['scale_acquisition', 'fix_retention_first', 'measure_first'])),
  })).optional(),
  funnel_diagnosis: z.preprocess(objectOrEmpty, z.object({
    likely_bottleneck: z.preprocess((value) => [
      'awareness',
      'acquisition',
      'activation',
      'conversion',
      'retention',
      'delivery',
      'reporting',
      'client_communication',
      'monetization',
      'referrals',
      'unknown',
    ].includes(String(value)) ? value : 'unknown', z.enum([
      'awareness',
      'acquisition',
      'activation',
      'conversion',
      'retention',
      'delivery',
      'reporting',
      'client_communication',
      'monetization',
      'referrals',
      'unknown',
    ])),
    rationale: resilientText('The bottleneck should be measured before scaling the growth plan.', 500),
  })).optional(),
}));

function normalizeComplexity(value: unknown): number {
  const n = typeof value === 'number' ? Math.round(value) : Number(value);
  if (!Number.isFinite(n)) return 6;
  if (n < 5) return 5;
  if (n > 9) return 9;
  return n;
}

const starterTaskBaseSchema = z.object({
  title: resilientText('Complete the first focused onboarding task', 72),
  description: starterTaskDescription,
  reasoning: resilientText('This task creates useful signal for the company direction.', 260),
});

const starterTaskSchema = z.preprocess(objectOrEmpty, starterTaskBaseSchema);
const engineeringTaskSchema = z.preprocess(objectOrEmpty, starterTaskBaseSchema.extend({
  complexity: z.preprocess(normalizeComplexity, z.number().int().min(5).max(9)).optional(),
}));

export const StarterTasksSchema = z.preprocess(objectOrEmpty, z.object({
  engineering: engineeringTaskSchema,
  research: starterTaskSchema,
  outreach: starterTaskSchema,
}));

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
  // LLM occasionally returns what_makes_different as a bare string[] instead
  // of {heading, points}. Coerce defensively before validation so a single
  // shape mistake doesn't kill the whole landing generation.
  what_makes_different: z.preprocess((input) => {
    if (Array.isArray(input)) {
      // Could be string[] OR an array of {heading, points}/{title, body}/etc.
      if (input.every((x) => typeof x === 'string')) {
        return { heading: 'What makes this different', points: input };
      }
      // Array of objects → flatten to points using common field names
      const points = input.map((x) => {
        if (typeof x === 'string') return x;
        if (x && typeof x === 'object') {
          const o = x as Record<string, unknown>;
          return String(o.point ?? o.text ?? o.body ?? o.description ?? o.title ?? o.heading ?? '');
        }
        return '';
      }).filter((s) => s.length > 0);
      return { heading: 'What makes this different', points };
    }
    return input;
  }, z.object({
    heading: nonEmpty,
    points: z.array(nonEmpty).length(3),
  })),
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

export const BuildPlanningAgentSchema = z.preprocess(objectOrEmpty, z.object({
  refined_idea: RefinedIdeaSchema,
  market_research: BuildMarketResearchSchema,
  mission_doc: MissionDocSchema,
}));

export const SurprisePlanningAgentSchema = z.preprocess(objectOrEmpty, z.object({
  invented_idea: InventedIdeaSchema,
  market_research: BuildMarketResearchSchema,
  mission_doc: MissionDocSchema,
}));

export const GrowPlanningAgentSchema = z.preprocess(objectOrEmpty, z.object({
  market_research: GrowMarketResearchSchema,
  mission_doc: MissionDocSchema,
}));
