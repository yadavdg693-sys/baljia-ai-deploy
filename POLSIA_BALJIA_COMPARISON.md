# Polsia vs Baljia Architecture Comparison

Date: 2026-04-24

Baljia repo: `C:\Users\Vaishnavi\My_Projects\baljia-ai-cf`

Polsia reference: `C:\Users\Vaishnavi\My_Projects\polsia\Polsia_Exact_Architecture_Details.md`

This comparison was reviewed in three passes:

1. Direct feature parity: agents, tools, memory, execution, night shifts, platform OS.
2. Behavioral and failure-mode comparison: how the current code behaves versus Polsia's intended or observed behavior.
3. Omission and drift check: contradictions, missing pieces, and priority fixes.

## Executive Conclusion

Baljia has copied the broad Polsia operating model: CEO/chat control plane, 8 specialist execution agents, task queue, credits, reports, documents, memory layers, recurring tasks, night shifts, and platform ops support surfaces.

Baljia is not an exact Polsia clone internally. In several places it is already a better-than-Polsia rebuild:

- Research has real web search through Tavily, while exact Polsia Research appears to lack live web access.
- Workers get stronger precompiled context than exact Polsia likely gives them.
- Task execution has centralized credit claiming, execution records, watchdogs, execution modes, and mandatory verification.
- Night shift planning is stage-aware and includes health probes, retries, regression context, and summaries.
- Platform ops has real services for infra watchdog, billing audit, known issues, and regression detection.
- Founder apps are intentionally moving to Cloudflare Workers/R2/Neon instead of Render.

The biggest gaps are not the visible agent list. The biggest gaps are:

- no durable background execution boundary yet,
- no formal MCP/capability registry equivalent to Polsia's 22-server model,
- CEO prompt contradicts the actual night-shift service,
- Render-era assumptions remain in data/night-shift tools even though founder apps are supposed to be Cloudflare,
- L3 cross-company memory is not truly global in the current implementation,
- platform ops is service/cron based, not a full internal Platform Ops OS with triage, fix, verify, and feedback loops.

## Pass 1: Direct Feature Parity

### Agents

Polsia baseline:

- 8 execution agents: Engineering, Browser, Research, Data, Support, Twitter, Meta Ads Manager, Cold Outreach.
- Separate CEO/chat-facing assistant that scopes, routes, creates tasks, checks status, and explains credits.
- Fixed per-agent mounts, not dynamically assembled per task.
- Agent IDs observed: Engineering 30, Research 29, Data 33, Support 32, Twitter 40, Meta Ads 41, Browser 42, Cold Outreach 54.

Baljia current code:

- Same 8 execution agents and same IDs are present in `src/lib/services/router.service.ts`.
- Separate CEO/chat agent exists under `src/lib/agents/ceo`.
- Worker prompts and tool surfaces are centralized in `src/lib/agents/agent-factory.ts`.
- Agent prompts can come from DB first, with hardcoded fallback prompts.

Comparison:

| Area | Polsia | Baljia current | Status |
|---|---|---|---|
| 8-agent fleet | Yes | Yes | Match |
| CEO/chat separate from workers | Yes | Yes | Match |
| Same observed agent IDs | Yes | Yes | Match |
| Fixed per-agent mounts | Yes | Mostly yes through `getAgentTools()` | Match |
| Dynamic custom agents | Agent factory exists above runtime, not normal worker runtime | Tool definitions exist, not visibly a full runtime | Partial |
| Research web access | Exact Polsia Research likely has no live web | Baljia Research has Tavily search/extract | Intentional improvement |
| Engineering deploy target | Polsia observed Render/polsia_infra | Baljia Engineering targets Cloudflare Workers/R2/Neon | Intentional divergence |

### Worker Tool Surfaces

Polsia baseline:

- Formal MCP registry: 22 registered MCP servers, 106 named tools.
- Main groups: platform infrastructure, business tools, internal platform services, conditional user-connected tools.
- Important distinction: `memory`, `skills`, `stripe`, and `gmail` can appear as phantom or conditional mounts, not always normal enumerable tools.

Baljia current code:

- No formal external MCP registry. Tools are TypeScript arrays plus handlers.
- Every worker gets 18 base tools:
  - task progress/status,
  - reports,
  - learnings,
  - platform bug/feature escalation,
  - founder message,
  - scripts,
  - dashboard links.
- Twitter and Cold Outreach additionally get document tools.
- Browser gets company email helper tools.
- Each agent gets lane-specific domain tools.

Comparison:

| Tool layer | Polsia baseline | Baljia current | Status |
|---|---|---|---|
| MCP registry | 22 servers, 106 tools | TypeScript tool arrays and handlers | Missing formal registry |
| Common worker tools | tasks, reports, support, sometimes memory/skills | base tools mounted to all workers | Mostly match, more explicit |
| Document access | Not universal, mostly where `documents` mounted | Only Twitter and Cold Outreach get direct document tools, but briefing injects docs to all | Better context injection, narrower direct tools |
| Learnings | `learnings` MCP exists, not equally mounted everywhere | All workers get learning CRUD/search tools | Stronger than Polsia |
| Skills | `.claude/skills` in Polsia, ambiguous runtime | No comparable first-class skill-file runtime for workers | Missing or not equivalent |
| Send reply | Platform-side founder delivery channel | `send_founder_message` base worker tool | Similar |
| Scripts | 3 tool surface in Polsia | `list_scripts`, `run_script`, `get_script_output` | Match |
| Dashboard links | `dashboard` tools | `add_dashboard_link`, `get_dashboard_links`; CEO also has links | Match |

### Per-Agent Tool Comparison

| Agent | Polsia baseline | Baljia current | Status |
|---|---|---|---|
| Engineering | `polsia_infra`, GitHub/render-style infra, DB/log/deploy, tasks/reports/support | GitHub create/read/write/search/PR/commit, Cloudflare deploy/verify/delete, Neon DB, migrations, Stripe product/payment links, custom domains, URL health | Functionally stronger, deploy target changed to Cloudflare |
| Browser | Browserbase 9, browser_auth 11, company_email 5 | Browser navigate/click/fill/extract/screenshot/evaluate, site tier, credentials, password, inbox verification, browser contexts | Mostly match, no explicit `session_close` in listed tool surface |
| Research | Internal synthesis, no live web in exact Polsia | Tavily `web_search`, `web_extract`, competitor and trend tools | Better than Polsia |
| Data | SQL, metrics, logs, infra-backed diagnostics | Platform DB analytics, founder DB query/schema, metrics/trends, `render_get_logs` | Mostly match, but Render log tool is drift under Cloudflare founder-app architecture |
| Support | Company email, conditional Gmail, escalation | Inbox, send email, thread, owner/engineering escalation, contacts, wait_for_email | Mostly match, no clear Gmail OAuth layer |
| Twitter | `post_tweet`, `get_twitter_account`, document context | Post, account, recent tweets, schedule tweet, document tools | Superset |
| Meta Ads | 12 registered tools | Campaign/adset/ad, activate/pause, insights, performance eval, list/delete, video creative tools | Superset, more operational controls |
| Cold Outreach | Hunter, company email, contacts, replies | find/verify email, send outreach, replies, contact status/stats, document tools | Match |

### CEO/Chat Tool Surface

Polsia baseline:

- Separate CEO/chat control plane, not worker number 9.
- Observed 44 tools in 4 groups:
  - chat/control,
  - capabilities/introspection,
  - memory,
  - Brave search and summarization.
- CEO scopes tasks, estimates credits, manages queue, reads memory/docs/reports, and routes work.

Baljia current code:

- `src/lib/agents/ceo/ceo.tool-defs.ts` defines 40 tools:
  - capabilities and routing,
  - tasks,
  - recurring tasks,
  - company context/docs/reports/emails/tweets/links/ads,
  - web search/extract,
  - memory search/read,
  - credit balance,
  - platform bug.

Comparison:

| Capability | Polsia | Baljia current | Status |
|---|---|---|---|
| Task queue control | Broad | Broad | Match |
| Execution logs/status | Yes | Yes | Match |
| Recurring tasks | Yes | Yes | Match |
| Memory search/read | Yes | Yes | Match |
| Capabilities/introspection | Yes | Yes | Match |
| Web search | Brave web/local/video/image/news/summarizer | Tavily web search/extract only | Partial |
| Score task | Present in Polsia chat list | Not in Baljia CEO tool list | Missing |
| Credit balance | Polsia context can expose remaining credits | Explicit `get_credit_balance` | Match or stronger |
| Platform bug/feature | Present | `report_platform_bug`, `suggest_feature` | Match |

## Memory Comparison

### Polsia Baseline

Polsia has:

- Layer 1: Domain Knowledge, 15,000 tokens.
- Layer 2: User and Company Preferences, 3,000 tokens.
- Layer 3: Cross-Company Patterns, 15,000 tokens.
- L2 autosaves around every 20 messages.
- Separate task-level learnings store.
- Exact Polsia worker memory is weaker than marketing language implies: workers likely receive context injection, not full direct memory CRUD/search.

### Baljia Current Code

Baljia has:

- `memory_layers` table with the same 1/2/3 token budget model.
- `chat.service.ts` L2 autosave every 20 messages.
- `memory.service.ts` worker packet and typed context packet.
- `learnings` table and CRUD/search/update/delete/usage tracking.
- Workers get learnings tools directly.
- Worker briefing injects:
  - agent prompt,
  - task object,
  - known failure fingerprints,
  - prior reports,
  - related prior attempts,
  - memory packet,
  - company documents.

### Memory Verdict

Baljia is stronger than exact Polsia on worker context injection. Exact Polsia appears to rely on thinner startup context and ambiguous memory mounts. Baljia actually injects memory layers, prior reports, known issues, related attempts, learnings, and documents into worker briefings.

The gaps:

- L3 is stored by `company_id`, so it is not yet a true global cross-company pattern layer.
- L2 autosave is deterministic regex extraction, so it will miss many real founder preferences.
- Task learning extraction is deterministic and shallow.
- Learnings search is keyword/ILIKE based, not semantic.
- The code has both direct learning tools and injected context, but there is no clear policy for when agents must query memory before acting.

## Task Execution Comparison

### Polsia Baseline

Observed Polsia task ceremony:

1. Task exists in queue.
2. Matching agent is triggered.
3. System prompt loads.
4. Mounted tools load.
5. Memory and skills load.
6. Agent asks for or starts its task.
7. Agent does work.
8. Agent writes a report.
9. Agent marks task complete/fail/block.

Polsia weaknesses called out by the reference:

- lifecycle overhead is repeated inside every agent run,
- agents have generous broad turn caps,
- no strong visible loop detector,
- verification is not consistently final authority,
- exact worker context may be thin.

### Baljia Current Code

Baljia execution path:

1. CEO or route approves a task.
2. `launchTask` validates lifecycle and execution state.
3. Guardrails run.
4. Task is routed by tag to agent ID.
5. `claimSlotAndCharge` claims company slot, claims task, and deducts credit.
6. `task_executions` row is created.
7. Context packet and permission snapshot are assembled.
8. Execution mode dispatches:
   - deterministic,
   - template plus params,
   - full agent.
9. Worker agent runs with tools and watchdog.
10. Platform transitions task to verifying.
11. `verifyAndUpdate` sets final completion/failure.
12. Learnings, stage upgrade, remediation, and failure resolution run after execution.

### Execution Verdict

Baljia improves on Polsia's ceremony. The platform owns claim, start, final status, verification, and execution records. Workers do not need to call `start_task`, `complete_task`, `fail_task`, or `block_task` as normal lifecycle tools.

Strong improvements:

- one company execution slot by default,
- task execution records,
- three execution modes,
- watchdog idle/stuck/turn/time/loop detection,
- context packet before execution,
- verification as final authority,
- failure fingerprinting and remediation hooks.

Major remaining risk:

- execution is still launched as an in-process promise from API/CEO routes rather than a durable background worker or queue.
- if the web process dies after credit/task claim, work can be stranded.
- current runtime behaves like a queue-backed agent system, but deployment topology does not yet provide a durable worker boundary.

Credit behavior:

- Baljia mostly matches Polsia: credits are deducted at execution start, not task creation.
- But Baljia schema supports `estimated_credits`, night shift can create 2-credit tasks, and CEO prompt says "1 task = 1 credit always." That is a product-policy contradiction.

## Night Shift Comparison

### Polsia Baseline

Exact Polsia:

- night shifts are recurring operating cycles,
- subscription language exposes night-shift counts,
- recurring tasks consume credits,
- company-level background work is mostly batch-oriented, not continuous event-driven watching,
- `cycle_planning` is hidden above the normal 8-worker runtime,
- exact Polsia likely executes queued/admissible work rather than every possible autonomous idea.

The Polsia reference recommends a better rebuild:

- separate planning, execution, and summary,
- stage-aware objectives,
- trust-recovery priority,
- same-scope remediation,
- adaptive nightly planning,
- explicit hidden policy for what can be auto-created versus auto-executed.

### Baljia Current Code

Baljia night shift does:

- lifecycle and execution-state gating,
- Postgres advisory lock per company,
- stage-aware objective selection,
- stage gap analysis,
- failed task retry suggestions,
- roadmap-guided task creation,
- regression-sensitive failure tasks,
- health probes of deployed URLs,
- creates night-shift tasks,
- executes at most one task through `processQueue`,
- emits events,
- sends summary email,
- advances roadmap after execution.

### Night Shift Verdict

Baljia is closer to the Polsia "better rebuild" recommendation than exact Polsia. It has a real planner/executor/summary split in code, even if not formalized as separate agents.

Critical drift:

- CEO prompt says night shifts only run queued tasks in order, do not improvise, and do not auto-retry.
- Actual `night-shift.service.ts` creates gap tasks, retry tasks, health-fix tasks, and regression tasks.
- This means the founder-facing CEO can confidently explain behavior that is false.

Other gaps:

- trial/paid night-shift quotas from the prompt are not clearly enforced in the service.
- the cron route processes companies sequentially, so it can become a scaling bottleneck.
- night-shift execution is still in-process, not durable fan-out jobs.
- health probe copy still references Render logs/rollback even though Engineering now targets Cloudflare founder apps.
- recurring task materialization is not atomically claimed and can duplicate work under concurrent cron calls.

## Platform OS Comparison

### Polsia Baseline

The Polsia reference models a hidden Platform Ops OS above the founder-facing 9-agent company system:

- platform support triage,
- bug reproducer,
- prompt/policy improver,
- routing/orchestration analyst,
- billing/credit auditor,
- infra watchdog,
- failure fingerprinter,
- known issue registry,
- regression guard.

It also says exact Polsia likely has only partial automatic improvement: support escalation and memory plumbing exist, but prompt, tools, routing, and platform behavior remain mostly human/platform-team driven.

### Baljia Current Code

Baljia has partial but real Platform OS pieces:

- `/api/cron/platform-ops` runs every 15 minutes.
- `infra-watchdog.service.ts` checks queue depth, stuck executions, error spikes, inactive agents, Redis.
- `failure.service.ts` captures fingerprints, known failures, regressions, and auto-resolves linked failures.
- `billing-audit.service.ts` audits credit ledger anomalies.
- `platform-ops.tools.ts` defines cycle planning and agent factory tools.
- `report_bug` and `suggest_feature` exist in worker base tools.

### Platform OS Verdict

Baljia is ahead of exact Polsia in some implementation details: failure fingerprints, known issues, regression detection, infra watchdog, and billing audit exist as actual services.

But it is not yet a full Platform Ops OS:

- there is no visible support-ticket status loop for `report_bug` / `suggest_feature`,
- no bug reproducer that turns a report into a reproduction artifact,
- no prompt/policy improvement workflow with review and rollout,
- no routing/orchestration analyst that changes router behavior based on outcomes,
- no internal platform task queue for platform fixes,
- no explicit ownership handoff from platform alert to human/operator/fix PR,
- `agent_factory` exists as tool definitions, but dynamic runtime agent provisioning is not a normal product capability.

## Pass 2: Behavioral And Failure-Mode Findings

### Finding B1: Baljia's worker context is better than Polsia, but expensive

Baljia injects memory, documents, prior reports, failures, and related attempts. That fixes a Polsia weakness. But it also increases token overhead for every execution, including small tasks like tweets or support replies.

Recommendation: keep the richer context model, but make it tiered by task type. Tweet/support/outreach should get a compact packet; engineering failures should get the full packet.

### Finding B2: CEO prompt and code disagree about night shifts

The CEO prompt says:

- no surprise features at night,
- no automatic retry,
- only queued tasks execute.

The service code does:

- retries,
- stage gap generation,
- health-fix task creation,
- regression guard task creation.

Recommendation: update CEO prompt to describe the real model: night shifts can plan, create safe suggestions/fixes, execute admissible work, and summarize. Also expose which actions are suggestions versus automatic execution.

### Finding B3: Founder-app deploy architecture changed, but not every agent/tool caught up

Engineering correctly says Cloudflare is the only founder-app deploy target. But Data and night-shift remediation still reference Render logs/rollback. Docs also still contain Render wildcard founder-app instructions.

Recommendation: remove Render founder-app assumptions from Data tools, night-shift descriptions, and docs. Keep Render only for the platform unless explicitly handling legacy apps.

### Finding B4: Baljia improves verification design, but not yet verification strength

Baljia has mandatory verification as a final platform step. That is better architecture than Polsia's observed worker-finalization pattern.

But current verification is not yet strict enough:

- it has domain drift (`baljia.com` fallback versus `baljia.app`),
- it can pass or skip when no deploy URL exists,
- subjective checks are shallow.

Recommendation: require typed evidence by task type: deployment id, URL, status, screenshot, API response, DB assertion, tweet id, campaign id, email id, or quality score.

### Finding B5: Task execution needs durability before production scale

This is the same conclusion as the architecture audit. Baljia has a good execution state machine but runs it inside the web process. Polsia reference implies a deeper orchestration/sandbox layer. Baljia needs that layer for real reliability.

Recommendation: API routes should enqueue durable jobs. A worker should claim leases, heartbeat, execute, and reconcile failures.

### Finding B6: Baljia's memory layer 3 is not yet cross-company

The schema and code fetch layer 3 by company. That makes it tenant-local, not truly cross-company platform intelligence.

Recommendation: split memory into:

- company memory layers,
- platform pattern memory,
- agent/tool/failure learnings,
- privacy-safe aggregate insights.

### Finding B7: Research is intentionally stronger than exact Polsia

Exact Polsia Research likely lacks live web access, causing stale or recycled research. Baljia gives Research Tavily search and citation rules.

Recommendation: keep this. It is one of the right "copy experience, improve machinery" choices.

### Finding B8: Formal capabilities are weaker than Polsia's MCP story

Polsia's architecture centers on an MCP registry and capability introspection. Baljia has tool arrays and CEO capability tools, but there is no canonical machine-readable tool server registry with auth mode, risk class, owner, handler, agent mounts, and availability.

Recommendation: build a capability registry table or config that drives both:

- CEO introspection,
- worker tool mounting,
- route/tool permission audits.

## Pass 3: Omission And Drift Checklist

### Matches To Preserve

- 8 execution agents plus CEO/chat.
- Same practical IDs and agent roles.
- Company-local task queue.
- Credits deducted at execution start.
- One active execution slot per company by default.
- Reports and execution logs as founder-visible outputs.
- Recurring tasks as scheduled task templates.
- Company email, contacts, browser credentials, and persistent contexts.
- CEO as scope, credit, feasibility, and routing layer.
- Platform support escalation via bug/feature reports.

### Better Than Polsia Already

- Research has web search.
- Worker context injection is stronger.
- Learnings are directly mounted for all workers.
- Task execution lifecycle is centralized by the platform.
- Verification is final authority.
- Watchdog includes loop detection.
- Execution modes reduce cost for simpler tasks.
- Cloudflare founder-app hosting is a better target than Render for generated app surfaces.
- Night shift has stage-aware planning and health/regression repair.
- Platform ops has real infra/billing/failure services.

### Missing Or Incomplete Versus Polsia

- Formal 22-server MCP registry equivalent.
- CEO Brave search variants: local, video, image, news, summarizer.
- CEO `score_task` tool.
- Conditional Gmail/user OAuth capability model.
- Skill file runtime equivalent to `.claude/skills`.
- Full platform support ticket/status loop.
- True global L3 cross-company memory.
- Night-shift quota accounting and plan-specific limits.
- Dynamic agent factory as an actual provisioning workflow.
- Clean separation between platform credentials and user login credentials.

### Contradictions To Fix

| Contradiction | Current evidence | Fix |
|---|---|---|
| Founder apps should be Cloudflare, but some tools still say Render | Engineering prompt says CF only; Data/night-shift mention Render logs/rollback | Rename legacy Render tools or gate them to platform/legacy apps |
| CEO says night shifts never create/retry, but service does | `ceo.prompt.ts` versus `night-shift.service.ts` | Update CEO prompt and product copy |
| CEO says 1 task = 1 credit always, but schema supports variable credits | `estimated_credits`, 2-credit health tasks | Decide policy: enforce 1 credit or expose credit bands |
| Polsia-style MCP registry is claimed by tool names, but code uses arrays | `agent-factory.ts` / `ceo.tool-defs.ts` | Add formal capability registry |
| Platform OS tools exist, but no full ops loop | `platform-ops.tools.ts`, cron services | Add platform issue queue and fix workflow |
| Worker architecture acts durable but is in-process | API/CEO launch background promises | Add durable jobs/worker leases |

## Priority Recommendations

1. Build a durable execution layer.
   - Jobs table or queue, worker leases, heartbeats, retry/recovery, execution-id idempotency.

2. Fix CEO prompt to match actual code.
   - Especially night shifts, Cloudflare deploy target, task credits, and auto-remediation behavior.

3. Create a formal capability registry.
   - Tool name, server/module, handler, auth mode, risk class, agent mounts, availability, provider requirements, audit policy.

4. Convert L3 into true platform memory.
   - Separate tenant memory from cross-company patterns. Add privacy-safe aggregation rules.

5. Clean Render/Cloudflare drift.
   - Render for platform only. Cloudflare for founder apps. Remove Render founder-app references from worker tools and remediation copy.

6. Strengthen verification evidence.
   - Require concrete evidence per task type and record it on `task_executions`.

7. Make night-shift quotas real.
   - Track trial 3 total, paid monthly counts, and execution versus planning separately.

8. Complete Platform Ops OS.
   - Add platform issue/ticket queue, bug reproducer, prompt/policy proposal workflow, routing-quality review, and human handoff.

9. Decide exact-Polsia parity versus improvement for CEO search.
   - If exact parity matters, add Brave local/video/image/news/summarizer. If not, document Tavily-only as a deliberate simplification.

10. Add architecture tests.
   - Agent mount snapshot tests, CEO tool snapshot tests, night-shift behavior tests, memory packet tests, durable execution tests, and Cloudflare/Render drift tests.

## Bottom Line

Baljia understood the Polsia shape. The visible company OS is mostly there: CEO, 8 agents, tools, memory, tasks, reports, recurring tasks, and night shifts.

The current code is not just a clone. It improves several Polsia weak spots, especially Research, worker context, execution modes, watchdogs, verification ownership, Cloudflare hosting, and platform ops.

The next step is alignment. The code, CEO prompt, docs, tool names, deployment model, and product policy need to agree on what the system actually does. Once that drift is cleaned up and execution becomes durable, Baljia will be architecturally stronger than the Polsia reference rather than merely similar to it.
