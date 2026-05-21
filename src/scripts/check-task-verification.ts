// Show exactly what tool calls the engineering agent made and what the
// deterministic verifier checked.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, tasks, taskExecutions, runs, artifacts } from '@/lib/db';
import { eq, like, and, desc } from 'drizzle-orm';

void (async () => {
  const [t] = await db.select().from(tasks).where(like(tasks.title, 'REDSHIP-CLONE: Build%')).limit(1);
  if (!t) throw new Error('task not found');
  console.log(`Task: ${t.id} status=${t.status} verified-passed=${t.failure_class === null} fail=${t.failure_class}`);
  console.log(`verification_level=${t.verification_level}, turn_count=${t.turn_count}`);
  console.log();

  const execs = await db.select().from(taskExecutions).where(eq(taskExecutions.task_id, t.id)).orderBy(desc(taskExecutions.created_at)).limit(2);
  console.log(`task_executions (most recent ${execs.length}):`);
  for (const e of execs) {
    console.log(`  exec ${e.id.slice(0,8)} status=${e.status} verified=${e.verified} created=${e.created_at?.toISOString?.()}`);
  }

  // Get the most recent run + its tool calls
  const [r] = await db.select().from(runs).where(eq(runs.task_id, t.id)).orderBy(desc(runs.created_at)).limit(1);
  if (r) {
    console.log(`\nrun ${r.id.slice(0,8)} status=${r.status} turns=${r.turn_count}`);
    // tool_calls is jsonb on runs
    const tc = (r as unknown as { tool_calls?: Array<{ tool: string; success?: boolean; output?: string; input?: unknown }> }).tool_calls;
    if (Array.isArray(tc)) {
      console.log(`\nTool calls (${tc.length}):`);
      for (const c of tc) {
        const tool = c.tool ?? '?';
        const success = c.success === true ? '✓' : c.success === false ? '✗' : '?';
        const inp = c.input ? JSON.stringify(c.input).slice(0, 80) : '';
        console.log(`  ${success} ${tool.padEnd(28)} ${inp}`);
      }
      const deployCalls = tc.filter(c => ['render_create_service','render_deploy','github_push_files'].includes(c.tool));
      const healthCalls = tc.filter(c => c.tool === 'check_url_health');
      console.log(`\nDeploy calls:  ${deployCalls.length}  (${[...new Set(deployCalls.map(c => c.tool))].join(', ')})`);
      console.log(`Health calls:  ${healthCalls.length}`);
    } else {
      console.log('  (no tool_calls field on run row)');
      console.log('  available keys:', Object.keys(r));
    }
  }

  const arts = await db.select().from(artifacts).where(eq(artifacts.task_id, t.id));
  console.log(`\nArtifacts: ${arts.length}`);
  for (const a of arts) console.log(`  - ${a.artifact_type}: ${a.title?.slice(0,80) ?? '-'}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
