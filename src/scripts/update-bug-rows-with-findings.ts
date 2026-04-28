// Update the platform_feedback rows for the two real bugs based on what
// we actually found through verification, NOT just the agent's diagnosis.
// Run: npx tsx --env-file=.env.local src/scripts/update-bug-rows-with-findings.ts

import { db, platformFeedback } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';

async function main() {
  // 1. Critical task-disappearing bug: agent's primary diagnosis (Neon pooling)
  //    didn't reproduce in 50/50 stress runs. We applied Fix 2 (force-dynamic)
  //    on the dashboard page only. Mark as resolved with note.
  const [critical] = await db.select().from(platformFeedback)
    .where(sql`${platformFeedback.title} ILIKE '%not appearing%'`).limit(1);
  if (critical) {
    const updatedDiagnosis = [
      'TRIAGE FINDING (2026-04-28):',
      '',
      'Triage agent diagnosed two compounding root causes:',
      '  1. Neon HTTP driver read-your-writes race (PgBouncer transaction pooling)',
      '  2. Next.js Server Component caching on the dashboard page',
      '',
      'VERIFICATION:',
      '  - Reproducer (20 sequential create+read cycles): 0/20 invisible — bug NOT reproduced',
      '  - Stress reproducer (10 parallel × 5 rounds = 50 pairs): 0/50 invisible — bug NOT reproduced',
      '  - Original task ID 5788e0c8-... is NOT in the DB — likely cleaned up by test, or was never persisted',
      '',
      'CONCLUSION:',
      '  Cause #1 (Neon pooling) does not reproduce at current scale. Adding directDb is not justified.',
      '  Cause #2 (Server Component caching) is a real Next.js best-practice issue. Fixed by adding',
      '  `export const dynamic = "force-dynamic";` to src/app/(dashboard)/dashboard/[companyId]/page.tsx.',
      '',
      'IF this bug recurs in production, escalate — that would be evidence the Neon pooling fix is needed too.',
    ].join('\n');

    await db.update(platformFeedback).set({
      status: 'resolved',
      diagnosis: updatedDiagnosis,
      resolution: 'auto_fixed',  // partial fix shipped (Fix 2 + cosmetic Fix 3)
    }).where(eq(platformFeedback.id, critical.id));
    console.log(`✓ Critical bug ${critical.id.slice(0, 8)}… marked resolved with verification notes.`);
  }

  // 2. Hunter.io bug: env var not set, real bug, awaiting human Gate 1.
  //    Don't auto-resolve — needs human decision (set up Hunter.io account
  //    or remove the find_email/verify_email tools or graceful-degrade).
  const [hunter] = await db.select().from(platformFeedback)
    .where(sql`${platformFeedback.title} ILIKE '%hunter%'`).limit(1);
  if (hunter) {
    console.log(`✓ Hunter.io bug ${hunter.id.slice(0, 8)}… kept in 'awaiting_approval' — needs human decision.`);
  }

  // 3. Show final state of all platform_feedback rows
  const all = await db.select({
    id: platformFeedback.id, title: platformFeedback.title, severity: platformFeedback.severity,
    status: platformFeedback.status, resolution: platformFeedback.resolution,
  }).from(platformFeedback);
  console.log('\n═══ Final platform_feedback state ═══');
  for (const r of all) {
    console.log(`  ${r.severity?.padEnd(8)} ${r.status?.padEnd(20)} ${r.resolution?.padEnd(15) ?? '(no res)'.padEnd(15)} "${r.title?.slice(0, 60)}"`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
