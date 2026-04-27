// E2E onboarding test — runs the orchestrator directly (skips HTTP auth)
// Run: npx tsx src/scripts/test-onboarding-e2e.ts [build|grow|surprise]

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import type { OnboardingJourney } from '../types';

const JOURNEY_ARG = (process.argv[2] ?? 'build').toLowerCase();
const JOURNEY_MAP: Record<string, OnboardingJourney> = {
  build: 'build_my_idea', build_my_idea: 'build_my_idea',
  grow: 'grow_my_company', grow_my_company: 'grow_my_company',
  surprise: 'surprise_me', surprise_me: 'surprise_me',
};
const journey = JOURNEY_MAP[JOURNEY_ARG];

if (!journey) {
  console.error(`Unknown journey "${JOURNEY_ARG}". Use: build | grow | surprise`);
  process.exit(1);
}

const SAMPLE_INPUTS: Record<OnboardingJourney, string> = {
  build_my_idea: 'A platform where indie hackers post open-source side projects to attract collaborators and early users',
  grow_my_company: 'https://gumroad.com',
  surprise_me: '', // surprise_me uses founder enrichment, not a direct idea
};

async function main() {
  console.log('━'.repeat(60));
  console.log(`  ONBOARDING E2E — journey=${journey}`);
  console.log('━'.repeat(60));

  const { db, users, companies, documents, tasks, platformEvents } = await import('../lib/db');
  const { eq, and, asc, inArray } = await import('drizzle-orm');
  const creditService = await import('../lib/services/credit.service');
  const companyService = await import('../lib/services/company.service');
  const { runOnboardingPipeline } = await import('../lib/services/onboarding/orchestrator');

  const startedAt = Date.now();
  const stamp = startedAt.toString(36);
  const email = `e2e-${stamp}@baljia.test`;

  // 1. Test user
  const [user] = await db.insert(users).values({
    email, name: `E2E Bot ${stamp}`, email_verified: true,
  }).returning();
  console.log(`✓ user        ${user.id} (${user.email})`);

  // 2. Placeholder company via service (handles slug generation + sane defaults)
  const company = await companyService.createCompany({
    owner_id: user.id,
    name: 'My Company',
    original_idea: SAMPLE_INPUTS[journey] || undefined,
  });
  // Persist journey choice so resume / event handlers see it
  await db.update(companies).set({ onboarding_journey: journey }).where(eq(companies.id, company.id));
  console.log(`✓ company     ${company.id} (slug=${company.slug})`);

  // 3. Welcome credits (matches /api/onboarding flow)
  await creditService.addCredit(company.id, 10, 'welcome_bonus', 'E2E welcome bonus');
  console.log(`✓ credits     +10`);

  // 4. Watch events in background while pipeline runs
  let lastSeenAt: Date | null = null;
  let eventCount = 0;
  let stageHistory: string[] = [];
  const stop = { value: false };
  (async () => {
    while (!stop.value) {
      const conditions = [
        eq(platformEvents.company_id, company.id),
        inArray(platformEvents.event_type, [
          'onboarding_stage', 'onboarding_activity',
          'onboarding_completed', 'onboarding_failed',
        ]),
      ];
      const rows = await db.select({
        id: platformEvents.id, event_type: platformEvents.event_type,
        payload: platformEvents.payload, created_at: platformEvents.created_at,
      }).from(platformEvents).where(and(...conditions))
        .orderBy(asc(platformEvents.created_at)).limit(50);

      for (const ev of rows) {
        if (lastSeenAt && ev.created_at && ev.created_at <= lastSeenAt) continue;
        if (ev.created_at) lastSeenAt = ev.created_at;
        eventCount++;
        const payload = (ev.payload ?? {}) as Record<string, unknown>;
        if (ev.event_type === 'onboarding_stage') {
          const stage = String(payload.stage ?? '');
          const status = String(payload.status ?? '');
          if (status === 'started') {
            stageHistory.push(stage);
            console.log(`  [stage]   ${stage}…`);
          }
        } else if (ev.event_type === 'onboarding_activity') {
          const text = String(payload.text ?? '').slice(0, 100);
          if (text) console.log(`            · ${text}`);
        } else if (ev.event_type === 'onboarding_completed') {
          console.log(`✓ pipeline   completed`);
          stop.value = true;
        } else if (ev.event_type === 'onboarding_failed') {
          console.log(`✗ pipeline   failed: ${JSON.stringify(payload)}`);
          stop.value = true;
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();

  // 5. Run pipeline (blocks until done OR throws)
  try {
    await runOnboardingPipeline(
      company.id,
      user.id,
      journey,
      SAMPLE_INPUTS[journey] || undefined,
      '203.0.113.42', // sample IP for GeoIP enrichment
      'Asia/Kolkata',
      'en-US',
      'Mozilla/5.0 (E2E test)',
    );
  } catch (err) {
    console.error('✗ pipeline threw:', err instanceof Error ? err.message : err);
  }
  stop.value = true;
  await new Promise((r) => setTimeout(r, 1500));

  // 6. Verify final state
  console.log('\n' + '─'.repeat(60));
  console.log('  VERIFICATION');
  console.log('─'.repeat(60));

  const [finalCompany] = await db.select().from(companies).where(eq(companies.id, company.id)).limit(1);
  console.log(`status:        ${finalCompany?.onboarding_status}`);
  console.log(`name:          ${finalCompany?.name}`);
  console.log(`slug:          ${finalCompany?.slug}`);
  console.log(`one_liner:     ${finalCompany?.one_liner?.slice(0, 80) ?? '(empty)'}`);

  const docs = await db.select({
    type: documents.doc_type,
    is_empty: documents.is_empty,
  }).from(documents).where(eq(documents.company_id, company.id));
  console.log(`documents:     ${docs.map(d => `${d.type}${d.is_empty ? '(empty)' : ''}`).sort().join(', ') || '(none)'}`);

  const taskCount = await db.select({ id: tasks.id, title: tasks.title, tag: tasks.tag })
    .from(tasks).where(eq(tasks.company_id, company.id));
  console.log(`starter tasks: ${taskCount.length} — ${taskCount.map(t => `[${t.tag}] ${t.title.slice(0, 40)}`).join(' | ')}`);

  // 7. Check landing page deploy
  if (finalCompany?.slug) {
    const r2Key = `founder-apps/${finalCompany.slug}/index.html`;
    console.log(`landing key:   ${r2Key}`);
    console.log(`landing url:   https://${finalCompany.slug}.baljia.app`);
  }

  console.log('\n' + '━'.repeat(60));
  console.log(`  total events: ${eventCount} | duration: ${Math.round((Date.now() - startedAt) / 1000)}s`);
  console.log(`  stages run: ${stageHistory.length}`);
  console.log(`  test user/company kept (cleanup manually if needed):`);
  console.log(`    user_id=${user.id}`);
  console.log(`    company_id=${company.id}`);
  console.log('━'.repeat(60));

  process.exit(finalCompany?.onboarding_status === 'completed' ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
