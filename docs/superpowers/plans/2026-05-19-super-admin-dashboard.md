# Super Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private Baljia super-admin dashboard where the owner can log in through a secret URL and view all company, usage, billing, task, and system-health information.

**Architecture:** Use a server-rendered Next.js admin surface at `/owner/[accessKey]` where `accessKey` must match `SUPER_ADMIN_DASHBOARD_SLUG`. Do not link this URL from public navigation. Every page and API read must also require an authenticated user whose email is in `ADMIN_EMAILS`, so the hidden URL is only an extra privacy layer, not the security model.

**Tech Stack:** Next.js 15 App Router, React 19 server components, Drizzle ORM, Neon Postgres, existing custom JWT auth, Vitest, Tailwind/global CSS.

---

## Product Scope

Phase 1 ships the owner view needed now:

- Overview: total companies, active companies, trial/paid/free counts, users, tasks, failed tasks, running tasks, credit usage, revenue totals, onboarding pipeline health.
- Companies table: search, lifecycle/status filters, owner email, plan, billing state, hosting state, task counts, credit balance, latest activity.
- Company detail: company profile, owner, links, infra identifiers, subscription, credits, tasks, reports, documents summary, recent platform events, emails summary, ads summary.
- Audit trail: record every super-admin page/detail/API view.
- Security: secret URL slug, `ADMIN_EMAILS` check, `noindex`, middleware session gate, no secrets displayed by default.

Phase 2 can add write actions:

- Retry failed task.
- Pause/resume company execution.
- Credit adjustment.
- Refund/support workflows.
- Impersonation or support-login, only after explicit confirmation and stronger audit logging.

## Route Decision

Use this route:

```text
/owner/[accessKey]
```

Example final URL:

```text
https://baljia.ai/owner/<SUPER_ADMIN_DASHBOARD_SLUG>
```

Environment variables:

```bash
ADMIN_EMAILS=your-email@example.com
SUPER_ADMIN_DASHBOARD_SLUG=a-long-random-private-string
```

Important security rule:

```text
Knowing the URL is never enough. The user must also be logged in as an email listed in ADMIN_EMAILS.
```

## File Structure

- Modify `src/middleware.ts`: require a valid session for `/owner/*`, prevent anonymous access before the page renders.
- Create `src/lib/super-admin.ts`: shared access-key and admin-email helpers for pages and APIs.
- Modify `src/lib/api-utils.ts`: reuse `isSuperAdminEmail` for `requireAdmin`.
- Modify `src/lib/db/schema.ts`: add `superAdminAuditEvents`.
- Create migration with `npm run db:generate`: creates `drizzle/<next>_super_admin_audit_events.sql`.
- Create `src/lib/services/super-admin.service.ts`: all dashboard aggregate queries and audit writes.
- Create `src/lib/super-admin.test.ts`: unit tests for access-key and email matching.
- Create `src/app/(superadmin)/owner/[accessKey]/layout.tsx`: guarded private shell.
- Create `src/app/(superadmin)/owner/[accessKey]/page.tsx`: overview dashboard.
- Create `src/app/(superadmin)/owner/[accessKey]/companies/page.tsx`: searchable company list.
- Create `src/app/(superadmin)/owner/[accessKey]/companies/[companyId]/page.tsx`: company detail page.
- Create `src/components/super-admin/SuperAdminShell.tsx`: restrained admin layout.
- Create `src/components/super-admin/MetricCard.tsx`: metric display.
- Create `src/components/super-admin/CompanyTable.tsx`: company table.
- Create `src/components/super-admin/StatusBadge.tsx`: lifecycle/status badges.

---

### Task 1: Super-Admin Access Helpers

**Files:**
- Create: `src/lib/super-admin.ts`
- Test: `src/lib/super-admin.test.ts`
- Modify: `src/lib/api-utils.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/super-admin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  isSuperAdminEmail,
  isValidSuperAdminAccessKey,
  normalizeAdminEmails,
} from './super-admin';

describe('super admin helpers', () => {
  it('normalizes comma-separated admin emails', () => {
    expect(normalizeAdminEmails(' Owner@Baljia.ai, ops@baljia.ai ,, ')).toEqual([
      'owner@baljia.ai',
      'ops@baljia.ai',
    ]);
  });

  it('matches admin emails case-insensitively', () => {
    expect(isSuperAdminEmail('OWNER@BALJIA.AI', 'owner@baljia.ai')).toBe(true);
    expect(isSuperAdminEmail('user@example.com', 'owner@baljia.ai')).toBe(false);
  });

  it('requires an exact private access-key match', () => {
    expect(isValidSuperAdminAccessKey('secret-owner-key', 'secret-owner-key')).toBe(true);
    expect(isValidSuperAdminAccessKey('SECRET-OWNER-KEY', 'secret-owner-key')).toBe(false);
    expect(isValidSuperAdminAccessKey('', 'secret-owner-key')).toBe(false);
    expect(isValidSuperAdminAccessKey('secret-owner-key', '')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- src/lib/super-admin.test.ts
```

Expected: FAIL because `src/lib/super-admin.ts` does not exist.

- [ ] **Step 3: Implement helper functions**

Create `src/lib/super-admin.ts`:

```ts
import { notFound, redirect } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';

export type SuperAdminUser = {
  id: string;
  email: string;
  name: string | null;
};

export function normalizeAdminEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdminEmail(email: string | null | undefined, rawAdminEmails = process.env.ADMIN_EMAILS): boolean {
  const adminEmails = normalizeAdminEmails(rawAdminEmails);
  const normalizedEmail = (email ?? '').trim().toLowerCase();
  return adminEmails.length > 0 && adminEmails.includes(normalizedEmail);
}

export function isValidSuperAdminAccessKey(accessKey: string | null | undefined, expected = process.env.SUPER_ADMIN_DASHBOARD_SLUG): boolean {
  return Boolean(accessKey && expected && accessKey === expected);
}

export function getSuperAdminBasePath(accessKey = process.env.SUPER_ADMIN_DASHBOARD_SLUG): string {
  if (!accessKey) return '/owner/not-configured';
  return `/owner/${encodeURIComponent(accessKey)}`;
}

export async function requireSuperAdminPage(accessKey: string): Promise<SuperAdminUser> {
  if (!isValidSuperAdminAccessKey(accessKey)) {
    notFound();
  }

  const user = await getSessionFromCookies();
  const next = getSuperAdminBasePath(accessKey);

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!isSuperAdminEmail(user.email)) {
    notFound();
  }

  return user;
}
```

- [ ] **Step 4: Reuse the helper in API admin auth**

Modify `src/lib/api-utils.ts`:

```ts
import { isSuperAdminEmail } from '@/lib/super-admin';
```

Replace the body of the email check in `requireAdmin()` with:

```ts
  if (!process.env.ADMIN_EMAILS?.trim()) {
    return NextResponse.json({ error: 'Forbidden: admin access not configured' }, { status: 403 });
  }

  if (!isSuperAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- src/lib/super-admin.test.ts
```

Expected: PASS.

---

### Task 2: Middleware Session Gate For Owner URL

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Add `/owner` as a protected page family**

In `src/middleware.ts`, replace:

```ts
  const isProtectedPage = pathname.startsWith('/dashboard');
```

with:

```ts
  const isProtectedPage =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/owner');
```

- [ ] **Step 2: Preserve login redirect**

Keep the existing redirect block:

```ts
  if (isProtectedPage) {
    const session = await getSessionFromRequest(request);
    if (!session) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }
```

Page-level `requireSuperAdminPage()` will still perform the access-key and `ADMIN_EMAILS` checks.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

---

### Task 3: Super-Admin Audit Table

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: generated Drizzle migration in `drizzle/`

- [ ] **Step 1: Add schema**

Append this near the platform/admin tables in `src/lib/db/schema.ts`:

```ts
export const superAdminAuditEvents = pgTable('super_admin_audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  admin_user_id: uuid('admin_user_id').references(() => users.id),
  admin_email: varchar('admin_email', { length: 255 }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  target_type: varchar('target_type', { length: 80 }),
  target_id: text('target_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_super_admin_audit_admin').on(t.admin_user_id),
  index('idx_super_admin_audit_action').on(t.action),
  index('idx_super_admin_audit_target').on(t.target_type, t.target_id),
  index('idx_super_admin_audit_created').on(t.created_at),
]);
```

- [ ] **Step 2: Generate migration**

Run:

```bash
npm run db:generate
```

Expected: a new migration file appears in `drizzle/` with `CREATE TABLE "super_admin_audit_events"`.

- [ ] **Step 3: Inspect migration**

Run:

```bash
rg -n "super_admin_audit_events|idx_super_admin_audit" drizzle
```

Expected: migration contains the table and four indexes.

---

### Task 4: Dashboard Query Service

**Files:**
- Create: `src/lib/services/super-admin.service.ts`

- [ ] **Step 1: Create service types and audit writer**

Create `src/lib/services/super-admin.service.ts`:

```ts
import {
  adCampaigns,
  chatSessions,
  companies,
  creditLedger,
  db,
  documents,
  emailThreads,
  platformEvents,
  reports,
  revenueLedger,
  runs,
  subscriptions,
  superAdminAuditEvents,
  tasks,
  users,
} from '@/lib/db';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';

export type SuperAdminActor = {
  id: string;
  email: string;
  name: string | null;
};

export async function recordSuperAdminAudit(
  actor: SuperAdminActor,
  action: string,
  target?: { type: string; id: string },
  metadata?: Record<string, unknown>,
) {
  await db.insert(superAdminAuditEvents).values({
    admin_user_id: actor.id,
    admin_email: actor.email,
    action,
    target_type: target?.type,
    target_id: target?.id,
    metadata,
  });
}
```

- [ ] **Step 2: Add overview query**

Add to the same file:

```ts
export async function getSuperAdminOverview(actor: SuperAdminActor) {
  await recordSuperAdminAudit(actor, 'view_overview');

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [companyStats] = await db
    .select({
      totalCompanies: sql<number>`COUNT(*)::int`,
      activeCompanies: sql<number>`COUNT(*) FILTER (WHERE ${companies.deleted_at} IS NULL AND ${companies.execution_state} = 'active')::int`,
      paidCompanies: sql<number>`COUNT(*) FILTER (WHERE ${companies.billing_state} IN ('active', 'paid'))::int`,
      onboardingCompanies: sql<number>`COUNT(*) FILTER (WHERE ${companies.onboarding_status} NOT IN ('complete', 'completed'))::int`,
    })
    .from(companies);

  const [userStats] = await db
    .select({
      totalUsers: sql<number>`COUNT(*)::int`,
      users7d: sql<number>`COUNT(*) FILTER (WHERE ${users.created_at} >= ${since7d})::int`,
    })
    .from(users);

  const [taskStats] = await db
    .select({
      totalTasks: sql<number>`COUNT(*)::int`,
      runningTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} IN ('running', 'in_progress'))::int`,
      failedTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} IN ('failed', 'error'))::int`,
      completedTasks7d: sql<number>`COUNT(*) FILTER (WHERE ${tasks.completed_at} >= ${since7d})::int`,
    })
    .from(tasks);

  const [creditStats] = await db
    .select({
      creditsUsed7d: sql<number>`COALESCE(SUM(ABS(${creditLedger.amount})) FILTER (WHERE ${creditLedger.amount} < 0 AND ${creditLedger.created_at} >= ${since7d}), 0)::int`,
      creditEvents24h: sql<number>`COUNT(*) FILTER (WHERE ${creditLedger.created_at} >= ${since24h})::int`,
    })
    .from(creditLedger);

  const [subscriptionStats] = await db
    .select({
      activeSubscriptions: sql<number>`COUNT(*) FILTER (WHERE ${subscriptions.status} = 'active')::int`,
      trialSubscriptions: sql<number>`COUNT(*) FILTER (WHERE ${subscriptions.status} = 'trialing')::int`,
    })
    .from(subscriptions);

  const [revenueStats] = await db
    .select({
      totalRevenue: sql<string>`COALESCE(SUM(${revenueLedger.net_amount}), 0)::text`,
      revenue7d: sql<string>`COALESCE(SUM(${revenueLedger.net_amount}) FILTER (WHERE ${revenueLedger.created_at} >= ${since7d}), 0)::text`,
    })
    .from(revenueLedger);

  const recentCompanies = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      lifecycle: companies.lifecycle,
      plan_tier: companies.plan_tier,
      billing_state: companies.billing_state,
      onboarding_status: companies.onboarding_status,
      created_at: companies.created_at,
      owner_email: users.email,
    })
    .from(companies)
    .leftJoin(users, eq(companies.owner_id, users.id))
    .orderBy(desc(companies.created_at))
    .limit(8);

  return {
    companyStats,
    userStats,
    taskStats,
    creditStats,
    subscriptionStats,
    revenueStats,
    recentCompanies,
  };
}
```

- [ ] **Step 3: Add company list query**

Add:

```ts
export async function getSuperAdminCompanies(actor: SuperAdminActor, input: {
  q?: string;
  lifecycle?: string;
  limit?: number;
}) {
  await recordSuperAdminAudit(actor, 'view_company_list', undefined, input);

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const filters: SQL[] = [];

  if (input.q?.trim()) {
    const q = `%${input.q.trim()}%`;
    const searchFilter = or(
      ilike(companies.name, q),
      ilike(companies.slug, q),
      ilike(users.email, q),
    );
    if (searchFilter) filters.push(searchFilter);
  }

  if (input.lifecycle?.trim()) {
    filters.push(eq(companies.lifecycle, input.lifecycle.trim()));
  }

  const where = filters.length === 0
    ? undefined
    : filters.length === 1
      ? filters[0]
      : and(...filters);

  return db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      one_liner: companies.one_liner,
      owner_email: users.email,
      lifecycle: companies.lifecycle,
      execution_state: companies.execution_state,
      billing_state: companies.billing_state,
      hosting_state: companies.hosting_state,
      onboarding_status: companies.onboarding_status,
      plan_tier: companies.plan_tier,
      created_at: companies.created_at,
      updated_at: companies.updated_at,
      task_count: sql<number>`(SELECT COUNT(*)::int FROM tasks t WHERE t.company_id = ${companies.id})`,
      credit_balance: sql<number>`(SELECT COALESCE(SUM(cl.amount), 0)::int FROM credit_ledger cl WHERE cl.company_id = ${companies.id})`,
      last_event_at: sql<Date | null>`(SELECT MAX(pe.created_at) FROM platform_events pe WHERE pe.company_id = ${companies.id})`,
    })
    .from(companies)
    .leftJoin(users, eq(companies.owner_id, users.id))
    .where(where)
    .orderBy(desc(companies.created_at))
    .limit(limit);
}
```

- [ ] **Step 4: Add company detail query**

Add:

```ts
export async function getSuperAdminCompanyDetail(actor: SuperAdminActor, companyId: string) {
  await recordSuperAdminAudit(actor, 'view_company_detail', { type: 'company', id: companyId });

  const [company] = await db
    .select({
      id: companies.id,
      owner_id: companies.owner_id,
      owner_email: users.email,
      owner_name: users.name,
      name: companies.name,
      slug: companies.slug,
      one_liner: companies.one_liner,
      original_idea: companies.original_idea,
      claim_status: companies.claim_status,
      onboarding_status: companies.onboarding_status,
      plan_tier: companies.plan_tier,
      lifecycle: companies.lifecycle,
      execution_state: companies.execution_state,
      billing_state: companies.billing_state,
      hosting_state: companies.hosting_state,
      subdomain: companies.subdomain,
      email_identity: companies.email_identity,
      company_email: companies.company_email,
      github_repo: companies.github_repo,
      render_service_id: companies.render_service_id,
      neon_database_id: companies.neon_database_id,
      custom_domain: companies.custom_domain,
      timezone: companies.timezone,
      created_at: companies.created_at,
      updated_at: companies.updated_at,
      deleted_at: companies.deleted_at,
    })
    .from(companies)
    .leftJoin(users, eq(companies.owner_id, users.id))
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) return null;

  const [counts, creditBalance, subscription, recentTasks, recentEvents, recentReports] = await Promise.all([
    db.select({
      tasks: sql<number>`COUNT(DISTINCT ${tasks.id})::int`,
      documents: sql<number>`COUNT(DISTINCT ${documents.id})::int`,
      reports: sql<number>`COUNT(DISTINCT ${reports.id})::int`,
      emails: sql<number>`COUNT(DISTINCT ${emailThreads.id})::int`,
      chats: sql<number>`COUNT(DISTINCT ${chatSessions.id})::int`,
      ads: sql<number>`COUNT(DISTINCT ${adCampaigns.id})::int`,
      runs: sql<number>`COUNT(DISTINCT ${runs.id})::int`,
    }).from(companies)
      .leftJoin(tasks, eq(tasks.company_id, companies.id))
      .leftJoin(documents, eq(documents.company_id, companies.id))
      .leftJoin(reports, eq(reports.company_id, companies.id))
      .leftJoin(emailThreads, eq(emailThreads.company_id, companies.id))
      .leftJoin(chatSessions, eq(chatSessions.company_id, companies.id))
      .leftJoin(adCampaigns, eq(adCampaigns.company_id, companies.id))
      .leftJoin(runs, eq(runs.task_id, tasks.id))
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0]),

    db.select({ balance: sql<number>`COALESCE(SUM(${creditLedger.amount}), 0)::int` })
      .from(creditLedger)
      .where(eq(creditLedger.company_id, companyId))
      .then((rows) => rows[0]),

    db.select()
      .from(subscriptions)
      .where(eq(subscriptions.company_id, companyId))
      .orderBy(desc(subscriptions.created_at))
      .limit(1)
      .then((rows) => rows[0] ?? null),

    db.select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      tag: tasks.tag,
      failure_class: tasks.failure_class,
      created_at: tasks.created_at,
      completed_at: tasks.completed_at,
    }).from(tasks)
      .where(eq(tasks.company_id, companyId))
      .orderBy(desc(tasks.created_at))
      .limit(15),

    db.select({
      id: platformEvents.id,
      event_type: platformEvents.event_type,
      payload: platformEvents.payload,
      created_at: platformEvents.created_at,
    }).from(platformEvents)
      .where(eq(platformEvents.company_id, companyId))
      .orderBy(desc(platformEvents.created_at))
      .limit(20),

    db.select({
      id: reports.id,
      title: reports.title,
      report_type: reports.report_type,
      created_at: reports.created_at,
    }).from(reports)
      .where(eq(reports.company_id, companyId))
      .orderBy(desc(reports.created_at))
      .limit(10),
  ]);

  return {
    company,
    counts,
    creditBalance,
    subscription,
    recentTasks,
    recentEvents,
    recentReports,
  };
}
```

- [ ] **Step 5: Type check**

Run:

```bash
npm run build
```

Expected: build reaches compilation without TypeScript errors from the new service.

---

### Task 5: Private Super-Admin Layout

**Files:**
- Create: `src/app/(superadmin)/owner/[accessKey]/layout.tsx`
- Create: `src/components/super-admin/SuperAdminShell.tsx`

- [ ] **Step 1: Create the shell component**

Create `src/components/super-admin/SuperAdminShell.tsx`:

```tsx
import Link from 'next/link';

type Props = {
  basePath: string;
  userEmail: string;
  children: React.ReactNode;
};

export function SuperAdminShell({ basePath, userEmail, children }: Props) {
  return (
    <main className="min-h-screen bg-[#f7f7f4] text-[#171717]">
      <header className="border-b border-[#dedbd2] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#6b6b60]">Baljia Owner</p>
            <h1 className="text-xl font-semibold">Super Admin Dashboard</h1>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link href={basePath} className="text-[#333] hover:text-black">Overview</Link>
            <Link href={`${basePath}/companies`} className="text-[#333] hover:text-black">Companies</Link>
            <span className="rounded border border-[#dedbd2] px-3 py-1 text-xs text-[#555]">{userEmail}</span>
          </nav>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-6 py-6">
        {children}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Create guarded layout**

Create `src/app/(superadmin)/owner/[accessKey]/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { requireSuperAdminPage, getSuperAdminBasePath } from '@/lib/super-admin';
import { SuperAdminShell } from '@/components/super-admin/SuperAdminShell';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Baljia Owner Dashboard',
  robots: {
    index: false,
    follow: false,
  },
};

type Props = {
  children: React.ReactNode;
  params: Promise<{ accessKey: string }>;
};

export default async function SuperAdminLayout({ children, params }: Props) {
  const { accessKey } = await params;
  const user = await requireSuperAdminPage(accessKey);

  return (
    <SuperAdminShell basePath={getSuperAdminBasePath(accessKey)} userEmail={user.email}>
      {children}
    </SuperAdminShell>
  );
}
```

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: PASS.

---

### Task 6: Overview Page

**Files:**
- Create: `src/app/(superadmin)/owner/[accessKey]/page.tsx`
- Create: `src/components/super-admin/MetricCard.tsx`
- Create: `src/components/super-admin/StatusBadge.tsx`

- [ ] **Step 1: Create reusable metric card**

Create `src/components/super-admin/MetricCard.tsx`:

```tsx
type Props = {
  label: string;
  value: string | number;
  hint?: string;
};

export function MetricCard({ label, value, hint }: Props) {
  return (
    <div className="rounded-md border border-[#dedbd2] bg-white p-4">
      <p className="text-sm text-[#6b6b60]">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[#777]">{hint}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Create badge component**

Create `src/components/super-admin/StatusBadge.tsx`:

```tsx
const COLORS: Record<string, string> = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  trial_active: 'border-blue-200 bg-blue-50 text-blue-800',
  free: 'border-stone-200 bg-stone-50 text-stone-700',
  failed: 'border-red-200 bg-red-50 text-red-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  complete: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

export function StatusBadge({ value }: { value: string | null | undefined }) {
  const label = value ?? 'unknown';
  const color = COLORS[label] ?? 'border-[#dedbd2] bg-white text-[#555]';
  return (
    <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}
```

- [ ] **Step 3: Create overview page**

Create `src/app/(superadmin)/owner/[accessKey]/page.tsx`:

```tsx
import Link from 'next/link';
import { requireSuperAdminPage, getSuperAdminBasePath } from '@/lib/super-admin';
import { getSuperAdminOverview } from '@/lib/services/super-admin.service';
import { MetricCard } from '@/components/super-admin/MetricCard';
import { StatusBadge } from '@/components/super-admin/StatusBadge';

type Props = {
  params: Promise<{ accessKey: string }>;
};

export default async function SuperAdminOverviewPage({ params }: Props) {
  const { accessKey } = await params;
  const user = await requireSuperAdminPage(accessKey);
  const data = await getSuperAdminOverview(user);
  const basePath = getSuperAdminBasePath(accessKey);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Platform Overview</h2>
        <p className="text-sm text-[#666]">Private operating view across Baljia companies.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Total companies" value={data.companyStats?.totalCompanies ?? 0} />
        <MetricCard label="Active companies" value={data.companyStats?.activeCompanies ?? 0} />
        <MetricCard label="Paid companies" value={data.companyStats?.paidCompanies ?? 0} />
        <MetricCard label="Onboarding" value={data.companyStats?.onboardingCompanies ?? 0} />
        <MetricCard label="Total users" value={data.userStats?.totalUsers ?? 0} hint={`${data.userStats?.users7d ?? 0} in last 7 days`} />
        <MetricCard label="Running tasks" value={data.taskStats?.runningTasks ?? 0} />
        <MetricCard label="Failed tasks" value={data.taskStats?.failedTasks ?? 0} />
        <MetricCard label="Credits used 7d" value={data.creditStats?.creditsUsed7d ?? 0} />
        <MetricCard label="Active subscriptions" value={data.subscriptionStats?.activeSubscriptions ?? 0} />
        <MetricCard label="Revenue 7d" value={data.revenueStats?.revenue7d ?? '0'} />
      </div>

      <section className="rounded-md border border-[#dedbd2] bg-white">
        <div className="flex items-center justify-between border-b border-[#dedbd2] px-4 py-3">
          <h3 className="font-medium">Recent Companies</h3>
          <Link href={`${basePath}/companies`} className="text-sm text-[#2454a6]">View all</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
              <tr>
                <th className="px-4 py-2">Company</th>
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2">Plan</th>
                <th className="px-4 py-2">Lifecycle</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.recentCompanies.map((company) => (
                <tr key={company.id} className="border-t border-[#eee]">
                  <td className="px-4 py-3">
                    <Link href={`${basePath}/companies/${company.id}`} className="font-medium text-[#2454a6]">{company.name}</Link>
                    <div className="text-xs text-[#777]">{company.slug}</div>
                  </td>
                  <td className="px-4 py-3">{company.owner_email ?? 'unclaimed'}</td>
                  <td className="px-4 py-3">{company.plan_tier ?? 'free'}</td>
                  <td className="px-4 py-3"><StatusBadge value={company.lifecycle} /></td>
                  <td className="px-4 py-3">{company.created_at ? new Date(company.created_at).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: PASS.

---

### Task 7: Company List Page

**Files:**
- Create: `src/app/(superadmin)/owner/[accessKey]/companies/page.tsx`
- Create: `src/components/super-admin/CompanyTable.tsx`

- [ ] **Step 1: Create company table**

Create `src/components/super-admin/CompanyTable.tsx`:

```tsx
import Link from 'next/link';
import { StatusBadge } from './StatusBadge';

type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  owner_email: string | null;
  lifecycle: string | null;
  execution_state: string | null;
  billing_state: string | null;
  hosting_state: string | null;
  onboarding_status: string | null;
  plan_tier: string | null;
  task_count: number;
  credit_balance: number;
  last_event_at: Date | null;
};

export function CompanyTable({ rows, basePath }: { rows: CompanyRow[]; basePath: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-[#dedbd2] bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-[#fafaf8] text-xs uppercase text-[#666]">
          <tr>
            <th className="px-4 py-2">Company</th>
            <th className="px-4 py-2">Owner</th>
            <th className="px-4 py-2">Plan</th>
            <th className="px-4 py-2">Lifecycle</th>
            <th className="px-4 py-2">Billing</th>
            <th className="px-4 py-2">Tasks</th>
            <th className="px-4 py-2">Credits</th>
            <th className="px-4 py-2">Last event</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-[#eee]">
              <td className="px-4 py-3">
                <Link href={`${basePath}/companies/${row.id}`} className="font-medium text-[#2454a6]">{row.name}</Link>
                <div className="text-xs text-[#777]">{row.slug}</div>
              </td>
              <td className="px-4 py-3">{row.owner_email ?? 'unclaimed'}</td>
              <td className="px-4 py-3">{row.plan_tier ?? 'free'}</td>
              <td className="px-4 py-3"><StatusBadge value={row.lifecycle} /></td>
              <td className="px-4 py-3"><StatusBadge value={row.billing_state} /></td>
              <td className="px-4 py-3 tabular-nums">{row.task_count}</td>
              <td className="px-4 py-3 tabular-nums">{row.credit_balance}</td>
              <td className="px-4 py-3">{row.last_event_at ? new Date(row.last_event_at).toLocaleString() : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Create company list page**

Create `src/app/(superadmin)/owner/[accessKey]/companies/page.tsx`:

```tsx
import { requireSuperAdminPage, getSuperAdminBasePath } from '@/lib/super-admin';
import { getSuperAdminCompanies } from '@/lib/services/super-admin.service';
import { CompanyTable } from '@/components/super-admin/CompanyTable';

type Props = {
  params: Promise<{ accessKey: string }>;
  searchParams: Promise<{ q?: string; lifecycle?: string }>;
};

export default async function SuperAdminCompaniesPage({ params, searchParams }: Props) {
  const { accessKey } = await params;
  const filters = await searchParams;
  const user = await requireSuperAdminPage(accessKey);
  const basePath = getSuperAdminBasePath(accessKey);
  const rows = await getSuperAdminCompanies(user, {
    q: filters.q,
    lifecycle: filters.lifecycle,
    limit: 100,
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Companies</h2>
        <p className="text-sm text-[#666]">Search and inspect every Baljia company.</p>
      </div>

      <form className="flex flex-wrap gap-3 rounded-md border border-[#dedbd2] bg-white p-4">
        <input
          name="q"
          defaultValue={filters.q ?? ''}
          placeholder="Search company, slug, owner email"
          className="min-w-72 rounded border border-[#ccc] px-3 py-2 text-sm"
        />
        <select
          name="lifecycle"
          defaultValue={filters.lifecycle ?? ''}
          className="rounded border border-[#ccc] px-3 py-2 text-sm"
        >
          <option value="">All lifecycles</option>
          <option value="trial_active">Trial active</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button className="rounded bg-[#171717] px-4 py-2 text-sm font-medium text-white" type="submit">
          Filter
        </button>
      </form>

      <CompanyTable rows={rows} basePath={basePath} />
    </div>
  );
}
```

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: PASS.

---

### Task 8: Company Detail Page

**Files:**
- Create: `src/app/(superadmin)/owner/[accessKey]/companies/[companyId]/page.tsx`

- [ ] **Step 1: Create detail page**

Create `src/app/(superadmin)/owner/[accessKey]/companies/[companyId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { requireSuperAdminPage } from '@/lib/super-admin';
import { getSuperAdminCompanyDetail } from '@/lib/services/super-admin.service';
import { MetricCard } from '@/components/super-admin/MetricCard';
import { StatusBadge } from '@/components/super-admin/StatusBadge';

type Props = {
  params: Promise<{ accessKey: string; companyId: string }>;
};

export default async function SuperAdminCompanyDetailPage({ params }: Props) {
  const { accessKey, companyId } = await params;
  const user = await requireSuperAdminPage(accessKey);
  const data = await getSuperAdminCompanyDetail(user, companyId);

  if (!data) notFound();

  const { company, counts, creditBalance, subscription, recentTasks, recentEvents, recentReports } = data;

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-[#dedbd2] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{company.name}</h2>
            <p className="text-sm text-[#666]">{company.one_liner ?? company.original_idea ?? 'No description recorded.'}</p>
            <p className="mt-2 text-xs text-[#777]">{company.id}</p>
          </div>
          <div className="flex gap-2">
            <StatusBadge value={company.lifecycle} />
            <StatusBadge value={company.billing_state} />
            <StatusBadge value={company.hosting_state} />
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Credit balance" value={creditBalance?.balance ?? 0} />
        <MetricCard label="Tasks" value={counts?.tasks ?? 0} />
        <MetricCard label="Documents" value={counts?.documents ?? 0} />
        <MetricCard label="Reports" value={counts?.reports ?? 0} />
        <MetricCard label="Emails" value={counts?.emails ?? 0} />
        <MetricCard label="Chats" value={counts?.chats ?? 0} />
        <MetricCard label="Ads" value={counts?.ads ?? 0} />
        <MetricCard label="Runs" value={counts?.runs ?? 0} />
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-[#dedbd2] bg-white p-4">
          <h3 className="font-medium">Company Profile</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <dt className="text-[#777]">Owner</dt><dd>{company.owner_email ?? 'unclaimed'}</dd>
            <dt className="text-[#777]">Slug</dt><dd>{company.slug}</dd>
            <dt className="text-[#777]">Plan</dt><dd>{company.plan_tier ?? 'free'}</dd>
            <dt className="text-[#777]">Onboarding</dt><dd>{company.onboarding_status ?? '-'}</dd>
            <dt className="text-[#777]">Subdomain</dt><dd>{company.subdomain ?? '-'}</dd>
            <dt className="text-[#777]">Custom domain</dt><dd>{company.custom_domain ?? '-'}</dd>
            <dt className="text-[#777]">Company email</dt><dd>{company.company_email ?? '-'}</dd>
            <dt className="text-[#777]">GitHub repo</dt><dd>{company.github_repo ?? '-'}</dd>
            <dt className="text-[#777]">Render service</dt><dd>{company.render_service_id ?? '-'}</dd>
            <dt className="text-[#777]">Neon database</dt><dd>{company.neon_database_id ?? '-'}</dd>
          </dl>
          <p className="mt-3 text-xs text-[#9a5b00]">Neon connection strings and other secrets are intentionally hidden.</p>
        </div>

        <div className="rounded-md border border-[#dedbd2] bg-white p-4">
          <h3 className="font-medium">Subscription</h3>
          {subscription ? (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <dt className="text-[#777]">Plan type</dt><dd>{subscription.plan_type}</dd>
              <dt className="text-[#777]">Status</dt><dd>{subscription.status}</dd>
              <dt className="text-[#777]">Night shifts</dt><dd>{subscription.night_shifts_remaining ?? 0} / {subscription.night_shifts_total ?? 0}</dd>
              <dt className="text-[#777]">Stripe customer</dt><dd>{subscription.stripe_customer_id ?? '-'}</dd>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-[#666]">No subscription row recorded.</p>
          )}
        </div>
      </section>

      <section className="rounded-md border border-[#dedbd2] bg-white p-4">
        <h3 className="font-medium">Recent Tasks</h3>
        <div className="mt-3 divide-y divide-[#eee]">
          {recentTasks.map((task) => (
            <div key={task.id} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_120px_120px]">
              <div>
                <p className="font-medium">{task.title}</p>
                <p className="text-xs text-[#777]">{task.id}</p>
              </div>
              <StatusBadge value={task.status} />
              <span className="text-xs text-[#777]">{task.created_at ? new Date(task.created_at).toLocaleString() : '-'}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-[#dedbd2] bg-white p-4">
          <h3 className="font-medium">Recent Events</h3>
          <div className="mt-3 divide-y divide-[#eee]">
            {recentEvents.map((event) => (
              <div key={event.id} className="py-3 text-sm">
                <p className="font-medium">{event.event_type}</p>
                <p className="text-xs text-[#777]">{event.created_at ? new Date(event.created_at).toLocaleString() : '-'}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-[#dedbd2] bg-white p-4">
          <h3 className="font-medium">Recent Reports</h3>
          <div className="mt-3 divide-y divide-[#eee]">
            {recentReports.map((report) => (
              <div key={report.id} className="py-3 text-sm">
                <p className="font-medium">{report.title ?? report.report_type ?? report.id}</p>
                <p className="text-xs text-[#777]">{report.created_at ? new Date(report.created_at).toLocaleString() : '-'}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run:

```bash
npm run build
```

Expected: PASS.

---

### Task 9: Robots And Indexing Safety

**Files:**
- Modify: `src/app/robots.ts`
- Modify: `robots.txt` if it is still deployed as a static asset

- [ ] **Step 1: Block owner route in generated robots**

Modify `src/app/robots.ts` so the disallow list includes:

```ts
'/owner/'
```

The route must also keep `metadata.robots.index = false` in the layout.

- [ ] **Step 2: Block owner route in static robots**

If `robots.txt` is served directly in the current deployment, add:

```text
Disallow: /owner/
```

- [ ] **Step 3: Verify**

Run:

```bash
npm run build
```

Expected: PASS.

---

### Task 10: Manual Verification

**Files:**
- No code changes

- [ ] **Step 1: Configure local private access**

Add local environment values:

```bash
ADMIN_EMAILS=<your-login-email>
SUPER_ADMIN_DASHBOARD_SLUG=local-owner-test-key
```

- [ ] **Step 2: Start the app**

Run:

```bash
npm run dev
```

Expected: Next dev server starts.

- [ ] **Step 3: Verify anonymous user cannot access dashboard**

Open:

```text
http://localhost:3000/owner/local-owner-test-key
```

Expected: redirect to `/login`.

- [ ] **Step 4: Verify wrong access key is hidden**

After logging in as an admin email, open:

```text
http://localhost:3000/owner/wrong-key
```

Expected: 404.

- [ ] **Step 5: Verify non-admin email is hidden**

Log in as an email not in `ADMIN_EMAILS`, then open:

```text
http://localhost:3000/owner/local-owner-test-key
```

Expected: 404.

- [ ] **Step 6: Verify admin email can view dashboard**

Log in as an email in `ADMIN_EMAILS`, then open:

```text
http://localhost:3000/owner/local-owner-test-key
```

Expected: overview metrics render, company table works, company detail page works.

- [ ] **Step 7: Verify audit rows**

Run a database query:

```sql
SELECT action, target_type, target_id, admin_email, created_at
FROM super_admin_audit_events
ORDER BY created_at DESC
LIMIT 10;
```

Expected: `view_overview`, `view_company_list`, and `view_company_detail` rows exist.

---

## Final Verification Checklist

- [ ] `npm test -- src/lib/super-admin.test.ts` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] Anonymous access to `/owner/<slug>` redirects to login.
- [ ] Wrong slug returns 404.
- [ ] Logged-in non-admin returns 404.
- [ ] Logged-in admin sees overview.
- [ ] Dashboard is not linked from public UI.
- [ ] `/owner/` is disallowed in robots and has `noindex`.
- [ ] Audit entries are written for overview, list, and detail views.
- [ ] Secret fields such as `neon_connection_string` are not rendered.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-super-admin-dashboard.md`.

Two execution options:

1. Subagent-Driven (recommended): dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution: execute tasks in this session using executing-plans, batch execution with checkpoints.
