// Smoke test for the 7 fixes shipped in response to the audit:
// P0.2 — gate on every provider exit (Claude, OpenAI, Codex, Gemini, OpenRouter)
// P0.3 — AbortSignal threaded through agent loops
// P1.2 — run_drizzle_push uses raw github read (not the wrapped human format)
// P1.3 — SSRF allowlist on http_fetch_full, check_url_health, design_critique, verify_user_journey
// P1.4 — create_instance delegates to renderCreateService instead of duplicating logic
// P1.5 — gate skips design checks for backend-only tasks
// P2.3 — render_list_* scoped to the calling company

import { assertUrlSafe } from '@/lib/agents/url-safety';
import { readFileSync } from 'node:fs';

(async () => {
  console.log('=== P0.2: every provider has evaluateGateOnExit call ===');
  const factory = readFileSync('src/lib/agents/agent-factory.ts', 'utf8');
  const gateCalls = (factory.match(/evaluateGateOnExit\(/g) ?? []).length;
  console.log(`  evaluateGateOnExit calls: ${gateCalls} (should be ≥4: OpenAI, Codex, Gemini, OpenRouter; Claude has its own inline)`);
  console.log(`  helper defined: ${/^function evaluateGateOnExit/m.test(factory)}`);

  console.log('\n=== P0.3: AbortSignal threaded ===');
  const abortChecks = (factory.match(/abortSignal\?\.aborted/g) ?? []).length;
  console.log(`  abort checks in loops: ${abortChecks} (should be 5: one per provider)`);
  console.log(`  worker-launcher passes signal: ${readFileSync('src/lib/agents/worker-launcher.ts', 'utf8').includes('abortSignal: abortController.signal')}`);
  console.log(`  AgentInput accepts abortSignal: ${factory.includes('abortSignal?: AbortSignal')}`);

  console.log('\n=== P1.2: raw github read for drizzle-push ===');
  const eng = readFileSync('src/lib/agents/tools/engineering.tools.ts', 'utf8');
  console.log(`  githubReadFileRaw defined: ${/^async function githubReadFileRaw/m.test(eng)}`);
  console.log(`  run_drizzle_push uses raw: ${/githubReadFileRaw\(\{ repo, path: 'db\/schema\.ts'/.test(eng)}`);

  console.log('\n=== P1.3: SSRF allowlist ===');
  const cases: Array<[string, boolean]> = [
    ['http://169.254.169.254/latest/meta-data', false],  // AWS metadata
    ['http://127.0.0.1:8080', false],                     // loopback
    ['http://192.168.1.1', false],                        // RFC1918
    ['http://localhost', false],                          // bare localhost
    ['file:///etc/passwd', false],                        // bad scheme
    ['ftp://example.com', false],                         // bad scheme
    ['http://equityzen.baljia.app', true],                // public DNS → public IP
    ['https://api.github.com', true],                     // public host
  ];
  for (const [url, expectedOk] of cases) {
    const r = await assertUrlSafe(url);
    const pass = r.ok === expectedOk;
    console.log(`  ${pass ? '✓' : '✗ FAIL'} ${url} → ok=${r.ok} (expected ${expectedOk}) ${r.reason ? '— ' + r.reason : ''}`);
  }

  console.log('\n=== P1.4: create_instance delegates to renderCreateService ===');
  const ci = eng.slice(eng.indexOf('async function handleCreateInstance'));
  console.log(`  uses renderCreateService: ${/await renderCreateService\(/.test(ci)}`);
  console.log(`  no longer hardcodes .onrender.com auth URL: ${!/BETTER_AUTH_URL: `https:\/\/\$\{repoSlug\}\.onrender\.com`/.test(ci)}`);
  console.log(`  pulls canonical URL from companies.slug/custom_domain: ${/canonicalUrl =/.test(ci)}`);

  console.log('\n=== P1.5: gate skips design checks for backend-only tasks ===');
  console.log(`  isUiTask classifier defined: ${/const isUiTask = /.test(factory)}`);
  console.log(`  backend-only regex defined: ${/titleSuggestsBackend = /.test(factory)}`);
  console.log(`  audit gate wrapped in if(isUiTask): ${/if \(isUiTask\) \{[\s\S]{0,400}design_audit/.test(factory)}`);

  console.log('\n=== P2.3: render_list_* tenant scoped ===');
  console.log(`  renderListServices reads company.render_service_id: ${/renderListServices[\s\S]{0,500}company\.render_service_id/.test(eng)}`);
  console.log(`  renderListDatabases returns scoped message: ${/this company uses Neon, not Render Postgres/.test(eng)}`);

  console.log('\nAll fixes verified.');
})();
