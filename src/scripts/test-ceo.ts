// CEO Agent Smoke Test v2 — uses Drizzle directly
// npx tsx src/scripts/test-ceo.ts

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db, tasks, creditLedger } from '../lib/db';
import { sql } from 'drizzle-orm';

// Import tool handlers
import { handleToolCall } from '../lib/agents/ceo/ceo.tool-handlers';

const FAKE_COMPANY_ID = '00000000-0000-0000-0000-000000000000';

async function test(toolName: string, input: Record<string, unknown> = {}) {
  try {
    const result = await handleToolCall(toolName, input, FAKE_COMPANY_ID);
    const preview = result.content.substring(0, 150);
    console.log(`  ✅ ${toolName} → ${preview}`);
    return true;
  } catch (err) {
    console.log(`  ❌ ${toolName} → ${err instanceof Error ? err.message : 'Error'}`);
    return false;
  }
}

async function main() {
  console.log('🧪 CEO Agent Smoke Test v2\n');

  // Pre-check: verify DB connection via Drizzle
  console.log('── Pre-check: Drizzle queries ──');
  try {
    const result = await db.select({ count: sql<number>`count(*)` }).from(tasks);
    console.log(`  ✅ tasks table accessible (${result[0]?.count ?? 0} rows)`);
  } catch (e) { console.log(`  ❌ tasks: ${e}`); }

  try {
    const result = await db.select({ count: sql<number>`count(*)` }).from(creditLedger);
    console.log(`  ✅ credit_ledger accessible (${result[0]?.count ?? 0} rows)`);
  } catch (e) { console.log(`  ❌ credit_ledger: ${e}`); }

  let passed = 0;
  let failed = 0;

  // Group 1: Capabilities (pure logic)
  console.log('\n── Group 1: Capabilities (6 tools) ──');
  for (const [name, input] of [
    ['list_available_modules', {}],
    ['get_module_capabilities', { module_name: 'Engineering' }],
    ['list_mcp_servers', {}],
    ['list_available_agents', {}],
    ['get_agent_capabilities', { agent_id: '30' }],
    ['find_agent_for_task', { tag: 'engineering', task_description: 'Build a landing page' }],
  ] as const) {
    if (await test(name, input as Record<string, unknown>)) passed++; else failed++;
  }

  // Group 2: Tasks
  console.log('\n── Group 2: Tasks (3 of 13 tested) ──');
  if (await test('get_tasks')) passed++; else failed++;
  if (await test('get_active_executions')) passed++; else failed++;
  if (await test('find_best_agent', { query: 'post a tweet about our launch' })) passed++; else failed++;

  // Group 3: Recurring
  console.log('\n── Group 3: Recurring (1 of 4 tested) ──');
  if (await test('get_recurring_tasks')) passed++; else failed++;

  // Group 4: Company
  console.log('\n── Group 4: Company (4 of 10 tested) ──');
  if (await test('get_context')) passed++; else failed++;
  if (await test('query_reports', { limit: 5 })) passed++; else failed++;
  if (await test('get_document', { doc_type: 'mission' })) passed++; else failed++;
  if (await test('get_emails', { limit: 5 })) passed++; else failed++;

  // Group 5: Research
  console.log('\n── Group 5: Research (1 tool) ──');
  if (await test('web_search', { query: 'AI startup trends 2026' })) passed++; else failed++;

  // Group 6: Memory
  console.log('\n── Group 6: Memory (3 of 4 tested) ──');
  if (await test('get_credit_balance')) passed++; else failed++;
  if (await test('search_memory', { query: 'brand' })) passed++; else failed++;
  if (await test('read_memory', { layer: 1 })) passed++; else failed++;

  console.log(`\n${'━'.repeat(40)}`);
  console.log(`✅ Passed: ${passed}  ❌ Failed: ${failed}  Total: ${passed + failed}/18`);
  console.log(`${'━'.repeat(40)}`);
}

main().catch(console.error);
