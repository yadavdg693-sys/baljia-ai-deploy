# Baljia AI Architecture Audit

Date: 2026-04-24
Repo: `C:\Users\Vaishnavi\My_Projects\baljia-ai-cf`

This file records two independent architecture passes over the folder:

- Pass 1: top-down system shape, module boundaries, and intended architecture.
- Pass 2: adversarial review of durability, scale, concurrency, security boundaries, and provider drift.

## What They Are Building

Baljia AI is an AI founder operating system. A user signs up, goes through onboarding, gets a company record, credits, market research, a roadmap, starter tasks, and a generated founder landing/app presence. AI workers then execute company tasks across engineering, research, browser, data, support, Twitter, ads, and outreach lanes.

The intended product architecture is:

- Platform control plane: Next.js app on Render, serving dashboard, API routes, auth, billing, onboarding, task queue views, and live event streams.
- Central state: Neon Postgres through Drizzle, with companies, tasks, executions, credits, events, sessions, roadmaps, artifacts, and runtime costs.
- Agent runtime: TypeScript services in `src/lib/agents` and `src/lib/services`, dispatching work by task tag and execution mode.
- Generated founder sites: `*.baljia.app`, with the current Cloudflare split-hosting direction using one wildcard Worker plus R2-backed HTML/assets.
- Billing and credits: Stripe webhook integration plus `credit_ledger` accounting.
- Realtime/user feedback: persisted `platform_events`, SSE polling, and optional Redis pub/sub.
- Provider integrations: OpenAI/Codex OAuth, Anthropic, Gemini, Tavily, Browserbase, Postmark, Stripe, Neon, Cloudflare, Render, GitHub, and Late.dev.

## Architecture Map Found In Repo

Core surfaces:

- `src/app/api`: API routes, auth, webhooks, cron endpoints, onboarding, tasks, live/events.
- `src/lib/services`: domain services for companies, tasks, credits, billing, onboarding, deployment, verification, recurring tasks, events, memory, governance, remediation.
- `src/lib/agents`: agent factory, worker launcher, tool routers, domain tool implementations.
- `src/lib/db/schema.ts`: central Drizzle schema for the platform database.
- `founder-app-worker`: Cloudflare Worker that serves founder apps from R2 by wildcard host.
- `docs/adr-002-split-hosting-strategy.md`: current strategic direction: platform on Render, founder apps on Cloudflare.
- `render.yaml`: production Render blueprint with one web service and six cron services.

High-level data/control flow:

```text
Founder
  -> Next.js API/dashboard on Render
  -> Auth/session/company/onboarding records in Neon
  -> Onboarding pipeline creates roadmap, tasks, landing page, credits, events
  -> Founder approves tasks or cron/night-shift runs tasks
  -> worker-launcher dispatches agent execution
  -> tools call provider APIs and write artifacts/reports/events
  -> verification marks task complete/failed
  -> engineering deploys founder landing/app to Cloudflare/R2
  -> founder/app visitors hit *.baljia.app Worker
```

## Pass 1: System Shape And Boundaries

### A1. The split-hosting direction is the right macro-architecture

`docs/adr-002-split-hosting-strategy.md` makes the right call for this product: keep the dashboard/control plane on Render and move generated founder apps to Cloudflare Workers/R2. The founder app workload is edge-cacheable, high-fanout, and cost-sensitive. The platform workload is stateful, integration-heavy, and still benefits from a Node server environment.

The implementation partially matches this:

- `founder-app-worker/src/index.ts` provides a wildcard Worker for `*.baljia.app`.
- `src/lib/services/cf-deploy.service.ts` writes generated HTML to R2 under `founder-apps/{subdomain}/index.html`.
- Engineering agent prompts and tools mention `cf_deploy_landing`, `cf_verify_founder_app`, and Cloudflare deployment paths.

Architecture verdict: strong direction, partially implemented.

### A2. The actual deployment topology does not match the long-running worker design

The docs say long-running agent execution should stay on a Render Background Worker, but `render.yaml` defines one `type: web` service plus cron callers only. There is no separate background worker service in the Render blueprint.

The code then launches long-running work in-process from request handlers:

- `src/app/api/tasks/[taskId]/approve/route.ts:70-74` calls `launchTask(taskId).catch(...)` after returning the HTTP response.
- `src/app/api/onboarding/route.ts:80-92` starts `runOnboardingPipeline(...)` as fire-and-forget.

This is the largest architecture mismatch in the repo. The app depends on the web process staying alive after a response and keeping long-running promises alive for minutes or hours. That is fragile under deploys, crashes, autoscaling, memory pressure, and request runtime limits.

Architecture verdict: P0/P1 reliability risk. Move agent/onboarding execution behind a durable job boundary.

### A3. The monolith is productive but has weak internal boundaries

The repo has a clear MVP-friendly monolith shape:

- Routes live under `src/app/api`.
- Business logic lives under `src/lib/services`.
- Agent runtime lives under `src/lib/agents`.
- DB schema is centralized under `src/lib/db/schema.ts`.

This is good for velocity. The weak point is that most layers import each other directly. Routes call services, services write DB/events directly, agents call services/tools directly, and deployment/provider concerns are available from the same process. There is no explicit boundary between:

- user-facing auth/login and platform operator credentials,
- task queue state and task execution ownership,
- generated founder app deployment and platform deployment,
- agent capability policy and tool implementation,
- billing/credit accounting and task lifecycle transitions.

Architecture verdict: acceptable for early product, but permission and failure boundaries need to become explicit before scale.

### A4. Agent runtime has useful invariants but they are mostly code-level

`src/lib/agents/worker-launcher.ts` contains good invariants:

- lifecycle checks before execution,
- suspended-account checks,
- credit/slot claiming through `creditService.claimSlotAndCharge`,
- execution mode dispatch,
- four-hour execution timeout,
- verification as the sole authority for task completion,
- circuit breaker logic for auto-remediation.

However, most of these invariants live in application code rather than durable infrastructure or DB constraints. If the process dies after a task is claimed, there is no durable worker lease/retry model to pick it up. `processQueue` also has `MAX_CONCURRENT = 1`, so concurrency is intentionally conservative, but it is not a full distributed queue.

Architecture verdict: good domain thinking, insufficient durable execution model.

### A5. Verification is not yet a strong deployment contract

`src/lib/services/verification.service.ts` is positioned as the final authority for task completion, which is a good architectural pattern. But the actual checks are too permissive for an AI agent platform:

- It falls back to `${company.subdomain}.baljia.com` at `verification.service.ts:170`, while the current founder app domain is `baljia.app`.
- It can record a `site_accessible` check without a real deployment URL in some paths.
- Several verification levels are heuristic checks over reports/artifacts rather than externally validated outcomes.

Architecture verdict: the verifier is the right place for quality gates, but it needs stricter contracts per task type.

### A6. Deployment documentation and code have drifted

There are two competing deployment stories:

- `docs/DEPLOYMENT.md` says wildcard `*.baljia.app` points at Render and middleware serves landing pages from the platform.
- `docs/cf-founder-app-runbook.md` and `docs/adr-002-split-hosting-strategy.md` say founder apps go through Cloudflare Worker + R2.
- `src/lib/services/landing-deploy.service.ts` supports Cloudflare when configured, with a Render fallback.

Fallbacks are useful, but this one changes the runtime shape of the product. Operators can configure the documented env vars and get a different architecture than the current ADR intends.

Architecture verdict: choose a canonical production path and mark fallbacks as explicit break-glass behavior.

### A7. Onboarding architecture is much better than the old monolith, but still in-process

The onboarding refactor in `src/lib/services/onboarding` is a healthy structure:

- `orchestrator.ts` does the CAS claim, context creation, strategy selection, watchdog, and top-level failure handling.
- Strategies model the three product journeys.
- Shared stage atoms keep common behavior reusable.
- `stage-runner.ts` emits activity/state events consistently.

The problem is runtime durability. Onboarding is still fire-and-forget from `src/app/api/onboarding/route.ts`, not a durable job. The watchdog is in-process and does not truly interrupt a stuck async operation. Cleanup cron can mark stuck runs failed later, but cannot resume safely.

Architecture verdict: good code organization, incomplete execution architecture.

### A8. Realtime events are persistent, but Redis/pubsub is not aligned

`src/lib/services/event.service.ts` persists events to Postgres and optionally publishes to Redis. The SSE route polls the DB every three seconds. This is simple and robust for MVP. But comments and service names imply Redis pub/sub, while `subscribeToEvents` is a placeholder and Redis may be disabled by env drift.

Architecture verdict: Postgres-polling SSE is acceptable for low volume, but the code/docs should describe that honestly and load-test DB polling before growth.

### A9. Agent prompts and tool capability policy are embedded in a large factory

`src/lib/agents/agent-factory.ts` contains hardcoded agent prompts, tool lists, tool routers, and permission sets. This keeps everything visible, but it makes capability review hard:

- prompts and permissions change in the same large file,
- provider/deployment assumptions can drift inside prompt text,
- auditability is lower than a versioned capability registry,
- it is harder to answer "which agent can call which dangerous tool?" without reading code.

Architecture verdict: okay for early development, but split prompts, tool policy, and handlers before adding more agents.

### A10. The database schema is broad and product-shaped, but idempotency is uneven

`src/lib/db/schema.ts` has useful uniqueness in places:

- unique users by email,
- unique company slugs,
- unique memory layer per company/layer,
- unique browser credentials per company/domain,
- unique credit ledger idempotency keys.

But important event/materialization paths lack first-class idempotency:

- Stripe webhook dedupe is performed through `platform_events.payload->>'stripe_event_id'`, not a dedicated unique table/constraint.
- Recurring task materialization updates `next_run_at` after creating tasks, with no atomic claim or unique materialization key.
- Long-running task execution ownership is not represented as a durable lease.

Architecture verdict: schema is rich, but the highest-risk workflows need DB-level uniqueness/claiming.

## Pass 2: Scale, Failure, And Abuse Review

### B1. Process death can strand tasks after credits are deducted

`creditService.claimSlotAndCharge` marks a task `in_progress` and inserts the credit debit before the agent run proceeds. If the web process dies after claim but before completion/failure, the task can remain `in_progress`, credits can be spent, and no durable worker resumes the execution.

This is the classic reason to use a job queue or worker lease:

- enqueue work durably,
- claim with a lease/heartbeat,
- execute in a worker process,
- reconcile expired leases,
- make credit mutation idempotent with the execution id.

Architecture verdict: highest reliability risk in the execution path.

### B2. Fire-and-forget onboarding can be lost or incorrectly cleaned up

`src/app/api/onboarding/route.ts` creates the company and credits, then starts the onboarding pipeline in the web process. If the process exits, the company may be left in `running` until cleanup marks it failed. Cleanup is useful, but it is not a retry/resume system.

The watchdog also has two important limitations:

- `src/lib/services/onboarding/stage-runner.ts` stores `watchdogTick` in module-global state, so concurrent onboarding runs in the same process can overwrite each other's watchdog hook.
- `src/lib/services/onboarding/watchdog.ts` records timeout state but cannot interrupt a currently stuck stage; it only surfaces at the next stage boundary or final check.

Architecture verdict: onboarding needs either durable staged jobs or a per-run state machine that can resume from the last successful stage.

### B3. Cron routes will become a bottleneck as company count grows

`src/app/api/cron/night-shift/route.ts` selects all eligible companies and runs `runNightShift(companyId)` sequentially. `src/app/api/cron/recurring/route.ts` does the same for recurring tasks.

This is fine for low volume, but as the company count grows:

- a single cron HTTP call can exceed provider/runtime time limits,
- one slow company delays every later company,
- retries repeat the entire scan,
- there is no per-company job fan-out, leasing, or backpressure.

Architecture verdict: replace all-company sequential cron loops with paginated/fan-out jobs before scale.

### B4. Recurring task materialization is race-prone

`src/lib/services/recurring.service.ts:71-103` selects due recurring tasks, creates a task, then updates `next_run_at`. Two cron invocations can both see the same due row and create duplicate tasks before either update lands.

Architecture verdict: use an atomic claim/update or a materialized occurrence table with a unique key like `(recurring_task_id, scheduled_for)`.

### B5. Stripe event handling is race-prone and mixed into the generic event stream

`src/app/api/webhooks/stripe/route.ts:23-25` checks `platform_events.payload->>'stripe_event_id'` before side effects, then records the webhook event after side effects. Two concurrent deliveries can both pass the check and both grant credits.

Architecture verdict: use a dedicated `processed_stripe_events` table with `stripe_event_id` as primary key, claim before side effects, and wrap credit mutation in the same transaction where possible.

### B6. Redis configuration drift disables persistent rate limiting and pub/sub

`src/lib/redis.ts:22-25` reads only `REDIS_URL`, but `render.yaml:35-37` and docs configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. That means rate limits and pub/sub can silently fall back to process memory or no-op behavior.

Architecture verdict: either use Upstash REST everywhere or configure a real Redis TCP URL. Do not silently accept memory-only rate limits in production.

### B7. Public API policy is too coarse

`src/middleware.ts:91-92` allows broad public prefixes like `/api/auth` and `/api/webhooks`. Some routes under those prefixes are legitimately public, but others have platform-level side effects.

The clearest example from the security audit is `/api/auth/codex`: it starts an OAuth flow and writes Codex credentials into the global platform credential store used before `OPENAI_API_KEY`.

Architecture verdict: replace broad prefix allowlists with a route manifest declaring auth mode, rate limit, side-effect class, and audit logging requirement.

### B8. Platform credential and user-login concerns are mixed

`src/app/api/auth/codex/route.ts` creates a user session from the Codex identity, while `src/lib/codex-oauth.ts` saves credentials to a global file. `src/lib/llm-provider.ts` prefers Codex OAuth credentials before `OPENAI_API_KEY`.

This mixes two different trust domains:

- user identity/login,
- platform-owned LLM credentials.

Architecture verdict: split these flows. User OAuth should create a user session. Platform LLM credential setup should be admin/internal-only and not reachable through the public auth surface.

### B9. Credit accounting has good primitives but not full transactional coverage

The `credit_ledger` has an idempotency unique index, and `claimSlotAndCharge` uses SQL CTEs to claim and debit. That is a good foundation.

Remaining gaps:

- rollback after insufficient balance is a separate update path,
- not every credit grant passes a stable idempotency key,
- Stripe grants are not claimed through a dedicated event table first,
- execution id is not the durable accounting unit.

Architecture verdict: make the execution id and external event ids the accounting anchors.

### B10. Generated founder app rollback/versioning is operationally thin

The Cloudflare/R2 Tier 1 model overwrites `founder-apps/{subdomain}/index.html`. The runbook notes that rollback is manual unless previous HTML is saved elsewhere.

For simple landing pages this is acceptable. For founder-facing production apps, it needs versioned artifacts:

- write immutable versions under `founder-apps/{subdomain}/versions/{deploymentId}/index.html`,
- update a small pointer/manifest atomically,
- keep last known-good version,
- record deployment id on task execution/artifact rows.

Architecture verdict: fine for Tier 1 landing MVP, not enough for Tier 2/3 apps.

### B11. Verification, artifacts, and deployment ids are not tied tightly enough

Task execution, reports, artifacts, deployment URLs, and verification checks exist, but the architecture does not consistently bind them into one auditable chain:

```text
task -> execution -> tool calls -> artifact/deployment id -> verifier evidence -> credit/cost ledger
```

Without that chain, it is hard to debug disputes like "credits were spent but nothing changed" or "agent says deployed but site is old."

Architecture verdict: introduce an execution ledger view or explicit correlation id used across logs, events, tool calls, artifacts, verification, and AI costs.

### B12. The Cloudflare migration boundary is correctly deferred, but code must respect it

The ADR correctly defers full platform migration to Cloudflare because of Node/Postgres/Redis/advisory-lock assumptions. The code still uses:

- Neon HTTP client for normal DB calls,
- Neon WebSocket pool for transactions and advisory locks,
- `pg_try_advisory_lock` in night shift,
- `ioredis` TCP-style Redis client,
- Sentry/AsyncLocalStorage patterns,
- long-running in-process tasks.

Architecture verdict: keep the platform on Render for now. If Cloudflare platform migration returns later, first abstract locking, queues, Redis, and long-running execution.

## Double-Audit Agreement

Both passes converge on the same conclusion:

The product architecture is coherent. The split between a Render-hosted control plane and Cloudflare-hosted generated founder apps is the right strategic shape. The repo has enough domain structure to keep building.

The weak point is execution durability. The system currently behaves like a queue-backed agent platform, but the implementation still runs long jobs as in-process promises inside the web service. That gap affects task execution, onboarding, cron processing, credits, verification, and incident recovery.

## Priority Fixes

### P0/P1: Create a durable execution boundary

Pick one production model:

- Render background worker with a Postgres-backed jobs table and leases,
- or a managed queue/workflow provider,
- or a self-hosted queue if the team accepts the ops cost.

Minimum contract:

- API routes enqueue durable jobs, never execute long work directly.
- Workers claim jobs with lease/heartbeat.
- Stuck leases are recoverable.
- Job id maps to task execution id.
- Credit debit is idempotent on execution id.
- Verification and final state transition happen once.

### P1: Make onboarding resumable or explicitly retryable

Move onboarding from fire-and-forget promise to durable staged execution.

Minimum contract:

- one row per onboarding run,
- one row or state field per stage,
- idempotent stage outputs,
- per-run watchdog state, not module-global state,
- cleanup can retry/resume, not only mark failed.

### P1: Align production deployment docs and config

Make one path canonical:

- platform: Render,
- founder Tier 1 apps: Cloudflare Worker + R2,
- founder Tier 2/3 apps: explicitly planned or disabled until ready.

Then update:

- `docs/DEPLOYMENT.md`,
- `docs/cf-founder-app-runbook.md`,
- Render env vars,
- Cloudflare env vars,
- verification domain fallback,
- agent prompt/tool assumptions.

### P1: Add DB-level idempotency to money and schedulers

Add:

- `processed_stripe_events(stripe_event_id primary key, processed_at, event_type)`,
- recurring occurrence uniqueness,
- execution lease/ownership fields,
- stable idempotency keys on every credit grant,
- unique active execution guard per task if only one active execution is allowed.

### P1: Fix Redis/rate-limit provider mismatch

Either:

- switch `src/lib/redis.ts` to use Upstash REST env vars already in docs/Render,
- or change docs/Render to provide `REDIS_URL`.

In production, missing Redis should fail closed for public abuse-sensitive flows, not silently degrade to memory-only limits.

### P1: Strengthen verification as the product contract

For engineering/deploy tasks:

- require a deployment URL or deployment artifact id,
- use `baljia.app` fallback, not `baljia.com`,
- record HTTP status, content hash, response snippet, and deployment id,
- fail tasks that cannot prove externally visible output.

### P1: Split credential authority from public auth

Separate:

- user login/session creation,
- admin platform credential provisioning,
- per-user external account credentials,
- platform LLM provider credentials.

`/api/auth/codex` should not be able to replace the primary platform LLM credential from an unauthenticated/public path.

### P2: Introduce route capability manifest

For each API route, define:

- public/authenticated/admin/internal/cron/webhook,
- rate-limit key and quota,
- side-effect class,
- required idempotency key if any,
- audit event type,
- expected max runtime.

This will prevent future mistakes caused by broad middleware prefixes.

### P2: Split agent capability registry from implementation

Keep tool handlers in code, but move prompt/tool policy into a small versioned registry:

- agent id,
- prompt version,
- allowed tools,
- dangerous tools,
- provider assumptions,
- rollout status.

This makes agent permission review much easier.

### P2: Add architecture-level tests

Add tests for:

- approve route enqueues only, does not execute in request,
- worker lease recovery,
- no duplicate recurring task occurrence under concurrent calls,
- no duplicate Stripe credit grant under concurrent webhook calls,
- verification fails when deploy URL is missing,
- Redis missing in production fails closed for abuse-sensitive endpoints,
- Codex credential route requires admin/internal auth.

## Immediate Risk Register

| Risk | Impact | Evidence | Priority |
|---|---|---|---|
| Long-running agent work runs inside web process | stuck tasks, lost work, credits spent without output | `approve/route.ts:70-74`, `render.yaml` has no worker | P0/P1 |
| Onboarding fire-and-forget | partial companies, failed onboarding after process exit | `onboarding/route.ts:80-92` | P1 |
| Global onboarding watchdog hook | concurrent runs can tick wrong watchdog | `stage-runner.ts`, `watchdog.ts:45` | P1 |
| Redis env drift | public abuse guards degrade to memory/no-op | `redis.ts:22-25`, `render.yaml:35-37` | P1 |
| Stripe dedupe after side effects | duplicate credit grants | `stripe/route.ts:23-25`, `stripe/route.ts:154-157` | P1 |
| Recurring task race | duplicate scheduled tasks | `recurring.service.ts:71-103` | P1 |
| Verification domain drift | false negatives/false positives for founder apps | `verification.service.ts:170` | P1 |
| Public auth route controls platform LLM credentials | platform credential takeover | `auth/codex/route.ts`, `llm-provider.ts:44-48` | P0 |
| Build currently blocked | cannot deploy production reliably | `storage.service.ts:142` from code audit | P1 |
| Tracked Cloudflare/Gemini secret | credential compromise | `cf-workflow-poc/wrangler.toml:13` from code audit | P0 |

## Final Assessment

Baljia is architecturally pointed in the right direction: a Render control plane, Neon system of record, Cloudflare-hosted generated founder surfaces, and agent workers coordinated through tasks, credits, events, and verification.

The architecture should now graduate from "monolith with background promises" to "monolith control plane plus durable worker runtime." That one change will make the rest of the system easier to reason about: credits become tied to executions, verification becomes an auditable finalizer, cron becomes job fan-out, onboarding becomes resumable, and incidents become recoverable instead of mysterious.
