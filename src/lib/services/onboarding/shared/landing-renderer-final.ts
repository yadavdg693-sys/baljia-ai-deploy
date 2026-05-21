// landing-renderer-final.ts — Production renderer for generated landing pages
// Based on the approved V4 QueryForge design.
//
// DROP THIS FILE at: src/lib/services/onboarding/shared/landing-renderer-final.ts
//
// Then in landing.ts, import and wire:
//   import { renderFinalStyles, renderFinalBody } from './landing-renderer-final';
//
// Replace renderUtilityCards / renderEditorial / renderNarrative with:
//   function renderUtilityCards(content, year) {
//     return { styles: renderFinalStyles(), body: renderFinalBody(content, year, esc) };
//   }

export function renderFinalStyles(): string {
  return `
.pad { padding-left: clamp(24px, 4vw, 64px); padding-right: clamp(24px, 4vw, 64px); }

/* ═══ NAV ═══ */
nav {
  display: flex; align-items: center; justify-content: space-between;
  padding-top: 20px; padding-bottom: 20px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
nav .name {
  font-family: var(--font-heading); font-size: 20px; font-weight: var(--heading-w);
  letter-spacing: -0.01em;
}
nav .tag {
  font-size: 13px; color: var(--ink-soft); margin-left: 8px;
  font-family: var(--font-heading); font-style: italic;
}

/* ═══ HERO — 2 column: text left, visual right ═══ */
.hero {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 48px; align-items: center;
  padding-top: clamp(56px, 8vw, 96px);
  padding-bottom: clamp(56px, 8vw, 96px);
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
.hero-text h1 {
  font-family: var(--font-heading);
  font-size: clamp(36px, 5vw, 64px);
  font-weight: var(--heading-w); line-height: 1.05;
  letter-spacing: var(--heading-ls); margin-bottom: 20px;
  text-transform: var(--heading-tt);
}
.hero-text p {
  font-size: 17px; line-height: 1.65; color: var(--ink-soft); max-width: 50ch;
}
.hero-visual {
  position: relative; width: 100%; aspect-ratio: 1;
  display: flex; align-items: center; justify-content: center;
}
.hero-visual .ring {
  position: absolute; border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--accent) 15%, transparent);
}
.hero-visual .ring:nth-child(1) { width: 90%; height: 90%; }
.hero-visual .ring:nth-child(2) { width: 65%; height: 65%; }
.hero-visual .ring:nth-child(3) { width: 40%; height: 40%; background: color-mix(in srgb, var(--accent) 5%, transparent); }
.hero-visual .core {
  width: 20%; height: 20%; border-radius: 50%;
  background: var(--accent); opacity: 0.15;
  animation: pulse 3s ease-in-out infinite;
}
@keyframes pulse { 0%,100% { transform: scale(1); opacity: 0.15; } 50% { transform: scale(1.1); opacity: 0.25; } }
.hero-visual .kw {
  position: absolute; font-size: 11px; font-weight: 600;
  color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent);
  padding: 4px 10px; border-radius: 99px;
  white-space: nowrap; letter-spacing: 0.02em;
}
.hero-visual .kw:nth-child(5) { top: 12%; left: 10%; }
.hero-visual .kw:nth-child(6) { top: 30%; right: 5%; }
.hero-visual .kw:nth-child(7) { bottom: 28%; left: 5%; }
.hero-visual .kw:nth-child(8) { bottom: 10%; right: 15%; }
.hero-visual .kw:nth-child(9) { top: 55%; right: 2%; }

/* ═══ CAPABILITIES — accent top border, full-width columns ═══ */
.cap-section { padding-top: clamp(48px, 6vw, 80px); padding-bottom: clamp(48px, 6vw, 80px); }
.section-head {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 32px;
}
.section-head h2 {
  font-family: var(--font-heading); font-size: clamp(24px, 3vw, 36px);
  font-weight: var(--heading-w); letter-spacing: var(--heading-ls);
  text-transform: var(--heading-tt);
}
.section-head .label {
  font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--accent); font-weight: 600;
}
.cap-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; }
.cap-card {
  padding: 28px 24px;
  border-top: 2px solid var(--accent);
  border-right: 1px solid rgba(0,0,0,0.06);
  transition: background var(--transition);
}
.cap-card:last-child { border-right: none; }
.cap-card:hover { background: color-mix(in srgb, var(--accent) 3%, transparent); }
.cap-card h3 {
  font-family: var(--font-heading); font-size: 19px; font-weight: var(--heading-w);
  letter-spacing: var(--heading-ls); margin-bottom: 10px;
  text-transform: var(--heading-tt);
}
.cap-card p { font-size: 14px; line-height: 1.65; color: var(--ink-soft); }

/* ═══ HOW IT WORKS — dark band, 3 columns ═══ */
.how-section {
  padding-top: clamp(48px, 6vw, 80px);
  padding-bottom: clamp(48px, 6vw, 80px);
  background: var(--ink); color: var(--bg);
  margin-left: calc(clamp(24px, 4vw, 64px) * -1);
  margin-right: calc(clamp(24px, 4vw, 64px) * -1);
  padding-left: clamp(40px, 5vw, 80px);
  padding-right: clamp(40px, 5vw, 80px);
}
.how-section .section-head h2 { color: var(--bg); }
.how-section .label { color: color-mix(in srgb, var(--accent) 70%, white); }
.how-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px; }
.how-step { display: flex; gap: 16px; align-items: first baseline; }
.how-step .num {
  font-family: var(--font-heading); font-size: 48px;
  font-weight: 400; color: var(--accent); opacity: 0.5; line-height: 1;
  flex-shrink: 0;
}
.how-step h3 {
  font-family: var(--font-heading); font-size: 17px; font-weight: var(--heading-w);
  margin-bottom: 6px; color: var(--bg);
}
.how-step p { font-size: 14px; line-height: 1.6; color: var(--ink-soft); }
@media (prefers-color-scheme: dark) {
  .how-section { background: #000; }
  .how-step p { color: #999; }
}

/* ═══ DIFFERENTIATORS — 2/3 + 1/3 ═══ */
.diff-section {
  padding-top: clamp(48px, 6vw, 80px);
  padding-bottom: clamp(48px, 6vw, 80px);
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
.diff-layout { display: grid; grid-template-columns: 2fr 1fr; gap: 56px; align-items: start; }
.diff-list { display: grid; gap: 24px; }
.diff-item {
  font-size: 16px; line-height: 1.6; color: var(--ink);
  padding-left: 20px;
  border-left: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
  opacity: 0.82;
}
.diff-aside {
  background: color-mix(in srgb, var(--accent) 5%, transparent);
  border-radius: var(--radius); padding: 24px;
  font-size: 13px; color: var(--ink-soft); line-height: 1.6;
}
.diff-aside strong {
  color: var(--accent); display: block; margin-bottom: 8px;
  font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;
}

/* ═══ CLOSING — accent band ═══ */
.closing {
  background: var(--accent); color: #fff;
  padding: clamp(56px, 8vw, 100px) clamp(40px, 5vw, 80px);
  margin-left: calc(clamp(24px, 4vw, 64px) * -1);
  margin-right: calc(clamp(24px, 4vw, 64px) * -1);
}
.closing h2 {
  font-family: var(--font-heading); font-size: clamp(24px, 3.5vw, 40px);
  font-weight: var(--heading-w); line-height: 1.1; margin-bottom: 16px;
  max-width: 32ch; letter-spacing: var(--heading-ls);
  text-transform: var(--heading-tt);
}
.closing p { font-size: 16px; line-height: 1.6; opacity: 0.88; max-width: 56ch; }

/* Footer */
footer {
  padding: 32px 0 40px;
  display: flex; justify-content: space-between;
  font-size: 12px; color: var(--ink-soft);
}
footer a { color: var(--accent); text-decoration: none; font-weight: 600; }

/* Reveal */
.rv { opacity: 0; transform: translateY(16px); transition: opacity 0.6s cubic-bezier(0.16,1,0.3,1), transform 0.6s cubic-bezier(0.16,1,0.3,1); }
.rv.in { opacity: 1; transform: translateY(0); }

/* Responsive */
@media (max-width: 768px) {
  .hero { grid-template-columns: 1fr; }
  .hero-visual { display: none; }
  .cap-grid { grid-template-columns: 1fr; }
  .cap-card { border-right: none; border-bottom: 1px solid rgba(0,0,0,0.06); }
  .how-grid { grid-template-columns: 1fr; }
  .diff-layout { grid-template-columns: 1fr; }
  .diff-aside { display: none; }
}`;
}

/**
 * Extract 3-5 short keywords from capabilities for the hero visual.
 * Falls back to generic terms if extraction fails.
 */
function extractKeywords(capabilities: Array<{ title: string; description: string }>): string[] {
  const words: string[] = [];
  for (const cap of capabilities) {
    // Take first 1-2 words of each title
    const titleWords = cap.title.split(/\s+/).slice(0, 2).join(' ');
    if (titleWords.length <= 20) words.push(titleWords.toLowerCase());
    // Extract a key noun from description
    const descWords = cap.description.split(/[.,;]/).slice(0, 1)[0]?.trim().split(/\s+/).slice(-2).join(' ');
    if (descWords && descWords.length <= 18) words.push(descWords.toLowerCase());
  }
  // Dedupe and take up to 5
  return [...new Set(words)].slice(0, 5);
}

export function renderFinalBody(
  content: {
    brand: { name: string; tagline: string };
    hero: { headline: string; subhead: string };
    what_it_does: { heading: string; capabilities: Array<{ title: string; description: string }> };
    how_it_works: { heading: string; steps: Array<{ number: number; title: string; description: string }> };
    what_makes_different: { heading: string; points: string[] };
    closing: { headline: string; body: string };
  },
  year: number,
  esc: (s: string) => string,
): string {
  const keywords = extractKeywords(content.what_it_does.capabilities);
  const kwHtml = keywords.map(kw => `<span class="kw">${esc(kw)}</span>`).join('\n    ');

  const caps = content.what_it_does.capabilities
    .map(c => `
    <div class="cap-card rv">
      <h3>${esc(c.title)}</h3>
      <p>${esc(c.description)}</p>
    </div>`).join('');

  const steps = content.how_it_works.steps
    .map(s => `
      <div class="how-step rv">
        <span class="num">${s.number}</span>
        <div>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.description)}</p>
        </div>
      </div>`).join('');

  const diffs = content.what_makes_different.points
    .map(p => `<div class="diff-item rv">${esc(p)}</div>`).join('\n      ');

  return `<nav class="pad rv">
  <div><span class="name">${esc(content.brand.name)}</span><span class="tag">· ${esc(content.brand.tagline)}</span></div>
</nav>

<div class="hero pad rv">
  <div class="hero-text">
    <h1>${esc(content.hero.headline)}</h1>
    <p>${esc(content.hero.subhead)}</p>
  </div>
  <div class="hero-visual">
    <div class="ring"></div>
    <div class="ring"></div>
    <div class="ring"></div>
    <div class="core"></div>
    ${kwHtml}
  </div>
</div>

<div class="cap-section pad">
  <div class="section-head rv">
    <h2>${esc(content.what_it_does.heading)}</h2>
    <span class="label">Capabilities</span>
  </div>
  <div class="cap-grid">${caps}
  </div>
</div>

<div class="how-section">
  <div class="section-head rv">
    <h2>${esc(content.how_it_works.heading)}</h2>
    <span class="label">3 steps</span>
  </div>
  <div class="how-grid">${steps}
  </div>
</div>

<div class="diff-section pad">
  <div class="section-head rv">
    <h2>${esc(content.what_makes_different.heading)}</h2>
    <span class="label">Positioning</span>
  </div>
  <div class="diff-layout">
    <div class="diff-list">
      ${diffs}
    </div>
    <div class="diff-aside rv">
      <strong>Pre-launch</strong>
      ${esc(content.brand.name)} is being built for the people described above. This page is informational — no sign-up required.
    </div>
  </div>
</div>

<div class="closing rv">
  <h2>${esc(content.closing.headline)}</h2>
  <p>${esc(content.closing.body)}</p>
</div>

<footer class="pad">
  <div>\u00A9 ${year} ${esc(content.brand.name)}</div>
  <div>Built and operated by <a href="https://baljia.ai">Baljia AI</a></div>
</footer>`;
}
