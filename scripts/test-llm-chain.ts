// What does the live LLM provider chain actually return?
// Run: npx tsx scripts/test-llm-chain.ts

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const llm = await import('../src/lib/llm-provider');

  console.log('isOpenAIAvailable() :', llm.isOpenAIAvailable());
  console.log('isAnthropicAvailable():', llm.isAnthropicAvailable());
  console.log('  isDirectAnthropic    :', llm.isDirectAnthropicAvailable());
  console.log('  isBedrock            :', llm.isBedrockAvailable());
  console.log('isOpenRouterAvailable():', llm.isOpenRouterAvailable());
  console.log('isGeminiAvailable()  :', llm.isGeminiAvailable());
  console.log('');
  console.log('getPreferredProvider():', llm.getPreferredProvider());
}

main().catch(e => { console.error('THREW:', e); process.exit(1); });
