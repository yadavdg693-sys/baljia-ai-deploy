// Market research — Surprise Me journey
// Build-shaped plus Why Now + Idea Refinements to justify the system-invented idea

import { tavilySearchText, isTavilyAvailable } from '@/lib/tavily';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import { persistMarketResearch, renderSurpriseMarkdown } from './market-research-render';
import type { PipelineContext, SurpriseMarketResearch } from '../types';

export async function generateSurpriseMarketResearch(ctx: PipelineContext): Promise<void> {
  if (!isTavilyAvailable()) {
    throw new Error('Surprise market research requires Tavily — not configured');
  }

  const idea = ctx.inventedIdea?.invented_idea ?? ctx.strategy ?? '';
  if (!idea) {
    throw new Error('Surprise market research: no idea available (invented_idea required)');
  }

  const geo = ctx.founderEnrichment?.geo;
  const country = geo?.country ?? null;
  const city = geo?.city ?? null;

  const queries = [
    `${idea} competitors features pricing 2025`,
    `${idea} market size growth funding why now 2024 2025`,
    `${idea} reviews complaints what customers want`,
  ];

  for (const q of queries) {
    await emitActivity(ctx, `Searching: "${q.slice(0, 90)}"`, 'tavily_search');
  }

  const [competitorRaw, whyNowRaw, reviewRaw] = await Promise.all([
    tavilySearchText(queries[0], 5, 'advanced'),
    tavilySearchText(queries[1], 4),
    tavilySearchText(queries[2], 4),
  ]);

  const rawParts = [competitorRaw, whyNowRaw, reviewRaw].filter(Boolean);
  if (rawParts.length === 0) {
    throw new Error('Surprise market research: Tavily returned zero results across all queries');
  }
  const rawResearch = rawParts.join('\n\n---\n\n').slice(0, 4500);

  await emitActivity(ctx, 'Synthesizing Surprise market research (with Why Now + Idea Refinements)', 'llm');

  const regionLine = country
    ? `Founder is in ${[city, country].filter(Boolean).join(', ')}. Use this region verbatim in "why_this_fits_you" if relevant. Do NOT substitute a hardcoded country.`
    : 'Founder location unknown. Omit region-specific framing — never guess a country.';

  const prompt = `You are a market analyst producing a structured product-focused research report for a SURPRISE-ME journey. The system invented this idea from founder background — the report must also justify WHY NOW and propose IDEA REFINEMENTS to sharpen it.

Invented idea: ${idea}
${ctx.founderAngle ? `Founder positioning: ${ctx.founderAngle}` : ''}
Founder background summary: ${(ctx.enrichedFounderSummary ?? '').slice(0, 300)}
${regionLine}

Raw Tavily search results:
${rawResearch}

Return a JSON object with this exact shape:
{
  "idea_overview": "<1-2 paragraphs: what the product does, who the audience is, and why this specific founder is well-suited>",
  "market_validation": {
    "size_and_growth": ["<concrete stat 1 — $X market, Y% CAGR>", "<stat 2>", "<stat 3>", "<stat 4>", "<stat 5>"],
    "why_now": ["<timing signal 1>", "<timing signal 2>", "<timing signal 3>", "<timing signal 4>"]
  },
  "competitors": [
    { "name": "<actual competitor>", "what_they_do": "<1 sentence>", "pricing": "<e.g. '$29/mo'>", "gap": "<1-line weakness>" }
  ],
  "why_this_fits_you": "<1 paragraph, founder-aware, anchored in ${country ?? 'founder region (if known)'}>",
  "idea_refinements": [
    { "title": "<short refinement headline>", "rationale": "<1 sentence — how this sharpens the invented idea>" }
  ],
  "first_priorities": [
    { "slot": "engineering", "title": "<12-word max title>", "rationale": "<1 sentence>" },
    { "slot": "research", "title": "<Scout the <category>: <Competitor1>, <Competitor2>, <Competitor3>>", "rationale": "<1 sentence>" },
    { "slot": "outreach", "title": "<Cold outreach: Find N <role> in <situation>>", "rationale": "<1 sentence>" }
  ]
}

Rules:
- Minimum 5 size_and_growth bullets, 4 why_now bullets
- 4-6 competitors (min 3)
- Exactly 4 idea_refinements (sharpening the invented idea from different angles)
- first_priorities MUST have exactly 3 items in order: engineering, research, outreach
- Research title MUST name 3+ actual competitors
- No source URLs or citations
- Length: 1000-1300 words when rendered`;

  const result = await callSmallLLMJson<SurpriseMarketResearch>(prompt, { maxTokens: 2800, retryOnce: true });

  if (!Array.isArray(result.competitors) || result.competitors.length === 0) {
    throw new Error('Surprise market research: competitors array is empty');
  }
  if (!Array.isArray(result.first_priorities) || result.first_priorities.length !== 3) {
    throw new Error('Surprise market research: first_priorities must have exactly 3 items');
  }

  const markdown = renderSurpriseMarkdown(result, ctx.companyName);
  await persistMarketResearch(ctx, result, markdown);
  await emitActivity(ctx, `Market research saved (${result.competitors.length} competitors, ${result.idea_refinements.length} refinements)`, 'document');
}
