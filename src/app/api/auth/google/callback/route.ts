// GET /api/auth/google/callback — handle Google OAuth callback
import { NextRequest, NextResponse } from 'next/server';
import * as authService from '@/lib/services/auth.service';
import { signJWT, setSessionCookie } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const storedState = request.cookies.get('oauth-state')?.value;

  // CSRF check
  if (!state || !storedState || state !== storedState) {
    return NextResponse.redirect(new URL('/login?error=invalid_state', request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', request.url));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const redirectUri = `${baseUrl}/api/auth/google/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      console.error('Google token exchange failed:', await tokenRes.text());
      return NextResponse.redirect(new URL('/login?error=token_exchange_failed', request.url));
    }

    const tokens = await tokenRes.json() as { access_token: string };

    // Get user profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileRes.ok) {
      return NextResponse.redirect(new URL('/login?error=profile_fetch_failed', request.url));
    }

    const profile = await profileRes.json() as { id: string; email: string; name?: string; picture?: string };

    const result = await authService.findOrCreateGoogleUser({
      id: profile.id,
      email: profile.email,
      name: profile.name ?? null,
      picture: profile.picture ?? null,
    });

    const jwt = await signJWT(result.userId);
    const response = NextResponse.redirect(new URL('/callback', request.url));
    setSessionCookie(response, jwt);

    // Clear the oauth-state cookie
    response.headers.append(
      'Set-Cookie',
      'oauth-state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    );

    return response;
  } catch (err) {
    console.error('Google OAuth error:', err);
    return NextResponse.redirect(new URL('/login?error=oauth_failed', request.url));
  }
}
