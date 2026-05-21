import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MetricCard } from '@/components/super-admin/MetricCard';
import { StatusBadge } from '@/components/super-admin/StatusBadge';
import { getSuperAdminBasePath, requireSuperAdminPage } from '@/lib/super-admin';
import { getSuperAdminCompanyDetail } from '@/lib/services/super-admin.service';
import { isValidUUID } from '@/lib/uuid-validation';

type Props = {
  params: Promise<{ accessKey: string; companyId: string }>;
};

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

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

function formatOwner(name: string | null, email: string | null): string {
  if (name && email) return `${name} (${email})`;
  return name ?? email ?? 'unclaimed';
}

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="border-t border-[#eee] px-4 py-3 first:border-t-0">
      <dt className="text-xs font-medium uppercase text-[#777]">{label}</dt>
      <dd className="mt-1 break-words text-sm text-[#222]">{formatValue(value)}</dd>
    </div>
  );
}

export default async function SuperAdminCompanyDetailPage({ params }: Props) {
  const { accessKey, companyId } = await params;
  const user = await requireSuperAdminPage(accessKey);

  if (!isValidUUID(companyId)) {
    notFound();
  }

  const data = await getSuperAdminCompanyDetail(user, companyId);

  if (!data) {
    notFound();
  }

  const basePath = getSuperAdminBasePath(accessKey);
  const { company, counts, subscription, recentTasks, recentEvents, recentReports } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`${basePath}/companies`} className="text-sm font-medium text-[#2454a6] hover:text-[#173a73]">
          Back to companies
        </Link>
      </div>

      <header className="rounded-md border border-[#dedbd2] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-semibold">{company.name}</h2>
            <p className="mt-1 max-w-3xl text-sm text-[#666]">{company.one_liner ?? company.original_idea ?? 'No description recorded.'}</p>
            <p className="mt-2 break-all text-xs text-[#777]">ID: {company.id}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge value={company.lifecycle} />
            <StatusBadge value={company.billing_state} />
            <StatusBadge value={company.hosting_state} />
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Credit balance" value={data.creditBalance ?? 0} />
        <MetricCard label="Tasks" value={counts?.tasks ?? 0} />
        <MetricCard label="Documents" value={counts?.documents ?? 0} />
        <MetricCard label="Reports" value={counts?.reports ?? 0} />
        <MetricCard label="Emails" value={counts?.emailThreads ?? 0} />
        <MetricCard label="Chats" value={counts?.chatSessions ?? 0} />
        <MetricCard label="Ads" value={counts?.adCampaigns ?? 0} />
        <MetricCard label="Runs" value={counts?.runs ?? 0} />
      </div>

      <section className="rounded-md border border-[#dedbd2] bg-white">
        <div className="border-b border-[#dedbd2] px-4 py-3">
          <h3 className="font-medium">Company Profile</h3>
        </div>
        <dl className="grid sm:grid-cols-2 lg:grid-cols-3">
          <DetailRow label="Owner" value={formatOwner(company.owner_name, company.owner_email)} />
          <DetailRow label="Slug" value={company.slug} />
          <DetailRow label="Plan" value={company.plan_tier} />
          <DetailRow label="Onboarding" value={company.onboarding_status} />
          <DetailRow label="Subdomain" value={company.subdomain} />
          <DetailRow label="Custom domain" value={company.custom_domain} />
          <DetailRow label="Company email" value={company.company_email} />
          <DetailRow label="GitHub repo" value={company.github_repo} />
          <DetailRow label="Render service" value={company.render_service_id} />
          <DetailRow label="Neon database" value={company.neon_database_id} />
          <DetailRow label="Claim status" value={company.claim_status} />
          <DetailRow label="Timezone" value={company.timezone} />
        </dl>
        <p className="border-t border-[#dedbd2] px-4 py-3 text-xs text-[#666]">
          Connection strings and secrets are intentionally hidden from this read-only admin view.
        </p>
      </section>

      {subscription ? (
        <section className="rounded-md border border-[#dedbd2] bg-white">
          <div className="border-b border-[#dedbd2] px-4 py-3">
            <h3 className="font-medium">Subscription</h3>
          </div>
          <dl className="grid sm:grid-cols-2 lg:grid-cols-3">
            <DetailRow label="Plan type" value={subscription.plan_type} />
            <DetailRow label="Status" value={subscription.status} />
            <DetailRow
              label="Night shifts"
              value={`${subscription.night_shifts_remaining ?? 0} / ${subscription.night_shifts_total ?? 0}`}
            />
            <DetailRow
              label="Current period"
              value={`${formatDate(subscription.current_period_start)} to ${formatDate(subscription.current_period_end)}`}
            />
            <DetailRow label="Trial ends" value={formatDate(subscription.trial_ends_at)} />
            <DetailRow label="Created" value={formatDate(subscription.created_at)} />
          </dl>
        </section>
      ) : null}

      <section className="rounded-md border border-[#dedbd2] bg-white">
        <div className="border-b border-[#dedbd2] px-4 py-3">
          <h3 className="font-medium">Recent Tasks</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
              <tr>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Tag</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {recentTasks.length > 0 ? (
                recentTasks.map((task) => (
                  <tr key={task.id} className="border-t border-[#eee]">
                    <td className="px-4 py-3 font-medium">{task.title}</td>
                    <td className="px-4 py-3">
                      <StatusBadge value={task.status} />
                    </td>
                    <td className="px-4 py-3">{formatValue(task.tag)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#555]">{formatDate(task.created_at)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-[#666]">
                    No recent tasks found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-[#dedbd2] bg-white">
        <div className="border-b border-[#dedbd2] px-4 py-3">
          <h3 className="font-medium">Recent Events</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
              <tr>
                <th className="px-4 py-2 font-medium">Event type</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.length > 0 ? (
                recentEvents.map((event) => (
                  <tr key={event.id} className="border-t border-[#eee]">
                    <td className="px-4 py-3 font-medium">{event.event_type}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#555]">{formatDate(event.created_at)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center text-sm text-[#666]">
                    No recent events found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-[#dedbd2] bg-white">
        <div className="border-b border-[#dedbd2] px-4 py-3">
          <h3 className="font-medium">Recent Reports</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
              <tr>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Report type</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {recentReports.length > 0 ? (
                recentReports.map((report) => (
                  <tr key={report.id} className="border-t border-[#eee]">
                    <td className="px-4 py-3 font-medium">{formatValue(report.title)}</td>
                    <td className="px-4 py-3">{formatValue(report.report_type)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#555]">{formatDate(report.created_at)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-sm text-[#666]">
                    No recent reports found.
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
