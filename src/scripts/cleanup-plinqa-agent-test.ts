// One-shot cleanup: remove the agent-test deploy from plinqa.baljia.app and
// drop the signups table the agent created. Runs after the script-bug
// recovery so we're not leaving test artifacts on a real company.
// Run: npx tsx --env-file=.env.local src/scripts/cleanup-plinqa-agent-test.ts

import { db, companies, tasks } from '@/lib/db';
import { eq, and, like } from 'drizzle-orm';
import { deleteWorkerScript, deleteWorkerRoute } from '@/lib/services/cf-deploy.service';
import { neon } from '@neondatabase/serverless';

const SLUG = 'plinqa';
const SCRIPT_NAME = `baljia-app-${SLUG}`;

async function main() {
  // 1. Find route, delete it
  try {
    const list = await fetch(`https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID_APP}/workers/routes`, {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    });
    const j = await list.json() as { result?: Array<{ id: string; pattern: string; script: string }> };
    const match = (j.result ?? []).find((r) => r.script === SCRIPT_NAME);
    if (match) {
      const ok = await deleteWorkerRoute(match.id);
      console.log(`route ${match.pattern}: ${ok ? '✓' : '⚠'}`);
    } else {
      console.log(`route: (none found for ${SCRIPT_NAME})`);
    }
  } catch (e) { console.log(`route: ⚠ ${e instanceof Error ? e.message : e}`); }

  // 2. Delete worker script
  try {
    const ok = await deleteWorkerScript(SCRIPT_NAME);
    console.log(`script ${SCRIPT_NAME}: ${ok ? '✓' : '⚠'}`);
  } catch (e) { console.log(`script: ⚠ ${e instanceof Error ? e.message : e}`); }

  // 3. Drop signups table from plinqa's Neon DB
  try {
    const [c] = await db.select({ neon: companies.neon_connection_string }).from(companies).where(eq(companies.slug, SLUG)).limit(1);
    if (c?.neon) {
      const sql = neon(c.neon);
      await sql`DROP TABLE IF EXISTS signups`;
      console.log(`table signups: ✓ dropped from ${SLUG}'s Neon DB`);
    } else {
      console.log(`table signups: ⚠ no Neon URL for ${SLUG}`);
    }
  } catch (e) { console.log(`table: ⚠ ${e instanceof Error ? e.message : e}`); }

  // 4. Soft-delete the test task(s)
  try {
    const result = await db
      .update(tasks)
      .set({ status: 'rejected' })
      .where(and(
        like(tasks.title, '%Agent-loop CF integration%'),
        eq(tasks.status, 'completed'),
      ))
      .returning({ id: tasks.id });
    console.log(`task soft-reject: ${result.length} updated`);
  } catch (e) { console.log(`task: ⚠ ${e instanceof Error ? e.message : e}`); }

  // 5. Confirm subdomain returns wildcard 404 again
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const r = await fetch(`https://${SLUG}.baljia.app/api/health`);
    console.log(`post-cleanup probe: HTTP ${r.status}  (expecting wildcard fallback)`);
  } catch (e) { console.log(`probe: ⚠ ${e instanceof Error ? e.message : e}`); }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
