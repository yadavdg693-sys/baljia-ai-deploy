import Link from 'next/link';
import { StatusBadge } from './StatusBadge';

type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  owner_email: string | null;
  lifecycle: string | null;
  execution_state: string | null;
  billing_state: string | null;
  hosting_state: string | null;
  onboarding_status: string | null;
  plan_tier: string | null;
  task_count: number;
  failed_task_count: number;
  running_task_count: number;
  credit_balance: number;
  last_task_at: Date | null;
  last_event_at: Date | null;
};

type Props = {
  rows: CompanyRow[];
  basePath: string;
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

export function CompanyTable({ rows, basePath }: Props) {
  return (
    <div className="overflow-x-auto rounded-md border border-[#dedbd2] bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
          <tr>
            <th className="px-4 py-2 font-medium">Company</th>
            <th className="px-4 py-2 font-medium">Owner</th>
            <th className="px-4 py-2 font-medium">Plan</th>
            <th className="px-4 py-2 font-medium">Lifecycle</th>
            <th className="px-4 py-2 font-medium">Ops</th>
            <th className="px-4 py-2 font-medium">Billing</th>
            <th className="px-4 py-2 font-medium">Tasks</th>
            <th className="px-4 py-2 font-medium">Credits</th>
            <th className="px-4 py-2 font-medium">Last event</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <tr key={row.id} className="border-t border-[#eee]">
                <td className="px-4 py-3">
                  <Link
                    href={`${basePath}/companies/${row.id}`}
                    className="font-medium text-[#2454a6] hover:text-[#173a73]"
                  >
                    {row.name}
                  </Link>
                  <div className="text-xs text-[#777]">{row.slug}</div>
                </td>
                <td className="px-4 py-3">{row.owner_email ?? 'unclaimed'}</td>
                <td className="px-4 py-3">{row.plan_tier ?? 'free'}</td>
                <td className="px-4 py-3">
                  <StatusBadge value={row.lifecycle} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex min-w-36 flex-wrap gap-1">
                    <StatusBadge value={row.execution_state} />
                    <StatusBadge value={row.hosting_state} />
                    <StatusBadge value={row.onboarding_status} />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge value={row.billing_state} />
                </td>
                <td className="px-4 py-3">
                  <div className="tabular-nums">{row.task_count}</div>
                  <div className="mt-1 flex flex-wrap gap-1 text-xs text-[#666]">
                    {row.failed_task_count > 0 ? (
                      <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-red-800">
                        {row.failed_task_count} failed
                      </span>
                    ) : null}
                    {row.running_task_count > 0 ? (
                      <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-800">
                        {row.running_task_count} running
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3 tabular-nums">{row.credit_balance}</td>
                <td className="whitespace-nowrap px-4 py-3 text-[#555]">
                  <div>{formatDate(row.last_event_at)}</div>
                  <div className="text-xs text-[#777]">Task {formatDate(row.last_task_at)}</div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={9} className="px-4 py-6 text-center text-sm text-[#666]">
                No companies found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
