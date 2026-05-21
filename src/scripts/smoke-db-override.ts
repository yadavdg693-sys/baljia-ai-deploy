// Deep test: exercise the EXACT loadAgentBasePrompt function the factory
// uses, with a temporary DB sentinel for agent 30's base_system_prompt.
// Proves that:
//   - When DB has a body → returns body + invariants
//   - When DB is empty → returns hardcoded prompt
//   - is_active=false is surfaced via deactivated flag
// Restores DB to original state when done.

import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';
import { loadAgentBasePrompt } from '@/lib/agents/agent-factory';

const SENTINEL_BODY = '__SMOKE_TEST_BODY_SHORT__: This is a deliberately bare-bones operator prompt to verify invariants append on top.';

(async () => {
  // Capture original state
  const before = (await db.execute(sql`SELECT base_system_prompt, is_active FROM agents WHERE id = 30`)) as any;
  const originalBody = (before.rows ?? before)[0]?.base_system_prompt as string | null;
  const originalActive = (before.rows ?? before)[0]?.is_active as boolean;
  console.log('Original DB state for agent 30: body =', originalBody ? `${originalBody.length} chars` : 'NULL', ', is_active =', originalActive);

  try {
    // Case A: hardcoded fallback (current state — NULL body)
    console.log('\n--- Case A: DB body is NULL ---');
    const a = await loadAgentBasePrompt(30);
    console.log('  fromDB:', a.fromDB, '| deactivated:', a.deactivated, '| length:', a.prompt.length);
    console.log('  starts with hardcoded prompt:', a.prompt.startsWith('You are the Engineering Agent'));
    console.log('  contains invariant sentinel:', a.prompt.includes('INVARIANT RULES (cannot be overridden via DB prompt)'));

    // Case B: DB override with short body — invariants MUST append
    console.log('\n--- Case B: DB body = sentinel ---');
    await db.execute(sql`UPDATE agents SET base_system_prompt = ${SENTINEL_BODY} WHERE id = 30`);
    const b = await loadAgentBasePrompt(30);
    console.log('  fromDB:', b.fromDB, '| deactivated:', b.deactivated, '| length:', b.prompt.length);
    console.log('  starts with sentinel:', b.prompt.startsWith(SENTINEL_BODY));
    console.log('  contains invariant sentinel:', b.prompt.includes('INVARIANT RULES (cannot be overridden via DB prompt)'));
    console.log('  contains design_critique rule:', /design_critique/i.test(b.prompt));
    console.log('  contains tenant ownership rule:', /Tenant ownership/i.test(b.prompt));
    console.log('  contains stack rule:', /github_fork_skeleton/.test(b.prompt));

    // Case C: DB override + deactivated
    console.log('\n--- Case C: DB body present + is_active=false ---');
    await db.execute(sql`UPDATE agents SET is_active = false WHERE id = 30`);
    const c = await loadAgentBasePrompt(30);
    console.log('  fromDB:', c.fromDB, '| deactivated:', c.deactivated, '| length:', c.prompt.length);
    console.log('  still has invariants:', c.prompt.includes('INVARIANT RULES'));

  } finally {
    // ALWAYS restore original state
    await db.execute(sql`UPDATE agents SET base_system_prompt = ${originalBody}, is_active = ${originalActive} WHERE id = 30`);
    const after = (await db.execute(sql`SELECT base_system_prompt, is_active FROM agents WHERE id = 30`)) as any;
    const restoredBody = (after.rows ?? after)[0]?.base_system_prompt;
    const restoredActive = (after.rows ?? after)[0]?.is_active;
    console.log('\nDB restored: body =', restoredBody === originalBody ? 'matches original' : 'MISMATCH', ', is_active =', restoredActive === originalActive ? 'matches' : 'MISMATCH');
  }
})();
