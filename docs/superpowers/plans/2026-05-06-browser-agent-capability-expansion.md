# Browser Agent Capability Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 high-value capabilities to the Baljia Browser Agent (id 42) — Domain Skills Memory, Provider Bootstrap Packs, CAPTCHA Solving, and OCR — adapted from the standalone Browsing Agent reference at `C:/Users/Vaishnavi/My_Projects/Browsing_agent`. Phase 1 (Domain Skills) ships in this plan; Phases 2–4 require external API keys / additional cost decisions and are scoped here but executed later.

**Architecture:**
- Database: a single new `domain_skills` table (Drizzle / Neon) keyed on `(company_id, site_domain, skill_kind)` — additive schema only, no destructive changes.
- Tool surface: 2 new tools (`record_domain_skill`, `read_domain_skills`) added to `getBrowserTools()` and routed through the existing `case` switch in `browser.tools.ts`.
- Tool registries: tool names registered in `BROWSER_TOOLS` set in `agent-factory.ts`, the `42:` capabilities row in `ceo.tool-handlers.ts`, and the `browser:` row in `platform-ops.tool-handlers.ts`.
- Agent prompt: a new "Domain Skills" section appended to the Browser agent prompt at `agent-factory.ts:187` instructing the agent to read skills before navigating, and record skills after a successful interaction.
- Tests: Vitest unit tests mirroring the pattern in `src/lib/agents/ceo/ceo.tool-handlers.tasks.test.ts` (mocks for `@/lib/db`, `drizzle-orm`, `@/lib/logger`).

**Tech Stack:** TypeScript, Next.js 15, Drizzle ORM 0.45, Neon Postgres, Vitest 4.1, Browserbase SDK.

---

## Phase Roadmap

| Phase | Capability | External cost / dep | Status |
|---|---|---|---|
| **Phase 1** | Domain Skills Memory | None | **In this plan — execute now** |
| Phase 2 | Provider Bootstrap Packs | None (recipe content only) | Scoped below — execute after Phase 1 lands |
| Phase 3 | CAPTCHA Solving | 2captcha API key (~$3 / 1000 solves) | User must obtain key first |
| Phase 4 | OCR Tools | Google Vision API key OR Tesseract WASM | User decides cost vs accuracy |

Phase 1 is fully implementable today and is the **only phase with concrete tasks below**. Phases 2–4 are described at the end as follow-up work.

---

## File Structure (Phase 1)

| File | Responsibility | Action |
|---|---|---|
| `src/lib/db/schema.ts` | Drizzle schema | **Modify**: append `domainSkills` table |
| `src/lib/db/index.ts` | Re-exports | **Modify**: re-export `domainSkills` |
| `drizzle/00NN_*.sql` | Migration SQL | **Create** via `npm run db:generate` |
| `src/lib/agents/tools/browser.tools.ts` | Tool defs + handlers | **Modify**: append 2 tool defs + 2 handler cases |
| `src/lib/agents/tools/browser.tools.test.ts` | Unit tests for new handlers | **Create** |
| `src/lib/agents/agent-factory.ts` | Agent prompts + tool registry | **Modify**: prompt at line 187, `BROWSER_TOOLS` set at line 1243 |
| `src/lib/agents/ceo/ceo.tool-handlers.ts` | Capabilities matrix (CEO uses for find_best_agent) | **Modify**: row 42 tool list at line 137 |
| `src/lib/agents/tools/platform-ops.tool-handlers.ts` | Tool inventory for ops | **Modify**: `browser:` row at line 15 |

Boundaries: each task below produces a self-contained, testable change committed independently. The schema change (Task 1) lands before any code that references it.

---

## Phase 1 — Domain Skills Memory

### Task 1: Add `domain_skills` table to Drizzle schema

**Files:**
- Modify: `src/lib/db/schema.ts` (append after `browserCredentials` at line 490)
- Modify: `src/lib/db/index.ts` (re-export new table)

- [ ] **Step 1: Add the table definition**

Append this block to `src/lib/db/schema.ts` immediately after the `browserCredentials` table (around line 490, before the comment "FAILURE FINGERPRINTS"):

```ts
// ══════════════════════════════════════════════
// DOMAIN SKILLS — cross-task memory of site selectors / patterns / traps
// ══════════════════════════════════════════════
export const domainSkills = pgTable('domain_skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  site_domain: varchar('site_domain', { length: 255 }).notNull(),
  skill_kind: varchar('skill_kind', { length: 50 }).notNull(), // 'selector' | 'url_pattern' | 'wait' | 'trap' | 'note'
  key: varchar('key', { length: 255 }).notNull(),               // e.g. 'login_button', 'home_url', 'captcha_appears_at'
  value: text('value').notNull(),                                // the actual selector / URL pattern / instruction
  confidence: integer('confidence').default(50),                 // 0-100, increments on success / decrements on miss
  last_used_at: timestamp('last_used_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('idx_domain_skills_unique').on(t.company_id, t.site_domain, t.skill_kind, t.key),
  index('idx_domain_skills_lookup').on(t.company_id, t.site_domain),
]);
```

- [ ] **Step 2: Confirm imports already cover what's needed**

The schema file already imports `pgTable, uuid, varchar, text, integer, timestamp, uniqueIndex, index` from `drizzle-orm/pg-core`. Skim the top of `src/lib/db/schema.ts` to confirm — do not add duplicate imports.

- [ ] **Step 3: Re-export from `src/lib/db/index.ts`**

Find the existing re-exports of `browserCredentials` in `src/lib/db/index.ts` and add `domainSkills` next to it. Search for `browserCredentials` and append `domainSkills` to the same export block in alphabetical order.

- [ ] **Step 4: Generate migration**

Run: `npm run db:generate`

Expected: A new file appears in `drizzle/` named like `00NN_<auto_word>.sql` containing `CREATE TABLE "domain_skills" (...)`.

- [ ] **Step 5: Apply migration to dev database**

Run: `npm run db:push`

Expected: Drizzle Kit prints `Changes applied` (or asks for confirmation; answer yes). The table exists in Neon.

- [ ] **Step 6: Sanity-check the table exists**

Run: `npx tsx --env-file=.env.local -e "import { db, domainSkills } from './src/lib/db'; (async () => { const r = await db.select().from(domainSkills).limit(1); console.log('OK rows:', r.length); })();"`

Expected: prints `OK rows: 0` (or rows already there if dev data exists). No errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/index.ts drizzle/
git commit -m "feat(browser): add domain_skills table for cross-task site memory"
```

---

### Task 2: Add the 2 tool definitions to `getBrowserTools()`

**Files:**
- Modify: `src/lib/agents/tools/browser.tools.ts` (append after the last tool def in `getBrowserTools()`, before the closing `];`)

- [ ] **Step 1: Add `record_domain_skill` tool definition**

Locate `getBrowserTools()` in `src/lib/agents/tools/browser.tools.ts`. Find the last tool definition `delete_browser_context` (around line 355) and add these two new entries immediately before the closing `];` of the returned array:

```ts
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
```

- [ ] **Step 2: Verify the tools array still type-checks**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "browser\.tools\.ts" | head -5`

Expected: no errors mentioning `browser.tools.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agents/tools/browser.tools.ts
git commit -m "feat(browser): add record_domain_skill + read_domain_skills tool definitions"
```

---

### Task 3: Implement the 2 handler cases

**Files:**
- Modify: `src/lib/agents/tools/browser.tools.ts` (append into the existing `switch` statement, after `case 'delete_browser_context':`)

- [ ] **Step 1: Add domain_skills import**

At the top of `src/lib/agents/tools/browser.tools.ts`, find the line:

```ts
import { db, browserCredentials } from '@/lib/db';
```

Replace it with:

```ts
import { db, browserCredentials, domainSkills } from '@/lib/db';
```

Also locate the `eq, and` import from `drizzle-orm` and confirm `desc` is imported. If not, change:

```ts
import { eq, and } from 'drizzle-orm';
```

to:

```ts
import { eq, and, desc, sql } from 'drizzle-orm';
```

- [ ] **Step 2: Find the dispatch switch's end**

Locate the existing `case 'delete_browser_context':` handler in `browser.tools.ts` (it appears after the `list_browser_contexts` case). The `switch` block ends with a `default:` arm. Add the two new cases immediately before the `default:`.

- [ ] **Step 3: Add `record_domain_skill` handler**

Insert this case before `default:`:

```ts
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
```

- [ ] **Step 4: Add `read_domain_skills` handler**

Insert this case immediately after the `record_domain_skill` case:

```ts
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
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "browser\.tools\.ts" | head -10`

Expected: no errors. If `sql` was not imported (Task 3 Step 1), errors will surface here — fix the import.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/tools/browser.tools.ts
git commit -m "feat(browser): wire record_domain_skill + read_domain_skills handlers"
```

---

### Task 4: Register the new tools in 3 inventory locations

**Files:**
- Modify: `src/lib/agents/agent-factory.ts:1243` (`BROWSER_TOOLS` set)
- Modify: `src/lib/agents/ceo/ceo.tool-handlers.ts:137` (capabilities matrix row for agent 42)
- Modify: `src/lib/agents/tools/platform-ops.tool-handlers.ts:15` (`browser:` row)

- [ ] **Step 1: Update `BROWSER_TOOLS` set in `agent-factory.ts`**

Find the block starting `const BROWSER_TOOLS = new Set([` (around line 1243). Add `'record_domain_skill', 'read_domain_skills'` to the set. The result should look like:

```ts
const BROWSER_TOOLS = new Set([
  'browser_navigate', 'browser_screenshot', 'browser_click', 'browser_fill',
  'browser_extract', 'browser_get_content', 'browser_evaluate',
  'get_site_tier', 'save_credentials', 'get_credentials',
  // Browser auth tools
  'generate_password', 'get_company_email', 'check_verification_inbox',
  'verify_credentials', 'list_stored_credentials',
  'get_or_create_browser_context', 'list_browser_contexts', 'delete_browser_context',
  // Domain skills memory
  'record_domain_skill', 'read_domain_skills',
]);
```

- [ ] **Step 2: Update CEO capabilities matrix in `ceo.tool-handlers.ts`**

Find the line at `src/lib/agents/ceo/ceo.tool-handlers.ts:137` starting `42: { can: [...], cant: [...], tools: [...] }`. Add the two new tools to the `tools:` array. Also add `'Site memory across tasks'` to the `can:` array. The result should look like:

```ts
42: { can: ['Navigate websites', 'Fill forms', 'Take screenshots', 'Extract data', 'Account signup', 'Password generation', 'Credential management', 'Verification email polling', 'Browser context reuse', 'Site memory across tasks'], cant: ['2FA automation', 'Desktop apps', 'PDF workflows', 'Multi-tab research'], tools: ['browser_navigate','browser_screenshot','browser_click','browser_fill','browser_extract','browser_get_content','browser_evaluate','get_site_tier','save_credentials','get_credentials','generate_password','get_company_email','check_verification_inbox','verify_credentials','list_stored_credentials','list_browser_contexts','delete_browser_context','record_domain_skill','read_domain_skills'] },
```

- [ ] **Step 3: Update platform-ops inventory at `platform-ops.tool-handlers.ts:15`**

Find the `browser:` row in the tool inventory (line 15). Append `'record_domain_skill','read_domain_skills'` to its array. The result should look like:

```ts
browser: ['browser_navigate','browser_screenshot','browser_click','browser_fill','browser_extract','browser_get_content','browser_evaluate','get_site_tier','save_credentials','get_credentials','generate_password','get_company_email','check_verification_inbox','verify_credentials','list_stored_credentials','list_browser_contexts','delete_browser_context','record_domain_skill','read_domain_skills'],
```

- [ ] **Step 4: Type-check + smoke-check**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "(agent-factory|tool-handlers)" | head -10`

Expected: no errors in these files.

Also run the existing CEO capabilities test which references this matrix:

`npx vitest run src/lib/agents/ceo/ceo.tool-handlers.capabilities-recurring.test.ts`

Expected: all tests pass. If a test asserts a specific tool count on agent 42, it may now need an update — fix the test rather than skipping it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/agent-factory.ts src/lib/agents/ceo/ceo.tool-handlers.ts src/lib/agents/tools/platform-ops.tool-handlers.ts
git commit -m "feat(browser): register domain_skill tools in agent + CEO + ops inventories"
```

---

### Task 5: Update the Browser Agent prompt to teach skill-use

**Files:**
- Modify: `src/lib/agents/agent-factory.ts:187` (Browser Agent prompt for id 42)

- [ ] **Step 1: Replace the existing prompt block**

Locate the entire prompt at `agent-factory.ts:187` for agent 42. The current text reads:

```ts
  42: `You are the Browser Agent for Baljia AI. You automate web browsing tasks.

## Your Capabilities
- Navigate websites, fill forms, take screenshots
- Extract data from web pages
- Account setup and verification
- Web scraping and content extraction

## Rules
1. Check site tier before any action (Tier 1 = browse-only for social media)
2. One task = one browser session
3. Save credentials after successful account creation
4. No 2FA support, no desktop apps, no PDF workflows
5. Take screenshots as verification evidence`,
```

Replace it entirely with:

```ts
  42: `You are the Browser Agent for Baljia AI. You automate web browsing tasks.

## Your Capabilities
- Navigate websites, fill forms, take screenshots
- Extract data from web pages
- Account setup and verification
- Web scraping and content extraction
- Persistent site memory across tasks

## Site Memory — read BEFORE you navigate
Baljia accumulates per-site knowledge over time: working selectors, URL patterns, gotchas (CAPTCHAs, redirects, slow loads), notes on multi-step flows. Use this memory to avoid re-discovering the same site every task.

1. Before \`browser_navigate\` to any site you have not interacted with in this task, call \`read_domain_skills(domain=...)\`. Treat returned skills as hints, not gospel — sites change.
2. After a successful interaction, record what you learned with \`record_domain_skill\`. Examples:
   - kind=\"selector\", key=\"login_button\", value=\"button[data-test=login-submit]\"
   - kind=\"url_pattern\", key=\"dashboard_url\", value=\"https://app.example.com/d/{user_id}\"
   - kind=\"trap\", key=\"captcha_on_signup\", value=\"hCaptcha appears AFTER email submit, not before\"
   - kind=\"wait\", key=\"after_login\", value=\"page reloads twice; wait for [data-loaded=true]\"
   - kind=\"note\", key=\"signup_blocked_for_gmail\", value=\"hunter.io rejects @gmail.com — use @baljia.app instead\"
3. Never record secrets in domain skills. Use \`save_credentials\` for usernames/passwords.

## Rules
1. Check site tier before any action (Tier 1 = browse-only for social media)
2. One task = one browser session
3. Save credentials after successful account creation
4. No 2FA support, no desktop apps, no PDF workflows
5. Take screenshots as verification evidence`,
```

- [ ] **Step 2: Type-check (the prompt is a template string — typos in backslash-escapes will break it)**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "agent-factory" | head -5`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agents/agent-factory.ts
git commit -m "feat(browser): teach Browser agent to read + record domain skills"
```

---

### Task 6: Write Vitest unit tests for the 2 new handlers

**Files:**
- Create: `src/lib/agents/tools/browser.tools.test.ts`

This file is new. The test pattern mirrors `src/lib/agents/ceo/ceo.tool-handlers.tasks.test.ts` — mock `@/lib/db`, `drizzle-orm`, `@/lib/logger`, then dynamically import the handler module so mocks are applied first.

- [ ] **Step 1: Find the entry point of the dispatch switch**

Open `src/lib/agents/tools/browser.tools.ts` and find the exported function that wraps the dispatch switch. It is `executeBrowserTool` (search for `export async function executeBrowserTool` or `export function handleBrowserTool` — the exact name lives in this file). If the dispatch lives inside a non-exported function, export it now (just add `export`).

If after searching the only top-level exports are `getBrowserTools` (definitions only) and a separate handler function, identify the handler function name. (As of this writing it is named `executeBrowserTool`. If it is different, replace `executeBrowserTool` in every code block below with the actual exported name.)

- [ ] **Step 2: Create the test file with the mock scaffold**

Create `src/lib/agents/tools/browser.tools.test.ts`:

```ts
// Unit tests for the Browser Agent domain-skills tool handlers.
// Mocks @/lib/db (Drizzle fluent API), drizzle-orm, and @/lib/logger so handlers
// can be exercised without a real DB connection.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB mock chains ─────────────────────────────────────────────────────────
const insertChain = {
  values: vi.fn(),
  onConflictDoUpdate: vi.fn(),
};
const selectChain = {
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
};

// Make every chain method return its parent so the fluent calls work
insertChain.values.mockReturnValue(insertChain);
insertChain.onConflictDoUpdate.mockResolvedValue(undefined);
selectChain.from.mockReturnValue(selectChain);
selectChain.where.mockReturnValue(selectChain);
selectChain.orderBy.mockReturnValue(selectChain);
selectChain.limit.mockResolvedValue([]); // default: empty result

vi.mock('@/lib/db', () => ({
  db: {
    insert: vi.fn(() => insertChain),
    select: vi.fn(() => selectChain),
  },
  domainSkills: {
    company_id: 'company_id',
    site_domain: 'site_domain',
    skill_kind: 'skill_kind',
    key: 'key',
    value: 'value',
    confidence: 'confidence',
    last_used_at: 'last_used_at',
  },
  browserCredentials: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  and: (...args: unknown[]) => ({ __and: args }),
  desc: (a: unknown) => ({ __desc: a }),
  sql: Object.assign((strings: TemplateStringsArray) => ({ __sql: strings.raw }), {}),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Helper to construct a minimal Task object the handlers need.
function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-uuid-1',
    company_id: 'company-uuid-1',
    ...overrides,
  } as unknown as Parameters<typeof import('./browser.tools').executeBrowserTool>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset chain returns
  insertChain.values.mockReturnValue(insertChain);
  insertChain.onConflictDoUpdate.mockResolvedValue(undefined);
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.orderBy.mockReturnValue(selectChain);
  selectChain.limit.mockResolvedValue([]);
});

describe('record_domain_skill', () => {
  it('records a valid skill and reports success', async () => {
    const { executeBrowserTool } = await import('./browser.tools');
    const result = await executeBrowserTool(makeTask(), 'record_domain_skill', {
      domain: 'hunter.io',
      kind: 'selector',
      key: 'login_button',
      value: 'button[type=submit]',
    });
    expect(result).toContain('Recorded skill for hunter.io');
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: 'company-uuid-1',
        site_domain: 'hunter.io',
        skill_kind: 'selector',
        key: 'login_button',
        value: 'button[type=submit]',
      }),
    );
  });

  it('rejects an invalid kind', async () => {
    const { executeBrowserTool } = await import('./browser.tools');
    const result = await executeBrowserTool(makeTask(), 'record_domain_skill', {
      domain: 'hunter.io',
      kind: 'banana',
      key: 'x',
      value: 'y',
    });
    expect(result).toContain('Invalid kind');
    expect(insertChain.values).not.toHaveBeenCalled();
  });

  it('normalises the domain (strips www, lowercases)', async () => {
    const { executeBrowserTool } = await import('./browser.tools');
    await executeBrowserTool(makeTask(), 'record_domain_skill', {
      domain: 'WWW.Hunter.IO',
      kind: 'note',
      key: 'k',
      value: 'v',
    });
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ site_domain: 'hunter.io' }),
    );
  });
});

describe('read_domain_skills', () => {
  it('returns a friendly message when no skills exist', async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    const { executeBrowserTool } = await import('./browser.tools');
    const result = await executeBrowserTool(makeTask(), 'read_domain_skills', {
      domain: 'hunter.io',
    });
    expect(result).toContain('No prior skills recorded for hunter.io');
  });

  it('formats stored skills', async () => {
    selectChain.limit.mockResolvedValueOnce([
      { kind: 'selector', key: 'login', value: '#login-btn', confidence: 70, last_used_at: new Date() },
      { kind: 'note', key: 'gotcha', value: 'rejects gmail', confidence: 50, last_used_at: new Date() },
    ]);
    const { executeBrowserTool } = await import('./browser.tools');
    const result = await executeBrowserTool(makeTask(), 'read_domain_skills', {
      domain: 'hunter.io',
    });
    expect(result).toContain('Skills for hunter.io (2 entries)');
    expect(result).toContain('[selector] login');
    expect(result).toContain('[note] gotcha');
  });

  it('applies the kind filter when provided', async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    const { executeBrowserTool } = await import('./browser.tools');
    await executeBrowserTool(makeTask(), 'read_domain_skills', {
      domain: 'hunter.io',
      kind: 'selector',
    });
    // The third positional arg to and() should include the skill_kind eq
    const whereCallArgs = (selectChain.where as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { __and: unknown[] };
    expect(whereCallArgs.__and).toHaveLength(3); // company_id + site_domain + kind
  });
});
```

- [ ] **Step 3: Run the tests, confirm they fail with a clear reason if the handler is not yet exported**

Run: `npx vitest run src/lib/agents/tools/browser.tools.test.ts`

If `executeBrowserTool` is not exported from `browser.tools.ts`, the import in the test file fails. Fix by adding `export` to the function declaration in `browser.tools.ts`. Re-run.

Expected after fix: 6 tests pass.

- [ ] **Step 4: If the dispatcher's exported name is something other than `executeBrowserTool`, update the test imports**

Search: `grep -nE "export (async )?function.*Browser" src/lib/agents/tools/browser.tools.ts`

Use whatever name appears. Replace `executeBrowserTool` in the test file with that name. Re-run.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/tools/browser.tools.test.ts
git commit -m "test(browser): unit tests for record_domain_skill + read_domain_skills"
```

---

### Task 7: End-to-end smoke test against the real DB

**Files:**
- Create: `src/scripts/test-domain-skills.ts`

- [ ] **Step 1: Write the smoke script**

Create `src/scripts/test-domain-skills.ts`:

```ts
// Smoke test: hit the real Neon DB and verify the two domain-skill handlers
// produce the expected rows. Run with:
//   npx tsx --env-file=.env.local src/scripts/test-domain-skills.ts
//
// Cleans up after itself by deleting the test rows it inserts.

import { db, domainSkills, companies } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { executeBrowserTool } from '@/lib/agents/tools/browser.tools';

async function main() {
  // Find any company to attach test skills to
  const [company] = await db.select().from(companies).limit(1);
  if (!company) {
    console.error('No company in DB — create one first.');
    process.exit(1);
  }
  console.log('Using company:', company.id);

  const task = { id: 'smoke-task', company_id: company.id } as never;
  const TEST_DOMAIN = '__smoke_test_domain.example';

  // 1. Record
  const r1 = await executeBrowserTool(task, 'record_domain_skill', {
    domain: TEST_DOMAIN,
    kind: 'selector',
    key: 'login_button',
    value: '#login',
  });
  console.log('record:', r1);
  if (!r1.includes('Recorded')) throw new Error('record failed');

  // 2. Read back
  const r2 = await executeBrowserTool(task, 'read_domain_skills', {
    domain: TEST_DOMAIN,
  });
  console.log('read:', r2);
  if (!r2.includes('login_button')) throw new Error('read failed to surface skill');

  // 3. Filter
  const r3 = await executeBrowserTool(task, 'read_domain_skills', {
    domain: TEST_DOMAIN,
    kind: 'note',
  });
  console.log('filter:', r3);
  if (!r3.includes('No prior skills')) throw new Error('kind filter did not narrow');

  // 4. Idempotent re-record bumps confidence
  const r4 = await executeBrowserTool(task, 'record_domain_skill', {
    domain: TEST_DOMAIN,
    kind: 'selector',
    key: 'login_button',
    value: '#login-v2',
  });
  console.log('rerecord:', r4);

  // 5. Cleanup
  await db.delete(domainSkills).where(
    and(
      eq(domainSkills.company_id, company.id),
      eq(domainSkills.site_domain, TEST_DOMAIN),
    ),
  );
  console.log('Cleaned up. All 4 steps passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the smoke test**

Run: `npx tsx --env-file=.env.local src/scripts/test-domain-skills.ts`

Expected output ends with `Cleaned up. All 4 steps passed.`

If it fails on `read failed to surface skill`, the most likely cause is a column name mismatch between schema and the SELECT — re-check Task 1 step 1 and Task 3 step 4.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/test-domain-skills.ts
git commit -m "test(browser): real-DB smoke script for domain skills"
```

---

### Task 8: Update CLAUDE.md to document the new capability

**Files:**
- Modify: `CLAUDE.md` (the "9 Agents" table for Browser, and the Memory System section)

- [ ] **Step 1: Update the "9 Agents" table for Browser**

Find the table row for Browser (id 42) in `CLAUDE.md` — it currently lists:

```
| 42 | Browser | 200 | structured | Browserbase (9 tools), browser auth (11), form filling, scraping |
```

Update the tools description to:

```
| 42 | Browser | 200 | structured | Browserbase (7), browser auth (8), browser context (3), domain skills (2), form filling, scraping |
```

- [ ] **Step 2: Add a new bullet to the "Memory System" section**

Find the "Memory System" section in `CLAUDE.md`. Below the "Learnings" subsection, add:

```
**Domain skills (Browser agent only):** Cross-task memory of what works on each site. Stored in `domain_skills` (company-scoped). Five kinds: `selector`, `url_pattern`, `wait`, `trap`, `note`. Browser agent must call `read_domain_skills` before navigating to a site, and `record_domain_skill` after a successful interaction. Confidence increments on each successful re-record (max 100). Never store secrets here — use `save_credentials`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document Browser agent domain skills memory in CLAUDE.md"
```

---

## Phase 1 Done — verification gate

After Tasks 1–8 land:

- `npm test` passes (no regressions in existing 96 unit tests)
- `npx vitest run src/lib/agents/tools/browser.tools.test.ts` passes (6 new tests)
- `npx tsx --env-file=.env.local src/scripts/test-domain-skills.ts` ends with "All 4 steps passed."
- `domain_skills` table exists in Neon (visible in `npm run db:studio`)
- The Browser agent prompt at `agent-factory.ts:187` mentions "Site Memory"
- `BROWSER_TOOLS` set has 20 entries (was 18)

---

## Phase 2 — Provider Bootstrap Packs (scoped, not built here)

**What:** Pre-built signup recipes for OpenAI, Anthropic, Stripe, Render, GitHub, Postmark, Sentry, Cloudflare R2 — so when the Engineering or Browser agent needs an account at one of these providers, it follows a known-good path instead of re-discovering each time.

**Approach when ready to build:**
1. Add a `providerPacks` table in schema (kind: `recipe`, content: JSON with steps).
2. Seed via a migration with the 8 recipes (port from `provider_bootstrap_packs.py` in the reference agent).
3. New tool `start_provider_pack(provider_id)` returns the recipe steps for the agent to follow.
4. New tool `record_provider_secret(provider_id, label, value)` saves obtained API keys via existing `provider_secrets` table (which we may need to add).
5. Browser agent prompt update: "If task is `provision API key for <provider>`, first call `start_provider_pack(<provider>)`."

**No external API cost.** ~800 LOC. Deferred until Phase 1 lands and stabilises.

---

## Phase 3 — CAPTCHA Solving (scoped, blocked on user)

**What:** Detect and solve image / reCAPTCHA / hCaptcha / Turnstile challenges via the 2captcha service, with manual-pause fallback.

**Blocker:** User must obtain a 2captcha API key (~$3 / 1000 solves) and add `TWOCAPTCHA_API_KEY` to `.env.local`.

**Approach when ready to build:**
1. New tool `solve_captcha(type, sitekey, page_url)` calls 2captcha's `/in.php` then polls `/res.php`.
2. New tool `detect_captcha_on_page()` runs heuristics (look for known iframes, sitekey attributes).
3. Browser agent prompt update: "On any signup or auth flow, run `detect_captcha_on_page` before submitting forms."
4. If 2captcha is not configured, fall back to a `manual_intervention` task that pauses the run and pings the founder.

**~400 LOC.** Deferred until user provides the API key.

---

## Phase 4 — OCR Tools (scoped, blocked on user decision)

**What:** Read text from screenshots and click visible text on canvas/PDF/iframe content where DOM selectors don't work.

**Blocker:** User must choose between:
- **Google Vision API** — best accuracy, ~$1.50 / 1000 images, needs `GOOGLE_VISION_API_KEY`.
- **Tesseract.js (WASM)** — free, runs in-process, mediocre accuracy on dense text.

**Approach when ready to build:**
1. New tool `ocr_current_page()` — screenshots the visible viewport, runs OCR, returns text + bounding boxes.
2. New tool `ocr_click_text(text)` — finds the text in the OCR result, computes click coordinates, dispatches a click via `browser_evaluate`.
3. New tool `ocr_image(url)` — pulls an image by URL, runs OCR, returns text only.

**~500 LOC.** Deferred until user picks a provider.

---

## Self-Review

**Spec coverage:** ✓ Phase 1 has tasks for schema (Task 1), tool defs (Task 2), handlers (Task 3), 3 inventory updates (Task 4), prompt update (Task 5), unit tests (Task 6), e2e smoke (Task 7), docs (Task 8). Phases 2–4 are explicitly scoped as not built here, with their blockers called out.

**Placeholder scan:** ✓ Every code step contains the actual code to paste — no "TBD", no "similar to above", no "add appropriate handling".

**Type consistency:** ✓ The handler uses `domainSkills` (matches schema export). The tool names `record_domain_skill` / `read_domain_skills` are consistent across tool defs (Task 2), handlers (Task 3), tool registries (Task 4), prompt (Task 5), tests (Task 6), and smoke script (Task 7). Column names (`skill_kind`, `key`, `value`, `confidence`, `last_used_at`) are consistent between schema (Task 1) and SELECT projection (Task 3 step 4).

**Identified risk:** Task 6 step 1 hedges on the exact name of the dispatch function. If the codebase actually uses a different export name, the test will fail to import — Step 4 of the same task tells the engineer how to recover.
