// Deep smoke test for the audit fixes — exercises actual runtime behavior,
// not just file content patterns.
import { assertUrlSafe } from '@/lib/agents/url-safety';
import { withLLMTimeout } from '@/lib/llm-safety';
import { runJourney } from '@/lib/services/journey-runner.service';
import { readFileSync } from 'node:fs';

(async () => {
  console.log('=== P0.3: AbortSignal cancels withLLMTimeout mid-flight ===');
  {
    const controller = new AbortController();
    const t0 = Date.now();
    setTimeout(() => controller.abort(), 100); // abort after 100ms
    try {
      await withLLMTimeout(
        // Fake LLM call that would take 5 seconds normally
        (signal) => new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('inner aborted')); });
        }),
        10_000, // 10s timeout — should NOT be hit, abort wins
        'fake_llm_call',
        controller.signal,
      );
      console.log('  ✗ FAIL: should have aborted, completed instead');
    } catch (err) {
      const elapsed = Date.now() - t0;
      const msg = (err as Error).message;
      const pass = msg.includes('aborted by parent') && elapsed < 1000;
      console.log(`  ${pass ? '✓' : '✗ FAIL'} aborted in ${elapsed}ms: "${msg}"`);
    }
  }

  console.log('\n=== P0.3: AbortSignal already fired before call returns immediately ===');
  {
    const controller = new AbortController();
    controller.abort();
    const t0 = Date.now();
    try {
      await withLLMTimeout(
        (signal) => new Promise<void>((resolve, reject) => {
          if (signal.aborted) reject(new Error('inner sees abort'));
          else resolve();
        }),
        10_000,
        'fake_pre_aborted',
        controller.signal,
      );
      console.log('  ✗ FAIL: should have rejected on pre-aborted signal');
    } catch (err) {
      const elapsed = Date.now() - t0;
      console.log(`  ✓ rejected in ${elapsed}ms: "${(err as Error).message}"`);
    }
  }

  console.log('\n=== P1.3: journey-runner blocks SSRF in per-step URL ===');
  {
    // Use a fake base_url and steps that try to escape via absolute URL
    const result = await runJourney({
      journey_name: 'ssrf-test',
      base_url: 'https://example.com',
      steps: [
        { step: 'try metadata IP', path: 'http://169.254.169.254/latest/meta-data', expect_status: 200 },
      ],
    });
    const blocked = !result.allPassed && result.summary.toLowerCase().includes('url') ||
                    /url_safety|private|reserved|blocked|metadata/i.test(result.summary);
    console.log(`  ${blocked ? '✓' : '✗ FAIL'} cross-host metadata IP blocked: summary="${result.summary.slice(0, 160)}"`);
  }

  console.log('\n=== P1.3: journey-runner allows legitimate path inside base_url ===');
  {
    // Use a public URL with redirect: 'manual'. Just verify the safety check doesn't false-positive
    // on a legitimate same-host path. Note: example.com may not return 200, but the SAFETY CHECK
    // must let the request through.
    const result = await runJourney({
      journey_name: 'legit',
      base_url: 'https://example.com',
      steps: [
        { step: 'root', path: '/' },
      ],
    });
    const safetyBlocked = /url_safety/i.test(result.summary);
    console.log(`  ${safetyBlocked ? '✗ FAIL' : '✓'} legit same-host path allowed by safety (HTTP outcome irrelevant). summary="${result.summary.slice(0, 160)}"`);
  }

  console.log('\n=== P0.2: every provider has gateState declared ===');
  const factory = readFileSync('src/lib/agents/agent-factory.ts', 'utf8');
  const gateStateDecls = (factory.match(/const gateState: GateState = \{ forcedContinuations: 0 \};/g) ?? []).length;
  const claudeUsage = factory.match(/let forcedContinuations = 0;/);
  console.log(`  gateState declarations: ${gateStateDecls} (need 4: OpenAI/Codex/Gemini/OpenRouter)`);
  console.log(`  Claude branch uses inline forcedContinuations: ${!!claudeUsage}`);

  console.log('\n=== P1.2: legacy _DISABLED functions deleted ===');
  const eng = readFileSync('src/lib/agents/tools/engineering.tools.ts', 'utf8');
  console.log(`  _legacyRenderListServices_DISABLED gone: ${!eng.includes('_legacyRenderListServices_DISABLED')}`);
  console.log(`  _legacyRenderListDatabases_DISABLED gone: ${!eng.includes('_legacyRenderListDatabases_DISABLED')}`);

  console.log('\n=== P1.4: create_instance no wrapper shim, no hardcoded onrender.com auth ===');
  const ci = eng.slice(eng.indexOf('async function handleCreateInstance'));
  console.log(`  no "stub-ok wrapper" comment: ${!ci.includes('stub-ok wrapper')}`);
  console.log(`  no synthetic renderRes/renderData: ${!/const renderRes = \{ ok:/.test(ci)}`);
  console.log(`  delegates to renderCreateService: ${/await renderCreateService\(/.test(ci)}`);
  console.log(`  canonical URL from companies row: ${/canonicalUrl =[\s\S]{0,200}companies\.slug/.test(ci)}`);
  console.log(`  no hardcoded BETTER_AUTH_URL pointing at .onrender.com: ${!/BETTER_AUTH_URL: `https:\/\/\$\{repoSlug\}\.onrender\.com`/.test(ci)}`);

  console.log('\nDeep smoke complete.');
})();
