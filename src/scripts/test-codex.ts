// Quick Codex sanity test — verifies OAuth credentials load and a real LLM call succeeds.
// Run: npx tsx src/scripts/test-codex.ts

import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const { loadCodexCredentialsSync, getCodexApiKeySync } = await import('../lib/codex-oauth');
  const { isOpenAIAvailable, getPreferredProvider, callOpenAI } = await import('../lib/llm-provider');

  console.log('━'.repeat(60));
  console.log('  CODEX SANITY CHECK');
  console.log('━'.repeat(60));

  // 1. Credential load
  const creds = loadCodexCredentialsSync();
  if (!creds) {
    console.error('✗ No Codex credentials found at store path');
    process.exit(1);
  }
  const expired = Date.now() >= creds.expires;
  console.log(`✓ creds loaded`);
  console.log(`  email:      ${creds.identity?.email ?? '?'}`);
  console.log(`  plan:       ${creds.identity?.planType ?? '?'}`);
  console.log(`  expires:    ${new Date(creds.expires).toISOString()} ${expired ? '(EXPIRED)' : '(valid)'}`);
  console.log(`  token len:  ${creds.access.length}`);

  // 2. Provider availability check
  const apiKey = getCodexApiKeySync();
  console.log(`\n✓ getCodexApiKeySync():  ${apiKey ? `present (${apiKey.length} chars)` : 'NULL'}`);
  console.log(`✓ isOpenAIAvailable():    ${isOpenAIAvailable()}`);
  console.log(`✓ getPreferredProvider(): ${getPreferredProvider()}`);

  if (expired) {
    console.warn('\n⚠ Token expired — call will likely fail unless auto-refresh runs');
  }

  // 3. Live ping — single short prompt
  console.log('\n→ Calling Codex (gpt-5.4) with a minimal prompt...');
  const start = Date.now();
  try {
    const reply = await callOpenAI({
      systemPrompt: 'You are a sanity-check assistant. Reply with exactly "pong" and nothing else.',
      userPrompt: 'ping',
      maxTokens: 16,
      reasoningEffort: 'none',
      timeoutMs: 30_000,
    });
    const ms = Date.now() - start;
    console.log(`✓ reply (${ms}ms): ${JSON.stringify(reply.slice(0, 200))}`);
    console.log('\n━ CODEX IS WORKING ━');
  } catch (err) {
    const ms = Date.now() - start;
    console.error(`\n✗ Codex call failed after ${ms}ms`);
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
