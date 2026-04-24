// refine_idea — Build My Idea journey
// Active transform: takes founder's raw idea text and converts it into a
// buildable scope using platform capabilities. Never soft-fails.
// See memory/project_idea_processing_active_transform.md
//
// URL auto-detection: if the founder's input contains a URL (explicit http(s)://
// or a bare domain), we fetch it and feed title/meta/body into the refine prompt
// as "Reference site" context. Fetch errors are soft — the refine still runs on
// the text alone. We do NOT treat it as a Grow journey (that's fetch-business-url).

import { getCapabilityConstraint } from '@/lib/platform-capabilities';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import { appendMemorySection } from './memory-sections';
import { isSafeUrl, extractMetadata } from './fetch-business-url';
import { createLogger } from '@/lib/logger';
import type { PipelineContext, RefinedIdea } from '../types';

const log = createLogger('OnboardingRefineIdea');
const URL_FETCH_TIMEOUT_MS = 10_000;

// Match a URL anywhere in the input. Accepts explicit http(s):// OR bare
// domain.tld. First match wins. Keeps the regex conservative so random
// dotted strings (e.g. "v1.2.3") don't trigger a fetch.
const URL_REGEX = /\b(?:(?:https?:\/\/)|(?=[a-z0-9-]+\.[a-z]{2,}))((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/i;

function detectUrl(input: string): string | null {
  const m = input.match(URL_REGEX);
  if (!m) return null;
  // m[0] includes the scheme if present; the full match is what we want
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

export async function refineIdea(ctx: PipelineContext): Promise<void> {
  if (!ctx.input) {
    throw new Error('refine_idea requires ctx.input (founder idea text)');
  }

  const geo = ctx.founderEnrichment?.geo;
  const locationLine = geo?.country
    ? `Founder location: ${[geo.city, geo.country].filter(Boolean).join(', ')} — shape refinements to local market dynamics where relevant.`
    : '';

  // Optional URL enrichment — soft-fails if fetch or parse breaks
  const detectedUrl = detectUrl(ctx.input);
  let urlContextBlock = '';
  if (detectedUrl) {
    await emitActivity(ctx, `Detected reference URL: ${detectedUrl}`, 'http_fetch');
    const ref = await fetchUrlContext(detectedUrl);
    if (ref) {
      await emitActivity(
        ctx,
        `Fetched reference site${ref.title ? ` — "${ref.title}"` : ''}`,
        'http_fetch',
      );
      const refParts: string[] = [
        `Reference site mentioned by founder: ${ref.normalized}`,
        ref.title ? `Page title: ${ref.title}` : null,
        ref.meta ? `Meta description: ${ref.meta}` : null,
        ref.body ? `Page content (first 1500 chars): ${ref.body.slice(0, 1500)}` : null,
      ].filter(Boolean) as string[];
      urlContextBlock = `\n\n${refParts.join('\n')}\n\nUse this reference to understand what the founder is pointing at (competitor, inspiration, or similar product). Refine the idea as a DISTINCT buildable product — do not clone the reference.`;
    } else {
      await emitActivity(ctx, `Could not fetch ${detectedUrl} — refining from text only`, 'http_fetch');
    }
  }

  const prompt = `You are Baljia, an AI cofounder. The founder submitted this raw idea: "${ctx.input}"

Your job is to REFINE it into a buildable scope. This is an active transform, not a validation:
- If the idea is vague, make it specific. Pick the sharpest version the platform can build.
- If the idea is too ambitious, narrow it to a concrete MVP that ships in 3 hours.
- If the idea conflicts with platform limits, substitute with the closest thing we CAN build.
- Never say "this can't be built" — find what WOULD work and transform toward that.

${getCapabilityConstraint()}

${locationLine}${urlContextBlock}

Return a JSON object with these exact keys:
{
  "refined_idea": "<one sentence: what the refined product does and for whom, specific enough to build>",
  "changes_made": "<one sentence: what was transformed from the raw input to get here>",
  "rationale": "<one sentence: why this refined version is the highest-leverage buildable version>"
}`;

  const result = await callSmallLLMJson<RefinedIdea>(prompt, { maxTokens: 400, retryOnce: true });

  if (!result.refined_idea?.trim()) {
    throw new Error('refine_idea: LLM returned empty refined_idea');
  }

  ctx.refinedIdea = {
    refined_idea: result.refined_idea.trim().slice(0, 300),
    changes_made: (result.changes_made ?? '').trim().slice(0, 200),
    rationale: (result.rationale ?? '').trim().slice(0, 200),
  };

  // Strategy label for downstream stages (mission, tasks) that still read ctx.strategy
  ctx.strategy = ctx.refinedIdea.refined_idea;

  await emitActivity(
    ctx,
    `Refined: "${ctx.refinedIdea.refined_idea.slice(0, 100)}"`,
    'llm',
  );
  if (ctx.refinedIdea.changes_made) {
    await emitActivity(ctx, `Changes: ${ctx.refinedIdea.changes_made.slice(0, 120)}`, 'llm');
  }

  const memoryLines: string[] = [
    `Refined: ${ctx.refinedIdea.refined_idea}`,
    `Changes: ${ctx.refinedIdea.changes_made}`,
    `Rationale: ${ctx.refinedIdea.rationale}`,
  ];
  if (detectedUrl) {
    memoryLines.push(`Reference URL from founder input: ${detectedUrl}`);
  }
  await appendMemorySection(ctx.companyId, '## Idea (Refined)', memoryLines);
}
