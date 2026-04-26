// Market research — Grow My Company journey
// Distribution-focused: competitor traffic sources, acquisition channels, conversion,
// positioning gaps for an EXISTING business. Denser schema than Build.
//
// Two-pass research: first pass generates report + gap_filling_queries.
// If queries non-empty, second pass runs targeted Tavily searches and re-synthesizes.

import { isTavilyAvailable } from '@/lib/tavily';
import { trackedTavilySearch as tavilySearchText } from './tracked-calls';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import { persistMarketResearch, renderGrowMarkdown } from './market-research-render';
import {
  isResearchQualityThin,
  RESEARCH_QUALITY_WARNING_TEXT,
} from './gap-fill-research';
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
  const initialRaw = rawParts.join('\n\n---\n\n').slice(0, 4500);

  const regionLine = country
    ? `Founder is in ${[city, country].filter(Boolean).join(', ')}. Use this region verbatim in "why_this_fits_you" if relevant. Do NOT substitute a hardcoded country.`
    : 'Founder location unknown. Omit region-specific framing — never guess a country.';


  const buildPrompt = (rawResearch: string): string => `You are a market analyst producing a DISTRIBUTION-focused research report for a GROW-MY-COMPANY journey. The founder already has PMF; they need acquisition and growth levers. Every section must serve one question: "How does this business get more customers, faster and cheaper?"

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
  4. GAP CHECKLIST — flag a data_gaps entry for each NO:
     ☐ Market size: source provided $-figure with year? (else: "no market size data")
     ☐ Competitor count ≥ 3 with real names? (else: "only N competitors found")
     ☐ Each competitor has acquisition channel inferable? (else: list which lack channel data)
     ☐ Each competitor has scale signal (revenue / users / funding)? (else: list which lack scale)
     ☐ CAC benchmarks for this vertical? (else: "no CAC benchmarks for this vertical")
     ☐ Retention data provided in existing_validation? (else: "no retention data — measure before scaling acquisition")

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
    { "name": "<current solution: startup, incumbent, substitute (e.g. 'Spreadsheets + email'), or adjacent tool>", "focus_area": "<what they cover>", "positioning_or_size": "<e.g. '$1B revenue' or 'Enterprise leader', 'manual workflow', or 'unknown'>", "gap": "<1-line DISTRIBUTION weakness — e.g. 'relies entirely on paid, no organic moat' — not product feature gaps>" }
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
    "<run the GAP CHECKLIST above. One entry per NO. Be specific.>"
  ],
  "gap_filling_queries": [
    { "query": "<concrete Tavily search string that would fill a specific data_gap>", "fills": "<1-line label of which gap this query targets>" }
  ],
  "first_priorities": [
    { "slot": "engineering", "title": "<12-word max — OPTIMIZATION task gated by retention_check. If retention signal is 'warning', this task MUST be a retention fix, not an acquisition feature. NOT 'build landing page' (already done).>", "rationale": "<1 sentence>" },
    { "slot": "research", "title": "<'Map acquisition channels: how <A>, <B>, <C> get users' OR 'Analyze conversion funnels: <A>, <B>, <C> onboarding' OR 'Scout pricing: how <A>, <B>, <C> monetize' — pick based on biggest gap>", "rationale": "<1 sentence>" },
    { "slot": "outreach", "title": "<'Cold outreach: Find N <role> who <buying signal>' — these are SALES prospects with buying signals, not research subjects>", "rationale": "<1 sentence>" }
  ]
}

Rules — accuracy:
- market_size: every entry confidence-tagged. [high]=directly from Tavily. [medium]=inferred. [low]=estimated, flag for manual verification. If zero verifiable stats, return []. Add a data_gaps entry.
- "Competitor" is broader than named startups. Include any current solution the target customer compares against:
  · Direct startup products
  · Incumbent legacy vendors
  · Substitute behaviors: spreadsheets, manual workflows, agencies, hired help
  · Adjacent generalist tools (Notion, Excel) used as a workaround
- There is NEVER a scenario with zero competitors — at minimum, customers solve this today with a substitute or manual workflow.
- Names must be real (a real startup OR a real incumbent OR a real substitute behavior). Do not invent fictitious products.
- Competitor gap must be about DISTRIBUTION ("no free tier to drive adoption", "enterprise-only excludes SMB", "no marketing spend behind it") — not product features.
- retention_check is REQUIRED. If existing_validation mentions churn > 8% monthly OR declining engagement, signal MUST be "warning" and priority MUST be "fix_retention_first". Do NOT recommend scaling acquisition when retention is broken.
- If no retention data in existing_validation, signal = "unknown", priority = "measure_first".

Rules — gap_filling_queries:
- Return 0-4 queries. Empty array [] is fine if data_gaps is small.
- Each query must target a specific data_gaps entry. The "fills" field must reference that gap.
- Queries should be specific — use site: operators, year qualifiers, or competitor names. Examples:
  · gap "no CAC benchmarks for vertical" → query "${category} customer acquisition cost benchmark 2024"
  · gap "no acquisition channel for CompetitorX" → query "CompetitorX SimilarWeb traffic sources" or "CompetitorX SEO content strategy"
  · gap "only 2 competitors found" → query "best ${category} alternatives 2026"
- Do not repeat the 3 generic queries the orchestrator already ran.

Rules — shape:
- Focus on DISTRIBUTION and acquisition, not product landscape.
- Up to 6 competitors. MUST include at least 3 — if direct startups are sparse, fill remaining slots with incumbents, substitutes, or adjacent tools. The array is never empty.
- key_trends, competitive_advantages, gaps_to_exploit, ai_leverage_points: up to 4-5 each, but only real items. Don't pad to hit a count.
- first_priorities: exactly 3 items in order: engineering, research, outreach. Engineering is OPTIMIZATION (or retention fix if retention_check.signal = "warning"), not new MVP.
- data_gaps: at least 1 entry. Honesty about gaps beats fabricated completeness.
- No source URLs or citations.
- Length: 1000-1500 words when rendered. If data is thin, shorter. Macro market stats (e.g. "AI SaaS market $22B→$367B") are NOT the headline. If only macro data is available, lead with "No niche-specific data — flagged in data_gaps" and demote macro stats to a closing context paragraph.`;

  // ────────────── Single-pass research ──────────────
  await emitActivity(ctx, 'Synthesizing Grow market research (distribution focus)', 'llm');
  const result = await callSmallLLMJson<GrowMarketResearch>(buildPrompt(initialRaw), {
    maxTokens: 3000,
    retryOnce: true,
    sanitizeFields: ['business_overview', 'revenue_model', 'notable_validation', 'why_this_fits_you'],
    sanitizeArrayOfObjects: ['competitors', 'first_priorities'],
  });

  // ────────────── Normalize + graceful degradation ──────────────
  result.market_size = result.market_size ?? [];
  result.data_gaps = result.data_gaps ?? [];
  result.gap_filling_queries = result.gap_filling_queries ?? [];
  if (!result.retention_check) {
    result.retention_check = { signal: 'unknown', rationale: 'no retention data provided', priority: 'measure_first' };
  }
  if (!result.funnel_diagnosis) {
    result.funnel_diagnosis = { likely_bottleneck: 'awareness', rationale: 'insufficient data to diagnose — default assumption' };
  }

  if (isResearchQualityThin(result.data_gaps)) {
    result.research_quality_warning = RESEARCH_QUALITY_WARNING_TEXT;
  }

  if (!Array.isArray(result.competitors) || result.competitors.length === 0) {
    throw new Error('Grow market research: competitors array is empty');
  }
  if (!Array.isArray(result.first_priorities) || result.first_priorities.length !== 3) {
    throw new Error('Grow market research: first_priorities must have exactly 3 items');
  }

  const markdown = renderGrowMarkdown(result, ctx.companyName);
  await persistMarketResearch(ctx, result, markdown);
  await emitActivity(
    ctx,
    `Market research saved (distribution focus, ${result.competitors.length} competitors, ${result.data_gaps.length} gaps, retention: ${result.retention_check.signal})`,
    'document',
  );
}
