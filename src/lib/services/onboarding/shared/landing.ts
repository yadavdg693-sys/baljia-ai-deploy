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
  dataGaps: string[];
  topCompetitor: string | null;
}

function extractMarketFacts(mr: MarketResearchResult | undefined): MarketFacts {
  if (!mr) {
    return { competitors: [], demandSignals: [], marketStats: [], dataGaps: [], topCompetitor: null };
  }
  const anyMr = mr as unknown as Record<string, unknown>;
  const rawCompetitors = Array.isArray(anyMr.competitors) ? anyMr.competitors as Array<Record<string, unknown>> : [];
  const competitors = rawCompetitors.slice(0, 3).map((c) => ({
    name: String(c.name ?? ''),
    gap: String(c.gap ?? ''),
  })).filter((c) => c.name);

  const topCompetitor = competitors[0]?.name ?? null;

  const demandRaw = (anyMr.demand_signals ?? (anyMr.market_validation as Record<string, unknown> | undefined)?.demand_signals) as string[] | undefined;
  const whyNowRaw = (anyMr.market_validation as Record<string, unknown> | undefined)?.why_now as string[] | undefined;
  const demandSignals = [...(demandRaw ?? []), ...(whyNowRaw ?? [])].slice(0, 4);

  const sizeRaw = (anyMr.market_size ?? (anyMr.market_validation as Record<string, unknown> | undefined)?.size_and_growth) as Array<Record<string, unknown> | string> | undefined;
  const marketStats = (sizeRaw ?? []).slice(0, 3).map((s) => {
    if (typeof s === 'string') return s;
    return String(s.stat ?? '');
  }).filter(Boolean);

  const dataGaps = Array.isArray(anyMr.data_gaps) ? (anyMr.data_gaps as string[]).slice(0, 3) : [];

  return { competitors, demandSignals, marketStats, dataGaps, topCompetitor };
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
    ? `- Country "${country}" may appear EXACTLY ONCE in closing.body OR brand.tagline as a PROVENANCE signal. Examples: "Built in ${country}", "Made in ${country}". Optional — omit if it doesn't fit.
- NEVER use the country in hero, what_it_does, how_it_works, what_makes_different. Product is GLOBAL.
- BANNED: "${country}'s leading X", "for ${country} businesses", "Built specifically for ${country}".`
    : '- Founder country unknown. Do NOT mention any country, city, or region.'}
- City: NEVER mention any city anywhere on the page.

MARKET CONTEXT
${competitorBlock}

${demandBlock}

${statsBlock}
${facts.dataGaps.length ? `\nKnown gaps in the research (be honest, don't pretend we have the data):\n${facts.dataGaps.map((g) => `  - ${g}`).join('\n')}` : ''}

${antiBlock}

WHAT YOU DO NOT HAVE (DO NOT FABRICATE — each violation is a hard failure)
- Founder name, photo, bio, credentials → no "meet the founder" section
- Phone number, address, hours → no contact block
- Testimonials, reviews, star ratings, user counts, press mentions, "as seen in" logos
- Real product screenshots, photos, before/after images
- Pricing numbers, launch date, funding amount

The page is CREDIBLY PRE-LAUNCH. Gaps don't need placeholders.

This page is INFORMATIONAL only — NO call-to-action button, NO email capture, NO waitlist.

OUTPUT — return a JSON object with EXACTLY this 7-section shape:
{
  "brand": {
    "name": "${ctx.companyName}",
    "tagline": "<6-10 words. A single punchy descriptor of what the company is. Not a feature list.>"
  },
  "hero": {
    "headline": "<≤8 words. From mission.mission. Specific, concrete. NO 'never sleeps', 'runs itself', 'while you sleep', NO 'modern', 'streamlined', 'innovative', 'intelligent', 'next-generation', 'transform', 'empower', 'leverage', 'accelerate'.>",
    "subhead": "<2 sentences, 20-35 words. Sentence 1 = what this is + who for. Sentence 2 = the core reason it matters. DO NOT use the shape '[Product] is an AI [agent] that [verb1], [verb2], and [verb3]'.>"
  },
  "what_it_does": {
    "heading": "What it does",
    "capabilities": [
      { "title": "<3-4 words>", "description": "<1-2 sentences, concrete capability not vague benefit>" }
    ]
  },
  "how_it_works": {
    "heading": "How it works",
    "steps": [
      { "number": 1, "title": "<3-5 words>", "description": "<1 sentence, concrete action>" },
      { "number": 2, "title": "...", "description": "..." },
      { "number": 3, "title": "...", "description": "..." }
    ]
  },
  "what_makes_different": {
    "heading": "What makes this different",
    "points": [
      "<1 line. Reference a specific competitor gap from the research, or a positioning choice from the idea. Avoid generic 'better UX' claims.>"
    ]
  },
  "closing": {
    "headline": "<1 aspirational sentence. Derive from mission.where_were_headed — but tighten. No grandiose 'revolutionize' language.>",
    "body": "<1-2 sentences. Standalone closing thought — do NOT reference a CTA, sign-up, waitlist, or 'join us'.>"
  }
}

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
// Type-led, story-driven, no cards. Each capability becomes a full-width
// section with a giant prefix headline + paragraph. Steps become a single
// flowing numbered list with type-led numerals. Differentiators become
// italicised pull-quotes inset on a tinted background. Section dividers are
// color blocks, not borders. Reads like an essay rather than a SaaS page.
function renderNarrativeStacked(content: LandingContent, year: number): { styles: string; body: string } {
  const capSections = content.what_it_does.capabilities
    .map((c, i) => `
      <section class="narr-section narr-section--${i % 2 === 0 ? 'even' : 'odd'}" id="${i === 0 ? 'what' : ''}">
        <div class="narr-section-inner">
          <div class="narr-prefix">${(i + 1).toString().padStart(2, '0')}</div>
          <h2 class="narr-h">${esc(c.title)}</h2>
          <p class="narr-p">${esc(c.description)}</p>
        </div>
      </section>`)
    .join('');
  const stepFlow = content.how_it_works.steps
    .map((s) => `
      <li class="narr-step">
        <span class="narr-step-num">${s.number}</span>
        <div class="narr-step-body">
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.description)}</p>
        </div>
      </li>`)
    .join('');
  const pullQuotes = content.what_makes_different.points
    .map((p) => `<blockquote class="narr-quote"><p>${esc(p)}</p></blockquote>`)
    .join('');

  const styles = `.wrap { max-width: 100%; margin: 0; padding: 0; }
.narr-header { padding: 56px var(--container-px) 24px; max-width: 880px; margin: 0 auto; }
.narr-hero { padding: 96px var(--container-px) 80px; max-width: 880px; margin: 0 auto; }
.narr-hero h1 { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-weight: var(--heading-w); font-size: clamp(48px, 9vw, 96px); line-height: 0.96; margin: 0 0 32px; max-width: 16ch; }
.narr-hero p { font-size: 22px; line-height: 1.5; max-width: 52ch; margin: 0; opacity: 0.85; }
.narr-section { padding: clamp(80px, 12vw, 140px) 0; }
.narr-section--even { background: var(--bg); color: var(--ink); }
.narr-section--odd { background: var(--accent-soft); color: var(--ink); }
.narr-section-inner { max-width: 880px; margin: 0 auto; padding: 0 var(--container-px); }
.narr-prefix { font-family: var(--font-heading); font-size: 14px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); margin-bottom: 24px; opacity: 0.95; }
.narr-h { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-weight: var(--heading-w); font-size: clamp(36px, 6vw, 64px); line-height: 1.04; margin: 0 0 28px; max-width: 18ch; }
.narr-p { font-size: 20px; line-height: 1.55; max-width: 56ch; margin: 0; opacity: 0.88; }
.narr-how { background: var(--ink); color: var(--bg); padding: clamp(80px, 12vw, 140px) 0; }
.narr-how-inner { max-width: 880px; margin: 0 auto; padding: 0 var(--container-px); }
.narr-how h2 { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-size: 14px; opacity: 0.65; margin: 0 0 48px; }
ol.narr-steps { list-style: none; padding: 0; margin: 0; counter-reset: narr-counter; }
.narr-step { display: grid; grid-template-columns: 96px 1fr; gap: 24px; padding: 32px 0; border-top: 1px solid rgba(255,255,255,0.12); }
.narr-step:first-child { border-top: 0; padding-top: 0; }
.narr-step-num { font-family: var(--font-heading); font-size: clamp(54px, 8vw, 84px); line-height: 0.9; opacity: 0.5; font-weight: var(--heading-w); }
.narr-step-body h3 { font-family: var(--font-heading); font-size: clamp(22px, 3vw, 28px); margin: 8px 0 8px; font-weight: var(--heading-w); }
.narr-step-body p { font-size: 18px; line-height: 1.55; opacity: 0.78; margin: 0; max-width: 50ch; }
.narr-diff { padding: clamp(80px, 12vw, 140px) 0; background: var(--bg-elev); }
.narr-diff-inner { max-width: 880px; margin: 0 auto; padding: 0 var(--container-px); }
.narr-diff h2 { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-size: 14px; opacity: 0.65; margin: 0 0 48px; }
.narr-quote { margin: 0 0 32px; padding: 24px 32px; background: var(--accent-soft); border-left: 6px solid var(--accent); }
.narr-quote p { font-family: var(--font-heading); font-style: italic; font-size: clamp(22px, 3vw, 30px); line-height: 1.35; margin: 0; max-width: 36ch; font-weight: 500; }
.narr-closing { padding: clamp(120px, 16vw, 200px) 0; background: var(--accent); color: var(--bg); }
.narr-closing-inner { max-width: 880px; margin: 0 auto; padding: 0 var(--container-px); text-align: left; }
.narr-closing h2 { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-weight: var(--heading-w); font-size: clamp(40px, 7vw, 76px); line-height: 1.04; margin: 0 0 24px; max-width: 18ch; }
.narr-closing p { font-size: 20px; line-height: 1.55; max-width: 52ch; margin: 0; opacity: 0.92; }
.narr-footer { padding: 32px var(--container-px) 48px; max-width: 880px; margin: 0 auto; font-size: 13px; color: var(--ink-soft); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.narr-footer a { color: var(--ink-soft); text-decoration: none; border-bottom: var(--border-w) solid transparent; }
.narr-footer a:hover { color: var(--accent); border-bottom-color: var(--accent); }`;

  const body = `<div class="wrap">
  <header class="narr-header">
    <div class="brand">${esc(content.brand.name)}</div>
    <div class="brand-tag">${esc(content.brand.tagline)}</div>
  </header>
  <div class="narr-hero" id="hero">
    <h1>${esc(content.hero.headline)}</h1>
    <p>${esc(content.hero.subhead)}</p>
  </div>
  ${capSections}
  <section class="narr-how" id="how">
    <div class="narr-how-inner">
      <h2>${esc(content.how_it_works.heading)}</h2>
      <ol class="narr-steps">${stepFlow}
      </ol>
    </div>
  </section>
  <section class="narr-diff" id="diff">
    <div class="narr-diff-inner">
      <h2>${esc(content.what_makes_different.heading)}</h2>
      ${pullQuotes}
    </div>
  </section>
  <section class="narr-closing" id="closing">
    <div class="narr-closing-inner">
      <h2>${esc(content.closing.headline)}</h2>
      <p>${esc(content.closing.body)}</p>
    </div>
  </section>
  <footer class="narr-footer">
    <div>© ${year} ${esc(content.brand.name)}</div>
    <div>Built and operated by <a href="https://baljia.ai">Baljia</a></div>
  </footer>
</div>`;
  return { styles, body };
}

// ─── Family 4: magazine-grid ──────────────────────────────────────────────
// Asymmetric publication-style layout. Hero is full-bleed with a sidebar
// metadata column ("Issue / Built for / Year"). "What it does" is a 2-column
// staggered grid where one feature spans 2 columns and the others stack.
// "How it works" becomes a kicker-tagged horizontal flow. Differentiators
// are 3 large numbered statements with serif-leaning display.
function renderMagazineGrid(content: LandingContent, year: number): { styles: string; body: string } {
  const caps = content.what_it_does.capabilities;
  // First capability = wide (spans 2 cols), remaining = stack. Defensive in
  // case the LLM ever returns more than 3.
  const lead = caps[0];
  const rest = caps.slice(1);
  const restCells = rest
    .map((c, i) => `
        <div class="mag-cell mag-cell--small">
          <span class="mag-cell-tag">No. ${(i + 2).toString().padStart(2, '0')}</span>
          <h3>${esc(c.title)}</h3>
          <p>${esc(c.description)}</p>
        </div>`)
    .join('');
  const stepRow = content.how_it_works.steps
    .map((s) => `
        <div class="mag-step">
          <span class="mag-step-kicker">Step ${s.number.toString().padStart(2, '0')}</span>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.description)}</p>
        </div>`)
    .join('');
  const diffStmts = content.what_makes_different.points
    .map((p, i) => `
        <div class="mag-stmt">
          <span class="mag-stmt-num">${(i + 1).toString().padStart(2, '0')}</span>
          <p>${esc(p)}</p>
        </div>`)
    .join('');

  const styles = `.wrap { max-width: 1200px; margin: 0 auto; padding: 0 var(--container-px); }
header.mag-header { padding: 32px 0 24px; display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid var(--line); }
.mag-meta-strip { font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-soft); }
.mag-hero { display: grid; grid-template-columns: 1fr 220px; gap: 48px; padding: 80px 0 64px; border-bottom: 1px solid var(--line); }
.mag-hero h1 { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-weight: var(--heading-w); font-size: clamp(44px, 7vw, 84px); line-height: 1.02; margin: 0 0 32px; max-width: 18ch; }
.mag-hero p { font-size: 20px; line-height: 1.5; max-width: 50ch; margin: 0; opacity: 0.82; }
.mag-sidebar { border-left: 1px solid var(--line); padding-left: 28px; font-family: var(--font-heading); }
.mag-sidebar dt { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); margin-top: 16px; }
.mag-sidebar dt:first-child { margin-top: 0; }
.mag-sidebar dd { font-size: 15px; margin: 4px 0 0; color: var(--ink); }
.mag-section { padding: var(--section-py) 0; border-bottom: 1px solid var(--line); }
.mag-section h2 { font-family: var(--font-heading); text-transform: uppercase; letter-spacing: 0.16em; font-size: 12px; color: var(--ink-soft); margin: 0 0 32px; font-weight: var(--heading-w); }
.mag-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 24px; }
.mag-cell { padding: 28px; background: var(--bg-elev); border: 1px solid var(--line); border-radius: var(--radius); transition: border-color var(--transition); }
.mag-cell:hover { border-color: var(--accent); }
.mag-cell--lead { grid-row: span 2; padding: 36px; display: flex; flex-direction: column; justify-content: space-between; min-height: 280px; }
.mag-cell--lead h3 { font-family: var(--font-heading); font-size: clamp(28px, 3.6vw, 40px); margin: 0 0 16px; font-weight: var(--heading-w); letter-spacing: var(--heading-ls); }
.mag-cell--lead p { font-size: 17px; line-height: 1.55; opacity: 0.85; margin: 0; }
.mag-cell-tag { display: block; font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
.mag-cell--small h3 { font-family: var(--font-heading); font-size: 18px; margin: 0 0 8px; font-weight: var(--heading-w); }
.mag-cell--small p { font-size: 15px; line-height: 1.55; opacity: 0.8; margin: 0; }
.mag-flow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; }
.mag-step { padding-top: 16px; border-top: 3px solid var(--accent); }
.mag-step-kicker { font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); display: block; margin-bottom: 12px; }
.mag-step h3 { font-family: var(--font-heading); font-size: clamp(20px, 2.5vw, 24px); margin: 0 0 10px; font-weight: var(--heading-w); }
.mag-step p { font-size: 15px; line-height: 1.55; opacity: 0.82; margin: 0; }
.mag-statements { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; }
.mag-stmt { padding: 24px 0 24px 12px; border-left: 1px solid var(--line); }
.mag-stmt-num { font-family: var(--font-heading); font-size: clamp(40px, 5vw, 60px); color: var(--accent); display: block; line-height: 1; margin-bottom: 16px; font-weight: var(--heading-w); opacity: 0.9; }
.mag-stmt p { font-family: var(--font-heading); font-size: clamp(20px, 2.4vw, 26px); line-height: 1.25; margin: 0; font-weight: 500; max-width: 18ch; }
.mag-closing { padding: calc(var(--section-py) * 1.4) 0 var(--section-py); display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: end; }
.mag-closing h2 { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-size: clamp(32px, 5vw, 56px); margin: 0; max-width: 18ch; line-height: 1.04; }
.mag-closing p { font-size: 18px; line-height: 1.55; opacity: 0.82; margin: 0; max-width: 44ch; }
@media (max-width: 760px) {
  .mag-hero { grid-template-columns: 1fr; gap: 32px; }
  .mag-sidebar { border-left: 0; border-top: 1px solid var(--line); padding: 28px 0 0; }
  .mag-grid { grid-template-columns: 1fr; }
  .mag-cell--lead { grid-row: auto; }
  .mag-flow, .mag-statements { grid-template-columns: 1fr; }
  .mag-closing { grid-template-columns: 1fr; gap: 24px; }
}`;

  const body = `<div class="wrap">
  <header class="mag-header">
    <div>
      <div class="brand">${esc(content.brand.name)}</div>
      <div class="brand-tag">${esc(content.brand.tagline)}</div>
    </div>
    <div class="mag-meta-strip">Issue 01 / ${year}</div>
  </header>
  <div class="mag-hero" id="hero">
    <div>
      <h1>${esc(content.hero.headline)}</h1>
      <p>${esc(content.hero.subhead)}</p>
    </div>
    <dl class="mag-sidebar">
      <dt>Issue</dt><dd>01 / ${year}</dd>
      <dt>Built for</dt><dd>${esc(content.brand.tagline)}</dd>
      <dt>Section</dt><dd>Day-Zero Edition</dd>
    </dl>
  </div>
  <section class="mag-section" id="what">
    <h2>${esc(content.what_it_does.heading)}</h2>
    <div class="mag-grid">
      ${lead ? `<div class="mag-cell mag-cell--lead">
        <div>
          <span class="mag-cell-tag">Lead Story · No. 01</span>
          <h3>${esc(lead.title)}</h3>
        </div>
        <p>${esc(lead.description)}</p>
      </div>` : ''}
      <div class="mag-cell-stack">${restCells}
      </div>
    </div>
  </section>
  <section class="mag-section" id="how">
    <h2>${esc(content.how_it_works.heading)}</h2>
    <div class="mag-flow">${stepRow}
    </div>
  </section>
  <section class="mag-section" id="diff">
    <h2>${esc(content.what_makes_different.heading)}</h2>
    <div class="mag-statements">${diffStmts}
    </div>
  </section>
  <div class="mag-closing" id="closing">
    <h2>${esc(content.closing.headline)}</h2>
    <p>${esc(content.closing.body)}</p>
  </div>
  <footer>
    <div>© ${year} ${esc(content.brand.name)}</div>
    <div>Built and operated by <a href="https://baljia.ai">Baljia</a></div>
  </footer>
</div>`;
  return { styles, body };
}

// ─── Family 5: comparison-led ─────────────────────────────────────────────
// Utility-rich, table-driven. "What it does" becomes a 4-column matrix table
// (icon-mark / feature / benefit / who-it-helps). "How it works" stays a
// numbered flow but in a denser horizontal strip. Differentiators become a
// comparison table with ✓/✗ rows showing how this product compares to a
// generic "status quo" column. Sections are denser, business-tool-like.
function renderComparisonLed(content: LandingContent, year: number): { styles: string; body: string } {
  const matrixRows = content.what_it_does.capabilities
    .map((c, i) => `
        <tr class="cmp-feature-row">
          <td class="cmp-feature-mark">${(i + 1).toString().padStart(2, '0')}</td>
          <td class="cmp-feature-name">${esc(c.title)}</td>
          <td class="cmp-feature-bullet">${esc(c.description)}</td>
        </tr>`)
    .join('');
  const stepStrip = content.how_it_works.steps
    .map((s) => `
        <li class="cmp-step">
          <span class="cmp-step-num">${s.number}</span>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.description)}</p>
        </li>`)
    .join('');
  const diffRows = content.what_makes_different.points
    .map((p) => `
        <tr class="cmp-diff-row">
          <td class="cmp-diff-claim">${esc(p)}</td>
          <td class="cmp-diff-mark cmp-diff-mark--us"><span aria-hidden="true">✓</span><span class="visually-hidden">Yes</span></td>
          <td class="cmp-diff-mark cmp-diff-mark--them"><span aria-hidden="true">✗</span><span class="visually-hidden">No</span></td>
        </tr>`)
    .join('');

  const styles = `.wrap { max-width: 1080px; margin: 0 auto; padding: 0 var(--container-px); }
header.cmp-header { padding: 32px 0 16px; display: flex; justify-content: space-between; align-items: baseline; border-bottom: var(--border-w) solid var(--line); }
.cmp-eyebrow { font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); padding: 4px 10px; border: var(--border-w) solid var(--accent); border-radius: var(--radius); }
.cmp-hero { padding: 64px 0 48px; display: grid; grid-template-columns: 1.25fr 1fr; gap: 56px; align-items: end; border-bottom: var(--border-w) solid var(--line); }
.cmp-hero h1 { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-weight: var(--heading-w); font-size: clamp(36px, 5.4vw, 60px); line-height: 1.06; margin: 0 0 24px; max-width: 18ch; }
.cmp-hero p { font-size: 18px; line-height: 1.55; opacity: 0.84; margin: 0; max-width: 48ch; }
.cmp-hero-aside { background: var(--bg-elev); border: var(--border-w) solid var(--line); border-radius: var(--radius); padding: 24px; box-shadow: var(--shadow); }
.cmp-hero-aside dl { margin: 0; display: grid; gap: 14px; }
.cmp-hero-aside dt { font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-soft); margin: 0; }
.cmp-hero-aside dd { margin: 2px 0 0; font-size: 14px; color: var(--ink); }
.cmp-section { padding: var(--section-py) 0; border-bottom: var(--border-w) solid var(--line); }
.cmp-section-h { display: flex; align-items: baseline; justify-content: space-between; margin: 0 0 24px; }
.cmp-section-h h2 { font-family: var(--font-heading); text-transform: uppercase; letter-spacing: 0.14em; font-size: 14px; margin: 0; color: var(--ink-soft); font-weight: var(--heading-w); }
.cmp-section-h .cmp-meta { font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-soft); }
table.cmp-matrix { width: 100%; border-collapse: collapse; border: var(--border-w) solid var(--line); border-radius: var(--radius); overflow: hidden; }
table.cmp-matrix thead th { font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; text-align: left; padding: 14px 18px; background: var(--bg-elev); border-bottom: var(--border-w) solid var(--line); color: var(--ink-soft); font-weight: var(--heading-w); }
table.cmp-matrix tbody td { padding: 18px; border-bottom: var(--border-w) solid var(--line); vertical-align: top; }
table.cmp-matrix tbody tr:last-child td { border-bottom: 0; }
.cmp-feature-mark { width: 56px; font-family: var(--font-heading); color: var(--accent); font-weight: var(--heading-w); font-size: 14px; }
.cmp-feature-name { width: 240px; font-family: var(--font-heading); font-weight: var(--heading-w); font-size: 16px; }
.cmp-feature-bullet { font-size: 15px; line-height: 1.55; opacity: 0.85; }
ol.cmp-steps { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; border: var(--border-w) solid var(--line); border-radius: var(--radius); overflow: hidden; }
.cmp-step { padding: 24px; border-right: var(--border-w) solid var(--line); background: var(--bg); }
.cmp-step:last-child { border-right: 0; }
.cmp-step-num { display: inline-block; font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
.cmp-step h3 { font-family: var(--font-heading); font-size: 17px; margin: 0 0 6px; font-weight: var(--heading-w); }
.cmp-step p { font-size: 14.5px; line-height: 1.55; opacity: 0.82; margin: 0; }
table.cmp-table { width: 100%; border-collapse: collapse; border: var(--border-w) solid var(--line); border-radius: var(--radius); overflow: hidden; }
table.cmp-table thead th { font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; text-align: left; padding: 14px 18px; background: var(--bg-elev); border-bottom: var(--border-w) solid var(--line); color: var(--ink-soft); font-weight: var(--heading-w); }
table.cmp-table thead th.cmp-col-us { color: var(--accent); }
table.cmp-table tbody td { padding: 16px 18px; border-bottom: var(--border-w) solid var(--line); vertical-align: middle; }
table.cmp-table tbody tr:last-child td { border-bottom: 0; }
.cmp-diff-claim { font-size: 15px; line-height: 1.5; max-width: 38ch; }
.cmp-diff-mark { width: 88px; text-align: center; font-family: var(--font-heading); font-weight: var(--heading-w); font-size: 18px; }
.cmp-diff-mark--us { color: var(--accent); background: var(--accent-soft); }
.cmp-diff-mark--them { color: var(--ink-soft); opacity: 0.6; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.cmp-closing { padding: calc(var(--section-py) * 1.4) 0 var(--section-py); display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: start; }
.cmp-closing h2 { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-size: clamp(28px, 4vw, 44px); margin: 0; max-width: 20ch; line-height: 1.06; }
.cmp-closing p { font-size: 17px; line-height: 1.55; opacity: 0.84; margin: 0; max-width: 44ch; }
@media (max-width: 760px) {
  .cmp-hero { grid-template-columns: 1fr; gap: 32px; }
  ol.cmp-steps { grid-template-columns: 1fr; }
  .cmp-step { border-right: 0; border-bottom: var(--border-w) solid var(--line); }
  .cmp-step:last-child { border-bottom: 0; }
  .cmp-closing { grid-template-columns: 1fr; gap: 16px; }
  .cmp-feature-name { width: auto; }
}`;

  const body = `<div class="wrap">
  <header class="cmp-header">
    <div>
      <div class="brand">${esc(content.brand.name)}</div>
      <div class="brand-tag">${esc(content.brand.tagline)}</div>
    </div>
    <span class="cmp-eyebrow">Reference · ${year}</span>
  </header>
  <div class="cmp-hero" id="hero">
    <div>
      <h1>${esc(content.hero.headline)}</h1>
      <p>${esc(content.hero.subhead)}</p>
    </div>
    <aside class="cmp-hero-aside">
      <dl>
        <div><dt>Status</dt><dd>Pre-launch</dd></div>
        <div><dt>Reference</dt><dd>${esc(content.brand.name)}/01</dd></div>
        <div><dt>Updated</dt><dd>${year}</dd></div>
      </dl>
    </aside>
  </div>
  <section class="cmp-section" id="what">
    <div class="cmp-section-h">
      <h2>${esc(content.what_it_does.heading)}</h2>
      <span class="cmp-meta">Capability matrix</span>
    </div>
    <table class="cmp-matrix" role="table">
      <thead>
        <tr><th scope="col">Ref</th><th scope="col">Capability</th><th scope="col">What it gets you</th></tr>
      </thead>
      <tbody>${matrixRows}
      </tbody>
    </table>
  </section>
  <section class="cmp-section" id="how">
    <div class="cmp-section-h">
      <h2>${esc(content.how_it_works.heading)}</h2>
      <span class="cmp-meta">Sequence</span>
    </div>
    <ol class="cmp-steps">${stepStrip}
    </ol>
  </section>
  <section class="cmp-section" id="diff">
    <div class="cmp-section-h">
      <h2>${esc(content.what_makes_different.heading)}</h2>
      <span class="cmp-meta">vs. status quo</span>
    </div>
    <table class="cmp-table" role="table">
      <thead>
        <tr><th scope="col">Position</th><th scope="col" class="cmp-col-us">${esc(content.brand.name)}</th><th scope="col">Status quo</th></tr>
      </thead>
      <tbody>${diffRows}
      </tbody>
    </table>
  </section>
  <div class="cmp-closing" id="closing">
    <h2>${esc(content.closing.headline)}</h2>
    <p>${esc(content.closing.body)}</p>
  </div>
  <footer>
    <div>© ${year} ${esc(content.brand.name)}</div>
    <div>Built and operated by <a href="https://baljia.ai">Baljia</a></div>
  </footer>
</div>`;
  return { styles, body };
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
  const title = `${content.brand.name} — ${content.brand.tagline}`;
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
    const prompt = buildLandingPrompt(ctx, facts, industryRow, antiPatterns);
    let content = await callSmallLLMJson<LandingContent>(prompt, {
      maxTokens: 2400,
      retryOnce: true,
      schema: LandingContentSchema,
    });
    validateLandingContent(content);

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
        content = retry;
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
    log.info('Landing deploy not configured (neither CF nor Render) — skipping publish', {
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
