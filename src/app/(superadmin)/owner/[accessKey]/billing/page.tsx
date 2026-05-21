import Link from 'next/link';
import { MetricCard } from '@/components/super-admin/MetricCard';
import { StatusBadge } from '@/components/super-admin/StatusBadge';
import { getSuperAdminBasePath, requireSuperAdminPage } from '@/lib/super-admin';
import { getSuperAdminBilling } from '@/lib/services/super-admin.service';

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

function formatValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

export default async function SuperAdminBillingPage({ params }: Props) {
  const { accessKey } = await params;
  const actor = await requireSuperAdminPage(accessKey);
  const data = await getSuperAdminBilling(actor);
  const basePath = getSuperAdminBasePath(accessKey);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Billing & Credits</h2>
          <p className="text-sm text-[#666]">Read-only subscription, revenue, and credit health for Baljia.</p>
        </div>
        <Link href={`${basePath}/companies?billingState=past_due`} className="text-sm font-medium text-[#2454a6] hover:text-[#173a73]">
          Past due companies
        </Link>
      </div>

      <div className="rounded-md border border-[#dedbd2] bg-white px-4 py-3 text-sm text-[#555]">
        Credit grants and billing mutations are intentionally not available in v1. Add them later with reason prompts and immutable audit.
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Active subscriptions" value={data.subscriptionStats?.activeSubscriptions ?? 0} />
        <MetricCard label="Trial plans" value={data.subscriptionStats?.trialSubscriptions ?? 0} />
        <MetricCard label="Past due" value={data.subscriptionStats?.pastDueSubscriptions ?? 0} />
        <MetricCard label="Night shifts remaining" value={data.subscriptionStats?.nightShiftsRemaining ?? 0} />
        <MetricCard label="Negative balances" value={data.creditStats?.negativeBalanceCompanies ?? 0} />
        <MetricCard label="Credits added 7d" value={data.creditStats?.creditsAdded7d ?? 0} />
        <MetricCard label="Credits used 7d" value={data.creditStats?.creditsUsed7d ?? 0} />
        <MetricCard label="Credit events 7d" value={data.creditStats?.creditEvents7d ?? 0} />
        <MetricCard label="Net revenue" value={formatCurrency(data.revenueStats?.netRevenue)} />
        <MetricCard label="Net revenue 7d" value={formatCurrency(data.revenueStats?.netRevenue7d)} />
      </div>

      <section className="rounded-md border border-[#dedbd2] bg-white">
        <div className="border-b border-[#dedbd2] px-4 py-3">
          <h3 className="font-medium">Recent Subscriptions</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
              <tr>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Night shifts</th>
                <th className="px-4 py-2 font-medium">Period</th>
              </tr>
            </thead>
            <tbody>
              {data.recentSubscriptions.length > 0 ? (
                data.recentSubscriptions.map((subscription) => (
                  <tr key={subscription.id} className="border-t border-[#eee]">
                    <td className="px-4 py-3">
                      {subscription.company_id ? (
                        <Link href={`${basePath}/companies/${subscription.company_id}`} className="font-medium text-[#2454a6] hover:text-[#173a73]">
                          {subscription.company_name ?? 'Unknown company'}
                        </Link>
                      ) : (
                        <span className="font-medium">{subscription.company_name ?? 'Unknown company'}</span>
                      )}
                      <div className="text-xs text-[#777]">{subscription.owner_email ?? 'unclaimed'}</div>
                    </td>
                    <td className="px-4 py-3">{subscription.plan_type}</td>
                    <td className="px-4 py-3">
                      <StatusBadge value={subscription.status} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {subscription.night_shifts_remaining ?? 0} / {subscription.night_shifts_total ?? 0}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#555]">
                      {formatDate(subscription.current_period_start)} to {formatDate(subscription.current_period_end)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-[#666]">
                    No subscriptions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-[#dedbd2] bg-white">
          <div className="border-b border-[#dedbd2] px-4 py-3">
            <h3 className="font-medium">Recent Credit Ledger</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Entry</th>
                  <th className="px-4 py-2 font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Balance</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.recentCreditLedger.length > 0 ? (
                  data.recentCreditLedger.map((entry) => (
                    <tr key={entry.id} className="border-t border-[#eee]">
                      <td className="px-4 py-3">
                        {entry.company_id ? (
                          <Link href={`${basePath}/companies/${entry.company_id}`} className="font-medium text-[#2454a6] hover:text-[#173a73]">
                            {entry.company_name ?? 'Unknown company'}
                          </Link>
                        ) : (
                          <span className="font-medium">{entry.company_name ?? 'Unknown company'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{entry.entry_type}</td>
                      <td className="px-4 py-3 tabular-nums">{entry.amount}</td>
                      <td className="px-4 py-3 tabular-nums">{entry.balance_after}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#555]">{formatDate(entry.created_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-[#666]">
                      No credit ledger entries found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-md border border-[#dedbd2] bg-white">
          <div className="border-b border-[#dedbd2] px-4 py-3">
            <h3 className="font-medium">Recent Revenue</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Entry</th>
                  <th className="px-4 py-2 font-medium">Gross</th>
                  <th className="px-4 py-2 font-medium">Net</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRevenue.length > 0 ? (
                  data.recentRevenue.map((entry) => (
                    <tr key={entry.id} className="border-t border-[#eee]">
                      <td className="px-4 py-3">
                        {entry.company_id ? (
                          <Link href={`${basePath}/companies/${entry.company_id}`} className="font-medium text-[#2454a6] hover:text-[#173a73]">
                            {entry.company_name ?? 'Unknown company'}
                          </Link>
                        ) : (
                          <span className="font-medium">{entry.company_name ?? 'Unknown company'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{formatValue(entry.entry_type)}</td>
                      <td className="px-4 py-3 tabular-nums">{formatCurrency(entry.gross_amount)}</td>
                      <td className="px-4 py-3 tabular-nums">{formatCurrency(entry.net_amount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#555]">{formatDate(entry.created_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-[#666]">
                      No revenue entries found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
