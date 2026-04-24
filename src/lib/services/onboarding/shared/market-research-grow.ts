// Market research — Grow My Company journey
// Distribution-focused: competitor traffic sources, acquisition channels, conversion,
// positioning gaps for an EXISTING business. Denser schema than Build.

import { isTavilyAvailable } from '@/lib/tavily';
import { trackedTavilySearch as tavilySearchText } from './tracked-calls';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import { persistMarketResearch, renderGrowMarkdown } from './market-research-render';
import type { PipelineContext, GrowMarketResearch } from '../types';

export async function generateGrowMarketResearch(ctx: PipelineContext): Promise<void> {
  if (!isTavilyAvailable()) {
    throw new Error('Grow market research requires Tavily — not configured');
  }

  const profile = ctx.businessProfile;
  if (!profile) {
    throw new Error('Grow market research: ctx.businessProfile not set (fetch_business_url must run first)');
  }

  const geo = ctx.founderEnrichment?.geo;
  const country = geo?.country ?? null;
  const city = geo?.city ?? null;

  const category = profile.description.split(/[.,]/)[0].trim() || profile.business_name;
  const queries = [
    `${category} competitors traffic sources SimilarWeb`,
    `${category} acquisition channels conversion rate landing page`,
    `${profile.target_customer ?? category} communities reddit forums where they hang out`,
  ];

  for (const q of queries) {
    await emitActivity(ctx, `Searching: "${q.slice(0, 90)}"`, 'tavily_search');
  }

  const [competitorRaw, channelRaw, audienceRaw] = await Promise.all([
    tavilySearchText(queries[0], 5, 'advanced'),
    tavilySearchText(queries[1], 4),
    tavilySearchText(queries[2], 4),
  ]);

  const rawParts = [competitorRaw, channelRaw, audienceRaw].filter(Boolean);
  if (rawParts.length === 0) {
    throw new Error('Grow market research: Tavily returned zero results across all queries');
  }
  const rawResearch = rawParts.join('\n\n---\n\n').slice(0, 4500);

  await emitActivity(ctx, 'Synthesizing Grow market research (distribution focus, JSON mode)', 'llm');

  const regionLine = country
    ? `Founder is in ${[city, country].filter(Boolean).join(', ')}. Use this region verbatim in "why_this_fits_you" if relevant. Do NOT substitute a hardcoded country.`
    : 'Founder location unknown. Omit region-specific framing — never guess a country.';

  const prompt = `You are a market analyst producing a DISTRIBUTION-focused research report for a GROW-MY-COMPANY journey. The founder already has PMF; they need acquisition and growth levers.

Business: ${profile.business_name}
Description: ${profile.description}
Revenue model: ${profile.revenue_model ?? 'unclear'}
Target customer: ${profile.target_customer ?? 'unclear'}
Existing validation: ${profile.existing_validation ?? 'none visible'}
${ctx.founderAngle ? `Founder positioning: ${ctx.founderAngle}` : ''}
${regionLine}

Raw Tavily search results:
${rawResearch}

Return a JSON object with this exact shape:
{
  "business_overview": "<1-2 paragraphs about the business: what it does, scale, who uses it>",
  "revenue_model": "<concrete revenue model — repeat or sharpen the one above>",
  "notable_validation": "<concrete validation signal if any (logos, funding, users, press) — or null>",
  "market_analysis": {
    "industry_landscape": "<1 paragraph: industry size, dominant players, growth trajectory>",
    "key_trends": ["<trend 1>", "<trend 2>", "<trend 3>", "<trend 4>"],
    "market_timing": "<Strong|Moderate|Early + 1-line rationale>"
  },
  "competitors": [
    { "name": "<competitor>", "focus_area": "<what they cover>", "positioning_or_size": "<e.g. '$1B revenue' or 'Enterprise leader'>", "gap": "<1-line weakness>" }
  ],
  "competitive_advantages": ["<advantage 1>", "<advantage 2>", "<advantage 3>", "<advantage 4>"],
  "gaps_to_exploit": ["<gap 1 — distribution/channel/conversion focus>", "<gap 2>", "<gap 3>", "<gap 4>"],
  "why_this_fits_you": "<1 paragraph, founder-aware, anchored in ${country ?? 'founder region (if known)'}>",
  "ai_leverage_points": ["<how AI can sharpen growth 1>", "<2>", "<3>", "<4>", "<5>"],
  "first_priorities": [
    { "slot": "engineering", "title": "<12-word max title — an OPTIMIZATION task, not new MVP>", "rationale": "<1 sentence>" },
    { "slot": "research", "title": "<Scout the <category>: <Competitor1>, <Competitor2>, <Competitor3> — focus on acquisition channels>", "rationale": "<1 sentence>" },
    { "slot": "outreach", "title": "<Cold outreach: Find N <role> in <situation>>", "rationale": "<1 sentence>" }
  ]
}

Rules:
- Focus on DISTRIBUTION and acquisition, not product landscape
- 4-6 competitors, never fewer than 3
- 4 trends, 4 advantages, 4 gaps, 5 AI leverage points (minimums — more is OK)
- first_priorities MUST have exactly 3 items in order: engineering, research, outreach
- Engineering task is an OPTIMIZATION to existing product (not a new MVP)
- No source URLs or citations
- Length: 1000-1400 words when rendered (Grow is denser than Build)`;

  const result = await callSmallLLMJson<GrowMarketResearch>(prompt, {
    maxTokens: 2800,
    retryOnce: true,
    sanitizeFields: ['business_overview', 'revenue_model', 'notable_validation', 'why_this_fits_you'],
    sanitizeArrayOfObjects: ['competitors', 'first_priorities'],
  });

  if (!Array.isArray(result.competitors) || result.competitors.length === 0) {
    throw new Error('Grow market research: competitors array is empty');
  }
  if (!Array.isArray(result.first_priorities) || result.first_priorities.length !== 3) {
    throw new Error('Grow market research: first_priorities must have exactly 3 items');
  }

  const markdown = renderGrowMarkdown(result, ctx.companyName);
  await persistMarketResearch(ctx, result, markdown);
  await emitActivity(ctx, `Market research saved (distribution focus, ${result.competitors.length} competitors, 3 priorities)`, 'document');
}
