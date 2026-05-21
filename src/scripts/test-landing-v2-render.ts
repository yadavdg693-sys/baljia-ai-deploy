// Quick smoke test: render each of the 3 v2 families with sample content,
// verify HTML is well-formed and the v2-distinctive markers show up.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-landing-v2-render.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderLandingHtml } from '@/lib/services/onboarding/shared/landing';
import { resolveDesignTokens } from '@/lib/services/onboarding/shared/landing-design-tokens';

const SAMPLE = {
  brand: { name: 'Plinqa', tagline: 'Effortless market intelligence' },
  hero: {
    headline: 'Know your market before your meeting starts.',
    subhead: 'Plinqa watches every signal across competitors, pricing, and customer review traffic — and surfaces only what changes the way you should operate today.',
  },
  what_it_does: {
    heading: 'What it does',
    capabilities: [
      { title: 'Continuous monitoring', description: 'Tracks 30+ signal sources across your category, every minute.' },
      { title: 'Insight summaries', description: 'Distills noise into the 3-5 things you should actually act on this week.' },
      { title: 'Competitor playbook deltas', description: 'Diffs your rivals\' moves against your live strategy and flags gaps.' },
    ],
  },
  how_it_works: {
    heading: 'How it works',
    steps: [
      { number: 1, title: 'Connect signals', description: 'Plug in the sources that matter — pricing pages, hiring boards, review feeds.' },
      { number: 2, title: 'Set your lens', description: 'Tell Plinqa which competitors and segments to watch closely.' },
      { number: 3, title: 'Get briefings', description: 'Receive a daily 5-minute briefing with the changes that matter for your decisions.' },
    ],
  },
  what_makes_different: {
    heading: 'Why this is different',
    points: [
      'Built for operators, not analysts. Insights, not dashboards.',
      'Signal-to-noise is our north star — 80% of feeds are filtered before you see them.',
      'Pre-launch by design. We move when the market moves, not on a quarterly review cycle.',
    ],
  },
  closing: {
    headline: 'Stop scrolling. Start operating.',
    body: 'Plinqa runs in the background and only interrupts you when it should. Built in India.',
  },
};

const FAMILIES = [
  'utility-cards',
  'editorial',
  'narrative',
  'narrative-stacked',
  'magazine-grid',
  'comparison-led',
] as const;
const OUT_DIR = join(process.cwd(), 'tmp-landing-v2-samples');

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log('═══ Rendering v2 family samples ═══\n');

  // Use a generic SaaS industry token set for all three
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
    const html = renderLandingHtml(SAMPLE, tokens, vars as any, family as any);
    const path = join(OUT_DIR, `${family}.html`);
    writeFileSync(path, html, 'utf-8');

    const v2Markers = {
      'utility-cards': /border-left:\s*3px\s+solid\s+var\(--accent\)/,  // v2 cards have left-edge accent
      'editorial': /\.divider/,                                            // v2 editorial uses thin accent dividers
      'narrative': /\.chapter--accent|\.how-band/,                         // v2 narrative has alternating bands
      'narrative-stacked': /\.narr-quote::before/,                         // v2 narr-stacked: typographic dash, no boxed quote
      'magazine-grid': /\.mag-sidebar::before|\.mag-cell--lead\s*\{[^}]*border-left:\s*4px/,  // v2 mag: sidebar accent top-bar + lead cell accent rule
      'comparison-led': /table\.cmp-matrix\s*\{[^}]*border:\s*none/,       // v2 cmp: tables stay, outer border gone
    }[family];

    const matches = v2Markers.test(html);
    console.log(`  ${family.padEnd(14)} ${matches ? '✓' : '✗'} ${html.length} bytes  → ${path}`);
    if (!matches) {
      console.log(`    expected pattern: ${v2Markers.source}`);
    }
  }

  console.log(`\nOpen the files in your browser to inspect:`);
  console.log(`  start ${join(OUT_DIR, 'utility-cards.html')}`);
  console.log(`  start ${join(OUT_DIR, 'editorial.html')}`);
  console.log(`  start ${join(OUT_DIR, 'narrative.html')}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
