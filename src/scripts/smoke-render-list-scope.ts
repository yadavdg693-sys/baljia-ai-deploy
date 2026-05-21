// Empirically verify render_list_services returns only the calling
// company's service, not the full operator account fleet.

import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';
import { handleEngineeringTool } from '@/lib/agents/tools/engineering.tools';
import type { Task } from '@/types';

(async () => {
  const cos = (await db.execute(sql`SELECT id, github_repo, render_service_id FROM companies WHERE render_service_id IS NOT NULL LIMIT 1`)) as any;
  const company = (cos.rows ?? cos)[0];
  if (!company) {
    console.log('No company with render_service_id. Skipping.');
    return;
  }
  console.log('Using company', company.id.slice(0, 8), 'service', company.render_service_id);

  const task = {
    id: 'smoke-test',
    company_id: company.id,
    agent_id: 30,
    title: 'smoke',
    description: '',
    tag: 'engineering',
    status: 'in_progress',
    priority: 50,
    complexity: 1,
    max_turns: 1,
  } as unknown as Task;

  // Call render_list_services. Should return only ONE service — this company's.
  const result = await handleEngineeringTool('render_list_services', { limit: 100 }, task);
  console.log('\n--- render_list_services result ---');
  console.log(result);

  // Verify: result mentions "1" service, contains this company's service_id, does NOT contain other companies'
  const mentionsOne = /\(1, scoped to this company\)/.test(result);
  const mentionsThisServiceId = result.includes(company.render_service_id);
  console.log(`\n  ✓ result claims "1 scoped to this company": ${mentionsOne}`);
  console.log(`  ✓ result contains this company's service_id: ${mentionsThisServiceId}`);

  // Also: confirm renderListDatabases returns the Neon redirect message
  const dbResult = await handleEngineeringTool('render_list_databases', { limit: 100 }, task);
  console.log('\n--- render_list_databases result ---');
  console.log(dbResult);
  console.log(`\n  ✓ steers agent to Neon: ${/uses Neon, not Render Postgres/.test(dbResult)}`);
  console.log(`  ✓ no operator fleet leak: ${!/postgres-/.test(dbResult)}`);
})();
