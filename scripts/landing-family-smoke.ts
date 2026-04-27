// Offline smoke test: render the 5 families against a fake content payload.
// Verifies that each family produces visibly distinct markup signatures.
import { renderLandingHtml } from '../src/lib/services/onboarding/shared/landing';
import { resolveDesignTokens } from '../src/lib/services/onboarding/shared/landing-design-tokens';

const fakeContent = {
  brand: { name: 'Polsia', tagline: 'AI-built saas for product teams' },
  hero: { headline: 'Plan, ship, and learn faster', subhead: 'Polsia is an autonomous teammate. It writes briefs, ships rough demos, and reports what users actually do.' },
  what_it_does: {
    heading: 'What it does',
    capabilities: [
      { title: 'Auto-briefs the team', description: 'Reads the channel, drafts a one-page brief by Monday morning.' },
      { title: 'Ships the rough demo', description: 'Compiles a clickable mock from your spec without engineering toil.' },
      { title: 'Reports usage truth', description: 'Tells you what real users clicked, not what dashboards say they did.' },
    ],
  },
  how_it_works: {
    heading: 'How it works',
    steps: [
      { number: 1, title: 'Drop the idea', description: 'Paste a slack thread, voice memo, or one-liner.' },
      { number: 2, title: 'Polsia plans', description: 'Drafts the brief and checks it against goals.' },
      { number: 3, title: 'Ship the demo', description: 'Auto-deploys a clickable mock to your subdomain.' },
    ],
  },
  what_makes_different: {
    heading: 'What makes this different',
    points: [
      'No PM meetings — Polsia reads channels and drafts the brief itself.',
      'Demo-first — every spec ships a working mock by default.',
      'Honest usage — counts real clicks, ignores vanity dashboards.',
    ],
  },
  closing: { headline: 'Move faster, with fewer planning cycles', body: 'Built in India. Designed for global product teams.' },
};

const tokens = resolveDesignTokens({ industry: 'productivity', slug: 'polsia' });
const styleVars = { radius: '12px', shadow: '0 4px 12px rgba(0,0,0,0.08)', transition: '200ms ease', borderWidth: '1px' };

const families = ['utility-cards', 'editorial', 'narrative', 'narrative-stacked', 'magazine-grid', 'comparison-led'] as const;
for (const fam of families) {
  const html = renderLandingHtml(fakeContent, tokens, styleVars, fam);
  const sig = (() => {
    const matches: string[] = [];
    if (/class="cards"/.test(html)) matches.push('utility-cards:cards');
    if (/class="ed-caps"/.test(html)) matches.push('editorial:ed-caps');
    if (/class="nv-how"/.test(html) || /class="nv-cap"/.test(html)) matches.push('narrative:nv-*');
    if (/class="narr-section/.test(html)) matches.push('narrative-stacked:narr-section');
    if (/class="mag-grid"/.test(html) || /class="mag-flow"/.test(html)) matches.push('magazine-grid:mag-*');
    if (/class="cmp-matrix"/.test(html) || /class="cmp-table"/.test(html)) matches.push('comparison-led:cmp-*');
    return matches.join(', ');
  })();
  console.log(`${fam.padEnd(20)} ${html.length.toString().padStart(7)} bytes  signatures: ${sig || '(none)'}`);
}
