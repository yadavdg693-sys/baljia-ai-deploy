// landing-renderer-v2.ts — Drop-in replacement render functions for landing.ts
//
// REPLACES: renderUtilityCards, renderEditorial, renderNarrative
// FIXES: "boxy template" look. Removes uniform borders, adds visual variety,
// introduces asymmetric layouts, gradient accents, and breathing room.
//
// To use: in landing.ts, replace the 3 render function bodies with these.
// The function signatures and the renderLandingHtml dispatcher stay the same.

// ═══════════════════════════════════════════════════════
// UTILITY-CARDS v2 — the default template, completely redesigned
// ═══════════════════════════════════════════════════════

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

export function utilityCardsV2Styles(preview = false): string {
  return `.wrap { max-width: 900px; margin: 0 auto; padding: 0 var(--container-px); }

/* Header — minimal, no borders */
header { padding: 48px 0 0; }
.brand { font-family: var(--font-heading); font-size: 15px; font-weight: var(--heading-w); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); }
.brand-tag { display: none; }

/* Hero — oversized type, no borders, asymmetric spacing */
.hero { padding: 64px 0 80px; }
.hero h1 {
  font-family: var(--font-heading); text-transform: var(--heading-tt);
  letter-spacing: var(--heading-ls); font-weight: var(--heading-w);
  font-size: clamp(44px, 7vw, 80px); line-height: 1.02;
  margin: 0 0 28px; max-width: 16ch;
}
.hero p {
  font-size: 20px; color: var(--ink); opacity: 0.72;
  margin: 0; max-width: 48ch; line-height: 1.55;
}

/* Section — NO top border, just generous spacing + subtle label */
section { padding: 0 0 96px; }
section .section-label {
  font-family: var(--font-heading); font-size: 11px;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--accent); margin: 0 0 16px;
  display: flex; align-items: center; gap: 10px;
}
section .section-label::before {
  content: ""; width: 20px; height: 1px; background: var(--accent);
}
section h2 {
  font-family: var(--font-heading); font-size: clamp(28px, 4vw, 40px);
  font-weight: var(--heading-w); letter-spacing: var(--heading-ls);
  margin: 0 0 40px; max-width: 20ch; line-height: 1.08;
}

/* Cards — NO border, use subtle background shift + accent left edge */
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
.card {
  padding: 28px 24px 28px 28px;
  background: var(--bg-elev);
  ${preview ? `border: var(--border-w) solid color-mix(in srgb, var(--line) 80%, transparent);
  border-top: 3px solid var(--accent);
  border-radius: var(--radius);` : `border: none;
  border-left: 3px solid var(--accent);
  border-radius: 0 var(--radius) var(--radius) 0;`}
  box-shadow: none;
  transition: transform var(--transition), background var(--transition);
  position: relative;
}
.card:hover {
  transform: translateX(4px);
  background: color-mix(in srgb, var(--accent) 5%, var(--bg-elev));
}
.card h3 {
  font-family: var(--font-heading); font-size: 18px;
  margin: 0 0 10px; font-weight: var(--heading-w);
  letter-spacing: var(--heading-ls);
}
.card p { font-size: 15px; color: var(--ink); opacity: 0.78; margin: 0; line-height: 1.6; }

/* Steps — large numbers, no circles, clean vertical flow */
ol.steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 40px; }
.step { display: grid; grid-template-columns: 64px 1fr; gap: 0; align-items: baseline; }
.step-num {
  font-family: var(--font-heading); font-weight: var(--heading-w);
  font-size: clamp(48px, 6vw, 72px); line-height: 0.85;
  color: var(--accent); opacity: 0.35;
}
.step h3 {
  font-family: var(--font-heading); font-size: 20px;
  margin: 0 0 8px; font-weight: var(--heading-w);
  letter-spacing: var(--heading-ls);
}
.step p { font-size: 16px; color: var(--ink); opacity: 0.75; margin: 0; line-height: 1.55; max-width: 50ch; }

/* Differentiators — NO bordered list, use dash-prefixed paragraphs */
ul.diff { list-style: none; padding: 0; margin: 0; display: grid; gap: 20px; }
ul.diff li {
  padding: 0 0 0 24px;
  border: none; border-radius: 0;
  background: transparent; box-shadow: none;
  position: relative; font-size: 17px; line-height: 1.5;
  color: var(--ink); opacity: 0.85;
}
ul.diff li::before {
  content: "—"; position: absolute; left: 0; top: 0;
  color: var(--accent); font-weight: 700;
}

/* Closing — full-width accent background band */
.closing {
  padding: 80px var(--container-px);
  margin: 0 calc(var(--container-px) * -1);
  background: var(--accent);
  color: var(--bg);
  text-align: left;
  border-top: none;
  border-radius: 0;
}
.closing h2 {
  font-family: var(--font-heading); font-size: clamp(28px, 4.5vw, 44px);
  font-weight: var(--heading-w); margin: 0 0 16px;
  max-width: 22ch; line-height: 1.08; color: var(--bg);
}
.closing p { font-size: 17px; opacity: 0.9; margin: 0; max-width: 52ch; line-height: 1.55; color: var(--bg); }

/* Footer */
footer { max-width: 900px; margin: 0 auto; }

@media (max-width: 600px) {
  .hero { padding: 40px 0 56px; }
  .hero h1 { font-size: clamp(32px, 9vw, 48px); }
  .step { grid-template-columns: 48px 1fr; }
  .closing { padding: 56px var(--container-px); }
}
${preview ? renderPreviewArtifactStyles() : ''}`;
}

export function utilityCardsV2Body(content: LandingContent, year: number, esc: (s: string) => string): string {
  const capabilityCards = content.what_it_does.capabilities
    .map((c) => `
        <div class="card">
          <h3>${esc(c.title)}</h3>
          <p>${esc(c.description)}</p>
        </div>`).join('');
  const howSteps = content.how_it_works.steps
    .map((s) => `
        <li class="step">
          <span class="step-num">${s.number}</span>
          <div><h3>${esc(s.title)}</h3><p>${esc(s.description)}</p></div>
        </li>`).join('');
  const diffPoints = content.what_makes_different.points
    .map((p) => `<li>${esc(p)}</li>`).join('');
  const preview = hasLandingPreview(content);

  return `<div class="wrap">
  <header>
    <div class="brand">${esc(content.brand.name)}</div>
  </header>
  <div class="hero${preview ? ' preview-hero' : ''}" id="hero">
    ${preview ? `<div class="preview-copy">
      <h1>${esc(content.hero.headline)}</h1>
      <p>${esc(content.hero.subhead)}</p>
      ${renderPreviewProofRail(content, esc)}
    </div>
    ${renderPreviewArtifact(content, esc)}` : `<h1>${esc(content.hero.headline)}</h1>
    <p>${esc(content.hero.subhead)}</p>`}
  </div>
  <section id="what">
    <div class="section-label">${esc(content.what_it_does.heading)}</div>
    <h2>What ${esc(content.brand.name)} does</h2>
    <div class="cards">${capabilityCards}
    </div>
  </section>
  <section id="how">
    <div class="section-label">${esc(content.how_it_works.heading)}</div>
    <h2>How it works</h2>
    <ol class="steps">${howSteps}
    </ol>
  </section>
  <section id="diff">
    <div class="section-label">${esc(content.what_makes_different.heading)}</div>
    <h2>Why this is different</h2>
    <ul class="diff">${diffPoints}</ul>
  </section>
</div>
<div class="closing" id="closing">
  <div class="wrap">
    <h2>${esc(content.closing.headline)}</h2>
    <p>${esc(content.closing.body)}</p>
  </div>
</div>
<div class="wrap">
  <footer>
    <div>© ${year} ${esc(content.brand.name)}</div>
    <div>Built and operated by <a href="https://baljia.ai" style="display:inline-flex;align-items:center;gap:5px;color:var(--accent);font-weight:600;">Baljia AI</a></div>
  </footer>
</div>`;
}


// ═══════════════════════════════════════════════════════
// EDITORIAL v2 — single-column, type-led, no boxes at all
// ═══════════════════════════════════════════════════════

export function editorialV2Styles(preview = false): string {
  return `.wrap { max-width: 720px; margin: 0 auto; padding: 0 var(--container-px); }

header { padding: 64px 0 0; }
.brand { font-family: var(--font-heading); font-size: 13px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-soft); }
.brand-tag { font-size: 14px; color: var(--ink-soft); margin-top: 6px; font-style: italic; font-family: var(--font-heading); }

.hero { padding: 48px 0 0; }
.hero h1 {
  font-family: var(--font-heading); font-weight: var(--heading-w);
  font-size: clamp(48px, 8vw, 88px); line-height: 0.98;
  margin: 0 0 32px; max-width: 14ch;
  letter-spacing: var(--heading-ls);
}
.hero p { font-size: 21px; color: var(--ink); opacity: 0.72; margin: 0; max-width: 50ch; line-height: 1.5; }

/* Thin accent line separator instead of full border */
.divider {
  width: 48px; height: 2px; background: var(--accent);
  margin: 72px 0;
}

section { padding: 0; }
section h2 {
  font-family: var(--font-heading); font-size: 13px;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-soft); margin: 0 0 36px;
}

/* Capabilities as numbered blocks — NO cards, NO borders */
ol.ed-caps { list-style: none; padding: 0; margin: 0; display: grid; gap: 48px; }
.ed-cap { display: grid; grid-template-columns: 64px 1fr; gap: 0; align-items: baseline; }
.ed-cap-num {
  font-family: var(--font-heading); font-size: 64px;
  color: var(--accent); opacity: 0.2; line-height: 0.8;
  font-weight: var(--heading-w);
}
.ed-cap h3 { font-family: var(--font-heading); font-size: 24px; margin: 0 0 10px; font-weight: var(--heading-w); }
.ed-cap p { margin: 0; font-size: 17px; line-height: 1.6; opacity: 0.78; max-width: 52ch; }

/* Steps — inline prose, no structure */
.ed-step { font-size: 18px; line-height: 1.65; margin: 0 0 20px; max-width: 56ch; }
.ed-step strong { font-family: var(--font-heading); color: var(--accent); font-weight: var(--heading-w); }

/* Differentiators — pull-quote style, accent border left */
.ed-diff {
  font-family: var(--font-heading); font-size: 20px; line-height: 1.4;
  margin: 0 0 24px; padding: 0 0 0 24px;
  border-left: 3px solid var(--accent);
  font-weight: 500; font-style: italic; max-width: 44ch;
  color: var(--ink); opacity: 0.85;
}

/* Closing — no accent band, just oversized type */
.closing { padding: 96px 0 64px; }
.closing h2 {
  font-family: var(--font-heading); font-size: clamp(36px, 5.5vw, 56px);
  font-weight: var(--heading-w); margin: 0 0 20px;
  max-width: 18ch; line-height: 1.06;
}
.closing p { font-size: 19px; opacity: 0.72; max-width: 50ch; margin: 0; line-height: 1.55; }

@media (max-width: 600px) {
  .hero h1 { font-size: clamp(36px, 10vw, 56px); }
  .ed-cap { grid-template-columns: 44px 1fr; }
  .ed-cap-num { font-size: 44px; }
}
${preview ? renderPreviewArtifactStyles() : ''}`;
}

export function editorialV2Body(content: LandingContent, year: number, esc: (s: string) => string): string {
  const capList = content.what_it_does.capabilities
    .map((c, i) => `
      <li class="ed-cap">
        <span class="ed-cap-num">${(i + 1)}</span>
        <div><h3>${esc(c.title)}</h3><p>${esc(c.description)}</p></div>
      </li>`).join('');
  const stepList = content.how_it_works.steps
    .map((s) => `<p class="ed-step"><strong>${s.number}. ${esc(s.title)}.</strong> ${esc(s.description)}</p>`).join('');
  const diffList = content.what_makes_different.points
    .map((p) => `<p class="ed-diff">${esc(p)}</p>`).join('');
  const preview = hasLandingPreview(content);

  return `<div class="wrap">
  <header>
    <div class="brand">${esc(content.brand.name)}</div>
    <div class="brand-tag">${esc(content.brand.tagline)}</div>
  </header>
  <div class="hero${preview ? ' preview-hero' : ''}" id="hero">
    ${preview ? `<div class="preview-copy">
      <h1>${esc(content.hero.headline)}</h1>
      <p>${esc(content.hero.subhead)}</p>
      ${renderPreviewProofRail(content, esc)}
    </div>
    ${renderPreviewArtifact(content, esc)}` : `<h1>${esc(content.hero.headline)}</h1>
    <p>${esc(content.hero.subhead)}</p>`}
  </div>
  <div class="divider"></div>
  <section id="what">
    <h2>${esc(content.what_it_does.heading)}</h2>
    <ol class="ed-caps">${capList}
    </ol>
  </section>
  <div class="divider"></div>
  <section id="how">
    <h2>${esc(content.how_it_works.heading)}</h2>
    ${stepList}
  </section>
  <div class="divider"></div>
  <section id="diff">
    <h2>${esc(content.what_makes_different.heading)}</h2>
    ${diffList}
  </section>
  <div class="closing" id="closing">
    <h2>${esc(content.closing.headline)}</h2>
    <p>${esc(content.closing.body)}</p>
  </div>
  <footer>
    <div>© ${year} ${esc(content.brand.name)}</div>
    <div>Built and operated by <a href="https://baljia.ai" style="color:var(--accent);font-weight:600;">Baljia AI</a></div>
  </footer>
</div>`;
}


// ═══════════════════════════════════════════════════════
// NARRATIVE v2 — story-driven, full-bleed color sections, no boxes
// ═══════════════════════════════════════════════════════

export function narrativeV2Styles(preview = false): string {
  return `.wrap { max-width: 100%; margin: 0; padding: 0; }
.inner { max-width: 820px; margin: 0 auto; padding: 0 var(--container-px); }

header { padding: 48px 0 0; }
.brand { font-family: var(--font-heading); font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-soft); }

.hero { padding: 80px 0 0; }
.hero h1 {
  font-family: var(--font-heading); font-weight: var(--heading-w);
  font-size: clamp(42px, 7.5vw, 76px); line-height: 1.02;
  margin: 0 0 28px; max-width: 18ch;
}
.hero p { font-size: 20px; opacity: 0.78; max-width: 52ch; line-height: 1.55; margin: 0; }

/* Chapters — alternating bg-color sections, NO borders */
.chapter { padding: clamp(80px, 12vw, 128px) 0; }
.chapter--accent { background: var(--accent-soft); }
.chapter--dark { background: var(--ink); color: var(--bg); }
.chapter-num {
  font-family: var(--font-heading); font-size: 12px;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--accent); margin-bottom: 20px;
}
.chapter--dark .chapter-num { color: color-mix(in srgb, var(--accent) 70%, white); }
.chapter h3 {
  font-family: var(--font-heading); font-size: clamp(28px, 4vw, 40px);
  font-weight: var(--heading-w); margin: 0 0 16px;
  max-width: 18ch; line-height: 1.1;
}
.chapter p { font-size: 18px; line-height: 1.6; opacity: 0.82; max-width: 52ch; margin: 0; }

/* How it works — horizontal flow on dark band */
.how-band { padding: clamp(80px, 12vw, 128px) 0; background: var(--ink); color: var(--bg); }
.how-label {
  font-family: var(--font-heading); font-size: 12px;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--accent); opacity: 0.8; margin-bottom: 48px;
}
.how-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 48px; }
.how-step-num {
  font-family: var(--font-heading); font-size: clamp(48px, 7vw, 72px);
  font-weight: var(--heading-w); line-height: 0.85;
  color: var(--accent); opacity: 0.4; margin-bottom: 16px;
}
.how-step h3 {
  font-family: var(--font-heading); font-size: 20px;
  font-weight: var(--heading-w); margin: 0 0 10px;
}
.how-step p { font-size: 15px; opacity: 0.72; line-height: 1.55; margin: 0; }

/* Differentiators — italic pull-quotes on accent bg */
.diff-band { padding: clamp(80px, 12vw, 128px) 0; background: var(--accent-soft); }
.diff-label {
  font-family: var(--font-heading); font-size: 12px;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--accent); margin-bottom: 48px;
}
.quote {
  font-family: var(--font-heading); font-style: italic; font-weight: 500;
  font-size: clamp(20px, 3vw, 28px); line-height: 1.35;
  margin: 0 0 32px; max-width: 36ch;
  padding-left: 24px; border-left: 4px solid var(--accent);
}

/* Closing — accent band */
.closing-band {
  padding: clamp(96px, 14vw, 160px) 0;
  background: var(--accent); color: var(--bg);
}
.closing-band h2 {
  font-family: var(--font-heading); font-weight: var(--heading-w);
  font-size: clamp(36px, 6vw, 64px); line-height: 1.04;
  margin: 0 0 20px; max-width: 18ch;
}
.closing-band p { font-size: 19px; opacity: 0.92; max-width: 52ch; margin: 0; line-height: 1.55; }

footer { max-width: 820px; margin: 0 auto; padding: 32px var(--container-px) 48px; }

@media (max-width: 600px) {
  .how-grid { grid-template-columns: 1fr; gap: 40px; }
  .hero h1 { font-size: clamp(34px, 10vw, 52px); }
}
${preview ? renderPreviewArtifactStyles() : ''}`;
}

export function narrativeV2Body(content: LandingContent, year: number, esc: (s: string) => string): string {
  const chapters = content.what_it_does.capabilities
    .map((c, i) => `
    <div class="chapter ${i % 2 === 0 ? '' : 'chapter--accent'}">
      <div class="inner">
        <div class="chapter-num">Chapter ${String(i + 1).padStart(2, '0')}</div>
        <h3>${esc(c.title)}</h3>
        <p>${esc(c.description)}</p>
      </div>
    </div>`).join('');

  const steps = content.how_it_works.steps
    .map((s) => `
        <div class="how-step">
          <div class="how-step-num">${s.number}</div>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.description)}</p>
        </div>`).join('');

  const quotes = content.what_makes_different.points
    .map((p) => `<div class="quote">${esc(p)}</div>`).join('');
  const preview = hasLandingPreview(content);

  return `<div class="wrap">
  <div class="inner">
    <header>
      <div class="brand">${esc(content.brand.name)}</div>
    </header>
    <div class="hero${preview ? ' preview-hero' : ''}" id="hero">
      ${preview ? `<div class="preview-copy">
        <h1>${esc(content.hero.headline)}</h1>
        <p>${esc(content.hero.subhead)}</p>
        ${renderPreviewProofRail(content, esc)}
      </div>
      ${renderPreviewArtifact(content, esc)}` : `<h1>${esc(content.hero.headline)}</h1>
      <p>${esc(content.hero.subhead)}</p>`}
    </div>
  </div>
  ${chapters}
  <div class="how-band" id="how">
    <div class="inner">
      <div class="how-label">${esc(content.how_it_works.heading)}</div>
      <div class="how-grid">${steps}
      </div>
    </div>
  </div>
  <div class="diff-band" id="diff">
    <div class="inner">
      <div class="diff-label">${esc(content.what_makes_different.heading)}</div>
      ${quotes}
    </div>
  </div>
  <div class="closing-band" id="closing">
    <div class="inner">
      <h2>${esc(content.closing.headline)}</h2>
      <p>${esc(content.closing.body)}</p>
    </div>
  </div>
  <footer>
    <div>© ${year} ${esc(content.brand.name)}</div>
    <div>Built and operated by <a href="https://baljia.ai" style="color:var(--accent);font-weight:600;">Baljia AI</a></div>
  </footer>
</div>`;
}
