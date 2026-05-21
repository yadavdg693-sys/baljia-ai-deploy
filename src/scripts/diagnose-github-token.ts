// Diagnose the GITHUB_TOKEN against the endpoints the platform actually uses.
// Helps distinguish "token expired" from "token valid but missing /user scope"
// (a common pitfall with fine-grained PATs).
//
// Usage: npx tsx --env-file=.env.local src/scripts/diagnose-github-token.ts

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

const GITHUB_API = 'https://api.github.com';

async function probe(label: string, url: string, token: string): Promise<void> {
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(8_000),
    });
    const expiry = res.headers.get('github-authentication-token-expiration') ?? null;
    const scopes = res.headers.get('x-oauth-scopes') ?? null;
    let bodyHint = '';
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      bodyHint = ` | body: ${text.slice(0, 140)}`;
    }
    console.log(`${label.padEnd(28)} → HTTP ${res.status}${bodyHint}`);
    if (expiry) console.log(`${''.padEnd(28)}    expires: ${expiry}`);
    if (scopes) console.log(`${''.padEnd(28)}    classic scopes: ${scopes}`);
  } catch (e) {
    console.log(`${label.padEnd(28)} → THREW: ${e instanceof Error ? e.message : String(e)}`);
  }
}

void (async () => {
  const token = process.env.GITHUB_TOKEN;
  const org = process.env.GITHUB_ORG;
  if (!token) { console.log('GITHUB_TOKEN missing'); process.exit(1); }
  if (!org)   { console.log('GITHUB_ORG missing');   process.exit(1); }

  console.log(`Token length: ${token.length} | Org: ${org}\n`);

  // 1. /user — the platform's preflight. Fine-grained PATs need
  //    "Read access to user metadata" or this returns 401.
  await probe('GET /user', `${GITHUB_API}/user`, token);

  // 2. /orgs/{org} — proves the token can see the org. Fine-grained PATs
  //    targeting the org will be authorized here.
  await probe(`GET /orgs/${org}`, `${GITHUB_API}/orgs/${org}`, token);

  // 3. /orgs/{org}/repos (HEAD via list) — closest to the actual provisioning
  //    operation without creating anything.
  await probe(`GET /orgs/${org}/repos`, `${GITHUB_API}/orgs/${org}/repos?per_page=1`, token);

  // 4. Look at one of the previously-provisioned repos.
  await probe(`GET ${org}/threadmint`, `${GITHUB_API}/repos/${org}/threadmint`, token);

  console.log(`\nInterpretation:`);
  console.log(`  /user 401 + /orgs 200          → fine-grained PAT missing "user metadata: read".`);
  console.log(`                                    Easiest fix: patch preflight or grant the scope.`);
  console.log(`  /user 401 + /orgs 401          → token genuinely invalid/expired/revoked. Rotate.`);
  console.log(`  /user 200 + /orgs 200          → token healthy; the earlier 401 was a fluke.`);
  console.log(`  THREW on all                   → network/DNS issue, not auth.`);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
