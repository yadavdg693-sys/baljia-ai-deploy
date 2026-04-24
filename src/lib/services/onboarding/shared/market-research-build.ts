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

  const prompt = `You are a market analyst producing a structured product-focused research report for a BUILD-MY-IDEA journey.

Idea: ${idea}
${ctx.founderAngle ? `Founder positioning: ${ctx.founderAngle}` : ''}
${regionLine}

Raw Tavily search results:
${rawResearch}

Return a JSON object with this exact shape:
{
  "overview": "<1-2 paragraphs: market overview with concrete numbers — market size in $B/$M, growth rate, adoption stats. Cite numbers from the Tavily results, never invent.>",
  "competitors": [
    { "name": "<actual competitor name>", "what_they_do": "<1 sentence>", "pricing": "<e.g. '$29/mo Pro' or 'Free + paid from $19/mo'>", "gap": "<1-line weakness>" }
  ],
  "opportunity": "<1 paragraph + an implied bullet list: what nobody has built. What customers complain about. Where this founder can win.>",
  "why_this_fits_you": "<1 paragraph, founder-aware, anchored in ${country ?? 'founder region (if known)'}. Speak directly to 'you'.>",
  "first_priorities": [
    { "slot": "engineering", "title": "<12-word max title for the core build task>", "rationale": "<1 sentence>" },
    { "slot": "research", "title": "<Scout the <category>: <Competitor1>, <Competitor2>, <Competitor3>>", "rationale": "<1 sentence>" },
    { "slot": "outreach", "title": "<Cold outreach: Find N <role> in <situation>>", "rationale": "<1 sentence>" }
  ]
}

Rules:
- 4-6 competitors, never fewer than 3
- Each competitor must have concrete pricing and a sharp 1-line gap
- first_priorities MUST have exactly 3 items in order: engineering, research, outreach
- Research title MUST name 3+ actual competitors from the competitors[] array
- No source URLs or citations anywhere in the output
- Length: 800-1200 words total when rendered`;

  const result = await callSmallLLMJson<BuildMarketResearch>(prompt, {
    maxTokens: 2500,
    retryOnce: true,
    sanitizeFields: ['overview', 'opportunity', 'why_this_fits_you'],
    sanitizeArrayOfObjects: ['competitors', 'first_priorities'],
  });

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
