// Market research — Surprise Me journey
// Build-shaped plus Why Now + Idea Refinements to justify the system-invented idea

import { isTavilyAvailable } from '@/lib/tavily';
import { trackedTavilySearch as tavilySearchText } from './tracked-calls';
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

  const prompt = `You are a market analyst producing a structured research report for a SURPRISE-ME journey. The system invented this idea from the founder's background — the founder did NOT come in with this idea. This means: the idea needs MORE justification than a founder-chosen idea, validation signals matter more, and kill criteria are essential.

Invented idea: ${idea}
${ctx.founderAngle ? `Founder positioning: ${ctx.founderAngle}` : ''}
Founder background summary: ${(ctx.enrichedFounderSummary ?? '').slice(0, 300)}
${regionLine}

Raw Tavily search results:
${rawResearch}

BEFORE WRITING, reason through these silently (do not include in output):
  1. DATA QUALITY: How many Tavily results contain concrete numbers (market size, revenue, pricing)? Rate internally: rich / moderate / thin.
  2. COMPETITOR COVERAGE: How many real, named competitors appear with enough detail?
  3. DEMAND EVIDENCE: Does the Tavily data contain signals that people actively want this — forum complaints, app store reviews, "I wish X existed" posts, search trends? This is critical for SURPRISE-ME since the founder didn't validate the idea themselves.
  4. FOUNDER FIT: Does the founder's background genuinely connect to this idea, or is it a stretch? Be honest in "why_this_fits_you".

Return a JSON object with this exact shape:
{
  "idea_overview": "<1-2 paragraphs: what the product does, who it's for, and how it specifically connects to this founder's background. Name the exact skill or experience that creates an edge — not generic 'your skills transfer'.>",
  "market_validation": {
    "size_and_growth": [
      { "stat": "<concrete market stat from Tavily>", "confidence": "high|medium|low" }
    ],
    "why_now": ["<timing signal from Tavily: tech shift, regulation change, market event, cultural trend>"],
    "demand_signals": [
      "<evidence people actively want this — quoted Reddit thread, app store complaint, forum post, search trend. If none found, put one entry: 'No direct demand signals in Tavily results — founder should validate before building.'>"
    ]
  },
  "competitors": [
    { "name": "<real competitor from Tavily>", "what_they_do": "<1 sentence>", "pricing": "<concrete pricing or 'not found — verify manually'>", "gap": "<1-line weakness relevant to the invented idea's positioning>" }
  ],
  "why_this_fits_you": "<1 paragraph. Speak as 'you'. Anchor in ${country ?? 'founder region (if known)'}. If fit is strong, say why specifically. If it's a stretch, say that too — do not pretend.>",
  "idea_refinements": [
    { "title": "<short refinement headline>", "rationale": "<1 sentence — how this specifically sharpens the invented idea toward the founder's strengths or a defensible wedge>" }
  ],
  "data_gaps": [
    "<what Tavily didn't cover, e.g. 'No pricing data for 2 of 4 competitors', 'No app store or social sentiment data'>"
  ],
  "first_priorities": [
    { "slot": "engineering", "title": "<12-word max — the first MVP slice to build. Action verb + specific deliverable.>", "rationale": "<1 sentence>" },
    { "slot": "research", "title": "<adapts to biggest gap: competitor scout OR demand validation OR channel analysis>", "rationale": "<1 sentence>" },
    { "slot": "validation", "title": "<'Validation outreach: Find N <role> in <space> to gauge interest' — this is SURPRISE-ME, the idea is unvalidated. Lightweight interest check, NOT sales.>", "rationale": "<1 sentence>" }
  ]
}

Rules — accuracy:
- size_and_growth: every entry confidence-tagged. [high]=directly from Tavily. [medium]=inferred. [low]=estimated, flag for manual verification. If zero verifiable stats, return []. Add to data_gaps.
- Competitor names must be real from Tavily data. Pricing from Tavily or "not found — verify manually". Never invent.
- demand_signals: use only evidence from Tavily. If none, the single honest entry flags that fact.
- why_this_fits_you: if the founder-idea connection is weak, say so honestly. A weak-but-flagged fit is more valuable than pretended strength.

Rules — shape:
- Up to 6 competitors, 3+ if identifiable. If fewer, add to data_gaps.
- Up to 3 idea_refinements. At least one must NARROW the scope. At least one must leverage the founder's SPECIFIC background.
- first_priorities: exactly 3 items in order: engineering, research, validation (NOT outreach — SURPRISE-ME is unvalidated; Task 3 gauges interest, doesn't sell).
- data_gaps: at least 1 entry.
- No source URLs or citations.
- Length: 900-1400 words when rendered. If data is thin, shorter.
- Tone: you're advising a founder who did NOT choose this idea. Present the bull AND bear case. Do not cheerlead.`;

  const result = await callSmallLLMJson<SurpriseMarketResearch>(prompt, {
    maxTokens: 2800,
    retryOnce: true,
    sanitizeFields: ['idea_overview', 'why_this_fits_you'],
    sanitizeArrayOfObjects: ['competitors', 'idea_refinements', 'first_priorities'],
  });

  // Normalize optional new fields
  result.market_validation.size_and_growth = result.market_validation.size_and_growth ?? [];
  result.market_validation.demand_signals = result.market_validation.demand_signals ?? [];
  result.data_gaps = result.data_gaps ?? [];

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
