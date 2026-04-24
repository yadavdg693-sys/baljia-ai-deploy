import { db, tasks } from '@/lib/db';
import { randomUUID } from 'crypto';

const COMPANY_ID = '7542b090-42cb-483b-8f14-7a3f7ce5c5f4';

async function main() {
  const id = randomUUID();
  await db.insert(tasks).values({
    id,
    company_id: COMPANY_ID,
    title: 'Add Contact section to landing page (CF deploy test v2)',
    description: `Update the landing page at https://pagegenie.baljia.app to include a "Get in Touch" section.

EXECUTE THESE EXACT STEPS USING THE TOOLS PROVIDED:

Step 1. Call the tool "get_company_tech" with no arguments to see the current company state. Confirm subdomain = "pagegenie".

Step 2. Write a complete HTML document (DOCTYPE html, dark background #0a0a0a, gold accent #F5A623, inline CSS only, no external dependencies, under 10KB) for the PageGenie landing page. It MUST include:
  - Company name "PageGenie" as hero wordmark
  - Headline about AI-assisted landing page copy generation
  - 3 feature blocks
  - A NEW "Get in Touch" section near the bottom with:
      * Short paragraph inviting contact
      * Email link: <a href="mailto:pagegenie@baljia.app">pagegenie@baljia.app</a>
  - Footer with "Built and operated by Baljia"

Step 3. Call the tool "cf_deploy_landing" with argument { "html": "<!DOCTYPE html>..." } passing the complete HTML string you wrote in step 2. This uploads it to R2 and serves it at https://pagegenie.baljia.app.

Step 4. Call the tool "cf_verify_founder_app" with no arguments. It returns HTTP status + body snippet. Confirm HTTP 200 and the body contains "Get in Touch" and "pagegenie@baljia.app".

Step 5. Return a short plain-text summary stating: "Landing updated at https://pagegenie.baljia.app. Verify returned HTTP <status>."

RULES:
- Do NOT call github_push_file, github_create_repo, or any render_* tool for this task.
- Do NOT call any tool not listed in steps 1-4 except update_task_status for progress notes.
- Keep total turns under 6. Deploy in a single cf_deploy_landing call.`,
    tag: 'engineering',
    status: 'todo',
    priority: 100,
    complexity: 2,
    source: 'founder_requested',
    estimated_credits: 1,
    estimated_hours: '0.3',
    authorized_by: 'founder',
    authorization_reason: 'E2E test v2 — CF deploy with Codex primary',
    execution_mode: 'full_agent',
    verification_level: 'deterministic',
    max_turns: 8,
  });
  console.log('Created task:', id);
  console.log('Trigger with:');
  console.log('  npx tsx scripts/trigger-pagegenie-task.ts', id);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
