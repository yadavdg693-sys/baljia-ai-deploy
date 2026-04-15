// SSE Event Stream — migrated to Drizzle + Neon
import { db, platformEvents, companies, tasks, emailThreads } from '@/lib/db';
import { eq, gt, gte, and, inArray, desc, sql } from 'drizzle-orm';
import type { EventType } from '@/types';

export interface LiveEvent {
  id: string;
  type: EventType;
  company_id: string;
  company_name?: string;
  payload: Record<string, unknown>;
  is_public_safe: boolean;
  created_at: string;
}

export async function getRecentEvents(options: {
  companyId?: string;
  publicOnly?: boolean;
  since?: string;
  limit?: number;
}): Promise<LiveEvent[]> {
  const limit = Math.min(options.limit ?? 50, 100);
  const conditions = [];

  if (options.companyId) conditions.push(eq(platformEvents.company_id, options.companyId));
  if (options.publicOnly) conditions.push(eq(platformEvents.is_public_safe, true));
  if (options.since) conditions.push(gt(platformEvents.created_at, new Date(options.since)));

  const query = db.select().from(platformEvents)
    .orderBy(desc(platformEvents.created_at))
    .limit(limit);

  const data = conditions.length > 0
    ? await query.where(and(...conditions))
    : await query;

  return data.map((event) => ({
    id: event.id,
    type: event.event_type as EventType,
    company_id: event.company_id ?? '',
    payload: options.publicOnly ? {} : (event.payload as Record<string, unknown> ?? {}),
    is_public_safe: event.is_public_safe ?? false,
    created_at: event.created_at instanceof Date ? event.created_at.toISOString() : String(event.created_at),
  }));
}

export interface LiveWallMetrics {
  active_companies: number;
  tasks_today: number;
  tasks_running: number;
  messages_today: number;
  emails_today: number;
  annual_run_rate: string;
}

export async function getLiveWallMetrics(): Promise<LiveWallMetrics> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [companiesRow, tasksTodayRow, tasksRunningRow, messagesTodayRow, emailsTodayRow] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(companies)
      .where(inArray(companies.lifecycle, ['trial_active', 'full_active'])),
    db.select({ count: sql<number>`count(*)` }).from(tasks)
      .where(gte(tasks.created_at, today)),
    db.select({ count: sql<number>`count(*)` }).from(tasks)
      .where(eq(tasks.status, 'in_progress')),
    db.select({ count: sql<number>`count(*)` }).from(platformEvents)
      .where(and(eq(platformEvents.event_type, 'chat_message'), gte(platformEvents.created_at, today))),
    db.select({ count: sql<number>`count(*)` }).from(emailThreads)
      .where(gte(emailThreads.created_at, today)),
  ]);

  const activeCount = companiesRow[0]?.count ?? 0;
  const arr = activeCount * 49 * 12;

  return {
    active_companies: activeCount,
    tasks_today: tasksTodayRow[0]?.count ?? 0,
    tasks_running: tasksRunningRow[0]?.count ?? 0,
    messages_today: messagesTodayRow[0]?.count ?? 0,
    emails_today: emailsTodayRow[0]?.count ?? 0,
    annual_run_rate: arr >= 1000 ? `$${(arr / 1000).toFixed(1)}k` : `$${arr}`,
  };
}

export interface LiveTaskCard {
  id: string;
  title: string;
  agent_name: string;
  company_name: string;
  started_at: string;
  running_seconds: number;
  tag: string;
}

export async function getRunningTasks(publicOnly = false): Promise<LiveTaskCard[]> {
  if (publicOnly) return []; // Completely hide runningTasks for public endpoint

  // Join tasks with companies for company name
  const data = await db.select({
    id: tasks.id,
    title: tasks.title,
    tag: tasks.tag,
    started_at: tasks.started_at,
    assigned_to_agent_id: tasks.assigned_to_agent_id,
    company_name: companies.name,
  })
  .from(tasks)
  .innerJoin(companies, eq(tasks.company_id, companies.id))
  .where(eq(tasks.status, 'in_progress'))
  .orderBy(desc(tasks.started_at))
  .limit(10);

  const { getAgentName } = await import('@/lib/services/router.service');
  const now = Date.now();

  return data.map((t) => {
    // B2 FIX: Handle started_at as Date or string safely
    const startedAt = t.started_at instanceof Date ? t.started_at : t.started_at ? new Date(t.started_at) : null;
    return {
      id: t.id,
      title: t.title,
      agent_name: getAgentName(t.assigned_to_agent_id ?? 0),
      company_name: t.company_name ?? 'Unknown',
      started_at: startedAt?.toISOString() ?? new Date().toISOString(),
      running_seconds: Math.round((now - (startedAt?.getTime() ?? now)) / 1000),
      tag: t.tag,
    };
  });
}
