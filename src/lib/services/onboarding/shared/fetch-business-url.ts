// fetch_business_url — Grow My Company journey
// Fetches the founder's existing business URL with SSRF defense + DNS recovery.
// Extracts metadata + body, synthesizes a BusinessProfile via LLM.
// Falls back to Tavily site:url search if fetch fails.

import { createLogger } from '@/lib/logger';
import { isTavilyAvailable } from '@/lib/tavily';
import { trackedTavilySearch as tavilySearchText } from './tracked-calls';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import { appendMemorySection } from './memory-sections';
import type { PipelineContext, BusinessProfile } from '../types';

const log = createLogger('OnboardingFetchBusinessUrl');
const FETCH_TIMEOUT_MS = 10_000;

// SSRF defense — reject URLs pointing to internal/private ranges
export function isSafeUrl(rawUrl: string): { ok: boolean; normalized?: string; reason?: string } {
  let url: URL;
  try {
    const withProto = rawUrl.match(/^https?:\/\//) ? rawUrl : `https://${rawUrl}`;
    url = new URL(withProto);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Protocol not allowed' };
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('127.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.16.') ||
    hostname.startsWith('172.17.') ||
    hostname.startsWith('172.18.') ||
    hostname.startsWith('172.19.') ||
    hostname.startsWith('172.2') ||
    hostname.startsWith('172.30.') ||
    hostname.startsWith('172.31.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('169.254.') ||
    hostname.startsWith('::1') ||
    hostname.endsWith('.local')
  ) {
    return { ok: false, reason: 'Internal/private address not allowed' };
  }

  return { ok: true, normalized: url.toString() };
}

export function extractMetadata(html: string): { title: string | null; meta: string | null; body: string | null } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyText = bodyMatch
    ? bodyMatch[1]
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3000)
    : null;

  return {
    title: titleMatch?.[1]?.trim().slice(0, 200) ?? null,
    meta: (metaDescMatch?.[1] ?? ogDescMatch?.[1])?.trim().slice(0, 500) ?? null,
    body: bodyText,
  };
}

export async function fetchBusinessUrl(ctx: PipelineContext): Promise<void> {
  if (!ctx.input) {
    throw new Error('fetch_business_url requires ctx.input (business URL)');
  }

  const safe = isSafeUrl(ctx.input);
  if (!safe.ok || !safe.normalized) {
    throw new Error(`fetch_business_url: unsafe URL rejected — ${safe.reason}`);
  }

  await emitActivity(ctx, `Fetching ${safe.normalized}`, 'http_fetch');

  let metadata: ReturnType<typeof extractMetadata> = { title: null, meta: null, body: null };
  let fetchSucceeded = false;

  try {
    const res = await fetch(safe.normalized, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Baljia-Onboarding/1.0 (+https://baljia.ai)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (res.ok) {
      const html = await res.text();
      metadata = extractMetadata(html);
      fetchSucceeded = true;
      await emitActivity(ctx, `Fetched site — extracted title${metadata.title ? `: "${metadata.title}"` : ''}`, 'http_fetch');
    } else {
      log.warn('fetch_business_url: non-OK response', { status: res.status, url: safe.normalized });
    }
  } catch (err) {
    log.warn('fetch_business_url: fetch failed, falling back to Tavily', {
      url: safe.normalized,
      error: err instanceof Error ? err.message : String(err),
    });
    await emitActivity(ctx, `Fetch failed, falling back to web search`, 'http_fetch');
  }

  // Fallback: Tavily site: search
  if (!fetchSucceeded && isTavilyAvailable()) {
    const hostname = new URL(safe.normalized).hostname;
    const tavilyResult = await tavilySearchText(`site:${hostname} OR "${hostname}" business overview products services`, 5, 'advanced');
    if (tavilyResult) {
      metadata.body = tavilyResult.slice(0, 3000);
      metadata.title = metadata.title ?? hostname;
    }
  }

  if (!metadata.body && !metadata.meta && !metadata.title) {
    throw new Error('fetch_business_url: no metadata or body recovered — site unreachable and Tavily returned nothing');
  }

  // Synthesize BusinessProfile via LLM
  await emitActivity(ctx, 'Synthesizing business profile from site content', 'llm');

  const synthesisPrompt = `You are extracting a business profile from the content of ${safe.normalized}.

Page title: ${metadata.title ?? '(none)'}
Meta description: ${metadata.meta ?? '(none)'}
Page content (first 3000 chars):
${metadata.body ?? '(none)'}

Extract a structured business profile. Be specific — use the actual names, prices, audience terms from the page. Do NOT invent details the content doesn't support.

Return a JSON object with these exact keys:
{
  "business_name": "<the actual business name from the site>",
  "description": "<one sentence: what this business does, for whom>",
  "revenue_model": "<how they make money — subscription, per-seat, marketplace fee, ads, etc., or 'unclear' if not evident>",
  "target_customer": "<who their customer is — specific role/industry/situation, or 'unclear' if not evident>",
  "existing_validation": "<any validation signals: testimonials, customer logos, case studies, funding, press — or null if none visible>"
}`;

  const profile = await callSmallLLMJson<Omit<BusinessProfile, 'extracted_metadata'>>(
    synthesisPrompt,
    { maxTokens: 500, retryOnce: true },
  );

  ctx.businessProfile = {
    business_name: profile.business_name?.trim().slice(0, 100) ?? ctx.input,
    description: profile.description?.trim().slice(0, 500) ?? '',
    revenue_model: profile.revenue_model?.trim().slice(0, 200) ?? null,
    target_customer: profile.target_customer?.trim().slice(0, 300) ?? null,
    existing_validation: profile.existing_validation?.trim().slice(0, 500) ?? null,
    extracted_metadata: {
      title: metadata.title,
      meta: metadata.meta,
      body: metadata.body,
    },
  };

  // Strategy label for downstream stages that still read ctx.strategy
  ctx.strategy = `${ctx.businessProfile.business_name} | ${ctx.businessProfile.description.slice(0, 80)}`;
  ctx.enrichedBusinessSummary = [
    `Business: ${ctx.businessProfile.business_name}`,
    `Description: ${ctx.businessProfile.description}`,
    ctx.businessProfile.revenue_model && `Revenue model: ${ctx.businessProfile.revenue_model}`,
    ctx.businessProfile.target_customer && `Target customer: ${ctx.businessProfile.target_customer}`,
    ctx.businessProfile.existing_validation && `Validation: ${ctx.businessProfile.existing_validation}`,
  ].filter(Boolean).join('\n');

  await emitActivity(ctx, `Profile: ${ctx.businessProfile.description.slice(0, 100)}`, 'llm');

  await appendMemorySection(ctx.companyId, '## Business Profile', [
    `Name: ${ctx.businessProfile.business_name}`,
    `Description: ${ctx.businessProfile.description}`,
    `Revenue model: ${ctx.businessProfile.revenue_model ?? 'unclear'}`,
    `Target customer: ${ctx.businessProfile.target_customer ?? 'unclear'}`,
    `Validation: ${ctx.businessProfile.existing_validation ?? 'none visible'}`,
  ]);
}
