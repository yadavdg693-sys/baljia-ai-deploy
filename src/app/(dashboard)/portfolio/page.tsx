// /portfolio — shows every company the founder owns.
// Mirrors Polsia's founder-home shell: each row links into its dashboard.

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
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <LiveBanner liveCount={liveCompanyCount} />

      {/* Portfolio doesn't have a single "current company" — render a simpler top bar. */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-surface-primary sticky top-0 z-20">
        <Link
          href="/portfolio"
          className="text-xl font-bold font-[family-name:var(--font-display)] text-text-primary"
        >
          Baljia
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-sm text-text-muted">{user.email}</span>
          <Link
            href="/onboarding"
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border-default bg-surface-card hover:bg-surface-hover text-text-primary transition-colors"
          >
            + New
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 py-8">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Your Companies</h1>
            <p className="text-sm text-text-muted mt-1">
              {rows.length === 0
                ? 'You haven\'t started a company yet.'
                : `${rows.length} ${rows.length === 1 ? 'company' : 'companies'} running with Baljia`}
            </p>
          </div>
          <Link
            href="/onboarding"
            className="rounded-lg bg-baljia-gold px-4 py-2 text-sm font-semibold text-surface-primary hover:bg-baljia-gold-light transition-colors"
          >
            + New company
          </Link>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-border-default bg-surface-card p-12 text-center">
            <div className="mb-4 text-5xl opacity-50">🚀</div>
            <h2 className="text-lg font-semibold mb-2">Ready to start your first company?</h2>
            <p className="text-sm text-text-muted mb-6 max-w-md mx-auto">
              Baljia will take your idea — or invent one for you — and build a real company around it.
              Landing page, email, ads, research. All of it.
            </p>
            <Link
              href="/onboarding"
              className="inline-block rounded-lg bg-baljia-gold px-5 py-2.5 text-sm font-semibold text-surface-primary hover:bg-baljia-gold-light transition-colors"
            >
              Start your first company →
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
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
                <li key={row.id}>
                  <Link
                    href={`/dashboard/${row.id}`}
                    className="group block rounded-xl border border-border-default bg-surface-card p-5 hover:border-baljia-gold/40 hover:bg-surface-card-hover transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-semibold text-text-primary group-hover:text-baljia-gold transition-colors">
                            {row.name}
                          </h3>
                          {isActive && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                              live
                            </span>
                          )}
                          {onboardingRunning && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-baljia-gold/15 px-2 py-0.5 text-xs font-medium text-baljia-gold">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-baljia-gold" />
                              setting up
                            </span>
                          )}
                        </div>
                        {row.one_liner && (
                          <p className="mt-1 text-sm text-text-secondary line-clamp-2">{row.one_liner}</p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                          <span className="capitalize">
                            {String(row.company_stage).replace(/_/g, ' ')}
                          </span>
                          <span>·</span>
                          <span>{row.total_tasks} tasks</span>
                          {row.running_tasks > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-baljia-gold">{row.running_tasks} running</span>
                            </>
                          )}
                          <span>·</span>
                          <span className="capitalize">{row.plan_tier}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {siteUrl && (
                          <a
                            href={siteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-text-muted hover:text-baljia-gold underline underline-offset-2"
                          >
                            Visit site ↗
                          </a>
                        )}
                        <span
                          aria-hidden="true"
                          className="text-text-muted transition-transform group-hover:translate-x-1"
                        >
                          →
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
