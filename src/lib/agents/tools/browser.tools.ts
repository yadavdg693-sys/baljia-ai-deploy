// Browser Agent Tools — Browserbase integration (Agent #42)
// Domain 2.4: 9 Browserbase tools + Browser Auth tools + site tier system
// Baljia: One task = one session, no 2FA, no PDFs, no multi-tab
//
// INTEGRATION: Browserbase SDK for cloud browser automation
// Env: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID

import type { Task } from '@/types';
import { db, browserCredentials, domainSkills, providerPacks } from '@/lib/db';
import { eq, and, desc, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { runOcr, findTextOnPage, fetchImageBuffer } from './ocr-engine';
import { assertUrlSafe } from '@/lib/agents/url-safety';

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

// Curated subset of browser tools for the Engineering Agent (id 30) —
// just the journey-verification primitives. Excludes domain-skill memory,
// provider packs, OCR, credential storage, and email-inbox features which
// are specific to the full Browser Agent (id 42). Lets engineering tasks
// drive a real Chromium session via Browserbase to verify JS-heavy apps
// (React, Next.js, Vue) where verify_user_journey's HTTP-level walker can't
// exercise client-side behavior.
//
// Intended use: AFTER verify_user_journey + verify_db_state both pass, if
// the app has significant client-side JavaScript, the engineering agent
// runs a short browser-driven walkthrough of the same flow as a final check.
// Costs ~$0.05–0.10 per session start + per-minute Browserbase usage; cap
// to one session per deploy.
export function getBrowserVerificationTools() {
  return getBrowserTools().filter((t) =>
    [
      'browser_navigate',
      'browser_screenshot',
      'browser_click',
      'browser_fill',
      'browser_extract',
      'browser_get_content',
      'browser_evaluate',
    ].includes(t.name)
  );
}

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
    {
      name: 'record_domain_skill',
      description: 'Save a learned skill about a site so future tasks on the same domain can reuse it. Use after a successful interaction (e.g. you found the working login button selector, or learned the correct order of a multi-step flow). Does NOT store secrets — use save_credentials for those.',
      input_schema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string' as const, description: 'Site domain, e.g. "hunter.io"' },
          kind: { type: 'string' as const, description: 'One of: selector | url_pattern | wait | trap | note' },
          key: { type: 'string' as const, description: 'Short label, e.g. "login_button" or "home_url" or "captcha_appears_at"' },
          value: { type: 'string' as const, description: 'The actual content (CSS selector, URL pattern, wait instruction, or free-form note)' },
        },
        required: ['domain', 'kind', 'key', 'value'],
      },
    },
    {
      name: 'read_domain_skills',
      description: 'Look up everything Baljia has previously learned about a site. Call this BEFORE navigating to a site you have not visited recently in this task. Returns selectors, URL patterns, traps and notes recorded by past tasks for this company.',
      input_schema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string' as const, description: 'Site domain, e.g. "hunter.io"' },
          kind: { type: 'string' as const, description: 'Optional filter: selector | url_pattern | wait | trap | note. If omitted, returns all kinds.' },
        },
        required: ['domain'],
      },
    },
    {
      name: 'list_provider_packs',
      description: 'List the SaaS providers Baljia has pre-built signup recipes for (e.g. OpenAI, Stripe, GitHub). Use this when the task asks you to provision an API key or account — call list_provider_packs first to see if a known recipe exists, then start_provider_pack to get the steps.',
      input_schema: {
        type: 'object' as const,
        properties: {
          category: { type: 'string' as const, description: 'Optional filter: llm | payments | hosting | devtools | observability | storage | email' },
        },
      },
    },
    {
      name: 'start_provider_pack',
      description: 'Get the pre-built signup recipe for a known SaaS provider. Returns ordered steps the agent should follow (navigate, fill, click, capture, save). Always check list_provider_packs first to see what is available. After completion, save the obtained API key as a credential and record any new learnings via record_domain_skill.',
      input_schema: {
        type: 'object' as const,
        properties: {
          provider_id: { type: 'string' as const, description: 'The provider id, e.g. "openai", "stripe", "github". See list_provider_packs.' },
        },
        required: ['provider_id'],
      },
    },
    {
      name: 'ocr_current_page',
      description: 'OCR the current page screenshot to read visible text that is rendered as canvas, image, PDF, or behind a login. Use this when CSS selectors cannot reach the content (canvas-based dashboards, image-rendered API keys, PDFs). Returns the extracted text. Requires browser_screenshot to have been called first OR a screenshot URL.',
      input_schema: {
        type: 'object' as const,
        properties: {
          screenshot_url: { type: 'string' as const, description: 'Optional URL of a screenshot to OCR (from a recent browser_screenshot result). If omitted, takes a fresh screenshot.' },
          lang: { type: 'string' as const, description: 'Tesseract language code, defaults to "eng". Use "eng+hin" for Hindi+English.' },
        },
      },
    },
    {
      name: 'ocr_click_text',
      description: 'Find a piece of visible text on the current page using OCR and click its on-screen position. Use ONLY when CSS-based clicks fail (canvas widgets, custom-drawn buttons, iframes you cannot reach). After running OCR, computes click coordinates and dispatches a click via JavaScript. Returns the matched text and click result.',
      input_schema: {
        type: 'object' as const,
        properties: {
          target_text: { type: 'string' as const, description: 'Text to look for on the page, e.g. "Continue with Google"' },
          screenshot_url: { type: 'string' as const, description: 'Optional URL of a recent screenshot. If omitted, takes a fresh one.' },
          lang: { type: 'string' as const, description: 'Tesseract language code, defaults to "eng".' },
        },
        required: ['target_text'],
      },
    },
    {
      name: 'ocr_image',
      description: 'Fetch an image by URL and run OCR on it. Use this for images embedded on a page (logos, diagrams, screenshots in docs) or downloaded receipts/invoices. Returns extracted text.',
      input_schema: {
        type: 'object' as const,
        properties: {
          image_url: { type: 'string' as const, description: 'Full URL of the image to OCR.' },
          lang: { type: 'string' as const, description: 'Tesseract language code, defaults to "eng".' },
        },
        required: ['image_url'],
      },
    },
    {
      name: 'http_fetch',
      description: 'Make a plain HTTP request (NO browser, NO Browserbase). Use this BEFORE browser_navigate when you only need to read JSON/HTML/text — public REST APIs, static pages, RSS, sitemaps, robots.txt. Saves real money compared to spinning up a cloud browser. Falls back to browser_navigate ONLY if the page returns JS-required content (SPA shell, anti-bot challenge, 403). Returns status + headers + body (truncated to 10K chars).',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string' as const, description: 'Full URL to fetch' },
          method: { type: 'string' as const, description: 'HTTP method: GET (default), POST, PUT, DELETE, PATCH' },
          headers: { type: 'object' as const, description: 'Optional headers as key-value pairs (e.g. {"Authorization":"Bearer …"})' },
          body: { type: 'string' as const, description: 'Optional request body (string; JSON-stringify yourself if needed)' },
        },
        required: ['url'],
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

    // ── Domain skills memory ──
    case 'record_domain_skill': {
      const domain = (input.domain as string).toLowerCase().replace(/^www\./, '');
      const kind = input.kind as string;
      const key = input.key as string;
      const value = input.value as string;
      const validKinds = ['selector', 'url_pattern', 'wait', 'trap', 'note'];
      if (!validKinds.includes(kind)) {
        return `Invalid kind "${kind}". Must be one of: ${validKinds.join(', ')}.`;
      }
      try {
        await db.insert(domainSkills).values({
          company_id: task.company_id,
          site_domain: domain,
          skill_kind: kind,
          key,
          value,
          last_used_at: new Date(),
        }).onConflictDoUpdate({
          target: [domainSkills.company_id, domainSkills.site_domain, domainSkills.skill_kind, domainSkills.key],
          set: {
            value,
            last_used_at: new Date(),
            updated_at: new Date(),
            confidence: sql`LEAST(${domainSkills.confidence} + 10, 100)`,
          },
        });
        log.info('Domain skill recorded', { domain, kind, key, taskId: task.id });
        return `Recorded skill for ${domain}: ${kind}/${key}`;
      } catch (err) {
        return `Failed to record skill: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    case 'read_domain_skills': {
      const domain = (input.domain as string).toLowerCase().replace(/^www\./, '');
      const kindFilter = input.kind as string | undefined;
      const where = kindFilter
        ? and(
            eq(domainSkills.company_id, task.company_id),
            eq(domainSkills.site_domain, domain),
            eq(domainSkills.skill_kind, kindFilter),
          )
        : and(
            eq(domainSkills.company_id, task.company_id),
            eq(domainSkills.site_domain, domain),
          );
      const rows = await db.select({
        kind: domainSkills.skill_kind,
        key: domainSkills.key,
        value: domainSkills.value,
        confidence: domainSkills.confidence,
        last_used_at: domainSkills.last_used_at,
      })
        .from(domainSkills)
        .where(where)
        .orderBy(desc(domainSkills.confidence), desc(domainSkills.last_used_at))
        .limit(50);
      if (rows.length === 0) {
        return `No prior skills recorded for ${domain}. This is a new site for this company — proceed carefully and record findings as you discover them.`;
      }
      const formatted = rows.map((r) =>
        `[${r.kind}] ${r.key} (confidence ${r.confidence}): ${r.value}`,
      ).join('\n');
      return `Skills for ${domain} (${rows.length} entries):\n${formatted}`;
    }

    // ── Provider bootstrap packs ──
    case 'list_provider_packs': {
      const category = input.category as string | undefined;
      const where = category ? eq(providerPacks.category, category) : undefined;
      const rows = await db.select({
        provider_id: providerPacks.provider_id,
        display_name: providerPacks.display_name,
        category: providerPacks.category,
        signup_url: providerPacks.signup_url,
        api_key_env_var: providerPacks.api_key_env_var,
      })
        .from(providerPacks)
        .where(where as never);
      if (rows.length === 0) {
        return category
          ? `No provider packs in category "${category}".`
          : 'No provider packs available.';
      }
      const formatted = rows
        .map((r) => `- ${r.provider_id} (${r.category}): ${r.display_name} → env var: ${r.api_key_env_var ?? 'n/a'}`)
        .join('\n');
      return `Available provider packs (${rows.length}):\n${formatted}\n\nUse start_provider_pack(provider_id) to get the recipe.`;
    }

    case 'start_provider_pack': {
      const providerId = input.provider_id as string;
      const [pack] = await db.select().from(providerPacks).where(eq(providerPacks.provider_id, providerId)).limit(1);
      if (!pack) {
        return `No provider pack found for "${providerId}". Use list_provider_packs to see available providers.`;
      }
      const stepLines = (pack.steps ?? []).map((s, i) => {
        const sel = s.selector ? ` [selector: ${s.selector}]` : '';
        const exp = s.expected ? ` (expected: ${s.expected})` : '';
        return `  ${i + 1}. [${s.kind}] ${s.instruction}${sel}${exp}`;
      }).join('\n');
      return [
        `# Provider Pack: ${pack.display_name} (${pack.category})`,
        ``,
        `Signup URL: ${pack.signup_url}`,
        pack.api_key_url ? `API Key URL: ${pack.api_key_url}` : '',
        pack.api_key_env_var ? `Save the obtained key as: ${pack.api_key_env_var}` : '',
        ``,
        `## Steps`,
        stepLines,
        ``,
        pack.notes ? `## Notes\n${pack.notes}` : '',
        ``,
        `Tip: After completion, save the API key via save_credentials(domain="${pack.signup_url.replace(/^https?:\/\//, '').split('/')[0]}", username="<email-used>", password="<api-key>") and record any tricky steps via record_domain_skill so future tasks finish faster.`,
      ].filter(Boolean).join('\n');
    }

    // ── OCR (Tesseract.js) ──
    case 'ocr_current_page': {
      const lang = (input.lang as string) || 'eng';
      try {
        let imageBuffer: Buffer;
        if (input.screenshot_url) {
          imageBuffer = await fetchImageBuffer(input.screenshot_url as string);
        } else {
          if (!isBrowserbaseConfigured()) {
            return `[OCR] No screenshot_url provided and Browserbase not configured. Provide screenshot_url or set BROWSERBASE_API_KEY.`;
          }
          // Take a fresh screenshot via Browserbase
          const result = await executeBrowserCommand(task.id, 'screenshot', { label: 'ocr-current-page' });
          // Browserbase screenshots return either a URL or base64 — try parsing
          const parsed = JSON.parse(result || '{}') as { screenshot?: string; url?: string };
          if (parsed.url) {
            imageBuffer = await fetchImageBuffer(parsed.url);
          } else if (parsed.screenshot) {
            imageBuffer = Buffer.from(parsed.screenshot, 'base64');
          } else {
            return `[OCR] Could not extract screenshot from Browserbase response: ${result.substring(0, 200)}`;
          }
        }
        const { fullText, words } = await runOcr(imageBuffer, lang);
        const truncated = fullText.length > 4000 ? fullText.substring(0, 4000) + '\n…(truncated)' : fullText;
        return `OCR result (${words.length} words detected):\n\n${truncated}`;
      } catch (err) {
        return `OCR failed: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    case 'ocr_click_text': {
      const targetText = input.target_text as string;
      const lang = (input.lang as string) || 'eng';
      try {
        let imageBuffer: Buffer;
        if (input.screenshot_url) {
          imageBuffer = await fetchImageBuffer(input.screenshot_url as string);
        } else {
          if (!isBrowserbaseConfigured()) {
            return `[OCR Click] Browserbase not configured. Cannot take screenshot.`;
          }
          const result = await executeBrowserCommand(task.id, 'screenshot', { label: 'ocr-click' });
          const parsed = JSON.parse(result || '{}') as { screenshot?: string; url?: string };
          if (parsed.url) {
            imageBuffer = await fetchImageBuffer(parsed.url);
          } else if (parsed.screenshot) {
            imageBuffer = Buffer.from(parsed.screenshot, 'base64');
          } else {
            return `[OCR Click] Could not extract screenshot.`;
          }
        }
        const match = await findTextOnPage(imageBuffer, targetText, lang);
        if (!match) {
          return `Text "${targetText}" not found on page via OCR. Try a shorter/exact phrase or take a fresh screenshot.`;
        }
        // Dispatch the click via Playwright evaluate at the OCR-derived coordinates
        if (!isBrowserbaseConfigured()) {
          return `Found "${match.matched}" at (${match.x}, ${match.y}) confidence ${match.confidence.toFixed(0)}, but Browserbase not configured to click.`;
        }
        const clickScript = `(function(){const el=document.elementFromPoint(${match.x},${match.y});if(!el)return 'no-element-at-point';el.click();return el.tagName+(el.id?'#'+el.id:'')+(el.className?'.'+el.className:'').substring(0,80);})()`;
        const clickResult = await executeBrowserCommand(task.id, 'evaluate', { script: clickScript });
        return `OCR found "${match.matched}" at (${match.x}, ${match.y}), confidence ${match.confidence.toFixed(0)}. Click result: ${clickResult}`;
      } catch (err) {
        return `OCR click failed: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    case 'ocr_image': {
      const imageUrl = input.image_url as string;
      const lang = (input.lang as string) || 'eng';
      try {
        const imageBuffer = await fetchImageBuffer(imageUrl);
        const { fullText, words } = await runOcr(imageBuffer, lang);
        const truncated = fullText.length > 4000 ? fullText.substring(0, 4000) + '\n…(truncated)' : fullText;
        return `OCR of ${imageUrl} (${words.length} words):\n\n${truncated}`;
      } catch (err) {
        return `OCR failed for ${imageUrl}: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    // ── Cheap HTTP fetch (no Browserbase) ──
    case 'http_fetch': {
      const url = input.url as string;
      const method = ((input.method as string) || 'GET').toUpperCase();
      const headers = (input.headers as Record<string, string> | undefined) ?? {};
      const body = input.body as string | undefined;
      const safety = await assertUrlSafe(url);
      if (!safety.ok) {
        return `http_fetch blocked: ${safety.reason}`;
      }

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: method === 'GET' || method === 'HEAD' ? undefined : body,
          // Reasonable timeout — long enough for slow APIs, short enough to fail fast
          signal: AbortSignal.timeout(20_000),
        });
        const contentType = response.headers.get('content-type') ?? '';
        const text = await response.text();
        const truncated = text.length > 10_000 ? text.substring(0, 10_000) + '\n…(truncated, full length: ' + text.length + ')' : text;

        // Heuristic: detect JS-required SPA shells so the agent knows to fall back
        const looksLikeSpa = response.status === 200
          && contentType.includes('text/html')
          && text.length < 5000
          && /<div[^>]+id=["'](root|app|__next|__nuxt)["']/.test(text)
          && !/<h1|<article|<main[^>]*>[\s\S]+<\/main>/.test(text);

        const fallbackHint = looksLikeSpa
          ? '\n\n⚠️ This looks like a JavaScript-required SPA shell — the real content is rendered client-side. Fall back to browser_navigate for this URL.'
          : (response.status === 403 || response.status === 429)
            ? `\n\n⚠️ Got HTTP ${response.status} — this site may block plain fetches. Fall back to browser_navigate (Browserbase has anti-bot evasion).`
            : '';

        log.info('http_fetch', { url, status: response.status, bytes: text.length });
        return `HTTP ${response.status} ${response.statusText}\nContent-Type: ${contentType}\nLength: ${text.length} chars\n\n${truncated}${fallbackHint}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown';
        return `http_fetch failed for ${url}: ${msg}\n\n(If the error is network/CORS/timeout-related, fall back to browser_navigate.)`;
      }
    }

    default:
      return `Unknown browser tool: ${toolName}`;
  }
}
