// End-to-end onboarding test harness.
//
// Usage:
//   node --env-file=.env.local --import tsx src/scripts/e2e-onboarding.ts <journey>
// where <journey> is one of: surprise_me | build_my_idea | grow_my_company
//
// What it does:
//   1. Upserts a synthetic test user per journey.
//   2. Wipes that user's prior test companies (and dependent rows).
//   3. Creates a fresh placeholder company.
//   4. Awaits runOnboardingPipeline() to completion.
//   5. Dumps full DB state and emits a PASS/FAIL report on what populated.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import {
  db,
  users,
  companies,
  tasks,
  taskExecutions,
  taskFailureLinks,
  approvalRecords,
  artifacts,
  runs,
  sessions,
  documents,
  documentSuggestions,
  reports,
  memoryLayers,
  learnings,
  subscriptions,
  creditLedger,
  revenueLedger,
  adCampaigns,
  adSpendLedger,
  refundHistory,
  recurringTasks,
  nightShiftCycles,
  emailThreads,
  contacts,
  browserCredentials,
  chatSessions,
  platformEvents,
  dashboardLinks,
  platformFeedback,
  tweets,
  roadmaps,
  runtimeAiCosts,
} from '@/lib/db';
import { eq, desc, inArray } from 'drizzle-orm';
import * as companyService from '@/lib/services/company.service';
import * as creditService from '@/lib/services/credit.service';
import { runOnboardingPipeline } from '@/lib/services/onboarding/orchestrator';
import type { OnboardingJourney } from '@/types';

interface JourneyConfig {
  email: string;
  input: string | undefined;
  ip: string | null;
  timezone: string;
}

const CONFIGS: Record<OnboardingJourney, JourneyConfig> = {
  surprise_me: {
    email: 'e2e-surprise@baljia.test',
    input: undefined,
    ip: '103.99.0.1',
    timezone: 'Asia/Kolkata',
  },
  build_my_idea: {
    email: 'e2e-build@baljia.test',
    input: 'A scheduling tool for solo dental clinics that auto-confirms appointments by SMS and reschedules no-shows.',
    ip: '103.99.0.1',
    timezone: 'Asia/Kolkata',
  },
  grow_my_company: {
    email: 'e2e-grow@baljia.test',
    input: 'https://linear.app',
    ip: '103.99.0.1',
    timezone: 'Asia/Kolkata',
  },
};

async function ensureUser(email: string): Promise<string> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(users).values({ email, auth_provider: 'magic_link' }).returning({ id: users.id });
  return created.id;
}

// Wipe in FK dependency order using typed Drizzle deletes (sql.raw via Neon HTTP
// silently swallows DELETE errors, so we cannot use it). Layer numbers indicate
// FK depth: deeper layers must be cleared before shallower ones.
async function wipeTestCompanies(userId: string): Promise<number> {
  const cos = await db.select({ id: companies.id }).from(companies).where(eq(companies.owner_id, userId));
  if (cos.length === 0) return 0;
  const companyIds = cos.map((c) => c.id);

  // Pull task IDs — needed for tables that reference tasks but not companies.
  const taskRows = await db.select({ id: tasks.id }).from(tasks).where(inArray(tasks.company_id, companyIds));
  const taskIds = taskRows.map((t) => t.id);

  // Layer 1: artifacts (depends on runs.id and tasks.id).
  if (taskIds.length > 0) {
    await db.delete(artifacts).where(inArray(artifacts.task_id, taskIds));
  }

  // Layer 2: runs (depends on sessions.id and tasks.id).
  if (taskIds.length > 0) {
    await db.delete(runs).where(inArray(runs.task_id, taskIds));
  }

  // Layer 3: tables with task_id only (no company_id).
  if (taskIds.length > 0) {
    await db.delete(taskExecutions).where(inArray(taskExecutions.task_id, taskIds));
    await db.delete(taskFailureLinks).where(inArray(taskFailureLinks.task_id, taskIds));
    await db.delete(approvalRecords).where(inArray(approvalRecords.task_id, taskIds));
  }

  // Layer 4: sessions (company_id + task_id) — must come before tasks.
  await db.delete(sessions).where(inArray(sessions.company_id, companyIds));

  // Layer 5: ALL tables with task_id FK to tasks.id — must precede Layer 6 (tasks).
  // task_id is nullable in most of these but Postgres still enforces RESTRICT on delete.
  await db.delete(reports).where(inArray(reports.company_id, companyIds));
  await db.delete(tweets).where(inArray(tweets.company_id, companyIds));
  await db.delete(runtimeAiCosts).where(inArray(runtimeAiCosts.company_id, companyIds));
  await db.delete(creditLedger).where(inArray(creditLedger.company_id, companyIds));
  await db.delete(documentSuggestions).where(inArray(documentSuggestions.company_id, companyIds));
  await db.delete(learnings).where(inArray(learnings.company_id, companyIds));
  await db.delete(refundHistory).where(inArray(refundHistory.company_id, companyIds));

  // Layer 6: tasks (last task-related delete).
  await db.delete(tasks).where(inArray(tasks.company_id, companyIds));

  // Layer 7: remaining company_id tables. adSpendLedger.campaign_id FK → adCampaigns must precede it.
  await db.delete(documents).where(inArray(documents.company_id, companyIds));
  await db.delete(memoryLayers).where(inArray(memoryLayers.company_id, companyIds));
  await db.delete(revenueLedger).where(inArray(revenueLedger.company_id, companyIds));
  await db.delete(adSpendLedger).where(inArray(adSpendLedger.company_id, companyIds));
  await db.delete(adCampaigns).where(inArray(adCampaigns.company_id, companyIds));
  await db.delete(recurringTasks).where(inArray(recurringTasks.company_id, companyIds));
  await db.delete(nightShiftCycles).where(inArray(nightShiftCycles.company_id, companyIds));
  await db.delete(emailThreads).where(inArray(emailThreads.company_id, companyIds));
  await db.delete(contacts).where(inArray(contacts.company_id, companyIds));
  await db.delete(browserCredentials).where(inArray(browserCredentials.company_id, companyIds));
  await db.delete(chatSessions).where(inArray(chatSessions.company_id, companyIds));
  await db.delete(platformEvents).where(inArray(platformEvents.company_id, companyIds));
  await db.delete(dashboardLinks).where(inArray(dashboardLinks.company_id, companyIds));
  await db.delete(platformFeedback).where(inArray(platformFeedback.company_id, companyIds));
  await db.delete(subscriptions).where(inArray(subscriptions.company_id, companyIds));

  // Layer 8: roadmaps (cascade-deletes milestones → milestone_criteria via FK ON DELETE CASCADE).
  await db.delete(roadmaps).where(inArray(roadmaps.company_id, companyIds));

  // Layer 9: companies.
  for (const id of companyIds) {
    await db.delete(companies).where(eq(companies.id, id));
  }

  return cos.length;
}

interface CheckResult { name: string; pass: boolean; detail: string; }

async function dumpAndCheck(companyId: string, journey: OnboardingJourney): Promise<CheckResult[]> {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  const [taskRows, docRows, reportRows, events, credits, emails] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.company_id, companyId)),
    db.select().from(documents).where(eq(documents.company_id, companyId)),
    db.select().from(reports).where(eq(reports.company_id, companyId)),
    db.select().from(platformEvents).where(eq(platformEvents.company_id, companyId)).orderBy(desc(platformEvents.created_at)),
    db.select().from(creditLedger).where(eq(creditLedger.company_id, companyId)),
    db.select().from(emailThreads).where(eq(emailThreads.company_id, companyId)),
  ]);

  console.log(`\n────── DB state for ${journey} (${companyId}) ──────`);
  console.log(`  Company: name="${c?.name}" slug="${c?.slug}" status=${c?.onboarding_status} subdomain=${c?.subdomain ?? '-'} stage=${c?.company_stage}`);
  console.log(`  one_liner: ${c?.one_liner ?? '-'}`);
  console.log(`  Tasks (${taskRows.length}):`);
  for (const t of taskRows) console.log(`    - [${t.status}] ${t.title} (tag=${t.tag}, agent=${t.agent_id ?? '-'})`);
  console.log(`  Documents (${docRows.length}):`);
  for (const d of docRows) console.log(`    - ${d.doc_type}: "${d.title}" (${(d.content ?? '').length} chars)`);
  console.log(`  Reports: ${reportRows.length}`);
  console.log(`  Credit ledger entries: ${credits.length} (sum=${credits.reduce((a, x) => a + Number(x.amount ?? 0), 0)})`);
  console.log(`  Email threads: ${emails.length}`);

  const failedEvents = events.filter((e) => e.event_type === 'onboarding_failed');
  if (failedEvents.length) {
    console.log(`  ⚠ ${failedEvents.length} failed events:`);
    for (const e of failedEvents) {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      console.log(`     ${e.created_at?.toISOString?.()} ${(p.error ?? '').toString().slice(0, 200)}`);
    }
  }
  const stages = events.filter((e) => e.event_type === 'onboarding_stage');
  console.log(`  Stage events: ${stages.length}`);

  const checks: CheckResult[] = [
    { name: 'company exists', pass: !!c, detail: c?.id ?? 'missing' },
    { name: 'company has real name (not "My Company")', pass: !!c?.name && c.name !== 'My Company', detail: c?.name ?? '-' },
    { name: 'company has slug', pass: !!c?.slug && c.slug !== 'my-company', detail: c?.slug ?? '-' },
    { name: 'company has one_liner', pass: !!c?.one_liner && c.one_liner.length > 5, detail: (c?.one_liner ?? '').slice(0, 60) },
    { name: 'company has subdomain', pass: !!c?.subdomain, detail: c?.subdomain ?? '-' },
    { name: 'onboarding_status terminal-success', pass: c?.onboarding_status === 'completed' || c?.onboarding_status === 'ready', detail: c?.onboarding_status ?? '-' },
    { name: 'starter tasks created (>=3)', pass: taskRows.length >= 3, detail: `${taskRows.length} tasks` },
    { name: 'mission document exists', pass: docRows.some((d) => d.doc_type === 'mission'), detail: docRows.map((d) => d.doc_type).join(',') },
    { name: 'market_research document exists', pass: docRows.some((d) => d.doc_type === 'market_research'), detail: '' },
    { name: 'no failed events', pass: failedEvents.length === 0, detail: `${failedEvents.length} failures` },
    { name: 'welcome credit granted', pass: credits.some((cr) => Number(cr.amount) > 0), detail: '' },
  ];

  console.log(`\n  Checks:`);
  for (const ch of checks) {
    console.log(`    ${ch.pass ? '✓' : '✗'} ${ch.name}${ch.detail ? `  (${ch.detail})` : ''}`);
  }
  return checks;
}

async function main() {
  const journey = process.argv[2] as OnboardingJourney | undefined;
  if (!journey || !(journey in CONFIGS)) {
    console.error('Usage: node --env-file=.env.local --import tsx src/scripts/e2e-onboarding.ts <surprise_me|build_my_idea|grow_my_company>');
    process.exit(1);
  }
  const cfg = CONFIGS[journey];

  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`  E2E ONBOARDING TEST: ${journey}`);
  console.log(`══════════════════════════════════════════════════`);
  console.log(`  test user: ${cfg.email}`);
  console.log(`  input:     ${cfg.input ?? '(none)'}`);
  console.log(`  ip:        ${cfg.ip}`);

  const userId = await ensureUser(cfg.email);
  const wiped = await wipeTestCompanies(userId);
  console.log(`  Wiped ${wiped} prior test companies\n`);

  // Create placeholder (mirrors what /api/onboarding does)
  const company = await companyService.createCompany({
    owner_id: userId,
    name: 'My Company',
    original_idea: cfg.input ?? null,
  });
  await creditService.addCredit(company.id, 10, 'welcome_bonus', 'Welcome bonus — 10 trial credits');
  console.log(`  Created placeholder company ${company.id}`);
  console.log(`  Running pipeline... (may take 30–120s)\n`);

  const t0 = Date.now();
  try {
    await runOnboardingPipeline(
      company.id,
      userId,
      journey,
      cfg.input,
      cfg.ip,
      cfg.timezone,
      'en-US',
      'e2e-test-script',
    );
  } catch (e) {
    console.log(`  Pipeline threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\n  Pipeline returned after ${elapsed}s`);

  const checks = await dumpAndCheck(company.id, journey);
  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  console.log(`\n  RESULT: ${passed}/${total} checks passed\n`);

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
