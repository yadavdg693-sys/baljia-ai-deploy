// Smoke test: hit the real Neon DB and verify the two domain-skill handlers
// produce the expected rows. Run with:
//   npx tsx --env-file=.env.local src/scripts/test-domain-skills.ts
//
// Cleans up after itself by deleting the test rows it inserts.

import { db, domainSkills, companies } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { handleBrowserTool } from '@/lib/agents/tools/browser.tools';

async function main() {
  const [company] = await db.select().from(companies).limit(1);
  if (!company) {
    console.error('No company in DB — create one first.');
    process.exit(1);
  }
  console.log('Using company:', company.id);

  const task = { id: 'smoke-task', company_id: company.id } as never;
  const TEST_DOMAIN = '__smoke_test_domain.example';

  // 1. Record
  const r1 = await handleBrowserTool('record_domain_skill', {
    domain: TEST_DOMAIN,
    kind: 'selector',
    key: 'login_button',
    value: '#login',
  }, task);
  console.log('record:', r1);
  if (!r1.includes('Recorded')) throw new Error('record failed');

  // 2. Read back
  const r2 = await handleBrowserTool('read_domain_skills', {
    domain: TEST_DOMAIN,
  }, task);
  console.log('read:', r2);
  if (!r2.includes('login_button')) throw new Error('read failed to surface skill');

  // 3. Filter (should miss because we only stored a selector)
  const r3 = await handleBrowserTool('read_domain_skills', {
    domain: TEST_DOMAIN,
    kind: 'note',
  }, task);
  console.log('filter:', r3);
  if (!r3.includes('No prior skills')) throw new Error('kind filter did not narrow');

  // 4. Idempotent re-record bumps confidence
  const r4 = await handleBrowserTool('record_domain_skill', {
    domain: TEST_DOMAIN,
    kind: 'selector',
    key: 'login_button',
    value: '#login-v2',
  }, task);
  console.log('rerecord:', r4);

  // 5. Verify confidence bumped + value updated
  const r5 = await handleBrowserTool('read_domain_skills', {
    domain: TEST_DOMAIN,
  }, task);
  console.log('after-rerecord:', r5);
  if (!r5.includes('#login-v2')) throw new Error('value did not update');
  if (!r5.includes('confidence 60')) throw new Error('confidence did not bump from 50 to 60');

  // 6. Cleanup
  await db.delete(domainSkills).where(
    and(
      eq(domainSkills.company_id, company.id),
      eq(domainSkills.site_domain, TEST_DOMAIN),
    ),
  );
  console.log('Cleaned up. All 5 steps passed.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
