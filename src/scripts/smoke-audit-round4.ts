// Verify the 3 round-4 audit fixes.
import { readFileSync } from 'node:fs';

(async () => {
  console.log('=== Fix 1: deploy_logs_clean fires on deploy-only paths ===');
  const verifier = readFileSync('src/lib/services/verification.service.ts', 'utf8');
  const usesUnifiedGate = /deployWasTriggered = deployCalls\.length > 0 \|\| githubCommits\.length > 0/.test(verifier);
  const detailMentionsDeployTrigger = /No deploy triggered in this task/.test(verifier);
  const detailMentionsCreateInstance = /create_instance \/ render_create_service \/ render_deploy/.test(verifier);
  console.log(`  ${usesUnifiedGate ? '✓' : '✗ FAIL'} log check gated on deployCalls OR githubCommits`);
  console.log(`  ${detailMentionsDeployTrigger ? '✓' : '✗ FAIL'} fallback detail says "no deploy triggered"`);
  console.log(`  ${detailMentionsCreateInstance ? '✓' : '✗ FAIL'} missing-logs message lists create_instance among triggering tools`);

  console.log('\n=== Fix 2: github_push_file returns commit SHA ===');
  const eng = readFileSync('src/lib/agents/tools/engineering.tools.ts', 'utf8');
  const pushBlock = eng.match(/async function githubPushFile[\s\S]*?\n\}/)?.[0] ?? '';
  console.log(`  ${/data\.commit\?\.sha/.test(pushBlock) ? '✓' : '✗ FAIL'} extracts data.commit.sha from response`);
  console.log(`  ${/Commit: \$\{commitSha\}/.test(pushBlock) ? '✓' : '✗ FAIL'} formats Commit: <sha> in result string`);
  // The walker's regex is Commit:?\s*([0-9a-f]{7,40}) — verify the format is compatible
  const sampleSha = 'a1b2c3d4e5f67890abcdef1234567890abcdef12';
  const sampleResult = `File created: foo.ts in BALAJIapps/x\nCommit: ${sampleSha}\nURL: https://github.com/...`;
  const walkerRe = /Commit:?\s*([0-9a-f]{7,40})/i;
  const m = sampleResult.match(walkerRe);
  console.log(`  ${m?.[1] === sampleSha ? '✓' : '✗ FAIL'} multi-commit walker regex extracts the SHA from the new format`);

  console.log('\n=== Fix 3: verifier preserves reason field ===');
  const mapBlock = verifier.match(/return log[\s\S]*?\.filter\(\(e\) => e\.tool \|\| e\.event\);/)?.[0] ?? '';
  console.log(`  ${/reason: typeof e\.reason === 'string' \? e\.reason : undefined/.test(mapBlock) ? '✓' : '✗ FAIL'} log mapping preserves reason field`);
  const returnTypeBlock = verifier.match(/async function getExecutionToolCalls[\s\S]*?Promise<Array<\{[\s\S]*?\}>>/)?.[0] ?? '';
  console.log(`  ${/reason\?:\s*string;?/.test(returnTypeBlock) ? '✓' : '✗ FAIL'} return type declares reason?: string`);

  console.log('\nDone.');
})();
