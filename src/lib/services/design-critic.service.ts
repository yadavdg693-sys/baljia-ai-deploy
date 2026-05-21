// Design Critic — vision-LLM screenshot review for founder-facing pages.
//
// Phase B of the premium-frontend plan. Where design_audit catches surface
// regex anti-patterns (Tailwind indigo, purple gradients, emoji in h1, etc.),
// this critic looks at the RENDERED screenshot via Gemini 2.5 Flash and
// judges typography rhythm, visual hierarchy, copy specificity, whitespace,
// hero focal point, mobile cramping, sectional variety — the 85% of "premium"
// that's invisible to regex.
//
// Screenshot source: local Playwright first, thum.io fallback. Local capture is
// more reliable for dynamic pages and avoids depending on a public screenshot
// proxy; thum.io remains useful when Playwright browsers are unavailable.
//
// Vision model: Gemini 2.5 Flash. Selected for cost (~$0.0007 per 2-screenshot
// critique) and the fact our env has GEMINI_API_KEY already wired.

import { createLogger } from '@/lib/logger';

const log = createLogger('DesignCritic');

const RUBRIC_PROMPT = `You are a senior product designer reviewing a landing page screenshot for a founder-grade SaaS company. Your job is to identify whether the page meets a Linear / Stripe / Notion / Vercel quality bar, or whether it still has "AI-default" tells.

Score the page from 0–10 against these dimensions (each weighted equally):

1. **Typography rhythm** — display vs body font pairing; sensible hierarchy (h1 > h2 > body); not "Inter everything"; meaningful weight contrast.
2. **Visual hierarchy** — one clear focal point per section; reader's eye flow is obvious; CTAs are visually anchored, not centered-floating.
3. **Copy specificity** — real product language, not lorem ipsum / "Feature One" / "Build better, faster". Headlines describe what the USER gets, not the technology.
4. **Whitespace discipline** — sections breathe; mobile doesn't cram; padding/gap rhythm is consistent.
5. **Accent restraint** — accent color appears ≤ 2× per visible screen; no two-stop trust gradients (purple→blue, indigo→pink); no Tailwind default indigo (#6366f1, #4f46e5).
6. **Hero focal point** — left-aligned with intentional anchor (image, animation, code preview) OR center-aligned only with distinctive typography that justifies it. NOT bare centered \`<h1>\` + \`<p>\` + \`<button>\` AI tell.
7. **Sectional variety** — page does NOT follow the canonical "Hero → 3-Feature-Grid → Pricing → FAQ → CTA" AI template. At least one section breaks the template.
8. **Mobile state** — content not cramped, font sizes legible at 390×844, CTAs reachable with thumb, no horizontal scroll.
9. **Component craft** — buttons have real states (default/hover/disabled), cards aren't all "rounded with colored left border", icons are monoline (lucide-style) not emoji.
10. **Soul / distinctive choice** — at least ONE unconventional element identifies this as a specific product, not a template (custom microcopy, unique section, kbd hint, comparison block, etc.).

Return STRICT JSON only — no prose, no markdown code fences:

\`\`\`
{
  "score": <0-10 integer>,
  "blockers": [
    {
      "rule": "<one of the 10 dimensions above>",
      "evidence": "<one-sentence evidence quoting what you see>",
      "fix_suggestion": "<one concrete actionable change>",
      "severity": "BLOCKER" | "ADVISORY"
    }
  ],
  "advisory": [<same shape as blockers but lower severity>]
}
\`\`\`

BLOCKER means the page demonstrably looks AI-generated to a designer. ADVISORY means it's decent but could be more distinctive. Only concrete BLOCKER findings prevent completion; score is advisory unless a stricter score gate is configured. If score < 7, include a BLOCKER only when you can cite a specific visible issue. Score 9+ means the page would survive a Linear designer's review.

Be opinionated. Founders ship this to real customers. "It looks fine" is a fail.`;

const THUMIO_BASE = 'https://image.thum.io/get';

// thum.io behavior: when the URL hasn't been captured yet (or cache is
// busted), the FIRST request returns a small "loading spinner" placeholder
// PNG (~30-40KB) synchronously while the real capture runs async. Subsequent
// requests to the SAME thum.io URL return the cached real screenshot.
//
// We detect the placeholder by size: real full-page captures are usually
// >60KB for desktop (1280×3000 cropped) and >20KB for mobile (390×4000
// cropped). The thum.io placeholder is a fixed-size spinner image, ~30-40KB
// for desktop width requests and ~10-15KB for mobile width requests.
//
// To avoid serving stale screenshots after a redesign push, we bust the
// thum.io cache via URL fragment (#cb=<ts>). Fragments are NOT sent to the
// origin server (page response stays cacheable at the CDN), but thum.io
// includes them in its cache key.
//
// Polling: 1 initial fetch + up to 4 retries with 4s/6s/8s/10s gaps.
// Total ~28s worst case. If still placeholder after all polls, return what
// we have — Gemini's "looks like loading screen" verdict is still useful.
const POLL_DELAYS_MS = [4_000, 6_000, 8_000, 10_000];

async function fetchThumioScreenshotBase64(url: string, viewport: 'desktop' | 'mobile'): Promise<{ ok: true; data: string; mimeType: string } | { ok: false; error: string }> {
  const width = viewport === 'desktop' ? 1280 : 390;
  const cropHeight = viewport === 'desktop' ? 3000 : 4000;
  // Viewport-aware placeholder threshold. Desktop placeholders are larger
  // than mobile placeholders because thum.io scales the spinner to viewport
  // width. Real captures comfortably exceed these thresholds.
  const placeholderMaxBytes = viewport === 'desktop' ? 60_000 : 20_000;
  const cb = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const thumUrl = `${THUMIO_BASE}/width/${width}/crop/${cropHeight}/wait/4/${url}#cb=${cb}`;

  let lastBuf: Buffer | null = null;
  let lastCt = 'image/jpeg';
  let lastSize = 0;

  for (let attempt = 0; attempt <= POLL_DELAYS_MS.length; attempt++) {
    try {
      const r = await fetch(thumUrl, {
        signal: AbortSignal.timeout(25_000),
        headers: { 'User-Agent': 'Baljia-DesignCritic/1.0' },
      });
      if (!r.ok) return { ok: false, error: `screenshot HTTP ${r.status}` };
      const ct = r.headers.get('content-type') ?? 'image/jpeg';
      if (!ct.startsWith('image/')) return { ok: false, error: `screenshot returned non-image content-type ${ct}` };
      const buf = Buffer.from(await r.arrayBuffer());
      lastBuf = buf;
      lastCt = ct;
      lastSize = buf.length;

      if (buf.length < 1000) {
        return { ok: false, error: `screenshot suspiciously small (${buf.length}b) — likely an error page` };
      }

      // Real screenshot — return it.
      if (buf.length >= placeholderMaxBytes) {
        return { ok: true, data: buf.toString('base64'), mimeType: ct };
      }

      // Placeholder — wait for the async capture to finish.
      if (attempt < POLL_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, POLL_DELAYS_MS[attempt]));
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unknown screenshot error' };
    }
  }

  if (lastBuf) {
    log.warn('thum.io returned placeholder after polling', { url, viewport, lastSize });
    return { ok: true, data: lastBuf.toString('base64'), mimeType: lastCt };
  }
  return { ok: false, error: `screenshot service returned only placeholders after ${POLL_DELAYS_MS.length + 1} attempts` };
}

async function fetchPlaywrightScreenshotBase64(url: string, viewport: 'desktop' | 'mobile'): Promise<{ ok: true; data: string; mimeType: string } | { ok: false; error: string }> {
  const width = viewport === 'desktop' ? 1280 : 390;
  const height = viewport === 'desktop' ? 900 : 844;
  let browser: { close: () => Promise<void> } | null = null;
  try {
    const { chromium } = await import('@playwright/test');
    const pwBrowser = await chromium.launch({ headless: true });
    browser = pwBrowser;
    const page = await pwBrowser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: viewport === 'mobile',
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(750);
    const buf = Buffer.from(await page.screenshot({
      type: 'jpeg',
      quality: 82,
      fullPage: false,
      animations: 'disabled',
    }));
    if (buf.length < 1000) {
      return { ok: false, error: `Playwright screenshot suspiciously small (${buf.length}b)` };
    }
    return { ok: true, data: buf.toString('base64'), mimeType: 'image/jpeg' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown Playwright screenshot error' };
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function fetchScreenshotBase64(url: string, viewport: 'desktop' | 'mobile'): Promise<{ ok: true; data: string; mimeType: string } | { ok: false; error: string }> {
  const local = await fetchPlaywrightScreenshotBase64(url, viewport);
  if (local.ok) return local;
  log.warn('Playwright screenshot failed; falling back to thum.io', { url, viewport, error: local.error });
  const remote = await fetchThumioScreenshotBase64(url, viewport);
  if (remote.ok) return remote;
  return { ok: false, error: `Playwright: ${local.error}. thum.io: ${remote.error}` };
}

interface CritiqueFinding {
  rule: string;
  evidence: string;
  fix_suggestion: string;
  severity: 'BLOCKER' | 'ADVISORY';
}

interface CritiqueResult {
  score: number;
  blockers: CritiqueFinding[];
  advisory: CritiqueFinding[];
}

function parseCritiqueJson(raw: string): CritiqueResult | null {
  // Strip common LLM wrapping. Gemini sometimes returns ``` with no language tag.
  let cleaned = raw.trim();
  // Drop leading code fence (with or without "json" hint)
  cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/, '');
  // Drop trailing code fence
  cleaned = cleaned.replace(/\n?```\s*$/, '');
  cleaned = cleaned.trim();

  const start = cleaned.indexOf('{');
  if (start === -1) return null;

  // Try strict parse first
  const end = cleaned.lastIndexOf('}');
  if (end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as CritiqueResult;
      if (typeof parsed.score === 'number') {
        if (!Array.isArray(parsed.blockers)) parsed.blockers = [];
        if (!Array.isArray(parsed.advisory)) parsed.advisory = [];
        return parsed;
      }
    } catch { /* fall through to lenient repair */ }
  }

  // Lenient repair: if Gemini truncated mid-array, salvage what we can.
  // Match score, then extract complete {rule, evidence, fix_suggestion, severity}
  // objects from blockers/advisory arrays even if the JSON didn't close.
  const scoreMatch = cleaned.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/);
  if (!scoreMatch) return null;
  const score = parseFloat(scoreMatch[1]);

  function extractFindings(arrayName: 'blockers' | 'advisory'): CritiqueFinding[] {
    const re = new RegExp(`"${arrayName}"\\s*:\\s*\\[([\\s\\S]*?)(?:\\]|$)`);
    const m = cleaned.match(re);
    if (!m) return [];
    const arrayBody = m[1];
    // Match complete finding objects
    const findingRe = /\{\s*"rule"\s*:\s*"([^"]*)"\s*,\s*"evidence"\s*:\s*"([^"]*)"\s*,\s*"fix_suggestion"\s*:\s*"([^"]*)"\s*,\s*"severity"\s*:\s*"(BLOCKER|ADVISORY)"\s*\}/g;
    const findings: CritiqueFinding[] = [];
    let fm: RegExpExecArray | null;
    while ((fm = findingRe.exec(arrayBody)) !== null) {
      findings.push({ rule: fm[1], evidence: fm[2], fix_suggestion: fm[3], severity: fm[4] as 'BLOCKER' | 'ADVISORY' });
    }
    return findings;
  }

  return {
    score,
    blockers: extractFindings('blockers'),
    advisory: extractFindings('advisory'),
  };
}

// True when Gemini 2.5 Flash is wired and the vision critic can run.
// The completion gate uses this to skip the design_critique requirement
// in environments where the key isn't configured (e.g. local dev without
// a Gemini key, or backend-only deploys). Without this check, the gate
// would block every UI task forever in those environments.
export function isDesignCritiqueConfigured(): boolean {
  const k = process.env.GEMINI_API_KEY;
  return !!k && k !== 'placeholder';
}

export async function critiqueDesign(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    return 'Error: pass a full URL (e.g. https://equityzen.baljia.app/) to design_critique.';
  }
  const { assertUrlSafe } = await import('@/lib/agents/url-safety');
  const safety = await assertUrlSafe(url);
  if (!safety.ok) return `Error: ${safety.reason}`;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'placeholder') {
    return 'Error: GEMINI_API_KEY not configured — vision critique requires Gemini 2.5 Flash. Skip design_critique on this run; design_audit (regex) still applies.';
  }

  // Fetch desktop + mobile in parallel
  const [desktop, mobile] = await Promise.all([
    fetchScreenshotBase64(url, 'desktop'),
    fetchScreenshotBase64(url, 'mobile'),
  ]);

  if (!desktop.ok && !mobile.ok) {
    return `Error: screenshot service unreachable for ${url}. Desktop: ${desktop.error}. Mobile: ${mobile.error}. design_critique cannot run on this iteration; design_audit (regex) still applies. If the URL is private (auth-required) or behind a paywall, vision critique cannot reach it.`;
  }

  const screenshots: Array<{ data: string; mimeType: string; viewport: string }> = [];
  if (desktop.ok) screenshots.push({ data: desktop.data, mimeType: desktop.mimeType, viewport: 'desktop 1280×800' });
  if (mobile.ok) screenshots.push({ data: mobile.data, mimeType: mobile.mimeType, viewport: 'mobile 390×844' });

  // Build Gemini request — multi-part: rubric text + inline image data
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
      { text: RUBRIC_PROMPT },
      { text: `\n\nURL under review: ${url}\nViewports below: ${screenshots.map(s => s.viewport).join(', ')}.\n` },
    ];
    for (const s of screenshots) {
      parts.push({ inlineData: { data: s.data, mimeType: s.mimeType } });
    }

    const result = await model.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
    });
    const rawText = result.response.text();
    const parsed = parseCritiqueJson(rawText);
    if (!parsed) {
      log.warn('Gemini returned non-JSON critique', { rawText: rawText.slice(0, 300) });
      return `design_critique: Gemini returned malformed JSON. Raw response head: ${rawText.slice(0, 300)}`;
    }

    const blockerCount = parsed.blockers.length;
    const advisoryCount = parsed.advisory.length;

    if (blockerCount === 0) {
      return `design_critique CLEAN - score=${parsed.score}/10, 0 blockers, ${advisoryCount} advisory finding(s). The page has no blocking founder-facing UI issues at ${url}. ${advisoryCount > 0 ? 'Advisory items (not blocking): ' + parsed.advisory.map(a => `${a.rule}: ${a.evidence}`).join('; ').slice(0, 400) : ''}`;
    }

    const lines: string[] = [
      `design_critique score=${parsed.score}/10 found ${blockerCount} BLOCKER and ${advisoryCount} ADVISORY finding(s) on ${url}:`,
      '',
      ...parsed.blockers.map((b) => `  [BLOCKER] ${b.rule}: ${b.evidence}\n    fix: ${b.fix_suggestion}`),
      ...parsed.advisory.slice(0, 5).map((a) => `  [ADVISORY] ${a.rule}: ${a.evidence}\n    fix: ${a.fix_suggestion}`),
      '',
      blockerCount > 0
        ? '⚠ BLOCKER findings prevent task completion. Fix each via github_create_commit + render_deploy, then re-run design_critique until 0 BLOCKERs remain.'
        : 'No blockers — advisory items are optional polish.',
    ];
    return lines.join('\n');
  } catch (err) {
    return `Error: Gemini design_critique failed — ${err instanceof Error ? err.message : 'Unknown'}. design_audit (regex) still applies on this run.`;
  }
}
