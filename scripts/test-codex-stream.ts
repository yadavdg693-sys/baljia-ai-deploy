// Verifies the streaming Codex helper used by CEO chat.
// Run: npx tsx scripts/test-codex-stream.ts

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const { streamCodexAgentTurn, getOpenAIApiKeyAsync } = await import('../src/lib/llm-provider');

  const apiKey = await getOpenAIApiKeyAsync();
  if (!apiKey) {
    console.error('FAIL — no Codex key resolved');
    process.exit(1);
  }

  console.log('Streaming response token-by-token:\n');
  process.stdout.write('  >>> ');

  let textChunks = 0;
  let thinkingChunks = 0;
  let finalText = '';

  const stream = streamCodexAgentTurn({
    apiKey,
    systemPrompt: 'You are a concise assistant.',
    messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
    tools: [],
    maxTokens: 100,
    reasoning: 'low',
  });

  for await (const event of stream) {
    if (event.type === 'text_delta') {
      process.stdout.write(event.delta);
      textChunks++;
    } else if (event.type === 'thinking_delta') {
      thinkingChunks++;
    } else if (event.type === 'done') {
      finalText = event.text;
    }
  }

  console.log('\n\n--- summary ---');
  console.log('Text chunks streamed:', textChunks);
  console.log('Thinking chunks streamed:', thinkingChunks);
  console.log('Final text length:', finalText.length);

  if (textChunks > 0 && finalText.length > 0) {
    console.log('\nResult: PASS — streaming works.');
    process.exit(0);
  }
  console.log('\nResult: FAIL — no text streamed.');
  process.exit(1);
}

main().catch((err) => {
  console.error('Threw:', err instanceof Error ? err.message : err);
  process.exit(1);
});
