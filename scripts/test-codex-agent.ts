// Tests the full Codex agent loop with tools — the path workers will take.
// Verifies: Codex calls a tool → we execute it → push result → Codex responds with text.
// Run: npx tsx scripts/test-codex-agent.ts

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const { runCodexAgentTurn, getOpenAIApiKeyAsync } = await import('../src/lib/llm-provider');

  const apiKey = await getOpenAIApiKeyAsync();
  if (!apiKey) {
    console.error('FAIL — no OpenAI/Codex API key resolved');
    process.exit(1);
  }
  console.log('Resolved key prefix:', apiKey.substring(0, 8), 'len:', apiKey.length, '\n');

  // Define a single tool the agent must call
  const tools = [
    {
      name: 'get_current_time',
      description: 'Returns the current UTC time as an ISO 8601 string.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
  ];

  const messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_name?: string; raw?: unknown }> = [
    { role: 'user', content: 'What time is it right now? Use the available tool.' },
  ];

  console.log('--- Turn 1: expect agent to call get_current_time ---');
  const turn1 = await runCodexAgentTurn({
    apiKey,
    systemPrompt: 'You are a precise assistant. When the user asks for time, call the get_current_time tool.',
    messages,
    tools,
    maxTokens: 1024,
    reasoning: 'low',
  });

  console.log('Text:', turn1.text || '(none)');
  console.log('Tool calls:', turn1.toolCalls.length);
  console.log('Stop reason:', turn1.stopReason);
  console.log('Usage:', turn1.usage);

  if (turn1.toolCalls.length === 0) {
    console.error('\nFAIL — agent did not call the tool');
    process.exit(1);
  }

  for (const tc of turn1.toolCalls) {
    console.log(`  Tool: ${tc.name} args=${JSON.stringify(tc.arguments)}`);
  }

  // Simulate executing the tool. CRITICAL: push the raw assistant message
  // (with embedded toolCalls) before the tool result, otherwise Codex returns:
  //   "No tool call found for function call output with call_id ..."
  const fakeToolResult = new Date().toISOString();
  const tc = turn1.toolCalls[0];
  messages.push({ role: 'assistant', content: turn1.text, raw: turn1.rawAssistantMessage });
  messages.push({
    role: 'tool',
    content: fakeToolResult,
    tool_call_id: tc.id,
    tool_name: tc.name,
  });

  console.log('\n--- Turn 2: pushed tool result, expect natural-language reply ---');
  const turn2 = await runCodexAgentTurn({
    apiKey,
    systemPrompt: 'You are a precise assistant. When the user asks for time, call the get_current_time tool.',
    messages,
    tools,
    maxTokens: 256,
    reasoning: 'low',
  });

  console.log('Text:', turn2.text);
  console.log('Tool calls:', turn2.toolCalls.length);
  console.log('Stop reason:', turn2.stopReason);

  if (turn2.text.includes(fakeToolResult.substring(0, 10)) || turn2.text.toLowerCase().includes('time')) {
    console.log('\nResult: PASS — full agent-with-tools loop works on Codex.');
    process.exit(0);
  }
  console.log('\nResult: WARN — text response did not echo tool result clearly, but loop completed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Threw:', err instanceof Error ? err.message : err);
  process.exit(1);
});
