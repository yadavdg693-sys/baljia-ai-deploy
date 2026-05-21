// Portfolio page — production-ready, inline styles, matches prototype.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { db, companies, tasks } from '@/lib/db';
import { desc, eq, sql } from 'drizzle-orm';

export const metadata = {
  title: 'Portfolio | Baljia AI',
  description: 'Every company you run with Baljia.',
};

export default async function PortfolioPage() {
  const user = await getSessionFromCookies();
  if (!user) redirect('/login');

  const rows = await db
    .select({
      id: companies.id, name: companies.name, slug: companies.slug,
      one_liner: companies.one_liner,
      lifecycle: companies.lifecycle, subdomain: companies.subdomain,
      custom_domain: companies.custom_domain, created_at: companies.created_at,
      onboarding_status: companies.onboarding_status, plan_tier: companies.plan_tier,
      total_tasks: sql<number>`(SELECT COUNT(*)::int FROM ${tasks} WHERE ${tasks.company_id} = ${companies.id})`,
      running_tasks: sql<number>`(SELECT COUNT(*)::int FROM ${tasks} WHERE ${tasks.company_id} = ${companies.id} AND ${tasks.status} = 'in_progress')`,
    })
    .from(companies)
    .where(eq(companies.owner_id, user.id))
    .orderBy(desc(companies.created_at));

  const S = {
    page: { minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Inter', system-ui, sans-serif" } as const,
    topbar: { position: 'sticky' as const, top: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px', minHeight: 60, borderBottom: '1px solid var(--line)', background: 'color-mix(in oklab, var(--bg) 92%, transparent)', backdropFilter: 'blur(14px)' } as const,
    topbarTitle: { fontFamily: "'Newsreader', Georgia, serif", fontSize: 28, fontWeight: 500, letterSpacing: '-.6px', color: 'var(--ink)' } as const,
    main: { maxWidth: 900, margin: '0 auto', padding: '32px 24px 64px' } as const,
    btn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'var(--bg-card)', color: 'var(--ink)', fontSize: 12, fontWeight: 700, cursor: 'pointer', textDecoration: 'none' } as const,
    btnPrimary: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 20px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #E1B12C, #D97706)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'none', boxShadow: '0 6px 18px rgba(217,119,6,0.28), inset 0 1px 0 rgba(255,255,255,0.3)' } as const,
    card: { display: 'block', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 2px rgba(24,18,10,0.04)', transition: 'all .25s', textDecoration: 'none', color: 'inherit' } as const,
    badge: (variant: string) => {
      const c: Record<string, { bg: string; color: string; border: string }> = {
        gold: { bg: 'rgba(225,177,44,0.12)', color: '#D97706', border: 'rgba(225,177,44,0.28)' },
        default: { bg: 'var(--bg-alt)', color: 'var(--text-muted)', border: 'var(--border)' },
      };
      const v = c[variant] || c.default;
      return { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: v.bg, color: v.color, border: `1px solid ${v.border}`, verticalAlign: 'middle', marginLeft: 10 } as const;
    },
    emptyState: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 40, textAlign: 'center' as const } as const,
  };

  return (
    <div style={S.page}>
      <header style={S.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/mascot.png" alt="Baljia" style={{ width: 32, height: 32, objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(225,177,44,0.3)) brightness(1.08) saturate(1.2)' }} />
          <div style={S.topbarTitle}>My Portfolio</div>
        </div>
        <Link href="/onboarding" style={S.btnPrimary}>+ New Company</Link>
      </header>

      <main style={S.main}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          {rows.length === 0
            ? "You haven't started a company yet."
            : `${rows.length} ${rows.length === 1 ? 'company' : 'companies'} · signed in as ${user.email}`}
        </p>

        {rows.length === 0 ? (
          <div style={S.emptyState}>
            <img src="/mascot.png" alt="" style={{ width: 64, height: 64, objectFit: 'contain', margin: '0 auto 16px', display: 'block', filter: 'drop-shadow(0 6px 16px rgba(217,119,6,0.3)) brightness(1.08) saturate(1.2)' }} />
            <h2 style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 22, fontWeight: 500, marginBottom: 8, color: 'var(--ink)' }}>
              Ready to start your first company?
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, maxWidth: 400, margin: '0 auto 20px' }}>
              Baljia will take your idea — or invent one for you — and build a real company around it.
            </p>
            <Link href="/onboarding" style={S.btnPrimary}>Start your first company →</Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {rows.map((row) => {
              const siteUrl = row.custom_domain ? `https://${row.custom_domain}` : row.subdomain ? `https://${row.subdomain}.baljia.app` : null;
              const isActive = row.lifecycle === 'trial_active' || row.lifecycle === 'full_active';
              const onboardingRunning = row.onboarding_status === 'initializing' || row.onboarding_status === 'running';

              return (
                <Link key={row.id} href={`/dashboard/${row.id}`} style={S.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 16 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                        <h3 style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{row.name}</h3>
                        {isActive && <span style={S.badge('gold')}>live</span>}
                        {onboardingRunning && <span style={S.badge('default')}>setting up</span>}
                      </div>
                      {row.one_liner && <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{row.one_liner}</p>}
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-dim)' }}>
                        <span>{row.total_tasks} tasks</span>
                        {row.running_tasks > 0 && (<><span>·</span><span style={{ color: '#D97706' }}>{row.running_tasks} running</span></>)}
                        <span>·</span>
                        <span style={{ textTransform: 'capitalize' }}>{row.plan_tier}</span>
                      </div>
                    </div>
                    {siteUrl && <span style={{ fontSize: 12, color: 'var(--text-dim)', flexShrink: 0 }}>{siteUrl.replace(/^https?:\/\//, '')} ↗</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, fontSize: 12, color: 'var(--text-dim)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/mascot.png" style={{ width: 20, height: 20, objectFit: 'contain', filter: 'drop-shadow(0 0 4px rgba(225,177,44,0.2)) saturate(1.2)' }} alt="" />
          <span style={{ fontWeight: 700, color: 'var(--ink)' }}>Baljia AI</span>
          <span style={{ fontFamily: "'Newsreader', Georgia, serif", fontStyle: 'italic', color: '#D97706' }}>· Your AI Angel</span>
        </div>
        <span>hello@baljia.app</span>
      </footer>
    </div>
  );
}
