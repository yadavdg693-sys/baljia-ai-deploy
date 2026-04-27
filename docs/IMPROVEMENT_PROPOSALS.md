# Baljia AI — Improvement Proposals

**Source of comparison:** `polsia_gold.txt` (6,975-line archived spec) vs current `baljia-ai-cf` code.
**Framing:** The spec is archived ("NOT actively followed" per `CLAUDE.md`). Each proposal below is only worth doing if it earns its keep against today's code — **don't implement blindly**. Treat this as a catalog of candidates for improvement, not a work order.
**Final destination:** Once approved, copy this doc to `baljia-ai-cf/docs/IMPROVEMENT_PROPOSALS.md` (plan mode currently restricts writes to this file).

---

## TL;DR

Baljia's platform scaffolding is strong (execution-mode dispatch, watchdog, ContextPacket/PermissionSnapshot, 4-lane billing, 8 live worker tools, stage-aware night shift) — the gaps are mostly in **founder-facing intelligence** (briefings, stage-aware dashboard, proactive CEO behavior), **trust & self-healing** (cross-company memory actually being written, known-issue registry closing the loop), and **guardrails that matter** (ad-spend approval, destructive SQL gate, autonomy gradient).

Three decisions block the most valuable work. Nothing below should start until they're settled.

---

## Three Decisions That Gate Everything

### D1. Remediation policy — auto-retry vs. founder review

- **Today:** `remediation.service.ts` auto-retries failed tasks up to 100 times per scope.
- **Spec:** Failed tasks sit in `failed` state; CEO proposes retry with modifications; never retry the exact same thing 3×.
- **Pick one:** If we keep 100-attempt auto-remediation, founder loses visibility into persistent failures and may hit credit cliffs silently. If we adopt the spec's 3-strike ladder, we ship more reliability at the cost of more founder interrupts. The middle path — cap at 3 auto-attempts, then surface CEO-proposed retry — is probably the right answer, but it's still a real decision.
- **Why it matters for Baljia:** Directly affects perceived reliability and credit burn. Founders who see tasks "work eventually" trust the platform; founders who see silent 100-attempt loops churn.

### D2. Stage model — 6 internal vs. 5 spec dashboard

- **Today:** `stage.service.ts` uses `early | validation | monetization | retention | scale | compounding` — tuned for night-shift focus prompts.
- **Spec:** Dashboard surfaces `empty | building | live | growing | stalled` with specific layouts per stage.
- **Pick one:** Map internal 6 → UI 5 via a helper (low cost, night shift unchanged), or align to spec 5 (cleaner mental model, but re-tuning night-shift objectives).
- **Why it matters for Baljia:** The dashboard is the product face. Stage-aware UI is how "we're building your MVP" becomes visible to founders on day one vs. day fourteen.

### D3. Hosting target — Render, Cloudflare, or split

- **Today:** Render is primary for the platform; `cf-deploy.service.ts` (22KB) deploys founder apps to CF Workers; `wrangler.toml` + `open-next.config.ts` are a CF migration spike.
- **Pick one:** (a) full CF cutover, (b) stay on Render and retire the CF spike files, (c) formalize split (CF for founder apps, Render for platform).
- **Why it matters for Baljia:** Influences ~6 items in this doc and months of migration work. Cost, cold-start latency, cron scheduling, and agent-execution model all flow from this.

---

## Improvement Areas

Each area below lists: **What** (the specific change), **Why** (current gap against spec), **How it makes Baljia better** (founder/product/business impact).

---

### 1. CEO / Governance — Make the Credit Quote Contract Real

- **What:** Rework `governance.service.ts` so every credit quote returns the full 5-field object: `credits_required`, `task_split`, `founder_safe_reason`, `included_scope`, `blockers`. Store on `approvalRecords` as JSONB.
- **Why:** Today governance only returns credits + execution_mode + verification_level. The other four spec fields don't exist in the code (grep confirmed zero matches). The CEO prompt is expected to invent "founder-safe reason" and "included scope" on the fly.
- **Better:**
  - **Founder trust:** Every credit charge comes with a consistent, reviewable rationale — not a paraphrase of the prompt. Disputes drop.
  - **Auditability:** Billing auditor can correlate spend to documented scope — crucial for refund decisions.
  - **Prompt stability:** CEO no longer has to improvise under pressure; it just reads fields.

### 2. CEO / Governance — Structured 10-Step Decision Pipeline

- **What:** Extract the 10-step CEO flow from prompt text into a typed pipeline (`src/lib/agents/ceo/decision-pipeline.ts`). Each step returns a typed object; LLM handles only the natural-language framing at step 9 (brief).
- **Why:** Today the 10 rules live inside `ceo.prompt.ts` lines 28-83. An LLM can skip, reorder, or conflate steps. There is no observability of which step fired — you can't tell why the CEO routed to a wrong agent.
- **Better:**
  - **Debuggable founder experience:** When CEO misroutes, logs show which step went sideways.
  - **A/B-testable:** Swap step 4 (credit check) implementations behind a flag without touching the mega-prompt.
  - **Regression-proof:** Adding a new tool doesn't risk corrupting the decision flow.

### 3. Memory — Cross-Company Learning Actually Gets Written

- **What:** Build `cross-company-curator.service.ts` as a weekly cron. Scans `learnings` across all companies, clusters by tag via Haiku, rewrites generic form, runs a scrubber (rejects if URL / company name / personal data / credential), writes to platform-wide Layer 3.
- **Why:** Today `memory.service.ts` has read paths for Layer 3 (lines 400-406, 571) but **zero write paths**. Layer 3 stays empty forever. Every company re-learns that "Neon cold starts need retry logic" or "Tailwind CDN fails with strict CSP."
- **Better:**
  - **Compounding product quality:** Every company benefits from every other company's lessons. This is Baljia's central moat.
  - **Faster first-task success:** New founders inherit gotchas at signup instead of failing them.
  - **Lower support load:** Issues clustered across companies become platform-level fixes, not per-founder firefights.

### 4. Memory — Learnings Search API for Workers

- **What:** Add `POST /api/learnings/search` with filters `{category, confidence, tags}`. Mount on Engineering/Research MCP so workers can query mid-execution.
- **Why:** `extractLearnings()` writes learnings; workers currently can't query them during a run. They get injected at start only.
- **Better:**
  - **Smarter agents mid-task:** When Engineering hits a novel error in phase 4 (DEPLOY), it can query "have I seen this failure signature before?" instead of rediscovering.
  - **Shorter task execution:** Fewer wasted turns — directly reduces runtime AI costs (platform lane).

### 5. Platform Ops — Close the Self-Healing Loop

- **What:** Build `known-issue-registry.service.ts` (currently just a table) + `regression-guard.service.ts` (extracted from scattered logic in `failure.service.ts:71`). Wire failure_fingerprinter → registry clusters (≥3 occurrences) → fix tracking → regression guard (new fingerprint matches resolved known_issue → alert).
- **Why:** The self-healing loop is `detect → cluster → fix → verify → prevent recurrence`. Today only detect + fingerprint exist. Clusters never form, fixes aren't tracked, regressions aren't caught.
- **Better:**
  - **Platform reliability compounds:** Same bug never costs the team twice.
  - **CEO gets pre-scope warnings:** Before creating a task, CEO checks registry and can warn founder ("this type of task has a known issue — here's the workaround").
  - **Product improvement becomes data-driven:** Fix prioritization by cluster size, not by who complained loudest.

### 6. Platform Ops — Finish the Missing Hidden Agents

- **What:** Implement the 5 missing platform-ops agents as distinct services:
  - `platform-support-triage.service.ts` — classifies `platformFeedback` into bug/feature/billing/abuse/incident via Haiku
  - `bug-reproducer.service.ts` — assembles log bundles + replay harness from `task_execution_id`
  - `prompt-policy-improver` — shadow-test prompt changes against 10 historical tasks before canary
  - `routing-analyst.service.ts` — weekly accuracy metric on routing decisions
  - Complete `infra-watchdog.service.ts` coverage (queue backlog / stuck runs / browser leaks / heartbeats)
- **Why:** Spec lists 9 hidden agents. Currently 4 are live (failure_fingerprinter, billing_credit_auditor, partial infra_watchdog, partial regression). The other 5 are stubs in `platform-ops-stubs.service.ts`.
- **Better:**
  - **Founder feedback doesn't pile up:** Triage routes it automatically.
  - **Prompt changes ship without drama:** Shadow harness catches regressions before canary.
  - **Routing gets smarter over time:** Misrouted tags get re-weighted.

### 7. Rate Limiting — 6-Step Escalation Ladder

- **What:** Replace current blunt rate-limit blocking with a 6-state ladder: `observe → soft-limit → degrade → cooldown → flag → suspend`. Track `escalation_state` per company+resource; transitions driven by consecutive-breach counters.
- **Why:** `rate-limiter.service.ts` today is a sliding window that allows or blocks. Abuse cases fall off a cliff. Well-intentioned heavy users hit hard walls without warning.
- **Better:**
  - **Fewer support tickets:** Founders get warned before being blocked.
  - **Abuse detection gets teeth:** Escalation to `flag`/`suspend` is automatic, not a manual review.
  - **CEO can explain:** "You're in soft-limit because X — here's what to do" vs. opaque 429s.

### 8. Daily Cycle — Briefing System (Retention Mechanism)

- **What:** Build `daily-cycle.service.ts` implementing all 5 phases (OBSERVE → ASSESS → DECIDE → EXECUTE → REPORT) and `briefing.service.ts` that always delivers a briefing (even "all clear") via email + dashboard card.
- **Why:** Today night-shift covers EXECUTE only. There's no OBSERVE → ASSESS → DECIDE → REPORT wrapper and no daily founder-facing briefing.
- **Better:**
  - **Retention:** The briefing is *the* product surface for founders who aren't logged in daily. Spec calls it "retention mechanism" — without it, autonomous mode is invisible, which means founders don't feel they're getting value.
  - **Proposal throughput:** Briefings carry proposals needing approval. Approved proposals = more tasks = more credits consumed = more expansion revenue.
  - **Trust signal:** "All clear" messages build trust that nothing silent is going wrong.

### 9. Daily Cycle — Priority Ladder Enforcement

- **What:** `pickNextAction(companyState)` walks the global ladder in order: FIRES → BLOCKERS → QUEUE → MAINTENANCE → GROWTH → NOTHING. Only falls through on each level's emptiness.
- **Why:** Night-shift picks by stage-focused gap analysis but doesn't globally prioritize fires first. A burning production issue can wait behind a "write a blog post" task.
- **Better:**
  - **Reliability outranks growth:** Broken apps get fixed before marketing gets written.
  - **Credits spent where they matter:** Expensive autonomous cycles prioritize founder-impactful work.

### 10. Autonomy Gradient — Levels 0 → 3

- **What:** Add `companies.autonomy_level int` (0-3). Implement graduation service: 3 successful manual tasks → L1 (observe), 5 accepted proposals → L2 (execute queue + propose), 20 tasks + 90% success → L3 (full, no money spend) opt-in. Gate daily-cycle actions on level.
- **Why:** Every company gets the same autonomy today. Brand-new founders get the same "I executed 3 tasks overnight" treatment as seasoned ones who've shown they trust the agents.
- **Better:**
  - **Trust is earned, not assumed:** New founders aren't surprised by overnight activity.
  - **Gradual surface-area expansion:** Matches Baljia's positioning ("AI Angel runs your company while you enjoy life") by actually delivering on it for proven-trust companies.
  - **Reduces panic-cancel churn:** Common churn driver is "the AI did something I didn't want" — autonomy gradient prevents that in month 1.

### 11. Autonomy — Auto-Pause After Inactivity

- **What:** `inactivity-watcher.cron.ts` scans `companies.last_founder_action_at`; at 14 days sets `autonomy_level=0` and sends a final "I've paused — pick up where you left off" briefing.
- **Why:** Stale companies keep burning night-shift quota and sending briefings into dead inboxes. Spec explicitly calls this out.
- **Better:**
  - **Cost control:** Inactive companies stop consuming LLM tokens.
  - **Reactivation trigger:** The "I've paused" briefing is a known retention moment — it prompts lapsed founders to come back.
  - **Trust:** Founders returning weeks later don't find bizarre autonomous activity.

### 12. Billing — Ad-Budget Autonomous Gate

- **What:** Add `governance.checkAdBudgetChange()` gate in front of every MetaAds budget-modification tool call. Require `approvalRecords` entry unless founder-initiated.
- **Why:** Spec explicitly says "NEVER do autonomously: change ad budget." Current MetaAds tools presumably honor this by convention but there's no code gate.
- **Better:**
  - **Runaway-spend prevention:** One buggy night shift can't 10× a founder's ad budget.
  - **Trust:** Founders know money never moves without them. This is Baljia's *single most important* trust guarantee.

### 13. Billing — Resolve Trial Credit Ambiguity

- **What:** Pick one: 10 credits, or 15 (5 base + 10 welcome). Update `onboarding.service.ts seedCredits()`. Update `decide-later.md`.
- **Why:** CLAUDE.md documents the ambiguity is unresolved. Current code defaults to 10 "until clarified."
- **Better:**
  - **Founder expectations match reality:** No surprise "I thought I had 15 credits."
  - **Marketing alignment:** Landing page and billing speak the same language.
  - **Support clarity:** One source of truth.

### 14. Billing — Referral Program

- **What:** Build `referral.service.ts`: URL param `?ref=CODE`, triggers on `checkout.session.completed`, grants 25 credits to referrer + 10 to referee.
- **Why:** `referrals` table exists but service logic is unverified/missing. Spec's growth strategy relies on this.
- **Better:**
  - **Expansion revenue:** Referred subscribers have month-1 revenue that covers platform costs.
  - **Founder loyalty:** Credit-based reward is more motivating than cash for Baljia users (they already value credits).

### 15. Data / Safety — Destructive SQL Gate

- **What:** Add SQL parser in `data.tools.ts` that rejects DROP/TRUNCATE/ALTER DROP unless `task.authorized_destructive=true`. Add `authorized_destructive boolean` on tasks.
- **Why:** Spec: "DROP TABLE/TRUNCATE/ALTER DROP blocked unless task explicitly authorizes." No gate today.
- **Better:**
  - **Data preservation:** Agent typo never wipes a founder's users table.
  - **Trust:** "The AI can't accidentally delete my data" is a table-stakes guarantee.

### 16. Credentials Audit

- **What:** Sweep all tool handlers. Ensure no API key, connection string, or token ever flows through agent-visible params. All secrets read from `process.env` inside the handler. Add test asserting zero `DATABASE_URL`/`API_KEY`/`TOKEN` substrings in error strings.
- **Why:** Spec calls credential isolation an absolute rule. Current code likely compliant but no enforcement test.
- **Better:**
  - **Breach prevention:** Prompt-injection can't extract credentials if the agent never sees them.
  - **Compliance posture:** Concrete test evidence for future SOC 2 / ISO prep.

### 17. Dashboard — Stage-Aware Layout

- **What:** Build `<StageAwareDashboard>` switching between layouts per stage (EMPTY → orientation + buttons; BUILDING → task progress; LIVE → health; GROWING → revenue; STALLED → resume). Pair with `<HealthIndicator>` (GREEN/YELLOW/RED) for LIVE/GROWING.
- **Why:** Dashboard currently shows all widgets regardless of state. Founders in EMPTY stage see empty revenue charts. Founders in GROWING don't see elevated-error warnings.
- **Better:**
  - **Founder activation:** Day-one founder sees "run first task" front and center — not an intimidating full dashboard.
  - **Operational awareness:** LIVE founders see health status at a glance; they act on YELLOW before it becomes RED.
  - **Aesthetic / trust:** Dead UI signals "this isn't built yet." Stage-aware signals "this product understands where I am."

### 18. Task System — Dependency Graph (`depends_on`)

- **What:** Add `tasks.depends_on uuid[]`. Worker-launcher refuses to `claimSlot` while any dep is incomplete.
- **Why:** Spec describes dependency chains (Research → Engineering). Current model has no formal dependency; sequence is implicit via queue order.
- **Better:**
  - **Correct outcomes:** Engineering task can't start before its research dependency finishes.
  - **Night-shift intelligence:** Can automatically pick the next dep-unblocked task instead of blocked ones.

### 19. Task System — Fallback-Scope Enforcement

- **What:** Track `current_phase` on `task_executions`. When watchdog detects "BUILD phase >70% budget," inject fallback-scope instructions automatically.
- **Why:** Spec mandates fallback scope on every engineering task. Code has the field but no runtime enforcement. Agents ship half-broken full features instead of switching.
- **Better:**
  - **More shipping, less failing:** "Working thin version" > "broken ambitious version." Directly improves first-10-tasks success rate (the critical retention band).
  - **Better credit economics:** Fewer fail+retry cycles.

### 20. Night Shift — Trust-Recovery Priority Ordering

- **What:** Audit `night-shift.pickNextAction()` to enforce the ordering broken work → credit issues → repair → regression → roadmap. Add test.
- **Why:** Stage objectives exist; ordering within each stage is ambiguous. Could pick "write blog post" while a previous build is broken.
- **Better:**
  - **Trust is protected:** Broken things get fixed before new things get built.
  - **Founder returns to a working product:** The central promise of night shift.

### 21. Verification — Worker Cannot Mark Itself Completed

- **What:** Grep `tools/*.tools.ts` for any direct `status: 'completed'` writes by workers; ensure only `verification.service.ts` sets final status.
- **Why:** Spec invariant: "Worker is never the final authority on completion." Need a test to guarantee it.
- **Better:**
  - **Quality:** Tasks that *look* done but aren't never slip through.
  - **Trust:** Verifier is the honest broker; agents can't lie their way to "done."

### 22. Monitoring — 3-Layer Dashboards (Infra / Execution / Business)

- **What:** Three dashboards: infrastructure (API latency, DB health, queue health), execution (task success rate, timeout rate, exec time distribution), business (MRR, churn, onboarding conversion). Can use Sentry + a simple internal page.
- **Why:** Spec defines the 3 layers; today only error tracking (Sentry) exists.
- **Better:**
  - **Incident response:** "Is the platform degraded?" answerable in 30 seconds.
  - **Product decisions:** Business dashboard shows where founders drop off; drives roadmap.
  - **Founder-facing metrics:** Can feed public status page later.

### 23. Release Model — Feature Flags + Canary

- **What:** Add a simple flags table `feature_flags (company_id, flag, enabled_at)`. Use for CEO prompt changes, new governance rules, stage-aware dashboard rollout. Ship to 5% of companies for 24-48 hours before 100%.
- **Why:** No flag system in repo. Prompt changes go global immediately — no way to canary.
- **Better:**
  - **Safer rollouts:** A bad prompt change hits 5% of companies, not 100%.
  - **Per-company experiments:** Can test UX hypotheses with willing founders.

### 24. Knowledge — Context Graph as Live Subsystem

- **What:** Add `context_graph` Redis hash per company (nodes: `revenue`, `active_work`, `support_history`, `feature:{name}`, `user_context`). Hydrated via `event.service.ts` dual-write on task/payment/error events. CEO reads in a single hit.
- **Why:** CEO today joins multiple tables ad-hoc to build context. No live subsystem that reflects real-time state.
- **Better:**
  - **Faster chat:** Single Redis hit vs. 5 SQL queries per CEO turn.
  - **More accurate context:** Real-time state, not stale cached summaries.

### 25. Onboarding — First-10-Tasks Success-Rate Alert

- **What:** Track per-company success rate on the first 10 tasks. Surface to infra-watchdog; alert if rolling-50-company first-10 success drops below 85%.
- **Why:** Spec: first 15 tasks are critical to expansion revenue; 85% success on first 10 is the spec health threshold.
- **Better:**
  - **Expansion revenue protection:** Detects onboarding-task-template decay before it kills LTV.
  - **Early signal of agent regression:** If the Engineering agent gets worse, you see it on first-task success before it's apparent elsewhere.

---

## Agents — Targeted Improvements (Subsection)

These are agents-section gaps from the spec, verified against `src/lib/agents/` code. Listed as a subsection because they cluster around the agent execution path rather than spanning the whole platform.

### Agent-A. Tool-Mount Audit — Browser / Twitter / ColdOutreach

- **What:** Audit `browser.tools.ts`, `twitter.tools.ts`, `outreach.tools.ts`. Spec expects Browser=25 tools (9 browserbase + 11 browser_auth + 5 company_email), Twitter=5 (2 twitter + 3 documents), ColdOutreach=10 (5 email + 2 hunter + 3 documents). Code currently has 18 / 4 / 8.
- **Why:** Grep counted tool defs per file. Browser is short by 7 (likely missing `browser_auth` bundle). Twitter and ColdOutreach are likely missing the `documents` mount per CLAUDE.md gotcha.
- **Better:** Browser agent can authenticate into founder accounts (Twitter, LinkedIn, etc.) without manual OAuth setup. Twitter and ColdOutreach can read brand voice + product docs, so output stops sounding generic.
- **Priority:** P1.

### Agent-B. Six-Phase Execution Tracking

- **What:** Add `current_phase` column on `task_executions` (`orient | plan | build | deploy | verify | complete`). Engineering tool emits `phase_transition` events. Watchdog reads phase + % budget; when BUILD phase >70% budget used, injects fallback-scope nudge.
- **Why:** Zero `ORIENT|PLAN|BUILD|DEPLOY|VERIFY` matches in `engineering.tools.ts`. Phases only exist in CEO prompt as advisory.
- **Better:** Unlocks fallback-scope enforcement (item 19). Watchdog can detect "stuck in BUILD" vs "stuck in DEPLOY" — different remediation responses. Time-budget allocation per phase becomes measurable.
- **Priority:** P1.

### Agent-C. `list_instances` Tool

- **What:** Add `list_instances` tool to Engineering mount returning `{ app_name, repo_url, deploy_url, stack, last_task_id }` for every founder app deployed under the company. Engineering prompt requires calling it on every non-first engineering task.
- **Why:** Spec ORIENT step 2 is `list_instances`. Zero matches in `engineering.tools.ts`. Without it, agents can rebuild apps that already exist or add features to wrong repos.
- **Better:** Existing apps get extended, not duplicated. Pairs with Item 37 (existing-app protocol) to lock in codebase consistency.
- **Priority:** P1.

### Agent-D. Extend `learnings` — Trigger + Pruning

- **What:** Additive migration on `learnings` table: add `trigger text` and `deprecated_reason text`. Add `pruneStaleLearnings(companyId)` weekly job that marks `deprecated` where `last_referenced_at < now() - 30 days` AND `usage_count = 0`. When `save_learning` is called with same trigger as an existing learning, mark old as `deprecated` and link via `supersedes`.
- **Why:** Spec's skills model has explicit deprecation lifecycle. Current `learnings` table has `usage_count` and `last_referenced_at` but no pruning or deprecation logic.
- **Better:** Skills don't accumulate as tech debt. Old advice that no longer applies stops misleading agents. Compounding learning gets sharper, not noisier.
- **Priority:** P2.

### Agent-E. Formalize Override Hierarchy in `agent-factory.ts`

- **What:** Refactor prompt assembly into `assemblePrompt(layers: PromptLayer[])` with typed layers rendered in documented priority order with section markers (`[TASK]`, `[PREFS]`, `[SKILLS]`, `[L1]`, `[L3]`, `[SYSTEM]`). No LLM change; purely structural.
- **Why:** `agent-factory.ts` is 1920 lines with ad-hoc prompt composition. When task description contradicts L2 preference, behavior depends on assembly order — invisible coupling.
- **Better:** Debuggable when CEO behavior shifts after a prompt edit. New developers can reason about override behavior without reading 1920 lines.
- **Priority:** P2.

### Agent-F. Back `find_best_agent` With Historical Query

- **What:** Verify (5min code read) whether the existing `find_best_agent` in `ceo.tool-handlers.ts` queries `task_executions` for historical success rate. If LLM-only, replace with `SELECT agent_id, COUNT(*) FILTER (WHERE status='completed') / COUNT(*) AS success_rate FROM task_executions WHERE task.tag = $1 GROUP BY agent_id ORDER BY success_rate DESC`. Return ranked list with confidence + warnings.
- **Why:** Spec describes data-driven routing. Current implementation may be prompt-judgment only.
- **Better:** Routing accuracy improves over time as data accumulates. Misroutes detectable via routing-analyst (item 6).
- **Priority:** P2.

### Agent-G. Deployment 3-Retry Cap

- **What:** Add `deploy_attempt_count` to run state; Engineering's `push_to_prod` tool increments and hard-fails at 3 with structured failure reason.
- **Why:** Spec: "Max 3 retry cycles. After 3 failures, call fail_task." Today watchdog catches the worst case via turn budget but no specific deploy-loop guard.
- **Better:** Faster failure when a deploy is fundamentally broken (env var, port, etc.). Less wasted compute on doomed retries.
- **Priority:** P2.

### Agent-H. Auto-Inject Prior Build Report for Bug Tasks

- **What:** When `task.task_type === 'bug'` and `related_task_ids.length > 0`, agent-factory auto-injects the prior task's report into ContextPacket as `[PRIOR_BUILD_REPORT]` section.
- **Why:** Spec: "Bug tasks must read the previous task's completion summary + report FIRST." No enforcement today; bug agents may rewrite the whole app to fix a typo.
- **Better:** Bug fixes target the right code path. Regressions drop. Engineering credit cost per bug fix drops because agents stop re-exploring.
- **Priority:** P1.

---

## 26. OAuth Token Refresh + "Needs Reconnection" State

- **What:** Add `oauth-refresh.cron.ts` + `oauth_connections.refresh_status` enum (`active | refreshing | needs_reconnection`). Tasks depending on a `needs_reconnection` connector move to `blocked` status with a clear founder-facing reason.
- **Why:** Grep for `oauth.*refresh|refreshToken|needs_reconnection` returns only `codex-oauth.ts` (developer auth). Zero coverage for founder-facing OAuth (Twitter, Gmail, Meta).
- **Better:**
  - **Founder clarity:** Tasks fail with "Twitter needs reconnection" not "401 Unauthorized." Founder knows exactly what to fix.
  - **Credit preservation:** Night-shift cycles don't burn credits on tasks that can't possibly succeed.

## 27. Recurring Tasks — Auto-Pause After 3 Consecutive Failures

- **What:** Add `recurring_tasks.consecutive_failures int` + `paused_reason text`. After 3 consecutive failed instances, auto-pause + emit founder notification.
- **Why:** Grep `recurring.service.ts` for `consecutive_fail|fail_count|auto_pause` → zero matches. A broken weekly task fires forever, charging 1 credit each time.
- **Better:**
  - **Cost containment:** Founder doesn't bleed credits on a recurring task that can't succeed.
  - **Early signal:** Broken automations surface before they become silent money leaks.

## 28. Briefing / Daily-Cycle Timing Per Founder Timezone

- **What:** Use existing `companies.timezone` (schema line 57) and `users.timezone` (line 23). Replace fixed-UTC crons (`render.yaml` lines 145, 183, 221) with hourly dispatcher that filters companies due in their local 6am.
- **Why:** Schema fields already exist but daily cycles fire at 2am UTC = 7pm PT, 3am EST, etc. Briefings hit dead inboxes for half the user base.
- **Better:**
  - **Briefing read-rate:** Hits founder's morning inbox, not 3am. Spec target: >70% read-rate is unachievable without this.
  - **Cycle relevance:** Founders see overnight progress when they wake up — the central daily-cycle promise.

## 29. Task Quality Gate at Creation (6-Section Engineering Template)

- **What:** Enforce structured fields on engineering-tagged tasks: `core_flow`, `key_features` (≤5), `tech_guidance`, `success_criteria` (≥3), `out_of_scope` (≥3), `fallback_scope`. Gate via Zod in `task.service.createTask`. CEO's task-proposal flow generates these 6 sections; manual founder tasks get a wizard. `tech_guidance` honors stack-selection hierarchy (tech notes > task description > defaults).
- **Why:** Grep for these field names in entire `src/`: zero matches. Today's tasks are free-form text. Per spec: "Bad tasks waste credits and founder trust."
- **Better:**
  - **First-task success:** Agents have clearer briefs → higher pass rate on the critical first 10 tasks.
  - **Scope discipline:** Explicit `out_of_scope` prevents agents from "being helpful" by adding unrequested features.
  - **Fallback enforcement:** Item 19 (fallback-scope trigger) needs this field to exist before it can fire.

## 30. Five Core Documents — Empty-Slot Detection + Just-In-Time Prompting

- **What:** Add `document-freshness.service.ts`. When CEO is about to create a task whose agent depends on an empty doc (e.g., content task with empty brand voice, engineering task with empty tech notes), CEO prompts founder to fill the doc first instead of generating generic output.
- **Why:** Spec calls this out as a major lever ("empty document problem"). Documents schema exists but no service detects gaps mid-conversation.
- **Better:**
  - **Output quality:** Brand-voice doc filled → marketing content stops sounding AI-generic.
  - **Context efficiency:** Tech-notes auto-populated after first engineering task → second task doesn't re-explore the codebase.
  - **Founder activation:** Forces useful conversation about positioning instead of letting empty docs silently degrade results.

## 31. Stale-Knowledge Auditor (Tech Notes Drift)

- **What:** Weekly cron audits `documents` (especially tech_notes) against recent task completions. If tech_notes haven't been updated since N significant build tasks, surface to CEO as a proactive update suggestion.
- **Why:** Spec calls tech_notes "MOST vulnerable to staleness." No freshness signal today.
- **Better:**
  - **Build accuracy:** Engineering on task #50 reads accurate tech_notes, not a description of the stack from task #20.
  - **Reduced exploration:** Less wasted ORIENT-phase time.

## 32. "NEVER Autonomously" Enforcement — Broader Than Just Ad Budget

- **What:** Extend item 12's `governance.checkAdBudgetChange()` into a broader gate: `governance.checkAutonomousAction(action, context)`. Covers ad-budget changes, sending cold outreach, deleting/rejecting tasks, reordering queue, posting unreviewed content, ignoring RED status. Daily-cycle and night-shift only invoke `autonomous_safe=true` operations.
- **Why:** Spec lists ~9 actions never to do autonomously. Item 12 only covers ad budget. Cold outreach autoposting is the highest-risk gap (spam complaints, domain reputation).
- **Better:**
  - **Trust:** Founder trust is binary. One autonomous spam-burst destroys it.
  - **Reputation safety:** Email/social domain reputation can't be recovered after autonomous misuse.

## 33. Health-Metric Thresholds + Alerting

- **What:** Codify spec's HEALTHY/DEGRADED/UNHEALTHY thresholds (success rate, error rate, queue depth, exec time, timeout %) in `infra-watchdog.service.ts`. Cross any DEGRADED line → emit `platform_degraded` event. UNHEALTHY → page on-call (Postmark email is fine for now).
- **Why:** Sentry covers errors but no aggregated platform health signal. "Is the platform OK?" requires manual querying today.
- **Better:**
  - **Faster incident response:** Detect platform-wide regressions in hours not days.
  - **Lower support load:** Issues fixed before founders hit them.

## 34. Pricing-Tier Audit ($49 / $19 / $29)

- **What:** Audit `billing.service.ts` + Stripe products. Confirm $49 Full Autonomy (5 credits + 10 welcome + cycles), $19 Hosting (5 credits, no cycles), $29 Legacy (pre-Jan 2026). Document any discrepancy.
- **Why:** Spec defines exact tiers; no verification today that Stripe products match.
- **Better:**
  - **Consistency:** Marketing, billing, product all reference same prices.
  - **Support quality:** Eliminates "page said X, charged Y" disputes.

## 35. Mascot 7-State Event Wiring Verification

- **What:** Audit `mascot.service.ts`. Confirm all 7 states (`listening, planning, running, investigating, blocked, resolved, growth_mode`) have at least one platform event triggering them.
- **Why:** Spec says mascot is "driven by real platform events." Easy to assume; needs verification.
- **Better:**
  - **Brand vitality:** Mascot is the central character. Stuck states = product feels broken.
  - **Founder feedback signal:** A correctly-cycling mascot signals "platform is alive and working."

## 36. Queue Failure Mode Timing Audit

- **What:** Audit `worker-launcher.ts` + `lease-reclaim` cron (every 5min per `render.yaml` line 243) against spec timings: 5min "agent never started" timeout (refund credit), 30min "agent crashed mid-execution" timeout (no refund). Confirm credit refund logic matches spec.
- **Why:** Lease reclaim exists but spec credit-refund semantics on each timeout class need verification.
- **Better:**
  - **Charge accuracy:** Founders aren't charged for tasks that never ran.
  - **Dispute reduction:** Clear refund rules end "I was charged but nothing happened" tickets.

## 37. Existing-App Protocol — "Read Existing Code First"

- **What:** When `list_instances` (Agent-C) returns a non-empty list, agent-factory injects `[EXISTING_APPS]` section into ContextPacket with each app's stack/repo/last-task summary. Engineering prompt updated to require reading existing app before proposing changes.
- **Why:** Spec explicit: "If list_instances shows existing app: READ existing code FIRST. Match existing style, frameworks, conventions." No enforcement today; agent may introduce a new framework into a 50-task-old codebase.
- **Better:**
  - **Codebase consistency:** Tech debt doesn't accumulate from random framework swaps.
  - **Agent maturity:** Lowers task #50+ failure rate where deep institutional knowledge matters.

---

## Items Deliberately Skipped (with reasons)

These spec points were considered and intentionally left out — documented so future readers know they were evaluated, not forgotten.

| Spec point | Reason for skipping |
|---|---|
| 7 feedback loops as discrete subsystems | Loops 1-3 (skills, prefs, queue intel) are already implicit in `learnings` + `chat.service` + queue. Loops 4-7 are aspirational ops processes. |
| Skill 11-category strict taxonomy | The 11 categories are advisory; current open-ended `learnings.category` is more flexible. |
| Code standards SAST scan on generated apps | Real but lower-leverage than item 16. Defer to post-GA. |
| Prompt-injection adversarial test corpus | `content-safety.ts` exists. 2-week project to build corpus; revisit after first real incident. |
| Incident severity ladder + breach notification | Single-team-size project. Add when team > 5 or after first compliance audit. |
| Reliability priority stack as a doc | Add to `CLAUDE.md` as a one-paragraph principle, not a tracked engineering item. |
| AARRR diagnosis tooling | CEO already does this conversationally. |
| Metric interpretation layer (separate from item 17) | Folds into stage-aware dashboard work. |
| Dog-fooding (Polsia uses Polsia) | Aspirational. Belongs on founder roadmap. |
| Cost structure / unit economics targets | Business metrics, not engineering work. |
| Scaling 10X/100X plans (sharding, multi-region) | Premature. Revisit at 1k companies. |
| Mission generator "approximate parity" check | Already implemented; spec point is advisory. |
| OBSERVE checklist as a separate item | Folds into item 8 (daily cycle). |
| Conversion funnel as a system | Item 22 covers data layer; CEO covers recommendation layer. |
| Stack selection hierarchy as standalone item | Folded into item 29 — `tech_guidance` field captures this. |
| Code injection acknowledgment as a doc | Add to `CLAUDE.md` security section, not a tracked item. |

---

## Priority Suggestion (Not a Script)

If you had to pick a batching order — but **don't follow blindly, evaluate each item against current code first**:

**Batch 1 — Trust & Self-Healing (~6 weeks):**
Items 1, 3, 5, 12, 15, 16, 21, **27** (recurring auto-pause), **29** (task quality gate), **32** (broader autonomous gate), **Agent-H** (bug task prior-report).
Delivers the "never embarrasses the founder" foundation: credit transparency, cross-company learning, closed self-healing loop, ad-spend + autonomous-action guardrails, credential safety, destructive-SQL gate, verifier authority, no recurring credit-bleed, structured tasks, bug-fix accuracy.

**Batch 2 — Founder Retention (~6 weeks):**
Items 8, 9, 10, 11, 13, 17, 25, **26** (OAuth refresh), **28** (timezone briefings), **30** (empty doc detection).
Delivers the daily-product surface: briefings (in founder's timezone), priority ladder, autonomy gradient, inactivity pause, trial-credit clarity, stage-aware dashboard, first-task health signal, OAuth recovery, document-quality prompts.

**Batch 3 — Platform Maturation (~8 weeks):**
Items 2, 4, 6, 7, 14, 18, 19, 20, 22, 23, **33** (health thresholds), **36** (queue timing audit), **37** (existing-app protocol), **Agent-A** (mount audit), **Agent-B** (six phases), **Agent-C** (list_instances).
Structured CEO pipeline, learnings search, missing platform-ops agents, rate-limit ladder, referrals, task dependencies, fallback enforcement, trust-recovery ordering, monitoring, release model, plus codebase-consistency and execution-tracking improvements.

**Backlog (revisit when above lands):**
Item 24 (context graph), **31** (stale knowledge), **34** (pricing audit), **35** (mascot audit), **Agent-D** (skills extension), **Agent-E** (override hierarchy), **Agent-F** (find_best_agent historical), **Agent-G** (deploy retry cap).

---

## Verification Across Changes

- Every new service ships with Vitest unit tests.
- Schema additions (`depends_on`, `autonomy_level`, `authorized_destructive`, `briefing_timezone` (already exists as `timezone`), `feature_flags`, `consecutive_failures`, `refresh_status`, `current_phase`, `core_flow`+5 task fields, `trigger`+`deprecated_reason` on learnings, `deploy_attempt_count`) ship via `npm run db:generate` → reviewed diff → `npm run db:push` against a Neon branch.
- Each batch ends with an end-to-end smoke: seed a test company via `scripts/seed-db.ts`, walk signup → first task → completion → briefing. Every new subsystem emits events visible in `platformEvents`.
- Item 23 (feature flags) gates the behavioral changes (items 2, 8, 17, 32) for per-company validation before 100% rollout.

---

**Doc totals:** 25 original items + 8 agent-specific items (A–H) + 12 new items (26–37) = 45 tracked improvements. 16 spec points explicitly skipped with reasons above.
