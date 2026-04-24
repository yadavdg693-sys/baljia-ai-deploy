// Market research — Build My Idea journey
// Product-focused: competitors, features, MVP scope, opportunity gaps

import { isTavilyAvailable } from '@/lib/tavily';
import { trackedTavilySearch as tavilySearchText } from './tracked-calls';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import { persistMarketResearch, renderBuildMarkdown } from './market-research-render';
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
  const rawResearch = rawParts.join('\n\n---\n\n').slice(0, 4500);

  await emitActivity(ctx, 'Synthesizing Build market research (JSON mode)', 'llm');

  const regionLine = country
    ? `Founder is in ${[city, country].filter(Boolean).join(', ')}. Use this region verbatim in "why_this_fits_you" if relevant. Do NOT substitute a hardcoded country.`
    : 'Founder location unknown. Omit region-specific framing in "why_this_fits_you" — never guess a country.';

  const prompt = `You are a market analyst producing a structured product-focused research report for a BUILD-MY-IDEA journey. The founder is about to spend weeks building this — the report needs honest signal, not enthusiasm.

Idea: ${idea}
${ctx.founderAngle ? `Founder positioning: ${ctx.founderAngle}` : ''}
${regionLine}

Raw Tavily search results:
${rawResearch}

BEFORE WRITING, reason through these silently (do not include in output):
  1. DATA QUALITY: How many of the claims in the Tavily results contain concrete numbers (market size, revenue, pricing) that can be directly cited? Rate internally: rich / moderate / thin.
  2. COMPETITOR COVERAGE: How many real, named competitors appear with enough detail to describe pricing and weaknesses?
  3. DEMAND EVIDENCE: Does the Tavily data contain any signal that people actively want this product (forum complaints, app store reviews, "I wish X existed" posts)?

Return a JSON object with this exact shape:
{
  "overview": "<1-2 paragraphs: market overview. Use only numbers you can cite from the Tavily results. If market size data is thin, say so — do not invent stats.>",
  "market_size": [
    { "stat": "<concrete stat, e.g. 'Self-publishing market: $3.2B globally'>", "confidence": "high|medium|low" }
  ],
  "competitors": [
    { "name": "<real competitor from Tavily data>", "what_they_do": "<1 sentence>", "pricing": "<concrete pricing from Tavily, or 'not found — verify manually'>", "gap": "<1-line weakness>" }
  ],
  "demand_signals": [
    "<evidence that people want this specific product — Reddit thread quoted, app store review complaint, forum post, search trend data. Use only what's in the Tavily results.>"
  ],
  "opportunity": "<1 paragraph: where this founder can win. Ground in the demand_signals and competitor gaps above. If those are thin, keep the paragraph shorter and more honest.>",
  "why_this_fits_you": "<1 paragraph, founder-aware, anchored in ${country ?? 'founder region (if known)'}. Speak directly to 'you'.>",
  "data_gaps": [
    "<what Tavily didn't cover — be specific. e.g. 'No pricing data for 2 of 4 competitors', 'No market size figure — only adjacent-market estimates'.>"
  ],
  "first_priorities": [
    { "slot": "engineering", "title": "<12-word max, the MVP slice to build>", "rationale": "<1 sentence>" },
    { "slot": "research", "title": "<format depends on biggest gap: 'Scout the <category>: <A>, <B>, <C>' if competitors need depth; 'Validate demand: forums, reviews, search trends for <product>' if demand is thin; 'Map acquisition: how <A>, <B>, <C> reach <audience>' if channels are unclear>", "rationale": "<1 sentence>" },
    { "slot": "discovery", "title": "<'User discovery: Find N <persona> who <behavior>' — pre-product, so these are INTERVIEWS not sales>", "rationale": "<1 sentence>" }
  ]
}

Rules — accuracy:
- market_size stats: every entry must have a confidence tag. [high] = directly stated in Tavily source. [medium] = inferred from related data. [low] = estimated — flag for manual verification. If zero stats are verifiable, return market_size as an empty array [] and add to data_gaps.
- Competitor names must be real companies that appear in the Tavily data (or are verifiably real). Do not invent.
- Competitor pricing: use real pricing from Tavily, or write exactly "not found — verify manually". Never guess a price.
- demand_signals: use only evidence from Tavily. If no demand signals found, return an empty array [] and add a data_gaps entry like "No direct demand signals found in Tavily results — recommend validating with target users before committing to build."

Rules — shape:
- Up to 6 competitors. Include 3+ if identifiable. If fewer than 3 are identifiable from Tavily data, include what's available and add a data_gaps entry.
- first_priorities MUST have exactly 3 items in this order: engineering, research, discovery (NOT outreach — founder has no product yet, Task 3 is interviewing prospective users, not selling to them).
- Research title adapts to the biggest gap identified: competitor depth, demand validation, or channel mapping.
- data_gaps: include at least 1 entry. If you can think of nothing, you're not being honest.
- No source URLs or citations anywhere in the output.
- Length: 700-1200 words total when rendered. If data is thin, report should be SHORTER, not padded.`;

  const result = await callSmallLLMJson<BuildMarketResearch>(prompt, {
    maxTokens: 2500,
    retryOnce: true,
    sanitizeFields: ['overview', 'opportunity', 'why_this_fits_you'],
    sanitizeArrayOfObjects: ['competitors', 'first_priorities'],
  });

  // Normalize optional new fields so renderer never NPEs
  result.market_size = result.market_size ?? [];
  result.demand_signals = result.demand_signals ?? [];
  result.data_gaps = result.data_gaps ?? [];

  // Validate shape
  if (!Array.isArray(result.competitors) || result.competitors.length === 0) {
    throw new Error('Build market research: competitors array is empty');
  }
  if (!Array.isArray(result.first_priorities) || result.first_priorities.length !== 3) {
    throw new Error('Build market research: first_priorities must have exactly 3 items');
  }

  const markdown = renderBuildMarkdown(result, ctx.companyName);
  await persistMarketResearch(ctx, result, markdown);
  await emitActivity(ctx, `Market research saved (${result.competitors.length} competitors, 3 priorities)`, 'document');
}
