import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { shouldHideOwnerPathBeforeAuth } from '@/lib/super-admin-routing';

// M-INFRA-025: CORS origin whitelist
const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,  // e.g. https://baljia.app
  process.env.CORS_ORIGIN,          // additional allowed origin
].filter(Boolean) as string[];

// SUBDOMAIN ROUTING: company-facing domain.
// Wildcard DNS (*.baljia.app) sends every {slug}.baljia.app request to this
// platform until/unless a per-company CNAME is later set (which happens when
// the Engineering agent deploys a real Render service). At that point DNS
// routes the founder's traffic directly to Render and this middleware no
// longer sees the request.
const COMPANY_DOMAIN = 'baljia.app';

// Subdomains that are NEVER company slugs — reserved for platform use.
const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'admin', 'mail', 'mx', 'autodiscover',
  'parking', 'static', 'cdn', 'assets', 'updates', 'alerts', 'hello',
]);

function extractCompanySlug(host: string | null): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase();
  if (hostname === COMPANY_DOMAIN) return null;          // apex, not a slug
  if (!hostname.endsWith(`.${COMPANY_DOMAIN}`)) return null;
  const slug = hostname.slice(0, -(COMPANY_DOMAIN.length + 1));
  if (!slug) return null;
  if (slug.includes('.')) return null;                    // multi-level subdomain — skip
  if (RESERVED_SUBDOMAINS.has(slug)) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return null; // invalid slug syntax
  return slug;
}

function setCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? '';
  if (allowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cron-key, x-cron-secret');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Max-Age', '86400');
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  // M-INFRA-025: Handle CORS preflight requests
  if (request.method === 'OPTIONS' && pathname.startsWith('/api')) {
    const response = new NextResponse(null, { status: 204 });
    return setCorsHeaders(response, origin);
  }

  // SUBDOMAIN ROUTING — must run before auth checks so company landings stay public.
  // {slug}.baljia.app → rewritten to /company/{slug} which is the platform's
  // templated public page (src/app/company/[slug]/page.tsx). The rewrite is
  // server-side only; the URL bar still shows {slug}.baljia.app.
  const companySlug = extractCompanySlug(host);
  if (companySlug) {
    // Don't intercept /api requests on company subdomains — let them 404 cleanly
    // rather than falsely render a company page for what was meant to be an API call.
    if (pathname.startsWith('/api') || pathname.startsWith('/_next')) {
      return NextResponse.next();
    }
    const url = request.nextUrl.clone();
    url.pathname = `/company/${companySlug}`;
    return NextResponse.rewrite(url);
  }

  // Cron routes: validate shared secret at middleware level (not per-route)
  if (pathname.startsWith('/api/cron')) {
    const cronSecret = request.headers.get('x-cron-secret');
    if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET) {
      return setCorsHeaders(
        NextResponse.json({ error: 'Unauthorized: invalid cron secret' }, { status: 401 }),
        origin
      );
    }
    // Cron authenticated — proceed without further auth checks
    return setCorsHeaders(NextResponse.next(), origin);
  }

  // Public API routes — no auth needed
  const isPublicApi =
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/health') ||
    pathname.startsWith('/api/waitlist') ||
    pathname.startsWith('/api/quick-start') ||
    pathname.startsWith('/api/live') ||       // public live wall + lead capture
    pathname.startsWith('/api/events/stream'); // public live wall SSE

  // Protected: dashboard/owner pages + non-public API routes
  const isProtectedPage = pathname.startsWith('/dashboard') || pathname.startsWith('/owner');
  const isProtectedApi = pathname.startsWith('/api') && !isPublicApi;

  if (shouldHideOwnerPathBeforeAuth(pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  if (isProtectedPage) {
    const session = await getSessionFromRequest(request);
    if (!session) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }

  if (isProtectedApi) {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return setCorsHeaders(
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        origin
      );
    }
  }

  const response = NextResponse.next();
  // Add CORS headers to all API responses
  if (pathname.startsWith('/api')) {
    return setCorsHeaders(response, origin);
  }
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
