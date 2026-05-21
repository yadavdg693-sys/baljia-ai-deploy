// Anthropic OAuth provider — reads the local Claude Code OAuth credentials
// (~/.claude/.credentials.json) and exposes them as an Anthropic SDK
// `authToken`. This lets the platform piggyback on the Pro/Max subscription
// tied to the operator's Claude Code login instead of requiring a separate
// ANTHROPIC_API_KEY.
//
// Storage shape (written by Claude Code on login):
//   {
//     "claudeAiOauth": {
//       "accessToken":  "<jwt>",
//       "refreshToken": "<rotating>",
//       "expiresAt":    1777323148921,   // ms since epoch
//       "scopes":       ["user:inference", ...],
//       "subscriptionType": "pro"
//     },
//     ...
//   }
//
// The Anthropic SDK accepts `authToken` natively. When set, the SDK sends
// `Authorization: Bearer <token>` instead of `x-api-key`. We pair it with
// the Claude Code beta header so the API recognizes the session.

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@/lib/logger';

const log = createLogger('AnthropicOAuth');

/** Beta features the OAuth path enables. claude-code-20250219 + oauth-2025-04-20
 *  identify the request as a Claude Code session; fine-grained-tool-streaming
 *  is the streaming format the SDK expects from these sessions. */
export const ANTHROPIC_OAUTH_BETA =
  'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14';

/** Server-side claim required when authenticating with a Claude Code OAuth
 *  token. The API rejects requests whose system prompt doesn't begin with
 *  this exact string — it's how Anthropic enforces that OAuth tokens are
 *  used in Claude-Code-like contexts. Pair with prependClaudeCodeIdentity
 *  below. */
export const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

/** User-agent the OAuth flow expects (pi-ai uses this format). The exact
 *  version doesn't matter; it just needs to look like a CLI build. */
const CLAUDE_CODE_USER_AGENT = 'claude-cli/2.0.0 (claude-code-oauth-shim)';

/** Refresh well before expiry because Engineering turns can run 10-15 minutes. */
const REFRESH_LEEWAY_MS = 30 * 60 * 1000;

interface ClaudeAiOauth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: string[];
  subscriptionType?: string;
}

interface CredentialsFile {
  claudeAiOauth?: ClaudeAiOauth;
  [k: string]: unknown;
}

function credentialsPath(): string {
  // CLAUDE_CODE_CONFIG_DIR overrides default for non-standard installs.
  const configDir = process.env.CLAUDE_CODE_CONFIG_DIR || join(homedir(), '.claude');
  return join(configDir, '.credentials.json');
}

function readCredentials(): CredentialsFile | null {
  const path = credentialsPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as CredentialsFile;
  } catch (err) {
    log.warn('Failed to read Claude OAuth credentials', { path, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function writeCredentials(creds: CredentialsFile): void {
  const path = credentialsPath();
  writeFileSync(path, JSON.stringify(creds, null, 2), 'utf8');
}

/** Synchronous availability check — does NOT validate the token. */
export function isAnthropicOAuthAvailable(): boolean {
  const creds = readCredentials();
  if (!creds?.claudeAiOauth?.accessToken) return false;
  // Has user:inference scope OR subscriptionType set → safe to attempt.
  const scopes = creds.claudeAiOauth.scopes ?? [];
  return scopes.includes('user:inference') || !!creds.claudeAiOauth.subscriptionType;
}

/**
 * Get a valid Anthropic OAuth access token. If the stored token is expired
 * (or expires within REFRESH_LEEWAY_MS), refresh it via pi-ai and persist
 * the new credentials back to disk.
 *
 * Returns null when no credentials are present — callers should fall through
 * to other providers in that case rather than throw.
 */
export async function getAnthropicOAuthToken(): Promise<string | null> {
  const creds = readCredentials();
  const oauth = creds?.claudeAiOauth;
  if (!oauth?.accessToken) return null;

  const expiresIn = oauth.expiresAt - Date.now();
  if (expiresIn > REFRESH_LEEWAY_MS) {
    return oauth.accessToken;
  }

  // Token is expired or about to expire — refresh via pi-ai.
  if (!oauth.refreshToken) {
    log.warn('Anthropic OAuth token expired and no refresh token available');
    return null;
  }

  try {
    const piOauth = await import('@mariozechner/pi-ai/oauth');
    const refreshed = await piOauth.refreshAnthropicToken(oauth.refreshToken);
    // pi-ai's OAuthCredentials uses { access, refresh, expires }. Map back to
    // Claude Code's storage shape so the file stays compatible with the CLI.
    const updated: ClaudeAiOauth = {
      accessToken: String(refreshed.access),
      refreshToken: String(refreshed.refresh),
      expiresAt: Number(refreshed.expires),
      scopes: oauth.scopes,
      subscriptionType: oauth.subscriptionType,
    };
    const next: CredentialsFile = { ...creds, claudeAiOauth: updated };
    writeCredentials(next);
    log.info('Anthropic OAuth token refreshed', {
      expiresInMin: Math.round((updated.expiresAt - Date.now()) / 60_000),
    });
    return updated.accessToken;
  } catch (err) {
    const latest = readCredentials()?.claudeAiOauth;
    if (latest?.accessToken && latest.accessToken !== oauth.accessToken && latest.expiresAt - Date.now() > REFRESH_LEEWAY_MS) {
      log.info('Anthropic OAuth token refresh raced; using token refreshed by another caller', {
        expiresInMin: Math.round((latest.expiresAt - Date.now()) / 60_000),
      });
      return latest.accessToken;
    }
    log.error('Failed to refresh Anthropic OAuth token', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Default headers required when calling Anthropic with the OAuth token.
 *  Mirrors pi-ai's createClient — the API rejects OAuth requests missing
 *  any of these headers. */
export function anthropicOAuthHeaders(extraBeta: string[] = []): Record<string, string> {
  const beta = extraBeta.length > 0
    ? `${ANTHROPIC_OAUTH_BETA},${extraBeta.join(',')}`
    : ANTHROPIC_OAUTH_BETA;
  return {
    accept: 'application/json',
    'anthropic-beta': beta,
    'anthropic-dangerous-direct-browser-access': 'true',
    'user-agent': CLAUDE_CODE_USER_AGENT,
    'x-app': 'cli',
  };
}

/**
 * Synchronous token getter — returns the stored token without checking
 * expiry. Used in places where we can't await (e.g. Anthropic SDK
 * constructor). Pair with periodic background refresh OR rely on the SDK
 * surfacing 401 to trigger a refresh on the next call.
 */
export function getAnthropicOAuthTokenSync(): string | null {
  const creds = readCredentials();
  return creds?.claudeAiOauth?.accessToken ?? null;
}

function hasUsableDirectAnthropicApiKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!key && key !== 'placeholder' && key.startsWith('sk-ant-');
}

/**
 * Best-effort background refresh — fires getAnthropicOAuthToken() in the
 * background so the next sync read picks up the fresh token. Returns
 * immediately. Safe to call at module load time.
 */
export function scheduleBackgroundRefresh(): void {
  void getAnthropicOAuthToken().catch(() => { /* logged inside */ });
}

/**
 * Build an Anthropic SDK client preferring OAuth when available, falling
 * back to whatever auth env vars are set. Use this anywhere the project
 * currently does `new Anthropic()` or `new Anthropic({ apiKey: ... })`.
 *
 * Bedrock variants are NOT handled here — those have a different SDK
 * (`@anthropic-ai/bedrock-sdk`) with their own client class.
 *
 * Returns `{ client, isOAuth }`. Callers that build their own `system`
 * prompts MUST prepend `CLAUDE_CODE_IDENTITY` when `isOAuth` is true,
 * otherwise the API rejects the request. Use `withClaudeCodeIdentity()`
 * helper below for convenience.
 */
export function createAnthropicWithOAuth(): { client: Anthropic; isOAuth: boolean } {
  if (isAnthropicOAuthAvailable()) {
    scheduleBackgroundRefresh();
    const token = getAnthropicOAuthTokenSync();
    if (token) {
      const client = new Anthropic({
        // Explicitly null out apiKey so the SDK doesn't try to read
        // ANTHROPIC_API_KEY from env and pick API-key auth instead.
        apiKey: null as unknown as string,
        authToken: token,
        // Required: the SDK normally refuses to use bearer auth in
        // server contexts. The OAuth path is modeled on the browser flow.
        dangerouslyAllowBrowser: true,
        defaultHeaders: anthropicOAuthHeaders(),
      });
      return { client, isOAuth: true };
    }
  }
  if (hasUsableDirectAnthropicApiKey()) {
    // Falls through to ANTHROPIC_API_KEY from env.
    return { client: new Anthropic(), isOAuth: false };
  }
  throw new Error('No usable Anthropic OAuth or direct API key available');
}

/**
 * Async variant for long-running workers. It waits for token refresh before
 * constructing the SDK client, avoiding a first-turn 401 from an expired
 * Claude Code OAuth token.
 */
export async function createAnthropicWithOAuthAsync(): Promise<{ client: Anthropic; isOAuth: boolean }> {
  if (isAnthropicOAuthAvailable()) {
    const token = await getAnthropicOAuthToken();
    if (token) {
      const client = new Anthropic({
        apiKey: null as unknown as string,
        authToken: token,
        dangerouslyAllowBrowser: true,
        defaultHeaders: anthropicOAuthHeaders(),
      });
      return { client, isOAuth: true };
    }
    log.warn('Anthropic OAuth credentials are present but unusable; falling back to non-OAuth Anthropic auth when configured');
  }

  if (hasUsableDirectAnthropicApiKey()) {
    return { client: new Anthropic(), isOAuth: false };
  }

  throw new Error('No usable Anthropic OAuth or direct API key available');
}

/**
 * Wrap an existing system prompt so it satisfies the Claude Code OAuth
 * server-side check. When `isOAuth` is true, the API requires the *first*
 * system text block to be exactly CLAUDE_CODE_IDENTITY; the user's actual
 * prompt becomes a second block.
 *
 * Returns a value compatible with `messages.create({ system })` — either
 * a plain string (non-OAuth path) or an array of text blocks (OAuth path).
 */
export function withClaudeCodeIdentity(
  systemPrompt: string,
  isOAuth: boolean,
): string | Array<{ type: 'text'; text: string }> {
  if (!isOAuth) return systemPrompt;
  return [
    { type: 'text', text: CLAUDE_CODE_IDENTITY },
    { type: 'text', text: systemPrompt },
  ];
}
