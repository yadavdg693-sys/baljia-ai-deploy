// Smoke test for the 5 round-2 audit fixes.
import { isUserFacingUiTask } from '@/lib/agents/agent-factory';
import { handleEngineeringTool } from '@/lib/agents/tools/engineering.tools';
import { readFileSync } from 'node:fs';
import type { Task } from '@/types';

(async () => {
  console.log('=== P0.1: design_audit has assertUrlSafe ===');
  const fakeTask = { id: 't1', company_id: 'c1', agent_id: 30, title: 'x', description: 'x', tag: 'engineering', status: 'in_progress', priority: 50, complexity: 1, max_turns: 1 } as unknown as Task;
  // call design_audit with a metadata IP — should be blocked at the safety layer
  const r = await handleEngineeringTool('design_audit', { url: 'http://169.254.169.254/' }, fakeTask);
  const blocked = /blocked|metadata|reserved|private/i.test(r);
  console.log(`  ${blocked ? '✓' : '✗ FAIL'} metadata IP blocked: "${r.slice(0, 160)}"`);

  console.log('\n=== P0.2: worker-launcher hard timeout calls abortController.abort() ===');
  const wl = readFileSync('src/lib/agents/worker-launcher.ts', 'utf8');
  const hardTimeoutAborts = /setTimeout\(\s*\(\) => \{\s*abortController\.abort\(\);\s*reject\(new Error\(`Task execution timed out/.test(wl);
  console.log(`  ${hardTimeoutAborts ? '✓' : '✗ FAIL'} hard-timeout path calls abort() before reject`);

  console.log('\n=== P1.3: create_instance returns early on Render failure ===');
  const eng = readFileSync('src/lib/agents/tools/engineering.tools.ts', 'utf8');
  const ci = eng.slice(eng.indexOf('async function handleCreateInstance'));
  // Locate the renderFailed branch and check it ends with `return steps.join('\n');`
  const renderFailedBlock = ci.match(/if \(renderFailed\) \{[\s\S]*?\}/);
  const returnsEarly = renderFailedBlock?.[0].includes("return steps.join('\\n')");
  const stillSaysInstanceReady = renderFailedBlock?.[0].includes('Instance ready!');
  console.log(`  ${returnsEarly ? '✓' : '✗ FAIL'} renderFailed branch returns early`);
  console.log(`  ${!stillSaysInstanceReady ? '✓' : '✗ FAIL'} renderFailed branch does NOT claim "Instance ready"`);

  console.log('\n=== P1.4: isUserFacingUiTask classifier covers expanded vocab ===');
  const cases: Array<[string, boolean]> = [
    // existing positives (sanity)
    ['Build landing page', true],
    ['Add chat UI', true],
    // P1.4 additions — the auditor's list
    ['Build admin portal', true],
    ['Create admin panel for users', true],
    ['CRM contact view', true],
    ['Booking form for appointments', true],
    ['Client workspace dashboard', true],
    ['Login screen with email', true],
    ['Add settings page', true],
    ['Account profile page', true],
    ['Build marketing pricing page', true],
    ['Blog post listing', true],
    // negatives
    ['Stripe webhook receiver', false],
    ['Nightly cron job for cleanup', false],
    ['Add migration for new column', false],
    ['Backend-only API endpoint', false],
    ['ETL pipeline', false],
    // edge: backend wins over UI mention
    ['webhook handler with dashboard log', false],
    // bland title — no classification
    ['Fix the thing', false],
  ];
  let pass = 0;
  for (const [title, expected] of cases) {
    const got = isUserFacingUiTask({ title, description: null }, []);
    const ok = got === expected;
    if (ok) pass++;
    console.log(`  ${ok ? '✓' : '✗ FAIL'} "${title}" → ${got} (expected ${expected})`);
  }
  console.log(`  ${pass}/${cases.length} classifier cases pass`);

  console.log('\n=== P1.4: log-signal classification still works ===');
  console.log(`  fork_skeleton signal → UI: ${isUserFacingUiTask({ title: 'Fix the thing' }, [{ tool: 'github_fork_skeleton' }])}`);
  console.log(`  design_audit signal → UI: ${isUserFacingUiTask({ title: 'Fix the thing' }, [{ tool: 'design_audit' }])}`);
  console.log(`  no signal → not UI: ${isUserFacingUiTask({ title: 'Fix the thing' }, [])}`);

  console.log('\n=== P2.3: Codex combines timeout + abort signal ===');
  const factory = readFileSync('src/lib/agents/agent-factory.ts', 'utf8');
  const codexBlock = factory.slice(factory.indexOf('async function runWithCodex('));
  const usesAbortSignalAny = /AbortSignal\.any\(\[codexTimeoutSig, abortSignal\]\)/.test(codexBlock);
  const fallsBackToTimeoutOnly = /: codexTimeoutSig;/.test(codexBlock);
  console.log(`  ${usesAbortSignalAny ? '✓' : '✗ FAIL'} Codex uses AbortSignal.any when parent abort present`);
  console.log(`  ${fallsBackToTimeoutOnly ? '✓' : '✗ FAIL'} Falls back to timeout-only when no parent abort`);

  console.log('\nDone.');
})();
