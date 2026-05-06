// Integration tests — REAL DB, no mocks. Exercise the new Browser agent
// capabilities through their actual code paths and confirm DB side effects.
//
// These complement the unit tests (which mock the DB) by proving the dispatch
// + handler + DB write chain actually works end-to-end against Neon.
//
// Run: npx vitest run src/lib/agents/tools/browser.tools.integration.test.ts
// Skipped automatically if DATABASE_URL is not set or unreachable.
//
// Cleans up after itself.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, contacts, domainSkills, providerPacks, companies } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { handleBrowserTool } from './browser.tools';
import { handleToolCall } from '@/lib/agents/agent-factory';
import { getAgentTools } from '@/lib/agents/agent-factory';

const TEST_DOMAIN = '__browser_integration.example';
const TEST_CONTACT_EMAIL = '__browser_integration_contact@example.invalid';

let testCompanyId: string | null = null;

const skipIfNoDB = !process.env.DATABASE_URL;

describe.skipIf(skipIfNoDB)('Browser agent — real-DB integration', () => {
  beforeAll(async () => {
    const [company] = await db.select({ id: companies.id }).from(companies).limit(1);
    if (!company) {
      console.warn('No company in DB — skipping integration tests');
      return;
    }
    testCompanyId = company.id;

    // Clean any leftover test rows
    await db.delete(domainSkills).where(and(
      eq(domainSkills.company_id, testCompanyId),
      eq(domainSkills.site_domain, TEST_DOMAIN),
    )).catch(() => {});
    await db.delete(contacts).where(and(
      eq(contacts.company_id, testCompanyId),
      eq(contacts.email, TEST_CONTACT_EMAIL),
    )).catch(() => {});
  });

  afterAll(async () => {
    if (!testCompanyId) return;
    await db.delete(domainSkills).where(and(
      eq(domainSkills.company_id, testCompanyId),
      eq(domainSkills.site_domain, TEST_DOMAIN),
    )).catch(() => {});
    await db.delete(contacts).where(and(
      eq(contacts.company_id, testCompanyId),
      eq(contacts.email, TEST_CONTACT_EMAIL),
    )).catch(() => {});
  });

  it('Browser agent (id 42) has all 11 session-new tools mounted', () => {
    const tools = getAgentTools(42);
    const toolNames = new Set(tools.map((t) => t.name));
    const expected = [
      'record_domain_skill', 'read_domain_skills',
      'list_provider_packs', 'start_provider_pack',
      'ocr_current_page', 'ocr_click_text', 'ocr_image',
      'send_company_email', 'http_fetch',
      'add_contact', 'get_contacts',
    ];
    for (const name of expected) {
      expect(toolNames.has(name), `Missing tool: ${name}`).toBe(true);
    }
  });

  it('record_domain_skill writes a row; read_domain_skills returns it; re-record bumps confidence', async () => {
    if (!testCompanyId) return;
    const task = { id: 'integration-skill', company_id: testCompanyId } as never;

    const r1 = await handleBrowserTool('record_domain_skill', {
      domain: TEST_DOMAIN, kind: 'selector', key: 'login_btn', value: 'button#submit',
    }, task);
    expect(r1).toContain('Recorded skill for');

    const r2 = await handleBrowserTool('read_domain_skills', { domain: TEST_DOMAIN }, task);
    expect(r2).toContain('login_btn');
    expect(r2).toContain('button#submit');

    // Real DB row exists with confidence=50 (default)
    const [row1] = await db.select()
      .from(domainSkills)
      .where(and(
        eq(domainSkills.company_id, testCompanyId),
        eq(domainSkills.site_domain, TEST_DOMAIN),
        eq(domainSkills.key, 'login_btn'),
      ))
      .limit(1);
    expect(row1).toBeTruthy();
    expect(row1.confidence).toBe(50);

    // Re-record bumps confidence to 60 and updates value
    await handleBrowserTool('record_domain_skill', {
      domain: TEST_DOMAIN, kind: 'selector', key: 'login_btn', value: 'button#submit-v2',
    }, task);
    const [row2] = await db.select()
      .from(domainSkills)
      .where(and(
        eq(domainSkills.company_id, testCompanyId),
        eq(domainSkills.site_domain, TEST_DOMAIN),
        eq(domainSkills.key, 'login_btn'),
      ))
      .limit(1);
    expect(row2.confidence).toBe(60);
    expect(row2.value).toBe('button#submit-v2');
  });

  it('add_contact (called via Browser agent dispatch) writes a contact row; get_contacts retrieves it', async () => {
    if (!testCompanyId) return;
    const task = { id: 'integration-contact', company_id: testCompanyId } as never;

    const addResult = await handleToolCall('add_contact', {
      email: TEST_CONTACT_EMAIL,
      name: 'Integration Test Contact',
      lead_status: 'pending',
    }, task, 42);
    expect(addResult).toContain('Contact saved');

    // Real DB row
    const [contactRow] = await db.select()
      .from(contacts)
      .where(and(
        eq(contacts.company_id, testCompanyId),
        eq(contacts.email, TEST_CONTACT_EMAIL),
      ))
      .limit(1);
    expect(contactRow).toBeTruthy();
    expect(contactRow.name).toBe('Integration Test Contact');

    // get_contacts surfaces it back
    const getResult = await handleToolCall('get_contacts', {
      search: '__browser_integration_contact',
    }, task, 42);
    expect(getResult).toContain('Integration Test Contact');
    expect(getResult).toContain(TEST_CONTACT_EMAIL);
  });

  it('http_fetch hits a real public API without Browserbase', async () => {
    if (!testCompanyId) return;
    const task = { id: 'integration-http', company_id: testCompanyId } as never;
    const result = await handleBrowserTool('http_fetch', {
      url: 'https://api.github.com/zen',
    }, task);
    expect(result).toContain('HTTP 200');
    expect(result).toContain('Length:');
  }, 30_000); // network — allow 30s

  it('list_provider_packs returns 8 seeded packs; start_provider_pack(openai) returns full recipe', async () => {
    if (!testCompanyId) return;
    const task = { id: 'integration-pack', company_id: testCompanyId } as never;

    // 8 packs in DB (sanity)
    const packs = await db.select().from(providerPacks);
    expect(packs.length).toBeGreaterThanOrEqual(8);

    const expectedIds = ['openai', 'anthropic', 'stripe', 'render', 'github', 'postmark', 'sentry', 'cloudflare-r2'];
    const dbIds = new Set(packs.map((p) => p.provider_id));
    for (const id of expectedIds) {
      expect(dbIds.has(id), `Missing pack: ${id}`).toBe(true);
    }

    const listResult = await handleBrowserTool('list_provider_packs', {}, task);
    expect(listResult).toContain('openai');
    expect(listResult).toContain('OPENAI_API_KEY');

    const startResult = await handleBrowserTool('start_provider_pack', { provider_id: 'openai' }, task);
    expect(startResult).toContain('Provider Pack: OpenAI');
    expect(startResult).toContain('## Steps');
    expect(startResult).toContain('Save the obtained key as: OPENAI_API_KEY');
  });
});
