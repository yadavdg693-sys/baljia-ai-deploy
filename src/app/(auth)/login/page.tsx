// Login page — warm cream + gold theme (FIXED — was dark, now matches waitlist).

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devMagicLink, setDevMagicLink] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'google-unavailable') {
      setError('Google sign-in is not configured in this environment. Use the magic link instead.');
    }
  }, []);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setDevMagicLink(null);

    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        const data = await res.json();
        setDevMagicLink(typeof data.magicLink === 'string' ? data.magicLink : null);
        setSent(true);
      } else {
        const data = await res.json();
        setError(data.error ?? 'Failed to send login link');
      }
    } catch {
      setError('Network error — please try again');
    }

    setLoading(false);
  }

  async function handleGoogleLogin() {
    window.location.href = '/api/auth/google';
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: '#FCFBF8', color: '#1E1A16' }}
    >
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <img
            src="/mascot.png"
            alt="Baljia"
            className="mx-auto mb-4 object-contain"
            style={{ width: 96, height: 96, filter: 'drop-shadow(0 8px 20px rgba(217,119,6,0.38)) brightness(1.1) saturate(1.3)' }}
          />
          <h1
            className="text-3xl font-medium mb-2"
            style={{ fontFamily: 'var(--font-display, Newsreader, Georgia, serif)', letterSpacing: '-.6px' }}
          >
            Welcome to <span style={{ color: '#A35F05' }}>Baljia</span>
          </h1>
          <p
            className="text-sm italic"
            style={{ fontFamily: 'var(--font-display, Newsreader, Georgia, serif)', color: '#D97706' }}
          >
            Your AI Angel — runs your company while you enjoy life.
          </p>
        </div>

        {sent ? (
          <div
            className="text-center p-8 rounded-2xl"
            style={{
              background: '#FFFDF9',
              border: '1px solid #DED6CA',
              boxShadow: '0 8px 24px rgba(24,18,10,0.06)',
            }}
          >
            <div className="text-4xl mb-3">✉️</div>
            <h2 className="text-lg font-semibold mb-2">Check your email</h2>
            <p className="text-sm mb-4" style={{ color: '#5C5147' }}>
              We sent a secure login link to <strong style={{ color: '#1E1A16' }}>{email}</strong>
            </p>
            {devMagicLink && (
              <a
                href={devMagicLink}
                className="mt-4 inline-flex w-full items-center justify-center rounded-xl p-3.5 font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, #E1B12C, #D97706)' }}
              >
                Open local magic link
              </a>
            )}
            <p className="text-xs mt-4" style={{ color: '#8A7D72' }}>No password needed. Link expires in 15 minutes.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {error && (
              <p className="text-sm text-center p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#B91C1C', border: '1px solid rgba(185,28,28,0.2)' }}>
                {error}
              </p>
            )}

            <button
              onClick={handleGoogleLogin}
              className="w-full p-3.5 rounded-xl font-semibold text-white flex items-center justify-center gap-3 transition-all duration-200"
              style={{
                background: 'linear-gradient(135deg, #E1B12C, #D97706)',
                boxShadow: '0 6px 18px rgba(217,119,6,0.28), inset 0 1px 0 rgba(255,255,255,0.3)',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: '#DED6CA' }} />
              <span className="text-xs" style={{ color: '#8A7D72' }}>or sign in with email</span>
              <div className="flex-1 h-px" style={{ background: '#DED6CA' }} />
            </div>

            <form onSubmit={handleMagicLink} className="space-y-3" aria-label="Email login form">
              <label htmlFor="email-input" className="sr-only">Email address</label>
              <input
                id="email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                autoComplete="email"
                className="w-full p-3.5 rounded-xl text-sm outline-none transition-all duration-200"
                style={{
                  background: '#FFFDF9',
                  border: '1px solid #DED6CA',
                  color: '#1E1A16',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#D97706';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(225,177,44,0.14)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#DED6CA';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              <button
                type="submit"
                disabled={loading || !email}
                id="submit-login-btn"
                className="w-full p-3.5 rounded-xl font-semibold text-sm transition-all duration-200"
                style={{
                  background: '#FFFDF9',
                  border: '1px solid #DED6CA',
                  color: '#1E1A16',
                  opacity: (!email || loading) ? 0.5 : 1,
                  cursor: (!email || loading) ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Sending...' : 'Send magic link'}
              </button>
            </form>

            <p className="text-center text-xs" style={{ color: '#8A7D72' }}>
              No credit card required · Free to start
            </p>
          </div>
        )}

        <p className="text-center mt-8">
          <Link href="/" className="text-xs underline" style={{ color: '#8A7D72' }}>← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
