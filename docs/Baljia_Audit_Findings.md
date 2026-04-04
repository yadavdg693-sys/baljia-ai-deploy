# Baljia Documents — Audit Findings

## Audit Methodology
Re-read both output documents line-by-line against the full 10,833-line source material. Cross-checked every claim, looked for missing details, stale assumptions, and architectural errors.

---

## ERRORS FOUND

### Error 1: Task field `executability_type` missing from Knowledge Graph AND Tech Spec
**Source:** Section 9.2 (lines 3098-3190)
**Issue:** Tasks have an important pre-run feasibility field called `executability_type` with values like `can_run_now`, `needs_new_connection`, `manual_task`. This is a real founder-visible gate — tasks with `needs_new_connection` wait for founder OAuth setup before execution. Neither document mentions it.
**Impact:** The task schema in the Tech Spec is missing a column. The Knowledge Graph task lifecycle description is incomplete.
**Fix:** Add `executability_type` to the `tasks` table and to the Knowledge Graph task management section.

### Error 2: Task field `complexity` missing from Tech Spec schema
**Source:** Section 9.2 (line 3082)
**Issue:** Tasks have a `complexity` field distinct from `estimated_hours`. The Tech Spec schema only has `estimated_hours` but not `complexity`.
**Fix:** Add `complexity VARCHAR(50)` to the tasks table.

### Error 3: Task field `suggestion_reasoning` missing from Tech Spec schema
**Source:** Section 9.2 (line 3107)
**Issue:** Auto-generated tasks store a `suggestion_reasoning` field explaining why the platform created the task. This is important for night-shift and auto-generated tasks. Missing from schema.
**Fix:** Add `suggestion_reasoning TEXT` to the tasks table.

### Error 4: Task fields `run_link` and `markdown_link` missing from Tech Spec schema
**Source:** Section 9.2 (lines 3108)
**Issue:** Tasks can be deep-linked via `run_link` (magic-auth execution URL) and `markdown_link`. Missing from schema.
**Fix:** Add both fields.

### Error 5: Task `order` field missing from Tech Spec schema
**Source:** Section 9.2 (line 3106)
**Issue:** Queue position is a real mutable field called `order`, separate from `priority`. Missing from schema.
**Fix:** Add `queue_order INTEGER` to the tasks table.

### Error 6: Twitter agent voice rules missing from Knowledge Graph
**Source:** Section 17.3 (lines 4733-4764)
**Issue:** The Knowledge Graph says Twitter "reads documents for brand context" but omits the specific observed voice rules: dark-humor/witty/bitter style, avoid upbeat/cheerful language, avoid emojis, avoid hashtags, include website link, launch tweets reference `polsia.com/{slug}`. These are concrete and buildable.
**Fix:** Add Twitter voice rules to the Knowledge Graph agent section.

### Error 7: Meta Ads decision thresholds missing from Knowledge Graph
**Source:** Section 18.5 (lines 4866-4883)
**Issue:** The Knowledge Graph mentions Meta Ads has "explicit recovery/moderation logic" but omits the concrete observed optimization thresholds: healthy CTR > 1% and CPC < $1; mediocre CTR 0.5-1% and CPC $1-$2; underperforming CTR < 0.5% or CPC > $2. Also missing: moderation rule (if concept blocked, generate new angle, don't retry same).
**Fix:** Add these thresholds to the Meta Ads agent section.

### Error 8: Prompt template variables missing from both documents
**Source:** Sections 17.3, 12.1 (lines 4756-4764, 3996-4000)
**Issue:** The source identifies concrete prompt template variables: `{{company_name}}`, `{{current_date}}`, `{{cycles_completed}}`, `{{company_slug}}`. These are important for the Agent Factory prompt assembly spec in the Tech Spec. Neither document mentions them.
**Fix:** Add template variable list to Agent Factory section.

### Error 9: Agent execution ceremony (startup sequence) missing from Tech Spec
**Source:** Section 12.1 (lines 3976-4000)
**Issue:** The source has a concrete 11-step worker startup ceremony. The Tech Spec's prompt assembly pipeline partially covers this but misses key steps: "agent asks for its task or available tasks" and "agent marks task started" — these are agent-side actions, not just platform-side assembly.
**Fix:** Add explicit worker-side startup ceremony to the Worker Launcher spec.

### Error 10: `documents` MCP tool list missing from Knowledge Graph
**Source:** Section 4.7 (lines 4696-4704)
**Issue:** The Twitter section reveals the `documents` MCP has 3 named tools: `get_company_documents`, `get_company_document`, `update_company_document`. These are missing from the MCP inventory table in Domain 3 of the Knowledge Graph (it just says "Document CRUD").
**Fix:** Add the 3 named tools.

---

## OMISSIONS FOUND

### Omission 1: `reports` MCP tool names missing
**Source:** Sections 4.7, 19.1 (lines 4703, 4934)
**Issue:** The `reports` MCP has 3 named tools: `create_report`, `query_reports`, `get_reports_by_date`. The Knowledge Graph says "(3) Report creation and query" without naming them.
**Fix:** Add the 3 named tools to the MCP inventory.

### Omission 2: `polsia_support` MCP tool names missing
**Source:** Section 19.1 (line 4935)
**Issue:** The `polsia_support` MCP has 2 named tools: `report_bug`, `suggest_feature`. The Knowledge Graph says "Bug/feature reporting" without naming them.
**Fix:** Add the 2 named tools.

### Omission 3: Engineering integration model (platform-provided vs founder-provided) missing
**Source:** Section 4.2 (lines 1666-1710)
**Issue:** Important distinction between platform-provided default integrations (GitHub, Render, Stripe, Meta Ads, etc.) and founder-provided custom integrations (OpenAI, HubSpot, Calendly, Slack, etc. where founder supplies API key and Engineering wires it in). Neither document captures this split.
**Fix:** Add to Engineering agent details in Knowledge Graph.

### Omission 4: Task board UI details missing from Knowledge Graph
**Source:** Section 9.2 (lines 3140-3178)
**Issue:** The source has concrete task board interaction details: visible tabs (`To Do`, `Recurring`, `In Progress`, `Completed`, `Rejected`, `Failed`), clicking a task attempts to start it, no-credit state shows tasks but redirects to payment on execution attempt. The Knowledge Graph dashboard section doesn't mention the task board tabs.
**Fix:** Add task board UI to the founder dashboard layout section.

### Omission 5: CEO credit-scoping guardrail behavior missing
**Source:** Section 11.6 (lines 3896-3928)
**Issue:** CEO/chat actively guards credit spend: estimates credit cost before creating tasks, pushes back if founder lacks credits, offers alternatives (pick highest-value slice, buy more credits, use referral credits). This is a critical product behavior not captured in the CEO section.
**Fix:** Add to CEO/Chat section in Knowledge Graph.

### Omission 6: Mission document template pattern missing from Knowledge Graph
**Source:** Section 9.4 (lines 3276-3392)
**Issue:** The source has extremely detailed analysis of the mission template pattern (3-section structure, Mad-Libs-like slots, 4-action-verb chain, loss-oriented opener, democratization closer). The Knowledge Graph only mentions "Mission document (populated)" without this detail. This matters for building the onboarding generator.
**Fix:** Add mission template pattern to the onboarding section.

### Omission 7: Execution log surface details missing
**Source:** Section 9.2 (lines 3203-3238)
**Issue:** The source describes what execution logs should show (step-by-step activity, files edited, commands executed, errors, deploy outcome, reasoning narrative) and what they are NOT (raw Git diff, full code review). This informs the locked rebuild choice for execution log transparency.
**Fix:** Add to Knowledge Graph and Tech Spec.

### Omission 8: "Locked rebuild choices" section 26.12 mostly missing from Knowledge Graph
**Source:** Lines 10286-10513
**Issue:** The source has 11 explicit "locked rebuild choices" that are important build decisions. The Knowledge Graph captures some (Research web access, free planning/paid execution) but misses several:
- Locked: Onboarding research depth = `balanced` (configurable)
- Locked: Mission generator fidelity = `approximate parity` (not exact template copy)
- Locked: Different starter-task templates per journey
- Locked: Core documents update via user-reviewed suggestions only (no silent auto-update)
- Locked: Public-surface visibility is configuration-driven
- Locked: Single-domain deployment is sufficient
- Locked: OAuth connections unlock with execution (not pre-trial)
- Locked: Execution log transparency is first-class
- Locked: Data-driven product improvement is explicit, policy-backed, bounded
**Fix:** Add a "Locked Build Decisions" section to the Knowledge Graph.

### Omission 9: Future optional agents (Growth, Content) missing
**Source:** Section 26.11 (lines 10219-10284)
**Issue:** The source discusses two future-optional agents: Growth agent (growth strategy, channel prioritization, ICP refinement, task delegation) and Content agent (long-form content, SEO, newsletters, landing-page copy). These are NOT part of current Polsia but are locked as future enhancements.
**Fix:** Add as future enhancements section.

### Omission 10: End-to-end flow diagrams missing from Tech Spec
**Source:** Section 27 (lines 10515-10581)
**Issue:** The source has 5 Mermaid flow diagrams (User Request→Task→Report, Engineering Deploy, Surprise Me Onboarding, Cold Outreach, Browser Task). These visual flows would make the Tech Spec much more useful.
**Fix:** Add flow diagrams to Tech Spec.

### Omission 11: Ads "Run Ads" dashboard entry point missing
**Source:** Section 18.1 (lines 4780-4786)
**Issue:** The dashboard exposes a `Run Ads` action as the founder entry point for Meta Ads. This is a concrete UI element missing from the dashboard layout description.
**Fix:** Add to dashboard layout.

---

## STALE / POTENTIALLY MISLEADING ITEMS

### Stale 1: Knowledge Graph says "Baljia improvement: Auto-hydrate documents"
**Issue:** The source (section 26.12.4) actually LOCKS a different decision: core documents should NOT auto-update. Instead, agents should SUGGEST updates for user review (accept/edit/skip). The Knowledge Graph improvement claim of "Auto-hydrate from work output" is misleading — it implies automatic updates when the locked choice is user-reviewed suggestions.
**Fix:** Change to "Suggest document updates for founder review after meaningful task outputs."

### Stale 2: Tech Spec `documents` table has `is_empty` boolean
**Issue:** While tracking empty state is useful, the source's locked choice says the 5 core documents should only update via user-reviewed suggestions. The schema should reflect this — perhaps a `pending_update` field or a `document_suggestions` table rather than just `is_empty`.
**Fix:** Consider adding a `document_suggestions` table.

### Stale 3: Knowledge Graph Build Order puts Event Bus in Phase 4
**Issue:** The Event Bus is needed by the Watchdog Monitor (Phase 1) and Night Planner (Phase 3) well before Phase 4. It should be in Phase 0.
**Fix:** Already corrected in Tech Spec Phase 0. Update Knowledge Graph build order to match.

### Stale 4: Tech Spec missing `user_context` as a document surface
**Source:** Section 9.4 (lines 3270-3273)
**Issue:** The source mentions `user_context` as a document surface referenced by at least one agent prompt, separate from the 5 core docs. Not clear if it's a 6th doc type or a memory-layer artifact.
**Fix:** Flag as open question or add as optional doc type.

---

## CONSISTENCY ISSUES BETWEEN THE TWO DOCUMENTS

### Issue 1: Knowledge Graph build order vs Tech Spec build order
The Knowledge Graph Phase 0 doesn't include Event Bus. The Tech Spec Phase 0 does. These should match.

### Issue 2: Night shift credit consumption terminology
The Knowledge Graph says night shifts are "part of the subscription/autopilot operating layer" and "should not be described to the founder as consuming manual task credits." The Tech Spec credit_ledger has `night_shift_deduction` as a ledger entry type. These need alignment — the founder-facing model is "night shifts are included capacity" while the backend still tracks consumption.
**Resolution:** Both are correct at different layers. The Knowledge Graph describes founder perception; the Tech Spec describes backend tracking. Add a note to the Tech Spec clarifying this is internal accounting, not founder-visible.

### Issue 3: Referral reward amount
The Knowledge Graph correctly states "25 task credits" as the referral reward. The Tech Spec doesn't mention the referral system schema. Missing `referrals` table.

---

## SUMMARY

| Category | Count |
|----------|-------|
| Errors (wrong or missing data) | 10 |
| Omissions (important details not captured) | 11 |
| Stale/Misleading items | 4 |
| Consistency issues between docs | 3 |
| **Total findings** | **28** |

### Most Critical to Fix Before Building:
1. **Task schema missing 5+ fields** (executability_type, complexity, suggestion_reasoning, order, run_link) — blocks Phase 1
2. **Locked build decisions not captured** — could lead to wrong architectural choices
3. **Auto-hydrate vs user-reviewed document updates** — fundamental UX decision is currently wrong in Knowledge Graph
4. **Event Bus in Phase 0** — dependency issue in build order
5. **Mission template pattern** — needed for onboarding generator build

---

# SECOND PASS — ADDITIONAL FINDINGS

## Additional Errors

### Error 11: `dashboard` MCP tool names missing from Knowledge Graph
**Source:** Section (lines 2299-2321)
**Issue:** The `dashboard` MCP has 2 named tools: `add_link`, `get_dashboard`. Missing from MCP inventory. Also important: this service powers both backend state AND founder-visible quick-links.
**Fix:** Add to MCP inventory table.

### Error 12: `capabilities` MCP tool names missing from Knowledge Graph
**Source:** Lines 2330-2337
**Issue:** The `capabilities` MCP has 6 named tools: `list_available_modules`, `get_module_capabilities`, `list_mcp_servers`, `list_available_agents`, `get_agent_capabilities`, `find_agent_for_task`. These are listed as CEO tools but not in the MCP server inventory.
**Fix:** Add tool count and names to MCP inventory.

### Error 13: `agent_factory` MCP tool names missing from Knowledge Graph
**Source:** Lines 2347-2353
**Issue:** The `agent_factory` MCP has 5 named tools: `list_mcp_tools`, `get_mcp_tool_details`, `create_agent`, `list_created_agents`, `get_agent_template`. Missing from MCP inventory.
**Fix:** Add to MCP inventory.

### Error 14: `cycle_planning` MCP tool names missing from Knowledge Graph
**Source:** Lines 2386-2392
**Issue:** The `cycle_planning` MCP has 4 named tools: `get_cycle_context`, `create_cycle_plan`, `update_cycle_plan`, `submit_review`. Missing from MCP inventory.
**Fix:** Add to MCP inventory.

### Error 15: `scripts` MCP tool names missing from Knowledge Graph
**Source:** Lines 2419-2423
**Issue:** The `scripts` MCP has 3 named tools: `list_scripts`, `run_script`, `get_script_output`. Missing from MCP inventory.
**Fix:** Add to MCP inventory.

### Error 16: `learnings` MCP tool names missing from Knowledge Graph
**Source:** Lines 2439-2445
**Issue:** The `learnings` MCP has 5 named tools: `create_learning`, `query_learnings`, `search_learnings`, `get_recent_learnings`, `get_learnings_by_tags`. Missing from MCP inventory.
**Fix:** Add to MCP inventory.

### Error 17: Tech Spec verification levels don't match source
**Source:** Section 26.2.4 (lines 9855-9873)
**Issue:** The source defines 5 verification levels: `none`, `deterministic`, `browser-flow`, `quality-review`, `hybrid`. The Tech Spec only has 3: `platform_check`, `preview_log`, `browser_verification`. Missing `none`, `quality_review`, and `hybrid`. Also missing: the source says the worker should NOT be the final authority on completion — a separate verifier sets the final status.
**Fix:** Update Tech Spec verification enum to match source. Add verifier-as-authority pattern.

### Error 18: Tech Spec completion states don't match source
**Source:** Section 26.2.4 (lines 9919-9935)
**Issue:** The source defines richer completion states: `completed_verified`, `completed_unverified`, `failed`, `blocked`, `partial`. The Tech Spec task status only has the basic set. Missing `completed_verified`, `completed_unverified`, and `partial`.
**Fix:** Update task status enum.

### Error 19: Verification evidence storage missing from Tech Spec
**Source:** Lines 9896-9914
**Issue:** Every completed task should store typed evidence (screenshot, DOM assertion, API response, DB assertion, deployment status, log summary, artifact URL, tweet/campaign/email ID, quality score). The Tech Spec has no `verification_evidence` field or table.
**Fix:** Add `verification_evidence JSONB` to task_executions table.

## Additional Omissions

### Omission 12: `send_reply` MCP purpose not captured
**Source:** Lines 2479-2501
**Issue:** `send_reply` is a platform-side founder-message delivery channel used by background processes (onboarding, cycle/autopilot, execution notifications) to push async messages to founders even when live chat isn't the caller. This is architecturally important for night-shift summaries and onboarding notifications.
**Fix:** Add to MCP details and to Night Shift spec.

### Omission 13: Reports continuity gap not captured
**Source:** Lines 2270-2279
**Issue:** Although every worker has report-query tools, agent system prompts do NOT explicitly tell workers to read prior reports before starting work. Also `related_task_ids` are NOT explicitly referenced in visible worker prompts. This means prior context exists but isn't enforced as part of startup.
**Fix:** Flag in agent architecture section. This is a concrete improvement opportunity for Baljia — enforce prior-report reading.

### Omission 14: Sapiom sandbox runtime not mentioned
**Source:** Lines 6109-6131
**Issue:** The onboarding pipeline runs in a dedicated sandboxed executor called "Sapiom" (`Executing in isolated Sapiom sandbox (async fire-and-forget)`). This is architecturally significant — onboarding is NOT just a background job, it's an isolated sandboxed process with webhook-callback completion. Neither document mentions this.
**Fix:** Add to onboarding pipeline section.

### Omission 15: `save_surprise_strategy` step missing from onboarding pipeline
**Source:** Lines 6177-6184
**Issue:** Before company naming, the onboarding pipeline has an internal strategy-selection step: `Using dashboard:save_surprise_strategy... Strategy "Novel Idea" saved.` This is a distinct pipeline stage missing from the onboarding sequence.
**Fix:** Add strategy selection between enrichment and naming in onboarding pipeline.

### Omission 16: Concrete starter task metadata missing
**Source:** Lines 6662-6671
**Issue:** Starter tasks have specific observed metadata: Engineering MVP complexity ~8, estimated ~3 hours; competitive research complexity ~3, estimated ~1 hour; growth/outreach complexity ~4, estimated ~1 hour. All have `assigned_to_agent_id: null` and source `onboarding`. They also include `run_link`, `markdown_link`, and `suggestion_reasoning`.
**Fix:** Add to starter task section.

### Omission 17: Onboarding research report is structured, not free-form
**Source:** Lines 6675-6681
**Issue:** The onboarding research report has specific fields: target market, market size, competitors, strategy, localized audience framing. This is structured data, not just prose.
**Fix:** Add report structure to onboarding section.

### Omission 18: Daily throughput heuristic missing
**Source:** Lines 7500-7520
**Issue:** Important operational constraint: ~6 credits/day strict maximum (if every task uses full 4-hour cap), ~8-12 credits/day practical (tasks finish sooner). 100 credits ≈ 10-14 days of heavy execution. Credits buy volume, NOT concurrency within same company queue.
**Fix:** Add to credit/execution section in both documents.

### Omission 19: Per-agent rebuild fixes missing
**Source:** Section 26.3 (lines 9997-10043)
**Issue:** The source has specific per-agent improvement recommendations that go beyond the general improvements captured. E.g., Twitter: add trend context, analytics, engagement loop, dedupe against recent tweets. Cold Outreach: research before email, skip prospects without personalization hook, separate lead DB from contacts. Browser: add search-assisted URL discovery, smarter screenshot cadence.
**Fix:** Add per-agent rebuild recommendations.

### Omission 20: Safer multi-tenancy recommendations missing
**Source:** Section 26.5 (lines 10108-10118)
**Issue:** Source recommends customer-owned GitHub, customer-owned ad account, customer-owned domains, private-by-default dashboards, approval gates for deploys/billing/risky outbound. These are important Baljia differentiators not captured.
**Fix:** Add to rebuild improvements.

### Omission 21: Mobile dashboard layout missing
**Source:** Lines 5460-5488
**Issue:** Mobile layout is a single-column stacked version with specific order: terminal strip → company name → mascot → trial CTA → business metrics → tasks → documents → links → Twitter → email → ads. Has floating circular chat button in lower-right. This is buildable spec missing from dashboard layout section.
**Fix:** Add mobile layout to dashboard section.

### Omission 22: Complexity semantics and decomposition rules missing
**Source:** Section 22.4 (lines 7599-7658)
**Issue:** Complexity is 1-10 scale (1=trivial, 5=moderate, 10=very complex). It does NOT directly change credit cost, agent selection, tool mounts, or runtime cap — it's planning metadata only. Decomposition is by deliverable boundaries, not implementation fragments (good split: landing page / auth / dashboard / payments; bad split: DB setup / API only / UI only). CEO optimizes for "1 credit = 1 founder-visible outcome."
**Fix:** Add to task governance section.

### Omission 23: Structured task handoff chain for onboarding missing
**Source:** Section 26.10 (lines 10184-10217)
**Issue:** A critical rebuild improvement: starter tasks should form a dependency chain (Research → Build → Growth) with explicit handoff artifacts (research summary, ICP, competitor set, feature scope, live URL). This is one of Polsia's most visible failures.
**Fix:** Add to onboarding improvements.

### Omission 24: URL confidence and correction loop missing
**Source:** Section 26.9 (lines 10165-10182)
**Issue:** For "Grow my company" path: must fetch/analyze URL, score confidence, pause if low confidence, show user what was inferred, ask for correction before proceeding. Polsia currently continues with wrong interpretation.
**Fix:** Add to onboarding section.

## Additional Stale/Misleading Items

### Stale 5: Tech Spec `agents` table has `system_prompt TEXT`
**Issue:** Storing full system prompts as plain text in a single column is architecturally naive given that prompts are assembled dynamically from base prompt + company context + memory + task + mode + skills + instance context. The `system_prompt` field should be a base template, not the full assembled prompt.
**Fix:** Rename to `base_system_prompt` and add comment clarifying it's the template, not the runtime prompt.

### Stale 6: Knowledge Graph doesn't mention "company documents are NOT broadly available"
**Source:** Line 4004
**Issue:** A critical architectural fact: company documents are only visible where the `documents` MCP is mounted (Twitter and Cold Outreach). Engineering, Data, Browser, and Research do NOT have document access in the observed model. This is important and partially contradicts the improvement claim about "auto-hydrating documents" — documents need to be accessible first.
**Fix:** Add document mount limitation to agent tool pattern section.

---

## UPDATED SUMMARY

| Category | First Pass | Second Pass | Total |
|----------|-----------|-------------|-------|
| Errors | 10 | 9 | 19 |
| Omissions | 11 | 13 | 24 |
| Stale/Misleading | 4 | 2 | 6 |
| Consistency issues | 3 | 0 | 3 |
| **Total findings** | **28** | **24** | **52** |

### Additional Critical Fixes for Second Pass:
6. **MCP inventory is missing tool counts/names for 6 servers** (dashboard, capabilities, agent_factory, cycle_planning, scripts, learnings) — this is a significant gap since these are the hidden platform machinery
7. **Verification framework in Tech Spec is too simple** — source has 5 levels, richer completion states, and evidence storage requirements
8. **Sapiom sandbox** — onboarding runs in an isolated sandbox, not just a background job
9. **Document mount limitation** — documents are NOT broadly available to most agents; only Twitter and Cold Outreach have them
10. **Daily throughput cap** — ~8-12 credits/day practical maximum; critical for credit planning and founder expectations
11. **Mobile layout** — concrete buildable spec was available but missed

---

# THIRD PASS — ADDITIONAL FINDINGS

## Additional Errors

### Error 20: Knowledge Graph trial credit math is incomplete
**Source:** Line 6780
**Issue:** The Knowledge Graph says "10 welcome bonus credits" for trial. But one conversation also frames the trial as "5 base credits plus 10 welcome credits for a 15-credit launch sprint." The Knowledge Graph doesn't capture the 5 base credits — it only shows the 10 bonus. The total trial execution budget is likely 10 credits (described as "10 credits" in user-provided clarification at line 799), with the 15-credit framing being a sales narrative that may include base plan credits. The document should note this ambiguity rather than presenting either number as settled.
**Fix:** Add note about trial credit ambiguity (10 vs 15 depending on how base+bonus is framed).

### Error 21: `user_context` vs `user_research` document naming inconsistency
**Source:** Lines 3263, 5558-5562
**Issue:** The source lists `user_context` as a document type in section 9.4 (and notes it's referenced by at least one prompt), but section 21.2.1 and the 5-core-documents list use `user_research`. These may be the same slot with different names, or `user_context` may be a separate hidden document. Both Knowledge Graph and Tech Spec only list `user_research`. This naming discrepancy should be flagged.
**Fix:** Add note about `user_context` as possible alias or additional hidden document surface.

### Error 22: Companies table missing `onboarding_status` field
**Source:** Line 3053
**Issue:** Companies have an explicit `onboarding_status` field (can be `completed` before paid continuation starts). The Tech Spec companies table doesn't have this. It has `lifecycle` and `billing_state` but no separate onboarding status tracker.
**Fix:** Add `onboarding_status VARCHAR(50)` to companies table.

### Error 23: Companies table missing `plan_tier` field
**Source:** Line 3056
**Issue:** Companies have a `plan_tier` field (can read like `trial` while subscription is unset). Missing from Tech Spec. While `billing_state` partially covers this, `plan_tier` is a separate concept — it describes the product tier, not the payment status.
**Fix:** Add `plan_tier VARCHAR(50)` to companies table.

### Error 24: Tech Spec `night_shift_cycles` admissibility check is wrong
**Source:** Lines 6837-6858
**Issue:** The Tech Spec night shift code checks `if (state.billing_state !== 'active') return;` — but the source says trial state ALSO includes night shifts (3 during trial). So the admissibility check should be `if (!['active', 'trial'].includes(state.billing_state)) return;`
**Fix:** Update the admissibility check in the night shift spec.

## Additional Omissions

### Omission 25: 5-bucket fallback idea system not captured with enough detail
**Source:** Lines 6549-6555, 1230-1245
**Issue:** There are TWO different bucket systems in the source. Section 21.4 lists 5 abstract buckets (sell a tool, connect two sides, sell content, sell a service page, automate a process). Section 2.7 lists 12 stack-friendly business categories (SaaS, marketplaces, agencies, directories, creator tools, ecommerce, communities, lead-gen, booking, internal tools, education, AI wrappers). Both are present in the source but neither the Knowledge Graph nor the 5-bucket reference captures both levels.
**Fix:** Capture both the 5 abstract buckets AND the 12 business categories in the idea engine section.

### Omission 26: "Build my idea" path details thin in Knowledge Graph
**Source:** Lines 6683-6699
**Issue:** The Knowledge Graph says "Build my idea — founder provides the idea" but misses key details: uses same hidden enrichment layer as Surprise Me, user supplies one idea in a text box, NO deep clarification conversation, combines typed idea + person research + geo context, then internally decides final framing. Speed over discovery optimization.
**Fix:** Add these details to the onboarding tree section.

### Omission 27: Onboarding checklist UI items not captured
**Source:** Lines 5510-5517
**Issue:** The right-side chat panel shows a checklist-style onboarding summary: researched the market, sent welcome email, tweeted from @polsia, built landing page, created mission document, queued 3 tasks for cycle 1. This is a concrete UI element for founder reassurance.
**Fix:** Add to dashboard layout section.

### Omission 28: Worker lifecycle overhead problem not captured
**Source:** Section 12.2-12.3 (lines 4028-4067)
**Issue:** A significant architectural weakness: every task execution forces 4 avoidable lifecycle API calls (find task, start task, write report, complete task) PLUS token overhead from rereading all tool definitions and shared context even for tiny tasks. A CSS fix pays the same prompt overhead as a full MVP build. Also: shared skills block appears across agents even where skill creation isn't relevant.
**Fix:** Add to Knowledge Graph as architectural weakness and as concrete Baljia improvement (move lifecycle out of agent into platform).

### Omission 29: Capability validation weakness not captured
**Source:** Section 12.5 (lines 4110-4122)
**Issue:** All agents can return "FULL CAPABILITY to execute" even when they lack required tools (Research has no search, Support lacks Gmail, Data lacks specialist tools). Capability check validates mount presence at coarse level, not whether the agent truly has what's needed.
**Fix:** Add to contradictions section.

### Omission 30: Dynamic agent provisioning recommendation not captured
**Source:** Section 26.6 (lines 10120-10129)
**Issue:** Source recommends generating narrow per-task worker agents, mounting only exact tools needed, validating config/runtime parity before launch, retiring worker after completion. This is different from both Polsia's static agent fleet AND our Tech Spec's current Agent Factory design.
**Fix:** Add as future Baljia improvement.

### Omission 31: Better coordination model (event-driven triggers) not captured
**Source:** Section 26.7 (lines 10131-10140)
**Issue:** Source recommends explicit task handoff objects, richer delegation metadata, event-driven triggers (inbox, deploy failure, ad-performance threshold, onboarding milestones). The Knowledge Graph mentions "batch-oriented, not event-driven" as a weakness but doesn't capture the concrete improvement recommendation.
**Fix:** Add to rebuild improvements.

### Omission 32: Unified memory/learnings/reports retrieval recommendation not captured
**Source:** Section 26.4 (lines 10044-10052)
**Issue:** Source says a stronger clone should unify memory, learnings, and reports under one retrieval surface, avoid duplicating document text into memory layers, and track agent-task outcomes to improve routing quality. This is a concrete architecture recommendation missing from both documents.
**Fix:** Add to memory system rebuild improvements.

### Omission 33: Closed-loop failure learning system not in Tech Spec
**Source:** Section 26.4.1 (lines 10054-10106)
**Issue:** A 6-step platform mechanism: failure capture → fingerprinting/clustering → issue registry → fix routing → regression monitoring → runtime feedback to CEO/routing/prompts. This is a significant platform service missing from the Tech Spec service map.
**Fix:** Add `Failure Learning Service` to service map and Phase 5.

### Omission 34: Better signup signal usage recommendations not in Knowledge Graph
**Source:** Section 26.8 (lines 10142-10163)
**Issue:** Concrete recommendations: IP→local market framing; locale→language defaults; timezone→night-shift timing; device→builder vs browser posture; referral source→different aha strategy; OAuth profile/email domain→side-project vs existing business separation. Should feed into idea generation, routing, research, targeting, pricing defaults.
**Fix:** Add to onboarding improvements.

## Additional Stale/Misleading Items

### Stale 7: Tech Spec Onboarding Pipeline missing STRATEGY_SELECTION stage
**Source:** Lines 6177-6184
**Issue:** The onboarding pipeline enum has `ENRICH_FOUNDER`, `ENRICH_BUSINESS`, `PERSIST_CONTEXT`, `NAME_COMPANY` — but there's a distinct `save_surprise_strategy` stage BETWEEN enrichment and naming that the enum doesn't capture. The source shows: `Using dashboard:save_surprise_strategy... Strategy "Novel Idea" saved.`
**Fix:** Add `SELECT_STRATEGY = 'select_strategy'` between PERSIST_CONTEXT and NAME_COMPANY.

### Stale 8: Tech Spec enrichment fallback has only 2 tiers when source has 3
**Source:** Lines 6636-6641
**Issue:** The Tech Spec's `EnrichmentResult` has `person_confidence` and `business_confidence` with rules for low person → avoid personal claims, low business → fall back to buckets. But the source actually describes a 3-tier decision: (1) strong person → personalize around person, (2) weak person but strong business URL → personalize around business, (3) weak both → bounded bucket fallback. The Tech Spec misses the middle case.
**Fix:** Add the 3-tier enrichment decision tree.

### Stale 9: Knowledge Graph doesn't note that "available_documents" only lists populated docs
**Source:** Line 3270
**Issue:** An important UI detail: the `available_documents` surface only shows populated docs. Empty document slots may not appear in certain contexts. This affects how the dashboard documents section renders and how agents see document availability.
**Fix:** Add note to document system section.

---

## FINAL UPDATED SUMMARY

| Category | Pass 1 | Pass 2 | Pass 3 | Total |
|----------|--------|--------|--------|-------|
| Errors | 10 | 9 | 5 | 24 |
| Omissions | 11 | 13 | 10 | 34 |
| Stale/Misleading | 4 | 2 | 3 | 9 |
| Consistency issues | 3 | 0 | 0 | 3 |
| **Total findings** | **28** | **24** | **18** | **70** |

### Third Pass Critical Fixes:
12. **Trial credit math ambiguity** — 10 vs 15 credits depending on framing; should be explicit
13. **Night shift admissibility wrong** — trial also gets night shifts, not just active billing
14. **Two idea bucket systems** — 5 abstract + 12 business categories, only partially captured
15. **Worker lifecycle overhead** — 4 wasted API calls per task + shared token overhead; a concrete improvement target
16. **Closed-loop failure learning** — a 6-step platform mechanism missing from the Tech Spec service map entirely
17. **Capability validation weakness** — agents report "full capability" even when blind; not in contradictions list
