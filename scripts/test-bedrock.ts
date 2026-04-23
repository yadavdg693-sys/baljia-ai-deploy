// Verifies AWS Bedrock works with the same code path the CEO agent uses.
// Replicates ceo.agent.ts:72-84 — Bearer-auth long-term API key (ABSK... format).
// Run: npx tsx scripts/test-bedrock.ts

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const apiKey = process.env.AWS_BEDROCK_API_KEY;
  const region = process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1';
  const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-20250514-v1:0';

  console.log('AWS_BEDROCK_API_KEY present:', !!apiKey);
  console.log('Key prefix:', apiKey?.substring(0, 8));
  console.log('Key length:', apiKey?.length);
  console.log('Region:', region);
  console.log('Model:', modelId);
  console.log('');

  if (!apiKey) {
    console.error('FAIL — AWS_BEDROCK_API_KEY not set');
    process.exit(1);
  }
  if (!apiKey.startsWith('ABSK')) {
    console.error(`FAIL — Bedrock long-term keys start with "ABSK", got "${apiKey.substring(0, 4)}"`);
    process.exit(1);
  }

  // Match the exact client construction from ceo.agent.ts
  const AnthropicBedrock = (await import('@anthropic-ai/bedrock-sdk')).default;
  const client = new AnthropicBedrock({
    awsRegion: region,
    baseURL: `https://bedrock-runtime.${region}.amazonaws.com`,
    defaultHeaders: { Authorization: `Bearer ${apiKey}` },
    skipAuth: true,
  });

  console.log('Sending test message to Bedrock...\n');

  try {
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    console.log('Response:', text);
    console.log('Stop reason:', response.stop_reason);
    console.log('Tokens — input:', response.usage.input_tokens, 'output:', response.usage.output_tokens);
    console.log('\nResult: PASS — Bedrock + Sonnet 4 reachable, agent path works.');
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    console.error('Result: FAIL — Bedrock call rejected');
    console.error('Status:', status ?? '(none)');
    console.error('Error:', msg);
    if (status === 403) console.error('\nLikely cause: API key invalid, expired, or no Bedrock access in this region.');
    if (status === 400 && msg.includes('model')) console.error('\nLikely cause: Sonnet 4 model not enabled on this AWS account. Enable it in Bedrock console → Model access.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test threw:', err instanceof Error ? err.message : err);
  process.exit(1);
});
