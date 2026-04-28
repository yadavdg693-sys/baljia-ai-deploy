// Test EVERY worker agent end-to-end. Earlier session focused on
// engineering; the user (rightfully) called out that other agents matter
// too. This runs realistic tasks through each agent and reports per-agent
// success.
//
// Skips external-service agents that need OAuth (Twitter, MetaAds,
// ColdOutreach if not wired) — those need a separate flow.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-all-agents.ts

import { db, companies, tasks, taskExecutions } from '@/lib/db';
import { and, eq, isNotNull, desc } from 'drizzle-orm';
import * as taskService from '@/lib/services/task.service';
import { launchTask } from '@/lib/agents/worker-launcher';

interface AgentTest {
  agentId: number;
  agentName: string;
  tag: string;
  title: string;
  description: string;
  expectedToolNames: string[];   // The agent should call AT LEAST one of these
  expectedFinalStatus: 'completed' | 'either';   // 'either' = completed-or-failed both OK if no error
}

const TESTS: AgentTest[] = [
  {
    agentId: 30, agentName: 'Engineering', tag: 'engineering',
    title: 'AGENT-COVERAGE: tiny ping endpoint',
    description: 'Build a simple endpoint at {SUBDOMAIN}.baljia.app/api/ping that returns JSON {"pong":true}. Use the build-fullstack-cf-app skill. No DB needed.',
    expectedToolNames: ['cf_deploy_app'],
    expectedFinalStatus: 'completed',
  },
  {
    agentId: 29, agentName: 'Research', tag: 'research',
    title: 'AGENT-COVERAGE: small fact-finding research',
    description: 'Find current rate limits of the OpenAI API. Cite at least 1 source URL. Produce a 100-word report with markdown headers and source citations.',
    expectedToolNames: ['web_search', 'create_report'],
    expectedFinalStatus: 'completed',
  },
  {
    agentId: 33, agentName: 'Data', tag: 'data',
    title: 'AGENT-COVERAGE: count tasks',
    description: 'Query the company database for the count of rows in any one table. Report the table name and the count. Read-only.',
    expectedToolNames: ['query_company_db', 'get_database_info'],
    expectedFinalStatus: 'completed',
  },
];

interface Result {
  agentName: string;
  taskId: string;
  status: string;
  turns: number;
  toolsCalled: string[];
  unknownToolErrors: string[];
  expectedToolHit: boolean;
  passed: boolean;
  diagnostic: string;
}

async function pickCompany() {
  const [c] = await db.select({ id: companies.id, slug: companies.slug })
    .from(companies)
    .where(and(eq(companies.slug, 'plinqa'), isNotNull(companies.neon_connection_string)))
    .limit(1);
  if (!c) throw new Error('plinqa not ready');
  return c;
}

async function runOne(test: AgentTest, companyId: string, slug: string): Promise<Result> {
  const result: Result = {
    agentName: test.agentName, taskId: '', status: 'unknown', turns: 0,
    toolsCalled: [], unknownToolErrors: [], expectedToolHit: false,
    passed: false, diagnostic: '',
  };

  try {
    const task = await taskService.createTask({
      company_id: companyId,
      title: test.title,
      description: test.description.replace('{SUBDOMAIN}', slug),
      tag: test.tag,
      source: 'system',
      estimated_credits: 1,
      status: 'todo',
      authorized_by: 'system',
      assigned_to_agent_id: test.agentId,
      max_turns: 30,
      created_by: companyId,
    });
    result.taskId = task.id;

    try { await launchTask(task.id); } catch (e) {
      result.diagnostic = `launchTask threw: ${e instanceof Error ? e.message : e}`;
    }

    const final = await taskService.getTask(task.id);
    result.status = final?.status ?? 'unknown';
    result.turns = final?.turn_count ?? 0;

    const [exec] = await db.select({ execution_log: taskExecutions.execution_log })
      .from(taskExecutions)
      .where(eq(taskExecutions.task_id, task.id))
      .orderBy(desc(taskExecutions.created_at))
      .limit(1);

    if (exec?.execution_log) {
      let log: Array<{ tool?: string; result?: string }> = [];
      const raw = exec.execution_log;
      if (typeof raw === 'string') { try { log = JSON.parse(raw); } catch {} }
      else if (Array.isArray(raw)) log = raw as typeof log;
      result.toolsCalled = [...new Set(log.map((e) => e.tool ?? '').filter(Boolean))];
      result.unknownToolErrors = [...new Set(
        log.filter((e) => typeof e.result === 'string' && e.result.includes('Unknown tool'))
          .map((e) => e.tool ?? '')
          .filter(Boolean)
      )];
      result.expectedToolHit = test.expectedToolNames.some((t) => result.toolsCalled.includes(t));
    }

    result.passed = result.status === 'completed' &&
      result.unknownToolErrors.length === 0 &&
      result.expectedToolHit;
    if (!result.diagnostic) {
      if (result.unknownToolErrors.length > 0) result.diagnostic = `unknown-tool errors: ${result.unknownToolErrors.join(', ')}`;
      else if (!result.expectedToolHit) result.diagnostic = `agent didn't call any of expected tools: ${test.expectedToolNames.join(', ')}`;
      else if (result.status !== 'completed') result.diagnostic = `task ended in status=${result.status}`;
    }

    await db.update(tasks).set({ status: 'rejected' }).where(eq(tasks.id, task.id));
  } catch (e) {
    result.diagnostic = `runOne threw: ${e instanceof Error ? e.message : e}`;
  }
  return result;
}

async function main() {
  console.log('═══ All-agent coverage test ═══');
  console.log(`PRIMARY_LLM_PROVIDER: ${process.env.PRIMARY_LLM_PROVIDER ?? '(unset)'}`);
  console.log(`Tests: ${TESTS.length} (engineering, research, data)\n`);

  const company = await pickCompany();
  console.log(`Test company: ${company.slug} (${company.id})\n`);

  // Each test runs against same company, so they must be SERIAL (one slot per company)
  const results: Result[] = [];
  for (const test of TESTS) {
    console.log(`▶ ${test.agentName} task: "${test.title}"...`);
    const start = Date.now();
    const r = await runOne(test, company.id, company.slug!);
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`  done in ${elapsed}s — status=${r.status} turns=${r.turns} ${r.passed ? '✅' : '❌'}\n`);
    results.push(r);
  }

  console.log('═══ RESULTS ═══\n');
  for (const r of results) {
    console.log(`── ${r.agentName} ──`);
    console.log(`  status: ${r.status}  turns: ${r.turns}`);
    console.log(`  tools called: ${r.toolsCalled.join(', ') || '(none)'}`);
    if (r.unknownToolErrors.length > 0) {
      console.log(`  🚨 UNKNOWN-TOOL ERRORS: ${r.unknownToolErrors.join(', ')}`);
    }
    console.log(`  ${r.passed ? '✅ PASSED' : `❌ FAILED — ${r.diagnostic}`}`);
    console.log();
  }

  const passCount = results.filter((r) => r.passed).length;
  console.log(`═══ ${passCount}/${results.length} agents working ═══`);
  process.exit(passCount === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
