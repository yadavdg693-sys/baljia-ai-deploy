// TEMP: pre-Phase-3a market research.
// Replaced by per-journey JSON schemas (Build/Grow/Surprise) in Phase 3a.
// Keeps pipeline functional during Phase 0 refactor.

import { createLogger } from '@/lib/logger';
import { tavilySearchText, isTavilyAvailable } from '@/lib/tavily';
import { callSmallLLM } from '../llm/small-llm';
import { emitActivity } from '../stage-runner';
import type { PipelineContext } from '../types';

const log = createLogger('OnboardingMarketResearch');

export async function generateMarketResearch(ctx: PipelineContext): Promise<void> {
  if (!isTavilyAvailable()) return;

  const base = ctx.input ?? ctx.strategy;
  const geo = ctx.founderEnrichment?.geo;
  const country = geo?.country ?? null;
  const city = geo?.city ?? null;

  const angleHint = ctx.founderAngle
    ? ctx.founderAngle.split('.')[0].slice(0, 100)
    : '';

  const competitorQuery = angleHint
    ? `${base} competitors pricing customers ${angleHint} 2024 2025`
    : `${base} market competitors pricing target customers 2024 2025`;

  const pricingQuery = `${base} pricing plans SaaS how much does it cost`;

  await emitActivity(ctx, `Searching web for competitors: "${competitorQuery.slice(0, 80)}"`, 'tavily_search');
  await emitActivity(ctx, `Searching web for pricing: "${pricingQuery.slice(0, 80)}"`, 'tavily_search');
  if (country) {
    await emitActivity(ctx, `Searching regional market trends for ${[city, country].filter(Boolean).join(', ')}`, 'tavily_search');
  }

  const searches = [
    tavilySearchText(competitorQuery, 5),
    tavilySearchText(pricingQuery, 3),
    country
      ? tavilySearchText(`fastest growing startups ${country}${city ? ' ' + city : ''} ${new Date().getFullYear()} funding market trends`, 3)
      : Promise.resolve(null),
  ];

  const [competitorRaw, pricingRaw, localRaw] = await Promise.all(searches);

  const rawParts = [competitorRaw, pricingRaw, localRaw].filter(Boolean);
  if (rawParts.length === 0) return;
  const rawResearch = rawParts.join('\n\n---\n\n').slice(0, 3000);

  const synthesisPrompt = `You are a market analyst. Synthesize these search results into a sharp competitive analysis for a new startup.

Startup idea: ${base}
${ctx.founderAngle ? `Founder positioning: ${ctx.founderAngle.slice(0, 200)}` : ''}
${country ? `Founder location: ${[city, country].filter(Boolean).join(', ')}` : ''}

Raw search results:
${rawResearch}

Write a structured analysis (be specific — name companies, cite prices, name trends):

## Competitors
Name the top 3-5 direct competitors. For each: what they do, their pricing, their weakness.

## Market Size & Trends
What's the market doing? Growth rate, funding trends, emerging segments.

## Pricing Intelligence
What do competitors charge? What pricing model works (freemium, per-seat, usage-based)?

## Opportunity Gap
What's missing? What do customers complain about? Where is this founder positioned to win?

${country ? `## Local Market Context\nWhat's happening in ${country} specifically? Local competitors, regulations, or opportunities.` : ''}

Be concise. No fluff. Every sentence should contain a specific fact, name, or number.`;

  await emitActivity(ctx, 'Synthesizing market research report...', 'llm');

  try {
    const analysis = await callSmallLLM(synthesisPrompt, 1200);
    ctx.marketResearch = analysis.trim() || null;
    if (ctx.marketResearch) {
      await emitActivity(ctx, `Report saved (${Math.round(ctx.marketResearch.length / 100) * 100} chars)`, 'document');
      log.info('Market research synthesized', { companyId: ctx.companyId, length: ctx.marketResearch.length });
    }
  } catch (err) {
    log.warn('Market research synthesis failed, using raw results', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    ctx.marketResearch = rawResearch.slice(0, 2000);
  }
}
