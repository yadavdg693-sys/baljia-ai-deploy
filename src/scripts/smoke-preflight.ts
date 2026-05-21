// Live preflight smoke — verifies every integration the engineering agent
// depends on is reachable with the current creds. Run before any real
// engineering measurement to ensure failures we observe are agent-side, not
// environment-side.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { preflightCheck } from '@/lib/services/preflight.service';

void (async () => {
  console.log('Running preflight against live integrations...\n');
  const result = await preflightCheck({ bypassCache: true, renderQuotaEvents: true });

  if (result.ok) {
    console.log('✅ All integrations healthy.');
    process.exit(0);
  }

  console.log(`❌ ${result.failures.length} integration(s) broken:\n`);
  for (const f of result.failures) {
    console.log(`  - [${f.integration}] ${f.reason}`);
  }
  process.exit(1);
})();
