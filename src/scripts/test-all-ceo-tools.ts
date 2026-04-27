// End-to-end test runner: every CEO tool, real DB, real services.
//
// Calls handleToolCall(...) for each of the 40 tools against the most-recently-
// active company. Creates fixtures (test task, test recurring, test link, test
// feature/bug rows) where needed, then cleans them up. Side-effecting tools
// that would burn real money or mutate founder data (approve_task -> launch
// worker; update_document -> mutate founder content) are exercised through
// safe paths that don't actually mutate.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-all-ceo-tools.ts
//   or: npx tsx --env-file=.env.local src/scripts/test-all-ceo-tools.ts <company_email>

import { db, companies, tasks, recurringTasks, dashboardLinks, platformFeedback, users } from '@/lib/db';
import { eq, desc, and, like } from 'drizzle-orm';
import { handleToolCall, CEO_TOOLS } from '@/lib/agents/ceo/ceo.tools';
import type { ToolResult } from '@/lib/agents/ceo/ceo.tools';

// ── Result table ──
type Status = 'PASS' | 'FAIL' | 'SKIP';
interface Row { tool: string; group: string; status: Status; note: string; ms: number }
const rows: Row[] = [];

let companyId = '';

async function call(
  group: string,
  name: string,
  input: Record<string, unknown>,
  opts: { skipReason?: string; expect?: (r: ToolResult) => string | null } = {},
): Promise<ToolResult | null> {
  if (opts.skipReason) {
    rows.push({ group, tool: name, status: 'SKIP', note: opts.skipReason, ms: 0 });
    return null;
  }
  const t0 = Date.now();
  try {
    const r = await handleToolCall(name, input, companyId);
    const ms = Date.now() - t0;

    if (typeof r.content !== 'string') {
      rows.push({ group, tool: name, status: 'FAIL', note: 'content is not a string', ms });
      return r;
    }
    if (r.content.includes('is not available yet')) {
      rows.push({ group, tool: name, status: 'FAIL', note: 'fell through switch default', ms });
      return r;
    }

    const reject = opts.expect?.(r);
    if (reject) {
      rows.push({ group, tool: name, status: 'FAIL', note: reject, ms });
    } else {
      const preview = r.content.replace(/\s+/g, ' ').slice(0, 70);
      rows.push({ group, tool: name, status: 'PASS', note: preview, ms });
    }
    return r;
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    rows.push({ group, tool: name, status: 'FAIL', note: msg.replace(/\s+/g, ' ').slice(0, 70), ms });
    return null;
  }
}

async function pickCompany(email?: string) {
  if (email) {
    const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!u) throw new Error(`No user with email ${email}`);
    const [c] = await db.select({ id: companies.id, slug: companies.slug, name: companies.name })
      .from(companies)
      .where(eq(companies.owner_id, u.id))
      .orderBy(desc(companies.updated_at))
      .limit(1);
    if (!c) throw new Error(`No company for ${email}`);
    return c;
  }
  const [c] = await db.select({ id: companies.id, slug: companies.slug, name: companies.name })
    .from(companies)
    .orderBy(desc(companies.updated_at))
    .limit(1);
  if (!c) throw new Error('No company in DB');
  return c;
}

async function main() {
  const c = await pickCompany(process.argv[2]);
  companyId = c.id;
  console.log(`Target company: ${c.name ?? '(no name)'} [${c.slug ?? '-'}] ${companyId}`);
  console.log(`Total CEO_TOOLS exposed: ${CEO_TOOLS.length}\n`);

  // ════════════════════════════════════════════════════════════
  // GROUP 1: Capabilities (6) — pure functions, no DB
  // ════════════════════════════════════════════════════════════
  await call('capabilities', 'list_available_modules', {});
  await call('capabilities', 'get_module_capabilities', { module_name: 'engineering' });
  await call('capabilities', 'list_mcp_servers', {});
  await call('capabilities', 'list_available_agents', {});
  await call('capabilities', 'get_agent_capabilities', { agent_id: '30' });
  await call('capabilities', 'find_agent_for_task', { task_description: 'build a landing page', tag: 'landing-page' });

  // ════════════════════════════════════════════════════════════
  // GROUP 2: Tasks (13) — uses fixture task created via create_task
  // ════════════════════════════════════════════════════════════
  await call('tasks', 'get_tasks', {});

  const createRes = await call('tasks', 'create_task', {
    title: 'TEST_E2E_DEBUG_TASK',
    description: 'Auto-test fixture for E2E tool runner',
    tag: 'research',
  });
  const action = createRes?.action;
  const taskId = action && action.type === 'task_proposal' ? action.data.task_id : null;
  if (!taskId) {
    console.error('FATAL: create_task did not return a task_id — cannot test downstream task tools');
    process.exit(2);
  }

  await call('tasks', 'get_task_details', { task_id: taskId });
  await call('tasks', 'edit_task', { task_id: taskId, title: 'TEST_E2E_DEBUG_TASK_EDITED' });
  await call('tasks', 'get_task_run_link', { task_id: taskId });
  await call('tasks', 'get_task_execution_status', { task_id: taskId });
  await call('tasks', 'get_task_execution_logs', { task_id: taskId });
  await call('tasks', 'get_active_executions', {});
  await call('tasks', 'find_best_agent', { query: 'send cold outreach emails' });
  await call('tasks', 'reorder_task', { task_id: taskId, position: 999 });
  await call('tasks', 'move_task_to_top', { task_id: taskId });

  // approve_task: would actually launch a worker — exercise the not-found path instead
  await call(
    'tasks',
    'approve_task',
    { task_id: '00000000-0000-0000-0000-000000000000' },
    {
      expect: (r) => (r.content.includes('Task not found') ? null : `expected "Task not found", got: ${r.content.slice(0, 80)}`),
    },
  );

  // reject_task: cleans up our debug task
  await call('tasks', 'reject_task', { task_id: taskId, reason: 'E2E auto-test cleanup' });

  // ════════════════════════════════════════════════════════════
  // GROUP 3: Recurring (4) — fixture created + deleted in-test
  // ════════════════════════════════════════════════════════════
  await call('recurring', 'get_recurring_tasks', {});

  await call('recurring', 'create_recurring_task', {
    title: 'TEST_E2E_DEBUG_REC',
    description: 'Auto-test fixture',
    tag: 'research',
    cadence: 'weekly',
  });

  // Look up the row we just created (handler doesn't return id)
  const [recRow] = await db
    .select({ id: recurringTasks.id })
    .from(recurringTasks)
    .where(and(eq(recurringTasks.company_id, companyId), eq(recurringTasks.title, 'TEST_E2E_DEBUG_REC')))
    .orderBy(desc(recurringTasks.created_at))
    .limit(1);

  if (recRow) {
    await call('recurring', 'update_recurring_task', { recurring_id: recRow.id, paused: true });
    await call('recurring', 'delete_recurring_task', { recurring_id: recRow.id });
  } else {
    rows.push({ group: 'recurring', tool: 'update_recurring_task', status: 'FAIL', note: 'create_recurring_task never wrote a row', ms: 0 });
    rows.push({ group: 'recurring', tool: 'delete_recurring_task', status: 'SKIP', note: 'no fixture id', ms: 0 });
  }

  // ════════════════════════════════════════════════════════════
  // GROUP 4: Company (11)
  // ════════════════════════════════════════════════════════════
  await call('company', 'get_context', {});
  await call('company', 'query_reports', { limit: 3 });
  await call('company', 'get_document', { doc_type: 'mission' });

  // update_document: re-write the existing content (effective no-op so we
  // exercise the path without mutating the founder's content). If the doc
  // doesn't exist we fall to the "not found" branch which is also a PASS.
  const docRes = await handleToolCall('get_document', { doc_type: 'mission' }, companyId);
  const existing = docRes.content.replace(/^## .*\n\n/, '');
  await call('company', 'update_document', { doc_type: 'mission', content: existing });

  await call('company', 'get_emails', { limit: 3 });
  await call('company', 'get_tweets', { limit: 3 });
  await call('company', 'get_links', {});

  await call('company', 'update_link', { label: 'TEST_E2E_DEBUG_LINK', url: 'https://example.com/e2e-debug' });
  // Cleanup the link we just added
  await db.delete(dashboardLinks).where(and(
    eq(dashboardLinks.company_id, companyId),
    eq(dashboardLinks.label, 'TEST_E2E_DEBUG_LINK'),
  ));

  // pause_ads: safe — handler short-circuits on missing token or no active campaigns
  await call('company', 'pause_ads', {});

  await call('company', 'suggest_feature', {
    title: 'TEST_E2E_DEBUG_FEATURE',
    description: 'Auto-test row, please ignore (will be cleaned up)',
  });

  await call('company', 'read_context_graph', { nodes: ['revenue', 'active_work', 'support', 'user'] });

  // ════════════════════════════════════════════════════════════
  // GROUP 5: Research (2) — hits Tavily, costs API credits
  // ════════════════════════════════════════════════════════════
  await call('research', 'web_search', { query: 'baljia ai e2e test' });
  await call('research', 'web_extract', { url: 'https://example.com' });

  // ════════════════════════════════════════════════════════════
  // GROUP 6: Memory (2)
  // ════════════════════════════════════════════════════════════
  await call('memory', 'search_memory', { query: 'test' });
  await call('memory', 'read_memory', { layer: '1' });

  // ════════════════════════════════════════════════════════════
  // GROUP 7: Platform (1)
  // ════════════════════════════════════════════════════════════
  await call('platform', 'report_platform_bug', {
    title: 'TEST_E2E_DEBUG_BUG',
    description: 'Auto-test row, please ignore',
    severity: 'low',
  });

  // ════════════════════════════════════════════════════════════
  // GROUP 8: Credits (1) — extra tool
  // ════════════════════════════════════════════════════════════
  await call('credits', 'get_credit_balance', {});

  // ── Final cleanup: drop the platform_feedback test rows we created ──
  await db.delete(platformFeedback).where(and(
    eq(platformFeedback.company_id, companyId),
    like(platformFeedback.title, 'TEST_E2E_DEBUG_%'),
  ));

  // ── Static check: every CEO_TOOLS entry was tested ──
  const tested = new Set(rows.map((r) => r.tool));
  const exposedNames = CEO_TOOLS.map((t) => t.name);
  const untested = exposedNames.filter((n) => !tested.has(n));
  if (untested.length > 0) {
    console.warn(`\n⚠ Untested tools (${untested.length}): ${untested.join(', ')}`);
  }

  // ────────── REPORT ──────────
  const pass = rows.filter((r) => r.status === 'PASS').length;
  const fail = rows.filter((r) => r.status === 'FAIL').length;
  const skip = rows.filter((r) => r.status === 'SKIP').length;

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`RESULTS — ${rows.length} tools tested · ${pass} PASS · ${fail} FAIL · ${skip} SKIP`);
  console.log('══════════════════════════════════════════════════════════\n');

  // Group results by category
  const groups = Array.from(new Set(rows.map((r) => r.group)));
  for (const g of groups) {
    const gRows = rows.filter((r) => r.group === g);
    const gPass = gRows.filter((r) => r.status === 'PASS').length;
    console.log(`── ${g.toUpperCase()} (${gPass}/${gRows.length}) ──`);
    for (const r of gRows) {
      const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '○';
      const ms = r.ms > 0 ? ` ${r.ms}ms` : '';
      console.log(`  ${icon} ${r.tool.padEnd(30)} ${r.status.padEnd(5)}${ms.padStart(7)}  ${r.note}`);
    }
    console.log('');
  }

  if (fail > 0) {
    console.error(`\n❌ ${fail} tool(s) failed`);
    process.exit(1);
  }
  console.log('✅ All tools healthy');
  process.exit(0);
}

main().catch((e) => {
  console.error('Runner crashed:', e);
  process.exit(1);
});
