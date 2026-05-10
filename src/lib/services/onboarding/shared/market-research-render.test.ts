import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {},
  documents: {},
}));

vi.mock('@/lib/services/document.service', () => ({
  getDocuments: vi.fn(),
  updateDocument: vi.fn(),
}));

vi.mock('@/lib/founder-safety/sanitize', () => ({
  sanitizeForFounder: vi.fn(),
}));

import { renderBuildMarkdown, renderGrowMarkdown } from './market-research-render';
import { BuildPlanningAgentSchema, GrowPlanningAgentSchema, StarterTasksSchema } from './schemas';

describe('market research markdown renderer', () => {
  it('normalizes first priorities instead of failing onboarding', () => {
    const basePayload = {
      refined_idea: {
        refined_idea: 'A client portal for small businesses to approve social posts.',
        changes_made: 'Clarified the customer and approval workflow.',
        rationale: 'The workflow maps to a clear buyer pain.',
      },
      market_research: {
        overview: 'A done-for-you social media service with an approval portal.',
        market_validation: '**Small businesses need social help.**\n- Agency pricing is high.',
        competitors: [{ name: 'Hootsuite', what_they_do: 'Scheduling tool', pricing: 'Public plans', gap: 'DIY, not service' }],
        opportunity: 'Serve businesses that want execution, not another tool.',
        market_positioning: '**Affordable done-for-you social.**\n- Owners lack time.',
        why_this_fits_you: 'The direction fits the founder input.',
        first_priorities: [
          { title: 'Build a client approval portal with onboarding, calendar, and approve/request changes.' },
          'Short priority - one concrete sentence',
        ],
      },
      mission_doc: {
        mission: 'Make good social media affordable for small businesses.',
        what_were_building: 'Postvo handles social media execution for small businesses.',
        where_were_headed: 'Local businesses get consistent marketing. Owners spend less time posting.',
      },
    };

    const parsed = BuildPlanningAgentSchema.parse(basePayload);

    expect(parsed.market_research.first_priorities).toHaveLength(3);
    expect(parsed.market_research.first_priorities[0]).toContain('client approval portal');
    expect(parsed.market_research.first_priorities[1]).not.toContain('Short priority');

    expect(() => BuildPlanningAgentSchema.parse({
      ...basePayload,
      market_research: {
        ...basePayload.market_research,
        first_priorities: undefined,
      },
    })).not.toThrow();

    expect(() => BuildPlanningAgentSchema.parse({
      ...basePayload,
      market_research: {
        ...basePayload.market_research,
        first_priorities: [
          '',
          'A very long priority sentence that should still parse because first priorities are rendered for founder context, not used as a hard runtime contract that should kill onboarding when the model writes a few extra words beyond an arbitrary limit.',
          { description: 'Research competitor offers and pricing.' },
          'Extra priority should be ignored.',
        ],
      },
    })).not.toThrow();
  });

  it('normalizes broken market research and mission payloads instead of failing onboarding', () => {
    expect(() => BuildPlanningAgentSchema.parse({
      refined_idea: null,
      market_research: {
        competitors: [{}],
        first_priorities: null,
      },
      mission_doc: {
        mission: '',
      },
    })).not.toThrow();

    const grow = GrowPlanningAgentSchema.parse({
      market_research: {
        market_analysis: { key_trends: [] },
        competitors: [],
        ai_leverage_points: [],
        retention_check: { signal: 'bad', priority: 'bad' },
        funnel_diagnosis: { likely_bottleneck: 'bad' },
      },
      mission_doc: null,
    });

    expect(grow.market_research.competitors).toHaveLength(1);
    expect(grow.market_research.market_analysis.key_trends.length).toBeGreaterThan(0);
    expect(grow.market_research.ai_leverage_points.length).toBeGreaterThan(0);
    expect(grow.mission_doc.mission.length).toBeGreaterThan(0);
  });

  it('normalizes broken starter task payloads instead of failing onboarding', () => {
    const tasks = StarterTasksSchema.parse({
      engineering: { title: '', description: '', reasoning: '', complexity: 100 },
      research: null,
      outreach: { title: { text: 'Find 10 prospects' }, description: { summary: 'Talk to prospects about the core pain.' } },
    });

    expect(tasks.engineering.title.length).toBeGreaterThan(0);
    expect(tasks.engineering.complexity).toBe(9);
    expect(tasks.research.description.length).toBeGreaterThan(0);
    expect(tasks.outreach.title).toBe('Find 10 prospects');
  });

  it('renders Build/Surprise in the founder-facing report format', () => {
    const out = renderBuildMarkdown({
      overview: 'Postvo helps small businesses get done-for-you social content without hiring an expensive agency.',
      market_validation: '**The market is large and painful.**\n- Small businesses need social support.\n- DIY tools still require owner time.\n\nWhy now: AI lowers execution cost.',
      competitors: [{
        name: 'LYFE Marketing',
        what_they_do: 'SMB social media agency',
        pricing: 'Starts around agency retainer pricing',
        gap: 'Too expensive for micro-businesses',
      }],
      opportunity: 'Postvo can sit between DIY tools and high-retainer agencies.',
      market_positioning: '**Postvo\'s angle: affordable done-for-you social.**\n- Owners lack time.\n- Freelancers are inconsistent.',
      why_this_fits_you: 'The idea has a clear buyer and visible pain.',
      first_priorities: [
        'Build the MVP — Ship the smallest client approval flow.',
        'Competitive deep dive - Compare agency packages and prices.',
        'Start outreach: Talk to small businesses posting inconsistently.',
      ],
    }, 'Postvo');

    expect(out).toContain('# Market Research Report: Postvo');
    expect(out).toContain('## Idea Overview');
    expect(out).toContain('## Market Validation');
    expect(out).toContain('| Competitor | Focus | Entry Price | Weakness |');
    expect(out).toContain('**The gap Postvo fills:**');
    expect(out).toContain('## Market Positioning');
    expect(out).toContain('## First Priorities');
    expect(out).toContain('1. **Build the MVP** - Ship the smallest client approval flow.');
  });

  it('keeps overly verbose Build/Surprise report sections compact', () => {
    const out = renderBuildMarkdown({
      overview: [
        'Sentence one explains the idea clearly.',
        'Sentence two names the customer and problem.',
        'Sentence three should not survive because overview fields need to stay short.',
      ].join(' '),
      market_validation: [
        '**Demand exists, but it needs focused proof.**',
        '- First useful signal with enough detail to be readable and concrete.',
        '- Second useful signal with enough detail to be readable and concrete.',
        '- Third useful signal with enough detail to be readable and concrete.',
        '- Fourth useful signal with enough detail to be readable and concrete.',
        '- Fifth useful signal with enough detail to be readable and concrete.',
        '- Sixth bullet should not render.',
        'Why now: The timing is useful because buyers are actively comparing alternatives and the first workflow can be tested quickly.',
      ].join('\n'),
      competitors: [{
        name: 'Very Long Competitor Name That Should Still Stay Readable',
        what_they_do: 'A long competitor description that would otherwise take over the table cell with too many details and extra commentary about every possible feature.',
        pricing: 'Pricing has several tiers, custom retainers, implementation fees, and add-ons that should be compacted in the founder-facing table.',
        gap: 'The gap is that customers still need a focused first workflow instead of another broad platform with too many setup steps and vague promises.',
      }],
      opportunity: 'The opportunity is to own one narrow customer workflow first. Later expansion should follow real usage, but this line should not become a consulting memo.',
      market_positioning: [
        '**Own the narrow wedge before the broad platform.**',
        '- The buyer should understand the job immediately.',
        '- The first workflow should be easy to try.',
        '- The proof should come from usage, not abstract claims.',
        '- The offer should stay concrete.',
        '- The positioning should avoid broad platform language.',
        '- Sixth positioning bullet should not render.',
      ].join('\n'),
      why_this_fits_you: 'The direction fits because it preserves the founder input and turns it into a testable first company direction. Anything beyond that should wait for real customer evidence. This third sentence should not survive.',
      first_priorities: [
        'Build the first workflow - Ship the smallest useful customer flow.',
        'Research alternatives - Compare the most relevant substitutes.',
        'Start outreach - Ask likely buyers about the pain.',
      ],
    }, 'CompactCo');

    // Structural caps still hold (max 5 bullets, max paragraphs).
    expect(out).not.toContain('Sixth bullet should not render');
    expect(out).not.toContain('Sixth positioning bullet should not render');
    // Sentence-count caps removed: full content survives. The renderer no
    // longer chops sentences (which produced "USD 1." mid-figure fragments).
    // The LLM is constrained at the prompt layer; renderer is layout-only.
    expect(out).toContain('Sentence three should not survive');
    expect(out).toContain('This third sentence should not survive');
  });

  it('renders Grow in the existing-business report format', () => {
    const out = renderGrowMarkdown({
      business_type: 'agency/studio/consultancy',
      main_growth_bottleneck: 'The main bottleneck is conversion because the offer is not packaged clearly.',
      customer_wedge: 'Pune startups that need credible campaign execution without enterprise agency overhead.',
      offer_packaging_direction: 'Package the first offer around a quote qualifier and proof-backed campaign sprint.',
      market_tension: 'Buyers want creative judgment and measurable proof in the same buying path.',
      business_overview: 'Genesis Advertising is a full-service advertising agency serving brands and SMEs.',
      revenue_model: 'Service retainers and project-based advertising work.',
      notable_validation: 'Visible client roster and long operating history.',
      market_size: [
        { stat: 'Digital ad spend is growing quickly.', confidence: 'medium' },
        { stat: 'Service buyers compare proof before booking calls.', confidence: 'low' },
        { stat: 'Category demand is visible in search.', confidence: 'low' },
        { stat: 'This fourth signal should be hidden.', confidence: 'low' },
      ],
      market_analysis: {
        industry_landscape: 'The market rewards agencies that combine creative work with measurable outcomes.',
        key_trends: [
          'AI-assisted campaign reporting',
          'Short-form video demand',
          'Proof-led buying',
          'Faster proposal cycles',
          'Clearer package comparison',
          'This sixth trend should be hidden',
        ],
        market_timing: 'Strong - buyers expect faster campaign learning loops.',
      },
      growth_opportunity: 'Package a sharper offer around measurable campaign outcomes.',
      competitors: [
        {
          name: 'Schbang',
          focus_area: 'Full-stack digital agency',
          positioning_or_size: 'Large national agency',
          gap: 'Less locally anchored for Pune SMEs',
        },
        { name: 'Two', focus_area: 'Adjacent provider', positioning_or_size: 'Known player', gap: 'Gap' },
        { name: 'Three', focus_area: 'Adjacent provider', positioning_or_size: 'Known player', gap: 'Gap' },
        { name: 'Four', focus_area: 'Adjacent provider', positioning_or_size: 'Known player', gap: 'Gap' },
        { name: 'Five', focus_area: 'Adjacent provider', positioning_or_size: 'Known player', gap: 'Gap' },
        { name: 'Hidden competitor', focus_area: 'Should not render', positioning_or_size: 'Hidden', gap: 'Hidden' },
      ],
      business_edge: 'Genesis has local trust and full-service delivery under one roof.',
      business_gap: 'The website needs a sharper conversion path.',
      competitive_advantages: [
        'Known local brand relationships',
        'Visible operating history',
        'Full-service delivery',
        'Named proof',
        'Local support',
        'This sixth advantage should be hidden',
      ],
      gaps_to_exploit: [
        'Weak public reporting promise among local competitors',
        'Unclear package structure',
        'Thin conversion path',
        'Limited proof packaging',
        'No visible buyer qualifier',
        'This sixth gap should be hidden',
      ],
      threats: [
        'Boutique competitors can win on speed and pricing.',
        'DIY tools can pull budget away from agency retainers.',
        'Enterprise proof may not persuade smaller buyers without packages.',
        'This fourth threat should be hidden.',
      ],
      what_not_to_do_yet: 'Do not scale broad outbound until the offer and proof package are sharper.',
      why_this_fits_you: 'The direction fits the existing business and visible proof.',
      ai_leverage_points: [
        'Automated reporting - Send clients weekly campaign summaries.',
        'Lead triage - Score inbound enquiries by service fit.',
        'Proposal support - Draft package options from buyer needs.',
        'Proof mining - Turn completed work into case study drafts.',
        'Follow-up routing - Prioritize high-intent enquiries.',
        'This sixth AI point should be hidden.',
      ],
      first_priorities: [
        'Build quote qualifier** - Help prospects self-select the right service.',
        'Research agency offers - Compare service packages and proof.',
        'Pitch warm prospects - Contact local companies with visible launch signals.',
      ],
    }, 'Genesis Advertising');

    expect(out).toContain('# Market Research Report: Genesis Advertising');
    expect(out).toContain('## Business Overview');
    expect(out).toContain('## Strategy Spine');
    expect(out).toContain('**Business type:** agency/studio/consultancy');
    expect(out).toContain('**Main bottleneck:** The main bottleneck is conversion');
    expect(out).toContain('**Customer wedge:** Pune startups');
    expect(out).toContain('**Offer / packaging direction:** Package the first offer');
    expect(out).toContain('**Market tension:** Buyers want creative judgment');
    expect(out).toContain('## Market Analysis');
    expect(out).toContain('| Competitor | Focus | Strength / Positioning | Weakness / Gap |');
    expect(out).toContain('## AI Leverage Points');
    expect(out).toContain('1. **Automated reporting** - Send clients weekly campaign summaries.');
    expect(out).toContain('3. **Proposal support** - Draft package options from buyer needs.');
    expect(out).not.toContain('Proof mining');
    expect(out).not.toContain('This sixth AI point should be hidden');
    expect(out).not.toContain('Hidden competitor');
    expect(out).not.toContain('This fourth signal should be hidden');
    expect(out).toContain('**Threats:**');
    expect(out).toContain('Boutique competitors can win on speed and pricing.');
    expect(out).not.toContain('This fourth threat should be hidden');
    expect(out).toContain('**What not to do yet:** Do not scale broad outbound until the offer and proof package are sharper.');
    expect(out).toContain('## First Priorities');
    expect(out).toContain('1. **Build quote qualifier** - Help prospects self-select the right service.');
    expect(out).not.toContain('quote qualifier****');
  });
});
