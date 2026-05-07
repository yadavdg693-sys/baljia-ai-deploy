// Phase 1 frontend craft smoke test (Task 6).
//
// Triggers ONE Engineering task that builds a new frontend page on an existing
// company's deployed Next.js skeleton. After the task completes, fetches the
// deployed page HTML and grep-checks it against the P0 forbidden-pattern list
// from the Frontend Quality Bar so we get an automated first-pass verdict
// (eyeball check still recommended on top).
//
// Run: npx tsx --env-file=.env.local src/scripts/smoke-frontend-craft.ts
//
// Defaults to genesis-advertising-hen6. Override with SMOKE_SLUG=<slug>.
// Defaults to a /pricing page task. Override the prompt via SMOKE_PROMPT.

import { db, companies, tasks, taskExecutions } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import * as taskService from '@/lib/services/task.service';
import { launchTask } from '@/lib/agents/worker-launcher';

const SMOKE_SLUG = process.env.SMOKE_SLUG ?? 'genesis-advertising-hen6';

const DEFAULT_PROMPT_TITLE = 'SMOKE: Add /pricing page to this app';
const DEFAULT_PROMPT_DESCRIPTION =
  'Add a new public route at /pricing in the existing Next.js skeleton. ' +
  'It should display 3 pricing tiers: Starter, Pro, Enterprise. ' +
  'Use the skeleton\'s existing design tokens (shadcn/ui CSS variables in app/globals.css; ' +
  'Tailwind classes like bg-primary, text-accent-foreground; lucide-react for any icons). ' +
  'Use realistic placeholder pricing ($X/mo) and concrete feature bullets — do not invent ' +
  'specific metrics ("10x faster", "99.9% uptime"). Deploy to the existing Render service. ' +
  'Verify the page is live and report the URL.';

const SMOKE_TITLE = process.env.SMOKE_PROMPT_TITLE ?? DEFAULT_PROMPT_TITLE;
const SMOKE_DESCRIPTION = process.env.SMOKE_PROMPT ?? DEFAULT_PROMPT_DESCRIPTION;
const SMOKE_GRADE_PATH = process.env.SMOKE_GRADE_PATH ?? '/pricing';

// P0 forbidden patterns to grep on the deployed HTML.
const TAILWIND_INDIGO_HEXES = [
  '#6366f1', '#4f46e5', '#4338ca', '#3730a3',
  '#8b5cf6', '#7c3aed', '#a855f7',
];
const FORBIDDEN_EMOJI = ['✨', '🚀', '🎯', '⚡', '🔥', '💡'];
const FILLER_COPY_NEEDLES = [
  'lorem ipsum',
  'placeholder text',
  'sample content',
  'feature one',
  'feature two',
  'feature three',
];
const PLACEHOLDER_CDNS = [
  'unsplash.com',
  'placehold.co',
  'placekitten.com',
  'picsum.photos',
];

interface PatternHit {
  category: 'P0' | 'P1';
  pattern: string;
  count: number;
}

function gradeHtml(html: string): { hits: PatternHit[]; soulNotes: string[] } {
  const lower = html.toLowerCase();
  const hits: PatternHit[] = [];

  for (const hex of TAILWIND_INDIGO_HEXES) {
    const rx = new RegExp(hex, 'gi');
    const m = lower.match(rx);
    if (m && m.length > 0) hits.push({ category: 'P0', pattern: `tailwind-indigo ${hex}`, count: m.length });
  }
  for (const e of FORBIDDEN_EMOJI) {
    const m = html.match(new RegExp(e, 'g'));
    if (m && m.length > 0) hits.push({ category: 'P0', pattern: `emoji ${e}`, count: m.length });
  }
  for (const f of FILLER_COPY_NEEDLES) {
    if (lower.includes(f)) {
      const count = (lower.match(new RegExp(f.replace(/ /g, '\\s+'), 'g')) ?? []).length;
      hits.push({ category: 'P0', pattern: `filler "${f}"`, count });
    }
  }
  for (const cdn of PLACEHOLDER_CDNS) {
    if (lower.includes(cdn)) {
      const count = (lower.match(new RegExp(cdn.replace(/\./g, '\\.'), 'g')) ?? []).length;
      hits.push({ category: 'P1', pattern: `placeholder-cdn ${cdn}`, count });
    }
  }

  // Soul detection (very rough): does the page have any custom-named element
  // beyond the standard hero/features/pricing/faq/cta sequence? Look for kbd
  // tags, status badges, real numbers in copy, etc.
  const soulNotes: string[] = [];
  if (/<kbd\b/i.test(html)) soulNotes.push('contains <kbd> tag');
  if (/data-status|status-badge/i.test(html)) soulNotes.push('contains status badge');
  if (/\$\d+/.test(html)) soulNotes.push('contains $ price marker');
  if (/[A-Z]{2,}-\d+/.test(html)) soulNotes.push('contains coded reference (e.g. SKU-123)');
  return { hits, soulNotes };
}

async function pickCompany(slug: string) {
  const [c] = await db.select().from(companies).where(eq(companies.slug, slug)).limit(1);
  if (!c) throw new Error(`No company with slug ${slug}`);
  if (!c.render_service_id && !c.subdomain) {
    throw new Error(`Company ${slug} has no Render service or subdomain — needs infra`);
  }
  return c;
}

async function pollUntilFinished(taskId: string, timeoutMs: number): Promise<string> {
  const started = Date.now();
  let lastStatus = '';
  while (Date.now() - started < timeoutMs) {
    const [t] = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    const status = t?.status ?? 'unknown';
    if (status !== lastStatus) {
      const elapsed = Math.round((Date.now() - started) / 1000);
      console.log(`  [${elapsed}s] status: ${status}`);
      lastStatus = status;
    }
    if (['completed', 'failed', 'failed_permanent', 'rejected'].includes(status)) return status;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return 'timeout';
}

async function getDeployedUrl(companyId: string): Promise<string | null> {
  const [c] = await db.select({
    custom_domain: companies.custom_domain,
    subdomain: companies.subdomain,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (c?.custom_domain) return `https://${c.custom_domain}`;
  if (c?.subdomain) return `https://${c.subdomain}.baljia.app`;
  return null;
}

async function fetchPage(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'user-agent': 'baljia-smoke-test/1.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
  return await r.text();
}

async function main() {
  console.log('\n══ Frontend Craft Phase 1 smoke test ══\n');

  const company = await pickCompany(SMOKE_SLUG);
  console.log(`Target: ${company.name} [${company.slug}] ${company.id}`);
  console.log(`Subdomain: ${company.subdomain ?? 'none'}`);
  console.log(`Custom domain: ${company.custom_domain ?? 'none'}`);
  console.log(`Render service: ${company.render_service_id ?? 'none'}`);
  console.log(`GitHub repo: ${company.github_repo ?? 'none'}`);

  console.log('\n── Creating smoke task ──');
  const task = await taskService.createTask({
    company_id: company.id,
    title: SMOKE_TITLE,
    description: SMOKE_DESCRIPTION,
    tag: 'engineering',
    source: 'founder_requested',
    authorized_by: 'founder',
    authorization_reason: 'Phase 1 frontend craft smoke test',
  });
  console.log(`  ✓ Task created: ${task.id}`);
  console.log(`  Title: ${task.title}`);

  console.log('\n── Launching (subscriptionFunded:true to bypass spend cap) ──');
  const launchStart = Date.now();
  try {
    const exec = await launchTask(task.id, { subscriptionFunded: true });
    const elapsed = ((Date.now() - launchStart) / 1000).toFixed(1);
    console.log(`✓ Launch returned (${elapsed}s) — execution ${exec.id} status=${exec.status} turns=${exec.turn_count}`);
  } catch (err: unknown) {
    const elapsed = ((Date.now() - launchStart) / 1000).toFixed(1);
    console.error(`✗ launchTask threw after ${elapsed}s:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Poll briefly in case verification still running
  const finalStatus = await pollUntilFinished(task.id, 60_000);
  console.log(`\nFinal task status: ${finalStatus}`);

  // Pull execution log summary
  const [exec] = await db.select({
    turn_count: taskExecutions.turn_count,
    execution_log: taskExecutions.execution_log,
  }).from(taskExecutions).where(eq(taskExecutions.task_id, task.id)).orderBy(desc(taskExecutions.started_at)).limit(1);
  console.log(`Turns: ${exec?.turn_count ?? '—'}`);
  const events = (exec?.execution_log ?? []) as Array<Record<string, unknown>>;
  console.log(`Events: ${events.length}`);

  // Fetch the deployed page and grade it
  const baseUrl = await getDeployedUrl(company.id);
  if (!baseUrl) {
    console.log('\n⚠ No deployed URL on file — cannot grade page automatically.');
    console.log('Eyeball-check the founder app manually if a URL was produced in the task report.');
    process.exit(0);
  }
  const targetUrl = `${baseUrl}${SMOKE_GRADE_PATH}`;
  console.log(`\n── Fetching and grading: ${targetUrl} ──`);
  let html: string;
  try {
    html = await fetchPage(targetUrl);
    console.log(`✓ HTTP 200 — ${html.length} bytes`);
  } catch (err) {
    console.error(`✗ Failed to fetch page:`, err instanceof Error ? err.message : err);
    console.log('Page may still be deploying. Try `curl ' + targetUrl + '` again in 1–2 minutes.');
    process.exit(0);
  }

  const { hits, soulNotes } = gradeHtml(html);
  const p0Hits = hits.filter((h) => h.category === 'P0');
  const p1Hits = hits.filter((h) => h.category === 'P1');

  console.log('\n══ GRADE ══');
  if (p0Hits.length === 0) {
    console.log('✓ P0 cardinal sins: 0 hits — clean');
  } else {
    console.log(`✗ P0 cardinal sins: ${p0Hits.length} hits`);
    for (const h of p0Hits) console.log(`    ${h.pattern} × ${h.count}`);
  }
  if (p1Hits.length === 0) {
    console.log('✓ P1 soft tells: 0 hits');
  } else {
    console.log(`! P1 soft tells: ${p1Hits.length} hits`);
    for (const h of p1Hits) console.log(`    ${h.pattern} × ${h.count}`);
  }
  if (soulNotes.length > 0) {
    console.log(`+ Soul markers: ${soulNotes.join(', ')}`);
  } else {
    console.log('· Soul markers: none detected (eyeball-check still recommended)');
  }

  console.log('\nP0 score: ' + (7 - new Set(p0Hits.map((h) => h.pattern.split(' ')[0])).size) + ' / 7 categories clean');
  console.log('Verdict: ' + (p0Hits.length === 0 ? 'PASS (P0 clean)' : 'PARTIAL (P0 hits — investigate)'));
  console.log(`\nDeployed URL for eyeball check: ${targetUrl}`);
  console.log(`Task id for log inspection: ${task.id}\n`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Smoke runner crashed:', e);
  process.exit(1);
});
