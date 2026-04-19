// OpenAI Codex OAuth — credential lifecycle for Baljia AI platform
// Ported from App_mode/src/lib/balaji-openai-codex-oauth.mjs
//
// Flow: Browser OAuth → access token → encrypted store on disk → auto-refresh
// The access token doubles as an OpenAI API key for LLM calls.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
// pi-ai/oauth is ESM-only and breaks tsx CJS resolution if imported statically.
// Lazy-load it inside the only two functions that need it (login + refresh) so
// sync reads of the credential file work in any runtime (tsx scripts, Next.js,
// node ESM). Cold-start is also faster — pi-ai oauth pulls in all providers.
import { encryptSecret, decryptSecret } from '@/lib/credential-crypto';
import { createLogger } from '@/lib/logger';

const log = createLogger('CodexOAuth');

const STORE_FILENAME = 'baljia-openai-codex-oauth.json';
const EXPIRY_SKEW_MS = 60_000; // refresh 60s before actual expiry

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

export interface CodexCredentials {
  provider: 'openai-codex';
  access: string;
  refresh: string;
  expires: number;
  accountId: string | null;
  identity: CodexIdentity;
  storePath: string;
}

export interface CodexIdentity {
  email: string | null;
  accountId: string | null;
  userId: string | null;
  planType: string | null;
  emailVerified: boolean;
}

interface StoredPayload {
  version: number;
  provider: string;
  storedAt: string;
  credentials: {
    access: string | null; // encrypted
    refresh: string | null; // encrypted
    expires: number;
    accountId: string | null;
  };
  identity: CodexIdentity;
}

// ══════════════════════════════════════════════
// STORE PATH
// ══════════════════════════════════════════════

function resolveStorePath(rootDir = process.cwd()): string {
  const explicit = process.env.BALJIA_OPENAI_OAUTH_STORE_PATH;
  if (explicit) return path.resolve(explicit);
  return path.join(rootDir, 'data', STORE_FILENAME);
}

// ══════════════════════════════════════════════
// LOAD / SAVE
// ══════════════════════════════════════════════

export function loadCodexCredentialsSync(rootDir = process.cwd()): CodexCredentials | null {
  const storePath = resolveStorePath(rootDir);
  if (!fs.existsSync(storePath)) return null;

  try {
    const payload: StoredPayload = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return hydrateStoredCredentials(payload, storePath);
  } catch {
    return null;
  }
}

export function hasCodexCredentialsSync(rootDir = process.cwd()): boolean {
  const creds = loadCodexCredentialsSync(rootDir);
  return Boolean(creds && !isExpired(creds));
}

export async function saveCodexCredentials(
  credentials: { access: string; refresh: string; expires: number; accountId?: string | null },
  rootDir = process.cwd(),
): Promise<CodexCredentials | null> {
  const storePath = resolveStorePath(rootDir);
  await fsp.mkdir(path.dirname(storePath), { recursive: true });

  const identity = deriveCodexIdentity(credentials.access, credentials.accountId ?? null);
  const payload: StoredPayload = {
    version: 1,
    provider: 'openai-codex',
    storedAt: new Date().toISOString(),
    credentials: {
      access: encryptSecret(credentials.access),
      refresh: encryptSecret(credentials.refresh),
      expires: credentials.expires,
      accountId: credentials.accountId ?? identity.accountId ?? null,
    },
    identity,
  };

  await fsp.writeFile(storePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  log.info('Codex credentials saved', { email: identity.email, accountId: identity.accountId });
  return hydrateStoredCredentials(payload, storePath);
}

// ══════════════════════════════════════════════
// REFRESH + GET VALID KEY
// ══════════════════════════════════════════════

export async function getValidCodexCredentials(rootDir = process.cwd()): Promise<CodexCredentials | null> {
  const stored = loadCodexCredentialsSync(rootDir);
  if (!stored) return null;
  if (!isExpired(stored)) return stored;

  // Token expired — try refresh
  if (!stored.refresh) return null;

  try {
    const { refreshOpenAICodexToken } = await import('@mariozechner/pi-ai/oauth');
    const refreshed = await refreshOpenAICodexToken(stored.refresh);
    return saveCodexCredentials(refreshed, rootDir);
  } catch (err) {
    log.warn('Codex token refresh failed', { error: err instanceof Error ? err.message : 'unknown' });
    return null;
  }
}

/** Get a valid OpenAI API key from Codex OAuth credentials. Returns null if unavailable. */
export async function getCodexApiKey(rootDir = process.cwd()): Promise<string | null> {
  const creds = await getValidCodexCredentials(rootDir);
  return creds?.access ?? null;
}

/** Synchronous check — does not refresh expired tokens */
export function getCodexApiKeySync(rootDir = process.cwd()): string | null {
  const creds = loadCodexCredentialsSync(rootDir);
  if (!creds || isExpired(creds)) return null;
  return creds.access;
}

// ══════════════════════════════════════════════
// OAUTH LOGIN FLOW
// ══════════════════════════════════════════════

export async function mintCodexCredentials(options: {
  onAuth?: (data: { url: string; instructions?: string }) => void;
} = {}): Promise<CodexCredentials & { identity: CodexIdentity }> {
  const { loginOpenAICodex } = await import('@mariozechner/pi-ai/oauth');
  const credentials = await loginOpenAICodex({
    originator: 'baljia',
    onAuth: options.onAuth ?? (() => {}),
    onPrompt: async () => {
      throw new Error('Manual input not supported — complete the browser callback flow.');
    },
  });

  const accountId = typeof credentials.accountId === 'string' ? credentials.accountId : null;
  const identity = deriveCodexIdentity(credentials.access, accountId);
  return {
    provider: 'openai-codex' as const,
    access: credentials.access,
    refresh: credentials.refresh,
    expires: credentials.expires,
    accountId: accountId ?? identity.accountId,
    storePath: '',
    identity,
  };
}

/** Login manager for non-blocking OAuth flow (used by API routes) */
export function createCodexLoginManager(rootDir = process.cwd()) {
  const jobs = new Map<string, {
    id: string;
    status: string;
    authUrl: string | null;
    error: string | null;
    credentials: CodexCredentials | null;
    startedAt: string;
    updatedAt: string;
  }>();

  return {
    async start() {
      const job = {
        id: `oauth_${Math.random().toString(36).slice(2, 10)}`,
        status: 'starting',
        authUrl: null as string | null,
        error: null as string | null,
        credentials: null as CodexCredentials | null,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      jobs.set(job.id, job);

      void (async () => {
        try {
          const minted = await mintCodexCredentials({
            onAuth: ({ url }) => {
              job.authUrl = url;
              job.status = 'awaiting_browser';
              job.updatedAt = new Date().toISOString();
            },
          });
          const saved = await saveCodexCredentials(minted, rootDir);
          job.status = 'completed';
          job.credentials = saved;
          job.updatedAt = new Date().toISOString();
        } catch (error) {
          job.status = 'failed';
          job.error = error instanceof Error ? error.message : 'OpenAI Codex OAuth failed.';
          job.updatedAt = new Date().toISOString();
        }
      })();

      // Wait for auth URL to populate (up to 2.5s)
      for (let i = 0; i < 50; i++) {
        if (job.authUrl || job.error || job.status === 'completed') break;
        await new Promise(r => setTimeout(r, 50));
      }

      return structuredClone(job);
    },

    get(jobId: string) {
      const job = jobs.get(jobId);
      return job ? structuredClone(job) : null;
    },

    remove(jobId: string) {
      jobs.delete(jobId);
    },
  };
}

// ══════════════════════════════════════════════
// IDENTITY DERIVATION
// ══════════════════════════════════════════════

export function deriveCodexIdentity(accessToken: string, fallbackAccountId: string | null = null): CodexIdentity {
  const payload = decodeJwt(accessToken);
  const authClaim = (payload?.['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>;
  const profileClaim = (payload?.['https://api.openai.com/profile'] ?? {}) as Record<string, unknown>;
  const email = normalize(profileClaim.email);
  const accountId =
    normalize(authClaim.chatgpt_account_id) ??
    normalize(fallbackAccountId) ??
    normalize(authClaim.chatgpt_user_id) ??
    normalize(authClaim.user_id) ??
    null;

  return {
    email,
    accountId,
    userId: normalize(authClaim.chatgpt_user_id) ?? normalize(authClaim.user_id) ?? null,
    planType: normalize(authClaim.chatgpt_plan_type) ?? null,
    emailVerified: Boolean(profileClaim.email_verified),
  };
}

export function deriveCodexOperatorProfile(credentials: CodexCredentials) {
  const identity = credentials.identity ?? deriveCodexIdentity(credentials.access, credentials.accountId);
  const email = identity.email ??
    (identity.accountId ? `openai-codex+${identity.accountId}@baljia.local` : null) ??
    'openai-codex-operator@baljia.local';

  const name = deriveOperatorName(email);
  return { email, name, providerUserId: identity.accountId ?? identity.userId ?? email, identity };
}

// ══════════════════════════════════════════════
// INTERNAL HELPERS
// ══════════════════════════════════════════════

function hydrateStoredCredentials(payload: StoredPayload, storePath: string): CodexCredentials | null {
  const access = payload?.credentials?.access ? decryptSecret(payload.credentials.access) : null;
  const refresh = payload?.credentials?.refresh ? decryptSecret(payload.credentials.refresh) : null;
  const expires = Number(payload?.credentials?.expires);
  if (!access || !refresh || !Number.isFinite(expires)) return null;

  return {
    provider: 'openai-codex',
    access,
    refresh,
    expires,
    accountId: normalize(payload.credentials?.accountId) ?? normalize(payload.identity?.accountId) ?? null,
    identity: {
      email: normalize(payload.identity?.email) ?? null,
      accountId: normalize(payload.identity?.accountId) ?? normalize(payload.credentials?.accountId) ?? null,
      userId: normalize(payload.identity?.userId) ?? null,
      planType: normalize(payload.identity?.planType) ?? null,
      emailVerified: Boolean(payload.identity?.emailVerified),
    },
    storePath,
  };
}

function isExpired(credentials: CodexCredentials): boolean {
  return Date.now() + EXPIRY_SKEW_MS >= Number(credentials.expires || 0);
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function normalize(value: unknown): string | null {
  const s = String(value || '').trim();
  return s || null;
}

function deriveOperatorName(email: string): string {
  const localPart = String(email || 'openai codex operator').split('@')[0];
  return (
    localPart
      .replace(/^openai-codex\+/, '')
      .split(/[._-]+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || 'OpenAI Codex Operator'
  );
}
