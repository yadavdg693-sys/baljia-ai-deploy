// landing-premium-styles.ts — Premium CSS injections for generated landing pages.
//
// DROP THIS FILE at: src/lib/services/onboarding/shared/landing-premium-styles.ts
//
// Then in landing.ts, import and use in renderLandingHtml():
//   import { getPremiumBaseStyles, getPremiumRootExtras } from './landing-premium-styles';
//
// These additions transform the templated look into a premium, polished feel:
// 1. Ambient aurora gradient background
// 2. Subtle grain texture overlay
// 3. Scroll-triggered fade-up animations
// 4. Dark mode support (prefers-color-scheme)
// 5. Refined typography (text-wrap: pretty, better spacing)
// 6. Hover micro-interactions on cards/steps
// 7. Gold accent glow effects
// 8. "Built by Baljia" branded footer with mascot

/**
 * Extra :root variables to append inside renderRootStyles().
 * Call this and concatenate the result into the existing :root block.
 */
export function getPremiumRootExtras(): string {
  return `
  /* Premium additions */
  --gold: #E1B12C;
  --gold-glow: 0 18px 40px rgba(217,119,6,0.18);
  --grain-opacity: 0.04;
  --aurora-opacity: 0.12;
  --card-hover-lift: -3px;
  --transition-smooth: 0.35s cubic-bezier(0.16, 1, 0.3, 1);
`;
}

/**
 * Premium base styles to append after renderBaseStyles().
 * Includes ambient background, grain, animations, refined typography, dark mode.
 */
export function getPremiumBaseStyles(accentColor: string): string {
  return `

/* ═══ Premium: Ambient Background ═══ */
body::before {
  content: "";
  position: fixed; inset: 0; pointer-events: none; z-index: -2;
  background:
    radial-gradient(ellipse 50% 40% at 30% 20%, color-mix(in srgb, ${accentColor} 14%, transparent), transparent 60%),
    radial-gradient(ellipse 45% 35% at 70% 35%, color-mix(in srgb, ${accentColor} 10%, transparent), transparent 60%),
    radial-gradient(ellipse 60% 50% at 50% 80%, color-mix(in srgb, ${accentColor} 7%, transparent), transparent 65%);
  opacity: var(--aurora-opacity);
  animation: auroraDrift 22s ease-in-out infinite alternate;
}
@keyframes auroraDrift {
  0% { transform: translateY(0) scale(1); }
  100% { transform: translateY(30px) scale(1.03); }
}

/* ═══ Premium: Grain Texture ═══ */
body::after {
  content: "";
  position: fixed; inset: 0; pointer-events: none; z-index: -1;
  opacity: var(--grain-opacity);
  mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>");
}
@media (prefers-color-scheme: dark) {
  body::after { mix-blend-mode: screen; opacity: 0.06; }
}

/* ═══ Premium: Scroll Reveal Animations ═══ */
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}
.reveal.in {
  opacity: 1;
  transform: translateY(0);
}

/* ═══ Premium: Refined Typography ═══ */
p, li, dd { text-wrap: pretty; }
h1, h2, h3 { text-wrap: balance; }

/* ═══ Premium: Card/Step Micro-interactions ═══ */
.card, .step, .ed-cap, .nv-chapter, .mag-cell, .cmp-step,
ul.diff li, .nv-cap, .narr-section-inner, .mag-stmt {
  transition: transform var(--transition-smooth), box-shadow var(--transition-smooth), border-color var(--transition-smooth);
}
.card:hover, ul.diff li:hover, .mag-cell:hover {
  transform: translateY(var(--card-hover-lift));
  box-shadow: 0 12px 32px rgba(0,0,0,0.08);
}

/* ═══ Premium: Selection Color ═══ */
::selection {
  background: color-mix(in srgb, ${accentColor} 30%, transparent);
}

/* ═══ Premium: Accent Glow on Step Numbers ═══ */
.step-num, .ed-cap-num, .nv-chapter-num, .narr-prefix,
.mag-cell-tag, .mag-step-kicker, .cmp-step-num, .cmp-eyebrow {
  text-shadow: 0 0 12px color-mix(in srgb, ${accentColor} 30%, transparent);
}

/* ═══ Premium: Smooth Link Underlines ═══ */
footer a {
  position: relative;
}
footer a::after {
  content: "";
  position: absolute; left: 0; right: 0; bottom: -2px;
  height: 1px; background: ${accentColor};
  transform: scaleX(0); transform-origin: left;
  transition: transform 0.3s ease;
}
footer a:hover::after { transform: scaleX(1); }

/* ═══ Premium: Dark Mode Enhancements ═══ */
@media (prefers-color-scheme: dark) {
  body::before {
    opacity: 0.18;
  }
  .card, ul.diff li, .mag-cell, .cmp-step, .nv-cap,
  .ed-diff, .narr-quote, .cmp-hero-aside {
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .card:hover, ul.diff li:hover, .mag-cell:hover {
    box-shadow: 0 16px 40px rgba(0,0,0,0.4);
  }
}

/* ═══ Premium: Branded Baljia Footer ═══ */
footer {
  position: relative;
}
footer::before {
  content: "";
  position: absolute; top: 0; left: 10%; right: 10%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--line), transparent);
}

/* ═══ Premium: Responsive polish ═══ */
@media (max-width: 600px) {
  body::before { opacity: calc(var(--aurora-opacity) * 0.6); }
}

@media (prefers-reduced-motion: reduce) {
  body::before { animation: none; }
  .reveal { opacity: 1; transform: none; transition: none; }
  .card, .step, ul.diff li { transition: none; }
}
`;
}

/**
 * Inline <script> for scroll-reveal animation.
 * Append this before </body> in renderLandingHtml().
 */
export function getPremiumScript(): string {
  return `
<script>
(function(){
  // Scroll reveal — add .in to .reveal elements when they enter viewport
  var els = document.querySelectorAll('.reveal');
  if (!els.length) {
    // Auto-tag sections for reveal if renderer didn't add .reveal classes
    document.querySelectorAll('section, .closing, .narr-section, .narr-how, .narr-diff, .narr-closing, .mag-section, .mag-closing, .cmp-section, .cmp-closing, .nv-how').forEach(function(el, i) {
      el.classList.add('reveal');
      el.style.transitionDelay = (i * 0.06) + 's';
    });
    els = document.querySelectorAll('.reveal');
  }
  if ('IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function(el) { obs.observe(el); });
  } else {
    els.forEach(function(el) { el.classList.add('in'); });
  }
})();
</script>`;
}

/**
 * Branded "Powered by Baljia" footer HTML to replace the plain footer.
 * Pass brand name and year.
 */
export function getPremiumFooterHtml(brandName: string, year: number): string {
  const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return `<footer style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;padding:32px 0 48px;font-size:13px;color:var(--ink-soft);border-top:1px solid var(--line);">
  <div>© ${year} ${esc(brandName)}</div>
  <div style="display:flex;align-items:center;gap:6px;">
    <span>Built and operated by</span>
    <a href="https://baljia.ai" style="display:inline-flex;align-items:center;gap:5px;color:var(--accent);font-weight:600;text-decoration:none;">
      <img src="https://baljia.ai/mascot.png" alt="" style="width:18px;height:18px;object-fit:contain;filter:drop-shadow(0 0 4px rgba(225,177,44,0.3)) saturate(1.2);" />
      Baljia AI
    </a>
  </div>
</footer>`;
}
