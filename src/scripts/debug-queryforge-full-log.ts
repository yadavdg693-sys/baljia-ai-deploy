// Pull the FULL execution_log for the campaign task — what tools did the
// agent actually call over 20 turns?
// Run: npx tsx --env-file=.env.local src/scripts/debug-queryforge-full-log.ts

import { db, taskExecutions } from '@/lib/db';
import { eq } from 'drizzle-orm';

const CAMPAIGN_TASK_ID = '9a36e013-6527-4c8d-84a4-8162a063cd26';

async function main() {
  const [exec] = await db
    .select()
    .from(taskExecutions)
    .where(eq(taskExecutions.task_id, CAMPAIGN_TASK_ID))
    .limit(1);

  if (!exec) { console.log('no execution found'); process.exit(1); }

  let log: Array<{ tool: string; turn: number; input?: unknown; result?: string }> = [];
  if (exec.execution_log) {
    if (typeof exec.execution_log === 'string') {
      try { log = JSON.parse(exec.execution_log); } catch { /* */ }
    } else {
      log = exec.execution_log as typeof log;
    }
  }

  console.log(`═══ Full execution log: ${log.length} tool calls over 20 turns ═══\n`);

  // Group by turn
  const byTurn: Record<number, typeof log> = {};
  for (const entry of log) {
    if (!byTurn[entry.turn]) byTurn[entry.turn] = [];
    byTurn[entry.turn].push(entry);
  }

  for (const turn of Object.keys(byTurn).map(Number).sort((a, b) => a - b)) {
    console.log(`── Turn ${turn} ──`);
    for (const e of byTurn[turn]) {
      const inputStr = e.input ? JSON.stringify(e.input).slice(0, 80) : '';
      const resultStr = (e.result ?? '').toString().slice(0, 120).replace(/\n/g, ' ');
      console.log(`  ${e.tool.padEnd(30)} input=${inputStr.padEnd(40)} → ${resultStr}`);
    }
  }

  // Categorize tools
  console.log('\n═══ Tool categories ═══');
  const cats = {
    read_only: 0,
    write: 0,
    deploy: 0,
    skills: 0,
    other: 0,
  };
  const toolCounts: Record<string, number> = {};
  for (const e of log) {
    toolCounts[e.tool] = (toolCounts[e.tool] ?? 0) + 1;
    if (/^(get|read|list|query|search|github_read|github_list)/.test(e.tool)) cats.read_only++;
    else if (/^(write|push|update|create_branch|create_commit|provision)/.test(e.tool)) cats.write++;
    else if (/^cf_(deploy|delete)/.test(e.tool)) cats.deploy++;
    else if (/skill/.test(e.tool)) cats.skills++;
    else cats.other++;
  }
  console.log(`  read_only:  ${cats.read_only}`);
  console.log(`  write:      ${cats.write}`);
  console.log(`  deploy:     ${cats.deploy}  ← if 0, agent never deployed`);
  console.log(`  skills:     ${cats.skills}`);
  console.log(`  other:      ${cats.other}`);

  console.log('\n═══ Tool call frequency ═══');
  for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tool.padEnd(35)} ${count}`);
  }

  // Check error_summary for any provider/model info
  if (exec.error_summary) {
    console.log(`\n═══ error_summary ═══\n${exec.error_summary}`);
  }
  if (exec.token_usage) {
    console.log(`\n═══ token_usage ═══\n${JSON.stringify(exec.token_usage, null, 2)}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
