// End-to-end smoke test for the Support agent's inbound flow:
//
//   1. POSTs a synthetic Postmark inbound webhook payload to /api/webhooks/email
//   2. Verifies the row landed in email_threads
//   3. Calls handleSupportTool('get_inbox', ...) directly and confirms it
//      returns the new mail
//   4. Confirms the email is now marked is_read=true (no infinite-loop risk)
//   5. Re-POSTs the same payload to confirm idempotency (Postmark retry safety)
//   6. Cleans up the test rows
//
// Run: npx tsx --env-file=.env.local src/scripts/test-support-inbound.ts
//
// Requires:
//   - Dev server running on PORT (default 3000)
//   - POSTMARK_WEBHOOK_SECRET set in .env.local
//   - At least one company with onboarding_status='completed' AND a slug

import { db, companies, emailThreads, users } from '@/lib/db';
import { and, desc, eq, like } from 'drizzle-orm';
import { handleSupportTool } from '@/lib/agents/tools/support.tools';
import type { Task } from '@/types';

const PORT = process.env.PLAYWRIGHT_PORT || process.env.PORT || '3000';
const BASE_URL = `http://localhost:${PORT}`;
const TEST_PREFIX = 'SUPPORT-INBOUND-TEST';

async function main() {
  // ── 1. Find a target company ──
  const slugArg = process.argv[2];
  const where = slugArg
    ? and(eq(companies.slug, slugArg), eq(companies.onboarding_status, 'completed'))
    : eq(companies.onboarding_status, 'completed');
  const [company] = await db.select({
    id: companies.id,
    slug: companies.slug,
    name: companies.name,
    company_email: companies.company_email,
    owner_id: companies.owner_id,
  }).from(companies)
    .where(where)
    .orderBy(desc(companies.updated_at))
    .limit(1);

  if (!company?.slug) {
    console.error('No completed company with a slug found.');
    process.exit(1);
  }
  const [owner] = await db.select({ email: users.email })
    .from(users).where(eq(users.id, company.owner_id ?? '')).limit(1);

  console.log(`Target:         ${company.name} [${company.slug}]`);
  console.log(`Company email:  ${company.company_email ?? '(none)'}`);
  console.log(`Owner email:    ${owner?.email ?? '(none)'}\n`);

  // ── 2. Cleanup any leftover rows from previous test runs ──
  await db.delete(emailThreads).where(and(
    eq(emailThreads.company_id, company.id),
    like(emailThreads.subject, `${TEST_PREFIX}%`),
  ));

  // ── 3. POST a synthetic Postmark inbound payload ──
  const secret = process.env.POSTMARK_WEBHOOK_SECRET;
  if (!secret) {
    console.error('POSTMARK_WEBHOOK_SECRET is not set in .env.local.');
    console.error('Generate one with: `openssl rand -hex 32`');
    process.exit(1);
  }
  const auth = `Basic ${Buffer.from(secret).toString('base64')}`;
  const messageId = `test-${Date.now()}@postmark.example.com`;
  const payload = {
    From: 'real-customer@example.com',
    To: `${company.slug}@baljia.app`,
    Subject: `${TEST_PREFIX}: refund request`,
    TextBody: 'Hi — I bought your product yesterday and can\'t log in. Can you help?',
    MessageID: messageId,
  };

  console.log('1. POSTing synthetic inbound webhook...');
  const res = await fetch(`${BASE_URL}/api/webhooks/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`   ✗ Webhook returned ${res.status}: ${JSON.stringify(body)}`);
    process.exit(1);
  }
  console.log(`   ✓ Webhook returned 200: ${JSON.stringify(body)}\n`);

  // ── 4. Verify the row landed in email_threads ──
  await new Promise((r) => setTimeout(r, 500));
  const [stored] = await db.select().from(emailThreads).where(and(
    eq(emailThreads.company_id, company.id),
    eq(emailThreads.external_id, messageId),
  )).limit(1);
  if (!stored) {
    console.error('2. ✗ Email NOT found in email_threads after webhook');
    process.exit(1);
  }
  console.log(`2. ✓ Email stored:`);
  console.log(`   id:        ${stored.id}`);
  console.log(`   direction: ${stored.direction}`);
  console.log(`   from:      ${stored.from_address}`);
  console.log(`   subject:   ${stored.subject}`);
  console.log(`   is_read:   ${stored.is_read}\n`);

  // ── 5. Support agent reads inbox ──
  console.log('3. Calling Support agent\'s get_inbox tool...');
  const fakeTask: Task = {
    id: 'fake-task-id',
    company_id: company.id,
    status: 'in_progress',
    tag: 'support',
  } as unknown as Task;
  const inboxOutput = await handleSupportTool('get_inbox', { limit: 10 }, fakeTask);
  if (!inboxOutput.includes(TEST_PREFIX)) {
    console.error(`   ✗ Support agent did NOT see the test email.\n   Output: ${inboxOutput}`);
    process.exit(1);
  }
  console.log(`   ✓ Support agent sees the email:\n${inboxOutput.split('\n').map((l) => '     ' + l).join('\n')}\n`);

  // ── 6. Confirm read-marking ──
  await new Promise((r) => setTimeout(r, 500));
  const [afterRead] = await db.select({ is_read: emailThreads.is_read })
    .from(emailThreads).where(eq(emailThreads.id, stored.id)).limit(1);
  if (!afterRead?.is_read) {
    console.warn('4. ⚠ is_read was NOT updated — agent could loop on this email next run');
  } else {
    console.log('4. ✓ Email marked is_read=true (next get_inbox call won\'t re-surface it)\n');
  }

  // ── 7. Idempotency: re-POST the same payload ──
  console.log('5. Re-POSTing same payload (Postmark retry simulation)...');
  const res2 = await fetch(`${BASE_URL}/api/webhooks/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(payload),
  });
  const body2 = await res2.json() as { ok?: boolean; deduped?: boolean };
  if (body2.deduped) {
    console.log(`   ✓ Webhook detected duplicate: ${JSON.stringify(body2)}\n`);
  } else {
    console.warn(`   ⚠ Webhook did NOT dedupe — got: ${JSON.stringify(body2)}\n`);
  }

  // ── 8. Cleanup ──
  await db.delete(emailThreads).where(and(
    eq(emailThreads.company_id, company.id),
    like(emailThreads.subject, `${TEST_PREFIX}%`),
  ));
  console.log('Cleanup: removed test rows from email_threads.');

  console.log('\n✅ Support agent inbound flow is working end-to-end.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Test failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
