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

  const prompt = `You are a market analyst producing a DISTRIBUTION-focused research report for a GROW-MY-COMPANY journey. The founder already has PMF; they need acquisition and growth levers. Every section must serve one question: "How does this business get more customers, faster and cheaper?"

Business: ${profile.business_name}
Description: ${profile.description}
Revenue model: ${profile.revenue_model ?? 'unclear'}
Target customer: ${profile.target_customer ?? 'unclear'}
Existing validation: ${profile.existing_validation ?? 'none visible'}
${ctx.founderAngle ? `Founder positioning: ${ctx.founderAngle}` : ''}
${regionLine}

Raw Tavily search results:
${rawResearch}

BEFORE WRITING, reason through these silently (do not include in output):
  1. RETENTION SIGNAL: Does existing_validation mention churn, retention, engagement, repeat usage? If churn is high (>8% monthly) OR retention is explicitly a problem — the report MUST set retention_check.signal = "warning" and recommend fixing retention BEFORE scaling acquisition. Pouring traffic into a leaky bucket wastes money.
  2. FUNNEL BOTTLENECK: Based on current scale, where is the biggest drop-off likely — awareness, activation, retention, or monetization?
  3. DATA QUALITY: How concrete are the Tavily results? Rate internally: rich / moderate / thin.

Return a JSON object with this exact shape:
{
  "business_overview": "<1-2 paragraphs: what the business does, scale, who uses it. Sharpen the description — don't just parrot it back.>",
  "revenue_model": "<concrete revenue model — repeat or sharpen>",
  "notable_validation": "<concrete validation signal (logos, funding, users, press) — or null>",
  "market_size": [
    { "stat": "<concrete market size or growth stat from Tavily>", "confidence": "high|medium|low" }
  ],
  "market_analysis": {
    "industry_landscape": "<1 paragraph: industry context>",
    "key_trends": ["<trend directly relevant to THIS business's growth — not generic industry news>"],
    "market_timing": "<Strong|Moderate|Early + 1-line rationale>"
  },
  "competitors": [
    { "name": "<real competitor>", "focus_area": "<what they cover>", "positioning_or_size": "<e.g. '$1B revenue' or 'Enterprise leader', or 'unknown'>", "gap": "<1-line DISTRIBUTION weakness — e.g. 'relies entirely on paid, no organic moat' — not product feature gaps>" }
  ],
  "competitive_advantages": ["<specific, defensible advantage — not 'better UX'>"],
  "gaps_to_exploit": ["<specific distribution/channel/conversion gap>"],
  "why_this_fits_you": "<1 paragraph, founder-aware, focus on distribution fit (network, industry experience, content skills) — anchored in ${country ?? 'founder region (if known)'}>",
  "ai_leverage_points": ["<automation opportunity tied to THIS business's funnel, not generic AI hype>"],
  "retention_check": {
    "signal": "healthy|warning|unknown",
    "rationale": "<1 sentence based on existing_validation>",
    "priority": "scale_acquisition|fix_retention_first|measure_first"
  },
  "funnel_diagnosis": {
    "likely_bottleneck": "awareness|acquisition|activation|retention|monetization|referral",
    "rationale": "<1 sentence: why this bottleneck, based on scale + validation signals>"
  },
  "data_gaps": [
    "<what's missing — e.g. 'No CAC benchmarks for this vertical', 'No retention data provided by founder'>"
  ],
  "first_priorities": [
    { "slot": "engineering", "title": "<12-word max — OPTIMIZATION task gated by retention_check. If retention signal is 'warning', this task MUST be a retention fix, not an acquisition feature>", "rationale": "<1 sentence>" },
    { "slot": "research", "title": "<'Map acquisition channels: how <A>, <B>, <C> get users' OR 'Analyze conversion funnels: <A>, <B>, <C> onboarding' OR 'Scout pricing: how <A>, <B>, <C> monetize' — pick based on biggest gap>", "rationale": "<1 sentence>" },
    { "slot": "outreach", "title": "<'Cold outreach: Find N <role> who <buying signal>' — these are SALES prospects with buying signals, not research subjects>", "rationale": "<1 sentence>" }
  ]
}

Rules — accuracy:
- market_size: every entry confidence-tagged. [high]=directly from Tavily. [medium]=inferred. [low]=estimated, flag for manual verification. If zero verifiable stats, return []. Add a data_gaps entry.
- Competitor names must be real from Tavily. Competitor gap must be about DISTRIBUTION ("no free tier to drive adoption", "enterprise-only excludes SMB") not product features.
- retention_check is REQUIRED. If existing_validation mentions churn > 8% monthly OR declining engagement, signal MUST be "warning" and priority MUST be "fix_retention_first". Do NOT recommend scaling acquisition when retention is broken.
- If no retention data in existing_validation, signal = "unknown", priority = "measure_first".

Rules — shape:
- Focus on DISTRIBUTION and acquisition, not product landscape.
- Up to 6 competitors. 3+ ideally. If fewer, add to data_gaps.
- key_trends, competitive_advantages, gaps_to_exploit, ai_leverage_points: up to 4-5 each, but only real items. Don't pad to hit a count.
- first_priorities: exactly 3 items in order: engineering, research, outreach. Engineering is OPTIMIZATION (or retention fix if retention_check.signal = "warning"), not new MVP.
- data_gaps: at least 1 entry. Honesty about gaps beats fabricated completeness.
- No source URLs or citations.
- Length: 1000-1500 words when rendered. If data is thin, shorter.`;

  const result = await callSmallLLMJson<GrowMarketResearch>(prompt, {
    maxTokens: 2800,
    retryOnce: true,
    sanitizeFields: ['business_overview', 'revenue_model', 'notable_validation', 'why_this_fits_you'],
    sanitizeArrayOfObjects: ['competitors', 'first_priorities'],
  });

  // Normalize optional new fields so renderer never NPEs
  result.market_size = result.market_size ?? [];
  result.data_gaps = result.data_gaps ?? [];
  if (!result.retention_check) {
    result.retention_check = { signal: 'unknown', rationale: 'no retention data provided', priority: 'measure_first' };
  }
  if (!result.funnel_diagnosis) {
    result.funnel_diagnosis = { likely_bottleneck: 'awareness', rationale: 'insufficient data to diagnose — default assumption' };
  }

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
