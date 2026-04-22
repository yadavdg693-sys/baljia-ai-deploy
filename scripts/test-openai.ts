// Verifies the OpenAI/Codex primary path actually works.
// Bypasses the broken @mariozechner/pi-ai/oauth import — decrypts the stored
// access token directly and makes a real GPT-5.4 call.
//
// Run: npx tsx scripts/test-openai.ts

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function decryptSecret(payload: string): string {
  const seed = process.env.AUTH_SECRET;
  if (!seed) throw new Error('AUTH_SECRET missing');
  const key = crypto.createHash('sha256').update(seed).digest();

  let iv: Buffer, ciphertext: Buffer, tag: Buffer;
  if (payload.trimStart().startsWith('{')) {
    const parsed = JSON.parse(payload) as { iv: string; tag: string; value: string };
    iv = Buffer.from(parsed.iv, 'base64');
    tag = Buffer.from(parsed.tag, 'base64');
    ciphertext = Buffer.from(parsed.value, 'base64');
  } else {
    const parts = payload.split('.');
    if (parts.length !== 3) throw new Error(`legacy format wants 3 parts, got ${parts.length}`);
    iv = Buffer.from(parts[0], 'base64');
    ciphertext = Buffer.from(parts[1], 'base64');
    tag = Buffer.from(parts[2], 'base64');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

async function main() {
  const credPath = 'data/baljia-openai-codex-oauth.json';
  console.log('Codex credentials file:', fs.existsSync(credPath) ? 'present' : 'MISSING');
  if (!fs.existsSync(credPath)) {
    console.error('FAIL — no credentials at', credPath);
    process.exit(1);
  }

  const stored = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  console.log('Account:', stored.identity.email, '(plan:', stored.identity.planType + ')');

  const expiresMs = stored.credentials.expires;
  const minsLeft = Math.round((expiresMs - Date.now()) / 60_000);
  console.log('Token expires in:', minsLeft, 'minutes');
  if (minsLeft < 0) {
    console.error('FAIL — token expired. Refresh requires the broken @mariozechner/pi-ai/oauth import.');
    process.exit(1);
  }

  let accessToken: string;
  try {
    accessToken = decryptSecret(stored.credentials.access);
    console.log('Decrypt: OK, token prefix:', accessToken.substring(0, 12), 'len:', accessToken.length);
  } catch (err) {
    console.error('FAIL — decrypt failed (AUTH_SECRET wrong?):', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log('\nCalling GPT-5.4...');

  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
        max_tokens: 20,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    console.log('HTTP', res.status);
    if (!res.ok) {
      console.error('Body:', text.substring(0, 500));
      console.error('\nResult: FAIL');
      process.exit(1);
    }
    const json = JSON.parse(text) as { choices: Array<{ message: { content: string } }>; model?: string; usage?: { total_tokens: number } };
    console.log('Model returned:', json.model);
    console.log('Reply:', json.choices[0]?.message?.content?.trim());
    console.log('Tokens used:', json.usage?.total_tokens);
    console.log('\nResult: PASS — OpenAI primary path works.');
    process.exit(0);
  } catch (err) {
    console.error('Request threw:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
