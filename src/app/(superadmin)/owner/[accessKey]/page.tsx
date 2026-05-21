import Link from 'next/link';
import { MetricCard } from '@/components/super-admin/MetricCard';
import { StatusBadge } from '@/components/super-admin/StatusBadge';
import { getSuperAdminBasePath, requireSuperAdminPage } from '@/lib/super-admin';
import { getSuperAdminOverview } from '@/lib/services/super-admin.service';

type Props = {
  params: Promise<{ accessKey: string }>;
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

function formatCurrency(value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);
  return currencyFormatter.format(Number.isFinite(numeric) ? numeric : 0);
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '-';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return dateFormatter.format(date);
}

export default async function SuperAdminOverviewPage({ params }: Props) {
  const { accessKey } = await params;
  const actor = await requireSuperAdminPage(accessKey);
  const data = await getSuperAdminOverview(actor);
  const basePath = getSuperAdminBasePath(accessKey);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Platform Overview</h2>
          <p className="text-sm text-[#666]">Private operating view across Baljia companies.</p>
        </div>
        <Link href={`${basePath}/companies`} className="text-sm font-medium text-[#2454a6] hover:text-[#173a73]">
          View all companies
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Total companies" value={data.companyStats?.totalCompanies ?? 0} />
        <MetricCard label="Active companies" value={data.companyStats?.activeCompanies ?? 0} />
        <MetricCard label="Paid companies" value={data.companyStats?.paidCompanies ?? 0} />
        <MetricCard label="Onboarding" value={data.companyStats?.onboardingCompanies ?? 0} />
        <MetricCard
          label="Total users"
          value={data.userStats?.totalUsers ?? 0}
          hint={`${data.userStats?.users7d ?? 0} in last 7 days`}
        />
        <MetricCard label="Running tasks" value={data.taskStats?.runningTasks ?? 0} />
        <MetricCard label="Failed tasks" value={data.taskStats?.failedTasks ?? 0} />
        <MetricCard label="Credits used 7d" value={data.creditStats?.creditsUsed7d ?? 0} />
        <MetricCard label="Active subscriptions" value={data.subscriptionStats?.activeSubscriptions ?? 0} />
        <MetricCard label="Revenue 7d" value={formatCurrency(data.revenueStats?.revenue7d)} />
      </div>

      <section className="rounded-md border border-[#dedbd2] bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-[#dedbd2] px-4 py-3">
          <h3 className="font-medium">Recent Companies</h3>
          <Link href={`${basePath}/companies`} className="text-sm font-medium text-[#2454a6] hover:text-[#173a73]">
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
              <tr>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium">Lifecycle</th>
                <th className="px-4 py-2 font-medium">Onboarding</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.recentCompanies.length > 0 ? (
                data.recentCompanies.map((company) => (
                  <tr key={company.id} className="border-t border-[#eee]">
                    <td className="px-4 py-3">
                      <Link href={`${basePath}/companies/${company.id}`} className="font-medium text-[#2454a6] hover:text-[#173a73]">
                        {company.name}
                      </Link>
                      <div className="text-xs text-[#777]">{company.slug}</div>
                    </td>
                    <td className="px-4 py-3">{company.owner_email ?? 'unclaimed'}</td>
                    <td className="px-4 py-3">{company.plan_tier ?? 'free'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge value={company.lifecycle} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={company.onboarding_status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#555]">{formatDate(company.created_at)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-[#666]">
                    No companies found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
