import Link from 'next/link';
import { MetricCard } from '@/components/super-admin/MetricCard';
import { StatusBadge } from '@/components/super-admin/StatusBadge';
import { getSuperAdminBasePath, requireSuperAdminPage } from '@/lib/super-admin';
import { getSuperAdminOperations } from '@/lib/services/super-admin.service';

type Props = {
  params: Promise<{ accessKey: string }>;
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

export default async function SuperAdminOperationsPage({ params }: Props) {
  const { accessKey } = await params;
  const actor = await requireSuperAdminPage(accessKey);
  const data = await getSuperAdminOperations(actor);
  const basePath = getSuperAdminBasePath(accessKey);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Operations</h2>
          <p className="text-sm text-[#666]">Read-only view of tasks, runs, agent activity, and recent platform events.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${basePath}/companies?taskHealth=failed`} className="text-sm font-medium text-[#2454a6] hover:text-[#173a73]">
            Failed companies
          </Link>
          <Link href={`${basePath}/companies?taskHealth=stuck`} className="text-sm font-medium text-[#2454a6] hover:text-[#173a73]">
            Stuck companies
          </Link>
        </div>
      </div>

      <div className="rounded-md border border-[#dedbd2] bg-white px-4 py-3 text-sm text-[#555]">
        This page is intentionally read-only. Retry, pause, cancel, and repair controls belong behind reason prompts and stronger authorization later.
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Queued tasks" value={data.taskStats?.queuedTasks ?? 0} />
        <MetricCard label="Running tasks" value={data.taskStats?.runningTasks ?? 0} />
        <MetricCard label="Stuck tasks" value={data.taskStats?.stuckTasks ?? 0} />
        <MetricCard label="Failed tasks" value={data.taskStats?.failedTasks ?? 0} />
        <MetricCard label="Completed 24h" value={data.taskStats?.completed24h ?? 0} />
        <MetricCard label="Running runs" value={data.runStats?.runningRuns ?? 0} />
        <MetricCard label="Failed runs" value={data.runStats?.failedRuns ?? 0} />
        <MetricCard label="Completed runs 24h" value={data.runStats?.completedRuns24h ?? 0} />
        <MetricCard label="Events 24h" value={data.eventStats?.events24h ?? 0} />
        <MetricCard label="Private events 7d" value={data.eventStats?.privateEvents7d ?? 0} />
      </div>

      <section className="rounded-md border border-[#dedbd2] bg-white">
        <div className="border-b border-[#dedbd2] px-4 py-3">
          <h3 className="font-medium">Recent Failed Tasks</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
              <tr>
                <th className="px-4 py-2 font-medium">Task</th>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Failure</th>
                <th className="px-4 py-2 font-medium">Credits</th>
                <th className="px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.recentFailedTasks.length > 0 ? (
                data.recentFailedTasks.map((task) => (
                  <tr key={task.id} className="border-t border-[#eee]">
                    <td className="px-4 py-3 font-medium">{task.title}</td>
                    <td className="px-4 py-3">
                      <Link href={`${basePath}/companies/${task.company_id}`} className="font-medium text-[#2454a6] hover:text-[#173a73]">
                        {task.company_name}
                      </Link>
                      <div className="text-xs text-[#777]">{task.owner_email ?? 'unclaimed'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={task.status} />
                    </td>
                    <td className="px-4 py-3">{formatValue(task.failure_class)}</td>
                    <td className="px-4 py-3 tabular-nums">{task.actual_credits_charged ?? 0}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#555]">{formatDate(task.updated_at)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-[#666]">
                    No failed tasks found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-[#dedbd2] bg-white">
        <div className="border-b border-[#dedbd2] px-4 py-3">
          <h3 className="font-medium">Stuck Running Tasks</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
              <tr>
                <th className="px-4 py-2 font-medium">Task</th>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Attempts</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Lease expires</th>
              </tr>
            </thead>
            <tbody>
              {data.stuckTasks.length > 0 ? (
                data.stuckTasks.map((task) => (
                  <tr key={task.id} className="border-t border-[#eee]">
                    <td className="px-4 py-3 font-medium">{task.title}</td>
                    <td className="px-4 py-3">
                      <Link href={`${basePath}/companies/${task.company_id}`} className="font-medium text-[#2454a6] hover:text-[#173a73]">
                        {task.company_name}
                      </Link>
                      <div className="text-xs text-[#777]">{task.owner_email ?? 'unclaimed'}</div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{task.attempt_count ?? 0}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#555]">{formatDate(task.started_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#555]">{formatDate(task.lease_expires_at)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-[#666]">
                    No stuck running tasks found.
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
            <h3 className="font-medium">Recent Runs</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
                <tr>
                  <th className="px-4 py-2 font-medium">Run</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Agent</th>
                  <th className="px-4 py-2 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRuns.length > 0 ? (
                  data.recentRuns.map((run) => (
                    <tr key={run.id} className="border-t border-[#eee]">
                      <td className="px-4 py-3">
                        <div className="font-medium">{run.task_title}</div>
                        <div className="text-xs text-[#777]">{run.company_name}</div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge value={run.status} />
                      </td>
                      <td className="px-4 py-3">{run.agent_name ?? formatValue(run.execution_mode)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#555]">{formatDate(run.started_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-[#666]">
                      No recent runs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-md border border-[#dedbd2] bg-white">
          <div className="border-b border-[#dedbd2] px-4 py-3">
            <h3 className="font-medium">Recent Platform Events</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
                <tr>
                  <th className="px-4 py-2 font-medium">Event</th>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.recentPlatformEvents.length > 0 ? (
                  data.recentPlatformEvents.map((event) => (
                    <tr key={event.id} className="border-t border-[#eee]">
                      <td className="px-4 py-3">
                        <div className="font-medium">{event.event_type}</div>
                        <div className="text-xs text-[#777]">{event.is_public_safe ? 'public-safe' : 'private'}</div>
                      </td>
                      <td className="px-4 py-3">{event.company_name ?? 'platform'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#555]">{formatDate(event.created_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-sm text-[#666]">
                      No recent events found.
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
