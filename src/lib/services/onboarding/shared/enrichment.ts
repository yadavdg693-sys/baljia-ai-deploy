// Founder enrichment helpers — GeoIP, LinkedIn, Twitter, founder angle
// Scope is controlled by strategy header (leanHeader vs fullHeader)

import { db, users } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { isTavilyAvailable } from '@/lib/tavily';
import { trackedTavilySearch as tavilySearchText } from './tracked-calls';
import { createLogger } from '@/lib/logger';
import { callSmallLLM } from '../llm/small-llm';
import { appendMemorySection } from './memory-sections';
import type { PipelineContext, FounderGeoData } from '../types';

const log = createLogger('OnboardingEnrich');

export async function loadFounderIdentity(ctx: PipelineContext): Promise<void> {
  const [user] = await db.select({ email: users.email, name: users.name })
    .from(users).where(eq(users.id, ctx.userId)).limit(1);
  if (!user) return;
  ctx.founderEmail = user.email ?? '';
  ctx.founderName = user.name ?? null;
}

export async function enrichGeoIP(ip: string | null): Promise<FounderGeoData | null> {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;

  const ipinfoToken = process.env.IPINFO_TOKEN;
  const ipstackKey = process.env.IPSTACK_API_KEY;

  if (!ipinfoToken && !ipstackKey) {
    log.warn('No GeoIP key configured — location enrichment skipped');
    return null;
  }

  try {
    // Primary: ipinfo (50K/mo free, HTTPS)
    if (ipinfoToken) {
      const res = await fetch(`https://ipinfo.io/${ip}?token=${ipinfoToken}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as {
          city?: string; region?: string; country?: string; timezone?: string;
        };
        if (data.country) {
          log.info('GeoIP enriched via ipinfo', { country: data.country, city: data.city });
          return {
            country: data.country ?? null,
            region: data.region ?? null,
            city: data.city ?? null,
            timezone: data.timezone ?? null,
          };
        }
      }
    }

    // Fallback: ipstack (100/mo free, HTTP-only)
    if (ipstackKey) {
      const res = await fetch(
        `http://api.ipstack.com/${ip}?access_key=${ipstackKey}&fields=country_name,region_name,city,time_zone`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) {
        const data = await res.json() as {
          country_name?: string; region_name?: string; city?: string;
          time_zone?: { id?: string };
          success?: boolean; error?: { info?: string };
        };
        if (data.success === false) {
          log.warn('ipstack API error (fallback)', { error: data.error?.info });
        } else if (data.country_name) {
          log.info('GeoIP enriched via ipstack (fallback)', { country: data.country_name, city: data.city });
          return {
            country: data.country_name ?? null,
            region: data.region_name ?? null,
            city: data.city ?? null,
            timezone: data.time_zone?.id ?? null,
          };
        }
      }
    }

    return null;
  } catch (err) {
    log.warn('GeoIP enrichment failed', { ip, error: err instanceof Error ? err.message : 'timeout' });
    return null;
  }
}

export async function enrichLinkedIn(founderName: string): Promise<string | null> {
  if (!isTavilyAvailable()) return null;
  try {
    const [linkedinResult, professionalResult] = await Promise.all([
      tavilySearchText(`site:linkedin.com/in "${founderName}"`, 3, 'advanced'),
      tavilySearchText(`"${founderName}" founder CEO startup experience background`, 3, 'advanced'),
    ]);

    const raw = [linkedinResult, professionalResult].filter(Boolean).join('\n\n');
    if (!raw || raw.length < 50) return null;

    const profile = await callSmallLLM(
      `Extract a structured founder profile from these search results. Be specific — name companies, roles, years, industries, skills. If the data is too thin or clearly about a different person, respond with just "INSUFFICIENT".

Search results for "${founderName}":
${raw.slice(0, 1500)}

Format (fill in what you find, skip what you can't):
ROLE: [current/most recent role and company]
EXPERIENCE: [key career highlights, industries, years of experience]
SKILLS: [technical or domain expertise]
EDUCATION: [if found]
NOTABLE: [anything distinctive — awards, publications, large exits, open source]`,
      300,
    );

    if (!profile || /insufficient/i.test(profile)) return null;
    log.info('LinkedIn enrichment synthesized', { founder: founderName, length: profile.length });
    return profile.trim().slice(0, 1000);
  } catch (err) {
    log.warn('LinkedIn enrichment failed', { founder: founderName, error: err instanceof Error ? err.message : 'unknown' });
    return null;
  }
}

export async function enrichTwitter(founderName: string): Promise<string | null> {
  if (!isTavilyAvailable()) return null;
  try {
    const result = await tavilySearchText(
      `site:twitter.com "${founderName}" OR site:x.com "${founderName}" bio building founder`,
      3,
      'advanced',
    );
    if (!result || result.length < 30) return null;

    const bio = await callSmallLLM(
      `From these Twitter/X search results, extract what this person publicly cares about, builds, and advocates for. If the results are clearly not about the right person or too thin, respond with just "INSUFFICIENT".

Results for "${founderName}":
${result.slice(0, 800)}

Reply in 2-3 sentences: what they build/work on, what topics they tweet about, what community they're part of. Be specific.`,
      150,
    );

    if (!bio || /insufficient/i.test(bio)) return null;
    log.info('Twitter enrichment synthesized', { founder: founderName });
    return bio.trim().slice(0, 500);
  } catch (err) {
    log.warn('Twitter enrichment failed', { founder: founderName, error: err instanceof Error ? err.message : 'unknown' });
    return null;
  }
}

// Assesses enrichment signal and composes ctx.founderEnrichment + summary
export function composeFounderEnrichment(
  ctx: PipelineContext,
  geo: FounderGeoData | null,
  linkedinSummary: string | null,
  twitterBio: string | null,
): void {
  const hasLinkedIn = !!linkedinSummary;
  const hasTwitter = !!twitterBio;
  const hasGeo = !!geo?.country;

  const confidence: 'high' | 'medium' | 'low' =
    hasLinkedIn && hasTwitter ? 'high' :
    hasLinkedIn || hasTwitter ? 'medium' : 'low';

  ctx.founderEnrichment = {
    linkedinSummary,
    twitterBio,
    geo: hasGeo ? geo : null,
    confidence,
  };

  const parts: string[] = [];
  if (linkedinSummary) parts.push(`LinkedIn: ${linkedinSummary}`);
  if (twitterBio) parts.push(`Twitter: ${twitterBio}`);
  if (geo?.country) parts.push(`Location: ${[geo.city, geo.region, geo.country].filter(Boolean).join(', ')} (timezone: ${geo.timezone ?? 'unknown'})`);

  if (parts.length > 0) {
    ctx.enrichedFounderSummary = parts.join('\n');
  }
}

// Extract founder positioning angle from enriched context — used by Surprise Me (strongest value)
// and optionally by Build/Grow when geo/background is rich.
export async function extractFounderAngle(ctx: PipelineContext): Promise<void> {
  const background = ctx.enrichedFounderSummary ?? ctx.founderEnrichment?.linkedinSummary ?? '';
  if (!background && !ctx.founderEnrichment?.geo?.country) return;

  const journeyContext = {
    surprise_me: 'The founder has not specified an idea — we need to figure out what they should build based on their background and local market.',
    build_my_idea: `The founder wants to build: "${ctx.input ?? 'their idea'}". We need to understand their unfair advantage and how their local market shapes this opportunity.`,
    grow_my_company: `The founder has an existing business: "${ctx.input ?? 'their company'}". We need to understand what makes them well-positioned to grow it in their market.`,
  }[ctx.journey];

  const geo = ctx.founderEnrichment?.geo;
  const geoContext = geo?.country
    ? `Location: ${[geo.city, geo.region, geo.country].filter(Boolean).join(', ')} (timezone: ${geo.timezone ?? 'unknown'})`
    : '';

  const prompt = `You are analyzing a startup founder to understand their positioning.

${journeyContext}

${geoContext ? `Founder location:\n${geoContext}\n` : ''}${background ? `Founder background:\n${background.slice(0, 500)}` : ''}

In 2-3 sentences, describe (be concrete, no generic statements):
1. What domain this founder deeply understands from their background
2. Their specific unfair advantage — including how their location shapes the market opportunity (local pricing dynamics, what's growing in their region, networks they can access)
3. The exact type of customer they can credibly reach (be specific about geography, role, and situation)

No fluff. Name specific industries, regions, or experiences.`;

  const angle = await callSmallLLM(prompt);
  if (angle.trim()) {
    ctx.founderAngle = angle.trim().slice(0, 500);
    await appendMemorySection(ctx.companyId, '## Founder Angle', [ctx.founderAngle]);
  }
}
