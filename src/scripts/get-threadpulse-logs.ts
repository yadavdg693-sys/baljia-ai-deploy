// Pull recent Render logs for threadpulse and the env-var configuration on
// the service to find why registration is failing in production.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';

const RENDER_API = 'https://api.render.com/v1';

void (async () => {
  const [c] = await db.select().from(companies).where(eq(companies.slug, 'threadpulse'));
  const sid = c?.render_service_id;
  if (!sid) throw new Error('No render service');

  const headers = { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: 'application/json' };

  // Env vars (values redacted, just keys + masked-ness)
  console.log('═══ ENV VARS ═══');
  const evRes = await fetch(`${RENDER_API}/services/${sid}/env-vars`, { headers });
  const evJ = await evRes.json() as Array<{ envVar: { key: string; value: string } }>;
  for (const e of evJ) {
    const v = e.envVar.value ?? '';
    const masked = v.length > 20 ? `${v.slice(0,10)}…${v.slice(-6)} (${v.length} chars)` : v;
    const containsAst = v.includes('***');
    console.log(`  ${e.envVar.key.padEnd(20)} = ${masked}${containsAst ? ' ⚠ MASKED' : ''}`);
  }

  // Recent logs
  console.log('\n═══ RECENT LOGS (last 50 lines) ═══');
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const logRes = await fetch(`${RENDER_API}/logs?ownerId=${process.env.RENDER_OWNER_ID}&resource=${sid}&startTime=${encodeURIComponent(since)}&limit=50&direction=backward`, { headers });
  const logJ = await logRes.json() as { logs?: Array<{ timestamp: string; message: string; labels?: Array<{ name: string; value: string }> }> };
  const ls = logJ.logs ?? [];
  if (ls.length === 0) console.log('  (no logs)');
  for (const log of ls.reverse()) {
    const ts = log.timestamp?.slice(11, 19) ?? '?';
    const lvl = log.labels?.find(l => l.name === 'level')?.value ?? '';
    console.log(`  ${ts} ${lvl.padEnd(5)} ${log.message?.slice(0, 200) ?? ''}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
