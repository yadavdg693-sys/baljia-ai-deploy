// fetch_business_url - Grow My Company journey.
// Reads the founder's existing business URL, extracts a business profile, and
// falls back to safe defaults when fetch/search/LLM profiling is unavailable.

import { createLogger } from '@/lib/logger';
import { isTavilyAvailable } from '@/lib/tavily';
import { trackedTavilySearch as tavilySearchText } from './tracked-calls';
import { callSmallLLMJson } from './json-mode';
import { BusinessProfilePromptSchema } from './schemas';
import { saveOnboardingBrief } from './onboarding-brief';
import { emitActivity, recordOnboardingIssue } from '../stage-runner';
import { appendMemorySection } from './memory-sections';
import type { PipelineContext, BusinessProfile } from '../types';

const log = createLogger('OnboardingFetchBusinessUrl');
const FETCH_TIMEOUT_MS = 10_000;

// SSRF defense - reject URLs pointing to internal/private ranges.
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

function hostnameFromRaw(rawUrl: string | undefined): string | null {
  if (!rawUrl?.trim()) return null;
  try {
    const withProto = rawUrl.match(/^https?:\/\//) ? rawUrl : `https://${rawUrl}`;
    return new URL(withProto).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function nameFromHost(hostname: string | null): string {
  if (!hostname) return 'Existing Business';
  const base = hostname.split('.')[0] || hostname;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .slice(0, 100) || 'Existing Business';
}

function fallbackBusinessProfile(
  ctx: PipelineContext,
  metadata: ReturnType<typeof extractMetadata>,
): BusinessProfile {
  const hostname = hostnameFromRaw(ctx.input);
  const businessName = ctx.companyName && ctx.companyName !== 'My Company'
    ? ctx.companyName
    : nameFromHost(hostname);
  const description = metadata.meta
    || metadata.body?.slice(0, 300)
    || `An existing business submitted by the founder${hostname ? ` at ${hostname}` : ''}.`;

  return {
    business_name: businessName,
    description,
    revenue_model: 'unclear',
    target_customer: 'unclear',
    existing_validation: null,
    business_type: 'existing business',
    services_or_products: [],
    location_or_market: null,
    visible_offer: null,
    main_cta: null,
    proof_signals: [],
    extracted_metadata: metadata,
  };
}

async function finishBusinessProfile(ctx: PipelineContext): Promise<void> {
  if (!ctx.businessProfile) return;

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
  await saveOnboardingBrief(ctx);
}

export async function fetchBusinessUrl(ctx: PipelineContext): Promise<void> {
  let normalizedUrl = ctx.input?.trim() || 'submitted business';
  let shouldFetch = true;
  let metadata: ReturnType<typeof extractMetadata> = { title: null, meta: null, body: null };
  let fetchSucceeded = false;

  if (!ctx.input?.trim()) {
    shouldFetch = false;
    await recordOnboardingIssue(ctx, {
      stage: 'fetch_business_url',
      kind: 'missing_business_url_fallback',
      severity: 'high',
      message: 'Grow onboarding did not receive a business URL, so it used a fallback business profile.',
      fallbackUsed: true,
    });
  } else {
    const safe = isSafeUrl(ctx.input);
    if (!safe.ok || !safe.normalized) {
      shouldFetch = false;
      await recordOnboardingIssue(ctx, {
        stage: 'fetch_business_url',
        kind: 'unsafe_business_url_fallback',
        severity: 'high',
        error: safe.reason,
        message: 'Grow onboarding rejected an unsafe or invalid business URL and continued with a fallback business profile.',
        fallbackUsed: true,
      });
    } else {
      normalizedUrl = safe.normalized;
    }
  }

  if (shouldFetch) {
    await emitActivity(ctx, `Fetching ${normalizedUrl}`, 'http_fetch');

    try {
      const res = await fetch(normalizedUrl, {
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
        await emitActivity(ctx, `Fetched site - extracted title${metadata.title ? `: "${metadata.title}"` : ''}`, 'http_fetch');
      } else {
        log.warn('fetch_business_url: non-OK response', { status: res.status, url: normalizedUrl });
      }
    } catch (err) {
      log.warn('fetch_business_url: fetch failed, falling back to Tavily', {
        url: normalizedUrl,
        error: err instanceof Error ? err.message : String(err),
      });
      await emitActivity(ctx, 'Fetch failed, falling back to web search', 'http_fetch');
    }
  }

  if (shouldFetch && !fetchSucceeded && isTavilyAvailable()) {
    try {
      const hostname = new URL(normalizedUrl).hostname;
      const tavilyResult = await tavilySearchText(`site:${hostname} OR "${hostname}" business overview products services`, 5, 'advanced');
      if (tavilyResult) {
        metadata.body = tavilyResult.slice(0, 3000);
        metadata.title = metadata.title ?? hostname;
      }
    } catch (err) {
      await recordOnboardingIssue(ctx, {
        stage: 'fetch_business_url',
        kind: 'business_url_search_fallback_failed',
        severity: 'medium',
        error: err instanceof Error ? err.message : String(err),
        message: 'Business URL web-search fallback failed, so onboarding continued with limited website context.',
        fallbackUsed: true,
      });
    }
  }

  if (!metadata.body && !metadata.meta && !metadata.title) {
    const hostname = hostnameFromRaw(ctx.input);
    metadata = {
      title: hostname ?? ctx.input ?? 'Existing Business',
      meta: null,
      body: `No reliable website content was recovered for ${ctx.input ?? 'the submitted business'}.`,
    };
    await recordOnboardingIssue(ctx, {
      stage: 'fetch_business_url',
      kind: 'business_profile_metadata_fallback',
      severity: 'medium',
      message: 'No website metadata or search context was recovered, so onboarding used a fallback business profile.',
      fallbackUsed: true,
      metadata: { submitted_url: ctx.input ?? null },
    });
  }

  await emitActivity(ctx, 'Synthesizing business profile from site content', 'llm');

  const synthesisPrompt = `You are extracting a business profile from the content of ${normalizedUrl}.

Page title: ${metadata.title ?? '(none)'}
Meta description: ${metadata.meta ?? '(none)'}
Page content (first 3000 chars):
${metadata.body ?? '(none)'}

Extract a structured business profile. Be specific: use the actual names, prices, audience terms from the page. Do not invent details the content does not support.

Return one JSON object with exactly these fields:
- business_name: string. The actual business name from the site.
- description: string. One sentence describing what this business does and for whom.
- revenue_model: string or null. How they make money when evident; use "unclear" if the page does not show it.
- target_customer: string or null. Specific role, industry, or customer situation when evident; use "unclear" if the page does not show it.
- existing_validation: string or null. Visible validation such as testimonials, customer logos, case studies, funding, press, years in business, certifications, or reviews.
- business_type: string or null. Classify from the page, such as service business, software product, ecommerce, agency, consultancy, marketplace, or local business.
- services_or_products: array of strings. Actual services, products, packages, or offers from the site.
- location_or_market: string or null. Visible city, region, or market served.
- visible_offer: string or null. Specific offer, package, or value prop visible on the site.
- main_cta: string or null. Main call to action visible on the site.
- proof_signals: array of strings. Visible proof such as client logos, years, case studies, reviews, certifications, press, or awards.`;

  let profile: Omit<BusinessProfile, 'extracted_metadata'>;
  try {
    profile = await callSmallLLMJson<Omit<BusinessProfile, 'extracted_metadata'>>(
      synthesisPrompt,
      { maxTokens: 800, retryOnce: true, schema: BusinessProfilePromptSchema },
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await recordOnboardingIssue(ctx, {
      stage: 'fetch_business_url',
      kind: 'business_profile_llm_fallback',
      severity: 'high',
      error,
      message: 'Business profile synthesis failed, so onboarding used a deterministic profile from the submitted URL and metadata.',
      fallbackUsed: true,
    });

    const fallback = fallbackBusinessProfile(ctx, metadata);
    profile = {
      business_name: fallback.business_name,
      description: fallback.description,
      revenue_model: fallback.revenue_model,
      target_customer: fallback.target_customer,
      existing_validation: fallback.existing_validation,
      business_type: fallback.business_type,
      services_or_products: fallback.services_or_products,
      location_or_market: fallback.location_or_market,
      visible_offer: fallback.visible_offer,
      main_cta: fallback.main_cta,
      proof_signals: fallback.proof_signals,
    };
  }

  ctx.businessProfile = {
    business_name: profile.business_name?.trim().slice(0, 100) ?? nameFromHost(hostnameFromRaw(ctx.input)),
    description: profile.description?.trim().slice(0, 500) ?? fallbackBusinessProfile(ctx, metadata).description,
    revenue_model: profile.revenue_model?.trim().slice(0, 200) ?? null,
    target_customer: profile.target_customer?.trim().slice(0, 300) ?? null,
    existing_validation: profile.existing_validation?.trim().slice(0, 500) ?? null,
    business_type: profile.business_type?.trim().slice(0, 120) ?? null,
    services_or_products: Array.isArray(profile.services_or_products)
      ? profile.services_or_products.map((s) => s.trim()).filter(Boolean).slice(0, 8)
      : [],
    location_or_market: profile.location_or_market?.trim().slice(0, 160) ?? null,
    visible_offer: profile.visible_offer?.trim().slice(0, 240) ?? null,
    main_cta: profile.main_cta?.trim().slice(0, 120) ?? null,
    proof_signals: Array.isArray(profile.proof_signals)
      ? profile.proof_signals.map((s) => s.trim()).filter(Boolean).slice(0, 8)
      : [],
    extracted_metadata: {
      title: metadata.title,
      meta: metadata.meta,
      body: metadata.body,
    },
  };

  await finishBusinessProfile(ctx);
}
