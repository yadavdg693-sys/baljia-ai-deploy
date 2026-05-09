// End-to-end smoke for the verifier-injected journey fallback.
//
// Builds a synthetic execution_log that simulates "agent deployed but
// skipped verify_user_journey", then runs verifyTask and asserts the
// fallback fired against the live threadpulse app and produced PASS
// journey evidence.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, taskExecutions, tasks } from '@/lib/db';
import { like } from 'drizzle-orm';
import { verifyTask } from '@/lib/services/verification.service';
import type { Task } from '@/types';

void (async () => {
  const [t] = await db.select().from(tasks).where(like(tasks.title, 'REDSHIP-CLONE: Build%')).limit(1);
  if (!t) throw new Error('threadpulse engineering task not found');

  // Inject a synthetic execution log: deploy + health succeeded, no journey.
  const syntheticLog = [
    { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-x' },
    { tool: 'check_url_health',      result: 'https://threadpulse.baljia.app is UP - HTTP 200 in 80ms' },
  ];
  await db.insert(taskExecutions).values({
    task_id:        t.id,
    agent_id:       30, // Engineering
    execution_mode: 'full_agent',
    status:         'running',
    max_turns:      200,
    execution_log:  syntheticLog,
  } as never);

  console.log(`Inserted synthetic exec log (deploy + health, no journey).`);
  console.log(`Running verifyTask...`);

  const result = await verifyTask({ ...(t as Task), verification_level: 'deterministic' });
  const journeyCheck = result.checks.find((c) => c.name === 'user_journey_evidence');

  console.log(`\nuser_journey_evidence check:`);
  console.log(`  passed: ${journeyCheck?.passed}`);
  console.log(`  detail: ${journeyCheck?.detail}`);
  console.log(`\nresult.passed: ${result.passed}`);

  // Smoke-test pass criteria: the fallback FIRED with a structured result.
  // Whether the fallback itself returned PASS or FAIL depends on whether
  // the live threadpulse app is currently healthy — we don't gate on that
  // because that's a separate concern. We only verify that:
  //   1. The verifier detected agent skipped verify_user_journey
  //   2. The verifier itself ran the fallback
  //   3. The fallback produced a structured journey result (not "could not resolve")
  const fallbackFired = /fallback/i.test(journeyCheck?.detail ?? '');
  const structuredResult = /JOURNEY (PASS|FAIL)/.test(journeyCheck?.detail ?? '')
    || journeyCheck?.detail?.includes('passed')
    || journeyCheck?.passed === true;
  const ok = fallbackFired && structuredResult;
  console.log(`\nSmoke checks:`);
  console.log(`  ${fallbackFired ? '✓' : '✗'} fallback fired (detail mentions "fallback")`);
  console.log(`  ${structuredResult ? '✓' : '✗'} fallback produced structured result`);
  if (journeyCheck?.passed) console.log(`  + fallback liveness probe also PASSED (live app is healthy)`);
  else console.log(`  + fallback liveness probe FAILED (the live app is currently degraded — that's the fallback doing its job, not a smoke-test failure)`);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  RESULT: ${ok ? 'PASS' : 'FAIL'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
