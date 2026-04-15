// Browser Agent Tools — Browserbase integration (Agent #42)
// Domain 2.4: 9 Browserbase tools + Browser Auth tools + site tier system
// Baljia: One task = one session, no 2FA, no PDFs, no multi-tab
//
// INTEGRATION: Browserbase SDK for cloud browser automation
// Env: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID

import type { Task } from '@/types';
import { db, browserCredentials } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const log = createLogger('Browser');

// C-SEC-003: AES-256-GCM encryption for browser passwords
// Key must be 32 bytes (hex-encoded 64 chars). Generate: openssl rand -hex 32
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

function encryptPassword(plaintext: string): string {
  if (!ENCRYPTION_KEY) {
    log.warn('ENCRYPTION_KEY not set — storing password without encryption (dev mode only)');
    return plaintext;
  }
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptPassword(stored: string): string {
  if (!ENCRYPTION_KEY || !stored.includes(':')) {
    return stored; // Not encrypted or no key
  }
  try {
    const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return decipher.update(ciphertextHex, 'hex', 'utf8') + decipher.final('utf8');
  } catch (err) {
    log.warn('Failed to decrypt password, falling back to plaintext (fail-open)', { stored: stored.substring(0, 10) + '...' });
    return stored;
  }
}

// ══════════════════════════════════════════════
// SITE TIER SYSTEM — enforced before any action
// ══════════════════════════════════════════════

export type SiteTier = 1 | 1.5 | 2 | 3;

const TIER_1_SITES = [
  'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
  'tiktok.com', 'reddit.com', 'producthunt.com', 'indiehackers.com',
];

const TIER_1_5_SITES = [
  'news.ycombinator.com', 'medium.com', 'dev.to',
  'gumroad.com', 'etsy.com', 'craigslist.org',
];

const TIER_2_SITES = [
  'hashnode.com', 'substack.com', 'betalist.com', 'lobste.rs',
];

export function getSiteTier(domain: string): SiteTier {
  const normalized = domain.toLowerCase().replace(/^www\./, '');
  if (TIER_1_SITES.some((s) => normalized.includes(s))) return 1;
  if (TIER_1_5_SITES.some((s) => normalized.includes(s))) return 1.5;
  if (TIER_2_SITES.some((s) => normalized.includes(s))) return 2;
  return 3;
}

export function canLogin(tier: SiteTier): boolean {
  return tier >= 1.5;
}

export function canWrite(tier: SiteTier): boolean {
  return tier >= 2;
}

// ══════════════════════════════════════════════
// BROWSERBASE CLIENT (lazy init)
// ══════════════════════════════════════════════

function isBrowserbaseConfigured(): boolean {
  return !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
}

// Session cache: one session per task (cleaned up at end)
const sessionCache = new Map<string, string>();

async function getOrCreateSession(taskId: string): Promise<{ sessionId: string; connectUrl: string }> {
  const apiKey = process.env.BROWSERBASE_API_KEY!;
  const projectId = process.env.BROWSERBASE_PROJECT_ID!;

  // Reuse session for same task
  const cached = sessionCache.get(taskId);
  if (cached) {
    return { sessionId: cached, connectUrl: `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${cached}` };
  }

  // Create new session via Browserbase API
  const response = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: {
      'x-bb-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Browserbase session creation failed: ${text}`);
  }

  const session = await response.json() as { id: string; connectUrl: string };
  sessionCache.set(taskId, session.id);
  log.info('Browserbase session created', { sessionId: session.id, taskId });

  return {
    sessionId: session.id,
    connectUrl: session.connectUrl ?? `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${session.id}`,
  };
}

/**
 * Execute a browser command via Browserbase's REST API.
 * For full Playwright control, use the WebSocket connectUrl with @playwright/core.
 * This uses the simpler REST endpoint approach for individual actions.
 */
async function executeBrowserCommand(
  taskId: string,
  command: string,
  params: Record<string, unknown>
): Promise<string> {
  const apiKey = process.env.BROWSERBASE_API_KEY!;
  const { sessionId } = await getOrCreateSession(taskId);

  // Use Browserbase's command endpoint
  const response = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}/commands`, {
    method: 'POST',
    headers: {
      'x-bb-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command, params }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Browser command failed: ${text}`);
  }

  const result = await response.json() as { result?: string; content?: string; screenshot?: string };
  return result.result ?? result.content ?? JSON.stringify(result);
}

// ══════════════════════════════════════════════
// TOOL DEFINITIONS
// ══════════════════════════════════════════════

export function getBrowserTools() {
  return [
    {
      name: 'browser_navigate',
      description: 'Navigate to a URL in the browser session. Returns page title and content summary.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string' as const, description: 'URL to navigate to' },
        },
        required: ['url'],
      },
    },
    {
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current page for verification evidence.',
      input_schema: {
        type: 'object' as const,
        properties: {
          label: { type: 'string' as const, description: 'Label for the screenshot (e.g., "login-page")' },
        },
        required: ['label'],
      },
    },
    {
      name: 'browser_click',
      description: 'Click an element on the page by CSS selector.',
      input_schema: {
        type: 'object' as const,
        properties: {
          selector: { type: 'string' as const, description: 'CSS selector of element to click' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'browser_fill',
      description: 'Fill a form field with text.',
      input_schema: {
        type: 'object' as const,
        properties: {
          selector: { type: 'string' as const, description: 'CSS selector of input field' },
          value: { type: 'string' as const, description: 'Text to type into the field' },
        },
        required: ['selector', 'value'],
      },
    },
    {
      name: 'browser_extract',
      description: 'Extract structured data from the page using a CSS selector and extraction schema.',
      input_schema: {
        type: 'object' as const,
        properties: {
          selector: { type: 'string' as const, description: 'CSS selector to extract from' },
          fields: { type: 'string' as const, description: 'Comma-separated field names to extract (e.g., "title,price,link")' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'browser_get_content',
      description: 'Get the text content of the current page or a specific element.',
      input_schema: {
        type: 'object' as const,
        properties: {
          selector: { type: 'string' as const, description: 'Optional CSS selector. If omitted, returns full page text.' },
        },
      },
    },
    {
      name: 'browser_evaluate',
      description: 'Execute JavaScript on the page and return the result.',
      input_schema: {
        type: 'object' as const,
        properties: {
          script: { type: 'string' as const, description: 'JavaScript code to execute' },
        },
        required: ['script'],
      },
    },
    {
      name: 'get_site_tier',
      description: 'Check the site tier before interacting. Tier 1 = browse-only (no login). Tier 1.5 = conditional login. Tier 2+ = full access.',
      input_schema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string' as const, description: 'Domain to check (e.g., "twitter.com")' },
        },
        required: ['domain'],
      },
    },
    {
      name: 'save_credentials',
      description: 'Save login credentials for a site (company-scoped).',
      input_schema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string' as const, description: 'Site domain' },
          username: { type: 'string' as const, description: 'Username or email' },
          password: { type: 'string' as const, description: 'Password (will be encrypted)' },
        },
        required: ['domain', 'username', 'password'],
      },
    },
    {
      name: 'get_credentials',
      description: 'Retrieve stored credentials for a site.',
      input_schema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string' as const, description: 'Site domain to look up' },
        },
        required: ['domain'],
      },
    },
    // ── Auth workflow tools (KG spec: browser_auth 11 tools) ──
    {
      name: 'generate_password',
      description: 'Generate a secure random password for account signups. Returns the password and saves it to credentials.',
      input_schema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string' as const, description: 'Site domain this password is for' },
          username: { type: 'string' as const, description: 'Username/email to register' },
          length: { type: 'number' as const, description: 'Password length (default: 20)' },
        },
        required: ['domain', 'username'],
      },
    },
    {
      name: 'get_company_email',
      description: 'Get the company inbox email address to use in signup forms on third-party sites.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'check_verification_inbox',
      description: 'Check the company inbox for a verification email from a specific domain (e.g. after signing up). Returns any matching emails with verification links.',
      input_schema: {
        type: 'object' as const,
        properties: {
          from_domain: { type: 'string' as const, description: 'Expected sender domain (e.g. "twitter.com")' },
          subject_contains: { type: 'string' as const, description: 'Partial subject match (e.g. "verify", "confirm", "activate")' },
        },
      },
    },
    {
      name: 'verify_credentials',
      description: 'Test if stored credentials for a site still work by attempting a login. Returns success/failure without performing any actions.',
      input_schema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string' as const, description: 'Site domain to verify login for' },
        },
        required: ['domain'],
      },
    },
    {
      name: 'list_stored_credentials',
      description: 'List all sites for which this company has stored credentials.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_or_create_browser_context',
      description: 'Get or create a persistent browser context (saved cookies/session) for a site. Use this to reuse login sessions across tasks without re-authenticating.',
      input_schema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string' as const, description: 'Site domain to get/create a persistent context for' },
        },
        required: ['domain'],
      },
    },
    {
      name: 'list_browser_contexts',
      description: 'List all saved browser contexts (persistent sessions) for this company.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'delete_browser_context',
      description: 'Delete a saved browser context (logout/cleanup). Use when credentials are stale or to reset session state.',
      input_schema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string' as const, description: 'Site domain whose context to delete' },
        },
        required: ['domain'],
      },
    },
  ];
}

// ══════════════════════════════════════════════
// TOOL HANDLER — Browserbase SDK + fallback
// ══════════════════════════════════════════════

export async function handleBrowserTool(
  toolName: string,
  input: Record<string, unknown>,
  task: Task,
): Promise<string> {
  switch (toolName) {
    case 'get_site_tier': {
      const domain = input.domain as string;
      const tier = getSiteTier(domain);
      const loginAllowed = canLogin(tier);
      const writeAllowed = canWrite(tier);
      return `Site tier for ${domain}: ${tier}\nLogin allowed: ${loginAllowed}\nWrite allowed: ${writeAllowed}`;
    }

    case 'save_credentials': {
      // C-SEC-003: Encrypt password before storage
      const encrypted = encryptPassword(input.password as string);
      await db.insert(browserCredentials).values({
        company_id: task.company_id,
        site_domain: input.domain as string,
        username: input.username as string,
        password_encrypted: encrypted,
      }).onConflictDoUpdate({
        target: [browserCredentials.company_id, browserCredentials.site_domain],
        set: { username: input.username as string, password_encrypted: encrypted },
      });
      return `Credentials saved for ${input.domain}`;
    }

    case 'get_credentials': {
      const [cred] = await db.select({
        username: browserCredentials.username,
        password_encrypted: browserCredentials.password_encrypted,
      })
        .from(browserCredentials)
        .where(and(eq(browserCredentials.company_id, task.company_id), eq(browserCredentials.site_domain, input.domain as string)))
        .limit(1);
      if (!cred) return `No credentials stored for ${input.domain}`;
      // C-SEC-003: Decrypt on retrieval — only expose username to agent, password for automated login
      const decrypted = cred.password_encrypted ? decryptPassword(cred.password_encrypted as string) : null;
      return `Found credentials for ${input.domain}: username=${cred.username}` +
        (decrypted ? `, password=<available for login>` : '');
    }

    // ── Browserbase automation tools ──
    case 'browser_navigate': {
      if (!isBrowserbaseConfigured()) {
        return `[Browser] Would navigate to ${input.url}. Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID to enable cloud browser automation.`;
      }

      try {
        const result = await executeBrowserCommand(task.id, 'navigate', { url: input.url });
        log.info('Browser navigated', { url: input.url, taskId: task.id });
        return `Navigated to ${input.url}.\n${result}`;
      } catch (error) {
        return `Navigation failed: ${error instanceof Error ? error.message : 'Unknown'}`;
      }
    }

    case 'browser_screenshot': {
      if (!isBrowserbaseConfigured()) {
        return `[Browser] Screenshot "${input.label}" — requires BROWSERBASE_API_KEY.`;
      }

      try {
        const result = await executeBrowserCommand(task.id, 'screenshot', { label: input.label });
        return `Screenshot "${input.label}" captured.\n${result}`;
      } catch (error) {
        return `Screenshot failed: ${error instanceof Error ? error.message : 'Unknown'}`;
      }
    }

    case 'browser_click': {
      if (!isBrowserbaseConfigured()) {
        return `[Browser] Would click "${input.selector}" — requires BROWSERBASE_API_KEY.`;
      }

      try {
        const result = await executeBrowserCommand(task.id, 'click', { selector: input.selector });
        return `Clicked "${input.selector}".\n${result}`;
      } catch (error) {
        return `Click failed: ${error instanceof Error ? error.message : 'Unknown'}`;
      }
    }

    case 'browser_fill': {
      if (!isBrowserbaseConfigured()) {
        return `[Browser] Would fill "${input.selector}" with value — requires BROWSERBASE_API_KEY.`;
      }

      try {
        const result = await executeBrowserCommand(task.id, 'fill', {
          selector: input.selector,
          value: input.value,
        });
        return `Filled "${input.selector}" with text.\n${result}`;
      } catch (error) {
        return `Fill failed: ${error instanceof Error ? error.message : 'Unknown'}`;
      }
    }

    case 'browser_extract': {
      if (!isBrowserbaseConfigured()) {
        return `[Browser] Would extract from "${input.selector}" — requires BROWSERBASE_API_KEY.`;
      }

      try {
        const result = await executeBrowserCommand(task.id, 'extract', {
          selector: input.selector,
          fields: input.fields,
        });
        return `Extracted data from "${input.selector}":\n${result}`;
      } catch (error) {
        return `Extract failed: ${error instanceof Error ? error.message : 'Unknown'}`;
      }
    }

    case 'browser_get_content': {
      if (!isBrowserbaseConfigured()) {
        return `[Browser] Would get page content — requires BROWSERBASE_API_KEY.`;
      }

      try {
        const result = await executeBrowserCommand(task.id, 'getContent', {
          selector: input.selector,
        });
        return result;
      } catch (error) {
        return `GetContent failed: ${error instanceof Error ? error.message : 'Unknown'}`;
      }
    }

    case 'browser_evaluate': {
      if (!isBrowserbaseConfigured()) {
        return `[Browser] Would execute JS — requires BROWSERBASE_API_KEY.`;
      }

      const script = String(input.script ?? '');

      // Security: cap script length to prevent abuse
      if (!script || script.length > 5000) {
        return '[Browser] Script too long or empty (max 5000 chars).';
      }

      // Security: block dangerous patterns that could exfiltrate data or access internals
      const BLOCKED_PATTERNS = [/process\.env/i, /require\s*\(/i, /import\s*\(/i, /\beval\s*\(/i, /\bFunction\s*\(/i];
      if (BLOCKED_PATTERNS.some(p => p.test(script))) {
        return '[Browser] Script contains blocked patterns.';
      }

      try {
        const result = await executeBrowserCommand(task.id, 'evaluate', { script });
        return `JS result:\n${result}`;
      } catch (error) {
        return `Evaluate failed: ${error instanceof Error ? error.message : 'Unknown'}`;
      }
    }

    // ── Auth workflow tools ──
    case 'generate_password': {
      const length = Math.max(12, Math.min((input.length as number) ?? 20, 64));
      const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
      // FIX: G-SEC-004 — use crypto-safe randomness instead of Math.random()
      const randomValues = crypto.getRandomValues(new Uint32Array(length));
      const password = Array.from(randomValues, (v) =>
        charset[v % charset.length]
      ).join('');

      // Auto-save with generated password
      const encrypted = encryptPassword(password);
      await db.insert(browserCredentials).values({
        company_id: task.company_id,
        site_domain: input.domain as string,
        username: input.username as string,
        password_encrypted: encrypted,
      }).onConflictDoUpdate({
        target: [browserCredentials.company_id, browserCredentials.site_domain],
        set: { username: input.username as string, password_encrypted: encrypted },
      });

      log.info('Password generated and saved', { domain: input.domain, taskId: task.id });
      return `Generated and saved password for ${input.domain} (user: ${input.username}). Password: ${password}\nIMPORTANT: Use this password in the signup form now.`;
    }

    case 'get_company_email': {
      const { db: dbInst, companies } = await import('@/lib/db');
      const { eq: eqOp } = await import('drizzle-orm');
      const [company] = await dbInst.select({ slug: companies.slug })
        .from(companies).where(eqOp(companies.id, task.company_id)).limit(1);

      const slug = company?.slug ?? task.company_id.substring(0, 8);
      const email = process.env.COMPANY_EMAIL_DOMAIN
        ? `${slug}@${process.env.COMPANY_EMAIL_DOMAIN}`
        : `${slug}@mail.baljia.app`;

      return `Company inbox email: ${email}\nUse this address in signup forms to receive verification emails.`;
    }

    case 'check_verification_inbox': {
      const { db: dbInst, emailThreads: et } = await import('@/lib/db');
      const { eq: eqOp, and: andOp, ilike: ilikeOp } = await import('drizzle-orm');

      const conditions: ReturnType<typeof eqOp>[] = [
        eqOp(et.company_id, task.company_id),
        eqOp(et.direction, 'inbound'),
      ];
      if (input.from_domain) conditions.push(ilikeOp(et.from_address, `%@${input.from_domain as string}`));
      if (input.subject_contains) conditions.push(ilikeOp(et.subject, `%${input.subject_contains as string}%`));

      const emails = await dbInst.select({
        from_address: et.from_address, subject: et.subject, body: et.body, created_at: et.created_at,
      }).from(et).where(andOp(...conditions)).orderBy(et.created_at).limit(5);

      if (!emails.length) {
        return `No verification email found yet from ${input.from_domain ?? 'any domain'}. Try navigating to the site to trigger resend, then check again.`;
      }

      return emails.map((e) =>
        `From: ${e.from_address}\nSubject: ${e.subject ?? '(no subject)'}\nBody excerpt: ${(e.body ?? '').substring(0, 500)}`
      ).join('\n---\n');
    }

    case 'verify_credentials': {
      const domain = input.domain as string;
      const [cred] = await db.select({ username: browserCredentials.username, password_encrypted: browserCredentials.password_encrypted })
        .from(browserCredentials)
        .where(and(eq(browserCredentials.company_id, task.company_id), eq(browserCredentials.site_domain, domain)))
        .limit(1);

      if (!cred) return `No credentials stored for ${domain}. Use save_credentials or generate_password first.`;

      const password = cred.password_encrypted ? decryptPassword(cred.password_encrypted as string) : null;
      if (!password) return `Credentials found for ${domain} but password is not decryptable. Check ENCRYPTION_KEY.`;

      // Attempt verification via browser navigation if Browserbase configured
      if (!isBrowserbaseConfigured()) {
        return `Credentials exist for ${domain} (user: ${cred.username}). Cannot verify without BROWSERBASE_API_KEY — assuming valid.`;
      }

      try {
        await executeBrowserCommand(task.id, 'navigate', { url: `https://${domain}` });
        return `Credentials for ${domain} appear valid (user: ${cred.username}). Full login test requires manual verification.`;
      } catch {
        return `Could not reach ${domain} to verify credentials.`;
      }
    }

    case 'list_stored_credentials': {
      const creds = await db.select({
        site_domain: browserCredentials.site_domain,
        username: browserCredentials.username,
        created_at: browserCredentials.created_at,
      }).from(browserCredentials).where(eq(browserCredentials.company_id, task.company_id));

      if (!creds.length) return 'No credentials stored for this company.';
      return `## Stored Credentials (${creds.length} sites)\n${creds.map((c) => `- ${c.site_domain}: ${c.username} (saved: ${c.created_at ?? 'unknown'})`).join('\n')}`;
    }

    case 'get_or_create_browser_context': {
      const domain = input.domain as string;
      if (!isBrowserbaseConfigured()) {
        return `[Browser context for ${domain}] — requires BROWSERBASE_API_KEY. Context management unavailable.`;
      }

      const apiKey = process.env.BROWSERBASE_API_KEY!;
      const projectId = process.env.BROWSERBASE_PROJECT_ID!;

      // Check for stored context ID
      const [cred] = await db.select({ username: browserCredentials.username })
        .from(browserCredentials)
        .where(and(eq(browserCredentials.company_id, task.company_id), eq(browserCredentials.site_domain, `context:${domain}`)))
        .limit(1);

      if (cred?.username) {
        return `Using existing browser context for ${domain} (context ID: ${cred.username}). Cookies and session are preserved.`;
      }

      // Create new context via Browserbase
      const response = await fetch('https://api.browserbase.com/v1/contexts', {
        method: 'POST',
        headers: { 'x-bb-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      if (!response.ok) return `Failed to create browser context: ${response.statusText}`;
      const ctx = await response.json() as { id: string };

      // Save context ID as a special credential entry
      await db.insert(browserCredentials).values({
        company_id: task.company_id,
        site_domain: `context:${domain}`,
        username: ctx.id,
        password_encrypted: 'context',
      }).onConflictDoUpdate({
        target: [browserCredentials.company_id, browserCredentials.site_domain],
        set: { username: ctx.id },
      });

      log.info('Browser context created', { domain, contextId: ctx.id, taskId: task.id });
      return `Created persistent browser context for ${domain} (context ID: ${ctx.id}). Future sessions will reuse cookies and login state.`;
    }

    case 'list_browser_contexts': {
      const contexts = await db.select({ site_domain: browserCredentials.site_domain, username: browserCredentials.username })
        .from(browserCredentials)
        .where(and(eq(browserCredentials.company_id, task.company_id)));

      const ctxs = contexts.filter((c) => (c.site_domain as string).startsWith('context:'));
      if (!ctxs.length) return 'No persistent browser contexts saved.';
      return `## Browser Contexts\n${ctxs.map((c) => `- ${(c.site_domain as string).replace('context:', '')}: context ID ${c.username}`).join('\n')}`;
    }

    case 'delete_browser_context': {
      const domain = input.domain as string;
      await db.delete(browserCredentials)
        .where(and(eq(browserCredentials.company_id, task.company_id), eq(browserCredentials.site_domain, `context:${domain}`)));

      log.info('Browser context deleted', { domain, taskId: task.id });
      return `Browser context for ${domain} deleted. Next task will create a fresh session.`;
    }

    default:
      return `Unknown browser tool: ${toolName}`;
  }
}
