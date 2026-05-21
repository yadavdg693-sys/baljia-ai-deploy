// Login page - production-ready, inline styles, matches prototype.

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
      setError('Google sign-in is not configured. Use the magic link instead.');
    }
  }, []);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null); setDevMagicLink(null);
    try {
      const res = await fetch('/api/auth/magic-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      if (res.ok) { const data = await res.json(); setDevMagicLink(typeof data.magicLink === 'string' ? data.magicLink : null); setSent(true); }
      else { const data = await res.json(); setError(data.error ?? 'Failed to send login link'); }
    } catch { setError('Network error - please try again'); }
    setLoading(false);
  }

  const page: React.CSSProperties = { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Inter', system-ui, sans-serif", transition: 'background .45s, color .45s' };
  const wrap: React.CSSProperties = { width: '100%', maxWidth: 420 };
  const logoWrap: React.CSSProperties = { textAlign: 'center', marginBottom: 40 };
  const mascot: React.CSSProperties = { width: 80, height: 80, objectFit: 'contain', margin: '0 auto 16px', display: 'block', filter: 'drop-shadow(0 8px 20px rgba(217,119,6,0.38)) brightness(1.1) saturate(1.3)', animation: 'bob 2.4s ease-in-out infinite alternate' };
  const title: React.CSSProperties = { fontFamily: "'Newsreader', Georgia, serif", fontSize: 30, fontWeight: 500, letterSpacing: '-.6px', marginBottom: 6, color: 'var(--ink)' };
  const subtitle: React.CSSProperties = { fontFamily: "'Newsreader', Georgia, serif", fontSize: 14, fontStyle: 'italic', color: '#D97706' };
  const cardStyle: React.CSSProperties = { textAlign: 'center', padding: 32, borderRadius: 16, background: 'var(--bg-card)', border: '1px solid var(--line)', boxShadow: '0 8px 24px rgba(24,18,10,0.06)' };
  const goldBtn: React.CSSProperties = { width: '100%', padding: 14, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #E1B12C, #D97706)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', boxShadow: '0 6px 18px rgba(217,119,6,0.28), inset 0 1px 0 rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 };
  const secondaryBtn: React.CSSProperties = { width: '100%', padding: 14, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--bg-card)', color: 'var(--ink)', fontWeight: 600, fontSize: 14, cursor: 'pointer', transition: 'all .2s' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: 14, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--bg-card)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 14, outline: 'none' };
  const divider: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 };
  const dividerLine: React.CSSProperties = { flex: 1, height: 1, background: 'var(--line)' };
  const errorBanner: React.CSSProperties = { padding: 12, borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#DC2626', fontSize: 13, textAlign: 'center', marginBottom: 16 };

  return (
    <div style={page}>
      <div style={wrap}>
        <div style={logoWrap}>
          <img src="/mascot.png" alt="Baljia" style={mascot} />
          <h1 style={title}>Welcome to <span style={{ color: '#A35F05' }}>Baljia</span></h1>
          <p style={subtitle}>Your AI Angel for launching and growing your company.</p>
        </div>

        {sent ? (
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: '#D97706' }}>Email sent</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--ink)' }}>Check your email</h2>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>
              We sent a secure login link to <strong style={{ color: 'var(--ink)' }}>{email}</strong>
            </p>
            {devMagicLink && (
              <a href={devMagicLink} style={{ ...goldBtn, textDecoration: 'none', marginTop: 16 }}>
                Open local magic link
              </a>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 16 }}>No password needed. Link expires in 15 minutes.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {error && <div style={errorBanner}>{error}</div>}

            <button style={goldBtn} onClick={() => { window.location.href = '/api/auth/google'; }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Continue with Google
            </button>

            <div style={divider}>
              <div style={dividerLine}></div>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>or sign in with email</span>
              <div style={dividerLine}></div>
            </div>

            <form onSubmit={handleMagicLink} style={{ display: 'grid', gap: 12 }}>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter your email" required autoComplete="email" style={inputStyle}
                onFocus={e => { e.target.style.borderColor = '#D97706'; e.target.style.boxShadow = '0 0 0 3px rgba(225,177,44,0.14)'; }}
                onBlur={e => { e.target.style.borderColor = 'var(--line)'; e.target.style.boxShadow = 'none'; }}
              />
              <button type="submit" disabled={loading || !email} style={{ ...secondaryBtn, opacity: (!email || loading) ? 0.5 : 1, cursor: (!email || loading) ? 'not-allowed' : 'pointer' }}>
                {loading ? 'Sending...' : 'Send magic link'}
              </button>
            </form>

            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-dim)' }}>No credit card required - Free to start</p>
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: 32 }}>
          <Link href="/" style={{ fontSize: 12, color: 'var(--text-dim)', textDecoration: 'underline' }}>Back to home</Link>
        </p>
      </div>
    </div>
  );
}
