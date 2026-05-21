import Link from 'next/link';
import { CompanyTable } from '@/components/super-admin/CompanyTable';
import {
  getSuperAdminBasePath,
  normalizeSuperAdminCompanyFilters,
  requireSuperAdminPage,
} from '@/lib/super-admin';
import { getSuperAdminCompanies } from '@/lib/services/super-admin.service';

type Props = {
  params: Promise<{ accessKey: string }>;
  searchParams: Promise<{
    q?: string | string[];
    lifecycle?: string | string[];
    billingState?: string | string[];
    taskHealth?: string | string[];
    activity?: string | string[];
  }>;
};

const lifecycleOptions = [
  { value: '', label: 'All lifecycles' },
  { value: 'trial_active', label: 'Trial active' },
  { value: 'full_active', label: 'Full active' },
  { value: 'keep_live_active', label: 'Keep live active' },
  { value: 'archived', label: 'Archived' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
];

const billingOptions = [
  { value: '', label: 'All billing' },
  { value: 'free', label: 'Free' },
  { value: 'trial', label: 'Trial' },
  { value: 'active', label: 'Active' },
  { value: 'paid', label: 'Paid' },
  { value: 'past_due', label: 'Past due' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'suspended_billing', label: 'Suspended billing' },
];

const taskHealthOptions = [
  { value: '', label: 'All task health' },
  { value: 'failed', label: 'Has failed tasks' },
  { value: 'running', label: 'Has running tasks' },
  { value: 'stuck', label: 'Has stuck tasks' },
  { value: 'no_tasks', label: 'No tasks' },
];

const activityOptions = [
  { value: '', label: 'All activity' },
  { value: 'last_24h', label: 'Active last 24h' },
  { value: 'last_7d', label: 'Active last 7d' },
  { value: 'quiet_7d', label: 'Quiet 7d' },
];

export default async function SuperAdminCompaniesPage({ params, searchParams }: Props) {
  const { accessKey } = await params;
  const rawFilters = await searchParams;
  const user = await requireSuperAdminPage(accessKey);
  const basePath = getSuperAdminBasePath(accessKey);
  const filters = normalizeSuperAdminCompanyFilters({ ...rawFilters, limit: 100 });
  const rows = await getSuperAdminCompanies(user, filters);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Companies</h2>
        <p className="text-sm text-[#666]">Search and inspect every Baljia company.</p>
      </div>

      <form method="get" className="flex flex-wrap gap-3 rounded-md border border-[#dedbd2] bg-white p-4">
        <input
          name="q"
          defaultValue={filters.q ?? ''}
          placeholder="Search company, slug, owner email"
          className="w-full min-w-0 rounded border border-[#ccc] px-3 py-2 text-sm sm:w-auto sm:min-w-72"
        />
        <select
          name="lifecycle"
          defaultValue={filters.lifecycle ?? ''}
          className="min-w-0 flex-1 rounded border border-[#ccc] px-3 py-2 text-sm sm:flex-none"
        >
          {lifecycleOptions.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          name="billingState"
          defaultValue={filters.billingState ?? ''}
          className="min-w-0 flex-1 rounded border border-[#ccc] px-3 py-2 text-sm sm:flex-none"
        >
          {billingOptions.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          name="taskHealth"
          defaultValue={filters.taskHealth ?? ''}
          className="min-w-0 flex-1 rounded border border-[#ccc] px-3 py-2 text-sm sm:flex-none"
        >
          {taskHealthOptions.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          name="activity"
          defaultValue={filters.activity ?? ''}
          className="min-w-0 flex-1 rounded border border-[#ccc] px-3 py-2 text-sm sm:flex-none"
        >
          {activityOptions.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button className="w-full rounded bg-[#171717] px-4 py-2 text-sm font-medium text-white sm:w-auto" type="submit">
          Filter
        </button>
        <Link
          href={`${basePath}/companies`}
          className="inline-flex w-full items-center justify-center rounded border border-[#ccc] px-4 py-2 text-sm font-medium text-[#333] sm:w-auto"
        >
          Clear
        </Link>
      </form>

      <CompanyTable rows={rows} basePath={basePath} />
    </div>
  );
}
