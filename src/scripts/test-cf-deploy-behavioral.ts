// Behavioral verification: deploy a tiny contact-form app, then PROVE the
// feature works end-to-end as a real customer would experience it:
//   1. POST a submission to the form's API endpoint
//   2. GET the list endpoint, confirm the submission appears
//   3. Query the founder's Neon DB directly, confirm the row was inserted
//   4. Try malformed input, confirm 4xx (not 500)
//
// "Deploy succeeded" ≠ "feature works." This test verifies the latter.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-cf-deploy-behavioral.ts

import { db, companies, tasks, taskExecutions } from '@/lib/db';
import { and, eq, isNotNull, desc } from 'drizzle-orm';
import * as taskService from '@/lib/services/task.service';
import { launchTask } from '@/lib/agents/worker-launcher';
import {
  getWorkerScriptSource,
  deleteWorkerScript,
  deleteWorkerRoute,
  isCloudflareDeployConfigured,
} from '@/lib/services/cf-deploy.service';
import { neon } from '@neondatabase/serverless';

const PREFERRED_SLUG = 'plinqa';
// Make the contract EXPLICIT so we can verify it precisely afterwards.
const TASK_TITLE = 'Build a contact form app with REST contract';
const TASK_DESCRIPTION = `Build a contact form app at {SUBDOMAIN}.baljia.app with these EXACT endpoints:

- GET /  — HTML page with a form. Form must have an input with name="name", an input with name="email" type=email, and a submit button. Form posts to /api/contacts.
- POST /api/contacts — body: { "name": string, "email": string }. Insert into a "contacts" table. Return JSON { "ok": true, "id": <uuid|number> } with status 201.
- GET /api/contacts — list all contacts as JSON: { "ok": true, "contacts": [{"id":..,"name":..,"email":..}], "count": N }. Status 200.

Use the build-fullstack-cf-app skill. Read it first, follow the canonical pattern.

The endpoints above are a CONTRACT — they must be reachable at these exact paths and respond with these exact shapes. The form on / must POST to /api/contacts.`.trim();

interface BehavioralCheck {
  name: string;
  passed: boolean;
  detail: string;
}

async function runBehavioralChecks(slug: string, neonUrl: string): Promise<BehavioralCheck[]> {
  const base = `https://${slug}.baljia.app`;
  const checks: BehavioralCheck[] = [];
  const testEmail = `behavioral+${Date.now()}@baljia.test`;
  const testName = 'Behavioral Test User';

  // 1. GET / returns 200 with form
  try {
    const r = await fetch(base + '/');
    const body = await r.text();
    const hasNameField = /name=["']?name["']?/.test(body);
    const hasEmailField = /name=["']?email["']?/.test(body);
    const hasFormPostingTo = /<form[^>]*action=["']?\/api\/contacts["']?/.test(body) || /<form[^>]*post/i.test(body);
    const passed = r.status === 200 && hasNameField && hasEmailField;
    checks.push({
      name: 'GET / has form with name+email fields',
      passed,
      detail: `HTTP ${r.status}, name-field=${hasNameField}, email-field=${hasEmailField}, form-posts=${hasFormPostingTo}`,
    });
  } catch (e) {
    checks.push({ name: 'GET /', passed: false, detail: `fetch error: ${e instanceof Error ? e.message : e}` });
  }

  // 2. POST /api/contacts inserts a contact
  let postedId: string | number | null = null;
  try {
    const r = await fetch(base + '/api/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: testName, email: testEmail }),
    });
    const ct = r.headers.get('content-type') ?? '';
    let parsed: { ok?: boolean; id?: string | number } = {};
    if (ct.includes('json')) parsed = await r.json() as typeof parsed;
    const passed = (r.status === 200 || r.status === 201) && parsed.ok === true && parsed.id !== undefined;
    if (passed) postedId = parsed.id ?? null;
    checks.push({
      name: 'POST /api/contacts returns 2xx with {ok:true, id}',
      passed,
      detail: `HTTP ${r.status}, body: ${JSON.stringify(parsed).slice(0, 150)}`,
    });
  } catch (e) {
    checks.push({ name: 'POST /api/contacts', passed: false, detail: `fetch error: ${e instanceof Error ? e.message : e}` });
  }

  // 3. GET /api/contacts returns the just-posted entry
  try {
    const r = await fetch(base + '/api/contacts');
    const ct = r.headers.get('content-type') ?? '';
    let parsed: { ok?: boolean; contacts?: Array<{ email: string }>; count?: number } = {};
    if (ct.includes('json')) parsed = await r.json() as typeof parsed;
    const found = (parsed.contacts ?? []).some((c) => c.email === testEmail);
    const passed = r.status === 200 && parsed.ok === true && found;
    checks.push({
      name: 'GET /api/contacts returns posted email',
      passed,
      detail: `HTTP ${r.status}, count=${parsed.count}, includes-test-email=${found}`,
    });
  } catch (e) {
    checks.push({ name: 'GET /api/contacts', passed: false, detail: `fetch error: ${e instanceof Error ? e.message : e}` });
  }

  // 4. DB has the row (round-trip via Neon)
  try {
    const sql = neon(neonUrl);
    const rows = await sql`SELECT name, email FROM contacts WHERE email = ${testEmail}` as Array<{ name: string; email: string }>;
    const passed = rows.length > 0 && rows[0].email === testEmail && rows[0].name === testName;
    checks.push({
      name: 'DB contains row with submitted name+email',
      passed,
      detail: rows.length > 0 ? `Row: ${JSON.stringify(rows[0])}` : 'No row in contacts table with this email',
    });
  } catch (e) {
    checks.push({ name: 'DB row check', passed: false, detail: `query error: ${e instanceof Error ? e.message : e}` });
  }

  // 5. POST with missing email returns 4xx (not 500)
  try {
    const r = await fetch(base + '/api/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'NoEmail' }),
    });
    const passed = r.status >= 400 && r.status < 500;
    checks.push({
      name: 'Bad input returns 4xx (not 500)',
      passed,
      detail: `HTTP ${r.status} for missing-email POST`,
    });
  } catch (e) {
    checks.push({ name: 'Bad input handling', passed: false, detail: `fetch error: ${e instanceof Error ? e.message : e}` });
  }

  return checks;
}

async function main() {
  console.log('═══ Behavioral Verification Test ═══\n');

  if (!isCloudflareDeployConfigured()) { console.error('CF not configured'); process.exit(1); }

  const [company] = await db
    .select({ id: companies.id, slug: companies.slug, name: companies.name, neon: companies.neon_connection_string })
    .from(companies)
    .where(and(eq(companies.slug, PREFERRED_SLUG), isNotNull(companies.neon_connection_string)))
    .limit(1);
  if (!company || !company.neon) { console.error(`${PREFERRED_SLUG} not ready`); process.exit(1); }

  const subdomain = company.slug!;
  const scriptName = `baljia-app-${subdomain}`;
  console.log(`Company: ${company.name} (${subdomain})`);
  console.log(`Target:  https://${subdomain}.baljia.app\n`);

  let cleanupNeeded = false;
  let exitCode = 0;

  try {
    // 1. Create + run task
    console.log('1. Creating task with EXPLICIT contract...');
    const task = await taskService.createTask({
      company_id: company.id,
      title: TASK_TITLE,
      description: TASK_DESCRIPTION.replace('{SUBDOMAIN}', subdomain),
      tag: 'engineering',
      source: 'system',
      estimated_credits: 1,
      status: 'todo',
      authorized_by: 'system',
      assigned_to_agent_id: 30,
      max_turns: 40,
      created_by: company.id,
    });
    console.log(`   ✓ Task ${task.id}\n`);

    console.log('2. Launching agent...');
    const start = Date.now();
    try { await launchTask(task.id); } catch (e) { console.log(`   ⚠ launchTask threw: ${e instanceof Error ? e.message : e}`); }
    console.log(`   Done in ${Math.round((Date.now() - start) / 1000)}s\n`);

    const final = await taskService.getTask(task.id);
    console.log(`3. Task status: ${final?.status}, turns: ${final?.turn_count}\n`);

    // 2. Confirm Worker exists
    const ws = await getWorkerScriptSource(scriptName);
    if (!ws) {
      console.log('═══ ❌ Worker not deployed — skipping behavioral checks ═══');
      exitCode = 1;
    } else {
      cleanupNeeded = true;
      console.log(`4. Worker deployed: ${ws.bytes} bytes\n`);

      // 3. BEHAVIORAL CHECKS — the real test
      console.log('5. Behavioral checks:');
      const checks = await runBehavioralChecks(subdomain, company.neon);
      for (const c of checks) {
        console.log(`   ${c.passed ? '✓' : '✗'} ${c.name}`);
        console.log(`     ${c.detail}`);
      }
      console.log();
      const allPassed = checks.every((c) => c.passed);
      if (allPassed) {
        console.log('═══ ✅ BEHAVIORAL VERIFICATION PASSED ═══');
        console.log('   Form renders correctly, POST inserts to DB, GET returns data, bad input rejected.');
        console.log('   This is "feature actually works" — not just "deploy succeeded".');
      } else {
        console.log(`═══ ❌ ${checks.filter((c) => !c.passed).length}/${checks.length} BEHAVIORAL CHECKS FAILED ═══`);
        console.log('   Deploy succeeded but feature does not work as the founder asked for.');
        exitCode = 1;
      }
    }

    await db.update(tasks).set({ status: 'rejected' }).where(eq(tasks.id, task.id));
  } finally {
    console.log('\n6. Cleanup...');
    if (cleanupNeeded) {
      try {
        const cfApi = 'https://api.cloudflare.com/client/v4';
        const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP!;
        const list = await fetch(`${cfApi}/zones/${zoneId}/workers/routes`, {
          headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
        });
        const j = await list.json() as { result?: Array<{ id: string; script: string }> };
        const route = (j.result ?? []).find((r) => r.script === scriptName);
        if (route) await deleteWorkerRoute(route.id);
        await deleteWorkerScript(scriptName);
        // Drop the contacts table
        const sql = neon(company.neon!);
        await sql`DROP TABLE IF EXISTS contacts`;
        console.log('   ✓');
      } catch (e) { console.log(`   cleanup: ${e instanceof Error ? e.message : e}`); }
    }
  }

  process.exit(exitCode);
}

main().catch((e) => { console.error(e); process.exit(1); });
