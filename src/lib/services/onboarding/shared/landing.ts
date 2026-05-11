// Landing page generator — single canonical 7-section format
// See docs/polsia-landing-studies.md + docs/polsia-unique-ideas.md for the
// research informing this shape (32 live competitor sites studied).
//
// Inputs (all we have at Day-0): companyName, mission (3-section), oneLiner,
//   market research JSON, founderAngle (Surprise only), idea, founder country.
// Geography rule: country is allowed ONCE as provenance ("Built in India") in the
//   closing or tagline. NEVER as market scope ("for Indian businesses"). City is
//   never used anywhere — too easily reads as local-market positioning.
// Never fabricate: testimonials, user counts, logos, phone numbers,
//   credentials, pricing. Page is credibly pre-launch.
//
// Per ADR-002 (split hosting): the rendered HTML is published via
// publishLandingToSubdomain → CF R2 (primary) or Render (legacy fallback).
// The HTML is NOT stored in the documents table — the deployed URL is the
// source of truth.
//
// CORPUS WIRING (this revision):
//   The design corpus (161 industries × 30 styles × 34 patterns × 73 typography
//   pairings) used to be reachable only via `resolveDesignTokens(...)` but the
//   renderer ignored everything except palette + font + density. Result: every
//   page came out as the same bordered-rectangles template.
//
//   Now:
//   1. Industry is classified once (deterministic match → tiny LLM fallback).
//   2. `resolveDesignTokens(industry)` returns palette + typography + matched
//      style + matched pattern + considerations + anti-patterns.
//   3. `style.designVars` (a string the corpus carries per UI style) is parsed
//      into concrete CSS custom properties (--radius, --shadow, --transition,
//      --border-width) and emitted into `:root`. The renderer's hardcoded
//      `border-radius: 10px` etc. is replaced with `var(--radius)`, so a
//      Brutalist match produces 0px-radius edges and a Claymorphism match
//      produces big rounded corners.
//   4. The pattern is mapped to ONE OF THREE template families
//      (editorial / utility-cards / narrative) and the renderer dispatches.
//      Same 7 canonical content sections, different visual structure.
//   5. Anti-patterns from the corpus are injected into the content prompt as
//      a "DO NOT" list, preventing generic AI-feel outputs.
//   6. Optional: a Haiku-tier "AI-feel" validator screens the hero headline
//      for hollow phrases ("modern", "streamlined", etc.) and regenerates
//      once if a violation is found.

import { createLogger } from '@/lib/logger';
import { sanitizeForFounder } from '@/lib/founder-safety/sanitize';
import {
  deployLandingPage,
  isLandingDeployConfigured,
  getLandingDeployTarget,
} from '@/lib/services/landing-deploy.service';
import { provisionWildcardSubdomain } from '@/lib/services/domain.service';
import { callSmallLLM } from '../llm/small-llm';
import { callSmallLLMJson } from './json-mode';
import { LandingContentSchema } from './schemas';
import { stripInlineMarkdown } from './founder-doc-style';
import { emitActivity } from '../stage-runner';
import {
  resolveDesignTokens,
  type ResolvedDesignTokens,
} from './landing-design-tokens';
import { ANTI_PATTERNS, INDUSTRY_RULES, UI_STYLES } from './landing-design-corpus';
import {
  utilityCardsV2Styles, utilityCardsV2Body,
  editorialV2Styles, editorialV2Body,
  narrativeV2Styles, narrativeV2Body,
} from './landing-renderer-v2';
import {
  narrativeStackedV2Styles, narrativeStackedV2Body,
  magazineGridV2Styles, magazineGridV2Body,
  comparisonLedV2Styles, comparisonLedV2Body,
} from './landing-renderer-v2-extras';
import type { PipelineContext, MarketResearchResult } from '../types';

const log = createLogger('OnboardingLanding');

// ──────────────────────────────────────────────────────────────────────────
// JSON schema the LLM returns (7 content sections — design intent comes from
// the corpus, not from the LLM)
// ──────────────────────────────────────────────────────────────────────────

interface LandingContent {
  brand: { name: string; tagline: string };
  hero: { headline: string; subhead: string };
  what_it_does: {
    heading: string;
    capabilities: Array<{ title: string; description: string }>;
  };
  how_it_works: {
    heading: string;
    steps: Array<{ number: number; title: string; description: string }>;
  };
  what_makes_different: { heading: string; points: string[] };
  closing: { headline: string; body: string };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers — extract market facts to feed into the content prompt
// ──────────────────────────────────────────────────────────────────────────

interface MarketFacts {
  competitors: Array<{ name: string; gap: string }>;
  demandSignals: string[];
  marketStats: string[];
  topCompetitor: string | null;
}

function extractMarkdownBullets(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim())
    .filter(Boolean);
}

function looksLikeStat(value: string): boolean {
  return /(?:\d|%|\$|rs\.?|inr|million|billion|trillion|crore|lakh|projected|spend|market|growth)/i.test(value);
}

function extractMarketFacts(mr: MarketResearchResult | undefined): MarketFacts {
  if (!mr) {
    return { competitors: [], demandSignals: [], marketStats: [], topCompetitor: null };
  }
  const anyMr = mr as unknown as Record<string, unknown>;
  const rawCompetitors = Array.isArray(anyMr.competitors) ? anyMr.competitors as Array<Record<string, unknown>> : [];
  const competitors = rawCompetitors.slice(0, 3).map((c) => ({
    name: String(c.name ?? ''),
    gap: String(c.gap ?? ''),
  })).filter((c) => c.name);

  const topCompetitor = competitors[0]?.name ?? null;

  const marketValidation = anyMr.market_validation;
  const demandRaw = (anyMr.demand_signals ?? (marketValidation as Record<string, unknown> | undefined)?.demand_signals) as string[] | undefined;
  const whyNowRaw = (marketValidation as Record<string, unknown> | undefined)?.why_now as string[] | undefined;
  const validationBullets = extractMarkdownBullets(marketValidation);
  const demandSignals = [...(demandRaw ?? []), ...(whyNowRaw ?? []), ...validationBullets].slice(0, 4);

  const sizeRaw = (anyMr.market_size ?? (marketValidation as Record<string, unknown> | undefined)?.size_and_growth) as Array<Record<string, unknown> | string> | undefined;
  const marketStats = [
    ...(sizeRaw ?? []).map((s) => {
      if (typeof s === 'string') return s;
      return String(s.stat ?? '');
    }),
    ...validationBullets.filter(looksLikeStat),
  ].filter(Boolean).slice(0, 3);

  return { competitors, demandSignals, marketStats, topCompetitor };
}

// ──────────────────────────────────────────────────────────────────────────
// Industry inference — deterministic match first, tiny LLM fallback only when
// the corpus can't ground the input. Cheaper and more reliable than asking the
// content LLM to also pick palette/font/density enums.
// ──────────────────────────────────────────────────────────────────────────

function gatherIndustrySignals(ctx: PipelineContext): string {
  const parts: string[] = [];
  if (ctx.businessProfile?.business_name) parts.push(ctx.businessProfile.business_name);
  if (ctx.businessProfile?.description) parts.push(ctx.businessProfile.description);
  if (ctx.businessProfile?.target_customer) parts.push(ctx.businessProfile.target_customer);
  if (ctx.businessProfile?.revenue_model) parts.push(ctx.businessProfile.revenue_model);
  if (ctx.refinedIdea?.refined_idea) parts.push(ctx.refinedIdea.refined_idea);
  if (ctx.inventedIdea?.invented_idea) parts.push(ctx.inventedIdea.invented_idea);
  if (ctx.oneLiner) parts.push(ctx.oneLiner);
  if (ctx.mission) parts.push(ctx.mission);
  if (ctx.input) parts.push(ctx.input);
  if (ctx.companyName) parts.push(ctx.companyName);
  return parts.join(' \n ');
}

// Quick-and-cheap deterministic check: does any industry-rule keyword or
// industry-name token appear verbatim in the gathered signals? Avoids any
// LLM call when the answer is obvious (e.g. "dental clinic" → dental_practice).
function deterministicIndustryMatch(signals: string): string | null {
  const lower = signals.toLowerCase();
  let bestId: string | null = null;
  let bestScore = 0;
  for (const rule of INDUSTRY_RULES) {
    let score = 0;
    if (lower.includes(rule.name.toLowerCase())) score += 10;
    for (const kw of rule.keywords) {
      const k = kw.toLowerCase();
      if (k.length < 3) continue;
      if (new RegExp(`\\b${k.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i').test(lower)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = rule.id;
    }
  }
  // Require a moderately strong match — otherwise let the LLM classifier try.
  return bestScore >= 4 ? bestId : null;
}

async function classifyIndustryWithLLM(signals: string): Promise<string | null> {
  // Send the model a compact list of industry NAMES (one per line) and ask it
  // to return one. ~50 token output, cheap.
  const names = INDUSTRY_RULES.map((r) => r.name).join('\n');
  const prompt = `Pick the single most appropriate industry from the list below for the business described.

Business description:
${signals.slice(0, 1200)}

Industry list (return EXACTLY one name from this list, with no other text — just the name):
${names}`;
  try {
    const response = (await callSmallLLM(prompt, 60)).trim();
    // Match exact name first, then case-insensitive contains.
    const exact = INDUSTRY_RULES.find((r) => r.name === response);
    if (exact) return exact.id;
    const ci = INDUSTRY_RULES.find((r) => r.name.toLowerCase() === response.toLowerCase());
    if (ci) return ci.id;
    const partial = INDUSTRY_RULES.find((r) => response.toLowerCase().includes(r.name.toLowerCase()));
    if (partial) return partial.id;
    return null;
  } catch (err) {
    log.warn('Industry classifier LLM failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function inferIndustry(ctx: PipelineContext): Promise<string> {
  const signals = gatherIndustrySignals(ctx);
  const det = deterministicIndustryMatch(signals);
  if (det) {
    log.info('Industry inferred deterministically', { companyId: ctx.companyId, industryId: det });
    return det;
  }
  const llm = await classifyIndustryWithLLM(signals);
  if (llm) {
    log.info('Industry inferred via LLM', { companyId: ctx.companyId, industryId: llm });
    return llm;
  }
  // Fall through: pass the raw signals to resolveDesignTokens which scores
  // tokens and ultimately defaults to saas_general if nothing matches.
  return signals.slice(0, 200);
}

// ──────────────────────────────────────────────────────────────────────────
// Style designVars parsing — the corpus stores per-style design vars as a
// loose comma-separated string ("--border-radius: 0px, --shadow: none, ...").
// We extract the keys we actually consume in CSS and ignore the rest.
// ──────────────────────────────────────────────────────────────────────────

interface StyleVars {
  radius: string;       // border-radius for cards/buttons
  shadow: string;       // box-shadow for cards
  transition: string;   // hover/focus transition
  borderWidth: string;  // border thickness
}

export function parseStyleVars(designVarsStr: string | undefined, styleName: string | null): StyleVars {
  // Generic defaults — fall back when neither designVars nor a style-name
  // backstop is available. Match the original renderer (subtle, modern).
  const defaults: StyleVars = {
    radius: '10px',
    shadow: '0 1px 2px rgba(0,0,0,0.04)',
    transition: '0.15s ease',
    borderWidth: '1px',
  };

  // Style-name-driven backstops for the common style families. The corpus's
  // designVars strings are descriptive (often with non-CSS values like
  // "vibrant color"), so a name-based backstop is the most reliable way to
  // make each style visually distinct. We layer designVars overrides ON TOP
  // of the backstop, not over plain defaults.
  const base: StyleVars = { ...defaults, ...(styleBackstop(styleName) ?? {}) };
  if (!designVarsStr) return base;

  const out: StyleVars = { ...base };
  const lower = designVarsStr.toLowerCase();

  // Border radius — pull first explicit px value from a "--border-radius:" or "--radius:" assignment
  const radiusMatch = lower.match(/--(?:border-)?radius[^:]*:\s*([0-9]{1,3})\s*(?:px|rem)?/);
  if (radiusMatch) {
    out.radius = `${radiusMatch[1]}px`;
  } else if (/no\s*radius|radius:\s*0/.test(lower)) {
    out.radius = '0px';
  }

  // Shadow — common spellings: --shadow:, --shadow-soft, --box-shadow
  if (/shadow[^:]*:\s*none/.test(lower) || /no\s*shadow/.test(lower)) {
    out.shadow = 'none';
  } else if (/inset/.test(lower) && /shadow/.test(lower)) {
    out.shadow = 'inset 0 2px 6px rgba(0,0,0,0.06), 0 6px 14px rgba(0,0,0,0.08)';
  } else if (/shadow-(?:layer|soft|outer|elev)|box-shadow|deep-shadow/.test(lower)) {
    out.shadow = '0 8px 24px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.05)';
  }

  // Transition / animation duration
  const durMatch = lower.match(/--(?:transition-?duration|animation-duration|transition)[^:]*:\s*([0-9]{1,4})\s*(ms|s)?/);
  if (durMatch) {
    const n = parseInt(durMatch[1], 10);
    const ms = durMatch[2] === 's' ? n * 1000 : n;
    out.transition = ms === 0 ? '0s' : `${ms}ms cubic-bezier(.4,.0,.2,1)`;
  } else if (/transition[^:]*:\s*0s/.test(lower)) {
    out.transition = '0s';
  }

  // Border width — useful for Brutalism / Claymorphism (thick borders)
  const bwMatch = lower.match(/--(?:border-)?width[^:]*:\s*([0-9])/);
  if (bwMatch) out.borderWidth = `${bwMatch[1]}px`;

  // Distinctive styles need their defining traits to win over partial parses.
  // Brutalism's signature is sharp corners + zero transitions; if the parsed
  // string somehow wandered to softer values, restore the backstop on those
  // specific dimensions.
  const overrides = stylePriorityOverrides(styleName);
  return { ...out, ...overrides };
}

function styleBackstop(styleName: string | null): StyleVars | null {
  if (!styleName) return null;
  const n = styleName.toLowerCase();
  if (n.includes('brutalism') || n.includes('brutalist')) {
    return { radius: '0px', shadow: '6px 6px 0 0 #0f172a', transition: '0s', borderWidth: '2px' };
  }
  if (n.includes('neumorphism') || n.includes('soft ui')) {
    return { radius: '14px', shadow: '8px 8px 16px rgba(174,174,192,0.4), -8px -8px 16px rgba(255,255,255,0.7)', transition: '200ms ease', borderWidth: '1px' };
  }
  if (n.includes('glassmorphism') || n.includes('liquid glass')) {
    return { radius: '16px', shadow: '0 10px 30px rgba(15,23,42,0.12)', transition: '300ms ease', borderWidth: '1px' };
  }
  if (n.includes('claymorphism') || n.includes('clay')) {
    return { radius: '22px', shadow: 'inset 0 -4px 0 rgba(0,0,0,0.06), 0 8px 16px rgba(0,0,0,0.10)', transition: '220ms cubic-bezier(.4,.0,.2,1)', borderWidth: '3px' };
  }
  if (n.includes('flat')) {
    return { radius: '4px', shadow: 'none', transition: '150ms ease', borderWidth: '1px' };
  }
  if (n.includes('minimal') || n.includes('swiss')) {
    return { radius: '0px', shadow: 'none', transition: '120ms ease', borderWidth: '1px' };
  }
  if (n.includes('motion') || n.includes('aurora')) {
    return { radius: '12px', shadow: '0 12px 40px rgba(15,23,42,0.10)', transition: '350ms cubic-bezier(.4,.0,.2,1)', borderWidth: '1px' };
  }
  if (n.includes('vibrant') || n.includes('block')) {
    return { radius: '8px', shadow: '4px 4px 0 0 currentColor', transition: '180ms ease', borderWidth: '2px' };
  }
  if (n.includes('hyperreal') || n.includes('skeu')) {
    return { radius: '12px', shadow: '0 16px 40px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.5)', transition: '300ms ease', borderWidth: '1px' };
  }
  if (n.includes('retro') || n.includes('cyber')) {
    return { radius: '2px', shadow: '0 0 0 2px currentColor, 0 0 12px rgba(0,200,255,0.25)', transition: '120ms steps(2)', borderWidth: '2px' };
  }
  return null;
}

// Distinctive styles take priority on the dimensions that DEFINE them.
// Returns hardcoded values rather than reading from a backstop so the
// override is unmistakable in the rendered CSS.
function stylePriorityOverrides(styleName: string | null): Partial<StyleVars> {
  const n = (styleName ?? '').toLowerCase();
  if (n.includes('brutalism') || n.includes('brutalist')) {
    return { radius: '0px', transition: '0s', shadow: '6px 6px 0 0 #0f172a', borderWidth: '2px' };
  }
  if (n.includes('claymorphism') || n.includes('clay')) {
    return { radius: '22px', shadow: 'inset 0 -4px 0 rgba(0,0,0,0.06), 0 8px 16px rgba(0,0,0,0.10)', borderWidth: '3px' };
  }
  if (n.includes('flat')) {
    return { shadow: 'none' };
  }
  if (n.includes('minimal') && n.includes('swiss')) {
    return { radius: '0px', shadow: 'none' };
  }
  return {};
}

// ──────────────────────────────────────────────────────────────────────────
// Family selection — pattern.name → 'editorial' | 'utility-cards' | 'narrative'
//                                  | 'narrative-stacked' | 'magazine-grid'
//                                  | 'comparison-led'
//
// 5 families now. The base 3 (editorial / utility-cards / narrative) cover
// most generic shapes; the 3 new families (-stacked / magazine-grid /
// comparison-led) cover specific corpus patterns whose UX is meaningfully
// different from a card-grid layout. All 34 patterns are explicitly mapped.
// ──────────────────────────────────────────────────────────────────────────

type Family =
  | 'editorial'
  | 'utility-cards'
  | 'narrative'
  | 'narrative-stacked'
  | 'magazine-grid'
  | 'comparison-led';

// Explicit pattern → family table. Strings here MUST match the corpus
// LandingPattern.name strings verbatim (case-insensitive comparison).
const PATTERN_FAMILY_MAP: Record<string, Family> = {
  // narrative-stacked — type-led, story-driven, no card chrome
  'scroll-triggered storytelling': 'narrative-stacked',
  'before-after transformation': 'narrative-stacked',
  'horizontal scroll journey': 'narrative-stacked',
  'community/forum landing': 'narrative-stacked',

  // magazine-grid — asymmetric editorial layout with serif display
  'portfolio grid': 'magazine-grid',
  'bento grid showcase': 'magazine-grid',
  'hero + testimonials + cta': 'magazine-grid',
  'product review/ratings focused': 'magazine-grid',
  'video-first hero': 'magazine-grid',
  'event/conference landing': 'magazine-grid',

  // comparison-led — table/matrix-driven, utility-rich
  'comparison table + cta': 'comparison-led',
  'comparison table focus': 'comparison-led',
  'pricing page + cta': 'comparison-led',
  'pricing-focused landing': 'comparison-led',
  'faq/documentation landing': 'comparison-led',
  'real-time / operations landing': 'comparison-led',

  // editorial — minimal, single-column, large type
  'minimal single column': 'editorial',
  'newsletter / content first': 'editorial',
  'enterprise gateway': 'editorial',
  'trust & authority + conversion': 'editorial',
  'hero-centric design': 'editorial',
  'waitlist/coming soon': 'editorial',
  'lead magnet + form': 'editorial',

  // utility-cards — feature-rich showcase, demos, app/marketplace, AI dynamic
  'hero + features + cta': 'utility-cards',
  'feature-rich showcase': 'utility-cards',
  'product demo + features': 'utility-cards',
  'funnel (3-step conversion)': 'utility-cards',
  'app store style landing': 'utility-cards',
  'marketplace / directory': 'utility-cards',
  'webinar registration': 'utility-cards',
  'interactive 3d configurator': 'utility-cards',
  'immersive/interactive experience': 'utility-cards',
  'ai personalization landing': 'utility-cards',
  'ai-driven dynamic landing': 'utility-cards',
};

export function familyForPattern(patternName: string): Family {
  const n = patternName.toLowerCase().trim();
  const direct = PATTERN_FAMILY_MAP[n];
  if (direct) return direct;
  // Loose substring fallback — handles drift between corpus rows and the
  // explicit map above. Order matters: most-specific first.
  if (/(storytelling|scroll|journey|before-?after|transformation|community|forum|manifesto|founder letter|long-?form)/.test(n)) return 'narrative-stacked';
  if (/(magazine|editorial layout|trust & authority|social-?proof|lifestyle|portfolio grid|bento|video-?first|event)/.test(n)) return 'magazine-grid';
  if (/(comparison|pricing|matrix|benchmark|tool-?forward|utility-?first|faq|operations|real-?time)/.test(n)) return 'comparison-led';
  if (/(minimal|hero-?centric|single column|enterprise gateway|trust|newsletter|content first|waitlist|lead magnet)/.test(n)) return 'editorial';
  if (/(narrative|content)/.test(n)) return 'narrative';
  return 'utility-cards';
}

// ──────────────────────────────────────────────────────────────────────────
// Anti-patterns — pulled from the corpus per industry, fed into the prompt
// ──────────────────────────────────────────────────────────────────────────

function antiPatternsForIndustry(industryId: string): string[] {
  const fromTable = ANTI_PATTERNS
    .filter((a) => a.industryId === industryId)
    .map((a) => a.avoid);
  const fromRule = INDUSTRY_RULES.find((r) => r.id === industryId)?.antiPatterns ?? [];
  return Array.from(new Set([...fromTable, ...fromRule]));
}

// ──────────────────────────────────────────────────────────────────────────
// Prompt — produces the 7-section content JSON. Design tokens come from the
// corpus (NOT the LLM) so the prompt stays focused on copy.
// ──────────────────────────────────────────────────────────────────────────

function buildLandingPrompt(ctx: PipelineContext, facts: MarketFacts, industryRow: { name: string; considerations: string }, antiPatterns: string[]): string {
  const md = ctx.missionDoc;
  const mission = md?.mission ?? ctx.mission ?? '';
  const whatWereBuilding = md?.what_were_building ?? '';
  const whereWereHeaded = md?.where_were_headed ?? '';

  const idea =
    ctx.refinedIdea?.refined_idea
    ?? ctx.inventedIdea?.invented_idea
    ?? ctx.businessProfile?.description
    ?? ctx.input
    ?? '';

  const country = ctx.founderEnrichment?.geo?.country ?? null;

  const competitorBlock = facts.competitors.length
    ? `Named competitors (from market research — use these, do NOT invent new ones):
${facts.competitors.map((c) => `  - ${c.name}: gap — ${c.gap}`).join('\n')}`
    : 'No named competitors surfaced in market research. Skip competitor-specific framing.';

  const demandBlock = facts.demandSignals.length
    ? `Demand signals / why-now evidence:\n${facts.demandSignals.map((s) => `  - ${s}`).join('\n')}`
    : 'No demand signals in research. Describe the problem honestly without inventing statistics.';

  const statsBlock = facts.marketStats.length
    ? `Market stats you may reference (do NOT invent new numbers):\n${facts.marketStats.map((s) => `  - ${s}`).join('\n')}`
    : '';

  const antiBlock = antiPatterns.length
    ? `INDUSTRY ANTI-PATTERNS (do NOT echo these vibes in your copy — they read as generic AI output for this industry):
${antiPatterns.map((a) => `  - ${a}`).join('\n')}`
    : '';

  const onboardingBriefBlock = ctx.onboardingBrief
    ? `CANONICAL ONBOARDING BRIEF:
${JSON.stringify(ctx.onboardingBrief, null, 2)}`
    : '';

  return `You are generating the Day-0 landing page CONTENT for ${ctx.companyName}, a business in PRE-LAUNCH / early-access state.

INDUSTRY CLASSIFICATION (assigned by the system, NOT for you to override): ${industryRow.name}
Industry-specific considerations: ${industryRow.considerations}

WHAT YOU HAVE
${onboardingBriefBlock}
- Mission: ${mission}
${whatWereBuilding ? `- What we're building: ${whatWereBuilding}` : ''}
${whereWereHeaded ? `- Where we're headed: ${whereWereHeaded}` : ''}
- Company one-liner: ${ctx.oneLiner}
- Idea / business: ${idea.slice(0, 800)}
${ctx.founderAngle ? `- Founder positioning: ${ctx.founderAngle.slice(0, 200)}` : ''}
${country ? `- Founder country: ${country} (provenance signal only — see GEOGRAPHY rule below)` : ''}

GEOGRAPHY (strict — distinguish provenance from market scope)
${country
    ? `- Country "${country}" may appear EXACTLY ONCE in closing.body OR brand.tagline as a provenance signal. Optional - omit if it does not fit.
- NEVER use the country in hero, what_it_does, how_it_works, what_makes_different. Product is GLOBAL.
- BANNED: "${country}'s leading X", "for ${country} businesses", "Built specifically for ${country}".`
    : '- Founder country unknown. Do NOT mention any country, city, or region.'}
- City: NEVER mention any city anywhere on the page.

MARKET CONTEXT
${competitorBlock}

${demandBlock}

${statsBlock}
${antiBlock}

WHAT YOU DO NOT HAVE (DO NOT FABRICATE — each violation is a hard failure)
- Founder name, photo, bio, credentials → no "meet the founder" section
- Phone number, address, hours → no contact block
- Testimonials, reviews, star ratings, user counts, press mentions, "as seen in" logos
- Real product screenshots, photos, before/after images
- Pricing numbers, launch date, funding amount

The page is CREDIBLY PRE-LAUNCH. Omit unavailable proof instead of filling gaps.

This page is INFORMATIONAL only — NO call-to-action button, NO email capture, NO waitlist.

OUTPUT - return one JSON object with exactly these top-level keys:
- brand
- hero
- what_it_does
- how_it_works
- what_makes_different
- closing

Field rules:
- brand.name: string. Must exactly match "${ctx.companyName}".
- brand.tagline: string, 6-10 words. A single punchy descriptor of what the company is; not a feature list.
- hero.headline: string, 8 words or fewer. Derive from mission.mission. Specific and concrete. Do not use sleep/runs-itself phrasing or generic AI/startup phrasing.
- hero.subhead: string, 2 sentences, 20-35 words total. Sentence 1 says what this is and who it is for. Sentence 2 says why it matters. Do not use a three-verb AI-agent formula.
- what_it_does.heading: string. Must be "What it does" or a short variant with 4 words or fewer.
- what_it_does.capabilities: array with exactly 3 objects. Each object needs title and description strings. Title is 3-4 words. Description is 1-2 sentences and must describe a concrete capability.
- how_it_works.heading: string. Must be "How it works" or a short variant.
- how_it_works.steps: array with exactly 3 objects. Each object needs number, title, and description. Number must be 1, 2, then 3. Title is 3-5 words. Description is one concrete action sentence.
- what_makes_different.heading: string. Must be "What makes this different" or a short variant.
- what_makes_different.points: array with exactly 3 strings. Each string is one line grounded in a competitor gap, market fact, or positioning choice.
- closing.headline: string. One aspirational but grounded sentence derived from mission.where_were_headed.
- closing.body: string. 1-2 standalone sentences. Do not reference a CTA, sign-up, waitlist, or "join us".

what_it_does.capabilities MUST have exactly 3 items.
what_it_does.heading MUST be "What it does" (or a short variant ≤4 words).
how_it_works.steps MUST have exactly 3 items.
what_makes_different.points MUST have exactly 3 items.

HARD RULES (violations fail the generation)
- Never invent testimonials, user counts, ratings, credentials, logos, press, phone numbers.
- Never write "© 2026" or any year — the renderer injects it.
- Never use emoji — the renderer handles all visual chrome.
- Banned phrases (mark of generic AI output): world-class, best-in-class, cutting-edge, next-generation, revolutionize, empower, leverage (as verb), synergize, modern, streamlined, intelligent, innovative, transform your life, unlock your potential, shared context, accelerate.`;
}

// ──────────────────────────────────────────────────────────────────────────
// AI-feel hero validator — cheap one-shot screen for hollow phrasing
// ──────────────────────────────────────────────────────────────────────────

function buildGrowLandingPrompt(ctx: PipelineContext, facts: MarketFacts, industryRow: { name: string; considerations: string }, antiPatterns: string[]): string {
  const profile = ctx.businessProfile;
  const md = ctx.missionDoc;
  const mission = md?.mission ?? ctx.mission ?? '';
  const whatWereBuilding = md?.what_were_building ?? '';
  const whereWereHeaded = md?.where_were_headed ?? '';
  const mr = ctx.marketResearchJson as Record<string, unknown> | undefined;

  const validation = profile?.existing_validation || (mr?.notable_validation as string | undefined) || null;
  const advantages = Array.isArray(mr?.competitive_advantages) ? mr.competitive_advantages as string[] : [];
  const gaps = Array.isArray(mr?.gaps_to_exploit) ? mr.gaps_to_exploit as string[] : [];
  const aiLevers = Array.isArray(mr?.ai_leverage_points) ? mr.ai_leverage_points as string[] : [];
  const competitorBlock = facts.competitors.length
    ? `Named competitors or alternatives from research:
${facts.competitors.map((c) => `  - ${c.name}: gap - ${c.gap}`).join('\n')}`
    : 'No named competitors surfaced in market research. Use category positioning, not invented competitors.';

  const marketStatsBlock = facts.marketStats.length
    ? `Market stats you may reference if useful (do not invent new numbers):
${facts.marketStats.map((s) => `  - ${s}`).join('\n')}`
    : 'No market stats available. Do not invent numbers.';

  const advantagesBlock = advantages.length
    ? `Business advantages to use:
${advantages.slice(0, 5).map((a) => `  - ${a}`).join('\n')}`
    : 'No explicit advantages available. Infer carefully only from the website and research.';

  const gapsBlock = gaps.length
    ? `Growth gaps/opportunities to reflect:
${gaps.slice(0, 5).map((g) => `  - ${g}`).join('\n')}`
    : 'No explicit growth gaps available.';

  const aiBlock = aiLevers.length
    ? `AI/automation levers to mention only if they fit the business:
${aiLevers.slice(0, 4).map((p) => `  - ${p}`).join('\n')}`
    : '';

  const antiBlock = antiPatterns.length
    ? `INDUSTRY ANTI-PATTERNS (do NOT echo these vibes in your copy):
${antiPatterns.map((a) => `  - ${a}`).join('\n')}`
    : '';

  return `You are generating a public growth landing page for ${ctx.companyName}, an EXISTING business.

This is not a new startup launch page. It should feel like a sharper public website or focused offer page for the current business.

INDUSTRY CLASSIFICATION (assigned by the system, not for you to override): ${industryRow.name}
Industry-specific considerations: ${industryRow.considerations}

SOURCE OF TRUTH - EXISTING BUSINESS
- Business name: ${profile?.business_name ?? ctx.companyName}
- Submitted URL: ${ctx.input ?? '(none)'}
- Description: ${profile?.description ?? '(unavailable)'}
- Revenue model: ${profile?.revenue_model ?? 'unclear'}
- Target customer: ${profile?.target_customer ?? 'unclear'}
- Business type: ${profile?.business_type ?? 'unclear'}
- Services/products: ${(profile?.services_or_products ?? []).join(', ') || 'unclear'}
- Location/market: ${profile?.location_or_market ?? 'unclear'}
- Visible offer: ${profile?.visible_offer ?? 'unclear'}
- Main CTA: ${profile?.main_cta ?? 'unclear'}
- Visible validation: ${validation ?? 'none visible'}
- Proof signals: ${(profile?.proof_signals ?? []).join(', ') || 'none visible'}
- Website title: ${profile?.extracted_metadata.title ?? '(none)'}
- Website meta: ${profile?.extracted_metadata.meta ?? '(none)'}
- Website excerpt: ${(profile?.extracted_metadata.body ?? '').slice(0, 1400) || '(none)'}

MISSION CONTEXT
- Mission: ${mission}
${whatWereBuilding ? `- What we're building / providing: ${whatWereBuilding}` : ''}
${whereWereHeaded ? `- Where we're headed: ${whereWereHeaded}` : ''}
- Company one-liner: ${ctx.oneLiner}

MARKET CONTEXT
${competitorBlock}

${marketStatsBlock}

${advantagesBlock}

${gapsBlock}

${aiBlock}
${antiBlock}

HOW THIS PAGE SHOULD THINK
- Preserve the existing company identity. Do not rename it or turn it into an "OS", "AI platform", or new SaaS unless the website clearly says that.
- Write for a real prospect who could buy from this business now.
- Use the actual services/products and audience from the website.
- If this is a service business, the page should sell the service offer: outcomes, core services, client process, proof, and why choose them.
- If this is a product business, the page should explain the product workflow, outcome, proof, and buyer fit.
- It may mention the business's real local market only if the website/research supports it. Do not use founder location as market scope.
- Do not make it pre-launch. Do not say early access, waitlist, built by Baljia, or no sign-up required.
- Do not invent testimonials, reviews, logos, addresses, phone numbers, prices, awards, clients, or guarantees.
- Verified validation can be used carefully when it appears above.

OUTPUT - return one JSON object with exactly these top-level keys:
- brand
- hero
- what_it_does
- how_it_works
- what_makes_different
- closing

Field rules:
- brand.name: string. Must exactly match "${ctx.companyName}".
- brand.tagline: string, 6-10 words. Service or product positioning for the existing business.
- hero.headline: string, 8-10 words. A concrete buyer outcome or promise grounded in mission and business profile; no generic AI/startup phrasing.
- hero.subhead: string, 2 sentences, 24-40 words total. Sentence 1 says what this business does and for whom. Sentence 2 says why buyers should trust or pay attention.
- what_it_does.heading: string. Short heading appropriate to the business services or product.
- what_it_does.capabilities: array with exactly 3 objects. Each object needs title and description strings. Title is 3-5 words. Description is 1-2 concrete sentences about a real service or product capability.
- how_it_works.heading: string. Short heading describing how clients or users work with the business.
- how_it_works.steps: array with exactly 3 objects. Each object needs number, title, and description. Number must be 1, 2, then 3. Title is 3-5 words. Description is one concrete client or product step.
- what_makes_different.heading: string. Short heading about proof, positioning, or why buyers choose this business.
- what_makes_different.points: array with exactly 3 strings. Each string is one line grounded in proof, positioning edge, service model, product capability, or competitor gap.
- closing.headline: string. One direct closing sentence for a buyer. No grandiose language.
- closing.body: string. 1-2 sentences. It may suggest a sensible next step only when supported by the business context, but must not invent a form, button, or contact detail.

what_it_does.capabilities MUST have exactly 3 items.
how_it_works.steps MUST have exactly 3 items.
what_makes_different.points MUST have exactly 3 items.

HARD RULES
- Existing business page, not startup invention.
- Never invent testimonials, user counts, ratings, credentials, logos, press, phone numbers, addresses, pricing, or guarantees.
- Never write a year; the renderer injects it.
- Never use emoji; the renderer handles visual chrome.
- Banned phrases: world-class, best-in-class, cutting-edge, next-generation, revolutionize, empower, leverage as a verb, synergize, modern, streamlined, intelligent, innovative, transform your life, unlock your potential, shared context, accelerate.`;
}

const HOLLOW_PHRASES = [
  'modern', 'streamlined', 'intelligent', 'innovative', 'next-generation',
  'leverage', 'accelerate', 'transform', 'empower', 'shared context',
  'cutting-edge', 'world-class', 'best-in-class', 'revolutionize',
];

function heroLooksHollow(headline: string): { hollow: boolean; phrase: string | null } {
  const lower = headline.toLowerCase();
  for (const p of HOLLOW_PHRASES) {
    if (new RegExp(`\\b${p}\\b`, 'i').test(lower)) {
      return { hollow: true, phrase: p };
    }
  }
  return { hollow: false, phrase: null };
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer — three template families, all consuming the same 7-section
// content shape. CSS variables let palette + typography + style designVars
// vary while the structural HTML per family stays consistent.
// ──────────────────────────────────────────────────────────────────────────

const esc = (s: string): string => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function renderRootStyles(tokens: ResolvedDesignTokens, vars: StyleVars): string {
  const d = tokens.density;
  return `:root {
  --accent: ${tokens.accent};
  --accent-soft: ${tokens.accentSoft};
  --accent-strong: ${tokens.accentStrong};
  --ink: ${tokens.ink};
  --ink-soft: ${tokens.inkSoft};
  --bg: ${tokens.bg};
  --bg-elev: ${tokens.bgElev};
  --line: ${tokens.line};
  --font-heading: ${tokens.headingStack};
  --font-body: ${tokens.bodyStack};
  --heading-tt: ${tokens.headingTransform};
  --heading-ls: ${tokens.headingLetterSpacing};
  --heading-w: ${tokens.headingWeight};
  --section-py: ${d.sectionPaddingY};
  --hero-py: ${d.heroPaddingY};
  --card-p: ${d.cardPadding};
  --card-gap: ${d.cardGap};
  --container-px: ${d.containerPaddingX};
  --radius: ${vars.radius};
  --shadow: ${vars.shadow};
  --transition: ${vars.transition};
  --border-w: ${vars.borderWidth};
}
@media (prefers-color-scheme: dark) {
  :root {
    --accent: ${tokens.darkAccent};
    --accent-soft: ${tokens.darkAccentSoft};
    --ink: ${tokens.darkInk};
    --ink-soft: ${tokens.darkInkSoft};
    --bg: ${tokens.darkBg};
    --bg-elev: ${tokens.darkBgElev};
    --line: ${tokens.darkLine};
  }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}`;
}

function renderBaseStyles(): string {
  return `* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--font-body);
  color: var(--ink);
  background: var(--bg);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.heading {
  font-family: var(--font-heading);
  font-weight: var(--heading-w);
  letter-spacing: var(--heading-ls);
  text-transform: var(--heading-tt);
  margin: 0;
}
.brand { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-size: 22px; font-weight: var(--heading-w); }
.brand-tag { font-size: 14px; color: var(--ink-soft); margin-top: 4px; }
section h2, .closing h2 {
  font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls);
  font-weight: var(--heading-w);
}
footer {
  padding: 32px 0 48px; font-size: 13px; color: var(--ink-soft);
  border-top: var(--border-w) solid var(--line);
  display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px;
}
footer a { color: var(--ink-soft); text-decoration: none; border-bottom: var(--border-w) solid transparent; }
footer a:hover { color: var(--accent); border-bottom-color: var(--accent); }`;
}

function renderUtilityCards(content: LandingContent, year: number): { styles: string; body: string } {
  // 2026-04-29: delegated to v2 renderer (landing-renderer-v2.ts).
  // Removes uniform borders, larger hero type, accent-edge cards, oversized
  // step numerals, dash-prefixed differentiators, accent-band closing.
  // Original boxy implementation preserved in git history (commit before
  // the v2 wiring) if rollback ever needed.
  return { styles: utilityCardsV2Styles(), body: utilityCardsV2Body(content, year, esc) };
}

// Editorial: minimal, single-column, large typography. v2: removes
// section borders, uses thin accent-bar dividers, oversized hero, numbered
// capabilities as full-width blocks (not cards), pull-quote differentiators.
function renderEditorial(content: LandingContent, year: number): { styles: string; body: string } {
  // Delegated to v2 renderer (2026-04-29).
  return { styles: editorialV2Styles(), body: editorialV2Body(content, year, esc) };
}

// Narrative: how_it_works comes BEFORE what_it_does (problem-journey-solution
// arc), each section is a chapter-like block with accent-coloured chapter
// numbers, capabilities are paragraphs not cards, differentiators close it.
function renderNarrative(content: LandingContent, year: number): { styles: string; body: string } {
  // Delegated to v2 renderer (2026-04-29). v2: alternating full-bleed
  // chapter bands (regular/accent-soft), dark "how it works" band with
  // 3-up grid, italic pull-quote differentiators on accent-soft band,
  // accent-color closing band. Story-driven, no boxed cards.
  return { styles: narrativeV2Styles(), body: narrativeV2Body(content, year, esc) };
}

// ─── Family 3: narrative-stacked ──────────────────────────────────────────
// Type-led, essay-style. Alternating full-bleed bands (regular/accent-soft)
// for capabilities, dark band for "how it works", accent-color closing band.
// v2 (2026-04-29): killed the boxy `.narr-quote` (bordered/padded background
// rectangle). Differentiators now use hanging-indent typography with an
// accent dash prefix — same visual hierarchy without the box.
function renderNarrativeStacked(content: LandingContent, year: number): { styles: string; body: string } {
  return { styles: narrativeStackedV2Styles(), body: narrativeStackedV2Body(content, year, esc) };
}

// ─── Family 4: magazine-grid ──────────────────────────────────────────────
// Asymmetric publication-style layout. Hero with sidebar metadata column,
// 2-column staggered "what it does" grid (lead spans + small stack),
// kicker-tagged "how it works" horizontal flow, large numbered statements
// for differentiators.
// v2 (2026-04-29): removed cell borders entirely. Lead cell uses
// `accent-soft` background + 4px accent left rule for emphasis. Sidebar
// uses thin accent top-bar instead of left-border. Statements lose the
// border-left columns — pure typographic hierarchy now.
function renderMagazineGrid(content: LandingContent, year: number): { styles: string; body: string } {
  return { styles: magazineGridV2Styles(), body: magazineGridV2Body(content, year, esc) };
}

// ─── Family 5: comparison-led ─────────────────────────────────────────────
// Utility-rich, table-driven. "What it does" is a capability matrix table,
// "how it works" is a numbered horizontal strip, differentiators are a ✓/✗
// comparison table vs. status quo.
// v2 (2026-04-29): tables stay (they ARE the content) but the surrounding
// box chrome is gone — outer borders dropped, no rounded-overflow wrapper,
// plain accent eyebrow text instead of a bordered pill, hero aside has an
// accent top-rule instead of a full bordered card. Inner row dividers stay
// (functional, not decorative). ✓/✗ uses color, not background blocks.
function renderComparisonLed(content: LandingContent, year: number): { styles: string; body: string } {
  return { styles: comparisonLedV2Styles(), body: comparisonLedV2Body(content, year, esc) };
}

// Exported for offline smoke tests. Production code path stays inside
// generateLandingPage above — external callers of this module continue to
// import only generateLandingPage. The orchestration entry point.
export function renderLandingHtml(
  content: LandingContent,
  tokens: ResolvedDesignTokens,
  vars: StyleVars,
  family: Family,
): string {
  const year = new Date().getFullYear();
  const title = `${content.brand.name} | ${content.brand.tagline}`;
  const fontLink = tokens.googleFontsHref
    ? `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${tokens.googleFontsHref}">`
    : '';

  const built =
    family === 'editorial' ? renderEditorial(content, year)
    : family === 'narrative' ? renderNarrative(content, year)
    : family === 'narrative-stacked' ? renderNarrativeStacked(content, year)
    : family === 'magazine-grid' ? renderMagazineGrid(content, year)
    : family === 'comparison-led' ? renderComparisonLed(content, year)
    : renderUtilityCards(content, year);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="baljia-landing/${family}">
<meta name="x-baljia-industry" content="${esc(tokens.matchedIndustryId)}">
<meta name="x-baljia-style" content="${esc(tokens.matchedStyle ?? 'default')}">
<meta name="x-baljia-pattern" content="${esc(tokens.matchedPattern)}">
<meta name="x-baljia-family" content="${esc(family)}">
<title>${esc(title)}</title>
<meta name="description" content="${esc(content.hero.subhead)}">
${fontLink}
<style>
${renderRootStyles(tokens, vars)}
${renderBaseStyles()}
${built.styles}
</style>
</head>
<body>
${built.body}
</body>
</html>`;
}

// ──────────────────────────────────────────────────────────────────────────
// Validation — catch obvious generation failures before we save
// ──────────────────────────────────────────────────────────────────────────

// Strip em/en-dashes, markdown artifacts, and other AI-tell residue from
// every text field in the LLM-generated content tree before render. The
// stripInlineMarkdown helper handles the heavy lifting (em/en-dash → ", ",
// **bold** / *italic* / _underline_ / `code` removal, leftover separator
// cleanup). Applied to every string the renderer interpolates so dashes
// never reach the visible page.
function sanitizeLandingContent(c: LandingContent): LandingContent {
  const s = (v: string | undefined | null) => stripInlineMarkdown(v ?? '');
  return {
    brand: {
      name: s(c.brand.name),
      tagline: s(c.brand.tagline),
    },
    hero: {
      headline: s(c.hero.headline),
      subhead: s(c.hero.subhead),
    },
    what_it_does: {
      heading: s(c.what_it_does.heading),
      capabilities: c.what_it_does.capabilities.map((cap) => ({
        title: s(cap.title),
        description: s(cap.description),
      })),
    },
    how_it_works: {
      heading: s(c.how_it_works.heading),
      steps: c.how_it_works.steps.map((step) => ({
        number: step.number,
        title: s(step.title),
        description: s(step.description),
      })),
    },
    what_makes_different: {
      heading: s(c.what_makes_different.heading),
      points: c.what_makes_different.points.map(s),
    },
    closing: {
      headline: s(c.closing.headline),
      body: s(c.closing.body),
    },
  };
}

function validateLandingContent(c: unknown): asserts c is LandingContent {
  const x = c as LandingContent;
  const missing: string[] = [];
  if (!x?.brand?.name?.trim()) missing.push('brand.name');
  if (!x?.hero?.headline?.trim()) missing.push('hero.headline');
  if (!x?.hero?.subhead?.trim()) missing.push('hero.subhead');
  if (!Array.isArray(x?.what_it_does?.capabilities) || x.what_it_does.capabilities.length < 3) missing.push('what_it_does.capabilities (need 3+)');
  if (!Array.isArray(x?.how_it_works?.steps) || x.how_it_works.steps.length !== 3) missing.push('how_it_works.steps (need exactly 3)');
  if (!Array.isArray(x?.what_makes_different?.points) || x.what_makes_different.points.length < 3) missing.push('what_makes_different.points (need 3+)');
  if (!x?.closing?.headline?.trim()) missing.push('closing.headline');
  if (missing.length) {
    throw new Error(`Landing content invalid — missing: ${missing.join(', ')}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────────────────────

export async function generateLandingPage(ctx: PipelineContext): Promise<void> {
  try {
    const facts = extractMarketFacts(ctx.marketResearchJson);

    // 1. Industry classification → corpus lookup
    const industryHint = await inferIndustry(ctx);
    const tokens = resolveDesignTokens({ industry: industryHint, slug: ctx.slug });
    const industryRow = INDUSTRY_RULES.find((r) => r.id === tokens.matchedIndustryId)
      ?? { name: tokens.matchedIndustry, considerations: tokens.considerations };
    const antiPatterns = antiPatternsForIndustry(tokens.matchedIndustryId);

    // 2. Resolve style → designVars → CSS custom properties
    const styleRow = UI_STYLES.find((s) =>
      tokens.matchedStyle && s.name.toLowerCase() === tokens.matchedStyle.toLowerCase()
    );
    const styleVars = parseStyleVars(styleRow?.designVars, tokens.matchedStyle);

    // 3. Family selection
    const family = familyForPattern(tokens.matchedPattern);

    log.info('Landing design selected', {
      companyId: ctx.companyId,
      industry: tokens.matchedIndustryId,
      style: tokens.matchedStyle,
      pattern: tokens.matchedPattern,
      family,
      paletteSource: tokens.paletteSource,
    });

    await emitActivity(ctx, `Generating landing page (${family} family, ${industryRow.name})`, 'llm');

    // 4. Generate content using prompt with anti-patterns injected
    const prompt = ctx.journey === 'grow_my_company'
      ? buildGrowLandingPrompt(ctx, facts, industryRow, antiPatterns)
      : buildLandingPrompt(ctx, facts, industryRow, antiPatterns);
    let content = await callSmallLLMJson<LandingContent>(prompt, {
      maxTokens: 2400,
      retryOnce: true,
      schema: LandingContentSchema,
    });
    validateLandingContent(content);
    content = sanitizeLandingContent(content);

    // 5. AI-feel hero validator — one cheap retry if the headline drips with
    //    hollow phrases ("modern", "intelligent", etc.). Catches Plinor-style
    //    "modern product teams and AI agents" outputs before they ship.
    const check = heroLooksHollow(content.hero.headline);
    if (check.hollow && check.phrase) {
      log.warn('Hero headline contains hollow phrase — regenerating once', {
        companyId: ctx.companyId,
        phrase: check.phrase,
      });
      const fixPrompt = `${prompt}

CRITICAL — your previous hero.headline contained the phrase "${check.phrase}". This is a hollow / generic-AI marker. Rewrite the entire JSON, but specifically craft a hero.headline that is concrete and specific to ${ctx.companyName} without using "${check.phrase}" or any other word in this list: ${HOLLOW_PHRASES.join(', ')}.`;
      try {
        const retry = await callSmallLLMJson<LandingContent>(fixPrompt, {
          maxTokens: 2400,
          retryOnce: false,
          schema: LandingContentSchema,
        });
        validateLandingContent(retry);
        content = sanitizeLandingContent(retry);
      } catch (retryErr) {
        log.warn('AI-feel retry failed — keeping original content', { error: retryErr instanceof Error ? retryErr.message : String(retryErr) });
      }
    }

    const html = renderLandingHtml(content, tokens, styleVars, family);

    sanitizeForFounder(html, {
      mode: 'audit',
      context: { callsite: 'landing.generateLandingPage', companyId: ctx.companyId, slug: ctx.slug ?? null },
    });

    log.info('Landing page generated', {
      companyId: ctx.companyId,
      industry: tokens.matchedIndustryId,
      style: tokens.matchedStyle,
      pattern: tokens.matchedPattern,
      family,
      competitors: facts.competitors.length,
      bytes: html.length,
    });

    await publishLandingToSubdomain(ctx, html);
    ctx.landingPageBrief = {
      url: ctx.slug ? `https://${ctx.slug}.baljia.app` : null,
      headline: content.hero.headline,
      subhead: content.hero.subhead,
      tagline: content.brand.tagline,
      capabilities: content.what_it_does.capabilities.map((item) => `${item.title}: ${item.description}`),
      steps: content.how_it_works.steps.map((step) => `${step.number}. ${step.title}: ${step.description}`),
      differentiators: content.what_makes_different.points,
    };
  } catch (err) {
    log.warn('Landing page generation failed — non-blocking', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ──────────────────────────────────────────────────────────────
// Publish — ADR-002 split-hosting path (unchanged)
// ──────────────────────────────────────────────────────────────
async function publishLandingToSubdomain(ctx: PipelineContext, html: string): Promise<void> {
  if (!ctx.slug) {
    log.warn('No slug on pipeline context — skipping subdomain publish', { companyId: ctx.companyId });
    return;
  }
  if (!isLandingDeployConfigured()) {
    log.info('Landing deploy not configured (Cloudflare missing, Render fallback disabled) — skipping publish', {
      companyId: ctx.companyId,
      slug: ctx.slug,
    });
    return;
  }

  const target = getLandingDeployTarget();
  log.info('Publishing landing', { companyId: ctx.companyId, slug: ctx.slug, target });

  try {
    await provisionWildcardSubdomain(ctx.companyId, ctx.slug);
  } catch (err) {
    log.warn('provisionWildcardSubdomain failed — continuing with deploy', {
      companyId: ctx.companyId,
      slug: ctx.slug,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const result = await deployLandingPage({
      companyId: ctx.companyId,
      slug: ctx.slug,
      companyName: ctx.companyName || ctx.slug,
      landingHtml: html,
    });
    if (!result) {
      log.warn('Landing deploy returned null — published-state unknown', {
        companyId: ctx.companyId,
        slug: ctx.slug,
      });
      return;
    }
    log.info('Landing published', {
      companyId: ctx.companyId,
      slug: ctx.slug,
      target: result.target,
      url: result.url,
    });
  } catch (err) {
    log.warn('Landing deploy threw — non-blocking', {
      companyId: ctx.companyId,
      slug: ctx.slug,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
