// Verify the new verification-layer tools dispatch correctly through
// handleDomainTool (the production routing path used by the agent loop).
// This is the path that was silently broken before today's session
// because verify_user_journey etc. were missing from ENGINEERING_TOOLS.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies, tasks } from '@/lib/db';
import { eq, like } from 'drizzle-orm';
import { handleToolCall } from '@/lib/agents/agent-factory';

void (async () => {
  const [c] = await db.select().from(companies).where(eq(companies.slug, 'threadpulse'));
  const [t] = await db.select().from(tasks).where(like(tasks.title, 'REDSHIP-CLONE: Build%')).limit(1);
  if (!c || !t) throw new Error('threadpulse fixtures not found');

  // Verify handleToolCall — the production routing path used by the agent
  // loop — correctly dispatches each new tool. "Unknown tool: ..." would
  // mean the tool was missing from the dispatch set (the latent bug we
  // discovered today). Each tool must return a substantive response.
  const safeChecks: Array<{ tool: string; input: Record<string, unknown>; expectStarts: string }> = [
    { tool: 'list_journey_templates', input: { template: 'auth' }, expectStarts: '## Journey templates' },
    // static_code_scan and review_pushed_code make real API calls — covered
    // separately by smoke-test-tier1-fixes.ts. Here we only need to prove
    // they don't return "Unknown tool".
  ];
  console.log('Production routing check (handleToolCall):');
  let allOk = true;
  for (const check of safeChecks) {
    const result = await handleToolCall(check.tool, check.input, t as never, 30);
    const ok = !result.startsWith('Unknown tool') && result.startsWith(check.expectStarts);
    console.log(`  ${ok ? '✓' : '✗'} ${check.tool} → ${result.slice(0, 80).replace(/\n/g, ' ')}...`);
    if (!ok) allOk = false;
  }
  // Quick "no Unknown tool" check for the rest by inspecting the dispatch via list_skills (a known-routed tool)
  // and comparing against handleToolCall behavior on each new tool name.
  const probeTools = ['static_code_scan', 'review_pushed_code', 'fork_express_skeleton', 'verify_user_journey', 'verify_db_state'];
  for (const tool of probeTools) {
    // Pass empty input — most will fail with a structured error message,
    // but the dispatcher should not return "Unknown tool".
    const result = await handleToolCall(tool, {}, t as never, 30);
    const dispatchedOk = !result.startsWith('Unknown tool');
    console.log(`  ${dispatchedOk ? '✓' : '✗'} ${tool} → ${result.slice(0, 100).replace(/\n/g, ' ')}...`);
    if (!dispatchedOk) allOk = false;
  }
  if (!allOk) {
    console.error('\nFAIL: at least one tool did not route through handleToolCall correctly.');
    process.exit(1);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  DISPATCH ROUTING: PASS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
