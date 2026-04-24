// Create a focused task for the pagegenie company that the Engineering agent
// should resolve via cf_deploy_landing. Tests the NEW split-hosting path
// through the full agent pipeline.
//
// Also cleans up any stuck in_progress task on the same company so the one-slot
// invariant doesn't block the new launch.

import { db, tasks, companies } from '@/lib/db';
import { eq, and, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const COMPANY_ID = '7542b090-42cb-483b-8f14-7a3f7ce5c5f4';

async function main() {
  // 1. Free the active slot — mark any in_progress task as failed so new one can start
  const freed = await db.update(tasks)
    .set({ status: 'failed', failure_class: 'scope_overflow', completed_at: new Date() })
    .where(and(eq(tasks.company_id, COMPANY_ID), inArray(tasks.status, ['in_progress', 'verifying'])))
    .returning({ id: tasks.id, title: tasks.title });
  console.log('Freed slot — released tasks:', freed.length);
  for (const t of freed) console.log('  -', t.id, t.title);

  // Also reset the engineering starter task back to todo so it's not lost
  const resetEng = await db.update(tasks)
    .set({ status: 'todo', started_at: null, completed_at: null, turn_count: 0 })
    .where(eq(tasks.id, 'ef9acc83-8415-4e5c-af4c-fa4d6a91fd6a'))
    .returning({ id: tasks.id });
  console.log('Reset engineering task to todo:', resetEng.length > 0);

  // 2. Create a focused test task that uses cf_deploy_landing
  const newTaskId = randomUUID();
  await db.insert(tasks).values({
    id: newTaskId,
    company_id: COMPANY_ID,
    title: 'Update landing page: add a Contact section with baljia.app email',
    description: `The founder wants to add a Contact section to their landing page at https://pagegenie.baljia.app.

REQUIREMENTS:
1. Read the current landing HTML from the company's landing_page document (use read_document tool if available, or regenerate from scratch matching the existing aesthetic).
2. Add a new section near the bottom (before the footer) titled "Get in Touch" with:
   - A short paragraph about reaching out
   - The company email: pagegenie@baljia.app (displayed as a clickable mailto: link)
   - Matching the existing design (dark background #0a0a0a, gold accent #F5A623, same typography)
3. Deploy the updated HTML using cf_deploy_landing (NOT render_create_service — the founder-app is on Cloudflare per ADR-002).
4. Verify the deploy succeeded via cf_verify_founder_app — confirm HTTP 200 and the new "Get in Touch" text is present.

IMPORTANT:
- Do NOT push to GitHub — this is a landing-only update, not a code change.
- Do NOT call render_create_service or any render_* tool.
- The cf_deploy_landing tool uploads HTML to R2 which the wildcard Worker serves.
- Keep the full page under 20KB.

This should be a single tool-call sequence: cf_deploy_landing → cf_verify_founder_app → done.`,
    tag: 'engineering',
    status: 'todo',
    priority: 100,
    complexity: 3,
    source: 'founder_requested',
    estimated_credits: 1,
    estimated_hours: '0.5',
    authorized_by: 'founder',
    authorization_reason: 'E2E test — CF deploy path via agent',
    execution_mode: 'full_agent',
    verification_level: 'deterministic',
    max_turns: 10,  // bounded — this task should be quick
  });

  console.log('\nCreated focused CF-deploy task:', newTaskId);
  console.log('  tag: engineering');
  console.log('  max_turns: 10 (bounded to prevent runaway)');
  console.log('  credits: 1');
  console.log('');
  console.log('Trigger with: npx tsx scripts/trigger-pagegenie-task.ts', newTaskId);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
