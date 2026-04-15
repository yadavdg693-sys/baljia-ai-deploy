# Baljia AI Code Audit Report

**Date:** 2026-04-11
**Repository:** `C:/Users/Vaishnavi/My_Projects/baljia-ai`
**Audit type:** Read-only code audit
**Scope reviewed:** auth, middleware, dashboard data flow, API routes, webhooks, worker/execution engine, billing/credits, agent tools, event streaming, database schema/RLS, cron jobs

## Executive summary

This audit found multiple tenant-isolation and billing-integrity failures.

### Severity summary
- **Critical:** 10
- **High:** 5
- **Medium:** 6

### Top risks
1. Anonymous users can observe cross-tenant live operations through the public event stream.
2. Authenticated users can access another tenant's dashboard and receive that tenant's Neon database credentials in the browser.
3. Billing and execution controls can be bypassed or corrupted through race conditions and mutable execution-state updates.
4. Agent infrastructure tools are not tenant-scoped and can operate against other companies' GitHub/Render assets.
5. Sensitive multi-tenant tables have no RLS boundary at all.

---

## Critical findings

### C1. Public SSE endpoint leaks cross-tenant live task metadata
**Severity:** Critical

**Impact**
Any unauthenticated internet user can connect to the public live stream and receive live task metadata for all tenants, including company names, task titles, tags, start times, and run durations. This breaks tenant isolation and exposes internal operational activity.

**Evidence**
- `src/middleware.ts:33-38`
- `src/app/api/events/stream/route.ts:13-27`
- `src/app/api/events/stream/route.ts:43-50`
- `src/app/api/events/stream/route.ts:85-89`
- `src/lib/services/live-stream.service.ts:89-121`

**Details**
`publicOnly=true` skips auth, but the handler still includes `runningTasks`. `getRunningTasks()` joins all in-progress tasks with company names and returns them globally, without any `is_public_safe` or tenant filter.

**Recommended remediation**
- Remove `runningTasks` from public responses.
- Add a strict public DTO with explicit allowlisted fields.
- Treat public streams as a separate surface, not a mode switch on the same internal endpoint.

---

### C2. Public events leak internal user and tenant identifiers
**Severity:** Critical

**Impact**
Public event consumers can harvest sensitive internal identifiers, including founder `owner_id` values and tenant `company_id` values, from events marked public.

**Evidence**
- `src/app/api/onboarding/route.ts:41-44`
- `src/lib/services/event.service.ts:33-44`
- `src/app/api/events/stream/route.ts:26`
- `src/lib/services/live-stream.service.ts:16-37`

**Details**
`company_created` is emitted with `isPublic = true` and includes `owner_id: auth.user.id`. The event service persists and returns raw payloads without redaction.

**Recommended remediation**
- Never include internal IDs in public event payloads.
- Introduce a public event schema with enforced redaction.
- Validate public payloads centrally before persistence and before streaming.

---

### C3. Authenticated users can access another tenant's dashboard
**Severity:** Critical

**Impact**
Any authenticated user can request `/dashboard/[companyId]` for another company and receive that tenant's company, task, document, report, and credit data.

**Evidence**
- `src/app/(dashboard)/dashboard/[companyId]/page.tsx:11-23`
- `src/app/(dashboard)/dashboard/[companyId]/page.tsx:29-99`

**Details**
The page checks only for the existence of a session. It does not verify that the current user owns the `companyId` route param before querying and rendering tenant data.

**Recommended remediation**
- Enforce ownership on the dashboard page before any query.
- Prefer a shared server-side ownership guard for page and API access.
- Avoid selecting tenant data before authorization is established.

---

### C4. Neon database credentials are serialized into the browser
**Severity:** Critical

**Impact**
Tenant database credentials can be exposed to the browser, enabling direct external access to a founder's database outside application auth controls.

**Evidence**
- `src/app/(dashboard)/dashboard/[companyId]/page.tsx:17-21`
- `src/app/(dashboard)/dashboard/[companyId]/page.tsx:90-99`
- `src/lib/db/schema.ts:67-70`
- `src/components/dashboard/DashboardShell.tsx:36-56`

**Details**
The dashboard page does `select()` on the full `companies` row, which includes `neon_connection_string`, then passes `company` into a client component. That serializes sensitive infrastructure fields into the client payload.

**Recommended remediation**
- Never select `neon_connection_string` for dashboard rendering.
- Project a minimal safe server DTO instead of using full-row `select()`.
- Remove connection strings from any object passed to client components.

---

### C5. Billing suspension can be bypassed by tenant-controlled settings updates
**Severity:** Critical

**Impact**
A suspended or past-due customer can reactivate execution themselves and continue using paid execution capacity.

**Evidence**
- `src/app/api/companies/[companyId]/settings/route.ts:23-36`
- `src/lib/services/billing.service.ts:140-145`
- `src/lib/services/billing.service.ts:152-154`
- `src/lib/agents/worker-launcher.ts:53-68`

**Details**
The settings route allows owners to PATCH `execution_state`. Billing logic suspends execution by writing that same field. Worker launch trusts the mutable company field, so a customer can set it back to `active`.

**Recommended remediation**
- Remove customer write access to billing-controlled execution states.
- Separate user preferences from platform-enforced suspension state.
- Enforce billing suspension from authoritative subscription state at execution time.

---

### C6. Concurrent task launches can double-charge a single task
**Severity:** Critical

**Impact**
A company can be charged multiple times for one task while only one execution actually starts, causing overbilling and ledger corruption.

**Evidence**
- `src/lib/agents/worker-launcher.ts:45-50`
- `src/lib/agents/worker-launcher.ts:105-123`
- `src/lib/services/task.service.ts:110-122`

**Details**
`launchTask()` deducts credits before the atomic `startTask()` claim. Two concurrent launch attempts can both pass the initial `todo` check and both deduct credits. Only one later succeeds in `startTask()`.

**Recommended remediation**
- Make claim-and-charge one atomic transaction.
- Claim task status first, then bill within the same transaction.
- Add idempotency around task launch requests.

---

### C7. Agent infrastructure tools are not tenant-scoped
**Severity:** Critical

**Impact**
A compromised or prompt-injected agent for one company can access, modify, or destroy another company's GitHub repos, Render services, logs, or other platform infrastructure.

**Evidence**
- `src/lib/agents/tools/engineering.tools.ts:551-553`
- `src/lib/agents/tools/engineering.tools.ts:607-646`
- `src/lib/agents/tools/engineering.tools.ts:699-726`
- `src/lib/agents/tools/engineering.tools.ts:926-992`
- `src/lib/agents/tools/engineering.tools.ts:995-1026`
- `src/lib/agents/tools/engineering.tools.ts:1545-1586`
- `src/lib/agents/tools/engineering.tools.ts:1686-1708`
- `src/lib/agents/tools/data.tools.ts:326-334`

**Details**
These tool handlers trust arbitrary `repo` and `service_id` inputs and execute with platform-wide GitHub and Render credentials, without checking that the target asset belongs to the current company.

**Recommended remediation**
- Resolve infra targets from the current company record instead of accepting arbitrary IDs.
- Enforce per-company ownership checks inside every infra tool.
- Remove delete/list-all capabilities from normal tenant execution paths.

---

### C8. `query_database` tenant isolation is bypassable
**Severity:** Critical

**Impact**
The Data agent can read arbitrary platform tables and cross-tenant data despite the intended tenant guard.

**Evidence**
- `src/lib/agents/tools/data.tools.ts:102-146`

**Details**
The only tenant check is `query.includes(companyId)`. An attacker can satisfy that with a comment or string literal and still run arbitrary `SELECT` statements against platform tables.

**Recommended remediation**
- Remove raw SQL against the platform DB from tenant-scoped agent tools.
- Replace with parameterized, allowlisted read operations.
- If SQL must remain, parse and enforce table-level and predicate-level restrictions server-side.

---

### C9. Secrets are leaked to models and persisted in execution logs
**Severity:** Critical

**Impact**
Database credentials and generated passwords can enter model context and durable execution logs, creating a long-lived secret exposure surface.

**Evidence**
- `src/lib/agents/tools/engineering.tools.ts:1213-1224`
- `src/lib/agents/tools/browser.tools.ts:534-535`
- `src/lib/agents/agent-factory.ts:1302-1314`
- `src/lib/agents/agent-factory.ts:1415-1427`
- `src/lib/agents/worker-launcher.ts:194-195`
- `src/lib/agents/worker-launcher.ts:289-303`
- `src/lib/db/schema.ts:141-157`

**Details**
`get_database_info` returns a full connection string. `generate_password` returns plaintext passwords. Tool results are appended to agent execution logs and then stored in `task_executions.execution_log`.

**Recommended remediation**
- Never return raw credentials to the model unless absolutely unavoidable.
- Redact secrets before logging or persisting tool outputs.
- Store opaque handles or one-time retrieval references instead of raw secrets.

---

### C10. Sensitive multi-tenant tables have no RLS boundary
**Severity:** Critical

**Impact**
Billing data, email content, contact lists, browser credentials, internal events, roadmap data, and magic-link tokens are outside database-enforced tenant isolation.

**Evidence**
- `supabase/migrations/00001_initial_schema.sql:259-275`
- `supabase/migrations/00001_initial_schema.sql:413-460`
- `supabase/migrations/00001_initial_schema.sql:540-597`
- `supabase/migrations/00005_auth_columns.sql:7-16`
- `supabase/migrations/00006_roadmap_system.sql:7`
- `supabase/migrations/00006_roadmap_system.sql:28`

**Details**
RLS is enabled only for six tables in the initial schema. High-sensitivity tables including `subscriptions`, `email_threads`, `contacts`, `browser_credentials`, `platform_events`, `magic_link_tokens`, `roadmaps`, and `milestones` lack RLS and tenant policies.

**Recommended remediation**
- Enable RLS on all tenant-bearing and auth-bearing tables.
- Add explicit tenant policies for reads and writes.
- Treat `magic_link_tokens`, `browser_credentials`, and billing tables as privileged data with stricter policies than normal tenant data.

---

## High findings

### H1. Browser credential storage fails open to plaintext when `ENCRYPTION_KEY` is missing
**Severity:** High

**Impact**
Founder credentials may be stored unencrypted at rest if production configuration is incomplete, increasing blast radius from DB compromise or insider access.

**Evidence**
- `src/lib/agents/tools/browser.tools.ts:18-24`
- `src/lib/agents/tools/browser.tools.ts:382-393`
- `src/lib/db/schema.ts:438-449`

**Details**
If `ENCRYPTION_KEY` is absent, `encryptPassword()` returns plaintext and logs a warning. Credential storage should fail closed, not silently downgrade to cleartext.

**Recommended remediation**
- Refuse credential storage when `ENCRYPTION_KEY` is missing.
- Add startup checks that hard-fail in production without encryption configuration.

---

### H2. Credit grant path is non-atomic and can corrupt ledger balances under concurrency
**Severity:** High

**Impact**
Concurrent credit grants or refunds can produce incorrect `balance_after` values and inconsistent ledger history, even outside the Stripe webhook race already identified.

**Evidence**
- `src/lib/services/credit.service.ts:113-135`
- `src/lib/services/credit.service.ts:189-223`

**Details**
`addCredit()` and `refundCredit()` read the current balance, compute `balance_after`, then insert. That sequence is not transactional and is vulnerable to concurrent writers.

**Recommended remediation**
- Move credit mutations to a single atomic SQL function or transactional ledger write.
- Derive `balance_after` server-side inside the transaction.

---

### H3. Daily spend-cap enforcement is race-prone
**Severity:** High

**Impact**
Concurrent deductions can exceed per-plan daily caps because cap evaluation and insertion are separated.

**Evidence**
- `src/lib/services/credit.service.ts:55-73`
- `src/lib/services/credit.service.ts:77-95`

**Details**
`deductCredit()` computes `spentToday` from historical rows, then performs a later insert. Parallel launches can all pass the cap check before any of them writes the debit.

**Recommended remediation**
- Enforce daily caps inside the same transaction as the deduction.
- Consider a DB-side function that checks both current balance and daily spend atomically.

---

### H4. Public event exposure is controlled by ad-hoc booleans, not an enforced public schema
**Severity:** High

**Impact**
Future call sites can accidentally expose private data simply by passing `true` to `eventService.emit(..., isPublic)`.

**Evidence**
- `src/lib/services/event.service.ts:33-44`
- `src/app/api/onboarding/route.ts:41-44`
- `src/lib/services/onboarding.service.ts:728-738`

**Details**
The event system trusts callers to decide whether an event is public and does not enforce an allowlist or field-level redaction policy.

**Recommended remediation**
- Replace the boolean flag with a typed public-event API.
- Validate public event payloads against a dedicated schema.
- Block arbitrary raw payloads from entering public surfaces.

---

### H5. Magic-link throttling uses an older in-memory limiter rather than the Redis-backed limiter
**Severity:** High

**Impact**
Mailbox flooding and authentication abuse can bypass throttling across multiple instances or restarts.

**Evidence**
- `src/app/api/auth/magic-link/route.ts:5`
- `src/app/api/auth/magic-link/route.ts:16-23`
- `src/lib/services/rate-limiter.service.ts:1-38`
- `src/lib/rate-limiter.ts:151-174`

**Details**
The magic-link endpoint imports `checkRateLimit` from the old in-memory service limiter instead of the Redis-backed async limiter. On multi-instance deployments, this greatly weakens abuse resistance.

**Recommended remediation**
- Switch auth throttling to the Redis-backed limiter.
- Rate-limit by normalized email, IP, and possibly user-agent fingerprint.
- Add operational monitoring for auth burst patterns.

---

## Medium findings

### M1. Trial-expiry cron appears misconfigured and may never authorize correctly
**Severity:** Medium

**Impact**
Expired trials and past-due companies may not be suspended on schedule, delaying enforcement and causing billing drift.

**Evidence**
- `render.yaml:106-108`
- `src/app/api/cron/trial-expiry/route.ts:14-18`

**Details**
The cron job sends `x-cron-key: $CRON_SECRET`, while the route validates against `process.env.CRON_KEY`. That mismatch can cause the route to reject legitimate cron executions.

**Recommended remediation**
- Standardize on one secret name and one header convention across all cron routes.
- Add an alert on cron authentication failures.

---

### M2. CORS allowlist uses prefix matching instead of exact origin matching
**Severity:** Medium

**Impact**
An attacker-controlled origin such as a lookalike superdomain may satisfy the allowlist check and receive permissive CORS headers.

**Evidence**
- `src/middleware.ts:5-18`

**Details**
`allowedOrigin` is selected with `origin.startsWith(o)`. This is weaker than exact origin matching and is prone to configuration mistakes.

**Recommended remediation**
- Parse and compare exact origins.
- Normalize scheme, host, and port before comparison.
- Keep credentials disabled unless strictly necessary.

---

### M3. Billing session endpoints lack explicit rate limiting
**Severity:** Medium

**Impact**
Authenticated users can spam Stripe checkout/portal session creation, increasing external API churn and operational noise.

**Evidence**
- `src/app/api/billing/checkout/route.ts:9-52`
- `src/app/api/billing/portal/route.ts:6-27`

**Recommended remediation**
- Add per-user and per-company rate limits.
- Add idempotency or short-lived session caching where appropriate.

---

### M4. Google OAuth callback accepts `verified_email` when missing/undefined
**Severity:** Medium

**Impact**
Identity assurance depends on provider response shape. If Google response semantics change or become partial, unverified identities may be accepted.

**Evidence**
- `src/app/api/auth/google/callback/route.ts:55-60`

**Details**
The code rejects only `verified_email === false`, not any non-true value.

**Recommended remediation**
- Require `verified_email === true` explicitly.
- Fail closed on missing verification state.

---

### M5. Night-shift health probes can create repeated urgent fix tasks during an outage
**Severity:** Medium

**Impact**
A prolonged outage can amplify queue noise and auto-remediation churn by repeatedly creating duplicate urgent tasks.

**Evidence**
- `src/lib/services/night-shift.service.ts:52-64`
- `src/lib/services/night-shift.service.ts:71-83`

**Recommended remediation**
- Add deduplication keyed by company + URL + failure class.
- Avoid creating another urgent task when one is already open/in-progress.

---

### M6. Dashboard server query uses broad `select()` calls and passes oversized data objects to the client
**Severity:** Medium

**Impact**
Even after fixing the ownership issue, the dashboard still overexposes internal fields and increases accidental client-side data leakage risk.

**Evidence**
- `src/app/(dashboard)/dashboard/[companyId]/page.tsx:17-21`
- `src/app/(dashboard)/dashboard/[companyId]/page.tsx:29-72`
- `src/app/(dashboard)/dashboard/[companyId]/page.tsx:90-99`

**Recommended remediation**
- Replace `select()` with explicit field projections.
- Use separate safe DTOs for server-to-client transfer.
- Paginate or trim large collections by default.

---

## Recommended fix order

### Immediate
1. Fix public SSE leaks (`C1`, `C2`).
2. Fix dashboard ownership and stop sending `neon_connection_string` to the client (`C3`, `C4`).
3. Block tenant control over billing-enforced execution states (`C5`).
4. Make task launch claim + charge atomic (`C6`).

### Next
5. Add tenant scoping to all infra tools (`C7`).
6. Remove raw tenant SQL against the platform DB (`C8`).
7. Redact secrets from model/tool logs and durable execution records (`C9`).
8. Add RLS to all tenant and auth-sensitive tables (`C10`).

### Hardening
9. Fail closed on missing credential encryption (`H1`).
10. Make all credit mutations atomic (`H2`, `H3`).
11. Replace ad-hoc public event emission with a strict public schema (`H4`).
12. Standardize on the Redis-backed auth rate limiter (`H5`).

---

## Closing note

This report is based on the code paths reviewed during this audit pass. The critical findings above are concrete and actionable, and several of them chain together into full cross-tenant compromise paths. The highest-priority remediation theme is to restore hard tenant boundaries at every layer: public APIs, server pages, agent tooling, secrets handling, billing state, and database policy.
