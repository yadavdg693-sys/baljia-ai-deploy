// Full task management view — destination of "Manage →" link in DashboardShell.tsx.
// Server component: auth + ownership check + data fetch.
// Hands the grouped tasks to a client component that owns tab state.

import { getSessionFromCookies } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db, companies, tasks, recurringTasks } from '@/lib/db';
import { eq, and, asc, desc } from 'drizzle-orm';
import type { Task } from '@/types';
import { TaskManagementBoard } from '@/components/dashboard/TaskManagementBoard';

interface Props {
  params: Promise<{ companyId: string }>;
}

export default async function CompanyTasksPage({ params }: Props) {
  const { companyId } = await params;
  const user = await getSessionFromCookies();
  if (!user) redirect('/login');

  // Ownership-checked single-row fetch — same pattern as the dashboard root page.
  // Bouncing to /portfolio (not /onboarding) is intentional: the user already
  // exists; we just don't want them on a company that isn't theirs.
  const [company] = await db
    .select({
      id: companies.id,
      owner_id: companies.owner_id,
      name: companies.name,
      slug: companies.slug,
    })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.owner_id, user.id)))
    .limit(1);

  if (!company) redirect('/portfolio');

  // Tasks: same ordering as the main dashboard fetch (queue first, then recency)
  // so a founder visiting both pages sees a stable order.
  // Recurring: a separate table — these are templates, not status-bucketed tasks.
  const [taskList, recurringList] = await Promise.all([
    db.select()
      .from(tasks)
      .where(eq(tasks.company_id, companyId))
      .orderBy(asc(tasks.queue_order), desc(tasks.created_at)),
    db.select()
      .from(recurringTasks)
      .where(eq(recurringTasks.company_id, companyId))
      .orderBy(desc(recurringTasks.created_at)),
  ]);

  return (
    <TaskManagementBoard
      companyId={company.id}
      companyName={company.name}
      tasks={taskList as unknown as Task[]}
      recurring={recurringList.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        tag: r.tag,
        cadence: r.cadence,
        priority: r.priority ?? 0,
        is_active: r.is_active ?? true,
        next_run_at: r.next_run_at ? r.next_run_at.toISOString() : null,
        last_run_at: r.last_run_at ? r.last_run_at.toISOString() : null,
        monthly_credits_estimate: r.monthly_credits_estimate ?? null,
        created_at: r.created_at ? r.created_at.toISOString() : new Date().toISOString(),
      }))}
    />
  );
}
