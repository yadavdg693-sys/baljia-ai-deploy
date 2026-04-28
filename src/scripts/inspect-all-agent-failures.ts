// What's actually broken across all 8 worker agents?
// Pull the most recent failed/incomplete tasks for each agent_id and surface
// patterns. The dispatcher bug we fixed for engineering might affect others.
// Run: npx tsx --env-file=.env.local src/scripts/inspect-all-agent-failures.ts

import { db, tasks, taskExecutions } from '@/lib/db';
import { eq, desc, and, gte, sql, inArray } from 'drizzle-orm';

const AGENTS = [
  { id: 29, name: 'Research' },
  { id: 30, name: 'Engineering' },
  { id: 32, name: 'Support' },
  { id: 33, name: 'Data' },
  { id: 40, name: 'Twitter' },
  { id: 41, name: 'MetaAds' },
  { id: 42, name: 'Browser' },
  { id: 54, name: 'ColdOutreach' },
];

async function main() {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  for (const agent of AGENTS) {
    const [stats] = await db.select({
      total: sql<number>`COUNT(*)::int`,
      completed: sql<number>`SUM(CASE WHEN ${tasks.status} = 'completed' THEN 1 ELSE 0 END)::int`,
      failed: sql<number>`SUM(CASE WHEN ${tasks.status} IN ('failed', 'failed_permanent') THEN 1 ELSE 0 END)::int`,
      todo: sql<number>`SUM(CASE WHEN ${tasks.status} = 'todo' THEN 1 ELSE 0 END)::int`,
      in_progress: sql<number>`SUM(CASE WHEN ${tasks.status} = 'in_progress' THEN 1 ELSE 0 END)::int`,
    }).from(tasks).where(and(
      eq(tasks.assigned_to_agent_id, agent.id),
      gte(tasks.created_at, since),
    ));

    console.log(`── ${agent.name} (id=${agent.id}) — last 14 days ──`);
    console.log(`  total=${stats?.total ?? 0}  completed=${stats?.completed ?? 0}  failed=${stats?.failed ?? 0}  todo=${stats?.todo ?? 0}  in_progress=${stats?.in_progress ?? 0}`);

    // Most recent failed task — show its tools
    const [recentFail] = await db.select({
      id: tasks.id, title: tasks.title, tag: tasks.tag, created_at: tasks.created_at,
      failure_class: tasks.failure_class, turn_count: tasks.turn_count, status: tasks.status,
    })
      .from(tasks)
      .where(and(
        eq(tasks.assigned_to_agent_id, agent.id),
        inArray(tasks.status, ['failed', 'failed_permanent']),
      ))
      .orderBy(desc(tasks.created_at))
      .limit(1);

    if (recentFail) {
      console.log(`  recent failure: "${recentFail.title?.slice(0, 50)}" (status=${recentFail.status}, turns=${recentFail.turn_count}, fc=${recentFail.failure_class})`);

      const [exec] = await db.select({ execution_log: taskExecutions.execution_log, error_summary: taskExecutions.error_summary })
        .from(taskExecutions)
        .where(eq(taskExecutions.task_id, recentFail.id))
        .orderBy(desc(taskExecutions.created_at)).limit(1);

      if (exec) {
        let log: Array<{ tool?: string; result?: string }> = [];
        if (typeof exec.execution_log === 'string') { try { log = JSON.parse(exec.execution_log); } catch {} }
        else if (Array.isArray(exec.execution_log)) log = exec.execution_log as typeof log;
        const tools = log.map((e) => e.tool ?? '').filter(Boolean);
        const unknownToolCalls = log.filter((e) =>
          typeof e.result === 'string' && e.result.includes('Unknown tool')
        ).map((e) => e.tool);
        console.log(`    tools called: ${[...new Set(tools)].join(', ') || '(none)'}`);
        if (unknownToolCalls.length > 0) {
          console.log(`    🚨 UNKNOWN-TOOL ERRORS: ${[...new Set(unknownToolCalls)].join(', ')}`);
        }
        if (exec.error_summary) console.log(`    error_summary: ${exec.error_summary.slice(0, 150)}`);
      }
    }
    console.log();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
