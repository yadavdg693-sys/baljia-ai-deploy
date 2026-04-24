// refine_idea — Build My Idea journey
// Order of operations (per user directive): ALWAYS scout the web FIRST so the
// LLM understands what's already in the space, THEN refine. This prevents the
// pivot-drift bug where refine guessed "lead magnet creator" when the founder
// pointed at rocketwriter.ai (a book generator) — the LLM had no idea what
// was in that space.
//
//   1. Detect any URL in the founder input (http(s):// or bare domain.tld)
//   2. In parallel: fetch that URL + Tavily-scout the raw input
//   3. Pass raw input + URL reference + scout results into the LLM
//   4. LLM refines with full context — narrow to a vertical slice of what
//      the founder pointed at, or a differentiated variant. No blind guess.
//
// Soft failures: if Tavily is unavailable or URL fetch breaks, refine still
// runs on text alone — it just reverts to the old "LLM guesses" behavior.
// See memory/project_idea_processing_active_transform.md

import { getCapabilityConstraint } from '@/lib/platform-capabilities';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import { appendMemorySection } from './memory-sections';
import { isSafeUrl, extractMetadata } from './fetch-business-url';
import { isTavilyAvailable } from '@/lib/tavily';
import { trackedTavilySearch } from './tracked-calls';
import { createLogger } from '@/lib/logger';
import type { PipelineContext, RefinedIdea } from '../types';

const log = createLogger('OnboardingRefineIdea');
const URL_FETCH_TIMEOUT_MS = 10_000;

// Match a URL anywhere in the input. Accepts explicit http(s):// OR bare
// domain.tld. Conservative so random dotted strings (e.g. "v1.2.3") don't match.
const URL_REGEX = /\b(?:(?:https?:\/\/)|(?=[a-z0-9-]+\.[a-z]{2,}))((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/i;

function detectUrl(input: string): string | null {
  const m = input.match(URL_REGEX);
  if (!m) return null;
  return m[0].trim().replace(/[.,;:!?)]+$/, '');
}

async function fetchUrlContext(rawUrl: string): Promise<{ title: string | null; meta: string | null; body: string | null; normalized: string } | null> {
  const safe = isSafeUrl(rawUrl);
  if (!safe.ok || !safe.normalized) {
    log.warn('refine_idea: URL rejected by SSRF check', { rawUrl, reason: safe.reason });
    return null;
  }
  try {
    const res = await fetch(safe.normalized, {
      signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Baljia-Onboarding/1.0 (+https://baljia.ai)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      log.warn('refine_idea: URL fetch non-OK', { url: safe.normalized, status: res.status });
      return null;
    }
    const html = await res.text();
    const md = extractMetadata(html);
    return { ...md, normalized: safe.normalized };
  } catch (err) {
    log.warn('refine_idea: URL fetch failed', {
      url: safe.normalized,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function scoutSpace(rawInput: string): Promise<string | null> {
  if (!isTavilyAvailable()) return null;
  try {
    // Broad scout: what products/tools already exist adjacent to this input?
    // One query is enough — deeper market research runs later with competitor/
    // pricing/review angles. This is only for idea alignment.
    const raw = await trackedTavilySearch(
      `${rawInput.slice(0, 200)} existing products tools alternatives`,
      6,
      'advanced',
    );
    if (!raw) return null;
    return raw.slice(0, 2500);
  } catch (err) {
    log.warn('refine_idea: Tavily scout failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function refineIdea(ctx: PipelineContext): Promise<void> {
  if (!ctx.input) {
    throw new Error('refine_idea requires ctx.input (founder idea text)');
  }

  const geo = ctx.founderEnrichment?.geo;
  const locationLine = geo?.country
    ? `Founder location: ${[geo.city, geo.country].filter(Boolean).join(', ')} — shape refinements to local market dynamics where relevant.`
    : '';

  // ─── Step 1: detect URL in the input ─────────────────────────────
  const detectedUrl = detectUrl(ctx.input);
  if (detectedUrl) {
    await emitActivity(ctx, `Detected reference URL: ${detectedUrl}`, 'http_fetch');
  }
  await emitActivity(ctx, `Scouting the web for: "${ctx.input.slice(0, 80)}"`, 'tavily_search');

  // ─── Step 2: fetch URL + scout in parallel ───────────────────────
  const [urlRef, scoutRaw] = await Promise.all([
    detectedUrl ? fetchUrlContext(detectedUrl) : Promise.resolve(null),
    scoutSpace(ctx.input),
  ]);

  // Emit follow-up activity lines so the founder sees what came back.
  if (detectedUrl) {
    if (urlRef) {
      await emitActivity(
        ctx,
        `Fetched reference site${urlRef.title ? ` — "${urlRef.title}"` : ''}`,
        'http_fetch',
      );
    } else {
      await emitActivity(ctx, `Could not fetch ${detectedUrl} — continuing with scout + text`, 'http_fetch');
    }
  }
  if (scoutRaw) {
    // Count distinct result URLs roughly — Tavily concatenates with newlines
    const resultCount = (scoutRaw.match(/\n/g) ?? []).length;
    await emitActivity(ctx, `Scout returned ${resultCount}+ related products in this space`, 'tavily_search');
  } else if (isTavilyAvailable()) {
    await emitActivity(ctx, 'Scout returned nothing — refining from founder input only', 'tavily_search');
  }

  // ─── Step 3: assemble context blocks ─────────────────────────────
  let urlContextBlock = '';
  if (urlRef) {
    const refParts: string[] = [
      `Reference site the founder pointed at: ${urlRef.normalized}`,
      urlRef.title ? `Page title: ${urlRef.title}` : null,
      urlRef.meta ? `Meta description: ${urlRef.meta}` : null,
      urlRef.body ? `Page content (first 1500 chars): ${urlRef.body.slice(0, 1500)}` : null,
    ].filter(Boolean) as string[];
    urlContextBlock = `\n\n═══ REFERENCE URL (what the founder is pointing at) ═══\n${refParts.join('\n')}`;
  }

  let scoutContextBlock = '';
  if (scoutRaw) {
    scoutContextBlock = `\n\n═══ EXISTING PRODUCTS IN THIS SPACE (web scout) ═══\n${scoutRaw}`;
  }

  // ─── Step 4: LLM refine with full context ────────────────────────
  const prompt = `You are Baljia, an AI cofounder. The founder submitted this raw idea: "${ctx.input}"

Your job is to REFINE it into a buildable scope. This is an active transform:
- Keep the refined idea ALIGNED with the founder's actual intent. If they pointed at a specific product (via URL or name), stay in THAT product's space.
- If the idea is too ambitious for a 3-hour MVP, narrow to a VERTICAL SLICE of what the founder asked for — a single feature of the reference product, not a different product category. The refined idea must stay in the same category as the founder's input. Never swap to an adjacent category just because it's smaller.
- If the scout reveals the space is saturated, pick a differentiated angle (niche audience, specific use case, underserved geography). Still the same category.
- If the idea is vague, pick the sharpest version the platform can build — prefer specificity over generality.
- If the idea conflicts with platform limits, substitute with the closest buildable equivalent.
- Never say "this can't be built" — find what WOULD work.

${getCapabilityConstraint()}

${locationLine}${urlContextBlock}${scoutContextBlock}

═══ OUTPUT ═══
Return a JSON object with these exact keys:
{
  "refined_idea": "<one sentence: what the refined product does and for whom, specific enough to build. MUST be in the same category the founder implied.>",
  "changes_made": "<one sentence: what was narrowed/sharpened from the raw input. If the founder's input was already buildable, say 'kept intent intact, tightened scope to MVP'.>",
  "rationale": "<one sentence: why this refined version is the highest-leverage buildable version — reference the scout/URL context if it informed the decision.>"
}`;

  const result = await callSmallLLMJson<RefinedIdea>(prompt, {
    maxTokens: 500,
    retryOnce: true,
    sanitizeFields: ['refined_idea', 'changes_made', 'rationale'],
  });

  if (!result.refined_idea?.trim()) {
    throw new Error('refine_idea: LLM returned empty refined_idea');
  }

  ctx.refinedIdea = {
    refined_idea: result.refined_idea.trim().slice(0, 300),
    changes_made: (result.changes_made ?? '').trim().slice(0, 200),
    rationale: (result.rationale ?? '').trim().slice(0, 200),
  };

  // Strategy label for downstream stages (mission, market-research, tasks) that read ctx.strategy
  ctx.strategy = ctx.refinedIdea.refined_idea;

  await emitActivity(ctx, `Refined: "${ctx.refinedIdea.refined_idea.slice(0, 100)}"`, 'llm');
  if (ctx.refinedIdea.changes_made) {
    await emitActivity(ctx, `Changes: ${ctx.refinedIdea.changes_made.slice(0, 120)}`, 'llm');
  }

  const memoryLines: string[] = [
    `Original input: ${ctx.input.slice(0, 200)}`,
    `Refined: ${ctx.refinedIdea.refined_idea}`,
    `Changes: ${ctx.refinedIdea.changes_made}`,
    `Rationale: ${ctx.refinedIdea.rationale}`,
  ];
  if (detectedUrl) {
    memoryLines.push(`Reference URL: ${detectedUrl}${urlRef?.title ? ` ("${urlRef.title}")` : ''}`);
  }
  if (scoutRaw) {
    memoryLines.push(`Web scout: ran a broad search before refining (found adjacent products in this space).`);
  }
  await appendMemorySection(ctx.companyId, '## Idea (Refined)', memoryLines);
}
