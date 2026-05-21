// Smoke test for round-3 audit fixes.
import { readFileSync } from 'node:fs';

(async () => {
  console.log('=== TEST: url-safety fails open on DNS failure ===');
  const { assertUrlSafe } = await import('@/lib/agents/url-safety');
  // Use a hostname that definitely doesn't resolve
  const r = await assertUrlSafe('http://this-host-definitely-does-not-exist-12345.example.invalid/');
  console.log(`  ${r.ok ? '✓' : '✗ FAIL'} unresolvable host passes (fetch will fail naturally)`);

  console.log('\n=== TEST: watchdog history size > polling threshold ===');
  const watchdog = readFileSync('src/lib/agents/watchdog.ts', 'utf8');
  const historySize = parseInt(watchdog.match(/TOOL_HISTORY_SIZE = (\d+)/)?.[1] ?? '0');
  const pollingThreshold = parseInt(watchdog.match(/POLLING_LOOP_THRESHOLD = (\d+)/)?.[1] ?? '0');
  console.log(`  TOOL_HISTORY_SIZE=${historySize}, POLLING_LOOP_THRESHOLD=${pollingThreshold}`);
  console.log(`  ${historySize >= pollingThreshold ? '✓' : '✗ FAIL'} history is large enough for polling threshold to be reachable`);

  console.log('\n=== TEST: verifier has gate-exhaustion + design checks ===');
  const verifier = readFileSync('src/lib/services/verification.service.ts', 'utf8');
  console.log(`  ${verifier.includes('completion_gate_exhausted') ? '✓' : '✗ FAIL'} verifier recognizes completion_gate_exhausted event`);
  console.log(`  ${verifier.includes('completion_gate_resolved') ? '✓' : '✗ FAIL'} verifier emits completion_gate_resolved check`);
  console.log(`  ${verifier.includes('deploy_logs_clean') ? '✓' : '✗ FAIL'} verifier checks render_get_logs for errors`);
  console.log(`  ${verifier.includes('design_audit_clean') ? '✓' : '✗ FAIL'} verifier checks design_audit on UI tasks`);
  console.log(`  ${verifier.includes('design_critique_clean') ? '✓' : '✗ FAIL'} verifier checks design_critique on UI tasks (when Gemini configured)`);

  console.log('\n=== TEST: create_instance in DEPLOY_TOOL_NAMES ===');
  const deployBlock = verifier.match(/const DEPLOY_TOOL_NAMES = new Set\(\[[\s\S]*?\]\)/)?.[0] ?? '';
  console.log(`  ${deployBlock.includes("'create_instance'") ? '✓' : '✗ FAIL'} create_instance counted as deploy evidence`);

  console.log('\n=== TEST: review_pushed_code uses task execution log for base SHA ===');
  const eng = readFileSync('src/lib/agents/tools/engineering.tools.ts', 'utf8');
  const reviewBlock = eng.match(/async function handleReviewPushedCode[\s\S]*?\n\}/)?.[0] ?? '';
  console.log(`  ${reviewBlock.includes('taskId') ? '✓' : '✗ FAIL'} handler accepts taskId`);
  console.log(`  ${reviewBlock.includes('execution_log') ? '✓' : '✗ FAIL'} handler reads task_executions.execution_log`);
  console.log(`  ${reviewBlock.includes('first commit') || reviewBlock.includes('firstCommitSha') ? '✓' : '✗ FAIL'} handler computes base from first commit of run`);
  console.log(`  ${reviewBlock.includes('Fallback: latest commit') ? '✓' : '✗ FAIL'} handler falls back to latest~1 when log unavailable`);

  console.log('\n=== TEST: static_code_scan prioritizes security-critical files ===');
  const scanBlock = eng.match(/Pull JS\/TS source files[\s\S]*?\.slice\(0, 30\)/)?.[0] ?? '';
  console.log(`  ${scanBlock.includes('priorityFor') ? '✓' : '✗ FAIL'} scanner has priority scoring function`);
  console.log(`  ${scanBlock.includes('middleware') ? '✓' : '✗ FAIL'} prioritizes middleware`);
  console.log(`  ${scanBlock.includes('auth') ? '✓' : '✗ FAIL'} prioritizes auth paths`);
  console.log(`  ${scanBlock.includes('db/schema') ? '✓' : '✗ FAIL'} prioritizes db/schema`);
  console.log(`  ${scanBlock.includes('app/api') || scanBlock.includes('app\\\\/api') ? '✓' : '✗ FAIL'} prioritizes API routes`);
  console.log(`  ${scanBlock.includes('webhook') ? '✓' : '✗ FAIL'} prioritizes webhooks`);

  console.log('\n=== TEST: design_audit has SSRF guard ===');
  const auditBlock = eng.match(/async function designAudit[\s\S]*?\n\}/)?.[0] ?? '';
  console.log(`  ${auditBlock.includes('assertUrlSafe') ? '✓' : '✗ FAIL'} design_audit calls assertUrlSafe`);

  console.log('\n=== TEST: worker-launcher hard timeout calls abort ===');
  const wl = readFileSync('src/lib/agents/worker-launcher.ts', 'utf8');
  console.log(`  ${/abortController\.abort\(\);\s*reject\(new Error\(`Task execution timed out/.test(wl) ? '✓' : '✗ FAIL'} hard-timeout path calls abort()`);

  console.log('\n=== TEST: create_instance returns early on Render failure ===');
  const ciBlock = eng.match(/async function handleCreateInstance[\s\S]*?\n^}/m)?.[0] ?? '';
  const failedBranch = ciBlock.match(/if \(renderFailed\) \{[\s\S]*?return steps\.join\('\\n'\);[\s\S]*?\} else/)?.[0] ?? '';
  console.log(`  ${failedBranch.length > 0 ? '✓' : '✗ FAIL'} renderFailed branch returns early before "Instance ready" banner`);
  console.log(`  ${!failedBranch.includes('Instance ready!') ? '✓' : '✗ FAIL'} renderFailed branch does NOT claim "Instance ready"`);

  console.log('\nDone.');
})();
