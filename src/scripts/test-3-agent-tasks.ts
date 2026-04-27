// End-to-end agent execution test:
//   1. Creates 3 tasks against the most-recent company (Threadmint)
//   2. Approves each via /api/tasks/:id/approve (launches them in-process)
//   3. Polls task_executions + tasks tables every 3s for up to 8 minutes
//   4. Streams progress events + final outcome to stdout
//
// Run: npx tsx --env-file=.env.local src/scripts/test-3-agent-tasks.ts
//
// Each task costs 1 credit. The engineering agent in particular makes real
// GitHub/Render/Stripe calls if creds are present, so it's a real exercise
// of the full execution pipeline.

import { db, companies, tasks, taskExecutions, users } from '@/lib/db';
import { eq, desc, and } from 'drizzle-orm';
import * as taskService from '@/lib/services/task.service';
import { launchTask } from '@/lib/agents/worker-launcher';
import { getAgentName } from '@/lib/services/router.service';

const TASK_PREFIX = 'AGENT-TEST';

const TASK_DEFS: Array<{ title: string; description: string; tag: string }> = [
  {
    title: `${TASK_PREFIX}: Read package.json and report key metadata`,
    description:
      'Read the package.json file in this company\'s codebase using github_read_file (or your equivalent code-reading tool). ' +
      'Report exactly four fields: ' +
      '1) name (project name), ' +
      '2) version, ' +
      '3) the version pinned for "next" (or "Next.js not present" if missing), ' +
      '4) total count of entries in dependencies. ' +
      'Do NOT modify any files. This is a read-only diagnostic task. ' +
      'Output the report as a 4-line plain-text summary.',
    tag: 'engineering',
  },
  {
    title: `${TASK_PREFIX}: Reddit API rate limits research`,
    description:
      'Search the web for "Reddit API rate limits 2025" and "Reddit API tiers free vs paid". ' +
      'Produce a 3-bullet summary of the current rate limits, citing source URLs after each bullet. ' +
      'This is read-only research — do not propose actions.',
    tag: 'research',
  },
  {
    title: `${TASK_PREFIX}: Count tasks by status`,
    description:
      'Query the company database for the total count of tasks grouped by status (todo, in_progress, completed, failed, rejected). ' +
      'Return a simple table: status | count. Read-only diagnostic.',
    tag: 'data',
  },
];

interface TaskState {
  id: string;
  title: string;
  agent: string;
  expectedAgent: string;
  status: string;
  turnCount: number | null;
  startedAt: string | null;
  completedAt: string | null;
  failureClass: string | null;
  events: number;
  finished: boolean;
}

async function pickCompany(): Promise<{ id: string; name: string; ownerId: string; slug: string }> {
  const email = process.argv[2];
  if (email) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!u) throw new Error(`No user with email ${email}`);
    const [c] = await db
      .select({ id: companies.id, name: companies.name, slug: companies.slug, owner_id: companies.owner_id })
      .from(companies)
      .where(and(eq(companies.owner_id, u.id), eq(companies.onboarding_status, 'completed')))
      .orderBy(desc(companies.updated_at))
      .limit(1);
    if (!c?.owner_id) throw new Error(`No completed company for ${email}`);
    return { id: c.id, name: c.name ?? 'Test Co', ownerId: c.owner_id, slug: c.slug ?? 'test' };
  }
  const [c] = await db
    .select({ id: companies.id, name: companies.name, slug: companies.slug, owner_id: companies.owner_id })
    .from(companies)
    .where(eq(companies.onboarding_status, 'completed'))
    .orderBy(desc(companies.updated_at))
    .limit(1);
  if (!c?.owner_id) throw new Error('No completed company in DB');
  return { id: c.id, name: c.name ?? 'Test Co', ownerId: c.owner_id, slug: c.slug ?? 'test' };
}

function colorStatus(status: string): string {
  switch (status) {
    case 'completed': return `\x1b[32m${status}\x1b[0m`;
    case 'failed':
    case 'failed_permanent': return `\x1b[31m${status}\x1b[0m`;
    case 'in_progress':
    case 'verifying':
    case 'repair': return `\x1b[33m${status}\x1b[0m`;
    case 'rejected': return `\x1b[90m${status}\x1b[0m`;
    default: return status;
  }
}

async function readStateOnce(taskId: string, expectedAgent: string): Promise<TaskState> {
  const [task] = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      assigned_to_agent_id: tasks.assigned_to_agent_id,
      failure_class: tasks.failure_class,
      started_at: tasks.started_at,
      completed_at: tasks.completed_at,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  const [execution] = await db
    .select({
      turn_count: taskExecutions.turn_count,
      execution_log: taskExecutions.execution_log,
    })
    .from(taskExecutions)
    .where(eq(taskExecutions.task_id, taskId))
    .orderBy(desc(taskExecutions.started_at))
    .limit(1);

  const eventsCount = Array.isArray(execution?.execution_log) ? execution.execution_log.length : 0;
  const status = task?.status ?? 'unknown';
  const finished = ['completed', 'failed', 'failed_permanent', 'rejected'].includes(status);

  return {
    id: taskId,
    title: task?.title ?? '',
    agent: task?.assigned_to_agent_id != null ? getAgentName(task.assigned_to_agent_id) : '—',
    expectedAgent,
    status,
    turnCount: execution?.turn_count ?? null,
    startedAt: task?.started_at instanceof Date ? task.started_at.toISOString() : (task?.started_at as string | null) ?? null,
    completedAt: task?.completed_at instanceof Date ? task.completed_at.toISOString() : (task?.completed_at as string | null) ?? null,
    failureClass: task?.failure_class ?? null,
    events: eventsCount,
    finished,
  };
}

// Retry transient Neon HTTP timeouts — they happen ~5% of the time on long runs.
async function readState(taskId: string, expectedAgent: string): Promise<TaskState> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await readStateOnce(taskId, expectedAgent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 3) throw err;
      console.warn(`  ⚠ readState(${taskId}) attempt ${attempt} failed: ${msg.slice(0, 80)} — retrying`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error('unreachable');
}

function expectedAgentForTag(tag: string): string {
  const TAG_TO_AGENT: Record<string, string> = {
    engineering: 'Engineering',
    research: 'Research',
    data: 'Data',
    twitter: 'Twitter',
    'meta-ads': 'Meta Ads',
    outreach: 'Cold Outreach',
    browser: 'Browser',
    support: 'Support',
  };
  return TAG_TO_AGENT[tag] ?? 'Unknown';
}

async function main() {
  const company = await pickCompany();
  console.log(`\n══ Target: ${company.name} [${company.slug}] ${company.id}\n`);

  // ── Step 1: Create the 3 tasks ──
  console.log('── Creating 3 tasks ──');
  const createdIds: Array<{ id: string; tag: string }> = [];
  for (const def of TASK_DEFS) {
    const task = await taskService.createTask({
      company_id: company.id,
      title: def.title,
      description: def.description,
      tag: def.tag,
      source: 'founder_requested',
      authorized_by: 'founder',
      authorization_reason: 'agent test runner',
    });
    console.log(`  ✓ ${def.tag.padEnd(12)} | ${task.id} | ${task.title}`);
    createdIds.push({ id: task.id, tag: def.tag });
  }

  // ── Step 2: Launch each task SEQUENTIALLY ──
  // Per CLAUDE.md spec, a company has one active execution slot — night
  // shift and manual share it. Parallel launches → only the first claims;
  // the rest fail with "Company already has an active execution".
  // We await each launch (which blocks until the agent finishes or fails)
  // before starting the next.
  console.log('\n── Launching tasks sequentially (one slot per company) ──\n');

  for (const { id, tag } of createdIds) {
    const expected = expectedAgentForTag(tag);
    console.log(`▶ Launching [${tag}] ${id} → expecting ${expected} agent`);
    const launchStart = Date.now();
    try {
      const exec = await launchTask(id);
      const elapsed = ((Date.now() - launchStart) / 1000).toFixed(1);
      console.log(`✓ Launch returned (${elapsed}s) — execution ${exec.id} status=${exec.status}`);
    } catch (err: unknown) {
      const elapsed = ((Date.now() - launchStart) / 1000).toFixed(1);
      console.error(`✗ launchTask(${id}) threw after ${elapsed}s:`, err instanceof Error ? err.message : err);
    }

    // Print final state for this task before moving to the next
    const s = await readState(id, expected).catch(() => null);
    if (s) {
      console.log(`  status: ${colorStatus(s.status)}  agent: ${s.agent}  turns: ${s.turnCount ?? '-'}  events: ${s.events}\n`);
    }
  }

  // ── Step 4: Final report ──
  console.log('═══════════════════════════════════════════════════════════');
  console.log('FINAL REPORT');
  console.log('═══════════════════════════════════════════════════════════');
  for (const { id, tag } of createdIds) {
    const s = await readState(id, expectedAgentForTag(tag));
    console.log(`\n[${tag}] ${s.title}`);
    console.log(`  task id:        ${s.id}`);
    console.log(`  expected agent: ${s.expectedAgent}`);
    console.log(`  routed to:      ${s.agent}  ${s.agent === s.expectedAgent ? '✓' : '✗ MISMATCH'}`);
    console.log(`  final status:   ${colorStatus(s.status)}`);
    console.log(`  turns:          ${s.turnCount ?? '—'}`);
    console.log(`  events logged:  ${s.events}`);
    console.log(`  started:        ${s.startedAt ?? '—'}`);
    console.log(`  completed:      ${s.completedAt ?? '—'}`);
    if (s.failureClass) console.log(`  failure class:  ${s.failureClass}`);

    // Pull last 3 events for context
    const [exec] = await db
      .select({ execution_log: taskExecutions.execution_log })
      .from(taskExecutions)
      .where(eq(taskExecutions.task_id, id))
      .orderBy(desc(taskExecutions.started_at))
      .limit(1);
    const events = (exec?.execution_log ?? []) as Array<Record<string, unknown>>;
    if (events.length > 0) {
      console.log(`  last events:`);
      for (const e of events.slice(-3)) {
        const evt = String(e.event ?? e.message ?? '').slice(0, 100);
        const ts = String(e.timestamp ?? '').slice(11, 19);
        console.log(`    [${ts}] ${evt}`);
      }
    }
  }
  console.log('\n═══════════════════════════════════════════════════════════');

  process.exit(0);
}

main().catch((e) => {
  console.error('Runner crashed:', e);
  process.exit(1);
});
