// /portfolio — Polsia-styled list of every company the founder owns.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { db, companies, tasks } from '@/lib/db';
import { desc, eq, sql } from 'drizzle-orm';
import { LiveBanner } from '@/components/dashboard/LiveBanner';

export const metadata = {
  title: 'Portfolio | Baljia AI',
  description: 'Every company you run with Baljia.',
};

export default async function PortfolioPage() {
  const user = await getSessionFromCookies();
  if (!user) redirect('/login');

  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      one_liner: companies.one_liner,
      company_stage: companies.company_stage,
      lifecycle: companies.lifecycle,
      subdomain: companies.subdomain,
      custom_domain: companies.custom_domain,
      created_at: companies.created_at,
      onboarding_status: companies.onboarding_status,
      plan_tier: companies.plan_tier,
      total_tasks: sql<number>`(SELECT COUNT(*)::int FROM ${tasks} WHERE ${tasks.company_id} = ${companies.id})`,
      running_tasks: sql<number>`(SELECT COUNT(*)::int FROM ${tasks} WHERE ${tasks.company_id} = ${companies.id} AND ${tasks.status} = 'in_progress')`,
    })
    .from(companies)
    .where(eq(companies.owner_id, user.id))
    .orderBy(desc(companies.created_at));

  const [liveCountResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(companies)
    .where(sql`${companies.lifecycle} IN ('trial_active', 'full_active')`);
  const liveCompanyCount = Number(liveCountResult?.count ?? 0);

  return (
    <div className="dashboard-shell">
      <LiveBanner liveCount={liveCompanyCount} />

      <header className="dashboard-topbar">
        <div className="dashboard-topbar__title serif">My Portfolio</div>
        <div className="dashboard-topbar__actions">
          <Link className="chrome-button chrome-button--small" href="/onboarding">
            + New
          </Link>
        </div>
      </header>

      <main className="portfolio-page">
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          {rows.length === 0
            ? "You haven't started a company yet."
            : `${rows.length} ${rows.length === 1 ? 'company' : 'companies'} · signed in as ${user.email}`}
        </p>

        {rows.length === 0 ? (
          <div className="portfolio-row" style={{ textAlign: 'center', padding: 32 }}>
            <h2 className="serif" style={{ fontSize: 22, marginBottom: 8 }}>
              Ready to start your first company?
            </h2>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>
              Baljia will take your idea — or invent one for you — and build a real company around it.
            </p>
            <Link className="chrome-button chrome-button--hero" href="/onboarding">
              Start your first company →
            </Link>
          </div>
        ) : (
          <div className="portfolio-list">
            {rows.map((row) => {
              const siteUrl = row.custom_domain
                ? `https://${row.custom_domain}`
                : row.subdomain
                  ? `https://${row.subdomain}.baljia.app`
                  : null;
              const isActive = row.lifecycle === 'trial_active' || row.lifecycle === 'full_active';
              const onboardingRunning =
                row.onboarding_status === 'initializing' || row.onboarding_status === 'running';

              return (
                <Link
                  key={row.id}
                  href={`/dashboard/${row.id}`}
                  className="portfolio-row"
                  style={{ display: 'block' }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <h3 className="serif" style={{ fontSize: 18, lineHeight: 1.2, marginBottom: 4 }}>
                        {row.name}
                        {isActive && (
                          <span className="micro-pill live-pill" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                            live
                          </span>
                        )}
                        {onboardingRunning && (
                          <span className="micro-pill" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                            setting up
                          </span>
                        )}
                      </h3>
                      {row.one_liner && (
                        <p style={{ fontSize: 12, color: '#3a3a3a', marginBottom: 6 }}>
                          {row.one_liner}
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)' }}>
                        <span style={{ textTransform: 'capitalize' }}>
                          {String(row.company_stage).replace(/_/g, ' ')}
                        </span>
                        <span>·</span>
                        <span>{row.total_tasks} tasks</span>
                        {row.running_tasks > 0 && (
                          <>
                            <span>·</span>
                            <span style={{ color: 'var(--orange)' }}>{row.running_tasks} running</span>
                          </>
                        )}
                        <span>·</span>
                        <span style={{ textTransform: 'capitalize' }}>{row.plan_tier}</span>
                      </div>
                    </div>
                    {siteUrl && (
                      <span style={{ fontSize: 11, color: 'var(--muted)', textDecoration: 'underline' }}>
                        {siteUrl.replace(/^https?:\/\//, '')} ↗
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
