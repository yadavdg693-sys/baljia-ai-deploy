// Direct fetch test against Bedrock — bypasses the Anthropic SDK to see
// whether the key itself is valid or the SDK is dropping the auth header.
// Run: npx tsx scripts/test-bedrock-raw.ts

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const apiKey = process.env.AWS_BEDROCK_API_KEY!;
  const region = process.env.AWS_BEDROCK_REGION || 'us-east-1';
  const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-20250514-v1:0';

  console.log('Testing raw fetch with Bearer auth...\n');

  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;
  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 50,
    messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body,
  });

  const text = await res.text();
  console.log('HTTP', res.status, res.statusText);
  console.log('Body:', text.substring(0, 800));

  if (res.ok) {
    const json = JSON.parse(text) as { content: Array<{ type: string; text?: string }> };
    const reply = json.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    console.log('\nReply:', reply);
    console.log('\nResult: PASS — Bedrock API key works via raw Bearer.');
    process.exit(0);
  }
  console.log('\nResult: FAIL');
  process.exit(1);
}

main().catch((err) => {
  console.error('Threw:', err instanceof Error ? err.message : err);
  process.exit(1);
});
