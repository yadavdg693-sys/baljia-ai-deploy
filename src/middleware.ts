import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public API routes — no auth needed
  const isPublicApi =
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/health') ||
    pathname.startsWith('/api/cron') ||
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
      // Return JSON 401 for API routes, not a redirect
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
