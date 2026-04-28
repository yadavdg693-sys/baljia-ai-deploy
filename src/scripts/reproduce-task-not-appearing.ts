// Reproduce the "task created but not visible in get_tasks()" bug.
// If we can reproduce it, we know the fix works when the test goes green.
// If we CAN'T reproduce it, the agent's Neon-pooling diagnosis might
// not be the actual root cause — and we'd need to dig further.
//
// Run: npx tsx --env-file=.env.local src/scripts/reproduce-task-not-appearing.ts

import { db, companies } from '@/lib/db';
import { eq, and, isNotNull } from 'drizzle-orm';
import * as taskService from '@/lib/services/task.service';

const ATTEMPTS = 20;  // try 20 rapid create→read cycles

async function main() {
  // Use plinqa as the test company
  const [c] = await db.select({ id: companies.id, slug: companies.slug })
    .from(companies)
    .where(and(eq(companies.slug, 'plinqa'), isNotNull(companies.neon_connection_string)))
    .limit(1);
  if (!c) { console.error('plinqa not found'); process.exit(1); }

  console.log(`═══ Reproducing read-your-writes race against ${ATTEMPTS} create+read cycles ═══`);
  console.log(`DATABASE_URL pooled: ${process.env.DATABASE_URL?.includes('-pooler') ? 'YES (likely buggy)' : 'NO'}\n`);

  let invisibleCount = 0;
  const races: Array<{ taskId: string; createdAt: number; visibleAfterMs: number | null; allListIds: number }> = [];

  for (let i = 0; i < ATTEMPTS; i++) {
    const title = `REPRO-${Date.now()}-${i}`;
    const t0 = Date.now();
    const created = await taskService.createTask({
      company_id: c.id,
      title,
      description: 'reproduction test',
      tag: 'engineering',
      source: 'system',
      estimated_credits: 1,
      status: 'todo',
      max_turns: 10,
      created_by: c.id,
    });
    const createdAt = Date.now();

    // IMMEDIATELY read tasks back
    const list = await taskService.getTasks(c.id);
    const found = list.some((t) => t.id === created.id);
    const readAt = Date.now();

    if (!found) {
      invisibleCount++;
      // Try a few more times to see when it becomes visible
      let visibleAt: number | null = null;
      for (let retry = 0; retry < 10; retry++) {
        await new Promise((r) => setTimeout(r, 50));
        const reList = await taskService.getTasks(c.id);
        if (reList.some((t) => t.id === created.id)) {
          visibleAt = Date.now();
          break;
        }
      }
      races.push({
        taskId: created.id,
        createdAt: createdAt - t0,
        visibleAfterMs: visibleAt ? visibleAt - createdAt : null,
        allListIds: list.length,
      });
      console.log(`  ${i + 1}/${ATTEMPTS}  ❌ INVISIBLE  task=${created.id.slice(0, 8)}…  list_len=${list.length}  recovered_after=${visibleAt ? `${visibleAt - createdAt}ms` : 'NEVER (10 retries × 50ms)'}`);
    } else {
      console.log(`  ${i + 1}/${ATTEMPTS}  ✓ visible immediately  list_len=${list.length}`);
    }

    // Cleanup the just-created task to keep DB clean
    try {
      const { tasks: tasksTable } = await import('@/lib/db');
      await db.delete(tasksTable).where(eq(tasksTable.id, created.id));
    } catch {}
  }

  console.log(`\n═══ Summary ═══`);
  console.log(`Invisible immediately: ${invisibleCount}/${ATTEMPTS}  (${Math.round(invisibleCount / ATTEMPTS * 100)}%)`);
  if (invisibleCount > 0) {
    console.log(`\nRace details:`);
    for (const r of races) console.log(`  task=${r.taskId.slice(0, 8)}…  visible_after=${r.visibleAfterMs ? `${r.visibleAfterMs}ms` : 'NEVER'}`);
    console.log(`\n=> BUG REPRODUCES. Agent's diagnosis is correct.`);
    process.exit(0);
  } else {
    console.log(`\n=> Bug did not reproduce in ${ATTEMPTS} attempts.`);
    console.log(`   Either the race is rare, or the diagnosis was a red herring.`);
    console.log(`   The Next.js Server Component caching issue might be the only real bug.`);
    process.exit(0);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
