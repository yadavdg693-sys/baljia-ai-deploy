// Gap-filling Tavily pass for market research.
//
// Flow:
//  1. First-pass research → LLM produces report + gap_filling_queries[]
//  2. If queries non-empty, run them in parallel (cap 4) → additional raw research
//  3. Caller combines original raw + additional raw and re-synthesizes
//
// Cost per onboarding: +$0.02 Tavily + ~$0.03 LLM = +$0.05.
// Time per onboarding: +20-30s (mostly the 2nd LLM synthesis).
//
// Graceful degradation: if 2nd pass also fails to fill gaps, callers should
// set research_quality_warning + (for BUILD) proceed_or_pause = 'validate_first'.
// We do NOT loop further or fabricate — see docs/IMPROVEMENT_PROPOSALS.md.

import { trackedTavilySearch as tavilySearchText } from './tracked-calls';
import { emitActivity } from '../stage-runner';
import type { PipelineContext, GapFillingQuery } from '../types';

const MAX_GAP_QUERIES = 4;
const MAX_ADDITIONAL_RAW = 4000;

/**
 * Run gap-filling Tavily searches in parallel and return combined raw text.
 * Returns empty string if no queries provided or all searches return empty.
 */
export async function runGapFillingTavily(
  ctx: PipelineContext,
  queries: GapFillingQuery[] | undefined,
): Promise<string> {
  if (!queries || queries.length === 0) return '';

  const top = queries.slice(0, MAX_GAP_QUERIES);

  // Activity log so the founder sees what we're filling
  await emitActivity(
    ctx,
    `Gap-filling: ${top.length} targeted searches — ${top.map((q) => q.fills).join('; ')}`,
    'tavily_search',
  );

  const results = await Promise.all(
    top.map((q) => tavilySearchText(q.query, 4).catch(() => '')),
  );

  const combined = results.filter(Boolean).join('\n\n---\n\n').slice(0, MAX_ADDITIONAL_RAW);
  return combined;
}

/**
 * Combine first-pass raw research with gap-filling raw research.
 * Caps total length so the LLM context stays bounded.
 */
export function combineRawResearch(firstPassRaw: string, gapFillRaw: string, maxChars = 7000): string {
  if (!gapFillRaw) return firstPassRaw;
  const combined = `${firstPassRaw}\n\n=== ADDITIONAL TARGETED RESEARCH (gap-filling pass) ===\n\n${gapFillRaw}`;
  return combined.slice(0, maxChars);
}

/**
 * After 2nd pass, decide if data is still too thin and we should warn the founder.
 * Heuristic: if data_gaps still has 3+ entries after gap-filling, the public web
 * is genuinely thin for this niche — surface a warning rather than pretending the
 * report is complete.
 */
export function isResearchQualityThin(dataGaps: string[] | undefined): boolean {
  return Array.isArray(dataGaps) && dataGaps.length >= 3;
}

export const RESEARCH_QUALITY_WARNING_TEXT =
  'Public web sources are thin for this category — recommend primary research (user interviews, manual competitor scan) before committing build resources.';
