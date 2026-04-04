# Baljia AI — Complete Remaining Implementation Plan

> **Date:** 2026-04-04
> **Status:** ~95% code complete. Auth migration done. All 37 services, 8 agents, 30 API routes, 31 UI components built.
> **What remains:** Bug fixes, type safety, missing UI elements, env setup, integration testing, deployment config, hardening.

---

## PHASE A: Critical Bug Fixes (Before First Run)

### A1. Name Generation — Retry With Fresh Names Instead of Suffix

**File:** `src/lib/services/onboarding.service.ts`
**Lines:** 442-467 (`runNameCompany`)
**Bug:** If slug collides, `generateSlug()` appends `-1`, `-2`. Polsia retries with entirely new LLM-generated names (up to 3 attempts). Current behavior produces ugly names like `pattr-1`.

**Fix:**
- Wrap the Haiku name generation + slug check in a retry loop (max 3 attempts)
- On retry, append to prompt: "The name {previous} is taken. Generate a completely different name."
- Only fall back to suffix appending on the 4th attempt (safety net)
- Keep `|| 'Launchpad'` fallback for total failure

---

### A2. `provisionSubdomain` Called With Empty `renderServiceId`

**File:** `src/lib/services/onboarding.service.ts`
**Line:** 540
**Bug:** `provisionSubdomain(ctx.companyId, slug, '')` passes empty string as `renderServiceId`. Domain service tries to attach to non-existent Render service — always fails.

**Fix:**
- Update `src/lib/services/domain.service.ts` `provisionSubdomain()` to accept empty `renderServiceId` gracefully
- When `renderServiceId` is empty: create Cloudflare DNS CNAME only (pointing to `parking.baljia.app`), skip Render `attachCustomDomain`
- Engineering agent already re-attaches to Render when it creates the service later (`engineering.tools.ts` line 491)

---

### A3. Dead `EnrichmentResult` Interface

**File:** `src/lib/services/onboarding.service.ts`
**Lines:** 76-84
**Bug:** `EnrichmentResult` interface defined but never used.

**Fix:** Delete the interface (lines 76-84).

---

### A4. `tweet_scheduled` Missing From EventType

**File:** `src/types/index.ts`
**Lines:** ~232-249 (EventType union)
**Bug:** Twitter tools emit `tweet_scheduled` events but type union doesn't include it.

**Fix:** Add `'tweet_scheduled'` to the `EventType` union.

---

### A5. `inspect_schema` Returns Hardcoded Table List

**File:** `src/lib/agents/tools/data.tools.ts`
**Lines:** ~76-90
**Bug:** Returns static list instead of querying `information_schema.columns`.

**Fix:**
- Query `information_schema.tables` and `information_schema.columns` for the company's Neon database
- If no dedicated Neon DB (uses platform DB), return known platform tables with a note
- Keep static list as fallback if query fails

---

### A6. `analyze_trends` Is a Stub

**File:** `src/lib/agents/tools/data.tools.ts`
**Lines:** ~142-144
**Bug:** Returns "Use get_metrics for basic analysis" — no real implementation.

**Fix:**
- Implement real aggregation: query key metrics grouped by day/week
- Accept `period` parameter (7d, 30d, 90d)
- Return `{ period, data_points: [{ date, value }], trend: 'up' | 'down' | 'flat', change_pct }`
- Use same read-only SQL path as `query_database`

---

### A7. `wait_for_email` — Missing Implementation

**File:** `src/lib/agents/tools/support.tools.ts`
**Bug:** Tool referenced in architecture but not in `getSupportTools()` or `handleSupportTool()`.

**Fix:**
- Do NOT use `setTimeout` (breaks in serverless)
- Implement as a polling tool: query `email_threads` table for new inbound emails matching criteria
- Accept `{ from_address?, subject_contains?, timeout_minutes: 5 }`
- Query once and return results (agent loop calls again if needed)
- If no match: return `"No matching email found yet. Check again later or proceed without waiting."`

---

## PHASE B: Type Safety — Date/String Mismatch (Critical)

Drizzle `timestamp()` returns JavaScript `Date` objects. TypeScript types in `src/types/index.ts` define all timestamp fields as `string`. This creates widespread unsafe `as unknown as` casts and potential runtime crashes.

### B1. Establish Consistent Pattern

**Decision:** Keep timestamps as `Date` in service layer, convert to ISO strings at API boundary (JSON serialization handles this automatically for Server→Client component passing).

**File:** `src/types/index.ts`
**Fix:** Change ALL timestamp fields from `string` to `string | Date` in the interfaces, OR create a separate `DrizzleUser`, `DrizzleTask`, etc. type that matches Drizzle output.

**Simpler approach:** Add a utility function and use it at API boundaries:
```typescript
// src/lib/utils.ts
export function serializeDates<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (result[key] instanceof Date) {
      (result as Record<string, unknown>)[key] = (result[key] as Date).toISOString();
    }
  }
  return result;
}
```

---

### B2. Fix `live-stream.service.ts` — Potential Runtime Crash

**File:** `src/lib/services/live-stream.service.ts`
**Lines:** 113-114
**Bug:** `t.started_at` is `Date | null` from Drizzle, code calls `.toISOString()` and `.getTime()` which works on Date but would crash on string.

**Fix:** Ensure `t.started_at` is handled as Date:
```typescript
const startedAt = t.started_at instanceof Date ? t.started_at : t.started_at ? new Date(t.started_at) : null;
started_at: startedAt?.toISOString() ?? new Date().toISOString(),
running_seconds: Math.round((now - (startedAt?.getTime() ?? now)) / 1000),
```

---

### B3. Fix `chat.service.ts` — JSONB Casting Issues

**File:** `src/lib/services/chat.service.ts`
**Lines:** 19, 29, 49, 56, 65
**Bug:** Double `as unknown as unknown as ChatMessage[]` cast on line 49. No validation of JSONB data from DB.

**Fix:**
- Remove double cast
- Add runtime validation when reading messages from JSONB:
```typescript
const raw = session.messages;
const messages = Array.isArray(raw) ? raw as ChatMessage[] : [];
```
- Replace all `as unknown as ChatSession` with proper type narrowing

---

### B4. Fix Unsafe `as unknown as` Casts in Event Service

**File:** `src/lib/services/event.service.ts`
**Lines:** 62, 84, 91, 105
**Fix:** JSON serialization at API boundary handles Date→string. Remove casts and let TypeScript infer Drizzle return types within the service. Only cast at the API route level.

---

### B5. Worker Launcher — Inconsistent Date Handling

**File:** `src/lib/agents/worker-launcher.ts`
**Lines:** 140, 160, 184, 272
**Bug:** Mixes `new Date().toISOString()` (string) and `new Date()` (Date) for the same fields.

**Fix:** Use `new Date()` consistently within the worker. Let JSON serialization handle string conversion at the API boundary.

---

## PHASE C: Missing UI Elements

### C1. Logout Button + User Info in DashboardShell

**File:** `src/components/dashboard/DashboardShell.tsx`
**Bug:** `user` prop received (line 24) but never rendered. No sign-out option anywhere.

**Fix:**
- Add a small header row at the top of the left sidebar (above mascot card):
  ```tsx
  <div className="flex items-center justify-between px-2 py-3">
    <span className="text-xs text-text-muted truncate">{user.email ?? user.name}</span>
    <button onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => window.location.href = '/login')}
      className="text-xs text-text-muted hover:text-text-primary">
      Sign out
    </button>
  </div>
  ```

---

### C2. `PurchaseCreditsDialog` — Wire to Real Stripe Checkout

**File:** `src/components/dashboard/PurchaseCreditsDialog.tsx`
**Line:** 54
**Bug:** Currently shows `alert('Coming soon')`.

**Fix:**
- On "Purchase" click, POST to `/api/billing/checkout` with `{ companyId, type: 'credits', credits: selectedAmount }`
- API already exists and calls `createCreditPurchaseSession()` in billing.service.ts
- On success, `window.location.href = session.url` (Stripe hosted checkout)
- Show loading state while creating session
- Handle errors with toast

---

### C3. `recentUsage` Hardcoded in DashboardShell

**File:** `src/components/dashboard/DashboardShell.tsx`
**Line:** 96 — `recentUsage={[2, 1, 3, 0, 2, 1, 4]}`

**Fix:**
- In `dashboard/[companyId]/page.tsx`: query `credit_ledger` for last 7 days, group by date, sum absolute deduction amounts
- Pass as prop: `recentUsage={usageByDay}` (array of 7 numbers, oldest first)
- If no data for a day, use 0

---

### C4. `animate-fade-in` CSS Animation Missing

**File:** `src/app/globals.css`
**Bug:** `animate-fade-in` used in ChatMessage.tsx (lines 16, 56), ChatPanel.tsx (line 155), ChatInput.tsx but never defined.

**Fix:** Add to globals.css:
```css
@keyframes fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in {
  animation: fade-in 0.2s ease-out;
}
```

---

### C5. Document Suggestion Review UI

**Context:** Backend exists (`document_suggestions` table, `/api/documents/suggestions` route). Founders can't review AI-suggested document edits.

**Fix:**
- Create `src/components/dashboard/DocumentSuggestionBanner.tsx`
- Show badge on documents with pending suggestions
- On click: diff view (current vs suggested content)
- Three actions: Accept / Edit / Skip
- Wire to `/api/documents/suggestions` POST with `{ action: 'accept' | 'edit' | 'skip' }`

**Priority:** Medium — not blocking MVP but important for core "AI suggests, founder reviews" loop.

---

### C6. Dashboard Page Metadata (Browser Tab Titles)

**File:** `src/app/(dashboard)/dashboard/[companyId]/page.tsx`
**Bug:** No `generateMetadata()` export — browser tab shows generic "Baljia AI" instead of company name.

**Fix:**
```typescript
import type { Metadata } from 'next';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { companyId } = await params;
  const [company] = await db.select({ name: companies.name })
    .from(companies).where(eq(companies.id, companyId)).limit(1);
  return {
    title: `${company?.name ?? 'Dashboard'} — Baljia`,
  };
}
```

---

### C7. Login + Onboarding Page Metadata

**Files:** `src/app/(auth)/login/page.tsx`, `src/app/(auth)/onboarding/page.tsx`
**Bug:** No page-level metadata. Browser tab shows root title for all auth pages.

**Fix:** Add metadata export to each (client components can't export metadata, so add a `layout.tsx` in `(auth)/` or use `<title>` via `next/head`).

Alternative: Create `src/app/(auth)/layout.tsx` with:
```typescript
export const metadata = { title: 'Baljia AI' };
```
And create individual `src/app/(auth)/login/layout.tsx`:
```typescript
export const metadata = { title: 'Sign in — Baljia' };
```

---

### C8. Referral UI (Post-MVP)

**Context:** Backend exists (`referrals` table, `referral_code` on users). No frontend.

**Fix:**
- Add "Refer & Earn" section in left sidebar (below credits)
- Show user's referral code/link
- Copy-to-clipboard button
- Show count of successful referrals

**Priority:** Low — post-MVP.

---

## PHASE D: Missing Env Vars + Config Fixes

### D1. Add Stripe Price IDs to .env.example

**File:** `.env.example`
**Bug:** `billing.service.ts` references 6 Stripe price env vars not in template.

**Fix:** Add under Stripe section:
```env
# Stripe price IDs (create in Stripe Dashboard > Products)
STRIPE_PRICE_STARTER=price_xxx
STRIPE_PRICE_GROWTH=price_xxx
STRIPE_PRICE_SCALE=price_xxx
STRIPE_PRICE_CREDITS_10=price_xxx
STRIPE_PRICE_CREDITS_50=price_xxx
STRIPE_PRICE_CREDITS_100=price_xxx
```

---

### D2. Add CRON_SECRET to .env.example

**File:** `.env.example`
**Bug:** Cron routes check `CRON_SECRET` but it's missing from template.

**Fix:**
```env
# ─── Cron Job Security ──────────────────────
CRON_SECRET=your_cron_secret
```

---

### D3. Remove Supabase Image Pattern From next.config.ts

**File:** `next.config.ts`
**Bug:** `remotePatterns` still allows `*.supabase.co` images — no longer needed.

**Fix:** Remove supabase.co pattern. Add R2/assets pattern:
```ts
remotePatterns: [
  { protocol: 'https', hostname: 'assets.baljia.app' },
],
```

---

### D4. Remove `dotenv` Import From Test Scripts

**Files:** `src/scripts/test-ceo.ts`, `src/scripts/test-neon.ts`
**Bug:** Import `from 'dotenv'` but `dotenv` is not in package.json. Next.js auto-loads `.env.local`.

**Fix:** Either:
- (a) Add `dotenv` to devDependencies: `npm install -D dotenv`
- (b) Remove the `import { config } from 'dotenv'; config({ path: '.env.local' });` lines (since these scripts run via `npx tsx` which doesn't auto-load .env)

**Recommended:** Option (a) — scripts run outside Next.js and need dotenv.

---

### D5. CLAUDE.md Accuracy Updates

**File:** `CLAUDE.md`
**Issues found:**
1. Line ~81: Says onboarding components "not yet built" — they're implemented as single page component, not sub-components
2. Line ~247: Says "18 service files" — actual count is 37
3. Line ~240: Says "12 base UI components" — actual count is 11
4. "What's Built" section still references Supabase Auth — needs updating to reflect JWT + jose migration
5. "What's NOT Built Yet" section lists items that ARE now built (Email service, Neon service, Billing service)
6. Auth files section still lists `src/lib/supabase/*.ts` — those are deleted

**Fix:** Update all inaccurate sections to match current state.

---

## PHASE E: Database Setup & Migration

### E1. Create Neon Project

- Go to [console.neon.tech](https://console.neon.tech)
- Create new project (region: closest to target users)
- Copy connection string → `DATABASE_URL` in `.env.local`

### E2. Apply Schema

**Option A — Drizzle push (recommended for fresh DB):**
```bash
npx drizzle-kit push
```
Reads `src/lib/db/schema.ts` and creates all 35+ tables.

**Option B — Run SQL migrations manually (gets triggers + functions too):**
Apply in order in Neon SQL editor:
1. `supabase/migrations/00001_initial_schema.sql` — 27 tables + triggers + RLS
2. `supabase/migrations/00002_fix_schema_code_mismatches.sql`
3. `supabase/migrations/00002_guardrails.sql`
4. `supabase/migrations/00003_fix_plan_tier_and_onboarding_status.sql`
5. `supabase/migrations/00004_ceo_missing_tables.sql`
6. `supabase/migrations/00005_auth_columns.sql`

**Note:** SQL migrations include PostgreSQL triggers (`create_core_documents`, `update_updated_at`, `get_credit_balance`) that Drizzle push won't create. Use Option B if you need these, or create a separate seed script.

### E3. Seed the 9 Agents

The `agents` table must be populated. Agent factory routes by `agent_id`.

```sql
INSERT INTO agents (id, name, agent_type, max_turns, model, execution_style, description) VALUES
(0,  'CEO',          'ceo',          5,   'claude-sonnet-4-20250514', 'agentic',    'AI CEO — founder interaction, task proposals, memory management'),
(29, 'Research',     'research',     200, 'claude-sonnet-4-20250514', 'structured', 'Market research, competitive analysis, web intelligence'),
(30, 'Engineering',  'engineering',  200, 'claude-sonnet-4-20250514', 'agentic',    'Full-stack development, infrastructure, deployment'),
(32, 'Support',      'support',      200, 'claude-sonnet-4-20250514', 'structured', 'Customer support, email handling, escalations'),
(33, 'Data',         'data',         200, 'claude-sonnet-4-20250514', 'structured', 'SQL queries, analytics, business intelligence'),
(40, 'Twitter',      'twitter',      200, 'claude-sonnet-4-20250514', 'graph',      'Tweet composition, scheduling, engagement'),
(41, 'MetaAds',      'meta_ads',     100, 'claude-sonnet-4-20250514', 'graph',      'Facebook/Instagram ad campaigns, creative, optimization'),
(42, 'Browser',      'browser',      200, 'claude-sonnet-4-20250514', 'structured', 'Web navigation, form filling, scraping, screenshots'),
(54, 'ColdOutreach', 'cold_outreach',200, 'claude-sonnet-4-20250514', 'graph',      'Email finding, verification, personalized outreach');
```

### E4. Verify DB Connection

```bash
npm run dev
# Visit http://localhost:3000/api/health
# Expected: { status: 'ok', db: true }
```

---

## PHASE F: Environment Variable Setup

### F1. Minimum Viable (First Run)

```env
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
AUTH_SECRET=<openssl rand -hex 32>
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
ANTHROPIC_API_KEY=sk-ant-xxx
POSTMARK_SERVER_TOKEN=xxx
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### F2. Full Agent Testing

```env
TAVILY_API_KEY=tvly-xxx
BROWSERBASE_API_KEY=xxx
BROWSERBASE_PROJECT_ID=xxx
GITHUB_TOKEN=ghp_xxx
GITHUB_ORG=baljia-ai
RENDER_API_KEY=rnd_xxx
RENDER_OWNER_ID=xxx
TWITTER_API_KEY=xxx
TWITTER_API_SECRET=xxx
TWITTER_ACCESS_TOKEN=xxx
TWITTER_ACCESS_SECRET=xxx
HUNTER_API_KEY=xxx
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_PRICE_STARTER=price_xxx
STRIPE_PRICE_GROWTH=price_xxx
STRIPE_PRICE_SCALE=price_xxx
STRIPE_PRICE_CREDITS_10=price_xxx
STRIPE_PRICE_CREDITS_50=price_xxx
STRIPE_PRICE_CREDITS_100=price_xxx
NEON_API_KEY=xxx
CLOUDFLARE_API_TOKEN=xxx
CLOUDFLARE_ZONE_ID_APP=xxx
CRON_SECRET=<openssl rand -hex 16>
UPSTASH_REDIS_REST_URL=xxx
UPSTASH_REDIS_REST_TOKEN=xxx
```

### F3. Optional (Non-Blocking)

```env
R2_ACCOUNT_ID=xxx
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=baljia-assets
R2_PUBLIC_URL=https://assets.baljia.app
META_ADS_ACCESS_TOKEN=xxx
META_ADS_ACCOUNT_ID=act_xxx
SLACK_BOT_TOKEN=xoxb-xxx
GEMINI_API_KEY=xxx
OPENAI_API_KEY=xxx
NEXT_PUBLIC_SENTRY_DSN=xxx
SENTRY_AUTH_TOKEN=xxx
IPINFO_TOKEN=xxx
```

---

## PHASE G: Integration Testing Checklist

### G1. Auth — Magic Link

1. Go to `/login`
2. Enter email, click "Get Started"
3. Check Postmark logs for magic link email
4. Click the link
5. **Verify:** Redirects to `/onboarding` (new user) or `/dashboard/{companyId}` (existing)
6. **Verify:** `baljia-session` cookie set (httpOnly, Secure, SameSite=Lax)
7. **Verify:** Expired token (wait 15 min) shows "invalid link" error

### G2. Auth — Google OAuth

1. Click "Continue with Google"
2. Complete consent screen
3. **Verify:** Redirects through `/api/auth/google/callback`
4. **Verify:** Session cookie set, redirects to correct page
5. **Verify:** User record created with `google_id`, `email_verified=true`, `auth_provider='google'`
6. **Verify:** Second login with same Google account finds existing user (no duplicate)

### G3. Auth — Logout

1. Click "Sign out" (after B1 fix)
2. **Verify:** Cookie cleared, redirected to `/login`
3. **Verify:** Visiting `/dashboard` redirects back to `/login`

### G4. Onboarding — Surprise Me

1. After first login, arrive at `/onboarding`
2. Select "Create something new" → "Surprise me"
3. **Verify:** SSE progress shows stages updating in real-time
4. **Verify:** All 13 stages complete
5. **Verify:** Redirects to `/dashboard/{companyId}`
6. **Verify:** Dashboard shows: company name, one-liner, 3 starter tasks, mission document
7. **Verify:** Memory Layer 1 has: Founder Profile, Founder Angle, Strategy Rationale, Journey Context, Infrastructure sections

### G5. Onboarding — Build My Idea

1. Select "Create something new" → "I have an idea"
2. Enter idea text (e.g., "AI-powered recipe planner for busy parents")
3. **Verify:** Pipeline uses idea in strategy, naming, tasks
4. **Verify:** Starter tasks reference the specific idea and real competitors

### G6. Onboarding — Grow My Company

1. Select "Grow an existing company"
2. Enter business URL (e.g., `https://example.com`)
3. **Verify:** Pipeline enriches business via Tavily
4. **Verify:** Starter tasks are growth-focused (not build-from-scratch)

### G7. CEO Chat

1. Open chat panel on dashboard
2. Send "What can you help me with?"
3. **Verify:** Streaming response from CEO agent
4. Send "Create a task to build a landing page"
5. **Verify:** TaskProposalCard appears with credit quote (1 credit)
6. Click "Approve"
7. **Verify:** Task appears in task board as "To Do"
8. Ask "Why did you suggest this idea?" (for Surprise Me companies)
9. **Verify:** CEO reads Strategy Rationale + Founder Angle from memory and explains

### G8. Task Execution

1. Have approved task in "To Do"
2. POST to `/api/worker/launch` with `{ taskId, companyId }`
3. **Verify:** Task moves to "In Progress"
4. **Verify:** Credit deducted (balance decreased by 1)
5. **Verify:** Agent runs (check execution logs in `task_executions`)
6. **Verify:** Task completes with report in `reports` table
7. **Verify:** Verification runs (task status: `completed_verified` or `completed_unverified`)

### G9. Billing — Stripe Checkout

1. Click "Buy Credits" in dashboard (after C2 fix)
2. Select credit amount
3. **Verify:** Redirects to Stripe checkout page
4. Complete with test card `4242 4242 4242 4242`
5. **Verify:** Webhook fires (`checkout.session.completed`)
6. **Verify:** Credits added to balance
7. **Verify:** Credit ledger shows purchase entry

### G10. Night Shift

1. Trigger: `POST /api/cron/night-shift` with `Authorization: Bearer {CRON_SECRET}`
2. **Verify:** Night shift plans and executes eligible tasks
3. **Verify:** Summary email sent to founder
4. **Verify:** `night_shift_cycles` record created
5. **Verify:** Respects lifecycle check (only runs for trial_active/full_active/keep_live_active)

### G11. Live Wall

1. Visit `/live` (no auth required)
2. **Verify:** SSE stream connects (green "Live" indicator)
3. **Verify:** Events appear in real-time when tasks execute

### G12. Public Company Page

1. Visit `/company/{slug}`
2. **Verify:** Shows company name, one-liner, stage, task counts, activity

---

## PHASE H: Deployment Configuration

### H1. Create render.yaml

**File:** `render.yaml` (project root)

```yaml
services:
  - type: web
    name: baljia-ai
    env: node
    plan: starter
    buildCommand: npm install && npm run build
    startCommand: npm start
    healthCheckPath: /api/health
```

### H2. Set Up Stripe Webhooks

1. Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://your-domain.com/api/webhooks/stripe`
3. Select events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`
4. Copy signing secret → `STRIPE_WEBHOOK_SECRET`

### H3. Set Up Google OAuth

1. Google Cloud Console → Credentials → OAuth 2.0 Client ID
2. Authorized redirect URI: `https://your-domain.com/api/auth/google/callback`
3. Also add `http://localhost:3000/api/auth/google/callback` for local dev

### H4. Set Up Postmark

1. Create account at postmarkapp.com
2. Add sender signatures: `hello@baljia.app`, `updates@baljia.app`, `alerts@baljia.app`
3. Verify domain DNS (SPF, DKIM, DMARC)
4. Copy Server API Token → `POSTMARK_SERVER_TOKEN`

### H5. Set Up Cron Jobs

| Endpoint | Schedule | Purpose |
|----------|----------|---------|
| `POST /api/cron/night-shift` | `0 3 * * *` (3 AM UTC) | Nightly task planning + execution |
| `POST /api/cron/recurring` | `*/15 * * * *` (every 15 min) | Recurring task evaluation |

Both require header: `Authorization: Bearer {CRON_SECRET}`

Options: Render Cron Jobs, Upstash QStash (already in deps), or external service.

---

## PHASE I: Accessibility & Polish

### I1. Login Form Accessibility

**File:** `src/app/(auth)/login/page.tsx`
**Bug:** Email input has no `<label>` element. Google button has SVG only, no text for screen readers.

**Fix:**
- Add `aria-label="Email address"` to email input
- Add `aria-label="Continue with Google"` to Google button (it has visible text "Continue with Google" but the SVG needs alt handling)

---

### I2. Add Custom 404 Page

**File:** `src/app/not-found.tsx` (NEW)

**Fix:** Create simple 404 page matching design system:
```tsx
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-primary">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-baljia-gold mb-4">404</h1>
        <p className="text-text-secondary mb-8">Page not found</p>
        <a href="/login" className="text-baljia-gold hover:underline">Go home</a>
      </div>
    </div>
  );
}
```

---

### I3. Stripe Webhook Error Leakage

**File:** `src/app/api/webhooks/stripe/route.ts`
**Bug:** Error message may expose internal Stripe SDK details to the client.

**Fix:** Return generic message in production:
```typescript
return NextResponse.json(
  { error: process.env.NODE_ENV === 'production' ? 'Webhook verification failed' : err.message },
  { status: 400 }
);
```

---

## PHASE J: Production Hardening (Post-MVP)

### J1. Rate Limiting on Magic Link

**File:** `src/app/api/auth/magic-link/route.ts`
**Fix:** Add `checkRateLimitAsync('magic-link', email, 5, 60)` — 5 per minute per email.

### J2. Rate Limiting on All Mutation Endpoints

**Currently rate-limited:** `/api/chat` (20/min), `/api/worker/launch` (10/min)
**Missing:** `/api/tasks/*` POST/PATCH, `/api/documents/*`, `/api/recurring`
**Fix:** Add rate limiting to all user-initiated mutation endpoints.

### J3. Expired Token Cleanup

Add cron job or Neon scheduled query:
```sql
DELETE FROM magic_link_tokens WHERE expires_at < NOW() - INTERVAL '1 day';
```

### J4. Sentry Error Tracking

Already installed (`@sentry/nextjs`), already wired in `next.config.ts`. Just needs env vars:
```env
NEXT_PUBLIC_SENTRY_DSN=xxx
SENTRY_ORG=xxx
SENTRY_PROJECT=baljia-ai
SENTRY_AUTH_TOKEN=xxx
```

### J5. Admin Dashboard UI

Current: `/api/ops/dashboard` returns JSON (requires admin auth).
Build: Simple `/admin` page visualizing active companies, tasks by status, credit usage, errors.

### J6. Multi-Company Navigation

Current: Dashboard shows one company. No switcher.
Build: Company dropdown in DashboardShell header. Query user's companies on load.

### J7. Test Coverage

Current: 1 test file (`credit.service.test.ts`).
Add tests for:
- `auth.service.ts` (magic link create/verify, Google user find/create)
- `onboarding.service.ts` (pipeline stage sequencing)
- `governance.service.ts` (task classification)
- `worker-launcher.ts` (lifecycle checks, credit deduction)

---

## Summary — Priority Order

| Priority | Phase | Effort | What |
|----------|-------|--------|------|
| **P0** | A (7 bug fixes) | 1-2 hrs | Name gen, provisionSubdomain, dead interface, EventType, data tool stubs, wait_for_email |
| **P0** | B (Type safety) | 1-2 hrs | Date/string mismatch, live-stream crash, chat JSONB, unsafe casts |
| **P0** | D (Env vars + config) | 30 min | 7 missing env vars, supabase image pattern, dotenv, CLAUDE.md |
| **P0** | E (Database) | 30 min | Neon project, migrations, seed agents |
| **P0** | F1 (Min env) | 15 min | 7 required env vars |
| **P1** | C1 (Logout + user) | 30 min | Can't sign out without this |
| **P1** | C2 (Purchase credits) | 30 min | Wire real Stripe checkout |
| **P1** | C3-C4 (Usage + CSS) | 20 min | Dashboard polish |
| **P1** | G (Integration tests) | 2-3 hrs | 12 end-to-end flows |
| **P2** | C5 (Doc suggestions UI) | 2 hrs | AI suggestion review |
| **P2** | C6-C7 (Metadata) | 20 min | Browser tab titles |
| **P2** | H (Deployment) | 1 hr | render.yaml, Stripe webhooks, cron |
| **P2** | I (Accessibility + 404) | 30 min | ARIA labels, 404 page, error leakage |
| **P3** | J (Hardening) | 3-4 hrs | Rate limits, token cleanup, Sentry, tests |
| **P4** | C8 (Referral UI) | 1 hr | Post-MVP |

**Total to production-ready MVP: ~14-18 hours**

---

## Files Changed Summary

| Action | Files |
|--------|-------|
| **Edit** | `onboarding.service.ts`, `domain.service.ts`, `types/index.ts`, `data.tools.ts`, `support.tools.ts`, `live-stream.service.ts`, `chat.service.ts`, `event.service.ts`, `worker-launcher.ts`, `DashboardShell.tsx`, `PurchaseCreditsDialog.tsx`, `globals.css`, `.env.example`, `next.config.ts`, `CLAUDE.md`, `dashboard/[companyId]/page.tsx`, `login/page.tsx`, `webhooks/stripe/route.ts`, `api/auth/magic-link/route.ts` |
| **Create** | `DocumentSuggestionBanner.tsx`, `not-found.tsx`, `render.yaml`, `(auth)/login/layout.tsx` |
| **Delete** | Lines 76-84 in `onboarding.service.ts` (dead interface), `components/onboarding/` (empty dir) |
