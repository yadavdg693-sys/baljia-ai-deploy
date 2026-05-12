// CEO splitting behavioral smoke test
// Verifies that an explicit multi-feature ask triggers >=2 create_task calls
// with honest per-piece estimated_hours, not 1 bundled call with hours: 4.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-ceo-splitting.ts
//
// This is the LIVE test we owed the splitting fix per the
// 95%-confidence stop rule. Unit tests prove the 4-hour cap is enforced;
// this test proves the model actually splits instead of lying with
// estimated_hours: 4 on a clearly 12-hour scope.

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

interface SplitCall {
  index: number;
  title?: string;
  description_excerpt?: string;
  tag?: string;
  complexity?: number;
  estimated_hours?: number;
  priority?: string;
  related_task_ids?: string[];
  tool_result_excerpt?: string;
  rejected?: boolean;
}

async function main() {
  console.log('━'.repeat(64));
  console.log('  CEO SPLITTING SMOKE — multi-feature ask → create_task calls');
  console.log('━'.repeat(64));

  // Dynamic imports AFTER env is loaded so DATABASE_URL is read.
  const { db, users, companies, tasks, creditLedger, agents, memoryLayers, documents } =
    await import('../lib/db');
  const { eq, sql: drizzleSql } = await import('drizzle-orm');
  const { streamCEOResponse } = await import('../lib/agents/ceo/ceo.agent');

  // Sanity: at least one Anthropic-compatible auth path must be present.
  const { isAnthropicAvailable, getPreferredProvider } = await import('../lib/llm-provider');
  console.log(`\nPreferred provider: ${getPreferredProvider()}`);
  console.log(`Anthropic available: ${isAnthropicAvailable()}`);
  if (!isAnthropicAvailable() && !process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    console.error('No LLM provider configured. Need ANTHROPIC creds, OpenAI key, or OpenRouter.');
    process.exit(1);
  }

  // ── Setup ──
  let testUserId = '';
  let testCompanyId = '';

  try {
    const dbReady = await db.execute(drizzleSql`SELECT current_database()`);
    console.log(`DB connected: ${JSON.stringify(dbReady.rows[0])}`);
  } catch (e) {
    console.error('Cannot connect to database:', e);
    process.exit(1);
  }

  const [agentCount] = await db.select({ count: drizzleSql<number>`count(*)::int` }).from(agents);
  if ((agentCount?.count ?? 0) === 0) {
    console.error('Agents not seeded. Run: npx tsx src/scripts/seed-db.ts');
    process.exit(1);
  }

  const [user] = await db.insert(users).values({
    email: `ceo-split-test-${Date.now()}@baljia.test`,
    name: 'CEO Split Test',
    email_verified: true,
  }).returning();
  testUserId = user.id;

  const [company] = await db.insert(companies).values({
    owner_id: testUserId,
    name: 'SplitTestCo',
    slug: `splittest-${Date.now()}`,
    one_liner: 'Lifestyle blog for content creators',
    lifecycle: 'trial_active',
    plan_tier: 'trial',
    execution_state: 'active',
    company_email: 'hello@splittest.baljia.app',
  }).returning();
  testCompanyId = company.id;

  await db.insert(creditLedger).values({
    company_id: testCompanyId,
    entry_type: 'grant',
    amount: 10,
    balance_after: 10,
    description: 'Trial grant for splitting smoke test',
  });

  await db.insert(documents).values({
    company_id: testCompanyId,
    doc_type: 'mission',
    title: 'Mission Statement',
    content: 'SplitTestCo is a lifestyle blog for content creators. Built with Next.js.',
    is_empty: false,
  });

  await db.insert(memoryLayers).values({
    company_id: testCompanyId,
    layer: 1,
    content: 'SplitTestCo is a lifestyle blog. Target: content creators. Stack: Next.js + Postgres.',
    token_count: 25,
    max_tokens: 15000,
  });

  console.log(`\nTest company: ${testCompanyId} (${company.name})`);

  // ── Run ──
  // Scenarios are selectable so we can test prompts beyond the worked-example
  // shape baked into the CEO prompt (which uses the blog system as its
  // canonical "this is how splitting looks" demo). Override with --scenario.
  const scenarios: Record<string, string> = {
    blog: 'Build a complete blog system. I need posts CRUD (create/edit/delete posts, public listing page, single post view), a comments system on each post with threading and delete-own-comment, and a separate admin moderation panel where I can manage all posts and comments. Use Next.js + Postgres.',
    outreach:
      'Set up an automated cold-outreach pipeline. I want to scrape LinkedIn for VPs of Engineering at Series A SaaS startups, enrich each with a verified work email via Hunter.io, send a 3-touch personalized cadence from our company inbox, and track opens + replies in a dashboard view I can check daily. Aim for 50 prospects in the first batch.',
    saas:
      'Build the v1 of a SaaS task tracker. Email-password auth + Google OAuth, a task list page with CRUD, due dates and tags, a Stripe-backed $9/mo subscription gate after a 7-day trial, and a transactional onboarding email sequence via Postmark (welcome → tip → trial-ending). Next.js + Postgres.',
  };
  const scenarioArg = process.argv.find((a) => a.startsWith('--scenario='))?.split('=')[1] ?? 'blog';
  const MULTI_FEATURE_ASK = scenarios[scenarioArg] ?? scenarios.blog;
  console.log(`\nScenario: ${scenarioArg}`);

  console.log('\n── Founder ask ──');
  console.log(MULTI_FEATURE_ASK);
  console.log('\n── CEO streaming response ──\n');

  // CEOStreamEvent emits 3 event types: 'text', 'action', 'done'.
  // create_task SUCCESS produces an 'action' of type 'task_proposal' carrying
  // the task data (incl. estimated_hours + priority). Rejected create_task
  // calls (estimated_hours > 4) return content-only — no action — so we'll
  // detect those by counting expected vs observed actions, and by reading
  // text + DB after the stream.

  let textBuffer = '';
  const acceptedFromActions: SplitCall[] = [];
  let actionIndex = 0;

  try {
    for await (const ev of streamCEOResponse({
      companyId: testCompanyId,
      message: MULTI_FEATURE_ASK,
      sessionHistory: [],
    })) {
      const evt = ev as unknown as Record<string, unknown>;
      const t = evt.type as string | undefined;
      if (t === 'text') {
        const c = (evt.content as string) ?? '';
        textBuffer += c;
        process.stdout.write(c);
      } else if (t === 'action') {
        const action = evt.action as Record<string, unknown> | undefined;
        if (action && action.type === 'task_proposal') {
          const data = (action.data as Record<string, unknown>) ?? {};
          const call: SplitCall = {
            index: ++actionIndex,
            title: data.title as string,
            description_excerpt: ((data.description as string) ?? '').slice(0, 140),
            tag: data.tag as string,
            estimated_hours: data.estimated_hours as number,
            priority:
              typeof data.priority === 'number'
                ? ({ 25: 'low', 50: 'medium', 75: 'high', 100: 'critical' } as Record<number, string>)[
                    data.priority as number
                  ]
                : (data.priority as string),
          };
          acceptedFromActions.push(call);
          console.log(
            `\n[action #${call.index}] task_proposal("${call.title}") hours=${call.estimated_hours} priority=${call.priority ?? '-'}`,
          );
        }
      } else if (t === 'done') {
        // stream complete
      }
    }
  } catch (err) {
    console.error('\nStream error:', err);
  }

  // ── Ground truth: read DB to see what actually got persisted ──
  console.log('\n\n── Inspecting tasks table ──');
  const createdTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      tag: tasks.tag,
      complexity: tasks.complexity,
      estimated_hours: tasks.estimated_hours,
      estimated_credits: tasks.estimated_credits,
      priority: tasks.priority,
      related_task_ids: tasks.related_task_ids,
      queue_order: tasks.queue_order,
    })
    .from(tasks)
    .where(eq(tasks.company_id, testCompanyId));

  console.log(`Found ${createdTasks.length} task row(s) in DB:`);
  for (const t of createdTasks) {
    console.log(
      `  • [${t.id.slice(0, 8)}] "${t.title}" — tag=${t.tag} hours=${t.estimated_hours} complexity=${t.complexity} priority=${t.priority} credits=${t.estimated_credits} related=${JSON.stringify(t.related_task_ids ?? [])}`,
    );
  }

  // Build the unified splitCalls list from DB (ground truth) + actions
  // (for any creations the stream may have buffered late).
  const splitCalls: SplitCall[] = createdTasks.map((t, i) => ({
    index: i + 1,
    title: t.title,
    description_excerpt: (t.description ?? '').slice(0, 140),
    tag: t.tag,
    complexity: t.complexity ?? undefined,
    estimated_hours:
      t.estimated_hours !== null && t.estimated_hours !== undefined
        ? Number(t.estimated_hours)
        : undefined,
    priority:
      typeof t.priority === 'number'
        ? ({ 25: 'low', 50: 'medium', 75: 'high', 100: 'critical' } as Record<number, string>)[
            t.priority
          ] ?? `${t.priority}`
        : (t.priority as unknown as string),
    related_task_ids: (t.related_task_ids as string[] | null) ?? [],
  }));

  console.log('\n── Verdict ──');
  const accepted = splitCalls; // DB rows = accepted creations (rejections never persist)
  console.log(`Accepted create_task → tasks row count: ${accepted.length}`);
  console.log(`Action events seen during stream: ${acceptedFromActions.length}`);
  if (acceptedFromActions.length !== accepted.length) {
    console.log(
      `  (mismatch: stream saw ${acceptedFromActions.length} action events vs ${accepted.length} DB rows — usually a timing artifact, both should agree)`,
    );
  }

  let verdict: 'PASS' | 'PARTIAL' | 'FAIL' = 'FAIL';
  const notes: string[] = [];

  if (accepted.length >= 3) {
    notes.push(`✓ Split into ${accepted.length} accepted tasks (target ≥ 3 for this scope).`);
    verdict = 'PASS';
  } else if (accepted.length === 2) {
    notes.push('~ Split into 2 accepted tasks. Better than 1, but the ask names 3 features.');
    verdict = 'PARTIAL';
  } else if (accepted.length === 1) {
    notes.push('✗ Only 1 accepted task — model bundled the multi-feature ask.');
  } else {
    notes.push('✗ Zero accepted tasks.');
  }

  // Honesty check: any accepted task with estimated_hours = 4 AND a description
  // that smells like multiple deliverables is suspicious.
  for (const c of accepted) {
    const desc = c.description_excerpt ?? '';
    const hasMultipleDeliverables =
      /(?: and (?:a |an |the )?\w)|(?:, ?\w)/i.test(desc) &&
      (desc.match(/\b(and|plus|also)\b/gi)?.length ?? 0) >= 2;
    if ((c.estimated_hours ?? 0) >= 4 && hasMultipleDeliverables) {
      notes.push(
        `⚠ #${c.index} "${c.title}" — hours=${c.estimated_hours} but description sounds like multiple deliverables. Possible estimate-lying.`,
      );
      verdict = verdict === 'PASS' ? 'PARTIAL' : verdict;
    }
  }

  // Dependency-linking: at least one of the later pieces should reference the
  // first piece's id (or "piece 1" / placeholder). Hard to verify across calls
  // without the inserted task ids — flag if related_task_ids is empty on all.
  const anyDependencyLink = accepted.some((c) => (c.related_task_ids ?? []).length > 0);
  if (accepted.length >= 2 && !anyDependencyLink) {
    notes.push(
      '~ No related_task_ids on any piece — sequential pieces should link upstream. Worker won\'t know prior-piece context.',
    );
    if (verdict === 'PASS') verdict = 'PARTIAL';
  }

  for (const n of notes) console.log(`  ${n}`);

  // Founder-facing message check: should mention the breakdown.
  const founderMentionsSplit = /\b(split|task[s]?|piece[s]?|step[s]?|first|then)\b/i.test(textBuffer);
  console.log(
    `Founder-facing reply mentions split/breakdown: ${founderMentionsSplit ? 'yes' : 'no'}`,
  );

  console.log(`\n  VERDICT: ${verdict}`);

  // ── Detail dump ──
  console.log('\n── Per-call detail ──');
  for (const c of splitCalls) {
    console.log(
      `\n  #${c.index} ${c.rejected ? '[REJECTED]' : ''} ${c.title ?? '(no title)'}`,
    );
    console.log(`    tag=${c.tag} complexity=${c.complexity} hours=${c.estimated_hours} priority=${c.priority ?? '-'}`);
    if ((c.related_task_ids ?? []).length > 0) {
      console.log(`    related: [${c.related_task_ids!.join(', ')}]`);
    }
    if (c.description_excerpt) {
      console.log(`    desc: ${c.description_excerpt}…`);
    }
    if (c.tool_result_excerpt) {
      console.log(`    result: ${c.tool_result_excerpt.replace(/\n/g, ' ').slice(0, 200)}`);
    }
  }

  // ── Cleanup ──
  // `eventService.emit` writes to platform_events for every accepted
  // task_created action — those rows reference company_id with a FK, so we
  // must delete them before the companies row.
  console.log('\n\n🧹 Cleanup…');
  try {
    const { sql: drizzleSqlInner } = await import('drizzle-orm');
    await db.execute(
      drizzleSqlInner`DELETE FROM platform_events WHERE company_id = ${testCompanyId}`,
    );
    await db.delete(tasks).where(eq(tasks.company_id, testCompanyId));
    await db.delete(memoryLayers).where(eq(memoryLayers.company_id, testCompanyId));
    await db.delete(documents).where(eq(documents.company_id, testCompanyId));
    await db.delete(creditLedger).where(eq(creditLedger.company_id, testCompanyId));
    await db.delete(companies).where(eq(companies.id, testCompanyId));
    await db.delete(users).where(eq(users.id, testUserId));
    console.log('  ✓ test data removed');
  } catch (err) {
    console.log(`  ⚠ cleanup error: ${err instanceof Error ? err.message : err}`);
  }

  process.exit(verdict === 'PASS' ? 0 : verdict === 'PARTIAL' ? 2 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
