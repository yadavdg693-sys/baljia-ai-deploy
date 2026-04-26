// Design token system for landing pages
// Distilled from agency-ui-designer + agency-ux-architect skills.
// LLM picks design_intent (3 enum fields); this module turns it into
// concrete CSS custom properties + font stacks the renderer consumes.
//
// The token system is what gives each generated landing page its own
// visual identity. Without it, every page looks the same (the
// "all generated sites look identical" problem). With it, palette +
// fonts + density vary per business while the renderer guarantees
// accessibility + spacing.

export type PaletteMood = 'warm' | 'cool' | 'neutral' | 'bold' | 'muted';
export type FontPairing = 'modern_sans' | 'editorial_serif' | 'friendly_rounded' | 'tech_mono';
export type Density = 'spacious' | 'balanced' | 'dense';

export interface DesignIntent {
  palette_mood: PaletteMood;
  font_pairing: FontPairing;
  density: Density;
  rationale: string;
}

interface PaletteSpec {
  hueRange: [number, number] | null; // null = use slug-derived hue freely
  fixedHue: number | null;            // if set, ignores slug
  saturation: number;
  lightness: number;
}

const PALETTES: Record<PaletteMood, PaletteSpec> = {
  warm:    { hueRange: [15, 45],    fixedHue: null, saturation: 65, lightness: 48 },
  cool:    { hueRange: [195, 235],  fixedHue: null, saturation: 50, lightness: 42 },
  neutral: { hueRange: null,        fixedHue: 220,  saturation: 8,  lightness: 14 },
  bold:    { hueRange: null,        fixedHue: null, saturation: 75, lightness: 45 },
  muted:   { hueRange: null,        fixedHue: null, saturation: 22, lightness: 52 },
};

interface FontStack {
  googleFamily: string | null; // e.g. 'Fraunces:wght@500;700' — null = system stack
  headingStack: string;
  bodyStack: string;
  headingTransform: string;
  headingLetterSpacing: string;
  headingWeight: number;
}

const FONTS: Record<FontPairing, FontStack> = {
  modern_sans: {
    googleFamily: null,
    headingStack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    bodyStack:    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    headingTransform: 'none',
    headingLetterSpacing: '-0.022em',
    headingWeight: 800,
  },
  editorial_serif: {
    googleFamily: 'Fraunces:opsz,wght@9..144,500;9..144,700',
    headingStack: '"Fraunces", Georgia, "Times New Roman", serif',
    bodyStack:    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    headingTransform: 'none',
    headingLetterSpacing: '-0.015em',
    headingWeight: 700,
  },
  friendly_rounded: {
    googleFamily: 'Quicksand:wght@500;700',
    headingStack: '"Quicksand", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    bodyStack:    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    headingTransform: 'none',
    headingLetterSpacing: '-0.005em',
    headingWeight: 700,
  },
  tech_mono: {
    googleFamily: 'JetBrains+Mono:wght@500;700',
    headingStack: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
    bodyStack:    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    headingTransform: 'uppercase',
    headingLetterSpacing: '0.04em',
    headingWeight: 700,
  },
};

interface DensityScale {
  sectionPaddingY: string;
  sectionPaddingYMobile: string;
  heroPaddingY: string;
  cardPadding: string;
  containerPaddingX: string;
  cardGap: string;
}

const DENSITIES: Record<Density, DensityScale> = {
  spacious: {
    sectionPaddingY: '80px',
    sectionPaddingYMobile: '48px',
    heroPaddingY: '88px 0 64px',
    cardPadding: '28px',
    containerPaddingX: '32px',
    cardGap: '24px',
  },
  balanced: {
    sectionPaddingY: '56px',
    sectionPaddingYMobile: '36px',
    heroPaddingY: '64px 0 48px',
    cardPadding: '20px',
    containerPaddingX: '24px',
    cardGap: '16px',
  },
  dense: {
    sectionPaddingY: '40px',
    sectionPaddingYMobile: '28px',
    heroPaddingY: '48px 0 32px',
    cardPadding: '16px',
    containerPaddingX: '20px',
    cardGap: '12px',
  },
};

export interface ResolvedTokens {
  // colors
  accent: string;
  accentSoft: string;
  accentStrong: string;
  ink: string;
  inkSoft: string;
  bg: string;
  bgElev: string;
  line: string;
  // dark mode counterparts (consumed by prefers-color-scheme media query)
  darkAccent: string;
  darkAccentSoft: string;
  darkInk: string;
  darkInkSoft: string;
  darkBg: string;
  darkBgElev: string;
  darkLine: string;
  // fonts
  headingStack: string;
  bodyStack: string;
  headingTransform: string;
  headingLetterSpacing: string;
  headingWeight: number;
  googleFontsHref: string | null;
  // density
  density: DensityScale;
}

// FNV-1a hash → hue slot (0-360)
function deriveHueFromSlug(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

function clampHue(slugHue: number, range: [number, number] | null): number {
  if (!range) return slugHue;
  const [min, max] = range;
  return min + (slugHue / 360) * (max - min);
}

function clampLightness(value: number): number {
  return Math.max(20, Math.min(80, value));
}

export function resolveTokens(intent: DesignIntent, slug: string): ResolvedTokens {
  const palette = PALETTES[intent.palette_mood] ?? PALETTES.cool;
  const font = FONTS[intent.font_pairing] ?? FONTS.modern_sans;
  const density = DENSITIES[intent.density] ?? DENSITIES.balanced;

  const slugHue = deriveHueFromSlug(slug);
  const hue = palette.fixedHue ?? clampHue(slugHue, palette.hueRange);
  const sat = palette.saturation;
  const light = palette.lightness;

  return {
    // light theme
    accent:        `hsl(${hue.toFixed(0)}, ${sat}%, ${light}%)`,
    accentSoft:    `hsl(${hue.toFixed(0)}, ${Math.max(20, sat - 20)}%, 96%)`,
    accentStrong:  `hsl(${hue.toFixed(0)}, ${sat}%, ${clampLightness(light - 10)}%)`,
    ink:           'hsl(220, 15%, 12%)',
    inkSoft:       'hsl(220, 9%, 45%)',
    bg:            'hsl(0, 0%, 100%)',
    bgElev:        `hsl(${hue.toFixed(0)}, 30%, 98%)`,
    line:          'hsl(220, 13%, 91%)',

    // dark theme — same hue, lighter accent, darker bg
    darkAccent:      `hsl(${hue.toFixed(0)}, ${Math.min(70, sat + 5)}%, ${clampLightness(light + 18)}%)`,
    darkAccentSoft:  `hsl(${hue.toFixed(0)}, ${Math.max(20, sat - 25)}%, 14%)`,
    darkInk:         'hsl(220, 10%, 92%)',
    darkInkSoft:     'hsl(220, 8%, 65%)',
    darkBg:          'hsl(220, 16%, 8%)',
    darkBgElev:      'hsl(220, 14%, 11%)',
    darkLine:        'hsl(220, 12%, 18%)',

    // fonts
    headingStack: font.headingStack,
    bodyStack: font.bodyStack,
    headingTransform: font.headingTransform,
    headingLetterSpacing: font.headingLetterSpacing,
    headingWeight: font.headingWeight,
    googleFontsHref: font.googleFamily
      ? `https://fonts.googleapis.com/css2?family=${font.googleFamily}&display=swap`
      : null,

    density,
  };
}

export const VALID_PALETTE_MOODS: PaletteMood[] = ['warm', 'cool', 'neutral', 'bold', 'muted'];
export const VALID_FONT_PAIRINGS: FontPairing[] = ['modern_sans', 'editorial_serif', 'friendly_rounded', 'tech_mono'];
export const VALID_DENSITIES: Density[] = ['spacious', 'balanced', 'dense'];

// ──────────────────────────────────────────────────────────────────────────
// Corpus-driven resolver
//
// `resolveTokens` above is the legacy enum-based path (palette mood + font
// pairing + density). `resolveDesignTokens` below is the new path: takes a
// free-form industry string, ranks corpus rows, and emits a fuller
// ResolvedTokens object backed by the UI UX Pro Max corpus.
//
// Both paths produce the SAME ResolvedTokens shape so renderLandingHtml
// keeps working unchanged.
// ──────────────────────────────────────────────────────────────────────────

import {
  INDUSTRY_RULES,
  TYPOGRAPHY_PAIRINGS,
  LANDING_PATTERNS,
  UI_STYLES,
  PATTERN_AFFINITIES,
  type IndustryRule,
  type IndustryPalette,
  type TypographyPairing,
  type LandingPattern,
  type UIStyle,
} from './landing-design-corpus';

export interface DesignTokenInput {
  industry: string;
  mood?: string; // optional free-form: 'modern', 'playful', 'editorial', etc.
  density?: Density;
  slug?: string;
}

export interface ResolvedDesignTokens extends ResolvedTokens {
  // diagnostics — surfaced so callers / tests can verify the pick
  matchedIndustry: string;
  matchedIndustryId: string;
  matchedPattern: string;
  matchedTypography: string;
  matchedStyle: string | null;
  considerations: string;
  antiPatterns: string[];
  paletteSource: 'corpus' | 'derived';
  // raw industry palette (hex) when the corpus has one — useful for
  // future renderer refactors that want exact corpus colours, while the
  // ResolvedTokens fields stay backwards-compatible (HSL strings).
  rawPalette?: IndustryPalette;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'app', 'apps', 'builder', 'company', 'for', 'in', 'inc',
  'is', 'it', 'llc', 'ltd', 'my', 'of', 'on', 'or', 'platform', 'pro', 'product',
  'service', 'services', 'site', 'startup', 'studio', 'the', 'to', 'tool', 'tools',
  'web', 'website', 'with',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Light BM25-ish scoring against industry rules.
// Score = sum over query tokens of (matches in name × 3 + matches in keywords × 2).
function scoreIndustry(rule: IndustryRule, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const nameTokens = new Set(tokenize(rule.name));
  const kwTokens = new Set(rule.keywords.map((k) => k.toLowerCase().trim()));
  let score = 0;
  for (const q of queryTokens) {
    if (nameTokens.has(q)) score += 3;
    if (kwTokens.has(q)) score += 2;
    // partial: industry name contains the query token as substring
    if (rule.name.toLowerCase().includes(q)) score += 1;
  }
  return score;
}

function findBestIndustry(industry: string): IndustryRule {
  const tokens = tokenize(industry);
  let best: IndustryRule = INDUSTRY_RULES[0];
  let bestScore = -1;
  for (const rule of INDUSTRY_RULES) {
    const s = scoreIndustry(rule, tokens);
    if (s > bestScore) {
      best = rule;
      bestScore = s;
    }
  }
  // If nothing scored, default to "SaaS (General)".
  if (bestScore <= 0) {
    const saas = INDUSTRY_RULES.find((r) => r.id === 'saas_general');
    if (saas) return saas;
  }
  return best;
}

function findBestTypography(rule: IndustryRule, mood: string | undefined): TypographyPairing {
  // Score across multiple signals so industries whose `typographyMood` text
  // overlaps generically (e.g. "Modern + ...") still differentiate based on
  // primary style + palette focus.
  //   - typographyMood overlap × 3
  //   - paletteFocus overlap × 3 (catches "Warm + Romantic" → romance/feminine)
  //   - primary style overlap × 2 (catches "Vibrant & Block" → vibrant/block)
  //   - mood arg overlap × 2
  //   - industry name appears in bestFor × 6 (strongest signal)
  const moodTokens = tokenize(rule.typographyMood + ' ' + (mood ?? ''));
  const paletteTokens = tokenize(rule.paletteFocus);
  const styleTokens = tokenize(rule.primaryStyles.join(' '));
  const nameLower = rule.name.toLowerCase();

  let best: TypographyPairing = TYPOGRAPHY_PAIRINGS[0];
  let bestScore = -1;
  for (const t of TYPOGRAPHY_PAIRINGS) {
    const tagSet = new Set(t.moodKeywords.map((k) => k.toLowerCase()));
    const bestForLower = t.bestFor.map((b) => b.toLowerCase()).join(' ');
    let score = 0;
    for (const m of moodTokens) {
      if (tagSet.has(m)) score += 3;
      if (bestForLower.includes(m)) score += 2;
    }
    for (const p of paletteTokens) {
      if (tagSet.has(p)) score += 3;
      if (bestForLower.includes(p)) score += 1;
    }
    for (const s of styleTokens) {
      if (tagSet.has(s)) score += 2;
    }
    if (bestForLower.includes(nameLower)) score += 6;
    // Tiny tiebreaker so two equal-scored pairings hash deterministically.
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

// Industry-tag derivation — pull semantic tags out of an IndustryRule so they
// can score against PATTERN_AFFINITIES.tags. We blend three sources:
//   1. The rule.id itself (e.g. "creative_agency" → ["creative", "agency"])
//   2. rule.keywords (already a curated list)
//   3. tokens from paletteFocus / considerations / typographyMood (free text)
// Stopwords filtered. The resulting set is what the affinity matcher works on.
function deriveIndustryTags(rule: IndustryRule): Set<string> {
  const tags = new Set<string>();
  for (const part of rule.id.split(/[_\s-]/)) {
    if (part.length >= 3) tags.add(part.toLowerCase());
  }
  for (const k of rule.keywords) tags.add(k.toLowerCase());
  for (const t of tokenize(rule.paletteFocus)) tags.add(t);
  for (const t of tokenize(rule.considerations)) tags.add(t);
  for (const t of tokenize(rule.typographyMood)) tags.add(t);
  for (const t of tokenize(rule.name)) tags.add(t);
  return tags;
}

// Score a pattern's fit for an industry. Higher = better fit.
//
// Components:
//   base  — exact-name match against rule.landingPattern (the upstream CSV's
//           recommendation). Strong but not absolute, so a better-affinity
//           pattern can override it when overlap is high.
//   kw    — fallback keyword overlap (the original behaviour).
//   aff   — overlap between industry tags and pattern's affinity tags ×2.0.
//           This is the dominant signal post-rebalance.
//   penalty — small (-0.5) penalty for patterns flagged generic, so they only
//             win when nothing semantically aligns.
function scorePattern(p: LandingPattern, rule: IndustryRule, indTags: Set<string>, targetName: string): number {
  const pNameLower = p.name.toLowerCase();
  const targetLower = targetName.toLowerCase();
  // Base anchor — the upstream CSV's recommended `landingPattern` string is
  // a strong signal but no longer absolute. Reduced weight (was an early-exit
  // before the rebalance) so that affinity-rich alternatives can pass it.
  let base = 0;
  if (targetLower === pNameLower) base = 3.0;
  else if (targetLower.includes(pNameLower) || pNameLower.includes(targetLower)) base = 2.0;

  const kwSet = new Set(p.keywords.map((k) => k.toLowerCase()));
  const targetTokens = tokenize(targetName);
  let kw = 0;
  for (const t of targetTokens) if (kwSet.has(t)) kw += 0.4;

  const affinity = PATTERN_AFFINITIES[p.id];
  let aff = 0;
  let affMatches = 0;
  if (affinity?.tags?.length) {
    for (const tag of affinity.tags) {
      if (indTags.has(tag.toLowerCase())) { aff += 2.0; affMatches++; }
      // partial match — tag appears as substring in any industry tag (e.g.
      // pattern tag "creative" inside industry tag "creative_agency"). Lower
      // weight so multi-token affinities still beat single-substring leakage.
      else {
        for (const it of indTags) {
          if (it.length >= 4 && it.includes(tag.toLowerCase())) { aff += 0.6; affMatches++; break; }
        }
      }
    }
  }

  // Genericness penalty — applied harder when affinity is weak. A generic
  // catch-all pattern with zero affinity hits gets a strong penalty so a
  // semantically-aligned alternative wins; if it actually has 2+ affinity
  // matches the penalty is small (it's still a fit). This is what caps
  // Feature-Rich Showcase below 25% across the 161-industry distribution.
  let penalty = 0;
  if (affinity?.generic) {
    penalty = affMatches >= 3 ? -0.5
      : affMatches >= 1 ? -1.5
      : -3.0;
  }

  return base + kw + aff + penalty;
}

function findBestPattern(rule: IndustryRule): LandingPattern {
  const indTags = deriveIndustryTags(rule);
  const target = rule.landingPattern;

  let best: LandingPattern = LANDING_PATTERNS[0];
  let bestScore = -Infinity;
  for (const p of LANDING_PATTERNS) {
    const s = scorePattern(p, rule, indTags, target);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

function findBestStyle(rule: IndustryRule): UIStyle | null {
  if (rule.primaryStyles.length === 0) return null;
  const target = rule.primaryStyles[0].toLowerCase();
  for (const s of UI_STYLES) {
    if (target.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(target)) return s;
  }
  return null;
}

function googleFontsHrefFor(pairing: TypographyPairing): string | null {
  const heading = pairing.headingFont.replace(/\s+/g, '+');
  const body = pairing.bodyFont.replace(/\s+/g, '+');
  if (!heading) return null;
  // Build a clean Google Fonts URL with weights — we ignore the original
  // pairing.googleFontsUrl because it points at fonts.google.com/share
  // (a preview URL) instead of the css2 endpoint our <link rel="stylesheet">
  // tag needs.
  if (heading === body) {
    return `https://fonts.googleapis.com/css2?family=${heading}:wght@400;500;600;700&display=swap`;
  }
  return `https://fonts.googleapis.com/css2?family=${heading}:wght@500;600;700&family=${body}:wght@400;500;600;700&display=swap`;
}

function pickFontStack(font: string, fallback: 'sans' | 'serif' | 'mono' = 'sans'): string {
  const generic = fallback === 'serif'
    ? 'Georgia, "Times New Roman", serif'
    : fallback === 'mono'
      ? 'ui-monospace, "JetBrains Mono", "Fira Code", monospace'
      : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  if (!font) return generic;
  return `"${font}", ${generic}`;
}

function classifyFont(name: string): 'sans' | 'serif' | 'mono' {
  const n = name.toLowerCase();
  if (/(mono|code|jetbrains|fira|consolas|space mono|ibm plex mono)/.test(n)) return 'mono';
  if (/(playfair|lora|cormorant|crimson|libre baskerville|merriweather|garamond|cinzel|fraunces|serif)/.test(n)) return 'serif';
  return 'sans';
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = hex.replace('#', '');
  if (m.length !== 6) return null;
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
    case g: h = ((b - r) / d + 2); break;
    case b: h = ((r - g) / d + 4); break;
  }
  return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function adjustL(hex: string, deltaL: number): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  const l = Math.max(0, Math.min(100, hsl.l + deltaL));
  return `hsl(${hsl.h}, ${hsl.s}%, ${l}%)`;
}

export function resolveDesignTokens(input: DesignTokenInput): ResolvedDesignTokens {
  const slug = input.slug ?? input.industry.toLowerCase().replace(/\s+/g, '-');
  const density = DENSITIES[input.density ?? 'balanced'];

  const rule = findBestIndustry(input.industry);
  const pattern = findBestPattern(rule);
  const typography = findBestTypography(rule, input.mood);
  const style = findBestStyle(rule);

  // Fonts
  const headingClass = classifyFont(typography.headingFont);
  const bodyClass = classifyFont(typography.bodyFont);
  const headingStack = pickFontStack(typography.headingFont, headingClass);
  const bodyStack = pickFontStack(typography.bodyFont, bodyClass);
  const headingTransform = headingClass === 'mono' ? 'uppercase' : 'none';
  const headingLetterSpacing = headingClass === 'mono' ? '0.04em' : (headingClass === 'serif' ? '-0.015em' : '-0.022em');
  const headingWeight = headingClass === 'serif' ? 700 : 800;

  // Palette: use corpus hex if available, otherwise fall back to derived HSL.
  let palette: ResolvedTokens;
  let paletteSource: 'corpus' | 'derived';

  if (rule.palette) {
    paletteSource = 'corpus';
    const p = rule.palette;
    // Use the industry's PRIMARY brand colour as the page accent. Many corpus
    // rows share `#EA580C` as their CTA "accent" (it's a generic orange CTA),
    // but `primary` is the per-industry brand identity (e.g. rose for Dating
    // App, teal for Healthcare). We want each generated landing to feel
    // visually distinct, so the main accent/headline colour pulls from
    // `primary`, and `accentStrong` keeps the CTA orange where it adds
    // contrast.
    const brand = p.primary;
    const cta = p.accent || p.primary;
    const accentHsl = hexToHsl(brand);
    palette = {
      accent: brand,
      accentSoft: adjustL(brand, 40),
      accentStrong: cta,
      ink: p.foreground,
      inkSoft: p.mutedForeground,
      bg: p.background,
      bgElev: p.muted,
      line: p.border,
      darkAccent: accentHsl
        ? `hsl(${accentHsl.h}, ${Math.min(75, accentHsl.s + 5)}%, ${Math.min(70, accentHsl.l + 15)}%)`
        : p.accent,
      darkAccentSoft: 'hsl(220, 14%, 14%)',
      darkInk: 'hsl(220, 10%, 92%)',
      darkInkSoft: 'hsl(220, 8%, 65%)',
      darkBg: 'hsl(220, 16%, 8%)',
      darkBgElev: 'hsl(220, 14%, 11%)',
      darkLine: 'hsl(220, 12%, 18%)',
      headingStack,
      bodyStack,
      headingTransform,
      headingLetterSpacing,
      headingWeight,
      googleFontsHref: googleFontsHrefFor(typography),
      density,
    };
  } else {
    paletteSource = 'derived';
    const slugHue = deriveHueFromSlug(slug);
    palette = {
      accent: `hsl(${slugHue}, 60%, 45%)`,
      accentSoft: `hsl(${slugHue}, 30%, 96%)`,
      accentStrong: `hsl(${slugHue}, 60%, 35%)`,
      ink: 'hsl(220, 15%, 12%)',
      inkSoft: 'hsl(220, 9%, 45%)',
      bg: 'hsl(0, 0%, 100%)',
      bgElev: `hsl(${slugHue}, 30%, 98%)`,
      line: 'hsl(220, 13%, 91%)',
      darkAccent: `hsl(${slugHue}, 65%, 60%)`,
      darkAccentSoft: 'hsl(220, 14%, 14%)',
      darkInk: 'hsl(220, 10%, 92%)',
      darkInkSoft: 'hsl(220, 8%, 65%)',
      darkBg: 'hsl(220, 16%, 8%)',
      darkBgElev: 'hsl(220, 14%, 11%)',
      darkLine: 'hsl(220, 12%, 18%)',
      headingStack,
      bodyStack,
      headingTransform,
      headingLetterSpacing,
      headingWeight,
      googleFontsHref: googleFontsHrefFor(typography),
      density,
    };
  }

  return {
    ...palette,
    matchedIndustry: rule.name,
    matchedIndustryId: rule.id,
    matchedPattern: pattern.name,
    matchedTypography: typography.name,
    matchedStyle: style?.name ?? rule.primaryStyles[0] ?? null,
    considerations: rule.considerations,
    antiPatterns: rule.antiPatterns,
    paletteSource,
    rawPalette: rule.palette,
  };
}
