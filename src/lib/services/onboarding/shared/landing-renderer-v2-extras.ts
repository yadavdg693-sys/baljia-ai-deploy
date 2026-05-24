// landing-renderer-v2-extras.ts — v2 versions of the remaining 3 families.
// Companion to landing-renderer-v2.ts (which covers utility/editorial/narrative).
// Drops the boxy template look from narrative-stacked, magazine-grid, comparison-led.
//
// Same drop-in pattern: each {familyName}V2Styles + {familyName}V2Body pair
// can replace the corresponding render*() body in landing.ts with a 1-liner.

import {
  hasLandingPreview,
  renderPreviewArtifact,
  renderPreviewArtifactStyles,
  renderPreviewProofRail,
  type LandingPreviewContent,
} from './landing-preview-artifacts';

type LandingContent = LandingPreviewContent & {
  brand: { name: string; tagline: string };
  hero: { headline: string; subhead: string };
  what_it_does: { heading: string; capabilities: Array<{ title: string; description: string }> };
  how_it_works: { heading: string; steps: Array<{ number: number; title: string; description: string }> };
  what_makes_different: { heading: string; points: string[] };
  closing: { headline: string; body: string };
};

// ═══════════════════════════════════════════════════════
// NARRATIVE-STACKED v2 — preserve alternating bands + dark how-band, but
// kill the boxy pull-quote treatment. Quotes become hanging-indent typography
// with an accent leading dash, not bg+border-left rectangles.
// ═══════════════════════════════════════════════════════

export function narrativeStackedV2Styles(preview = false): string {
  return `.wrap { max-width: 100%; margin: 0; padding: 0; }
.narr-header { padding: 56px var(--container-px) 24px; max-width: 880px; margin: 0 auto; }
.narr-hero { padding: 96px var(--container-px) 80px; max-width: 880px; margin: 0 auto; }
.narr-hero h1 { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-weight: var(--heading-w); font-size: clamp(48px, 9vw, 96px); line-height: 0.96; margin: 0 0 32px; max-width: 16ch; }
.narr-hero p { font-size: 22px; line-height: 1.5; max-width: 52ch; margin: 0; opacity: 0.85; }

/* Alternating full-bleed sections — kept, this works */
.narr-section { padding: clamp(80px, 12vw, 140px) 0; }
.narr-section--even { background: var(--bg); color: var(--ink); }
.narr-section--odd { background: var(--accent-soft); color: var(--ink); }
.narr-section-inner { max-width: 880px; margin: 0 auto; padding: 0 var(--container-px); }
.narr-prefix { font-family: var(--font-heading); font-size: 14px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); margin-bottom: 24px; opacity: 0.95; }
.narr-h { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-weight: var(--heading-w); font-size: clamp(36px, 6vw, 64px); line-height: 1.04; margin: 0 0 28px; max-width: 18ch; }
.narr-p { font-size: 20px; line-height: 1.55; max-width: 56ch; margin: 0; opacity: 0.88; }

/* Dark "how" band — kept, but border between steps becomes subtler */
.narr-how { background: var(--ink); color: var(--bg); padding: clamp(80px, 12vw, 140px) 0; }
.narr-how-inner { max-width: 880px; margin: 0 auto; padding: 0 var(--container-px); }
.narr-how h2 { font-family: var(--font-heading); text-transform: uppercase; letter-spacing: 0.16em; font-size: 12px; opacity: 0.7; margin: 0 0 64px; color: var(--bg); }
ol.narr-steps { list-style: none; padding: 0; margin: 0; }
.narr-step { display: grid; grid-template-columns: 96px 1fr; gap: 24px; padding: 40px 0; border-top: 1px solid color-mix(in srgb, var(--bg) 12%, transparent); }
.narr-step:first-child { border-top: 0; padding-top: 0; }
.narr-step-num { font-family: var(--font-heading); font-size: clamp(54px, 8vw, 84px); line-height: 0.85; opacity: 0.4; font-weight: var(--heading-w); color: var(--accent); }
.narr-step-body h3 { font-family: var(--font-heading); font-size: clamp(22px, 3vw, 28px); margin: 0 0 10px; font-weight: var(--heading-w); }
.narr-step-body p { font-size: 18px; line-height: 1.55; opacity: 0.78; margin: 0; max-width: 50ch; }

/* Differentiators — typographic pull-quotes, NO bg + NO border-left box */
.narr-diff { padding: clamp(80px, 12vw, 140px) 0; background: var(--accent-soft); }
.narr-diff-inner { max-width: 880px; margin: 0 auto; padding: 0 var(--container-px); }
.narr-diff h2 { font-family: var(--font-heading); text-transform: uppercase; letter-spacing: 0.16em; font-size: 12px; opacity: 0.65; margin: 0 0 64px; color: var(--ink); }
.narr-quote {
  margin: 0 0 48px;
  padding: 0;
  background: transparent;
  border: none;
  position: relative;
  padding-left: 32px;
}
.narr-quote::before {
  content: "—";
  position: absolute;
  left: 0; top: 0;
  font-family: var(--font-heading);
  color: var(--accent);
  font-size: clamp(22px, 3vw, 30px);
  font-weight: 700;
  line-height: 1.35;
}
.narr-quote p {
  font-family: var(--font-heading);
  font-style: italic;
  font-size: clamp(22px, 3vw, 30px);
  line-height: 1.35;
  margin: 0;
  max-width: 36ch;
  font-weight: 500;
}

/* Closing — full accent band, kept */
.narr-closing { padding: clamp(120px, 16vw, 200px) 0; background: var(--accent); color: var(--bg); }
.narr-closing-inner { max-width: 880px; margin: 0 auto; padding: 0 var(--container-px); text-align: left; }
.narr-closing h2 { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-weight: var(--heading-w); font-size: clamp(40px, 7vw, 76px); line-height: 1.04; margin: 0 0 24px; max-width: 18ch; color: var(--bg); }
.narr-closing p { font-size: 20px; line-height: 1.55; max-width: 52ch; margin: 0; opacity: 0.92; color: var(--bg); }

.narr-footer { padding: 32px var(--container-px) 48px; max-width: 880px; margin: 0 auto; font-size: 13px; color: var(--ink-soft); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.narr-footer a { color: var(--ink-soft); text-decoration: none; }
.narr-footer a:hover { color: var(--accent); }
${preview ? renderPreviewArtifactStyles() : ''}`;
}

export function narrativeStackedV2Body(content: LandingContent, year: number, esc: (s: string) => string): string {
  const capSections = content.what_it_does.capabilities
    .map((c, i) => `
      <section class="narr-section narr-section--${i % 2 === 0 ? 'even' : 'odd'}" id="${i === 0 ? 'what' : ''}">
        <div class="narr-section-inner">
          <div class="narr-prefix">${(i + 1).toString().padStart(2, '0')}</div>
          <h2 class="narr-h">${esc(c.title)}</h2>
          <p class="narr-p">${esc(c.description)}</p>
        </div>
      </section>`).join('');
  const stepFlow = content.how_it_works.steps
    .map((s) => `
      <li class="narr-step">
        <span class="narr-step-num">${s.number}</span>
        <div class="narr-step-body">
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.description)}</p>
        </div>
      </li>`).join('');
  const pullQuotes = content.what_makes_different.points
    .map((p) => `<blockquote class="narr-quote"><p>${esc(p)}</p></blockquote>`).join('');
  const preview = hasLandingPreview(content);

  return `<div class="wrap">
  <header class="narr-header">
    <div class="brand">${esc(content.brand.name)}</div>
    <div class="brand-tag">${esc(content.brand.tagline)}</div>
  </header>
  <div class="narr-hero${preview ? ' preview-hero' : ''}" id="hero">
    ${preview ? `<div class="preview-copy">
      <h1>${esc(content.hero.headline)}</h1>
      <p>${esc(content.hero.subhead)}</p>
      ${renderPreviewProofRail(content, esc)}
    </div>
    ${renderPreviewArtifact(content, esc)}` : `<h1>${esc(content.hero.headline)}</h1>
    <p>${esc(content.hero.subhead)}</p>`}
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
}


// ═══════════════════════════════════════════════════════
// MAGAZINE-GRID v2 — keep the publication aesthetic but kill the bordered cells
// and bordered sidebar. Hierarchy comes from type scale + accent tags + bg-tone
// shift, NOT from outline-bordered boxes.
// ═══════════════════════════════════════════════════════

export function magazineGridV2Styles(preview = false): string {
  return `.wrap { max-width: 1200px; margin: 0 auto; padding: 0 var(--container-px); }

/* Header — minimal rule, no box */
header.mag-header {
  padding: 32px 0 24px;
  display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
}
.mag-meta-strip { font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-soft); }

/* Hero — sidebar uses thin accent top-bar instead of left-border box */
.mag-hero {
  display: grid; grid-template-columns: 1.4fr 1fr;
  gap: 64px; padding: 80px 0 64px;
  border-bottom: none;
}
.mag-hero h1 { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-weight: var(--heading-w); font-size: clamp(48px, 7.5vw, 88px); line-height: 1.0; margin: 0 0 32px; max-width: 18ch; }
.mag-hero p { font-size: 20px; line-height: 1.5; max-width: 50ch; margin: 0; opacity: 0.78; }
.mag-sidebar {
  border-left: none;
  padding-left: 0;
  font-family: var(--font-heading);
  position: relative;
  padding-top: 16px;
}
.mag-sidebar::before {
  content: "";
  position: absolute; top: 0; left: 0;
  width: 32px; height: 2px; background: var(--accent);
}
.mag-sidebar dt { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); margin-top: 18px; }
.mag-sidebar dt:first-of-type { margin-top: 0; }
.mag-sidebar dd { font-size: 16px; margin: 4px 0 0; color: var(--ink); font-family: var(--font-body); }

/* Section — no bottom border; subtle accent label instead */
.mag-section { padding: clamp(64px, 9vw, 112px) 0; border-bottom: none; }
.mag-section h2 {
  font-family: var(--font-heading); text-transform: uppercase;
  letter-spacing: 0.16em; font-size: 12px; color: var(--accent);
  margin: 0 0 48px; font-weight: var(--heading-w);
  display: flex; align-items: center; gap: 12px;
}
.mag-section h2::before {
  content: ""; width: 24px; height: 1px; background: var(--accent);
}

/* Capability grid — NO cell borders, use bg-tone + accent tag for hierarchy */
.mag-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 32px; }
.mag-cell {
  padding: 32px 28px;
  background: transparent;
  border: none;
  border-radius: 0;
  transition: background var(--transition);
}
.mag-cell:hover { background: var(--accent-soft); }
.mag-cell--lead {
  grid-row: span 2;
  padding: 40px 36px;
  display: flex; flex-direction: column; justify-content: space-between;
  min-height: 320px;
  background: var(--accent-soft);
  border-left: 4px solid var(--accent);
}
.mag-cell--lead h3 { font-family: var(--font-heading); font-size: clamp(32px, 4vw, 48px); margin: 0 0 16px; font-weight: var(--heading-w); letter-spacing: var(--heading-ls); line-height: 1.05; }
.mag-cell--lead p { font-size: 18px; line-height: 1.55; opacity: 0.85; margin: 0; }
.mag-cell-stack { display: grid; gap: 12px; }
.mag-cell--small { border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); padding: 24px 0; }
.mag-cell--small:last-child { border-bottom: none; }
.mag-cell-tag { display: block; font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
.mag-cell--small h3 { font-family: var(--font-heading); font-size: 20px; margin: 0 0 8px; font-weight: var(--heading-w); }
.mag-cell--small p { font-size: 16px; line-height: 1.55; opacity: 0.78; margin: 0; }

/* How-it-works flow — top accent rule per step, no box */
.mag-flow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px; }
.mag-step { padding-top: 20px; border-top: 3px solid var(--accent); }
.mag-step-kicker { font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); display: block; margin-bottom: 14px; }
.mag-step h3 { font-family: var(--font-heading); font-size: clamp(22px, 2.5vw, 26px); margin: 0 0 12px; font-weight: var(--heading-w); line-height: 1.2; }
.mag-step p { font-size: 16px; line-height: 1.55; opacity: 0.82; margin: 0; }

/* Statements — pure typography, NO bordered columns */
.mag-statements { display: grid; grid-template-columns: repeat(3, 1fr); gap: 48px; }
.mag-stmt { padding: 0; border-left: none; }
.mag-stmt-num { font-family: var(--font-heading); font-size: clamp(48px, 6vw, 72px); color: var(--accent); display: block; line-height: 1; margin-bottom: 20px; font-weight: var(--heading-w); opacity: 0.4; }
.mag-stmt p { font-family: var(--font-heading); font-size: clamp(22px, 2.6vw, 28px); line-height: 1.25; margin: 0; font-weight: 500; max-width: 18ch; }

/* Closing — asymmetric two-up with accent rule */
.mag-closing {
  padding: clamp(80px, 11vw, 128px) 0 clamp(64px, 9vw, 96px);
  display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: end;
  border-top: 3px solid var(--accent);
}
.mag-closing h2 { font-family: var(--font-heading); text-transform: var(--heading-tt); letter-spacing: var(--heading-ls); font-size: clamp(36px, 5vw, 64px); margin: 0; max-width: 18ch; line-height: 1.04; font-weight: var(--heading-w); }
.mag-closing p { font-size: 18px; line-height: 1.55; opacity: 0.78; margin: 0; max-width: 44ch; }

@media (max-width: 760px) {
  .mag-hero { grid-template-columns: 1fr; gap: 32px; }
  .mag-grid { grid-template-columns: 1fr; }
  .mag-cell--lead { grid-row: auto; }
  .mag-flow, .mag-statements { grid-template-columns: 1fr; gap: 40px; }
  .mag-closing { grid-template-columns: 1fr; gap: 24px; }
}
${preview ? renderPreviewArtifactStyles() : ''}`;
}

export function magazineGridV2Body(content: LandingContent, year: number, esc: (s: string) => string): string {
  const caps = content.what_it_does.capabilities;
  const lead = caps[0];
  const rest = caps.slice(1);
  const restCells = rest
    .map((c, i) => `
        <div class="mag-cell mag-cell--small">
          <span class="mag-cell-tag">No. ${(i + 2).toString().padStart(2, '0')}</span>
          <h3>${esc(c.title)}</h3>
          <p>${esc(c.description)}</p>
        </div>`).join('');
  const stepRow = content.how_it_works.steps
    .map((s) => `
        <div class="mag-step">
          <span class="mag-step-kicker">Step ${s.number.toString().padStart(2, '0')}</span>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.description)}</p>
        </div>`).join('');
  const diffStmts = content.what_makes_different.points
    .map((p, i) => `
        <div class="mag-stmt">
          <span class="mag-stmt-num">${(i + 1).toString().padStart(2, '0')}</span>
          <p>${esc(p)}</p>
        </div>`).join('');
  const preview = hasLandingPreview(content);

  return `<div class="wrap">
  <header class="mag-header">
    <div>
      <div class="brand">${esc(content.brand.name)}</div>
      <div class="brand-tag">${esc(content.brand.tagline)}</div>
    </div>
    <div class="mag-meta-strip">Issue 01 / ${year}</div>
  </header>
  <div class="mag-hero${preview ? ' preview-hero' : ''}" id="hero">
    <div class="preview-copy">
      <h1>${esc(content.hero.headline)}</h1>
      <p>${esc(content.hero.subhead)}</p>
      ${preview ? renderPreviewProofRail(content, esc) : ''}
    </div>
    ${preview ? renderPreviewArtifact(content, esc) : `<dl class="mag-sidebar">
      <dt>Issue</dt><dd>01 / ${year}</dd>
      <dt>Built for</dt><dd>${esc(content.brand.tagline)}</dd>
      <dt>Section</dt><dd>Day-Zero Edition</dd>
    </dl>`}
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
}


// ═══════════════════════════════════════════════════════
// COMPARISON-LED v2 — tables stay (they ARE the content), but soften the
// chrome. No outer table borders, no rounded-overflow box, no eyebrow pill,
// no bordered hero-aside. Reads like a spec sheet, not a UI template.
// ═══════════════════════════════════════════════════════

export function comparisonLedV2Styles(preview = false): string {
  return `.wrap { max-width: 1080px; margin: 0 auto; padding: 0 var(--container-px); }

/* Header — minimal rule */
header.cmp-header {
  padding: 32px 0 16px;
  display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
}
/* Eyebrow — was a bordered pill, now plain accent text */
.cmp-eyebrow {
  font-family: var(--font-heading); font-size: 11px;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--accent); padding: 0; border: none; border-radius: 0;
}

/* Hero — aside is no longer a box; uses accent top-rule */
.cmp-hero {
  padding: 80px 0 64px;
  display: grid; grid-template-columns: 1.5fr 1fr;
  gap: 80px; align-items: end;
  border-bottom: none;
}
.cmp-hero h1 {
  font-family: var(--font-heading); text-transform: var(--heading-tt);
  letter-spacing: var(--heading-ls); font-weight: var(--heading-w);
  font-size: clamp(40px, 6vw, 68px); line-height: 1.04;
  margin: 0 0 28px; max-width: 18ch;
}
.cmp-hero p { font-size: 19px; line-height: 1.55; opacity: 0.82; margin: 0; max-width: 48ch; }
.cmp-hero-aside {
  background: transparent;
  border: none; border-radius: 0;
  padding: 16px 0 0;
  box-shadow: none;
  position: relative;
}
.cmp-hero-aside::before {
  content: ""; position: absolute; top: 0; left: 0;
  width: 32px; height: 2px; background: var(--accent);
}
.cmp-hero-aside dl { margin: 0; display: grid; gap: 16px; }
.cmp-hero-aside dt {
  font-family: var(--font-heading); font-size: 11px;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--accent); margin: 0;
}
.cmp-hero-aside dd { margin: 4px 0 0; font-size: 16px; color: var(--ink); }

/* Section — no full-width borders, just an accent-bar label */
.cmp-section { padding: clamp(64px, 9vw, 112px) 0; border-bottom: none; }
.cmp-section-h {
  display: flex; align-items: baseline; justify-content: space-between;
  margin: 0 0 36px;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
  padding-bottom: 16px;
}
.cmp-section-h h2 {
  font-family: var(--font-heading); text-transform: uppercase;
  letter-spacing: 0.14em; font-size: 12px; margin: 0;
  color: var(--accent); font-weight: var(--heading-w);
}
.cmp-section-h .cmp-meta {
  font-family: var(--font-heading); font-size: 11px;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-soft);
}

/* Capability matrix — no outer border, no rounded-overflow box */
table.cmp-matrix {
  width: 100%; border-collapse: collapse;
  border: none; border-radius: 0; overflow: visible;
}
table.cmp-matrix thead th {
  font-family: var(--font-heading); font-size: 11px;
  letter-spacing: 0.18em; text-transform: uppercase;
  text-align: left; padding: 12px 16px 14px 0;
  background: transparent;
  border-bottom: 2px solid var(--accent);
  color: var(--ink); font-weight: var(--heading-w);
}
table.cmp-matrix thead th:not(:first-child) { padding-left: 16px; }
table.cmp-matrix tbody td {
  padding: 22px 16px 22px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
  vertical-align: top;
}
table.cmp-matrix tbody td:not(:first-child) { padding-left: 16px; }
table.cmp-matrix tbody tr:last-child td { border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); }
.cmp-feature-mark { width: 56px; font-family: var(--font-heading); color: var(--accent); font-weight: var(--heading-w); font-size: 14px; }
.cmp-feature-name { width: 240px; font-family: var(--font-heading); font-weight: var(--heading-w); font-size: 17px; }
.cmp-feature-bullet { font-size: 16px; line-height: 1.55; opacity: 0.82; }

/* Steps strip — no outer table-like border, just per-step top accent rule */
ol.cmp-steps {
  list-style: none; padding: 0; margin: 0;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px;
  border: none; border-radius: 0; overflow: visible;
}
.cmp-step {
  padding: 20px 0 0 0;
  border-right: none; border-top: 3px solid var(--accent);
  background: transparent;
}
.cmp-step-num {
  display: inline-block; font-family: var(--font-heading);
  font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--accent); margin-bottom: 12px;
}
.cmp-step h3 { font-family: var(--font-heading); font-size: 20px; margin: 0 0 10px; font-weight: var(--heading-w); }
.cmp-step p { font-size: 16px; line-height: 1.55; opacity: 0.82; margin: 0; }

/* Comparison table — no outer border; ✓/✗ uses color, not background block */
table.cmp-table {
  width: 100%; border-collapse: collapse;
  border: none; border-radius: 0; overflow: visible;
}
table.cmp-table thead th {
  font-family: var(--font-heading); font-size: 11px;
  letter-spacing: 0.18em; text-transform: uppercase;
  text-align: left; padding: 12px 16px 14px 0;
  background: transparent;
  border-bottom: 2px solid var(--accent);
  color: var(--ink); font-weight: var(--heading-w);
}
table.cmp-table thead th:not(:first-child) {
  padding-left: 16px; text-align: center;
}
table.cmp-table thead th.cmp-col-us { color: var(--accent); }
table.cmp-table tbody td {
  padding: 18px 16px 18px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
  vertical-align: middle;
}
table.cmp-table tbody td:not(:first-child) { padding-left: 16px; text-align: center; }
.cmp-diff-claim { font-size: 16px; line-height: 1.5; max-width: 38ch; }
.cmp-diff-mark {
  width: 88px; text-align: center;
  font-family: var(--font-heading); font-weight: var(--heading-w); font-size: 20px;
  background: transparent;
}
.cmp-diff-mark--us { color: var(--accent); background: transparent; }
.cmp-diff-mark--them { color: var(--ink-soft); opacity: 0.5; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

/* Closing — accent rule top, two-up */
.cmp-closing {
  padding: clamp(80px, 11vw, 128px) 0 clamp(56px, 8vw, 96px);
  display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: start;
  border-top: 3px solid var(--accent);
}
.cmp-closing h2 {
  font-family: var(--font-heading); text-transform: var(--heading-tt);
  letter-spacing: var(--heading-ls); font-weight: var(--heading-w);
  font-size: clamp(32px, 4.5vw, 52px);
  margin: 0; max-width: 20ch; line-height: 1.06;
}
.cmp-closing p { font-size: 18px; line-height: 1.55; opacity: 0.82; margin: 0; max-width: 44ch; }

@media (max-width: 760px) {
  .cmp-hero { grid-template-columns: 1fr; gap: 32px; }
  ol.cmp-steps { grid-template-columns: 1fr; gap: 32px; }
  .cmp-closing { grid-template-columns: 1fr; gap: 24px; }
  .cmp-feature-name { width: auto; }
}
${preview ? renderPreviewArtifactStyles() : ''}`;
}

export function comparisonLedV2Body(content: LandingContent, year: number, esc: (s: string) => string): string {
  const matrixRows = content.what_it_does.capabilities
    .map((c, i) => `
        <tr class="cmp-feature-row">
          <td class="cmp-feature-mark">${(i + 1).toString().padStart(2, '0')}</td>
          <td class="cmp-feature-name">${esc(c.title)}</td>
          <td class="cmp-feature-bullet">${esc(c.description)}</td>
        </tr>`).join('');
  const stepStrip = content.how_it_works.steps
    .map((s) => `
        <li class="cmp-step">
          <span class="cmp-step-num">Step ${s.number.toString().padStart(2, '0')}</span>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.description)}</p>
        </li>`).join('');
  const diffRows = content.what_makes_different.points
    .map((p) => `
        <tr class="cmp-diff-row">
          <td class="cmp-diff-claim">${esc(p)}</td>
          <td class="cmp-diff-mark cmp-diff-mark--us"><span aria-hidden="true">✓</span><span class="visually-hidden">Yes</span></td>
          <td class="cmp-diff-mark cmp-diff-mark--them"><span aria-hidden="true">✗</span><span class="visually-hidden">No</span></td>
        </tr>`).join('');

  const preview = hasLandingPreview(content);

  return `<div class="wrap">
  <header class="cmp-header">
    <div>
      <div class="brand">${esc(content.brand.name)}</div>
      <div class="brand-tag">${esc(content.brand.tagline)}</div>
    </div>
    <span class="cmp-eyebrow">Reference · ${year}</span>
  </header>
  <div class="cmp-hero${preview ? ' preview-hero' : ''}" id="hero">
    <div class="preview-copy">
      <h1>${esc(content.hero.headline)}</h1>
      <p>${esc(content.hero.subhead)}</p>
      ${preview ? renderPreviewProofRail(content, esc) : ''}
    </div>
    ${preview ? renderPreviewArtifact(content, esc) : `<aside class="cmp-hero-aside">
      <dl>
        <div><dt>Status</dt><dd>Pre-launch</dd></div>
        <div><dt>Reference</dt><dd>${esc(content.brand.name)}/01</dd></div>
        <div><dt>Updated</dt><dd>${year}</dd></div>
      </dl>
    </aside>`}
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
        <tr><th scope="col">Claim</th><th scope="col" class="cmp-col-us">${esc(content.brand.name)}</th><th scope="col">Status quo</th></tr>
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
}
