// Headless smoke test — runs one onboarding journey end-to-end and asserts
// artifacts appear in DB (documents, tasks, memory layer 1, events).
//
// Usage:
//   npx tsx scripts/smoke-test-onboarding.ts [journey] [--idea "text" | --url example.com]
//
// Defaults to build_my_idea with a canned idea.
//
// Cost: ~$0.10-0.20 of LLM + ~20-30 Tavily calls per run.
// Side effects: creates one real company row + related documents/tasks/memory.
//   Company name/slug are LLM-generated; row stays in DB as a test artifact
//   (not auto-deleted). Find it by owner = smoke-test user + source='onboarding'.

import 'dotenv/config';
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) config({ path: '.env.local', override: true });

// Import AFTER env is loaded so anything reading process.env at import time gets real values
import { db, companies, users, documents, tasks, memoryLayers, platformEvents, creditLedger, memoryLayers as _ml } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';
import type { OnboardingJourney } from '@/types';

// ──────────────────────────────────────────────────────────────────────────
// Argument parsing
// ──────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const journey: OnboardingJourney = (args[0] as OnboardingJourney) ?? 'build_my_idea';
const ideaFlagIdx = args.indexOf('--idea');
const urlFlagIdx = args.indexOf('--url');
const nameFlagIdx = args.indexOf('--name');
const emailFlagIdx = args.indexOf('--email');

const DEFAULT_IDEA = 'AI-powered client feedback management tool for freelance designers';
const DEFAULT_URL = 'https://linear.app'; // real public site for Grow test
const input =
  ideaFlagIdx !== -1 ? args[ideaFlagIdx + 1]
  : urlFlagIdx !== -1 ? args[urlFlagIdx + 1]
  : journey === 'grow_my_company' ? DEFAULT_URL
  : journey === 'build_my_idea' ? DEFAULT_IDEA
  : undefined;

// For Surprise Me: default to a well-known founder name so Tavily LinkedIn/Twitter
// enrichment returns meaningful content. For other journeys: generic smoke user
// (enrichment isn't used for idea generation, so no need for real footprint).
const DEFAULT_SURPRISE_NAME = 'Paul Graham';
const DEFAULT_SURPRISE_EMAIL = 'surprise-smoke@baljia.app';

const SMOKE_NAME =
  nameFlagIdx !== -1 ? args[nameFlagIdx + 1]
  : journey === 'surprise_me' ? DEFAULT_SURPRISE_NAME
  : 'Smoke Test';

const SMOKE_EMAIL =
  emailFlagIdx !== -1 ? args[emailFlagIdx + 1]
  : journey === 'surprise_me' ? DEFAULT_SURPRISE_EMAIL
  : 'smoke-test@baljia.app';
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000;

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function line(char = '─'): void {
  console.log(char.repeat(70));
}

function header(title: string): void {
  line();
  console.log(title);
  line();
}

function pass(msg: string): void {
  console.log(`  ✅ ${msg}`);
}

function fail(msg: string): void {
  console.log(`  ❌ ${msg}`);
}

function warn(msg: string): void {
  console.log(`  ⚠️  ${msg}`);
}

let passCount = 0;
let failCount = 0;

function assertPass(cond: boolean, passMsg: string, failMsg: string): void {
  if (cond) {
    pass(passMsg);
    passCount++;
  } else {
    fail(failMsg);
    failCount++;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Setup: user + company + initial credits
// ──────────────────────────────────────────────────────────────────────────

async function ensureSmokeUser(): Promise<{ id: string }> {
  const [existing] = await db.select({ id: users.id, name: users.name })
    .from(users).where(eq(users.email, SMOKE_EMAIL)).limit(1);
  if (existing) {
    // Update name if it has drifted — important for Surprise journey where Tavily
    // searches use name for enrichment.
    if (existing.name !== SMOKE_NAME) {
      await db.update(users).set({ name: SMOKE_NAME }).where(eq(users.id, existing.id));
    }
    return { id: existing.id };
  }
  const [created] = await db.insert(users)
    .values({ email: SMOKE_EMAIL, name: SMOKE_NAME, auth_provider: 'magic_link' })
    .returning({ id: users.id });
  return created;
}

async function createSmokeCompany(ownerId: string): Promise<{ id: string }> {
  // Use company.service.createCompany for the full initialization (memory layers, etc.)
  const companyService = await import('@/lib/services/company.service');
  const company = await companyService.createCompany({
    owner_id: ownerId,
    name: `Smoke Test ${new Date().toISOString()}`,
    original_idea: input,
  });
  return { id: company.id };
}

async function seedWelcomeCredits(companyId: string): Promise<void> {
  const creditService = await import('@/lib/services/credit.service');
  await creditService.addCredit(companyId, 10, 'welcome_bonus', 'Smoke-test welcome bonus');
}

// ──────────────────────────────────────────────────────────────────────────
// Pipeline runner + poller
// ──────────────────────────────────────────────────────────────────────────

async function runPipeline(companyId: string, userId: string): Promise<'completed' | 'failed' | 'timeout'> {
  const { runOnboardingPipeline } = await import('@/lib/services/onboarding/orchestrator');

  // Fire-and-forget; poll for status
  const promise = runOnboardingPipeline(
    companyId, userId, journey, input,
    '8.8.8.8',                     // request IP for GeoIP (Google DNS → Mountain View, US)
    'America/Los_Angeles',         // browser timezone
    'en-US',                       // browser locale
    'smoke-test-agent/1.0',        // user agent
  );

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = 'initializing';

  while (Date.now() < deadline) {
    const [row] = await db.select({ status: companies.onboarding_status })
      .from(companies).where(eq(companies.id, companyId)).limit(1);
    const status = row?.status ?? 'unknown';
    if (status !== lastStatus) {
      console.log(`  [${new Date().toLocaleTimeString()}] onboarding_status = ${status}`);
      lastStatus = status;
    }
    if (status === 'completed') {
      await promise.catch(() => { /* finally already ran */ });
      return 'completed';
    }
    if (status === 'failed') {
      await promise.catch(() => { /* error already logged */ });
      return 'failed';
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return 'timeout';
}

// ──────────────────────────────────────────────────────────────────────────
// Assertions — run after pipeline completes
// ──────────────────────────────────────────────────────────────────────────

async function assertArtifacts(companyId: string): Promise<void> {
  header('Assertions');

  // Company state
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  assertPass(
    company?.onboarding_status === 'completed',
    `onboarding_status = completed`,
    `onboarding_status = ${company?.onboarding_status} (expected completed)`,
  );
  assertPass(
    !!company?.name && company.name !== 'My Company',
    `company renamed to "${company?.name}"`,
    `company name still placeholder ("${company?.name}")`,
  );
  assertPass(
    !!company?.slug && company.slug.length > 0,
    `slug set: ${company?.slug}`,
    `slug missing`,
  );
  assertPass(
    !!company?.one_liner && company.one_liner.length > 5,
    `one_liner set: "${company?.one_liner?.slice(0, 80)}"`,
    `one_liner missing`,
  );

  // Documents: mission, market_research, landing_page
  const docs = await db.select().from(documents).where(eq(documents.company_id, companyId));
  const docTypes = new Set(docs.map((d) => d.doc_type));
  assertPass(docTypes.has('mission'), `mission doc exists`, `mission doc missing`);
  assertPass(docTypes.has('market_research'), `market_research doc exists`, `market_research doc missing`);
  assertPass(docTypes.has('landing_page'), `landing_page doc exists`, `landing_page doc missing (optional — may skip)`);

  for (const doc of docs) {
    const content = (doc.content ?? '') as string;
    if (doc.doc_type === 'mission') {
      assertPass(
        content.includes('Mission') && content.includes("building") && content.includes('headed'),
        `mission has 3 sections (Mission / What we're building / Where we're headed)`,
        `mission missing 3-section structure`,
      );
    }
    if (doc.doc_type === 'market_research') {
      assertPass(
        content.length > 500,
        `market_research has substance (${content.length} chars)`,
        `market_research too thin (${content.length} chars)`,
      );
      assertPass(
        !content.match(/\bIndia\b/i) || content.match(/India/g)!.length < 3,
        `market_research does not hardcode India (appears <3 times or not at all — acceptable since founder geo is US for this test)`,
        `market_research mentions India too often — possible hardcoded bias`,
      );
    }
  }

  // Tasks: 3 starter tasks with correct tags + Polsia field values
  const companyTasks = await db.select().from(tasks)
    .where(and(eq(tasks.company_id, companyId), eq(tasks.source, 'onboarding')))
    .orderBy(tasks.queue_order);

  assertPass(companyTasks.length === 3, `3 starter tasks created`, `expected 3 starter tasks, got ${companyTasks.length}`);

  if (companyTasks.length === 3) {
    const [eng, res, out] = companyTasks;
    assertPass(eng.tag === 'engineering', `task 1 tag = engineering`, `task 1 tag = ${eng.tag}`);
    assertPass(res.tag === 'research', `task 2 tag = research`, `task 2 tag = ${res.tag}`);
    assertPass(out.tag === 'outreach', `task 3 tag = outreach`, `task 3 tag = ${out.tag}`);
    assertPass(eng.priority === 100, `engineering priority = 100`, `engineering priority = ${eng.priority}`);
    assertPass(res.priority === 70, `research priority = 70`, `research priority = ${res.priority}`);
    assertPass(out.priority === 70, `outreach priority = 70`, `outreach priority = ${out.priority}`);
    assertPass(eng.complexity === 8, `engineering complexity = 8`, `engineering complexity = ${eng.complexity}`);
    assertPass(res.complexity === 3, `research complexity = 3`, `research complexity = ${res.complexity}`);
    assertPass(out.complexity === 4, `outreach complexity = 4`, `outreach complexity = ${out.complexity}`);
    assertPass(String(eng.estimated_hours) === '3.0' || String(eng.estimated_hours) === '3', `engineering hours = 3`, `engineering hours = ${eng.estimated_hours}`);
    assertPass(String(res.estimated_hours) === '1.0' || String(res.estimated_hours) === '1', `research hours = 1`, `research hours = ${res.estimated_hours}`);
    assertPass(String(out.estimated_hours) === '1.0' || String(out.estimated_hours) === '1', `outreach hours = 1`, `outreach hours = ${out.estimated_hours}`);

    assertPass(
      !!eng.description && eng.description.length > 200,
      `engineering description has depth (${eng.description?.length ?? 0} chars)`,
      `engineering description too thin (${eng.description?.length ?? 0} chars)`,
    );
    assertPass(
      !!eng.suggestion_reasoning && eng.suggestion_reasoning.length > 20,
      `engineering reasoning populated`,
      `engineering reasoning missing`,
    );
  }

  // Memory layer 1
  const [layer1] = await db.select().from(memoryLayers)
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, 1)))
    .limit(1);
  const l1 = (layer1?.content ?? '') as string;
  assertPass(l1.includes('## Founder Profile'), `memory layer 1 has Founder Profile section`, `memory layer 1 missing Founder Profile`);
  assertPass(l1.includes('## Journey Context'), `memory layer 1 has Journey Context section`, `memory layer 1 missing Journey Context`);

  // Events — confirm activity + mood channels actually emitted
  const events = await db.select({ event_type: platformEvents.event_type })
    .from(platformEvents).where(eq(platformEvents.company_id, companyId));
  const eventTypes = new Set(events.map((e) => e.event_type));

  assertPass(eventTypes.has('onboarding_stage'), `onboarding_stage events emitted`, `no onboarding_stage events`);
  assertPass(eventTypes.has('onboarding_activity'), `onboarding_activity events emitted (Phase 1)`, `no onboarding_activity events — observability broken`);
  assertPass(eventTypes.has('onboarding_mood'), `onboarding_mood events emitted (Phase 1)`, `no onboarding_mood events — observability broken`);
  assertPass(eventTypes.has('onboarding_costs'), `onboarding_costs event emitted (Phase 1 cost tracking)`, `no onboarding_costs event — cost tracking broken`);
  assertPass(eventTypes.has('onboarding_completed'), `onboarding_completed event emitted`, `no onboarding_completed event`);

  // Cost event details — verify counters are NON-ZERO (audit fix #1 verification)
  const [costEvent] = await db.select({ payload: platformEvents.payload })
    .from(platformEvents)
    .where(and(eq(platformEvents.company_id, companyId), eq(platformEvents.event_type, 'onboarding_costs')))
    .orderBy(desc(platformEvents.created_at))
    .limit(1);
  if (costEvent) {
    const p = costEvent.payload as Record<string, number> | null;
    const llmCalls = p?.llm_calls ?? 0;
    const tavilyCalls = p?.tavily_calls ?? 0;
    assertPass(llmCalls > 0, `cost event llm_calls = ${llmCalls} (>0)`, `cost event llm_calls = 0 — cost wiring still dead code`);
    assertPass(tavilyCalls > 0, `cost event tavily_calls = ${tavilyCalls} (>0)`, `cost event tavily_calls = 0 — Tavily wrappers not wired`);
  }

  // Credits
  const ledger = await db.select().from(creditLedger).where(eq(creditLedger.company_id, companyId));
  const welcomeCredit = ledger.find((l) => l.entry_type === 'welcome_bonus');
  assertPass(!!welcomeCredit, `welcome_bonus ledger entry exists`, `welcome_bonus ledger entry missing`);
}

async function printEventTimeline(companyId: string): Promise<void> {
  header('Event timeline (first 40)');
  const events = await db.select({
    event_type: platformEvents.event_type,
    payload: platformEvents.payload,
    created_at: platformEvents.created_at,
  }).from(platformEvents)
    .where(eq(platformEvents.company_id, companyId))
    .orderBy(platformEvents.created_at)
    .limit(40);

  for (const e of events) {
    const p = e.payload as Record<string, unknown> | null;
    const stage = p?.stage ?? '';
    const status = p?.status ?? '';
    const text = p?.text ?? '';
    const t = e.created_at ? new Date(e.created_at as unknown as string).toLocaleTimeString() : '';
    console.log(`  ${t}  ${e.event_type.padEnd(22)} ${String(stage).padEnd(28)} ${String(status)}${text ? ' | ' + String(text).slice(0, 70) : ''}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  header(`Onboarding smoke test — journey=${journey}`);
  console.log(`  input: ${input ?? '(none)'}`);
  console.log(`  smoke user: ${SMOKE_EMAIL}`);
  line();

  console.log('Phase 1: setup');
  const user = await ensureSmokeUser();
  console.log(`  user id: ${user.id}`);
  const company = await createSmokeCompany(user.id);
  console.log(`  company id: ${company.id}`);
  await seedWelcomeCredits(company.id);
  console.log(`  welcome credits: +10`);
  line();

  console.log('Phase 2: run pipeline (up to 10 min)');
  const start = Date.now();
  const result = await runPipeline(company.id, user.id);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  result: ${result} in ${elapsed}s`);
  line();

  await printEventTimeline(company.id);

  if (result === 'timeout') {
    fail('Pipeline timed out — not running assertions');
    process.exit(1);
  }

  await assertArtifacts(company.id);

  line('═');
  console.log(`Result: ${passCount} passed, ${failCount} failed`);
  line('═');
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error('❌ smoke test crashed:', err);
  process.exit(1);
});
