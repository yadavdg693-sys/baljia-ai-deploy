// Full CEO Tool Integration Test
// Creates a real test user + company, tests ALL 38 tools, then cleans up.
// Run: npx tsx src/scripts/test-ceo-full.ts

// IMPORTANT: dotenv must load BEFORE any other imports
// because db/client.ts reads DATABASE_URL at module init time
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' }); // fallback

// ── Test state ──
let passed = 0;
let failed = 0;
const failures: string[] = [];

async function main() {
  console.log('━'.repeat(60));
  console.log('  CEO TOOL FULL INTEGRATION TEST');
  console.log('━'.repeat(60));
  console.log('');

  // Dynamic imports AFTER env is loaded
  const { db, users, companies, tasks, creditLedger, recurringTasks, documents, tweets, emailThreads, dashboardLinks, platformFeedback, agents, memoryLayers } = await import('../lib/db');
  const { eq, sql } = await import('drizzle-orm');
  const { handleToolCall } = await import('../lib/agents/ceo/ceo.tool-handlers');

  // ── Test helper ──
  let testUserId: string;
  let testCompanyId: string;
  let testTaskId: string;
  let testRecurringId: string;

  async function test(toolName: string, input: Record<string, unknown> = {}): Promise<string | null> {
    try {
      const result = await handleToolCall(toolName, input, testCompanyId);
      const preview = result.content.substring(0, 120).replace(/\n/g, ' ');
      console.log(`  ✅ ${toolName} → ${preview}`);
      passed++;
      return result.content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ❌ ${toolName} → ${msg.substring(0, 120)}`);
      failures.push(`${toolName}: ${msg.substring(0, 200)}`);
      failed++;
      return null;
    }
  }

  // ══════════════════════════════════════════════
  // SETUP — create test user, company, seed data
  // ══════════════════════════════════════════════

  async function setup() {
    console.log('🔧 Setting up test data...\n');

    // 1. Test DB connection first
    try {
      const result = await db.execute(sql`SELECT current_database(), current_user`);
      console.log(`  DB connected: ${JSON.stringify(result.rows[0])}`);
    } catch (e) {
      console.error('  ❌ Cannot connect to database:', e);
      process.exit(1);
    }

    // 2. Create test user
    const [user] = await db.insert(users).values({
      email: 'ceo-test-bot@baljia.test',
      name: 'CEO Test Bot',
      email_verified: true,
    }).returning();
    testUserId = user.id;
    console.log(`  User: ${user.id} (${user.email})`);

    // 3. Create test company
    const [company] = await db.insert(companies).values({
      owner_id: testUserId,
      name: 'TestCo AI',
      slug: `testco-${Date.now()}`,
      one_liner: 'AI-powered test company for CEO tool validation',
      company_stage: 'validation',
      lifecycle: 'trial_active',
      plan_tier: 'trial',
      execution_state: 'active',
      company_email: 'hello@testco.baljia.app',
    }).returning();
    testCompanyId = company.id;
    console.log(`  Company: ${company.id} (${company.name})`);

    // 4. Seed credits (10 trial credits)
    await db.insert(creditLedger).values({
      company_id: testCompanyId,
      entry_type: 'grant',
      amount: 10,
      balance_after: 10,
      description: 'Trial grant for CEO test',
    });

    // 5. Seed a document
    await db.insert(documents).values({
      company_id: testCompanyId,
      doc_type: 'mission',
      title: 'Mission Statement',
      content: 'TestCo AI builds intelligent testing tools for developers.',
      is_empty: false,
    });

    // 6. Seed a tweet
    await db.insert(tweets).values({
      company_id: testCompanyId,
      text: 'Excited to launch TestCo AI! Building the future of automated testing. #AI #DevTools',
      status: 'posted',
      posted_at: new Date(),
    });

    // 7. Seed an email thread
    await db.insert(emailThreads).values({
      company_id: testCompanyId,
      subject: 'Welcome to TestCo',
      from_address: 'hello@testco.baljia.app',
      to_address: 'customer@example.com',
      direction: 'outbound',
      body: 'Thanks for signing up!',
    });

    // 8. Seed memory layers
    await db.insert(memoryLayers).values({
      company_id: testCompanyId,
      layer: 1,
      content: 'TestCo is an AI testing tool. Target audience: developers. Primary channel: Twitter + cold outreach.',
      token_count: 25,
      max_tokens: 15000,
    });
    await db.insert(memoryLayers).values({
      company_id: testCompanyId,
      layer: 2,
      content: 'Founder prefers concise responses. Likes bold experiments. Timezone: IST.',
      token_count: 15,
      max_tokens: 3000,
    });

    // 9. Check agents are seeded
    const [agentCount] = await db.select({ count: sql<number>`count(*)::int` }).from(agents);
    console.log(`  Agents in registry: ${agentCount?.count ?? 0}`);
    if ((agentCount?.count ?? 0) === 0) {
      console.log('  ⚠️  No agents seeded. Run: npx tsx src/scripts/seed-db.ts');
    }

    console.log('');
  }

  // ══════════════════════════════════════════════
  // CLEANUP — remove all test data
  // ══════════════════════════════════════════════

  async function cleanup() {
    console.log('\n🧹 Cleaning up test data...');
    try {
      await db.delete(platformFeedback).where(eq(platformFeedback.company_id, testCompanyId));
      await db.delete(dashboardLinks).where(eq(dashboardLinks.company_id, testCompanyId));
      await db.delete(recurringTasks).where(eq(recurringTasks.company_id, testCompanyId));
      await db.delete(tweets).where(eq(tweets.company_id, testCompanyId));
      await db.delete(emailThreads).where(eq(emailThreads.company_id, testCompanyId));
      await db.delete(creditLedger).where(eq(creditLedger.company_id, testCompanyId));
      await db.delete(memoryLayers).where(eq(memoryLayers.company_id, testCompanyId));
      await db.delete(documents).where(eq(documents.company_id, testCompanyId));
      await db.delete(tasks).where(eq(tasks.company_id, testCompanyId));
      await db.delete(companies).where(eq(companies.id, testCompanyId));
      await db.delete(users).where(eq(users.id, testUserId));
      console.log('  ✅ All test data removed');
    } catch (err) {
      console.log(`  ⚠️  Cleanup error: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ══════════════════════════════════════════════
  // TEST ALL TOOLS
  // ══════════════════════════════════════════════

  async function runTests() {
    // ── Group 1: Capabilities (5 tools) ──
    console.log('── Group 1: Capabilities (5 tools) ──');
    await test('list_available_modules');
    await test('get_module_capabilities', { module_name: 'Engineering' });
    await test('get_module_capabilities', { module_name: 'nonexistent' });
    await test('list_available_agents');
    await test('get_agent_capabilities', { agent_id: '30' });
    await test('find_agent_for_task', { task_description: 'Build a landing page', tag: 'landing-page' });

    // ── Group 2: Tasks (13 tools) ──
    console.log('\n── Group 2: Tasks (13 tools) ──');
    await test('get_tasks');

    // Create a task — this calls governance, so it needs LLM or fallback
    const createResult = await test('create_task', {
      title: 'Build a pricing page',
      description: 'Create a responsive pricing page with 3 tiers and Stripe checkout integration',
      tag: 'pricing-page',
    });

    // Extract task ID from create result
    if (createResult) {
      const match = createResult.match(/\[([a-f0-9-]{36})\]/);
      if (match) {
        testTaskId = match[1];
        console.log(`  📌 Created task: ${testTaskId}`);
      }
    }

    if (testTaskId) {
      await test('get_task_details', { task_id: testTaskId });
      await test('edit_task', { task_id: testTaskId, title: 'Build pricing page v2', priority: 80 });
      await test('get_task_run_link', { task_id: testTaskId });
      await test('get_task_execution_status', { task_id: testTaskId });
      await test('get_task_execution_logs', { task_id: testTaskId });
      await test('reorder_task', { task_id: testTaskId, position: 1 });
      await test('move_task_to_top', { task_id: testTaskId });
    } else {
      console.log('  ⚠️  Skipping task tools — create_task failed (likely needs LLM for governance)');
      // Create a task directly for remaining tests
      try {
        const [directTask] = await db.insert(tasks).values({
          company_id: testCompanyId,
          title: 'Direct test task',
          description: 'Created directly for tool testing',
          tag: 'test',
          source: 'founder_requested',
          status: 'todo',
          estimated_credits: 1,
        }).returning();
        testTaskId = directTask.id;
        console.log(`  📌 Created task directly: ${testTaskId}`);
        await test('get_task_details', { task_id: testTaskId });
        await test('edit_task', { task_id: testTaskId, priority: 90 });
        await test('get_task_run_link', { task_id: testTaskId });
        await test('get_task_execution_status', { task_id: testTaskId });
        await test('reorder_task', { task_id: testTaskId, position: 1 });
        await test('move_task_to_top', { task_id: testTaskId });
      } catch (e) {
        console.log(`  ❌ Direct task creation failed: ${e}`);
      }
    }

    await test('get_active_executions');
    await test('find_best_agent', { query: 'post a tweet about our launch' });

    // Edge cases
    await test('get_task_details', { task_id: '00000000-0000-0000-0000-000000000000' });
    await test('edit_task', { task_id: testTaskId ?? 'fake' });

    // ── Group 3: Recurring Tasks (4 tools) ──
    console.log('\n── Group 3: Recurring Tasks (4 tools) ──');
    await test('get_recurring_tasks');

    const recurResult = await test('create_recurring_task', {
      title: 'Weekly tweet about product updates',
      description: 'Post a tweet every week highlighting new features',
      tag: 'tweet',
      cadence: 'weekly',
    });
    if (recurResult) {
      const [latest] = await db.select({ id: recurringTasks.id })
        .from(recurringTasks)
        .where(eq(recurringTasks.company_id, testCompanyId))
        .limit(1);
      if (latest) {
        testRecurringId = latest.id;
        await test('update_recurring_task', { recurring_id: testRecurringId, paused: true });
        await test('delete_recurring_task', { recurring_id: testRecurringId });
      }
    }

    // ── Group 4: Company (10 tools) ──
    console.log('\n── Group 4: Company (10 tools) ──');
    await test('get_context');
    await test('query_reports', { limit: 5 });
    await test('query_reports', { search: 'nonexistent', limit: 5 });
    await test('get_document', { doc_type: 'mission' });
    await test('get_document', { doc_type: 'brand_voice' });
    await test('update_document', { doc_type: 'mission', content: '# TestCo Mission\nWe build AI testing tools that make developers 10x faster.' });
    await test('get_emails', { limit: 5 });
    await test('get_emails', { limit: 5, direction: 'inbound' });
    await test('get_tweets', { limit: 5 });
    await test('get_links');
    await test('update_link', { label: 'Landing Page', url: 'https://testco.baljia.app' });
    await test('get_links');
    await test('pause_ads');
    await test('suggest_feature', { title: 'Instagram integration', description: 'Would love to post to Instagram too' });

    // ── Group 5: Research (1 tool) ──
    console.log('\n── Group 5: Research (1 tool) ──');
    await test('web_search', { query: 'AI developer tools market size 2026' });

    // ── Group 6: Platform (1 tool) ──
    console.log('\n── Group 6: Platform (1 tool) ──');
    await test('report_platform_bug', { title: 'Test bug report', description: 'Testing the bug report tool', severity: 'low' });

    // ── Group 7: Memory (3 tools) ──
    console.log('\n── Group 7: Memory (3 tools) ──');
    await test('search_memory', { query: 'developer' });
    await test('read_memory', { layer: '1' });
    await test('read_memory', { layer: '2' });
    await test('read_memory', { layer: '3' });
    await test('write_memory', { layer: '1', content: 'TestCo focuses on B2B SaaS for developer teams. Key differentiator: AI-powered test generation.' });
    await test('read_memory', { layer: '1' });
    await test('get_credit_balance');

    // ── Group 8: Cycle Planning (4 tools) ──
    console.log('\n── Group 8: Cycle Planning (4 tools) ──');
    await test('get_cycle_context');
    await test('create_cycle_plan', {
      title: 'Week 1 sprint',
      tasks: ['Build pricing page', 'Set up analytics'],
      notes: 'Focus on monetization',
    });
    await test('update_cycle_plan', {
      plan_id: '00000000-0000-0000-0000-000000000000',
      tasks: ['Updated task'],
      notes: 'Changed priorities',
    });
    await test('submit_review', {
      plan_id: '00000000-0000-0000-0000-000000000000',
      summary: 'Good week overall',
      wins: 'Pricing page shipped',
      blockers: 'Stripe webhook issues',
    });

    // ── Group 9: Task Scoring (2 tools) ──
    console.log('\n── Group 9: Task Scoring (2 tools) ──');
    await test('get_unscored_tasks');
    await test('score_task', {
      task_id: testTaskId ?? '00000000-0000-0000-0000-000000000000',
      quality: 4,
      speed: 3,
      accuracy: 5,
      notes: 'Good work on the pricing page',
    });

    // ── Group 10: Agent Factory (5 tools) ──
    console.log('\n── Group 10: Agent Factory (5 tools) ──');
    await test('list_mcp_tools', {});
    await test('list_mcp_tools', { server: 'engineering' });
    await test('list_mcp_tools', { server: 'nonexistent' });
    await test('get_mcp_tool_details', { tool_name: 'github_create_repo' });
    await test('get_mcp_tool_details', { tool_name: 'fake_tool' });
    await test('create_agent', { name: 'Custom Agent', role: 'Test role' });
    await test('list_created_agents');
    await test('get_agent_template', { agent_type: 'engineering' });
    await test('get_agent_template', { agent_type: 'unknown' });

    // ── Reject task last (terminal state) ──
    if (testTaskId) {
      console.log('\n── Final: Reject task ──');
      await test('reject_task', { task_id: testTaskId, reason: 'Test cleanup' });
    }

    // ── Unknown tool (default case) ──
    console.log('\n── Edge: Unknown tool ──');
    await test('nonexistent_tool', {});
  }

  // ── Run everything ──
  try {
    await setup();
    await runTests();
  } finally {
    await cleanup();
  }

  console.log('\n' + '━'.repeat(60));
  console.log(`  RESULTS: ✅ ${passed} passed   ❌ ${failed} failed   Total: ${passed + failed}`);
  console.log('━'.repeat(60));

  if (failures.length > 0) {
    console.log('\n🔴 FAILURES:');
    for (const f of failures) {
      console.log(`  • ${f}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(2);
});
