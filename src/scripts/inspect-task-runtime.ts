// What's actually running tasks? Where do completions come from?
// Shows: in-flight tasks, completions in last 24h, exec wall-clock distribution.
// Run: npx tsx --env-file=.env.local src/scripts/inspect-task-runtime.ts

import { db, tasks, taskExecutions } from '@/lib/db';
import { and, gte, sql, desc, eq } from 'drizzle-orm';

async function main() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // 1. In-flight RIGHT NOW
  const running = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      started_at: tasks.started_at,
      turn_count: tasks.turn_count,
      max_turns: tasks.max_turns,
    })
    .from(tasks)
    .where(eq(tasks.status, 'in_progress'))
    .orderBy(desc(tasks.started_at))
    .limit(20);

  console.log(`── In-flight (status=in_progress) — ${running.length} task(s) ──`);
  for (const t of running) {
    const startedMs = t.started_at instanceof Date ? t.started_at.getTime() : t.started_at ? new Date(String(t.started_at)).getTime() : 0;
    const ageSec = startedMs ? Math.floor((Date.now() - startedMs) / 1000) : 0;
    console.log(`  ${ageSec.toString().padStart(5)}s  turn ${t.turn_count}/${t.max_turns}  ${t.title?.slice(0, 70) ?? ''}`);
  }

  // 2. Completions in last 24h, with wall-clock distribution
  const completed = await db
    .select({
      id: taskExecutions.id,
      task_id: taskExecutions.task_id,
      status: taskExecutions.status,
      started_at: taskExecutions.started_at,
      completed_at: taskExecutions.completed_at,
      wall_clock_seconds: taskExecutions.wall_clock_seconds,
      turn_count: taskExecutions.turn_count,
    })
    .from(taskExecutions)
    .where(and(
      gte(taskExecutions.completed_at, dayAgo),
    ))
    .orderBy(desc(taskExecutions.completed_at))
    .limit(50);

  console.log(`\n── Completions in last 24h — ${completed.length} execution(s) ──`);
  const buckets = { '<10s': 0, '10-30s': 0, '30-60s': 0, '60-300s': 0, '300-1800s': 0, '>1800s': 0 };
  for (const e of completed) {
    const w = e.wall_clock_seconds ?? 0;
    if (w < 10) buckets['<10s']++;
    else if (w < 30) buckets['10-30s']++;
    else if (w < 60) buckets['30-60s']++;
    else if (w < 300) buckets['60-300s']++;
    else if (w < 1800) buckets['300-1800s']++;
    else buckets['>1800s']++;
  }
  for (const [b, n] of Object.entries(buckets)) {
    console.log(`  ${b.padEnd(12)} ${n.toString().padStart(3)}  ${'█'.repeat(n)}`);
  }

  console.log(`\n  → ${buckets['30-60s'] + buckets['60-300s'] + buckets['300-1800s'] + buckets['>1800s']} of ${completed.length} ran > 30s (would be killed on CF Workers)`);

  // 3. Recent 10 completions with detail
  console.log(`\n── Last 10 completions (most recent first) ──`);
  for (const e of completed.slice(0, 10)) {
    const completed_iso = e.completed_at instanceof Date ? e.completed_at.toISOString() : String(e.completed_at);
    console.log(`  ${completed_iso}  status=${e.status?.padEnd(10) ?? '?'}  ${(e.wall_clock_seconds ?? 0).toString().padStart(5)}s  turns=${e.turn_count}`);
  }

  // 4. Completions in last hour — these are what's running RIGHT NOW
  const recent = completed.filter(e => {
    const c = e.completed_at instanceof Date ? e.completed_at : (e.completed_at ? new Date(String(e.completed_at)) : null);
    return c && c >= hourAgo;
  });
  console.log(`\n── Completions in last 1h: ${recent.length}`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
