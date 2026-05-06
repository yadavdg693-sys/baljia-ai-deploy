// Smoke test: hit the real Neon DB and verify both provider-pack handlers
// produce the expected output. Read-only — does not mutate provider_packs.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-provider-packs.ts

import { handleBrowserTool } from '@/lib/agents/tools/browser.tools';

async function main() {
  const task = { id: 'smoke-task', company_id: '00000000-0000-0000-0000-000000000000' } as never;

  // 1. List all packs
  const r1 = await handleBrowserTool('list_provider_packs', {}, task);
  console.log('list (all):\n' + r1 + '\n');
  if (!r1.includes('Available provider packs')) throw new Error('list_provider_packs failed');
  if (!r1.includes('openai')) throw new Error('openai pack missing');
  if (!r1.includes('stripe')) throw new Error('stripe pack missing');

  // 2. List by category
  const r2 = await handleBrowserTool('list_provider_packs', { category: 'llm' }, task);
  console.log('list (llm):\n' + r2 + '\n');
  if (!r2.includes('openai')) throw new Error('llm category should include openai');
  if (r2.includes('stripe')) throw new Error('llm category should NOT include stripe');

  // 3. Start a known pack
  const r3 = await handleBrowserTool('start_provider_pack', { provider_id: 'openai' }, task);
  console.log('start (openai):\n' + r3 + '\n');
  if (!r3.includes('Provider Pack: OpenAI')) throw new Error('start_provider_pack(openai) failed');
  if (!r3.includes('## Steps')) throw new Error('steps section missing');
  if (!r3.includes('OPENAI_API_KEY')) throw new Error('env var missing');

  // 4. Start an unknown pack
  const r4 = await handleBrowserTool('start_provider_pack', { provider_id: 'fakeprovider' }, task);
  console.log('start (fake):\n' + r4 + '\n');
  if (!r4.includes('No provider pack found')) throw new Error('unknown provider should give friendly error');

  console.log('All 4 smoke steps passed.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
