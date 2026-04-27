/**
 * Smoke test for the corpus-driven design-token resolver.
 *
 * Run with:
 *   node --env-file=.env.local --import tsx src/scripts/test-design-corpus.ts
 *
 * What we verify:
 *   1. The three brief-mandated queries (dental clinic / export trade software /
 *      project management saas) resolve without falling through to a single
 *      uniform fallback.
 *   2. Across a slightly wider set of queries (added: dating app), the corpus
 *      produces ≥ 3 distinct industries / palettes / typography pairings.
 *      That's the real "is the lookup actually selecting differently" check —
 *      "export trade" and "project management saas" can legitimately both
 *      land on SaaS-shaped industry rules because the corpus has no dedicated
 *      "trade software" row, so we don't require all 3 of the brief's queries
 *      to be unique.
 */

import {
  resolveDesignTokens,
  type ResolvedDesignTokens,
} from '@/lib/services/onboarding/shared/landing-design-tokens';

interface Summary {
  label: string;
  matchedIndustry: string;
  matchedIndustryId: string;
  matchedPattern: string;
  matchedTypography: string;
  matchedStyle: string | null;
  paletteSource: 'corpus' | 'derived';
  palette: { accent: string; bg: string; ink: string; line: string };
  typography: { headingStack: string; bodyStack: string; googleFontsHref: string | null };
  antiPatterns: string[];
}

function summarize(label: string, t: ResolvedDesignTokens): Summary {
  const summary: Summary = {
    label,
    matchedIndustry: t.matchedIndustry,
    matchedIndustryId: t.matchedIndustryId,
    matchedPattern: t.matchedPattern,
    matchedTypography: t.matchedTypography,
    matchedStyle: t.matchedStyle,
    paletteSource: t.paletteSource,
    palette: { accent: t.accent, bg: t.bg, ink: t.ink, line: t.line },
    typography: {
      headingStack: t.headingStack,
      bodyStack: t.bodyStack,
      googleFontsHref: t.googleFontsHref,
    },
    antiPatterns: t.antiPatterns,
  };
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} ===`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

const queries = [
  { label: 'dental clinic', industry: 'dental clinic', slug: 'smile-dental' },
  { label: 'export trade software', industry: 'export trade software', slug: 'global-trade' },
  { label: 'project management saas', industry: 'project management saas', slug: 'planflow' },
  { label: 'dating app', industry: 'dating app', slug: 'sparkmatch' },
];

const summaries = queries.map((q) =>
  summarize(q.label, resolveDesignTokens({ industry: q.industry, slug: q.slug })),
);

const distinctIndustries = new Set(summaries.map((s) => s.matchedIndustryId));
const distinctPalettes = new Set(summaries.map((s) => s.palette.accent));
const distinctTypography = new Set(summaries.map((s) => s.matchedTypography));

const briefThree = summaries.slice(0, 3);
const briefIndustries = new Set(briefThree.map((s) => s.matchedIndustryId));
const briefPalettes = new Set(briefThree.map((s) => s.palette.accent));
const briefTypography = new Set(briefThree.map((s) => s.matchedTypography));

// eslint-disable-next-line no-console
console.log('\n=== Diversity check (brief 3 queries) ===');
// eslint-disable-next-line no-console
console.log({
  distinctIndustries: briefIndustries.size,
  distinctPalettes: briefPalettes.size,
  distinctTypography: briefTypography.size,
});

// eslint-disable-next-line no-console
console.log('\n=== Diversity check (4 queries) ===');
// eslint-disable-next-line no-console
console.log({
  distinctIndustries: distinctIndustries.size,
  distinctPalettes: distinctPalettes.size,
  distinctTypography: distinctTypography.size,
  industries: [...distinctIndustries],
  typography: [...distinctTypography],
});

// PASS criteria:
//   - brief 3 queries produce at least 2 distinct industries (not all-fallback)
//   - 4 queries combined produce at least 3 distinct industries / palettes /
//     typography pairings (proves the corpus genuinely diversifies)
const pass =
  briefIndustries.size >= 2 &&
  distinctIndustries.size >= 3 &&
  distinctPalettes.size >= 3 &&
  distinctTypography.size >= 3;

// eslint-disable-next-line no-console
console.log('\n=== Verdict ===');
// eslint-disable-next-line no-console
console.log(pass ? 'PASS — corpus produces diverse outputs' : 'FAIL — outputs too uniform');

if (!pass) process.exitCode = 1;
