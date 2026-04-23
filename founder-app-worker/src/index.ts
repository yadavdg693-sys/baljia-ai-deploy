// Baljia Founder Apps — Wildcard Worker
//
// Per ADR-002 Shape 1: a single Worker script bound to *.baljia.app/*.
// Routes incoming requests by Host header to the right founder's content
// (Tier 1 via R2 today; Tier 2/3 are stubbed for v1.5).
//
// Flow:
//   1. Parse Host header  → extract subdomain ("acme.baljia.app" → "acme")
//   2. Validate subdomain (reject root, www, invalid chars)
//   3. Look up content:
//        - Tier 1: R2 at `founder-apps/{subdomain}/index.html`
//        - Tier 2/3: not yet — returns 501 with a clear message for v1.0
//   4. Serve with cache headers + security headers
//
// Upload path (platform side):
//   src/lib/services/cf-deploy.service.ts → uploadLandingHtml(subdomain, html)
//   → writes to R2 key `founder-apps/{subdomain}/index.html` → this Worker reads it.

export interface Env {
  /** R2 bucket binding — stores founder landing HTML */
  ASSETS: R2Bucket;
  /** Platform API base URL for future event callbacks (e.g., view logging) */
  PLATFORM_API_BASE?: string;
  LOG_LEVEL?: string;
}

const APEX_DOMAIN = 'baljia.app';

// Reserved subdomains — never serve founder content from these.
const RESERVED_SUBDOMAINS = new Set([
  'www',
  'api',
  'admin',
  'mail',
  'email',
  'cdn',
  'assets',
  'status',
  'parking',
  'app',     // could collide with platform routes
]);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const host = request.headers.get('host') ?? url.hostname;
    const subdomain = parseSubdomain(host);

    // ── Routing guards ──
    if (!subdomain) {
      return renderError(404, 'Invalid host', `Host header "${host}" did not resolve to a *.${APEX_DOMAIN} subdomain.`);
    }
    if (RESERVED_SUBDOMAINS.has(subdomain)) {
      return renderError(404, 'Reserved subdomain', `"${subdomain}.${APEX_DOMAIN}" is a reserved system subdomain, not a founder app.`);
    }

    // ── Static assets under the subdomain (css/js/img etc) — Tier 2/3 will need this ──
    if (url.pathname !== '/' && !url.pathname.endsWith('/')) {
      return serveStaticAsset(request, env, subdomain, url.pathname);
    }

    // ── Root path: serve the Tier 1 landing HTML ──
    return serveTier1Landing(request, env, subdomain);
  },
} satisfies ExportedHandler<Env>;

// ══════════════════════════════════════════════
// SUBDOMAIN PARSING
// ══════════════════════════════════════════════

function parseSubdomain(host: string): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase(); // strip port, lowercase
  if (!hostname.endsWith(`.${APEX_DOMAIN}`)) return null;

  const sub = hostname.slice(0, -1 * (APEX_DOMAIN.length + 1)); // drop ".baljia.app"
  if (!sub || sub.length === 0) return null;

  // Guard: reject multi-level like "foo.bar.baljia.app" (we only serve single-level)
  if (sub.includes('.')) return null;

  // Guard: subdomain char validation (RFC 1035 subset)
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(sub)) return null;

  return sub;
}

// ══════════════════════════════════════════════
// TIER 1 — STATIC LANDING HTML FROM R2
// ══════════════════════════════════════════════

async function serveTier1Landing(request: Request, env: Env, subdomain: string): Promise<Response> {
  const key = `founder-apps/${subdomain}/index.html`;

  // Conditional GET short-circuit — use HEAD-style fetch first for 304 handling
  const ifNoneMatch = request.headers.get('if-none-match');

  let object: R2ObjectBody | null;
  try {
    object = await env.ASSETS.get(key);
  } catch (err) {
    console.error('R2 get error', { subdomain, key, error: String(err) });
    return renderError(502, 'Storage error', 'Failed to read landing content. Try again shortly.');
  }

  if (!object) {
    return renderNotFoundLanding(subdomain);
  }

  const etag = object.httpEtag;
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  const body = await object.arrayBuffer();

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, stale-while-revalidate=300',
      'etag': etag,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
      'referrer-policy': 'strict-origin-when-cross-origin',
      // HSTS — force HTTPS on baljia.app and all its subdomains
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      // CSP — founder landing pages are LLM-generated; the upload path is not
      // sanitized (intentional, to preserve creative freedom). Any JS or stolen
      // session cookie scoped to .baljia.app would be a cross-founder hazard.
      // Policy: allow inline styles (common in landing pages), disallow scripts
      // entirely, and allow images/fonts from self + data: + https:.
      // Founders who need JS on their landing must pass a Tier 2/3 review.
      'content-security-policy': [
        "default-src 'none'",
        "style-src 'self' 'unsafe-inline' https:",
        "img-src 'self' data: https:",
        "font-src 'self' data: https:",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
      ].join('; '),
      'x-baljia-tier': '1',
      'x-baljia-subdomain': subdomain,
    },
  });
}

// ══════════════════════════════════════════════
// STATIC ASSETS — for future Tier 2/3 with CSS/JS/images
// ══════════════════════════════════════════════

async function serveStaticAsset(request: Request, env: Env, subdomain: string, pathname: string): Promise<Response> {
  // request is reserved for future conditional-GET support on assets
  void request;
  // Safety: strip leading slash, reject path traversal attempts
  const clean = pathname.replace(/^\/+/, '');
  if (clean.includes('..') || clean.includes('\\')) {
    return renderError(400, 'Bad request', 'Invalid path.');
  }

  const key = `founder-apps/${subdomain}/${clean}`;
  let object: R2ObjectBody | null;
  try {
    object = await env.ASSETS.get(key);
  } catch (err) {
    console.error('R2 asset get error', { subdomain, key, error: String(err) });
    return renderError(502, 'Storage error', 'Failed to read asset.');
  }

  if (!object) {
    return renderError(404, 'Asset not found', `No asset at ${pathname} for ${subdomain}.${APEX_DOMAIN}.`);
  }

  const contentType = object.httpMetadata?.contentType ?? guessContentType(clean);
  return new Response(await object.arrayBuffer(), {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=3600',
      'etag': object.httpEtag,
      'x-content-type-options': 'nosniff',
    },
  });
}

function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    txt: 'text/plain; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
    pdf: 'application/pdf',
  };
  return map[ext] ?? 'application/octet-stream';
}

// ══════════════════════════════════════════════
// 404 / ERROR RESPONSES
// ══════════════════════════════════════════════

function renderNotFoundLanding(subdomain: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not ready yet · ${subdomain}.${APEX_DOMAIN}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  body { background: #0a0a0a; color: #f5f5f5; display: grid; place-items: center; padding: 2rem; }
  .wrap { max-width: 480px; text-align: center; }
  .dot { display: inline-block; width: 8px; height: 8px; background: #F5A623; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
  h1 { font-size: 2rem; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 1rem; }
  p { color: #a3a3a3; line-height: 1.6; margin-bottom: 1.5rem; }
  .sub { font-family: ui-monospace, Menlo, Consolas, monospace; color: #F5A623; font-size: 0.875rem; }
  a { color: #F5A623; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="wrap">
    <h1><span class="dot"></span>Not ready yet</h1>
    <p class="sub">${subdomain}.${APEX_DOMAIN}</p>
    <p>This founder hasn't published their landing page yet. If you're the founder, the Engineering agent will handle this shortly — check your Baljia dashboard.</p>
    <p><a href="https://baljia.ai">← Baljia AI</a></p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-baljia-tier': '0',
      'x-baljia-subdomain': subdomain,
    },
  });
}

function renderError(status: number, title: string, detail: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · baljia.app</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  body { background: #0a0a0a; color: #f5f5f5; display: grid; place-items: center; padding: 2rem; }
  .wrap { max-width: 480px; text-align: center; }
  h1 { font-size: 2rem; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 1rem; }
  .code { font-family: ui-monospace, Menlo, Consolas, monospace; color: #F5A623; margin-bottom: 1rem; }
  p { color: #a3a3a3; line-height: 1.6; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="code">HTTP ${status}</div>
    <h1>${title}</h1>
    <p>${detail}</p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
