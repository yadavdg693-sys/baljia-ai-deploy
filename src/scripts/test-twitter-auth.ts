// Twitter auth smoke test — verifies all 4 OAuth 1.0a creds are correct.
// Calls GET /2/users/me (read-only) — no tweet is posted.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-twitter-auth.ts

import { createHmac, randomBytes } from 'crypto';

const apiKey = process.env.TWITTER_API_KEY;
const apiSecret = process.env.TWITTER_API_SECRET;
const accessToken = process.env.TWITTER_ACCESS_TOKEN;
const accessSecret = process.env.TWITTER_ACCESS_SECRET;

if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
  console.error('Missing one or more TWITTER_* env vars');
  process.exit(1);
}

function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

async function signedGet(url: string): Promise<{ status: number; body: string }> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: apiKey!,
    oauth_token: accessToken!,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_version: '1.0',
  };

  // Build signature base string
  const params = Object.entries(oauth)
    .map(([k, v]) => [pctEncode(k), pctEncode(v)] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const baseString = ['GET', pctEncode(url), pctEncode(params)].join('&');
  const signingKey = `${pctEncode(apiSecret!)}&${pctEncode(accessSecret!)}`;
  const signature = createHmac('sha1', signingKey).update(baseString).digest('base64');

  oauth.oauth_signature = signature;
  const authHeader =
    'OAuth ' +
    Object.entries(oauth)
      .map(([k, v]) => `${pctEncode(k)}="${pctEncode(v)}"`)
      .join(', ');

  const response = await fetch(url, { method: 'GET', headers: { Authorization: authHeader } });
  return { status: response.status, body: await response.text() };
}

(async () => {
  console.log('Testing Twitter OAuth 1.0a credentials...');
  console.log(`  API Key:       ${apiKey!.substring(0, 8)}...${apiKey!.substring(apiKey!.length - 4)}`);
  console.log(`  Access Token:  ${accessToken!.substring(0, 12)}...${accessToken!.substring(accessToken!.length - 4)}`);
  console.log('');

  const result = await signedGet('https://api.twitter.com/2/users/me');
  console.log(`HTTP ${result.status}`);
  console.log(result.body.substring(0, 500));

  if (result.status === 200) {
    const data = JSON.parse(result.body) as { data?: { id?: string; name?: string; username?: string } };
    console.log('');
    console.log(`✓ AUTHENTICATED as @${data.data?.username} (${data.data?.name})`);
    console.log(`  user_id: ${data.data?.id}`);
    process.exit(0);
  } else {
    console.error('');
    console.error(`✗ AUTH FAILED — HTTP ${result.status}`);
    process.exit(1);
  }
})();
