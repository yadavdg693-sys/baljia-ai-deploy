// Launch-only entry point for the redship-clone test harness.
//
// Finds the Threadpulse company (or any company owned by redship-clone@baljia.test)
// and launches its two REDSHIP-CLONE tasks in dependency order: research first,
// then engineering. Both tasks use the company's single execution slot — they
// serialize naturally.
//
// Skips setup. Use src/scripts/setup-redship-clone.ts (no flag) if the company
// doesn't exist yet.
//
// Usage: npx tsx --env-file=.env.local src/scripts/launch-redship-clone.ts

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, users, companies, tasks } from '@/lib/db';
import { eq, and, desc, like } from 'drizzle-orm';
import { launchTask } from '@/lib/agents/worker-launcher';

const FOUNDER_EMAIL = 'redship-clone@baljia.test';

void (async () => {
  const t0 = Date.now();
  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`  REDSHIP-CLONE — LAUNCH ONLY`);
  console.log(`══════════════════════════════════════════════════`);

  const [u] = await db.select().from(users).where(eq(users.email, FOUNDER_EMAIL));
  if (!u) throw new Error(`No founder user found: ${FOUNDER_EMAIL}. Run setup-redship-clone.ts first.`);

  const [c] = await db.select().from(companies)
    .where(eq(companies.owner_id, u.id))
    .orderBy(desc(companies.created_at))
    .limit(1);
  if (!c) throw new Error('No company for founder. Run setup-redship-clone.ts first.');
  console.log(`  Company: ${c.name} (slug=${c.slug}, id=${c.id})\n`);

  // Look up the two REDSHIP-CLONE tasks
  const allTasks = await db.select().from(tasks)
    .where(and(
      eq(tasks.company_id, c.id),
      like(tasks.title, 'REDSHIP-CLONE:%'),
    ));

  const research    = allTasks.find(t => t.tag === 'research');
  const engineering = allTasks.find(t => t.tag === 'engineering');
  if (!research)    throw new Error('Research REDSHIP-CLONE task not found.');
  if (!engineering) throw new Error('Engineering REDSHIP-CLONE task not found.');
  console.log(`  Research task:    ${research.id.slice(0,8)}… (status=${research.status})`);
  console.log(`  Engineering task: ${engineering.id.slice(0,8)}… (status=${engineering.status})`);
  console.log(``);

  // ── 1. Launch research ──────────────────────────────────────────────
  if (research.status === 'todo') {
    console.log(`▶ Launching research task at +${Math.round((Date.now()-t0)/1000)}s ...`);
    const r = await launchTask(research.id, { subscriptionFunded: true });
    console.log(`◀ Research finished: status=${r.status} turns=${r.turn_count} at +${Math.round((Date.now()-t0)/1000)}s`);
    if (r.status !== 'completed') {
      console.warn(`  ⚠ Research did not complete. Engineering will still run on what's there.`);
    }
  } else {
    console.log(`  Skipping research — status=${research.status} (not todo)`);
  }

  // ── 2. Launch engineering ───────────────────────────────────────────
  if (engineering.status === 'todo') {
    console.log(`\n▶ Launching engineering task at +${Math.round((Date.now()-t0)/1000)}s ...`);
    const e = await launchTask(engineering.id, { subscriptionFunded: true });
    console.log(`◀ Engineering finished: status=${e.status} turns=${e.turn_count} at +${Math.round((Date.now()-t0)/1000)}s`);
    process.exit(e.status === 'completed' ? 0 : 1);
  } else {
    console.log(`  Skipping engineering — status=${engineering.status} (not todo)`);
    process.exit(0);
  }
})().catch(e => { console.error(e); process.exit(1); });
