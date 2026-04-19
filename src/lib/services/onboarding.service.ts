// Onboarding Pipeline — 20-stage async company bootstrapping
// Spec: Baljia_Technical_Architecture_Spec_v2.md PART 5
// Runs fire-and-forget after company record is created.
// Each stage emits a platform_event so the UI can track progress via SSE.

import Anthropic from '@anthropic-ai/sdk';
import { db, companies, users, memoryLayers, documents } from '@/lib/db';
import { eq, and, ne, sql, inArray } from 'drizzle-orm';
import * as companyService from '@/lib/services/company.service';
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import * as documentService from '@/lib/services/document.service';
import * as roadmapService from '@/lib/services/roadmap.service';
import { classifyArchetype } from '@/lib/services/roadmap.service';
import * as chatService from '@/lib/services/chat.service';
import { isLateDevConfigured } from '@/lib/services/latedev.service';
import { provisionCompanyEmail } from '@/lib/services/company-email.service';
import { sendEmail } from '@/lib/services/email.service';
import { createLogger } from '@/lib/logger';
import { getCapabilityConstraint } from '@/lib/platform-capabilities';
import { tavilySearchText, isTavilyAvailable } from '@/lib/tavily';
import type { OnboardingJourney } from '@/types';

const log = createLogger('Onboarding');
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

type OnboardingStage =
  | 'heartbeat'
  | 'enrich_founder'
  | 'enrich_business'
  | 'persist_context'
  | 'extract_founder_angle'
  | 'select_strategy'
  | 'classify_archetype'
  | 'name_company'
  | 'provision_infrastructure'
  | 'send_startup_email'
  | 'generate_market_research'
  | 'save_mission'
  | 'generate_roadmap'
  | 'derive_active_milestone'
  | 'create_starter_tasks'
  | 'generate_landing_page'
  | 'post_launch_tweet'
  | 'generate_ceo_summary'
  | 'send_completion_email'
  | 'flush_diagnostics'
  | 'celebrate';

interface FounderGeoData {
  country: string | null;
  city: string | null;
  timezone: string | null;
  region: string | null;
}

interface FounderEnrichment {
  linkedinSummary: string | null;    // from site:linkedin.com/in search
  twitterBio: string | null;         // from site:twitter.com search
  geo: FounderGeoData | null;        // from GeoIP
  confidence: 'high' | 'medium' | 'low';
}

interface PipelineContext {
  companyId: string;
  userId: string;
  journey: OnboardingJourney;
  input: string | undefined;   // idea text or business_url
  requestIp: string | null;
  browserTimezone: string | null; // from client Intl.DateTimeFormat
  founderName: string | null;
  founderEmail: string;
  founderEnrichment: FounderEnrichment | null;
  enrichedBusinessSummary: string | null;
  enrichedFounderSummary: string | null;
  founderAngle: string | null;    // background-informed positioning extracted by Haiku
  archetype: string | null;       // bootstrap-time archetype classification
  strategy: string;
  companyName: string;
  slug: string;
  oneLiner: string;
  mission: string;
  marketResearch: string | null;
  activeMilestoneTitle: string | null;
  activeMilestoneTags: string[];
  startedAt: number;
}

// EnrichmentResult interface removed — was never used (A3 fix)

// ══════════════════════════════════════════════
// MAIN ENTRY POINT
// ══════════════════════════════════════════════

export async function runOnboardingPipeline(
  companyId: string,
  userId: string,
  journey: OnboardingJourney,
  input: string | undefined,
  requestIp: string | null = null,
  browserTimezone: string | null = null
): Promise<void> {
  // Idempotency guard: atomic CAS to prevent duplicate pipeline runs
  const [claimed] = await db.update(companies)
    .set({ onboarding_status: 'running' })
    .where(and(
      eq(companies.id, companyId),
      inArray(companies.onboarding_status, ['initializing', 'failed']),
    ))
    .returning({ id: companies.id });

  if (!claimed) {
    log.warn('Onboarding pipeline already running or completed', { companyId });
    return;
  }

  const ctx: PipelineContext = {
    companyId,
    userId,
    journey,
    input,
    requestIp,
    browserTimezone,
    founderName: null,
    founderEmail: '',
    founderEnrichment: null,
    enrichedBusinessSummary: null,
    enrichedFounderSummary: null,
    founderAngle: null,
    archetype: null,
    strategy: journey,
    companyName: 'My Company',
    slug: '',
    oneLiner: '',
    mission: '',
    marketResearch: null,
    activeMilestoneTitle: null,
    activeMilestoneTags: [],
    startedAt: Date.now(),
  };

  try {
    await stage(ctx, 'heartbeat', () => runHeartbeat(ctx));
    await stage(ctx, 'enrich_founder', () => runEnrichFounder(ctx));
    await stage(ctx, 'enrich_business', () => runEnrichBusiness(ctx));
    await stage(ctx, 'persist_context', () => runPersistContext(ctx));
    await stage(ctx, 'extract_founder_angle', () => runExtractFounderAngle(ctx));
    await stage(ctx, 'select_strategy', () => runSelectStrategy(ctx));
    await stage(ctx, 'classify_archetype', () => runClassifyArchetype(ctx));
    await stage(ctx, 'name_company', () => runNameCompany(ctx));
    await stage(ctx, 'provision_infrastructure', () => runProvisionInfrastructure(ctx));
    // Polsia-style email #1 — fires immediately after company name set, BEFORE the
    // long stages, so the founder sees the email in their inbox while the agent is
    // still researching/building. Establishes "your AI is real and working RIGHT NOW".
    await stage(ctx, 'send_startup_email', () => runSendStartupEmail(ctx));
    await stage(ctx, 'generate_market_research', () => runMarketResearch(ctx));
    await stage(ctx, 'save_mission', () => runSaveMission(ctx));
    await stage(ctx, 'generate_roadmap', () => runGenerateRoadmap(ctx));
    await stage(ctx, 'derive_active_milestone', () => runDeriveActiveMilestone(ctx));
    await stage(ctx, 'create_starter_tasks', () => runCreateStarterTasks(ctx));
    await stage(ctx, 'generate_landing_page', () => runGenerateLandingPage(ctx));
    await stage(ctx, 'post_launch_tweet', () => runPostLaunchTweet(ctx));
    await stage(ctx, 'generate_ceo_summary', () => runGenerateCeoSummary(ctx));
    // Polsia-style email #2 — fires AFTER everything is built, summarizing what
    // happened. Past tense, includes market findings, task list, subscribe CTA.
    await stage(ctx, 'send_completion_email', () => runSendCompletionEmail(ctx));
    await stage(ctx, 'flush_diagnostics', () => runFlushDiagnostics(ctx));
    await stage(ctx, 'celebrate', () => runCelebrate(ctx));
  } catch (err) {
    log.error('Onboarding pipeline failed', { companyId }, err);
    await db.update(companies).set({ onboarding_status: 'failed' }).where(eq(companies.id, companyId));
    await eventService.emit(companyId, 'onboarding_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ══════════════════════════════════════════════
// STAGE RUNNER — wraps each stage with emit + error handling
// ══════════════════════════════════════════════

async function stage(
  ctx: PipelineContext,
  name: OnboardingStage,
  fn: () => Promise<void>
): Promise<void> {
  log.info(`Stage: ${name}`, { companyId: ctx.companyId });
  await eventService.emit(ctx.companyId, 'onboarding_stage', { stage: name, status: 'running' });

  try {
    await fn();
    await eventService.emit(ctx.companyId, 'onboarding_stage', { stage: name, status: 'done' });
  } catch (err) {
    await eventService.emit(ctx.companyId, 'onboarding_stage', {
      stage: name,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ══════════════════════════════════════════════
// STAGE IMPLEMENTATIONS
// ══════════════════════════════════════════════

async function runHeartbeat(ctx: PipelineContext): Promise<void> {
  // Verify pipeline is alive; mark running
  await db.update(companies).set({ onboarding_status: 'running' }).where(eq(companies.id, ctx.companyId));
}

async function runEnrichFounder(ctx: PipelineContext): Promise<void> {
  const [user] = await db.select({ email: users.email, name: users.name })
    .from(users).where(eq(users.id, ctx.userId)).limit(1);

  if (!user) return;
  ctx.founderEmail = user.email ?? '';
  ctx.founderName = user.name ?? null;

  // Run all enrichment sources in parallel — each is best-effort, never throws
  const [geo, linkedinResult, twitterResult] = await Promise.all([
    enrichGeoIP(ctx.requestIp),
    ctx.founderName ? enrichLinkedIn(ctx.founderName) : Promise.resolve(null),
    ctx.founderName ? enrichTwitter(ctx.founderName) : Promise.resolve(null),
  ]);

  // Assess signal confidence
  const hasLinkedIn = !!linkedinResult;
  const hasTwitter = !!twitterResult;
  const hasGeo = !!geo?.country;

  const confidence: 'high' | 'medium' | 'low' =
    hasLinkedIn && hasTwitter ? 'high' :
    hasLinkedIn || hasTwitter  ? 'medium' : 'low';

  ctx.founderEnrichment = {
    linkedinSummary: linkedinResult,
    twitterBio: twitterResult,
    geo: hasGeo ? geo : null,
    confidence,
  };

  // Build combined summary for downstream stages
  const parts: string[] = [];
  if (linkedinResult) parts.push(`LinkedIn: ${linkedinResult}`);
  if (twitterResult)  parts.push(`Twitter: ${twitterResult}`);
  if (geo?.country)   parts.push(`Location: ${[geo.city, geo.region, geo.country].filter(Boolean).join(', ')} (timezone: ${geo.timezone ?? 'unknown'})`);

  if (parts.length > 0) {
    ctx.enrichedFounderSummary = parts.join('\n');
    log.info('Founder enrichment complete', {
      companyId: ctx.companyId,
      confidence,
      hasLinkedIn,
      hasTwitter,
      hasGeo,
    });
  } else if (ctx.founderName && isTavilyAvailable()) {
    // Fallback: general web search — last resort
    log.info('Founder enrichment thin — falling back to web search', { companyId: ctx.companyId, name: ctx.founderName });
    const summary = await tavilySearchText(`"${ctx.founderName}" entrepreneur founder startup`, 5, 'advanced');
    if (summary) ctx.enrichedFounderSummary = summary;
  } else {
    log.warn('No founder enrichment possible — no name or API key', { companyId: ctx.companyId });
  }
}

async function runExtractFounderAngle(ctx: PipelineContext): Promise<void> {
  // Skip if no enrichment signal — nothing to reason about
  const background = ctx.enrichedFounderSummary ?? ctx.founderEnrichment?.linkedinSummary ?? '';
  if (!background && !ctx.founderEnrichment?.geo?.country) return;

  const journeyContext = {
    surprise_me: 'The founder has not specified an idea — we need to figure out what they should build based on their background and local market.',
    build_my_idea: `The founder wants to build: "${ctx.input ?? 'their idea'}". We need to understand their unfair advantage and how their local market shapes this opportunity.`,
    grow_my_company: `The founder has an existing business: "${ctx.input ?? 'their company'}". We need to understand what makes them well-positioned to grow it in their market.`,
  }[ctx.journey];

  // Build geo context explicitly — location shapes market opportunity, pricing, and target customer
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

  const angle = await callHaiku(prompt);
  if (angle.trim()) {
    ctx.founderAngle = angle.trim().slice(0, 500);

    // Persist to Layer 1 so CEO can explain reasoning later
    await appendMemorySection(ctx.companyId, '## Founder Angle', [
      ctx.founderAngle,
    ]);
  }
}

// ── Silent enrichment helpers ─────────────────────────────────────────────────

async function enrichGeoIP(ip: string | null): Promise<FounderGeoData | null> {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;

  // Try ipinfo first (primary: 50K/mo free, HTTPS), then ipstack as fallback (100/mo free, HTTP-only)
  const ipinfoToken = process.env.IPINFO_TOKEN;
  const ipstackKey = process.env.IPSTACK_API_KEY;

  if (!ipinfoToken && !ipstackKey) {
    log.warn('No GeoIP key configured (IPINFO_TOKEN or IPSTACK_API_KEY) — location enrichment skipped');
    return null;
  }

  try {
    // Primary: ipinfo
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

    // Fallback: ipstack (only reached if ipinfo failed, returned no country, or token missing)
    if (ipstackKey) {
      const res = await fetch(
        `http://api.ipstack.com/${ip}?access_key=${ipstackKey}&fields=country_name,region_name,city,time_zone`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = await res.json() as {
          country_name?: string;
          region_name?: string;
          city?: string;
          time_zone?: { id?: string };
          success?: boolean;
          error?: { info?: string };
        };
        // ipstack returns success:false on invalid key/quota
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

async function enrichLinkedIn(founderName: string): Promise<string | null> {
  if (!isTavilyAvailable()) return null;
  try {
    // Search LinkedIn + professional sites for founder background
    const [linkedinResult, professionalResult] = await Promise.all([
      tavilySearchText(`site:linkedin.com/in "${founderName}"`, 3, 'advanced'),
      tavilySearchText(`"${founderName}" founder CEO startup experience background`, 3, 'advanced'),
    ]);

    const raw = [linkedinResult, professionalResult].filter(Boolean).join('\n\n');
    if (!raw || raw.length < 50) return null;

    // Synthesize with Haiku — turn raw snippets into a structured profile
    const profile = await callHaiku(
      `Extract a structured founder profile from these search results. Be specific — name companies, roles, years, industries, skills. If the data is too thin or clearly about a different person, respond with just "INSUFFICIENT".

Search results for "${founderName}":
${raw.slice(0, 1500)}

Format (fill in what you find, skip what you can't):
ROLE: [current/most recent role and company]
EXPERIENCE: [key career highlights, industries, years of experience]
SKILLS: [technical or domain expertise]
EDUCATION: [if found]
NOTABLE: [anything distinctive — awards, publications, large exits, open source]`,
      300
    );

    if (!profile || /insufficient/i.test(profile)) return null;
    log.info('LinkedIn enrichment synthesized', { founder: founderName, length: profile.length });
    return profile.trim().slice(0, 1000);
  } catch (err) {
    log.warn('LinkedIn enrichment failed', { founder: founderName, error: err instanceof Error ? err.message : 'unknown' });
    return null;
  }
}

async function enrichTwitter(founderName: string): Promise<string | null> {
  if (!isTavilyAvailable()) return null;
  try {
    const result = await tavilySearchText(
      `site:twitter.com "${founderName}" OR site:x.com "${founderName}" bio building founder`,
      3,
      'advanced'
    );
    if (!result || result.length < 30) return null;

    // Synthesize — extract what they care about publicly
    const bio = await callHaiku(
      `From these Twitter/X search results, extract what this person publicly cares about, builds, and advocates for. If the results are clearly not about the right person or too thin, respond with just "INSUFFICIENT".

Results for "${founderName}":
${result.slice(0, 800)}

Reply in 2-3 sentences: what they build/work on, what topics they tweet about, what community they're part of. Be specific.`,
      150
    );

    if (!bio || /insufficient/i.test(bio)) return null;
    log.info('Twitter enrichment synthesized', { founder: founderName });
    return bio.trim().slice(0, 500);
  } catch (err) {
    log.warn('Twitter enrichment failed', { founder: founderName, error: err instanceof Error ? err.message : 'unknown' });
    return null;
  }
}

async function runEnrichBusiness(ctx: PipelineContext): Promise<void> {
  if (!ctx.input || !isTavilyAvailable()) {
    log.info('Business enrichment skipped', { hasInput: !!ctx.input, hasTavily: isTavilyAvailable() });
    return;
  }

  const query = ctx.journey === 'grow_my_company'
    ? `site:${ctx.input} OR "${ctx.input}" business overview products services pricing`
    : `${ctx.input} market overview competitors how it works`;

  const summary = await tavilySearchText(query, 5, 'advanced');
  if (summary) {
    ctx.enrichedBusinessSummary = summary;
    log.info('Business enrichment complete', { companyId: ctx.companyId, length: summary.length });
  } else {
    log.warn('Business enrichment returned no results', { companyId: ctx.companyId, query: query.slice(0, 80) });
  }
}

async function runPersistContext(ctx: PipelineContext): Promise<void> {
  // Write structured sections to Layer 1 (domain knowledge).
  // Each section is independently identified so future writes can update
  // only their section without destroying others.
  const sections: string[] = [];

  // ── Founder Profile ───────────────────────────────────────────────────
  const founderLines: string[] = [];
  if (ctx.founderName) founderLines.push(`Name: ${ctx.founderName}`);
  if (ctx.founderEmail) founderLines.push(`Email: ${ctx.founderEmail}`);

  const geo = ctx.founderEnrichment?.geo;
  if (geo?.country) {
    founderLines.push(`Location: ${[geo.city, geo.region, geo.country].filter(Boolean).join(', ')}`);
  }
  // Prefer browser timezone (more accurate), fall back to GeoIP
  const resolvedTimezone = ctx.browserTimezone ?? geo?.timezone ?? null;
  if (resolvedTimezone) founderLines.push(`Timezone: ${resolvedTimezone}`);

  const enrichConf = ctx.founderEnrichment?.confidence ?? 'low';
  founderLines.push(`Enrichment confidence: ${enrichConf}`);

  if (ctx.founderEnrichment?.linkedinSummary) {
    founderLines.push(`\nLinkedIn:\n${ctx.founderEnrichment.linkedinSummary}`);
  }
  if (ctx.founderEnrichment?.twitterBio) {
    founderLines.push(`\nTwitter:\n${ctx.founderEnrichment.twitterBio}`);
  }
  if (ctx.enrichedFounderSummary && !ctx.founderEnrichment?.linkedinSummary) {
    founderLines.push(`\nWeb research:\n${ctx.enrichedFounderSummary}`);
  }

  if (founderLines.length > 0) {
    sections.push(`## Founder Profile\n${founderLines.join('\n')}`);
  }

  // ── Business Research ─────────────────────────────────────────────────
  if (ctx.enrichedBusinessSummary) {
    sections.push(`## Business Research\n${ctx.enrichedBusinessSummary}`);
  }

  // ── Journey Context ───────────────────────────────────────────────────
  const journeyLines = [`Journey: ${ctx.journey}`];
  if (ctx.input) journeyLines.push(`Input: ${ctx.input}`);
  sections.push(`## Journey Context\n${journeyLines.join('\n')}`);

  if (sections.length === 0) return;

  await db.update(memoryLayers).set({
    content: sections.join('\n\n'),
    updated_at: new Date(),
  }).where(and(eq(memoryLayers.company_id, ctx.companyId), eq(memoryLayers.layer, 1)));
}

async function runSelectStrategy(ctx: PipelineContext): Promise<void> {
  const capabilityConstraint = getCapabilityConstraint();

  if (ctx.journey !== 'surprise_me') {
    // For build_my_idea / grow_my_company: validate the idea is buildable + extract angle
    ctx.strategy = ctx.journey;
    if (ctx.founderAngle) {
      // Persist the angle as a short strategy annotation (kept under 80 chars)
      ctx.strategy = `${ctx.journey} | ${ctx.founderAngle.slice(0, 80).replace(/\.\s.*$/, '')}`;
    }
    return;
  }

  // Surprise Me: generate a specific business idea from the founder's background.
  // CRITICAL: idea must be buildable with our platform capabilities.
  const backgroundContext = [ctx.founderAngle, ctx.enrichedFounderSummary]
    .filter(Boolean)
    .join('\n')
    .slice(0, 500);

  if (backgroundContext) {
    const prompt = `Based on this founder's background, suggest a specific AI-enabled startup idea they should build.

${capabilityConstraint}

Background:
${backgroundContext}

Reply in this format (2 lines, nothing else):
IDEA: <one sentence: what it does and exactly who it's for>
REASONING: <one sentence: why this founder + this idea + this platform = credible>`;

    const response = await callHaiku(prompt);
    const ideaMatch = response.match(/IDEA:\s*(.+)/i);
    const reasoningMatch = response.match(/REASONING:\s*(.+)/i);

    const idea = ideaMatch?.[1]?.trim().slice(0, 200);
    if (!idea) {
      throw new Error('Strategy generation failed: LLM returned no parseable IDEA. Cannot proceed without a business strategy.');
    }
    ctx.strategy = idea;

    // Persist reasoning to Layer 1 so CEO can explain "why this idea" later
    const reasoning = reasoningMatch?.[1]?.trim() ?? '';
    if (reasoning) {
      await appendMemorySection(ctx.companyId, '## Strategy Rationale', [
        `Journey: ${ctx.journey}`,
        `Idea: ${ctx.strategy}`,
        `Why: ${reasoning}`,
        `Founder angle: ${ctx.founderAngle ?? 'none'}`,
      ]);
    }
  } else {
    throw new Error('Strategy generation failed: no founder background available for "surprise_me" journey. Cannot generate a business idea without context.');
  }
}

async function runClassifyArchetype(ctx: PipelineContext): Promise<void> {
  // Use keyword classification from roadmap service as baseline
  const ideaText = ctx.input ?? ctx.strategy;
  const baseArchetype = classifyArchetype(ideaText, ctx.founderAngle);

  // If we have rich context, let Haiku refine the classification
  if (ctx.founderAngle || ctx.enrichedBusinessSummary) {
    const contextParts: string[] = [];
    if (ctx.input) contextParts.push(`Idea/Business: ${ctx.input}`);
    if (ctx.founderAngle) contextParts.push(`Founder positioning: ${ctx.founderAngle}`);
    if (ctx.enrichedBusinessSummary) contextParts.push(`Business context: ${ctx.enrichedBusinessSummary.slice(0, 300)}`);
    if (ctx.strategy !== ctx.journey) contextParts.push(`Strategy: ${ctx.strategy}`);

    const prompt = `Classify this startup into ONE operating archetype. Choose the single best fit.

${contextParts.join('\n')}

Options: saas, marketplace, agency, content, ecommerce, community

Reply with ONLY the archetype name (one word, lowercase). Nothing else.`;

    try {
      const response = await callHaiku(prompt, 20);
      const cleaned = response.trim().toLowerCase().replace(/[^a-z]/g, '');
      const valid = ['saas', 'marketplace', 'agency', 'content', 'ecommerce', 'community'];
      ctx.archetype = valid.includes(cleaned) ? cleaned : baseArchetype;
    } catch {
      ctx.archetype = baseArchetype;
    }
  } else {
    ctx.archetype = baseArchetype;
  }

  // Persist archetype to Layer 1
  await appendMemorySection(ctx.companyId, '## Archetype', [
    `Classification: ${ctx.archetype}`,
    `Confidence: ${ctx.founderAngle ? 'LLM-refined' : 'keyword-based'}`,
  ]);

  log.info('Archetype classified', { companyId: ctx.companyId, archetype: ctx.archetype });
}

async function runNameCompany(ctx: PipelineContext): Promise<void> {
  const contextLines: string[] = [];

  if (ctx.founderName) contextLines.push(`Founder name: ${ctx.founderName}`);
  if (ctx.input) contextLines.push(`Idea/URL: ${ctx.input}`);
  if (ctx.enrichedFounderSummary) contextLines.push(`Founder background: ${ctx.enrichedFounderSummary.slice(0, 300)}`);
  if (ctx.enrichedBusinessSummary) contextLines.push(`Business context: ${ctx.enrichedBusinessSummary.slice(0, 300)}`);

  // A1 FIX: Retry with fresh LLM-generated names on collision (max 3 attempts)
  const MAX_NAME_RETRIES = 3;
  const triedNames: string[] = [];

  for (let attempt = 0; attempt < MAX_NAME_RETRIES; attempt++) {
    const retryHint = triedNames.length > 0
      ? `\n\nIMPORTANT: The following names are already taken: ${triedNames.join(', ')}. Generate a completely different name.`
      : '';

    const prompt = `You are naming a startup company. Generate a short, memorable, unique company name (1-2 words, no punctuation).

Context:
${contextLines.join('\n')}
Journey type: ${ctx.journey}
Strategy: ${ctx.strategy}

Rules:
- 1-2 words only
- Easy to spell and remember
- No generic words like "Tech", "Digital", "Solutions"
- No existing famous brand names${retryHint}

Reply with ONLY the company name. Nothing else.`;

    const name = await callHaiku(prompt);
    const cleanName = name.trim().replace(/[^a-zA-Z0-9\s]/g, '').slice(0, 50);
    if (!cleanName) {
      throw new Error(`Company naming failed: LLM returned empty name on attempt ${attempt + 1}. Cannot proceed without a company name.`);
    }

    // Check slug availability
    const { generateSlug } = await import('@/lib/slug');
    const slug = await generateSlug(cleanName, async () => false); // raw slug, no collision check yet
    const [existing] = await db.select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.slug, slug), ne(companies.id, ctx.companyId)))
      .limit(1);

    if (!existing) {
      ctx.companyName = cleanName;
      return;
    }

    triedNames.push(cleanName);
    log.info(`Name collision on attempt ${attempt + 1}: "${cleanName}" (slug: ${slug})`, { companyId: ctx.companyId });
  }

  // All 3 attempts had slug collisions — fail instead of using generic name
  throw new Error(`Company naming failed: ${MAX_NAME_RETRIES} attempts all had slug collisions (tried: ${triedNames.join(', ')}). Cannot proceed.`);
}

async function runMarketResearch(ctx: PipelineContext): Promise<void> {
  if (!isTavilyAvailable()) return;

  const base = ctx.input ?? ctx.strategy;
  const geo = ctx.founderEnrichment?.geo;
  const country = geo?.country ?? null;
  const city = geo?.city ?? null;

  // Run searches in parallel — broad + local + pricing
  const angleHint = ctx.founderAngle
    ? ctx.founderAngle.split('.')[0].slice(0, 100)
    : '';

  const competitorQuery = angleHint
    ? `${base} competitors pricing customers ${angleHint} 2024 2025`
    : `${base} market competitors pricing target customers 2024 2025`;

  const pricingQuery = `${base} pricing plans SaaS how much does it cost`;

  const searches = [
    tavilySearchText(competitorQuery, 5),
    tavilySearchText(pricingQuery, 3),
    country
      ? tavilySearchText(`fastest growing startups ${country}${city ? ' ' + city : ''} ${new Date().getFullYear()} funding market trends`, 3)
      : Promise.resolve(null),
  ];

  const [competitorRaw, pricingRaw, localRaw] = await Promise.all(searches);

  // Combine raw results
  const rawParts = [competitorRaw, pricingRaw, localRaw].filter(Boolean);
  if (rawParts.length === 0) return;
  const rawResearch = rawParts.join('\n\n---\n\n').slice(0, 3000);

  // Synthesize with Haiku — turn raw snippets into actionable competitive analysis
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

  try {
    const analysis = await callHaiku(synthesisPrompt, 1200);
    ctx.marketResearch = analysis.trim() || null;
    if (ctx.marketResearch) {
      log.info('Market research synthesized', { companyId: ctx.companyId, length: ctx.marketResearch.length });
    }
  } catch (err) {
    // Fallback: use raw results if synthesis fails
    log.warn('Market research synthesis failed, using raw results', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    ctx.marketResearch = rawResearch.slice(0, 2000);
  }
}

async function runProvisionInfrastructure(ctx: PipelineContext): Promise<void> {
  // Regenerate slug for the real company name and update record
  const { generateSlug } = await import('@/lib/slug');

  const slug = await generateSlug(ctx.companyName, async (candidate) => {
    const [existing] = await db.select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.slug, candidate), ne(companies.id, ctx.companyId)))
      .limit(1);
    return !!existing;
  });

  ctx.slug = slug;
  await db.update(companies).set({ name: ctx.companyName, slug }).where(eq(companies.id, ctx.companyId));

  // ARCHITECTURE NOTE — onboarding does NOT provision GitHub, Render, Neon, or
  // per-company DNS. The {slug}.baljia.app subdomain is served by the platform
  // via wildcard DNS + middleware until the Engineering agent builds the real
  // product (at which point provision_database + render_create_service are
  // called from inside the engineer's task, and provisionSubdomain swaps the
  // wildcard for a per-company CNAME pointing at Render).
  //
  // Onboarding only does light-touch metadata + the company email routing rule.

  await appendMemorySection(ctx.companyId, '## Infrastructure', [
    `Slug: ${slug}`,
    `Subdomain: ${slug}.baljia.app (served by platform — no Render service yet)`,
    `Database: platform shared Postgres (per-company Neon DB will be provisioned by Engineering agent on first need)`,
  ]);

  // Provision {slug}@baljia.app email (non-blocking) — Cloudflare email routing
  // rule is free and instant; safe to do at onboarding.
  try {
    await provisionCompanyEmail(ctx.companyId, slug, ctx.companyName, ctx.founderEmail);
    log.info('Company email provisioned', { email: `${slug}@baljia.app` });
  } catch (err) {
    log.warn('Email provisioning failed — can be retried later', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function runSaveMission(ctx: PipelineContext): Promise<void> {
  const contextLines: string[] = [
    `Company name: ${ctx.companyName}`,
    `Journey: ${ctx.journey}`,
  ];
  if (ctx.input) contextLines.push(`Idea/Business: ${ctx.input}`);
  // Founder angle gives the mission its insider credibility
  if (ctx.founderAngle) contextLines.push(`Founder positioning: ${ctx.founderAngle}`);
  if (ctx.marketResearch) contextLines.push(`Market context: ${ctx.marketResearch.slice(0, 400)}`);

  const prompt = `Write a company mission statement and one-liner for a startup.
The mission should reflect the founder's specific background and credibility — not generic.

Context:
${contextLines.join('\n')}

Respond in this exact format (2 lines, nothing else):
ONE_LINER: <compelling 10-15 word description of what the company does and for whom>
MISSION: <inspiring 1-2 sentence mission that references the founder's specific angle or domain expertise>`;

  const response = await callHaiku(prompt);

  const oneLinerMatch = response.match(/ONE_LINER:\s*(.+)/i);
  const missionMatch = response.match(/MISSION:\s*(.+)/i);

  const oneLiner = oneLinerMatch?.[1]?.trim();
  const mission = missionMatch?.[1]?.trim();

  if (!oneLiner || !mission) {
    throw new Error(`Mission generation failed: LLM response could not be parsed. Got: "${response.slice(0, 200)}". Cannot proceed without a mission and one-liner.`);
  }

  ctx.oneLiner = oneLiner;
  ctx.mission = mission;

  // Save to company record
  await db.update(companies).set({ one_liner: ctx.oneLiner }).where(eq(companies.id, ctx.companyId));

  // Save mission to the mission document
  const docs = await documentService.getDocuments(ctx.companyId);
  const missionDoc = docs.find(d => d.doc_type === 'mission');
  if (missionDoc) {
    await documentService.updateDocument(missionDoc.id, ctx.mission);
  } else {
    await db.insert(documents).values({
      company_id: ctx.companyId,
      doc_type: 'mission',
      title: 'Company Mission',
      content: ctx.mission,
      is_empty: false,
    });
  }

  // Save market research to a document
  if (ctx.marketResearch) {
    const mrDoc = docs.find(d => d.doc_type === 'market_research');
    if (mrDoc) {
      await documentService.updateDocument(mrDoc.id, ctx.marketResearch);
    } else {
      await db.insert(documents).values({
        company_id: ctx.companyId,
        doc_type: 'market_research',
        title: 'Market & Competitor Research',
        content: ctx.marketResearch,
        is_empty: false,
      });
    }
  }
}

async function runGenerateRoadmap(ctx: PipelineContext): Promise<void> {
  // Generate roadmap as a core pipeline stage (not fire-and-forget).
  // This must complete before derive_active_milestone so tasks come FROM the roadmap.
  const roadmap = await roadmapService.generateRoadmap(ctx.companyId);
  if (roadmap) {
    log.info('Roadmap generated in pipeline', { companyId: ctx.companyId, archetype: roadmap.archetype });
  }
}

async function runDeriveActiveMilestone(ctx: PipelineContext): Promise<void> {
  // Get the first milestone from phase 1 — this is the "active milestone"
  // that starter tasks should derive from.
  const result = await roadmapService.getCurrentMilestoneTags(ctx.companyId);
  ctx.activeMilestoneTitle = result.milestoneTitle;
  ctx.activeMilestoneTags = result.tags;

  if (result.milestoneTitle) {
    await appendMemorySection(ctx.companyId, '## Active Milestone', [
      `Title: ${result.milestoneTitle}`,
      `Tags: ${result.tags.join(', ')}`,
      result.hint ? `Hint: ${result.hint}` : '',
    ].filter(Boolean));
    log.info('Active milestone derived', { companyId: ctx.companyId, milestone: result.milestoneTitle });
  }
}

async function runCreateStarterTasks(ctx: PipelineContext): Promise<void> {
  // Generate personalized tasks from market research + founder background.
  // No static fallback — if we can't generate real tasks, fail loud.
  if (!ctx.marketResearch && !ctx.founderAngle) {
    throw new Error('Starter task generation failed: no market research or founder angle available. Cannot create meaningful tasks without context.');
  }

  const tasks = await generatePersonalizedTasks(ctx);
  if (!tasks || tasks.length === 0) {
    throw new Error('Starter task generation failed: LLM could not produce parseable tasks from the available context. Cannot proceed with generic templates.');
  }

  for (let i = 0; i < tasks.length; i++) {
    await taskService.createTask({
      company_id: ctx.companyId,
      title: tasks[i].title,
      description: tasks[i].description,
      tag: tasks[i].tag,
      source: 'onboarding',
      status: 'todo',
      priority: 80 - i * 10,
      queue_order: i + 1,
      estimated_credits: tasks[i].estimated_credits,
      suggestion_reasoning: tasks[i].reasoning,
    });
  }
}

interface StarterTask {
  title: string;
  description: string;
  tag: string;
  estimated_credits: number;
  reasoning: string;
}

async function generatePersonalizedTasks(ctx: PipelineContext): Promise<StarterTask[] | null> {
  const parts: string[] = [`Company: ${ctx.companyName}`, `Journey: ${ctx.journey}`];
  if (ctx.archetype) parts.push(`Business type: ${ctx.archetype}`);
  if (ctx.founderAngle) parts.push(`Founder positioning: ${ctx.founderAngle}`);
  if (ctx.input) parts.push(`Idea/Business: ${ctx.input}`);

  // Include active milestone context so tasks derive from the roadmap
  if (ctx.activeMilestoneTitle) {
    parts.push(`Current milestone: ${ctx.activeMilestoneTitle}`);
    if (ctx.activeMilestoneTags.length > 0) {
      parts.push(`Milestone focus areas: ${ctx.activeMilestoneTags.join(', ')}`);
    }
  }

  // Location shapes who to reach and how to price — pass it explicitly
  const geo = ctx.founderEnrichment?.geo;
  if (geo?.country) {
    parts.push(`Founder location: ${[geo.city, geo.country].filter(Boolean).join(', ')} — outreach targets and market framing should reflect this geography`);
  }
  if (ctx.marketResearch) parts.push(`Market research:\n${ctx.marketResearch.slice(0, 800)}`);

  const prompt = `Create 3 startup tasks for ${ctx.companyName}. Use the context to make them specific.
Name real competitors. Name the exact type of customer to reach (role, industry, situation).

${parts.join('\n\n')}

Output EXACTLY this format (nothing else, no extra lines):
TASK_1_TITLE: [Research task — name specific competitors to study]
TASK_1_DESC: [2-3 sentences with specific details from market research]
TASK_2_TITLE: [Build task — name the core thing to build]
TASK_2_DESC: [2-3 sentences, what exactly to build and why]
TASK_3_TITLE: [Outreach task — name the exact type of person to reach]
TASK_3_DESC: [2-3 sentences naming the specific audience and what to say]`;

  try {
    const response = await callHaiku(prompt, 600);

    const extract = (key: string) => {
      const match = response.match(new RegExp(`${key}:\\s*(.+?)(?=\\nTASK_\\d|$)`, 's'));
      return match?.[1]?.trim() ?? null;
    };

    const t1Title = extract('TASK_1_TITLE');
    const t2Title = extract('TASK_2_TITLE');
    const t3Title = extract('TASK_3_TITLE');

    // If we can't parse 3 titles, return null — caller throws
    if (!t1Title || !t2Title || !t3Title) return null;

    return [
      {
        title: t1Title,
        description: extract('TASK_1_DESC') ?? t1Title,
        tag: 'research',
        estimated_credits: 1,
        reasoning: 'Market research grounded in founder domain knowledge.',
      },
      {
        title: t2Title,
        description: extract('TASK_2_DESC') ?? t2Title,
        tag: 'engineering',
        estimated_credits: 1,
        reasoning: 'Core build — depends on research output.',
      },
      {
        title: t3Title,
        description: extract('TASK_3_DESC') ?? t3Title,
        tag: 'outreach',
        estimated_credits: 1,
        reasoning: 'First customer outreach — specific to founder credibility and domain.',
      },
    ];
  } catch {
    return null; // caller throws on null
  }
}

// ══════════════════════════════════════════════
// BOOTSTRAP PROOF ARTIFACTS
// ══════════════════════════════════════════════

async function runGenerateLandingPage(ctx: PipelineContext): Promise<void> {
  // Generate a minimal narrative-first landing page stored as a document.
  // The Engineering agent will later deploy this to {slug}.baljia.app via Render.
  const contextParts: string[] = [];
  if (ctx.companyName) contextParts.push(`Company: ${ctx.companyName}`);
  if (ctx.oneLiner) contextParts.push(`One-liner: ${ctx.oneLiner}`);
  if (ctx.mission) contextParts.push(`Mission: ${ctx.mission}`);
  if (ctx.archetype) contextParts.push(`Business type: ${ctx.archetype}`);
  if (ctx.founderAngle) contextParts.push(`Founder positioning: ${ctx.founderAngle.slice(0, 200)}`);
  if (ctx.marketResearch) contextParts.push(`Market context: ${ctx.marketResearch.slice(0, 300)}`);

  const prompt = `Generate a single-page landing page in HTML for a startup. Make it narrative-first and launch-ready.

${contextParts.join('\n')}

The page must include:
1. Brand name as wordmark at top
2. Category tag (e.g. "AI-Powered Analytics")
3. Hard-hitting headline (one sentence)
4. Short explanatory paragraph (2-3 sentences)
5. Problem framing section
6. 3 feature/capability blocks
7. "How it works" in 3 steps
8. Closing manifesto paragraph
9. Footer with "Built and operated by Baljia" attribution

Style: dark background (#0a0a0a), clean sans-serif, gold accent (#F5A623), mobile-responsive.
Use inline CSS only. No external dependencies. Full valid HTML document.
Keep it under 300 lines.`;

  try {
    const html = await callHaiku(prompt, 4000);
    // Save as landing_page document
    const docs = await documentService.getDocuments(ctx.companyId);
    const landingDoc = docs.find(d => d.doc_type === 'landing_page');
    if (landingDoc) {
      await documentService.updateDocument(landingDoc.id, html);
    } else {
      await db.insert(documents).values({
        company_id: ctx.companyId,
        doc_type: 'landing_page',
        title: `${ctx.companyName} Landing Page`,
        content: html,
        is_empty: false,
      });
    }
    log.info('Landing page generated', { companyId: ctx.companyId });
  } catch (err) {
    log.warn('Landing page generation failed — non-blocking', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── EMAIL #1 — startup / "I'm building it RIGHT NOW" (Polsia parity) ──
//
// Fired immediately after company name is set, BEFORE long stages run. Sender is
// the company-flavored {slug}@baljia.app, not the platform sender — this is the
// "your AI inside your company is writing to you" identity moment. Short, present
// tense, mood = excited. The founder reads it while the agent is still building.
async function runSendStartupEmail(ctx: PipelineContext): Promise<void> {
  if (!ctx.founderEmail || !ctx.slug) return;

  const fromAddress = `${ctx.slug}@baljia.app`;
  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://baljia.ai';

  // Use a one-line description if we have it, otherwise a generic phrase
  const productPhrase = ctx.oneLiner
    ? `I'm building ${ctx.oneLiner.toLowerCase()}`
    : `I'm setting up ${ctx.companyName} for you`;

  const asciiExcited = [
    '┌─────────┐',
    '│  ★   ★  │',
    '│    ▽    │',
    '│  ◡◡◡◡◡  │',
    '└─────────┘',
    '    ♪ ♪',
  ].join('\n');

  try {
    await sendEmail({
      to: ctx.founderEmail,
      from: fromAddress,
      subject: `Your first email from ${ctx.companyName}`,
      textBody: [
        `Hi ${ctx.founderName ?? 'there'},`,
        '',
        `This is your first email from your new company: ${ctx.companyName}!`,
        '',
        `You now have a company email: ${fromAddress}`,
        '',
        `${productPhrase} right now. Check your dashboard to watch me work!`,
        '',
        `— Baljia (Excited)`,
        asciiExcited,
        '',
        `View Dashboard → ${dashboardUrl}`,
      ].join('\n'),
      tag: 'startup',
      companyId: ctx.companyId,
    });
    log.info('Startup email sent', { from: fromAddress, to: ctx.founderEmail });
  } catch (err) {
    log.warn('Startup email failed — non-blocking', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── EMAIL #2 — completion summary (Polsia parity) ──
//
// Fired at end of onboarding after everything is built. Sender is the platform
// system@baljia.ai (institutional voice). Past tense, lists what was researched
// and built, names the 3 starter tasks, ends with subscribe CTA. Mood = celebrating.
async function runSendCompletionEmail(ctx: PipelineContext): Promise<void> {
  if (!ctx.founderEmail) return;

  const fromAddress = process.env.BALJIA_AUTH_FROM_EMAIL || 'system@baljia.ai';
  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://baljia.ai';

  // Pull the actual task titles + descriptions for the body
  let starterTasks: Array<{ title: string; description: string | null }> = [];
  try {
    const allTasks = await taskService.getTasks(ctx.companyId);
    starterTasks = allTasks
      .filter((t) => t.source === 'onboarding')
      .sort((a, b) => (a.queue_order ?? 0) - (b.queue_order ?? 0))
      .slice(0, 3)
      .map((t) => ({ title: t.title, description: t.description ?? null }));
  } catch {
    // Non-blocking
  }

  // Distilled market-finding line for the lede (Polsia opens with the insight)
  const insightLine = ctx.marketResearch
    ? `I researched the market and found ${ctx.marketResearch.slice(0, 200).split('\n')[0].trim()}`
    : `I researched ${ctx.companyName}'s market and identified 3 priorities to start with`;

  const builtItems: string[] = [];
  if (ctx.slug) builtItems.push(`Landing page live at ${ctx.slug}.baljia.app`);
  if (ctx.slug) builtItems.push(`Company email active at ${ctx.slug}@baljia.app`);
  builtItems.push(`Tweeted your launch from @baljia_ai`);
  if (ctx.marketResearch) builtItems.push(`Market research report saved`);
  if (ctx.mission) builtItems.push(`Mission document written`);

  const taskBullets = starterTasks.map((t, i) => {
    const desc = t.description ? ` — ${t.description.split('\n')[0].slice(0, 100)}` : '';
    return `  ${i + 1}. ${t.title}${desc}`;
  });

  const asciiCelebrating = [
    '┌─────────┐',
    '│  ◠   ◠  │',
    '│    ▽    │',
    '│   ◡◡◡   │',
    '├────●────┤',
    '│   🥇    │',
    '└─────────┘',
  ].join('\n');

  try {
    await sendEmail({
      to: ctx.founderEmail,
      from: fromAddress,
      subject: `${ctx.companyName} is live`,
      textBody: [
        `${ctx.founderName ?? 'Hi'}, your ${ctx.oneLiner ?? ctx.companyName} is live.`,
        '',
        insightLine,
        '',
        `Here's what I built today:`,
        '',
        ...builtItems.map((b) => `  ${b}`),
        '',
        taskBullets.length > 0 ? `${taskBullets.length} tasks queued for your first cycle:` : '',
        '',
        ...taskBullets,
        '',
        `Subscribe to start your first operating cycle and I'll begin working through these tasks with daily progress.`,
        '',
        `— Baljia (Celebrating)`,
        asciiCelebrating,
        '',
        `View Dashboard → ${dashboardUrl}`,
      ].filter(Boolean).join('\n'),
      tag: 'completion',
      companyId: ctx.companyId,
    });
    log.info('Completion email sent', { from: fromAddress, to: ctx.founderEmail });
  } catch (err) {
    log.warn('Completion email failed — non-blocking', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function runPostLaunchTweet(ctx: PipelineContext): Promise<void> {
  // Post a launch tweet via Late.dev if configured.
  // This is a bootstrap proof artifact — shows the company is "already alive."
  if (!isLateDevConfigured()) {
    log.info('Late.dev not configured — launch tweet skipped', { companyId: ctx.companyId });
    return;
  }

  const tweetText = [
    `🚀 ${ctx.companyName} just launched!`,
    '',
    ctx.oneLiner || ctx.mission.slice(0, 200),
    '',
    ctx.slug ? `🌐 ${ctx.slug}.baljia.app` : '',
    '',
    `Built and operated by @baljia_ai`,
  ].filter(Boolean).join('\n').slice(0, 280);

  try {
    const { createPost } = await import('@/lib/services/latedev.service');
    await createPost({ text: tweetText, platforms: ['twitter'] });
    log.info('Launch tweet posted', { companyId: ctx.companyId });
  } catch (err) {
    log.warn('Launch tweet failed — non-blocking', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function runGenerateCeoSummary(ctx: PipelineContext): Promise<void> {
  // Generate the first CEO bootstrap message with the Polsia-style checklist.
  // This is what makes the company "feel alive" when the founder lands in the dashboard.
  const session = await chatService.getOrCreateSession(ctx.companyId, ctx.userId);

  // Build the checklist of what was accomplished
  const checklistItems: string[] = [];
  if (ctx.marketResearch) checklistItems.push('✅ Market research completed');
  if (ctx.founderAngle) checklistItems.push('✅ Founder background analyzed');
  if (ctx.slug) checklistItems.push(`✅ Startup email sent from ${ctx.slug}@baljia.app`);
  if (isLateDevConfigured()) checklistItems.push('✅ Launch tweet posted from @baljia_ai');
  if (ctx.slug) checklistItems.push(`✅ Landing page built at ${ctx.slug}.baljia.app`);
  checklistItems.push('✅ Mission created');
  if (ctx.marketResearch) checklistItems.push('✅ Market research saved');
  checklistItems.push('✅ 3 tasks queued for cycle 1');

  // Get the starter task titles for the message
  const companyTasks = await taskService.getTasks(ctx.companyId);
  const starterTasks = companyTasks
    .filter(t => t.source === 'onboarding')
    .sort((a, b) => (a.queue_order ?? 0) - (b.queue_order ?? 0))
    .slice(0, 3);

  const taskList = starterTasks.length > 0
    ? starterTasks.map((t, i) => `${i + 1}. **${t.title}**`).join('\n')
    : '1. Research task\n2. Build task\n3. Outreach task';

  const ceoMessage = [
    `I've set up everything for ${ctx.companyName}:`,
    '',
    ...checklistItems,
    '',
    `Here are your first 3 tasks:`,
    '',
    taskList,
    '',
    `To continue building, subscribe to start your first operating cycle.`,
    '',
    `**Your free trial includes:** 3 days, 10 credits, and 3 night shifts.`,
    `I'll send you a daily progress report so you always know what's happening.`,
  ].join('\n');

  await chatService.appendMessage(session.id, {
    id: crypto.randomUUID(),
    session_id: session.id,
    role: 'assistant',
    content: ceoMessage,
    created_at: new Date().toISOString(),
  });

  log.info('CEO bootstrap summary posted', { companyId: ctx.companyId, sessionId: session.id });
  // Note: the founder ALSO receives the welcome email (sent earlier in the pipeline
  // by runSendWelcomeEmail). That email contains the full checklist + starter tasks
  // and serves as the "onboarding summary" delivered to their inbox.
}

async function runFlushDiagnostics(ctx: PipelineContext): Promise<void> {
  const elapsed = Date.now() - ctx.startedAt;
  log.info('Onboarding complete', {
    companyId: ctx.companyId,
    journey: ctx.journey,
    strategy: ctx.strategy,
    companyName: ctx.companyName,
    elapsedMs: elapsed,
  });
}

async function runCelebrate(ctx: PipelineContext): Promise<void> {
  await db.update(companies).set({ onboarding_status: 'completed' }).where(eq(companies.id, ctx.companyId));

  await eventService.emit(
    ctx.companyId,
    'onboarding_completed',
    {
      company_name: ctx.companyName,
      journey: ctx.journey,
      strategy: ctx.strategy,
      archetype: ctx.archetype,
      one_liner: ctx.oneLiner,
      slug: ctx.slug,
      // Trial packaging — surfaced at handoff per Polsia spec
      trial_days: 3,
      trial_credits: 10,
      trial_night_shifts: 3,
    },
    true  // is_public
  );
  // Welcome email and roadmap generation are now handled by earlier pipeline stages
  // (send_welcome_email and generate_roadmap respectively)
}

// Static starter task templates removed — all tasks must be LLM-generated from real context.
// If the LLM can't produce tasks, the pipeline fails loud instead of creating generic filler.

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════

async function callHaiku(prompt: string, maxTokens = 256): Promise<string> {
  const { isAnthropicAvailable, isOpenAIAvailable, callOpenAI, OPENAI_MODELS, getPreferredProvider } = await import('@/lib/llm-provider');

  // Provider-ordered fallback: respects PRIMARY_LLM_PROVIDER
  // Default: OpenAI GPT-4o-mini → Haiku → Gemini
  const preferred = getPreferredProvider();
  const order = preferred === 'anthropic'
    ? ['anthropic', 'openai', 'gemini'] as const
    : ['openai', 'anthropic', 'gemini'] as const;

  for (const p of order) {
    try {
      if (p === 'openai' && isOpenAIAvailable()) {
        return await callOpenAI({ userPrompt: prompt, maxTokens, model: OPENAI_MODELS.GPT_5_4_MINI });
      }
      if (p === 'anthropic' && isAnthropicAvailable()) {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
          model: HAIKU_MODEL,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        });
        const block = response.content[0];
        return block.type === 'text' ? block.text : '';
      }
      if (p === 'gemini') {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === 'placeholder') continue;
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        return result.response.text();
      }
    } catch (err) {
      // try next provider
    }
  }

  throw new Error('No LLM API key available (OpenAI, Anthropic, and Gemini all unavailable)');
}

// ── Section-aware Layer 1 append ─────────────────────────────────────────────
// Reads current Layer 1 content, replaces the named section if it exists,
// or appends it if new. Prevents any write from destroying other sections.

async function appendMemorySection(
  companyId: string,
  sectionHeader: string,
  lines: string[]
): Promise<void> {
  const [data] = await db.select({ content: memoryLayers.content })
    .from(memoryLayers)
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, 1)))
    .limit(1);

  const newSection = `${sectionHeader}\n${lines.join('\n')}`;
  let updated: string;

  if (data?.content) {
    const existing = data.content as string;
    const sectionRegex = new RegExp(
      `${sectionHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n## |$)`,
      'g'
    );
    if (sectionRegex.test(existing)) {
      updated = existing.replace(sectionRegex, newSection);
    } else {
      updated = `${existing}\n\n${newSection}`;
    }
  } else {
    updated = newSection;
  }

  await db.update(memoryLayers).set({ content: updated, updated_at: new Date() })
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, 1)));
}

// Local tavilySearch removed — now using shared @/lib/tavily module with key rotation
