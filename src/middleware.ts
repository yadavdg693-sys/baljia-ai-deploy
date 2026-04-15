import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

// M-INFRA-025: CORS origin whitelist
const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,  // e.g. https://baljia.app
  process.env.CORS_ORIGIN,          // additional allowed origin
].filter(Boolean) as string[];

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

  // M-INFRA-025: Handle CORS preflight requests
  if (request.method === 'OPTIONS' && pathname.startsWith('/api')) {
    const response = new NextResponse(null, { status: 204 });
    return setCorsHeaders(response, origin);
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
    pathname.startsWith('/api/events/stream'); // public live wall SSE

  // Protected: dashboard pages + non-public API routes
  const isProtectedPage = pathname.startsWith('/dashboard');
  const isProtectedApi = pathname.startsWith('/api') && !isPublicApi;

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
