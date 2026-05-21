// Landing page — v2 with dark/light theme toggle + warm cream/gold.
// Uses CSS custom properties from globals.css (--bg, --ink, --text-muted, etc.)
// so it automatically adapts when body.dark is toggled.

import Link from 'next/link';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export default function LandingPage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)', transition: 'background .45s, color .45s' }}>
      {/* Live bar */}
      <div style={{ background: 'var(--ink)', color: '#FFF7ED', textAlign: 'center', fontSize: 12, padding: '7px 0', fontWeight: 600 }}>
        <Link href="/live" className="hover:underline" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'inherit' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#E1B12C', boxShadow: '0 0 8px #E1B12C', animation: 'pulse-dot 1.4s infinite', display: 'inline-block' }} />
          Watch Baljia work on companies live →
        </Link>
      </div>

      {/* Nav */}
      <header style={{ maxWidth: 1140, margin: '0 auto', padding: '16px 32px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/mascot.png" alt="Baljia" style={{ width: 32, height: 32, objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(225,177,44,0.3)) brightness(1.08) saturate(1.2)' }} />
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-.2px' }}>Baljia AI</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontStyle: 'italic', color: '#D97706' }}>· Your AI Angel</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/live" style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 500 }}>Live</Link>
          <Link href="/login" style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 500 }}>Sign in</Link>
          <ThemeToggle />
          <Link href="/login" style={{
            background: 'linear-gradient(135deg, #E1B12C, #D97706)', color: '#fff',
            padding: '8px 18px', borderRadius: 999, fontSize: 13, fontWeight: 600,
            boxShadow: '0 6px 18px rgba(217,119,6,0.28), inset 0 1px 0 rgba(255,255,255,0.3)',
          }}>
            Get Started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main style={{ maxWidth: 1140, margin: '0 auto', padding: '60px 32px 60px', display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 48, alignItems: 'center', minHeight: 'calc(100vh - 200px)' }}>
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const,
            color: '#A35F05', background: 'var(--gold-bg)', border: '1px solid var(--gold-border)',
            padding: '6px 14px', borderRadius: 999, marginBottom: 20,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#E1B12C', boxShadow: '0 0 8px #E1B12C', animation: 'pulse-dot 2s infinite' }} />
            Launching Q2 2026
          </div>

          <h2 style={{
            fontFamily: 'var(--font-display)', fontWeight: 400,
            fontSize: 'clamp(40px, 5.5vw, 68px)', lineHeight: 1.04, letterSpacing: '-2px',
            color: 'var(--ink)', marginBottom: 16,
          }}>
            Launch and Grow{' '}
            <em style={{
              fontStyle: 'italic', fontWeight: 500,
              background: 'linear-gradient(135deg, #FFB800, #D97706)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>Your Company</em>{' '}with AI Angel
          </h2>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 28, height: 1, background: 'linear-gradient(90deg, transparent, #D97706)' }} />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontStyle: 'italic', color: '#A35F05' }}>Bringing your ideas to reality.</span>
          </div>

          <p style={{ fontSize: 16, color: 'var(--text-muted)', maxWidth: 500, lineHeight: 1.65, marginBottom: 28 }}>
            One AI workspace that <strong style={{ color: 'var(--ink-2)' }}>helps you launch and grow your company</strong> with product, marketing, research, and daily execution in one place.
          </p>

          <Link href="/login" style={{
            display: 'inline-block', padding: '12px 28px', borderRadius: 12, fontWeight: 700, fontSize: 15,
            background: 'linear-gradient(135deg, #E1B12C, #D97706)', color: '#fff',
            boxShadow: '0 6px 18px rgba(217,119,6,0.28), inset 0 1px 0 rgba(255,255,255,0.3)',
          }}>
            Get Started — It&apos;s Free →
          </Link>
          <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 10 }}>✓ No credit card required · Free to start</p>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 36, maxWidth: 480 }}>
            {[{ v: '9', l: 'AI Agents' }, { v: '24/7', l: 'Autonomous' }, { v: '$0', l: 'To Start' }].map((s, i) => (
              <div key={i} style={{ borderLeft: i ? '1px solid var(--border-strong)' : 'none', paddingLeft: i ? 12 : 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 500, color: 'var(--ink)', lineHeight: 1, letterSpacing: '-.5px' }}>{s.v}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 1.2, marginTop: 4, fontWeight: 600 }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Mascot + Console */}
        <div style={{ position: 'relative', paddingTop: 140 }}>
          <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 140, zIndex: 3 }}>
            <div style={{ position: 'absolute', inset: '-10%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(225,177,44,0.12), transparent 60%)' }} />
            <img src="/mascot.png" alt="Baljia mascot" style={{ width: '100%', objectFit: 'contain', position: 'relative', filter: 'drop-shadow(0 12px 24px rgba(217,119,6,0.35)) brightness(1.08) saturate(1.25)', animation: 'bob 4s ease-in-out infinite alternate' }} />
          </div>
          <div style={{
            background: 'linear-gradient(180deg, #15100A, #1B140C)',
            border: '1px solid rgba(225,177,44,0.22)', borderRadius: 18, overflow: 'hidden',
            boxShadow: 'var(--shadow-lg), inset 0 0 0 1px rgba(255,255,255,0.02)',
            fontFamily: 'var(--font-mono)', color: '#E6DDCB',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid rgba(225,177,44,0.18)', background: 'rgba(225,177,44,0.04)' }}>
              <span style={{ display: 'flex', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#F87171' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FBBF24' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#34D399' }} />
              </span>
              <span style={{ fontSize: 11, color: 'rgba(255,245,220,0.6)', flex: 1 }}>baljia — live operations</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#FCD34D' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FCD34D', boxShadow: '0 0 6px #FCD34D', animation: 'pulse-dot 1.4s infinite' }} />
                3 active
              </span>
            </div>
            <div style={{ padding: 16, fontSize: 12, lineHeight: '1.8', minHeight: 180 }}>
              {[
                { ts: '14:23:01', tag: 'ENG', bg: 'rgba(52,211,153,0.15)', tc: '#6EE7B7', msg: 'Landing page deployed → ', hl: 'acme.baljia.app' },
                { ts: '14:23:18', tag: 'MKT', bg: 'rgba(251,191,36,0.15)', tc: '#FCD34D', msg: 'Tweet scheduled: "', hl: '3 ways AI cuts costs..."' },
                { ts: '14:24:02', tag: 'OPS', bg: 'rgba(167,139,250,0.15)', tc: '#C4B5FD', msg: 'Market research complete — ', hl: '4 competitors mapped' },
                { ts: '14:24:15', tag: 'ENG', bg: 'rgba(52,211,153,0.15)', tc: '#6EE7B7', msg: 'Database provisioned → ', hl: 'neon-prod-east' },
                { ts: '14:25:01', tag: 'MKT', bg: 'rgba(251,191,36,0.15)', tc: '#FCD34D', msg: 'Cold outreach: ', hl: '12 leads contacted' },
              ].map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: '#8A7D6B' }}>{l.ts}</span>
                  <span style={{ padding: '0 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, letterSpacing: '.4px', textTransform: 'uppercase' as const, background: l.bg, color: l.tc }}>{l.tag}</span>
                  <span>{l.msg}<span style={{ color: '#FFD88F' }}>{l.hl}</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Features */}
      <section style={{ maxWidth: 1140, margin: '0 auto', padding: '80px 32px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase' as const, color: '#A35F05', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ width: 16, height: 1, background: '#D97706' }} />Departments
        </div>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px,4vw,44px)', fontWeight: 400, letterSpacing: '-1px', lineHeight: 1.08, marginBottom: 40, color: 'var(--ink)' }}>
          Your AI team, <em style={{ fontStyle: 'italic', color: '#A35F05' }}>always on</em>
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {[
            { icon: '⚡', title: 'Engineering', desc: 'Builds your full-stack product — landing pages, APIs, databases. Deploys automatically.' },
            { icon: '📣', title: 'Marketing', desc: 'Runs Twitter, cold outreach, and Meta ads. Writes copy, schedules posts, tracks performance.' },
            { icon: '🔍', title: 'Research', desc: 'Deep market analysis, competitor mapping, and demand signals. Cites real sources.' },
            { icon: '🧠', title: 'Baljia Chat', desc: 'Your AI co-founder. Discuss strategy, approve tasks, get updates — all in natural language.' },
          ].map((f, i) => (
            <div key={i} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 18, padding: 20,
              boxShadow: '0 1px 2px rgba(24,18,10,0.04)', transition: 'all .3s',
            }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--gold-bg)', border: '1px solid var(--gold-border)', display: 'grid', placeItems: 'center', fontSize: 20, marginBottom: 14 }}>{f.icon}</div>
              <h4 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: 'var(--ink)' }}>{f.title}</h4>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section style={{ maxWidth: 900, margin: '0 auto', padding: '80px 32px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase' as const, color: '#A35F05', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ width: 16, height: 1, background: '#D97706' }} />How It Works
        </div>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px,4vw,44px)', fontWeight: 400, letterSpacing: '-1px', lineHeight: 1.08, marginBottom: 40, color: 'var(--ink)' }}>
          Three steps to <em style={{ fontStyle: 'italic', color: '#A35F05' }}>launch</em>
        </h3>
        <div style={{ display: 'grid', gap: 24 }}>
          {[
            { n: '01', title: 'Describe your vision', desc: 'Tell Baljia your idea — or let it surprise you with one based on your background.' },
            { n: '02', title: 'AI Angel builds', desc: 'Research, naming, landing page, market analysis, and a first operating plan — all in 60 seconds.' },
            { n: '03', title: 'Approve & grow', desc: 'Review tasks, chat with Baljia, and watch your company grow autonomously.' },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 20, alignItems: 'start' }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #E1B12C, #D97706)', color: '#fff',
                display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)',
                fontSize: 18, fontStyle: 'italic', fontWeight: 500, boxShadow: 'var(--shadow-gold)',
              }}>{s.n}</div>
              <div>
                <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500, marginBottom: 6, color: 'var(--ink)' }}>{s.title}</h4>
                <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.65 }}>{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ maxWidth: 1140, margin: '0 auto', padding: '48px 32px 32px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, fontSize: 12, color: 'var(--text-dim)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/mascot.png" style={{ width: 24, height: 24, objectFit: 'contain', filter: 'drop-shadow(0 0 4px rgba(225,177,44,0.2)) saturate(1.2)' }} alt="" />
          <span style={{ fontWeight: 700, color: 'var(--ink)' }}>Baljia AI</span>
          <span style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', color: '#D97706' }}>· Your AI Angel</span>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          <Link href="/about" style={{ color: 'inherit' }}>About</Link>
          <Link href="/terms" style={{ color: 'inherit' }}>Terms</Link>
          <Link href="/privacy" style={{ color: 'inherit' }}>Privacy</Link>
          <a href="mailto:hello@baljia.app" style={{ color: 'inherit' }}>hello@baljia.app</a>
        </div>
      </footer>
    </div>
  );
}
