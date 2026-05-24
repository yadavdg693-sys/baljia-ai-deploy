// Quick smoke test: render every v2 family plus category-specific onboarding
// preview fixtures, then verify the V2 preview artifact is present.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-landing-v2-render.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderLandingHtml } from '@/lib/services/onboarding/shared/landing';
import { resolveDesignTokens } from '@/lib/services/onboarding/shared/landing-design-tokens';
import type { LandingArtifactKind, LandingTemplateKind } from '@/lib/services/onboarding/shared/landing-template-kind';

type Fixture = {
  brand: { name: string; tagline: string };
  hero: { headline: string; subhead: string };
  template_kind: LandingTemplateKind;
  preview_summary: { audience: string; problem: string; positioning: string };
  artifact: {
    kind: LandingArtifactKind;
    title: string;
    items: Array<{ label: string; value: string; detail: string }>;
  };
  generator_version: 'v2';
  source_idea_hash: string;
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
};

const BASE: Fixture = {
  brand: { name: 'Plinqa', tagline: 'Market intelligence for lean product teams' },
  hero: {
    headline: 'Know your market before the meeting.',
    subhead: 'Plinqa turns competitor, pricing, hiring, and review signals into a daily operating brief. Teams see the moves that should change decisions now.',
  },
  template_kind: 'saas',
  preview_summary: {
    audience: 'Lean product and GTM teams',
    problem: 'Market changes hide across too many sources',
    positioning: 'A focused briefing layer instead of another analytics wall',
  },
  artifact: {
    kind: 'pipeline_board',
    title: 'Signal Priority Board',
    items: [
      { label: 'Pricing', value: 'Rival raised Pro tier', detail: 'Flagged for packaging review before sales calls.' },
      { label: 'Hiring', value: 'Enterprise AE roles added', detail: 'Suggests expansion into larger accounts this quarter.' },
      { label: 'Reviews', value: 'Setup friction spiking', detail: 'Opportunity to lead with easier onboarding proof.' },
      { label: 'Content', value: 'Compliance theme rising', detail: 'Update outbound angle for regulated buyers.' },
    ],
  },
  generator_version: 'v2',
  source_idea_hash: 'fixture001',
  what_it_does: {
    heading: 'What it does',
    capabilities: [
      { title: 'Track live signals', description: 'Monitors competitor pages, review feeds, hiring posts, and product updates without asking the team to hunt.' },
      { title: 'Rank operating impact', description: 'Turns every change into a short explanation of why it matters and who should act.' },
      { title: 'Prepare daily briefs', description: 'Packages the strongest signals into a five-minute read for product, sales, and strategy leads.' },
    ],
  },
  how_it_works: {
    heading: 'How it works',
    steps: [
      { number: 1, title: 'Connect sources', description: 'Choose competitors, channels, segments, and the signals worth watching.' },
      { number: 2, title: 'Set the lens', description: 'Define what counts as urgent for pricing, positioning, sales, product, or hiring.' },
      { number: 3, title: 'Read the brief', description: 'Receive a concise board that shows what changed and the next decision to consider.' },
    ],
  },
  what_makes_different: {
    heading: 'Why this is different',
    points: [
      'Built for operators who need judgment, not a larger dashboard.',
      'Every signal is tied to a decision so the page feels useful on day zero.',
      'The preview shows a tangible system without pretending the final product is already built.',
    ],
  },
  closing: {
    headline: 'A preview with enough shape to build from.',
    body: 'This generated page gives the founder a vivid first impression while the engineering plan still follows the canonical onboarding brief.',
  },
};

const CATEGORY_FIXTURES: Fixture[] = [
  BASE,
  {
    ...BASE,
    brand: { name: 'BrightBay Home Care', tagline: 'Trusted bookings for neighborhood home services' },
    hero: {
      headline: 'Turn service calls into booked visits.',
      subhead: 'BrightBay helps local home-service teams present availability, trust proof, and visit options clearly. Customers can understand the offer before they call.',
    },
    template_kind: 'local_service',
    preview_summary: {
      audience: 'Busy homeowners needing fast help',
      problem: 'Calls arrive without context or clear availability',
      positioning: 'A booking-first preview that reduces buyer hesitation',
    },
    artifact: {
      kind: 'booking_flow',
      title: 'Next Booking Flow',
      items: [
        { label: 'Step 1', value: 'Choose service', detail: 'Emergency repair, maintenance, or quote visit.' },
        { label: 'Step 2', value: 'Pick time window', detail: 'Shows same-day and next-day options first.' },
        { label: 'Step 3', value: 'Confirm details', detail: 'Collects address, issue notes, and photo upload.' },
      ],
    },
    source_idea_hash: 'fixture002',
  },
  {
    ...BASE,
    brand: { name: 'MoriDrop', tagline: 'Curated weekly drops for design collectors' },
    hero: {
      headline: 'Make every product drop feel deliberate.',
      subhead: 'MoriDrop organizes limited releases into a crisp storefront story. Shoppers see what is new, scarce, and worth saving before checkout exists.',
    },
    template_kind: 'ecommerce',
    preview_summary: {
      audience: 'Design collectors following limited releases',
      problem: 'New products feel scattered instead of collectible',
      positioning: 'A drop-led storefront preview with clear buying intent',
    },
    artifact: {
      kind: 'storefront_drop',
      title: 'Friday Drop Shelf',
      items: [
        { label: 'Hero', value: 'Walnut desk lamp', detail: 'Limited run, highlighted as the anchor product.' },
        { label: 'Bundle', value: 'Lamp plus cable tray', detail: 'Pairs the main drop with a practical add-on.' },
        { label: 'Waitlist', value: 'Archive restock', detail: 'Captures demand without making a fake sales promise.' },
      ],
    },
    source_idea_hash: 'fixture003',
  },
  {
    ...BASE,
    brand: { name: 'FounderTempo', tagline: 'Structured coaching for first-time operators' },
    hero: {
      headline: 'Give founders a weekly operating rhythm.',
      subhead: 'FounderTempo turns messy goals into a coaching map, practice blocks, and decision prompts. The preview shows how momentum becomes visible.',
    },
    template_kind: 'content_coaching',
    preview_summary: {
      audience: 'First-time founders seeking operating clarity',
      problem: 'Advice stays abstract after calls end',
      positioning: 'A coaching map that makes weekly progress inspectable',
    },
    artifact: {
      kind: 'coaching_map',
      title: 'Four Week Focus Map',
      items: [
        { label: 'Week 1', value: 'Revenue baseline', detail: 'Clarify offers, constraints, and current conversion gaps.' },
        { label: 'Week 2', value: 'Pipeline habits', detail: 'Build a repeatable outreach and follow-up cadence.' },
        { label: 'Week 3', value: 'Decision loop', detail: 'Install a weekly review for experiments and blockers.' },
        { label: 'Week 4', value: 'Next sprint', detail: 'Turn learnings into the next focused operating cycle.' },
      ],
    },
    source_idea_hash: 'fixture004',
  },
  {
    ...BASE,
    brand: { name: 'VenuePair', tagline: 'Better matches for pop-up events' },
    hero: {
      headline: 'Match every pop-up with the right room.',
      subhead: 'VenuePair previews how brands, hosts, and constraints line up before booking work begins. The first screen makes the marketplace feel concrete.',
    },
    template_kind: 'marketplace',
    preview_summary: {
      audience: 'Brands and venues planning pop-up events',
      problem: 'Good matches require too much manual sorting',
      positioning: 'A match board that explains fit before outreach',
    },
    artifact: {
      kind: 'marketplace_match',
      title: 'Live Match Board',
      items: [
        { label: 'Brand', value: 'Sora Coffee', detail: 'Fits weekend foot traffic and premium retail adjacency.' },
        { label: 'Venue', value: 'Foundry Hall', detail: 'Available Saturday, strong lighting, 140-person capacity.' },
        { label: 'Fit', value: '92 percent', detail: 'Audience, timing, capacity, and budget align.' },
      ],
    },
    source_idea_hash: 'fixture005',
  },
  {
    ...BASE,
    brand: { name: 'Aster Dental Studio', tagline: 'Patient growth for premium local clinics' },
    hero: {
      headline: 'Show the clinic growth plan clearly.',
      subhead: 'Aster Dental Studio can preview its strongest service lines, trust gaps, and patient conversion opportunities. The page frames growth without pretending to be a new product.',
    },
    template_kind: 'existing_business',
    preview_summary: {
      audience: 'Local patients comparing premium dental care',
      problem: 'Service value is hard to judge before calling',
      positioning: 'A growth snapshot grounded in the current clinic',
    },
    artifact: {
      kind: 'growth_snapshot',
      title: 'Patient Growth Snapshot',
      items: [
        { label: 'Implants', value: 'High intent page', detail: 'Add comparison proof and recovery expectations.' },
        { label: 'Whitening', value: 'Seasonal offer', detail: 'Bundle consultation with smile assessment.' },
        { label: 'Reviews', value: 'Trust gap', detail: 'Surface dentist names and recent patient quotes.' },
      ],
    },
    source_idea_hash: 'fixture006',
  },
];

const FAMILIES = [
  'utility-cards',
  'editorial',
  'narrative',
  'narrative-stacked',
  'magazine-grid',
  'comparison-led',
] as const;

const OUT_DIR = join(process.cwd(), 'tmp-landing-v2-samples');
const CATEGORY_DIR = join(OUT_DIR, 'categories');

function assertMarker(html: string, label: string, pattern: RegExp): void {
  if (!pattern.test(html)) {
    throw new Error(`${label} did not include expected marker: ${pattern.source}`);
  }
}

function assertNoForbiddenPreviewPurple(html: string, label: string): void {
  const forbidden = /#(?:6366f1|4f46e5|4338ca|3730a3|8b5cf6|7c3aed|a855f7|818cf8|f5f3ff|1e1b4b|e0e7ff)\b/i;
  if (forbidden.test(html)) {
    throw new Error(`${label} included a default purple/indigo preview palette.`);
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(CATEGORY_DIR, { recursive: true });
  console.log('Rendering V2 onboarding preview samples\n');

  const tokens = resolveDesignTokens({
    industry: 'SaaS productivity',
    mood: 'modern',
    density: 'balanced',
    slug: 'plinqa',
  });
  const vars = {
    radius: '8px',
    shadow: 'none',
    transition: '0.2s ease',
    borderWidth: '1px',
  };

  for (const family of FAMILIES) {
    const html = renderLandingHtml(BASE, tokens, vars as any, family as any);
    const path = join(OUT_DIR, `${family}.html`);
    writeFileSync(path, html, 'utf-8');

    const v2Markers = {
      'utility-cards': /border-top:\s*3px\s+solid\s+var\(--accent\)/,
      'editorial': /\.divider/,
      'narrative': /\.chapter--accent|\.how-band/,
      'narrative-stacked': /\.narr-quote::before/,
      'magazine-grid': /\.mag-sidebar::before|\.mag-cell--lead\s*\{[^}]*border-left:\s*4px/,
      'comparison-led': /table\.cmp-matrix\s*\{[^}]*border:\s*none/,
    }[family];

    assertMarker(html, family, v2Markers);
    assertMarker(html, `${family} preview artifact`, /data-preview-artifact="pipeline_board"/);
    assertMarker(html, `${family} generator meta`, /x-baljia-generator-version" content="v2"/);
    console.log(`  ${family.padEnd(16)} OK ${html.length} bytes -> ${path}`);
  }

  const categoryTokens = resolveDesignTokens({
    industry: 'Generic onboarding preview',
    mood: 'clear',
    density: 'balanced',
    slug: 'generic-preview',
  });

  for (const fixture of CATEGORY_FIXTURES) {
    const html = renderLandingHtml(fixture, categoryTokens, vars as any, 'utility-cards' as any);
    const path = join(CATEGORY_DIR, `${fixture.template_kind}.html`);
    writeFileSync(path, html, 'utf-8');
    assertMarker(html, fixture.template_kind, new RegExp(`data-preview-artifact="${fixture.artifact.kind}"`));
    assertNoForbiddenPreviewPurple(html, fixture.template_kind);
    console.log(`  ${fixture.template_kind.padEnd(16)} OK ${html.length} bytes -> ${path}`);
  }

  const microSaasTokens = resolveDesignTokens({
    industry: 'micro saas software app',
    mood: 'energetic',
    density: 'balanced',
    slug: 'micro-saas-preview',
  });
  const microSaasHtml = renderLandingHtml({
    ...BASE,
    brand: { name: 'MicroSaaS Guard', tagline: 'Palette guard fixture for onboarding previews' },
    source_idea_hash: 'fixture007',
  }, microSaasTokens, vars as any, 'utility-cards' as any);
  const microSaasPath = join(CATEGORY_DIR, 'micro_saas_palette.html');
  writeFileSync(microSaasPath, microSaasHtml, 'utf-8');
  assertMarker(microSaasHtml, 'micro_saas_palette preview artifact', /data-preview-artifact="pipeline_board"/);
  assertNoForbiddenPreviewPurple(microSaasHtml, 'micro_saas_palette');
  console.log(`  ${'micro_saas_palette'.padEnd(16)} OK ${microSaasHtml.length} bytes -> ${microSaasPath}`);

  console.log('\nOpen the main fixture in your browser to inspect:');
  console.log(`  start ${join(OUT_DIR, 'utility-cards.html')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
