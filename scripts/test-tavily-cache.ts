// Validates the Redis-backed Tavily cache: run the same query twice, confirm
// the second is from cache and measurably faster.

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { tavilySearchText } from '@/lib/tavily';
import { getRedis } from '@/lib/redis';

// Use a well-known query that Tavily reliably returns content for
const QUERY = 'OpenAI GPT-4 capabilities overview';

async function main() {
  const redis = getRedis();
  console.log('Redis available:', !!redis);

  console.log(`\nQuery: "${QUERY}"`);
  console.log('Running 3 calls back-to-back. Expect: call 1 fresh, call 2 + 3 cached.\n');

  const results: Array<{ call: number; ms: number; bytes: number }> = [];
  for (let i = 1; i <= 3; i++) {
    const t = Date.now();
    const r = await tavilySearchText(QUERY, 3, 'basic');
    results.push({ call: i, ms: Date.now() - t, bytes: r?.length ?? 0 });
    console.log(`Call ${i}: ${results[i - 1].ms}ms, ${results[i - 1].bytes} bytes`);
  }

  const fresh = results[0].ms;
  const cached = Math.max(results[1].ms, results[2].ms);
  console.log(`\nFresh vs cached: ${fresh}ms → ${cached}ms`);

  if (cached < fresh / 3 && results[1].bytes > 0 && results[2].bytes > 0) {
    console.log('✅ Tavily cache confirmed working.');
  } else {
    console.log('⚠️  Cache may not have kicked in on first call — check Redis logs for "Tavily cache SET" and "Tavily cache HIT".');
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
