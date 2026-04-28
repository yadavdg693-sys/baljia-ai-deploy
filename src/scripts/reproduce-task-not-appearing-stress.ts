// Stronger reproducer: parallel writes from multiple "callers" interleaved
// with reads. Mimics production conditions where the chat process creates
// a task and a subsequent API request (different request handler) reads.
//
// Run: npx tsx --env-file=.env.local src/scripts/reproduce-task-not-appearing-stress.ts

import { db, companies, tasks } from '@/lib/db';
import { eq, and, isNotNull } from 'drizzle-orm';
import * as taskService from '@/lib/services/task.service';

const PARALLEL = 10;          // concurrent create+read pairs
const ROUNDS = 5;              // total rounds
const FRESH_CONNECTION_INTERVAL = 0;  // 0 = no artificial delay

async function createAndImmediatelyRead(companyId: string, label: string): Promise<{ visible: boolean; latencyMs: number; recoveredMs: number | null }> {
  const t0 = Date.now();
  const created = await taskService.createTask({
    company_id: companyId,
    title: `STRESS-${label}-${Date.now()}`,
    description: 'parallel stress test',
    tag: 'engineering',
    source: 'system',
    estimated_credits: 1,
    status: 'todo',
    max_turns: 10,
    created_by: companyId,
  });
  const t1 = Date.now();
  const list = await taskService.getTasks(companyId);
  const visible = list.some((t) => t.id === created.id);
  const latencyMs = t1 - t0;

  let recoveredMs: number | null = null;
  if (!visible) {
    for (let retry = 0; retry < 5; retry++) {
      await new Promise((r) => setTimeout(r, 50));
      const reList = await taskService.getTasks(companyId);
      if (reList.some((t) => t.id === created.id)) {
        recoveredMs = Date.now() - t1;
        break;
      }
    }
  }

  // Cleanup
  try { await db.delete(tasks).where(eq(tasks.id, created.id)); } catch {}
  return { visible, latencyMs, recoveredMs };
}

async function main() {
  const [c] = await db.select({ id: companies.id, slug: companies.slug })
    .from(companies)
    .where(and(eq(companies.slug, 'plinqa'), isNotNull(companies.neon_connection_string)))
    .limit(1);
  if (!c) { console.error('plinqa not found'); process.exit(1); }

  console.log(`═══ Stress reproducer: ${PARALLEL} parallel × ${ROUNDS} rounds ═══`);
  console.log(`DATABASE_URL pooled: ${process.env.DATABASE_URL?.includes('-pooler') ? 'YES' : 'NO'}\n`);

  let totalRuns = 0;
  let invisibleCount = 0;
  const recoveryTimes: number[] = [];

  for (let round = 0; round < ROUNDS; round++) {
    const startRound = Date.now();
    const promises = [];
    for (let i = 0; i < PARALLEL; i++) {
      promises.push(createAndImmediatelyRead(c.id, `r${round}-w${i}`));
    }
    const results = await Promise.all(promises);
    const roundElapsed = Date.now() - startRound;

    const roundInvisible = results.filter((r) => !r.visible).length;
    invisibleCount += roundInvisible;
    totalRuns += results.length;
    for (const r of results) if (r.recoveredMs !== null) recoveryTimes.push(r.recoveredMs);

    console.log(`  round ${round + 1}/${ROUNDS}  parallel=${PARALLEL}  invisible=${roundInvisible}/${PARALLEL}  elapsed=${roundElapsed}ms`);
  }

  console.log(`\n═══ Stress Summary ═══`);
  console.log(`Total: ${totalRuns} runs, ${invisibleCount} invisible (${(invisibleCount / totalRuns * 100).toFixed(1)}%)`);
  if (recoveryTimes.length > 0) {
    const avg = Math.round(recoveryTimes.reduce((s, x) => s + x, 0) / recoveryTimes.length);
    const max = Math.max(...recoveryTimes);
    console.log(`Recovery times: avg=${avg}ms, max=${max}ms, n=${recoveryTimes.length}`);
  }

  if (invisibleCount === 0) {
    console.log(`\n=> Bug DOES NOT REPRODUCE under ${PARALLEL}× parallel stress.`);
    console.log(`   Neon pooling fix (directDb) is NOT NEEDED at current scale.`);
    process.exit(0);
  } else {
    console.log(`\n=> Bug REPRODUCES — applying Fix 1 (directDb) is justified.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
