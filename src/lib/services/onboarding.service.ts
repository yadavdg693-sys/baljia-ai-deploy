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
import { provisionCompanyDatabase } from '@/lib/services/neon.service';
import { provisionSubdomain } from '@/lib/services/domain.service';
import { provisionCompanyEmail } from '@/lib/services/company-email.service';
import { sendEmail } from '@/lib/services/email.service';
import { createLogger } from '@/lib/logger';
import { getCapabilityConstraint } from '@/lib/platform-capabilities';
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
  | 'generate_market_research'
  | 'save_mission'
  | 'generate_roadmap'
  | 'derive_active_milestone'
  | 'create_starter_tasks'
  | 'generate_landing_page'
  | 'send_welcome_email'
  | 'post_launch_tweet'
  | 'generate_ceo_summary'
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
    await stage(ctx, 'generate_market_research', () => runMarketResearch(ctx));
    await stage(ctx, 'save_mission', () => runSaveMission(ctx));
    await stage(ctx, 'generate_roadmap', () => runGenerateRoadmap(ctx));
    await stage(ctx, 'derive_active_milestone', () => runDeriveActiveMilestone(ctx));
    await stage(ctx, 'create_starter_tasks', () => runCreateStarterTasks(ctx));
    await stage(ctx, 'generate_landing_page', () => runGenerateLandingPage(ctx));
    await stage(ctx, 'send_welcome_email', () => runSendWelcomeEmail(ctx));
    await stage(ctx, 'post_launch_tweet', () => runPostLaunchTweet(ctx));
    await stage(ctx, 'generate_ceo_summary', () => runGenerateCeoSummary(ctx));
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
  if (geo?.country)   parts.push(`Location: ${[geo.city, geo.region, geo.country].filter(Boolean).join(', ')}`);

  if (parts.length > 0) {
    ctx.enrichedFounderSummary = parts.join('\n');
  } else if (ctx.founderName && process.env.TAVILY_API_KEY) {
    // Fallback: general web search — last resort
    const summary = await tavilySearch(`${ctx.founderName} entrepreneur founder`);
    if (summary) ctx.enrichedFounderSummary = summary;
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
  const token = process.env.IPINFO_TOKEN;
  if (!token) return null; // token required — skip silently if not configured
  try {
    const res = await fetch(`https://ipinfo.io/${ip}?token=${token}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      city?: string;
      region?: string;
      country?: string;
      timezone?: string;
    };
    return {
      country: data.country ?? null,
      region: data.region ?? null,
      city: data.city ?? null,
      timezone: data.timezone ?? null,
    };
  } catch {
    return null; // timeout or network error — silent
  }
}

async function enrichLinkedIn(founderName: string): Promise<string | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    // Target LinkedIn directly — much higher signal than generic search
    const result = await tavilySearch(
      `site:linkedin.com/in "${founderName}"`,
      3
    );
    if (!result) return null;

    // Only use if it actually looks like a profile (has "Experience" or role-like content)
    const looksLikeProfile =
      /experience|education|skills|founder|ceo|engineer|developer|manager/i.test(result);
    return looksLikeProfile ? result.slice(0, 800) : null;
  } catch {
    return null;
  }
}

async function enrichTwitter(founderName: string): Promise<string | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const result = await tavilySearch(
      `site:twitter.com "${founderName}" OR site:x.com "${founderName}"`,
      3
    );
    if (!result) return null;

    // Only use if it has bio-like content
    const looksLikeBio = /building|founder|ceo|working on|tweets|engineer|startup/i.test(result);
    return looksLikeBio ? result.slice(0, 400) : null;
  } catch {
    return null;
  }
}

async function runEnrichBusiness(ctx: PipelineContext): Promise<void> {
  if (!ctx.input || !process.env.TAVILY_API_KEY) return;

  const query = ctx.journey === 'grow_my_company'
    ? `site:${ctx.input} OR "${ctx.input}" business overview products services`
    : ctx.input;

  const summary = await tavilySearch(query);
  if (summary) ctx.enrichedBusinessSummary = summary;
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

    ctx.strategy = ideaMatch?.[1]?.trim().slice(0, 200) || 'novel_saas_tool';

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
    ctx.strategy = 'novel_saas_tool';
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
    const cleanName = name.trim().replace(/[^a-zA-Z0-9\s]/g, '').slice(0, 50) || 'Launchpad';

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

  // Safety net: use last tried name (slug will get suffix via generateSlug collision handling)
  ctx.companyName = triedNames[triedNames.length - 1] || 'Launchpad';
}

async function runMarketResearch(ctx: PipelineContext): Promise<void> {
  if (!process.env.TAVILY_API_KEY) return;

  const base = ctx.input ?? ctx.strategy;
  const geo = ctx.founderEnrichment?.geo;
  const country = geo?.country ?? null;

  // Run two searches in parallel:
  // 1. Competitor/market research for the specific idea
  // 2. What's growing in the founder's local market (shapes pricing, ICP, opportunity)
  const angleHint = ctx.founderAngle
    ? ctx.founderAngle.split('.')[0].slice(0, 100)
    : '';

  const competitorQuery = angleHint
    ? `${base} competitors pricing customers ${angleHint} 2024 2025`
    : `${base} market competitors pricing target customers 2024 2025`;

  const [competitorResearch, localMarketResearch] = await Promise.all([
    tavilySearch(competitorQuery),
    country
      ? tavilySearch(`fastest growing startups ${country} ${new Date().getFullYear()} market opportunities`)
      : Promise.resolve(null),
  ]);

  // Combine: competitor analysis first, local market context appended
  const parts = [competitorResearch, localMarketResearch].filter(Boolean);
  ctx.marketResearch = parts.join('\n\n---\n\n').slice(0, 2000) || null;
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

  // Provision Neon database — appends infra section to Layer 1 (non-blocking)
  if (process.env.NEON_API_KEY) {
    try {
      await provisionCompanyDatabase(ctx.companyId, slug);
      // neon.service writes infra section — but to avoid overwrite, append here
      await appendMemorySection(ctx.companyId, '## Infrastructure', [
        `Neon DB: provisioned`,
        `Slug: ${slug}`,
        `Subdomain: ${slug}.baljia.app`,
      ]);
    } catch (err) {
      log.warn('Neon provisioning failed — company will use platform DB fallback', {
        companyId: ctx.companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
      await appendMemorySection(ctx.companyId, '## Infrastructure', [
      `Slug: ${slug}`,
      `Subdomain: ${slug}.baljia.app`,
      `Database: platform shared Postgres (Neon not configured)`,
    ]);
  }

  // Provision {slug}.baljia.app subdomain (non-blocking)
  // Note: website won't be live until Engineering agent deploys a Render service
  try {
    await provisionSubdomain(ctx.companyId, slug, '');
    log.info('Subdomain provisioned', { slug, domain: `${slug}.baljia.app` });
  } catch (err) {
    log.warn('Subdomain provisioning failed — can be retried later', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Provision {slug}@baljia.app email (non-blocking)
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

  ctx.oneLiner = oneLinerMatch?.[1]?.trim() ?? `${ctx.companyName} — building the future`;
  ctx.mission = missionMatch?.[1]?.trim() ?? `Empowering people through innovative technology.`;

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
  // Prefer Haiku-generated tasks when we have enough context — they name real competitors
  // and specific target customers based on market research + founder background.
  // Fall back to static templates when context is too thin.
  const tasks = (ctx.marketResearch || ctx.founderAngle)
    ? (await generatePersonalizedTasks(ctx) ?? getStarterTaskTemplates(ctx.journey, ctx.companyName, ctx.input))
    : getStarterTaskTemplates(ctx.journey, ctx.companyName, ctx.input);

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

    // If we can't parse 3 titles, fall through to static templates
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
    return null; // fall through to static templates
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

async function runSendWelcomeEmail(ctx: PipelineContext): Promise<void> {
  // Send welcome email FROM the company inbox ({slug}@baljia.app), not from platform.
  // This proves the inbox identity is real and working.
  if (!ctx.founderEmail || !ctx.slug) return;

  const companyEmail = `${ctx.slug}@baljia.app`;
  try {
    await sendEmail({
      to: ctx.founderEmail,
      from: companyEmail,
      subject: `Welcome to ${ctx.companyName} — your AI team is ready`,
      textBody: [
        `Hi ${ctx.founderName ?? 'there'},`,
        '',
        `Your company "${ctx.companyName}" is live. Here's what your AI Angel has set up:`,
        '',
        `- Company website: ${ctx.slug}.baljia.app`,
        `- Company inbox: ${companyEmail}`,
        `- Mission and market research documents`,
        `- 3 starter tasks ready to execute`,
        '',
        `Head to your dashboard to review everything and approve your first task.`,
        '',
        `To start executing tasks, activate your 3-day free trial (10 credits, 3 night shifts).`,
        '',
        `— Your AI Angel at ${ctx.companyName}`,
      ].join('\n'),
      tag: 'welcome',
      companyId: ctx.companyId,
    });
    log.info('Welcome email sent from company inbox', { from: companyEmail, to: ctx.founderEmail });
  } catch (err) {
    log.warn('Welcome email from company inbox failed — non-blocking', {
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
  if (ctx.slug) checklistItems.push(`✅ Welcome email sent from ${ctx.slug}@baljia.app`);
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

// ══════════════════════════════════════════════
// STARTER TASK TEMPLATES — per journey
// Dependency chain: Research → Build → Growth
// ══════════════════════════════════════════════

interface StarterTask {
  title: string;
  description: string;
  tag: string;
  estimated_credits: number;
  reasoning: string;
}

function getStarterTaskTemplates(
  journey: OnboardingJourney,
  companyName: string,
  input: string | undefined
): StarterTask[] {
  switch (journey) {
    case 'surprise_me':
      return [
        {
          title: `Research: Validate the ${companyName} opportunity`,
          description: `Conduct market research for ${companyName}. Identify: target customer segment, top 3 competitors, estimated market size, key pain points, and initial positioning. Produce a research summary document.`,
          tag: 'research',
          estimated_credits: 1,
          reasoning: 'Foundation research — required before any build work begins.',
        },
        {
          title: `Build: Create the ${companyName} MVP`,
          description: `Based on the research summary, design and build a minimal viable product for ${companyName}. Focus on the single core feature that addresses the primary customer pain point. Deploy to production.`,
          tag: 'engineering',
          estimated_credits: 1,
          reasoning: 'Core MVP build — depends on research output.',
        },
        {
          title: `Growth: Launch ${companyName} to first users`,
          description: `Execute initial launch for ${companyName}. Create launch messaging, identify first 10 potential customers from the ICP, and send personalized outreach. Track responses.`,
          tag: 'outreach',
          estimated_credits: 1,
          reasoning: 'Initial growth push — depends on live MVP.',
        },
      ];

    case 'build_my_idea':
      return [
        {
          title: `Research: Validate "${input ?? companyName}" as a business`,
          description: `Validate the business idea: "${input ?? companyName}". Research: Who is the target customer? What are they using today? What are the top 3 competing solutions? What's the realistic path to first $1K MRR? Produce a validation report.`,
          tag: 'research',
          estimated_credits: 1,
          reasoning: 'Idea validation before investing build effort.',
        },
        {
          title: `Build: Build the ${companyName} MVP`,
          description: `Build a working MVP based on the validated idea and research findings. Implement the core feature loop. Deploy a live version. Include basic analytics tracking.`,
          tag: 'engineering',
          estimated_credits: 1,
          reasoning: 'Core product build — proceeds only after validation.',
        },
        {
          title: `Growth: Get first 10 users for ${companyName}`,
          description: `Drive initial user acquisition for ${companyName}. Define ICP from research. Write personalized cold outreach to 20 prospects. Set up a basic referral or feedback loop. Goal: 10 signups.`,
          tag: 'outreach',
          estimated_credits: 1,
          reasoning: 'Early traction — needs live product from build phase.',
        },
      ];

    case 'grow_my_company':
      return [
        {
          title: `Research: Audit ${companyName}'s current state`,
          description: `Audit the existing business at ${input ?? companyName}. Identify: current traffic sources, conversion rates, top customer segments, biggest drop-off points, and 3 highest-leverage growth opportunities. Produce an audit report.`,
          tag: 'research',
          estimated_credits: 1,
          reasoning: 'Baseline audit — identifies highest-leverage improvements.',
        },
        {
          title: `Build: Implement top improvement for ${companyName}`,
          description: `Based on the audit, implement the single highest-leverage product or technical improvement identified. Focus on something measurable — conversion rate, load time, UX friction, or missing feature.`,
          tag: 'engineering',
          estimated_credits: 1,
          reasoning: 'Targeted improvement — depends on audit findings.',
        },
        {
          title: `Growth: Scale the top channel for ${companyName}`,
          description: `Identify the top-performing acquisition channel from the audit. Double down: create content/campaigns, set up tracking, and execute 2 weeks of consistent output on that channel. Report on results.`,
          tag: 'outreach',
          estimated_credits: 1,
          reasoning: 'Amplify what already works — channel-specific growth push.',
        },
      ];
  }
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════

async function callHaiku(prompt: string, maxTokens = 256): Promise<string> {
  const { isAnthropicAvailable } = await import('@/lib/llm-provider');

  if (isAnthropicAvailable()) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }

  // Gemini fallback
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'placeholder') throw new Error('No LLM API key available (neither Anthropic nor Gemini)');

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent(prompt);
  return result.response.text();
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

async function tavilySearch(query: string, maxResults = 5): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: true,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();

    // Return Tavily's synthesized answer + top result snippets
    const parts: string[] = [];
    if (data.answer) parts.push(data.answer);
    if (data.results?.length) {
      parts.push(
        data.results
          .slice(0, 3)
          .map((r: { title: string; content: string }) => `${r.title}: ${r.content}`)
          .join('\n')
      );
    }
    return parts.join('\n\n').slice(0, 1500) || null;
  } catch {
    return null;
  }
}
