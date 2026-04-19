#!/usr/bin/env npx tsx
// Codex OAuth — mint or refresh OpenAI credentials for platform LLM use
//
// Usage:
//   npx tsx src/scripts/codex-auth.ts          # interactive login (opens browser)
//   npx tsx src/scripts/codex-auth.ts --status  # show current credential status
//   npx tsx src/scripts/codex-auth.ts --refresh # force-refresh existing token
//
// After login, credentials are stored encrypted in data/baljia-openai-codex-oauth.json
// The platform auto-refreshes expired tokens at runtime.

import { loadCodexCredentialsSync, saveCodexCredentials, getValidCodexCredentials, mintCodexCredentials } from '../lib/codex-oauth';
import { refreshOpenAICodexToken } from '@mariozechner/pi-ai/oauth';

const args = process.argv.slice(2);
const command = args[0] ?? '--login';

async function showStatus() {
  const creds = loadCodexCredentialsSync();
  if (!creds) {
    console.log('\n  No Codex credentials found.\n  Run: npx tsx src/scripts/codex-auth.ts\n');
    return;
  }

  const expiresDate = new Date(creds.expires);
  const expired = Date.now() >= creds.expires;
  const identity = creds.identity;

  console.log('\n  Codex OAuth Status');
  console.log('  ─────────────────');
  console.log(`  Email:      ${identity?.email ?? 'unknown'}`);
  console.log(`  Account ID: ${identity?.accountId ?? 'unknown'}`);
  console.log(`  Plan:       ${identity?.planType ?? 'unknown'}`);
  console.log(`  Expires:    ${expiresDate.toISOString()} ${expired ? '(EXPIRED)' : '(valid)'}`);
  console.log(`  Token:      ${creds.access ? creds.access.slice(0, 12) + '...' : 'missing'}`);
  console.log(`  Store:      ${creds.storePath}`);
  console.log();
}

async function refreshToken() {
  const creds = loadCodexCredentialsSync();
  if (!creds?.refresh) {
    console.error('\n  No refresh token available. Run a fresh login instead.\n');
    process.exit(1);
  }

  console.log('  Refreshing Codex token...');
  const refreshed = await refreshOpenAICodexToken(creds.refresh);
  await saveCodexCredentials(refreshed);
  console.log('  Token refreshed successfully.\n');
  await showStatus();
}

async function login() {
  console.log('\n  Starting OpenAI Codex OAuth...');
  console.log('  A browser window will open for authentication.\n');

  const result = await mintCodexCredentials({
    onAuth: ({ url }) => {
      console.log(`  Open this URL in your browser:\n\n  ${url}\n`);
      // Try to open browser automatically
      import('child_process').then(({ exec }) => {
        const cmd = process.platform === 'win32' ? `start "${url}"` :
          process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
        exec(cmd).unref?.();
      }).catch(() => {});
    },
  });

  await saveCodexCredentials(result);
  console.log('\n  Authentication successful!\n');
  await showStatus();

  // Check if the token works
  console.log('  Verifying token with OpenAI API...');
  try {
    const valid = await getValidCodexCredentials();
    if (valid) {
      console.log('  Token is valid and ready for use.\n');
    } else {
      console.log('  Warning: could not validate token.\n');
    }
  } catch (err) {
    console.log(`  Warning: validation failed — ${err instanceof Error ? err.message : 'unknown error'}\n`);
  }
}

(async () => {
  try {
    switch (command) {
      case '--status':
        await showStatus();
        break;
      case '--refresh':
        await refreshToken();
        break;
      case '--login':
      default:
        await login();
        break;
    }
  } catch (err) {
    console.error(`\n  Error: ${err instanceof Error ? err.message : 'unknown'}\n`);
    process.exit(1);
  }
})();
