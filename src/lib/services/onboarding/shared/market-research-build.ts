// Market research — Build My Idea journey
// Product-focused: competitors, features, MVP scope, opportunity gaps
//
// Two-pass research: first pass generates the report + gap_filling_queries.
// If queries are non-empty, second pass runs targeted Tavily searches and
// re-synthesizes with combined raw data. Graceful degradation: if 2nd pass
// still leaves significant gaps, set proceed_or_pause = 'validate_first' so
// the founder is told to validate before building.

import { isTavilyAvailable } from '@/lib/tavily';
import { trackedTavilySearch as tavilySearchText } from './tracked-calls';
import { callSmallLLMJson } from './json-mode';
import { BuildMarketResearchSchema } from './schemas';
import { emitActivity } from '../stage-runner';
import { persistMarketResearch, renderBuildMarkdown } from './market-research-render';
import {
  isResearchQualityThin,
  RESEARCH_QUALITY_WARNING_TEXT,
} from './gap-fill-research';
import type { PipelineContext, BuildMarketResearch } from '../types';

export async function generateBuildMarketResearch(ctx: PipelineContext): Promise<void> {
  if (!isTavilyAvailable()) {
    throw new Error('Build market research requires Tavily — not configured');
  }

  const idea = ctx.refinedIdea?.refined_idea ?? ctx.strategy ?? ctx.input ?? '';
  if (!idea) {
    throw new Error('Build market research: no idea available (refined_idea or strategy required)');
  }

  const geo = ctx.founderEnrichment?.geo;
  const country = geo?.country ?? null;
  const city = geo?.city ?? null;

  const queries = [
    `${idea} competitors features pricing 2025`,
    `${idea} market size growth rate 2024 2025`,
    `${idea} reviews complaints what customers dislike`,
  ];

  for (const q of queries) {
    await emitActivity(ctx, `Searching: "${q.slice(0, 90)}"`, 'tavily_search');
  }

  const [competitorRaw, marketRaw, reviewRaw] = await Promise.all([
    tavilySearchText(queries[0], 5, 'advanced'),
    tavilySearchText(queries[1], 4),
    tavilySearchText(queries[2], 4),
  ]);

  const rawParts = [competitorRaw, marketRaw, reviewRaw].filter(Boolean);
  if (rawParts.length === 0) {
    throw new Error('Build market research: Tavily returned zero results across all queries');
  }
  const initialRaw = rawParts.join('\n\n---\n\n').slice(0, 4500);

  const regionLine = country
    ? `Founder is in ${[city, country].filter(Boolean).join(', ')}. Use this region verbatim in "why_this_fits_you" if relevant. Do NOT substitute a hardcoded country.`
    : 'Founder location unknown. Omit region-specific framing in "why_this_fits_you" — never guess a country.';


  const buildPrompt = (rawResearch: string): string => `You are a market analyst producing a structured product-focused research report for a BUILD-MY-IDEA journey. The founder is about to spend weeks building this — the report needs honest signal, not enthusiasm.

Idea: ${idea}
${ctx.founderAngle ? `Founder positioning: ${ctx.founderAngle}` : ''}
${regionLine}

Raw Tavily search results:
${rawResearch}

BEFORE WRITING, reason through these silently (do not include in output):
  1. DATA QUALITY: How many of the claims in the Tavily results contain concrete numbers (market size, revenue, pricing) that can be directly cited? Rate internally: rich / moderate / thin.
  2. COMPETITOR COVERAGE: How many real, named competitors appear with enough detail to describe pricing and weaknesses?
  3. DEMAND EVIDENCE: Does the Tavily data contain any signal that people actively want this product (forum complaints, app store reviews, "I wish X existed" posts)?
  4. GAP CHECKLIST — flag a data_gaps entry for each NO:
     ☐ Market size: source provided $-figure with year? (else: "no market size data")
     ☐ Competitor count ≥ 3 with real names? (else: "only N competitors found")
     ☐ Each competitor has pricing data? (else: list which lack pricing)
     ☐ Each competitor has scale signal (users / revenue / funding)? (else: list which lack scale)
     ☐ ≥1 demand signal (forum / review / social / search trend)? (else: "no demand evidence")
     ☐ Stats < 2 years old? (else: "stats may be outdated")

Return a JSON object with this exact shape:
{
  "overview": "<1-2 paragraphs: market overview. Use only numbers you can cite from the Tavily results. If market size data is thin, say so — do not invent stats.>",
  "market_size": [
    { "stat": "<concrete stat, e.g. 'Self-publishing market: $3.2B globally'>", "confidence": "high|medium|low" }
  ],
  "competitors": [
    { "name": "<current solution: startup, incumbent, substitute (e.g. 'Spreadsheets + email'), or adjacent tool>", "what_they_do": "<1 sentence>", "pricing": "<pricing from Tavily, 'free / manual', or 'not found — verify manually'>", "gap": "<1-line weakness>" }
  ],
  "demand_signals": [
    "<evidence that people want this specific product — Reddit thread quoted, app store review complaint, forum post, search trend data. Use only what's in the Tavily results.>"
  ],
  "opportunity": "<1 paragraph: where this founder can win. Ground in the demand_signals and competitor gaps above. If those are thin, keep the paragraph shorter and more honest.>",
  "why_this_fits_you": "<1 paragraph, founder-aware, anchored in ${country ?? 'founder region (if known)'}. Speak directly to 'you'.>",
  "data_gaps": [
    "<run the GAP CHECKLIST above. One entry per NO. Be specific — e.g. 'No pricing data for Sudowrite and Squibler', 'No market size figure — only adjacent-market estimates'.>"
  ],
  "gap_filling_queries": [
    { "query": "<concrete Tavily search string that would fill a specific data_gap>", "fills": "<1-line label of which gap this query targets, matching a data_gaps entry>" }
  ],
  "proceed_or_pause": "proceed|narrow_first|validate_first",
  "proceed_note": "<1 sentence — why this verdict, founder-facing>",
  "first_priorities": [
    { "slot": "engineering", "title": "<12-word max, the MVP slice to build at ${ctx.slug}.baljia.app/app — NOT 'build landing page' (already done)>", "rationale": "<1 sentence>" },
    { "slot": "research", "title": "<format depends on biggest gap: 'Scout the <category>: <A>, <B>, <C>' if competitors need depth; 'Validate demand: forums, reviews, search trends for <product>' if demand is thin; 'Map acquisition: how <A>, <B>, <C> reach <audience>' if channels are unclear>", "rationale": "<1 sentence>" },
    { "slot": "discovery", "title": "<'User discovery: Find N <persona> who <behavior>' — pre-product, so these are INTERVIEWS not sales>", "rationale": "<1 sentence>" }
  ]
}

Rules — accuracy:
- market_size stats: every entry must have a confidence tag. [high] = directly stated in Tavily source. [medium] = inferred from related data. [low] = estimated — flag for manual verification. If zero stats are verifiable, return market_size as an empty array [] and add to data_gaps.
- "Competitor" is broader than named startups. Include any current solution your customer would compare against:
  · Direct startup products competing for the same job
  · Incumbent legacy vendors (older software, enterprise suites)
  · Substitute behaviors: spreadsheets, email, manual workflows, hired help, agencies, freelancers
  · Adjacent generalist tools customers stretch to use (Notion, Excel, Google Sheets, Airtable)
- There is NEVER a scenario with zero competitors — at minimum, customers solve this today with a manual workflow or substitute tool. Surface that as a competitor.
- Names must be real (real startup OR real incumbent OR a real substitute behavior). Do not invent fictitious products.
- Pricing: use real pricing from Tavily for products, write "free / manual" for substitute behaviors (spreadsheets, email), or "not found — verify manually" for products with unclear pricing. Never guess a startup's price.
- demand_signals: use only evidence from Tavily. If no demand signals found, return an empty array [] and add a data_gaps entry like "No direct demand signals found in Tavily results — recommend validating with target users before committing to build."

Rules — gap_filling_queries:
- Return 0-4 queries. Empty array [] is fine if data_gaps is small or already filled.
- Each query must target a specific data_gaps entry. The "fills" field must reference that gap.
- Queries should be specific — use site: operators, year qualifiers, or exact competitor names where useful. Examples:
  · gap "no pricing for Sudowrite" → query "Sudowrite pricing site:sudowrite.com"
  · gap "no demand signals" → query "AI book outlining tools reddit"
  · gap "only 2 competitors found" → query "best AI writing tools nonfiction 2026"
- Do not repeat queries that the orchestrator already ran (the 3 generic ones above).

Rules — proceed_or_pause (the go/no-go gate):
- "proceed" = data supports building. Market size present, ≥3 competitors with pricing, ≥1 demand signal.
- "narrow_first" = idea is too broad. Recommend the founder pick a tighter scope before building. Use when competitors are dominant in the broad space but a niche slice may be defensible.
- "validate_first" = insufficient demand signal OR market size data. The founder should validate with users before committing build resources. ALWAYS use this when demand_signals is empty.

Rules — shape:
- Up to 6 competitors. MUST include at least 3 — if direct startups are sparse, fill remaining slots with incumbents, substitutes, or adjacent tools. The array is never empty.
- first_priorities MUST have exactly 3 items in this order: engineering, research, discovery (NOT outreach — founder has no product yet, Task 3 is interviewing prospective users, not selling to them).
- Research title adapts to the biggest gap identified: competitor depth, demand validation, or channel mapping.
- data_gaps: include at least 1 entry. If you can think of nothing, you're not being honest.
- No source URLs or citations anywhere in the output.
- Length: 700-1200 words total when rendered. If data is thin, report should be SHORTER, not padded. Macro market stats (e.g. "AI SaaS market $22B→$367B") are NOT the headline. If only macro data is available, lead with "No niche-specific data — flagged in data_gaps" and demote macro stats to a closing context paragraph.`;

  // ────────────── Single-pass research ──────────────
  await emitActivity(ctx, 'Synthesizing Build market research', 'llm');
  const result = await callSmallLLMJson<BuildMarketResearch>(buildPrompt(initialRaw), {
    maxTokens: 2800,
    retryOnce: true,
    schema: BuildMarketResearchSchema,
    sanitizeFields: ['overview', 'opportunity', 'why_this_fits_you'],
    sanitizeArrayOfObjects: ['competitors', 'first_priorities'],
  });

  // ────────────── Normalize + graceful degradation ──────────────
  result.market_size = result.market_size ?? [];
  result.demand_signals = result.demand_signals ?? [];
  result.data_gaps = result.data_gaps ?? [];
  result.gap_filling_queries = result.gap_filling_queries ?? [];

  // gap_filling_queries are preserved in the saved JSON so the night-shift
  // research agent can act on them later — we just don't run them inline here.
  if (isResearchQualityThin(result.data_gaps) || result.demand_signals.length === 0) {
    result.research_quality_warning = RESEARCH_QUALITY_WARNING_TEXT;
    if (result.demand_signals.length === 0) {
      result.proceed_or_pause = 'validate_first';
      result.proceed_note =
        result.proceed_note ||
        'No demand signals found. Validate with 10+ target users before committing build resources.';
    }
  }

  // Validate shape
  if (!Array.isArray(result.competitors) || result.competitors.length === 0) {
    throw new Error('Build market research: competitors array is empty');
  }
  if (!Array.isArray(result.first_priorities) || result.first_priorities.length !== 3) {
    throw new Error('Build market research: first_priorities must have exactly 3 items');
  }

  const markdown = renderBuildMarkdown(result, ctx.companyName);
  await persistMarketResearch(ctx, result, markdown);
  await emitActivity(
    ctx,
    `Market research saved (${result.competitors.length} competitors, ${result.data_gaps.length} gaps, verdict: ${result.proceed_or_pause ?? 'unset'})`,
    'document',
  );
}
