import Link from 'next/link';
import { getSuperAdminBasePath, requireSuperAdminPage } from '@/lib/super-admin';
import { getSuperAdminAuditLog } from '@/lib/services/super-admin.service';

type Props = {
  params: Promise<{ accessKey: string }>;
  searchParams: Promise<{ action?: string | string[] }>;
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

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatTarget(type: string | null, id: string | null): string {
  if (!type && !id) return '-';
  if (!id) return type ?? '-';
  return `${type ?? 'target'}:${id}`;
}

export default async function SuperAdminAuditPage({ params, searchParams }: Props) {
  const { accessKey } = await params;
  const rawFilters = await searchParams;
  const actor = await requireSuperAdminPage(accessKey);
  const basePath = getSuperAdminBasePath(accessKey);
  const action = firstParam(rawFilters.action)?.trim() || undefined;
  const events = await getSuperAdminAuditLog(actor, { action, limit: 100 });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Audit Log</h2>
        <p className="text-sm text-[#666]">Every owner dashboard read is recorded before data is served.</p>
      </div>

      <form method="get" className="flex flex-wrap gap-3 rounded-md border border-[#dedbd2] bg-white p-4">
        <input
          name="action"
          defaultValue={action ?? ''}
          placeholder="Filter by action, e.g. view_company_detail"
          className="w-full min-w-0 rounded border border-[#ccc] px-3 py-2 text-sm sm:w-auto sm:min-w-80"
        />
        <button className="w-full rounded bg-[#171717] px-4 py-2 text-sm font-medium text-white sm:w-auto" type="submit">
          Filter
        </button>
        <Link
          href={`${basePath}/audit`}
          className="inline-flex w-full items-center justify-center rounded border border-[#ccc] px-4 py-2 text-sm font-medium text-[#333] sm:w-auto"
        >
          Clear
        </Link>
      </form>

      <section className="rounded-md border border-[#dedbd2] bg-white">
        <div className="border-b border-[#dedbd2] px-4 py-3">
          <h3 className="font-medium">Recent Admin Events</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
              <tr>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Admin</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {events.length > 0 ? (
                events.map((event) => (
                  <tr key={event.id} className="border-t border-[#eee]">
                    <td className="whitespace-nowrap px-4 py-3 text-[#555]">{formatDate(event.created_at)}</td>
                    <td className="px-4 py-3">{event.admin_email}</td>
                    <td className="px-4 py-3 font-medium">{event.action}</td>
                    <td className="px-4 py-3 break-all text-[#555]">{formatTarget(event.target_type, event.target_id)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-[#666]">
                    No audit events found.
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
