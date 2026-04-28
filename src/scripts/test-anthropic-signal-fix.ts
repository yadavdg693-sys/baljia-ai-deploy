// Verify the SDK signal fix: callAnthropicWithTimeout should now succeed
// instead of throwing "signal: Extra inputs are not permitted".
// Run: npx tsx --env-file=.env.local src/scripts/test-anthropic-signal-fix.ts

import { callAnthropicWithTimeout } from '@/lib/llm-safety';
import { createAnthropicWithOAuth, isAnthropicOAuthAvailable, withClaudeCodeIdentity } from '@/lib/anthropic-oauth';

async function main() {
  if (!isAnthropicOAuthAvailable()) {
    console.error('❌ Claude Code OAuth not available — run `claude login` first');
    process.exit(1);
  }

  const { client, isOAuth } = await createAnthropicWithOAuth();
  const systemPrompt = withClaudeCodeIdentity(
    'You are a test bot. Reply with exactly one word: "ok".',
    isOAuth,
  );

  console.log('Calling Anthropic via callAnthropicWithTimeout...');
  const start = Date.now();
  try {
    const result = await callAnthropicWithTimeout(client, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'ping' }],
    }, { timeoutMs: 30_000, label: 'sdk-signal-fix-test' }) as { content?: Array<{ type: string; text?: string }> };
    const elapsed = Date.now() - start;
    const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
    console.log(`✅ Got response in ${elapsed}ms: "${text.trim()}"`);
    console.log('   Anthropic SDK signal fix verified.');
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Call failed: ${msg}`);
    if (msg.includes('signal: Extra inputs')) {
      console.error('   The signal fix DID NOT take effect. Check llm-safety.ts:173.');
    }
    process.exit(1);
  }
}

main();
