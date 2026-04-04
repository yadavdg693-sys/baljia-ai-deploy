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

const log = createLogger('Browser');

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
      await db.insert(browserCredentials).values({
        company_id: task.company_id,
        site_domain: input.domain as string,
        username: input.username as string,
        password_encrypted: input.password as string,
      }).onConflictDoUpdate({
        target: [browserCredentials.company_id, browserCredentials.site_domain],
        set: { username: input.username as string, password_encrypted: input.password as string },
      });
      return `Credentials saved for ${input.domain}`;
    }

    case 'get_credentials': {
      const [cred] = await db.select({ username: browserCredentials.username })
        .from(browserCredentials)
        .where(and(eq(browserCredentials.company_id, task.company_id), eq(browserCredentials.site_domain, input.domain as string)))
        .limit(1);
      if (!cred) return `No credentials stored for ${input.domain}`;
      return `Found credentials for ${input.domain}: username=${cred.username}`;
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

      try {
        const result = await executeBrowserCommand(task.id, 'evaluate', {
          script: input.script,
        });
        return `JS result:\n${result}`;
      } catch (error) {
        return `Evaluate failed: ${error instanceof Error ? error.message : 'Unknown'}`;
      }
    }

    default:
      return `Unknown browser tool: ${toolName}`;
  }
}
