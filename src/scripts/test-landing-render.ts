/**
 * Offline smoke test for landing.ts after corpus wiring.
 *
 * Exercises the renderer (no LLM, no DB) against three diverse industry
 * inputs and prints divergence evidence: :root token block + hero h1.
 *
 *   node --env-file=.env.local --import tsx src/scripts/test-landing-render.ts
 *
 * Pass criteria:
 *   - 3 different border-radius values
 *   - 3 different heading font stacks
 *   - 3 different palette accents
 *   - 3 different family templates ideally (or at least different generators)
 */

import { resolveDesignTokens } from '@/lib/services/onboarding/shared/landing-design-tokens';
import { UI_STYLES } from '@/lib/services/onboarding/shared/landing-design-corpus';
import {
  renderLandingHtml,
  parseStyleVars,
  familyForPattern,
} from '@/lib/services/onboarding/shared/landing';

interface FixtureContent {
  brand: { name: string; tagline: string };
  hero: { headline: string; subhead: string };
  what_it_does: { heading: string; capabilities: Array<{ title: string; description: string }> };
  how_it_works: { heading: string; steps: Array<{ number: number; title: string; description: string }> };
  what_makes_different: { heading: string; points: string[] };
  closing: { headline: string; body: string };
}

function fixtureContent(brandName: string): FixtureContent {
  return {
    brand: { name: brandName, tagline: 'Built for serious work' },
    hero: { headline: 'A specific concrete headline', subhead: 'Sentence one explaining what this is for the people who need it. Sentence two on why it actually matters.' },
    what_it_does: {
      heading: 'What it does',
      capabilities: [
        { title: 'First capability', description: 'A concrete description of what the system does for the user.' },
        { title: 'Second capability', description: 'Another specific value proposition with no fluff.' },
        { title: 'Third capability', description: 'A third grounded behavior that ships at launch.' },
      ],
    },
    how_it_works: {
      heading: 'How it works',
      steps: [
        { number: 1, title: 'Step one', description: 'First concrete action the user takes.' },
        { number: 2, title: 'Step two', description: 'Second action moving the work forward.' },
        { number: 3, title: 'Step three', description: 'Third final action closing the loop.' },
      ],
    },
    what_makes_different: {
      heading: 'What makes this different',
      points: [
        'Specific positioning point that references a real gap.',
        'Another differentiator anchored in research.',
        'A third honest claim about what is unique.',
      ],
    },
    closing: { headline: 'Where this is headed', body: 'A standalone closing thought without any call to action attached.' },
  };
}

interface Fixture {
  label: string;
  brandName: string;
  industry: string;
  slug: string;
}

const fixtures: Fixture[] = [
  { label: 'dental clinic', brandName: 'Smileforge', industry: 'dental clinic family practice', slug: 'smileforge' },
  { label: 'fintech crypto', brandName: 'Vaultloop', industry: 'fintech crypto trading platform', slug: 'vaultloop' },
  { label: 'creative agency portfolio', brandName: 'Atelier Nine', industry: 'creative agency design studio portfolio', slug: 'atelier-nine' },
];

interface Snapshot {
  label: string;
  brand: string;
  industry: string;
  industryId: string;
  matchedStyle: string | null;
  matchedPattern: string;
  family: string;
  radius: string;
  shadow: string;
  transition: string;
  borderWidth: string;
  accent: string;
  headingStack: string;
  heroH1: string | null;
  rootBlock: string;
}

function extractRoot(html: string): string {
  const m = html.match(/:root\s*\{[\s\S]*?\}/);
  return m ? m[0] : '';
}

function extractHeroH1(html: string): string | null {
  const m = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  return m ? m[1] : null;
}

function snapshotFor(f: Fixture): Snapshot {
  const tokens = resolveDesignTokens({ industry: f.industry, slug: f.slug });
  const styleRow = UI_STYLES.find((s) => tokens.matchedStyle && s.name.toLowerCase() === tokens.matchedStyle.toLowerCase());
  const vars = parseStyleVars(styleRow?.designVars, tokens.matchedStyle);
  const family = familyForPattern(tokens.matchedPattern);
  const html = renderLandingHtml(fixtureContent(f.brandName), tokens, vars, family);

  return {
    label: f.label,
    brand: f.brandName,
    industry: f.industry,
    industryId: tokens.matchedIndustryId,
    matchedStyle: tokens.matchedStyle,
    matchedPattern: tokens.matchedPattern,
    family,
    radius: vars.radius,
    shadow: vars.shadow,
    transition: vars.transition,
    borderWidth: vars.borderWidth,
    accent: tokens.accent,
    headingStack: tokens.headingStack,
    heroH1: extractHeroH1(html),
    rootBlock: extractRoot(html),
  };
}

const snapshots = fixtures.map(snapshotFor);

for (const s of snapshots) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${s.label} (${s.brand}) ===`);
  // eslint-disable-next-line no-console
  console.log({
    industry: s.industryId,
    style: s.matchedStyle,
    pattern: s.matchedPattern,
    family: s.family,
    radius: s.radius,
    shadow: s.shadow.slice(0, 80),
    transition: s.transition,
    borderWidth: s.borderWidth,
    accent: s.accent,
    headingStack: s.headingStack.slice(0, 80),
    heroH1: s.heroH1,
  });
  // eslint-disable-next-line no-console
  console.log('--- :root block ---');
  // eslint-disable-next-line no-console
  console.log(s.rootBlock);
}

const radii = new Set(snapshots.map((s) => s.radius));
const fonts = new Set(snapshots.map((s) => s.headingStack));
const accents = new Set(snapshots.map((s) => s.accent));
const families = new Set(snapshots.map((s) => s.family));
const transitions = new Set(snapshots.map((s) => s.transition));

// eslint-disable-next-line no-console
console.log('\n=== Diversity check ===');
// eslint-disable-next-line no-console
console.log({
  distinctRadii: radii.size,
  distinctFonts: fonts.size,
  distinctAccents: accents.size,
  distinctFamilies: families.size,
  distinctTransitions: transitions.size,
  radii: [...radii],
  accents: [...accents],
  families: [...families],
});

const pass = radii.size >= 2 && fonts.size >= 2 && accents.size >= 3;
// eslint-disable-next-line no-console
console.log('\n=== Verdict ===');
// eslint-disable-next-line no-console
console.log(pass ? 'PASS — corpus reaches the rendered HTML' : 'FAIL — outputs too uniform');
if (!pass) process.exitCode = 1;
