import { db, tasks } from '@/lib/db';
import { randomUUID } from 'crypto';
import { launchTask } from '@/lib/agents/worker-launcher';
import { eq, and, inArray } from 'drizzle-orm';

const COMPANY_ID = '7542b090-42cb-483b-8f14-7a3f7ce5c5f4';

async function main() {
  await db.update(tasks)
    .set({ status: 'failed', failure_class: 'scope_overflow', completed_at: new Date() })
    .where(and(eq(tasks.company_id, COMPANY_ID), inArray(tasks.status, ['in_progress', 'verifying'])));

  const id = randomUUID();
  await db.insert(tasks).values({
    id,
    company_id: COMPANY_ID,
    title: 'Add Contact section (CF deploy test v3 — ENGINEERING_TOOLS fix)',
    description: `Update https://pagegenie.baljia.app to add a Contact section. Execute exactly:

1. Call cf_deploy_landing with a full HTML document. The HTML must:
   - Be a complete <!DOCTYPE html> document under 10KB, inline CSS only
   - Dark theme (#0a0a0a background), gold accent (#F5A623)
   - Contain "PageGenie" as hero heading
   - Include a section titled "Get in Touch" with a mailto:pagegenie@baljia.app link
   - Footer "Built and operated by Baljia"

2. After cf_deploy_landing returns success, call cf_verify_founder_app with no arguments.

3. Return a short text confirming the deploy — no more tool calls.

STRICT RULES:
- Only the 2 tools above. Do NOT call github_*, render_*, update_task_status, or any other tool.
- Single deploy, single verify, done.`,
    tag: 'engineering',
    status: 'todo',
    priority: 100,
    complexity: 2,
    source: 'founder_requested',
    estimated_credits: 1,
    estimated_hours: '0.1',
    authorized_by: 'founder',
    authorization_reason: 'E2E test v3 — after ENGINEERING_TOOLS fix',
    execution_mode: 'full_agent',
    verification_level: 'deterministic',
    max_turns: 5,
  });
  console.log('Task id:', id);
  console.log('Launching...');
  const execution = await launchTask(id);
  console.log('\n=== Execution finished ===');
  console.log('status:', execution.status, 'turns:', execution.turn_count);
  const log = (execution.execution_log as Array<Record<string, unknown>>) ?? [];
  for (const entry of log) {
    const { turn, tool, event, result, input } = entry as any;
    if (tool) {
      const inp = JSON.stringify(input).slice(0, 100);
      const res = typeof result === 'string' ? result.slice(0, 250).replace(/\n/g, ' ') : JSON.stringify(result).slice(0, 250);
      console.log(`  turn ${turn}: ${tool}(${inp}) → ${res}`);
    } else {
      console.log(`  turn ${turn}: ${event}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error('Threw:', e instanceof Error ? e.message : e); process.exit(1); });
