import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

(async () => {
  // Last 5 engineering tasks across all companies
  const recent = await db.execute(sql`
    SELECT id, company_id, status, title,
      EXTRACT(EPOCH FROM (NOW() - created_at))::int AS age_secs
    FROM tasks
    WHERE tag = 'engineering'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log('=== Recent engineering tasks ===');
  for (const r of ((recent as any).rows ?? recent) as any[]) {
    console.log(`  ${r.id.slice(0, 8)} [${r.status}] (${r.age_secs}s ago) ${r.title.slice(0, 80)}`);
  }

  // Most recent task_execution
  const exec = await db.execute(sql`
    SELECT te.id, te.task_id, te.status, te.turn_count, te.max_turns,
      EXTRACT(EPOCH FROM (NOW() - te.started_at))::int AS run_secs,
      t.title, t.tag
    FROM task_executions te
    JOIN tasks t ON t.id = te.task_id
    WHERE t.tag = 'engineering'
    ORDER BY te.started_at DESC
    LIMIT 1
  `);
  const e = ((exec as any).rows ?? exec)[0];
  if (e) {
    console.log(`\n=== Last engineering execution ===`);
    console.log(`  task: ${e.task_id.slice(0, 8)} "${e.title.slice(0, 80)}"`);
    console.log(`  status: ${e.status}, turns: ${e.turn_count}/${e.max_turns}, run_secs: ${e.run_secs}`);
  } else {
    console.log('\nNo engineering executions in DB.');
  }
})();
