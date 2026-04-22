// End-to-end test of the REAL production code path:
//   callOpenAI() → detects Codex JWT → callCodex() → pi-ai → chatgpt.com/backend-api
//
// Run: npx tsx scripts/test-codex-real.ts

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  // Dynamic import — env must be loaded before module evaluation
  const { callOpenAI, OPENAI_MODELS, getPreferredProvider, isOpenAIAvailable } = await import('../src/lib/llm-provider');

  console.log('isOpenAIAvailable():', isOpenAIAvailable());
  console.log('Preferred provider:', getPreferredProvider());
  console.log('');

  if (!isOpenAIAvailable()) {
    console.error('FAIL — OpenAI not available. Codex creds may not be loadable.');
    process.exit(1);
  }

  console.log('Calling GPT-5.4 via real callOpenAI() path...\n');

  // Also test the raw pi-ai stream so we can see actual error events
  console.log('--- Raw pi-ai stream test (for debugging) ---');
  try {
    const { getModel, streamSimple } = await import('@mariozechner/pi-ai');
    const fs = await import('fs');
    const cryptoMod = await import('crypto');
    const stored = JSON.parse(fs.readFileSync('data/baljia-openai-codex-oauth.json', 'utf8'));
    const seed = process.env.AUTH_SECRET!;
    const key = cryptoMod.createHash('sha256').update(seed).digest();
    const parts = stored.credentials.access.split('.');
    const iv = Buffer.from(parts[0], 'base64');
    const ciphertext = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const decipher = cryptoMod.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const accessToken = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

    const model = getModel('openai-codex', 'gpt-5.4');
    const stream = streamSimple(model, {
      systemPrompt: undefined,
      messages: [{ role: 'user', content: 'Say PONG', timestamp: Date.now() }],
    }, { apiKey: accessToken, maxTokens: 50, reasoning: 'minimal' });

    for await (const ev of stream) {
      if (ev.type === 'error') {
        console.log('FULL ERROR EVENT:');
        console.log(JSON.stringify(ev, null, 2).slice(0, 2000));
        break;
      }
      console.log('event.type =', ev.type);
      if (ev.type === 'done') break;
    }
  } catch (e) {
    console.log('Raw stream error:', e instanceof Error ? e.message : String(e));
  }
  console.log('--- end raw test ---\n');

  try {
    const reply = await callOpenAI({
      model: OPENAI_MODELS.GPT_5_4_MINI,  // mini = cheaper for test
      userPrompt: 'Reply with exactly the word PONG and nothing else.',
      maxTokens: 50,
      reasoningEffort: 'none',  // mapped to 'minimal' inside callCodex
      timeoutMs: 60_000,
    });
    console.log('Reply:', reply.trim());
    console.log('\nResult: PASS — production path callOpenAI() → Codex works.');
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Result: FAIL —', msg);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Threw:', err instanceof Error ? err.message : err);
  process.exit(1);
});
