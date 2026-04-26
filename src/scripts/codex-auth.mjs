#!/usr/bin/env node
// Codex OAuth — mint or refresh OpenAI credentials for platform LLM use
//
// Usage:
//   node src/scripts/codex-auth.mjs          # interactive login (opens browser)
//   node src/scripts/codex-auth.mjs --status  # show current credential status
//   node src/scripts/codex-auth.mjs --refresh # force-refresh existing token
//
// After login, credentials are stored encrypted in data/baljia-openai-codex-oauth.json
// The platform auto-refreshes expired tokens at runtime.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loginOpenAICodex, refreshOpenAICodexToken } from '@mariozechner/pi-ai/oauth';
import { exec } from 'node:child_process';

const ROOT = process.cwd();
function getStorePath() {
  return process.env.BALJIA_OPENAI_OAUTH_STORE_PATH
    ? path.resolve(process.env.BALJIA_OPENAI_OAUTH_STORE_PATH)
    : path.join(ROOT, 'data', 'baljia-openai-codex-oauth.json');
}

// ── Encryption (mirrors credential-crypto.ts) ──

function deriveKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET env var is required. Set it in .env.local');
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${enc.toString('base64')}.${tag.toString('base64')}`;
}

function decrypt(payload) {
  const key = deriveKey();
  const [ivB64, encB64, tagB64] = payload.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return decipher.update(Buffer.from(encB64, 'base64'), undefined, 'utf8') + decipher.final('utf8');
}

// ── JWT decode ──

function decodeJwt(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { return null; }
}

function normalize(v) { const s = String(v || '').trim(); return s || null; }

function deriveIdentity(accessToken, fallbackAccountId) {
  const payload = decodeJwt(accessToken);
  const auth = (payload?.['https://api.openai.com/auth'] ?? {});
  const profile = (payload?.['https://api.openai.com/profile'] ?? {});
  return {
    email: normalize(profile.email),
    accountId: normalize(auth.chatgpt_account_id) ?? normalize(fallbackAccountId) ?? normalize(auth.chatgpt_user_id) ?? normalize(auth.user_id) ?? null,
    userId: normalize(auth.chatgpt_user_id) ?? normalize(auth.user_id) ?? null,
    planType: normalize(auth.chatgpt_plan_type) ?? null,
    emailVerified: Boolean(profile.email_verified),
  };
}

// ── Load / Save ──

function loadCredentials() {
  if (!fs.existsSync(getStorePath())) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(getStorePath(), 'utf8'));
    const access = payload?.credentials?.access ? decrypt(payload.credentials.access) : null;
    const refresh = payload?.credentials?.refresh ? decrypt(payload.credentials.refresh) : null;
    if (!access || !refresh) return null;
    return { access, refresh, expires: payload.credentials.expires, identity: payload.identity, storePath: getStorePath() };
  } catch { return null; }
}

async function saveCredentials(creds) {
  await fsp.mkdir(path.dirname(getStorePath()), { recursive: true });
  const identity = deriveIdentity(creds.access, creds.accountId ?? null);
  const payload = {
    version: 1,
    provider: 'openai-codex',
    storedAt: new Date().toISOString(),
    credentials: {
      access: encrypt(creds.access),
      refresh: encrypt(creds.refresh),
      expires: creds.expires,
      accountId: creds.accountId ?? identity.accountId ?? null,
    },
    identity,
  };
  await fsp.writeFile(getStorePath(), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { ...creds, identity, storePath: getStorePath() };
}

// ── Load .env.local for AUTH_SECRET ──

function loadEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

// ── Commands ──

async function showStatus() {
  const creds = loadCredentials();
  if (!creds) {
    console.log('\n  No Codex credentials found.\n  Run: node src/scripts/codex-auth.mjs\n');
    return;
  }
  const expired = Date.now() >= creds.expires;
  const id = creds.identity;
  console.log('\n  Codex OAuth Status');
  console.log('  ─────────────────');
  console.log(`  Email:      ${id?.email ?? 'unknown'}`);
  console.log(`  Account ID: ${id?.accountId ?? 'unknown'}`);
  console.log(`  Plan:       ${id?.planType ?? 'unknown'}`);
  console.log(`  Expires:    ${new Date(creds.expires).toISOString()} ${expired ? '(EXPIRED)' : '(valid)'}`);
  console.log(`  Token:      ${creds.access ? creds.access.slice(0, 12) + '...' : 'missing'}`);
  console.log(`  Store:      ${creds.storePath}`);
  console.log();
}

async function refreshToken() {
  const creds = loadCredentials();
  if (!creds?.refresh) {
    console.error('\n  No refresh token available. Run a fresh login instead.\n');
    process.exit(1);
  }
  console.log('  Refreshing Codex token...');
  const refreshed = await refreshOpenAICodexToken(creds.refresh);
  await saveCredentials(refreshed);
  console.log('  Token refreshed successfully.\n');
  await showStatus();
}

async function login() {
  console.log('\n  Starting OpenAI Codex OAuth...');
  console.log('  A browser window will open for authentication.\n');

  const credentials = await loginOpenAICodex({
    originator: 'baljia',
    onAuth: ({ url }) => {
      console.log(`  Open this URL in your browser:\n\n  ${url}\n`);
      const cmd = process.platform === 'win32' ? `start "" "${url}"` :
        process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd);
    },
    onPrompt: async () => {
      throw new Error('Manual input not supported — complete the browser callback flow.');
    },
  });

  const saved = await saveCredentials(credentials);
  console.log('\n  Authentication successful!\n');
  await showStatus();
}

// ── Main ──

loadEnv();

const command = process.argv[2] ?? '--login';
try {
  switch (command) {
    case '--status': await showStatus(); break;
    case '--refresh': await refreshToken(); break;
    default: await login(); break;
  }
} catch (err) {
  console.error(`\n  Error: ${err.message ?? err}\n`);
  process.exit(1);
}
