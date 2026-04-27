// Smoke test: confirm Claude Code OAuth credentials authenticate against
// api.anthropic.com end-to-end. Sends a 1-token completion via the OAuth path
// and prints the response.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-anthropic-oauth.ts

import {
  isAnthropicOAuthAvailable,
  getAnthropicOAuthToken,
  createAnthropicWithOAuth,
} from '@/lib/anthropic-oauth';

async function main() {
  console.log('1. Credentials file present?      ', isAnthropicOAuthAvailable());

  if (!isAnthropicOAuthAvailable()) {
    console.error('No Claude Code OAuth credentials found. Run `claude login` first.');
    process.exit(1);
  }

  const token = await getAnthropicOAuthToken();
  if (!token) {
    console.error('Could not obtain access token.');
    process.exit(1);
  }
  console.log('2. Access token obtained:         ', token.slice(0, 20) + '…');

  const { client, isOAuth } = createAnthropicWithOAuth();
  console.log('3. Client created with isOAuth:   ', isOAuth);
  console.log('4. Calling claude-sonnet-4-20250514 …');

  const { withClaudeCodeIdentity } = await import('@/lib/anthropic-oauth');
  const t0 = Date.now();
  const res = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 30,
    system: withClaudeCodeIdentity('You are a smoke-test assistant. Be terse.', isOAuth) as string,
    messages: [
      {
        role: 'user',
        content: 'Reply with exactly: PONG',
      },
    ],
  });
  const ms = Date.now() - t0;

  const block = res.content[0];
  const text = block.type === 'text' ? block.text : '(non-text response)';
  console.log(`4. Response (${ms}ms):              ${text.trim()}`);
  console.log(`5. Stop reason:                    ${res.stop_reason}`);
  console.log(`6. Usage: in=${res.usage.input_tokens} out=${res.usage.output_tokens}`);

  console.log('\n✅ Anthropic OAuth path is working end-to-end.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Smoke test failed:', err instanceof Error ? err.message : err);
  if (err instanceof Error && 'status' in err) {
    console.error('   HTTP status:', (err as Error & { status: number }).status);
  }
  process.exit(1);
});
