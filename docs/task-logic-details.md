# Task Creation Logic — Detailed Reference

> **Purpose.** Source of truth for *how* the 3 starter tasks get created at the end of onboarding. Maps Polsia's observed task structure (Penora, AgentDeck, CoauthorOS, Qontakt, XYZ Registry) to our current code, identifies the 5 quality gaps, and locks the Phase 3b prompt + code change spec.
>
> **Why this matters.** The 3 starter tasks are the **first thing the founder sees in their queue**. They become the first things their AI workers execute when they convert. Generic or thin tasks → generic or thin first results → low conviction → low conversion. This is one of the highest-leverage prompts in the entire pipeline.

---

## Table of Contents

1. [The 3-slot pattern (universal)](#the-3-slot-pattern-universal)
2. [Why always 3 tasks (Polsia's reasoning)](#why-always-3-tasks)
3. [Per-slot field structure](#per-slot-field-structure)
4. [Polsia vs our current code](#polsia-vs-our-current-code)
5. [The 5 gaps that hurt our quality](#the-5-gaps-that-hurt-our-quality)
6. [Proposed Phase 3b prompt (full text)](#proposed-phase-3b-prompt)
7. [Code changes required](#code-changes-required)
8. [The dependency chain](#the-dependency-chain)
9. [Decisions locked / pending](#decisions-locked--pending)
10. [See also](#see-also)

---

## The 3-slot pattern (universal)

Every Polsia onboarding produces **exactly 3 tasks** with **fixed slot semantics**. Verified across 4 sample executions (Penora, AgentDeck, CoauthorOS, Qontakt, XYZ Registry):

| Slot | Tag | Lane | Purpose | Polsia priority | Polsia complexity | Polsia hours |
|---|---|---|---|---|---|---|
| **1** | `engineering` | PRODUCT | Build the core thing | **HIGH** | 7-9 | 3 |
| **2** | `research` | INTEL | Analyze competitors deeper | medium | 3-4 | 1 |
| **3** | `growth` (Polsia) / `outreach` (ours) | CUSTOMERS | Find first 5-10 customers | medium | 4-5 | 1 |

Examples from the 4 Polsia samples:

| Sample | Slot 1 (engineering) | Slot 2 (research) | Slot 3 (growth) |
|---|---|---|---|
| Penora | Build core book generation engine | Scout the AI book generator landscape | Cold outreach to indie authors |
| CoauthorOS | Build the Core Editor MVP | Scout the AI Writing Arena | Find 10 Writers Who Need a Better Co-Author |
| AgentDeck | Build AgentDeck MVP: Agent Selector | Scout the Competition: CrewAI, Lindy, Relevance AI | Cold Outreach: Find 10 SMBs Drowning in manual ops |
| Qontakt | Build MVP — outbound engine | Research Jazon, Apollo, Instantly's India traction | Find 10 Indian SMB founders struggling with sales |

**No exceptions across 4 Polsia executions** — same 3 slots, same order, same tags.

---

## Why always 3 tasks

Polsia's reasoning (from analysis of behavior + their own explanation):

### 1. Minimum viable operating cycle

A startup needs all three lanes simultaneously to move:

| If we created only this | What breaks |
|---|---|
| Just engineering | You build something nobody wants — no validation signal |
| Just research | You know the market but have nothing to sell |
| Just outreach | You're selling vaporware — credibility damaged |

Three is the **minimum** to cover product + positioning + customers in parallel.

### 2. Credit economics

Each task = 1 credit. A new founder starts with limited credits (10 trial credits in our case). Creating 5-10 tasks would:

- Waste budget on tasks that won't run
- Tasks sit stale in the queue → become outdated as company learns
- Decision fatigue when founder reviews queue

3 tasks = enough to validate, few enough that they all get executed.

### 3. Parallel independence

Each task runs in a different agent lane (engineering / research / outreach). Zero cross-task dependencies means:

- All 3 can execute in any order
- Workers don't wait on each other
- Failure of one doesn't cascade

This is **why slot order works** — engineering is highest priority but doesn't *block* research or outreach from running.

### 4. Per-task 4-hour limit

Polsia caps each task at ≤4 estimated hours. Engineering (3h) is at the high end; research (1h) and outreach (1h) are quick wins. If the engineering MVP scope is bigger than 4h, it gets split into multiple engineering tasks — but for *first* cycle, the system scopes to a single 3h task.

Our current code uses `estimated_credits: 1` uniformly which loses this depth signal — see [gap #4 below](#gap-4-complexity--estimated_hours-fields-not-used).

---

## Per-slot field structure

Polsia's `create_task_proposal` call (reverse-engineered from logs):

```
create_task_proposal({
  title:                "Build the AgentDeck MVP: Agent Selector...",
  description:          "Multi-step product spec — see below",
  tag:                  "engineering",     // FIXED per slot
  task_type:            "feature",         // feature/research/outreach
  priority:             "high",            // high for slot 1, medium for 2-3
  complexity:           8,                 // 1-10 scale, slot-determined band
  estimated_hours:      3,                 // ≤4 hard cap
  source:               "agent_generated",
  suggestion_reasoning: "Strategic LLM-generated context for the executing agent"
})
```

### Where each field comes from

| Field | Source |
|---|---|
| `title` | LLM-generated from company + opportunity + competitor names |
| `description` | LLM-generated; **engineering task gets a multi-step product spec**, others get 3-4 sentence briefs |
| `tag` | **Fixed per slot** — engineering / research / outreach |
| `task_type` | Fixed per slot — feature / research / outreach |
| `priority` | Slot 1 = HIGH (or 100), slots 2-3 = MEDIUM (or 70) |
| `complexity` | Slot-determined band: engineering 7-9, research 3-4, outreach 4-5 |
| `estimated_hours` | Slot 1 = 3, slots 2-3 = 1. Hard cap ≤4. |
| `source` | Hardcoded `'onboarding'` (ours) or `'agent_generated'` (Polsia) |
| `suggestion_reasoning` | **LLM-generated, strategic** — explains why THIS task now, what stake it represents |

### The reasoning field is for the executing agent, not the founder

Critical insight from Polsia: `suggestion_reasoning` isn't UI copy. It's the **brief the worker agent reads when picking up the task**. Example for Penora:

> *"Core product that will generate first users and revenue. The book generation engine is the entire value proposition of Penora. Without it, there's no product."*

The engineering agent reads this and understands the stakes — so when it has to make tradeoffs (cut a feature vs. extend timeline), it knows to favor "ship the value prop, defer the polish." Hardcoded boilerplate gives no such signal.

---

## Polsia vs our current code

Side-by-side, line numbers refer to [src/lib/services/onboarding.service.ts](../src/lib/services/onboarding.service.ts):

| Aspect | Polsia | Ours ([generatePersonalizedTasks:936-1011](../src/lib/services/onboarding.service.ts#L936)) | Aligned? |
|---|---|---|---|
| **Always 3 tasks** | ✅ | ✅ | ✅ |
| **Slot order** | engineering → research → growth | research → engineering → outreach | ❌ **Reversed** |
| **Slot 1 priority** | HIGH | priority 80 (research) | ❌ Wrong slot gets top |
| **Slot 2-3 priority** | MEDIUM each | priority 70, 60 (linear decline) | ⚠️ Different scheme |
| **Tag for slot 3** | `growth` | `outreach` | ⚠️ Different name (we keep `outreach` for internal consistency with agent lane 54) |
| **`complexity` field** | Set per slot | Not populated | ❌ Missing |
| **`estimated_hours` field** | Set per slot | Not populated (we use `estimated_credits=1` for all) | ❌ Loses depth signal |
| **`suggestion_reasoning` field** | LLM-generated, strategic | Hardcoded boilerplate string per slot | ❌ Big quality gap |
| **Engineering description depth** | Multi-step product spec (5+ sections, named tech stack) | 2-3 sentences | ❌ Big depth gap |
| **`source` field** | `agent_generated` | `'onboarding'` | ⚠️ Different vocab, equivalent meaning |
| **Auto-promote to `todo`** | Yes (Surprise Me has blanket permission) | Yes (created as `todo` directly) | ✅ |
| **Creation speed** | ~600ms total (3 × 200ms parallel-ish) | Sequential `await` in for loop | ⚠️ Could parallelize but micro-optimization |

---

## The 5 gaps that hurt our quality

### Gap 1 — Slot order is reversed

**Current code** ([onboarding.service.ts:985-1006](../src/lib/services/onboarding.service.ts#L985)):
```ts
return [
  { tag: 'research',    ... },   // priority 80 — slot 1
  { tag: 'engineering', ... },   // priority 70 — slot 2
  { tag: 'outreach',    ... },   // priority 60 — slot 3
];
```

**Why this is wrong:**
- Engineering is the **longest** task (3h vs 1h each) — start the longest first so it has runway
- Engineering is the **load-bearing** task (no product = no business)
- If founder has only 1 credit, the **most valuable** task to execute first is engineering — but our priority ordering picks research

**Penalty in practice:** if a founder runs only 1 task before churning, we'd build them a research report instead of a product. They walk away with nothing tangible.

### Gap 2 — Reasoning is hardcoded boilerplate

**Current code** ([onboarding.service.ts:991, 998, 1005](../src/lib/services/onboarding.service.ts#L991)):
```ts
reasoning: 'Market research grounded in founder domain knowledge.',
reasoning: 'Core build — depends on research output.',
reasoning: 'First customer outreach — specific to founder credibility and domain.',
```

These strings are **identical across every onboarding** — Penora and AgentDeck would get the same reasoning text despite being completely different companies.

**Penalty in practice:** the executing worker agent reads this when picking up the task. Generic reasoning = generic task interpretation = generic outputs.

### Gap 3 — Engineering description is too thin

**Current prompt** ([onboarding.service.ts:961-968](../src/lib/services/onboarding.service.ts#L961)):
```
TASK_2_TITLE: [Build task — name the core thing to build]
TASK_2_DESC: [2-3 sentences, what exactly to build and why]
```

**Polsia generates** for engineering tasks:
- Brief intake form spec
- AI research phase requirements
- Outline/structure generation logic
- Core processing flow
- Output format spec
- Tech stack (Express.js + PostgreSQL)
- 5-6 numbered steps the user takes

This is the difference between *"Build a book generator"* and *"here's an executable spec the engineering agent can implement immediately."*

**Penalty in practice:** when the engineering agent picks up our 2-sentence task, it spends half its turn budget re-deriving what to build. Polsia's spec lets the agent start coding immediately.

### Gap 4 — `complexity` + `estimated_hours` fields not used

**Current code** ([onboarding.service.ts:986-991](../src/lib/services/onboarding.service.ts#L986)):
```ts
{ tag: 'research',    estimated_credits: 1, /* no complexity, no hours */ }
{ tag: 'engineering', estimated_credits: 1, /* no complexity, no hours */ }
{ tag: 'outreach',    estimated_credits: 1, /* no complexity, no hours */ }
```

We use `estimated_credits: 1` uniformly, signaling "all 3 tasks are equal-effort." But engineering is 3x the work of the others. The executing agent has no way to know.

**Schema already supports both fields** ([schema.ts:128, 135](../src/lib/db/schema.ts#L128)):
```ts
complexity: integer('complexity'),
estimated_hours: decimal('estimated_hours', { precision: 4, scale: 1 }),
```

We just don't populate them.

**Penalty in practice:** the agent's watchdog and turn budget allocation can't differentiate. An engineering agent might burn its budget on "easy" tasks and run out before completing the load-bearing one.

### Gap 5 — Sequential creation in `for` loop

**Current code** ([onboarding.service.ts:912-925](../src/lib/services/onboarding.service.ts#L912)):
```ts
for (let i = 0; i < tasks.length; i++) {
  await taskService.createTask({ ... });   // serial, ~600ms total
}
```

3 sequential DB INSERTs at ~200ms each. Polsia fires them ~600ms total because all 3 happen "in parallel" from the LLM's perspective (it composes them in one reasoning step, then the calls happen in rapid succession).

**Penalty in practice:** minor — saves ~300ms per onboarding. Not a quality issue, but a free latency win when we touch the code.

---

## Per-journey engineering task spec format (locked decision)

The 5-section engineering task description format **differs by journey** because the work itself is fundamentally different:

| Aspect | Build / Surprise (building NEW) | Grow (optimizing EXISTING) |
|---|---|---|
| Verb | "Build the X" | "Improve / Fix / Optimize the X" |
| Starting state | No code exists | Code exists, has metrics |
| Output | New product running | Improved metric on existing product |

### Build / Surprise engineering task description (5-section product spec)

```
1. Core flow:
   - Step 1: [user action]
   - Step 2: [system response]
   - Step 3: [user action]
   - Step 4: [system response]
   (3-6 numbered steps)

2. Key features:
   - [Feature 1, named specifically]
   - [Feature 2]
   - [Feature 3]
   (3-5 features)

3. Tech stack:
   - Backend: [framework + reason]
   - Database: [type + reason — usually PostgreSQL]
   - Critical libraries: [name 1-3 if relevant]

4. Success criteria:
   [Measurable definition of "done"]

5. Out of scope for v1:
   [What we are NOT building yet]
```

### Grow engineering task description (5-section optimization spec)

```
1. Current state:
   [What exists today, the metric we're improving, baseline number]

2. Hypothesis:
   [What's the bottleneck, what change should help]

3. Specific changes:
   - [Change 1: concrete edit to existing code/UI]
   - [Change 2]
   - [Change 3]
   (3-5 specific changes)

4. Measurement:
   [What metric improves and by how much (target %)]

5. Rollback plan:
   [How we revert if it makes things worse]
```

The strategy class for each journey owns its engineering task description format. The other 4 fields (TITLE, REASONING, plus task fields like priority/complexity/hours) follow the same rules across all 3 journeys.

---

## How this prompt inherits the CEO framework

Phase 3b does NOT duplicate task-creation logic — it inherits from the CEO. The CEO already implements CAPE (Capability Mapping → Allocation → Spec → Execution Check) via:

- `getPlatformCapabilitiesPrompt()` from [src/lib/platform-capabilities.ts](../src/lib/platform-capabilities.ts) — single source of truth for what worker agents CAN and CANNOT do
- The CEO's "10 Skills" + "Task Scoping" rules in [src/lib/agents/ceo/ceo.prompt.ts](../src/lib/agents/ceo/ceo.prompt.ts)

For onboarding starter tasks we **reuse** these by:
1. Importing `getPlatformCapabilitiesPrompt()` directly into the Phase 3b prompt — same string the CEO sees
2. Inlining the relevant CEO skills (Scope Sniffing, Pattern Matching, MVP Filtering, Failure Prediction, Constraint Budgeting, Translation) and Task Scoping rules (max 4hr, one concern, testable, dependency-ordered, self-contained descriptions)

This means: as `platform-capabilities.ts` evolves (new agent, new MCP, new limitation), both CEO-proposed tasks and onboarding starter tasks improve in lockstep — no spec drift.

**Onboarding-specific simplification**: Day 0 always means slots = `engineering / research / outreach`. We hardcode that allocation (skipping CAPE Step 2's matrix) because every onboarding company is Day 0 by definition. The full CAPE matrix is only needed for ongoing CEO-proposed tasks where stage varies (Has-MVP, Has-Users-Low-Conv, etc.).

---

## Proposed Phase 3b prompt (Build / Surprise version)

Replaces the prompt at [onboarding.service.ts:957-968](../src/lib/services/onboarding.service.ts#L957). The Build/Surprise variant is shown below; the Grow variant swaps the engineering DESCRIPTION block for the optimization spec format above.

```
Generate 3 starter tasks for {company_name}. Use this EXACT slot structure 
— do NOT change order, tags, or fixed fields:

INPUTS YOU CAN REFERENCE:
- Company: {company_name}
- Journey: {journey}
- Mission one-liner: {one_liner}
- Founder angle: {founder_angle}
- Founder location: {city}, {country}  (or "(unknown)" if no GeoIP)
- Active milestone: {milestone_title} (focus areas: {milestone_tags})
- Market research output (full JSON, includes first_priorities + competitors + opportunity): 
  {market_research_json}

PLATFORM CAPABILITIES (single source of truth — same as CEO uses):
{getPlatformCapabilitiesPrompt() output}

TASK FRAMEWORK (inherited from CEO scoping rules):
- Scope Sniffing: catch the iceberg — if "Build X" implies 10 sub-features, narrow to MVP slice
- Pattern Matching: marketplace = auth + listings + search + payments + messaging; 
  SaaS = auth + onboarding + core + billing + settings; 
  AI tool = input form + API call + output display + history
- MVP Filtering: which ONE feature would a customer pay for? That's v1.
- Failure Prediction: which step has highest fail risk? Flag fragile external APIs explicitly.
- Constraint Budgeting: max 4 hours per task. 6 shipped features beat 12 half-built ones.
- Translation: not "make it good" but "create /api/search that accepts string X and returns Y."
- Each task description is SELF-CONTAINED — embed all needed context inline (competitor names,
  audience details, infra assumptions). Tasks run in parallel; never reference other tasks' output.
- One concern per task. Engineering = build it. Research = analyze it. Outreach = sell it.

═══ TASK_1 (slot: engineering, priority: high, hours: 3, complexity: 7-9) ═══

Engineering agent CAN: Express + Postgres backend, DB schemas, Render hosting, subdomain, 
Stripe, GitHub, API endpoints, webhooks, cron jobs.
Engineering agent CANNOT: browse web, send emails, post tweets, run ads, do web research.

TITLE: [Action verb + specific MVP slice. Use market_research.first_priorities[0] as strategic 
seed; refine for clarity. Max 12 words.]

DESCRIPTION: [Write a MINI PRODUCT SPEC using this exact 5-section format:

1. Core flow:
   - Step 1: [user action]
   - Step 2: [system response]
   - Step 3: [user action]
   - Step 4: [system response]
   (3-6 numbered steps)

2. Key features:
   - [Feature 1, named specifically]
   - [Feature 2]
   - [Feature 3]
   (3-5 features)

3. Tech stack:
   - Backend: Express (already provisioned)
   - Database: PostgreSQL (already provisioned via Neon)
   - Critical libraries: [name 1-3 if relevant]

4. Success criteria:
   [Measurable definition of "done"]

5. Out of scope for v1:
   [What we are NOT building yet — manage scope explicitly]

Description must be SELF-CONTAINED. Embed competitor insights from market_research.competitors 
inline if they shape a feature decision. Do not reference "see market research" or "see 
research task output". Do not imply tools the engineering agent doesn't have (no "scrape 
competitor sites" — that's the browser agent's domain).]

REASONING: [2 sentences, WORKER-VOICED (queue justification: "this task should run because..."). 
What's blocked without it. What revenue or validation signal it unlocks. NOT a strategic 
narrative for the founder — that lives in the market research report. This is for the worker 
agent and queue prioritization.]

═══ TASK_2 (slot: research, priority: medium, hours: 1, complexity: 3-4) ═══

Research agent CAN: web research, competitive analysis, market intelligence, industry trends, 
customer persona development.
Research agent CANNOT: write code, deploy, post anywhere, send emails.

TITLE: [Format: "Scout the {category}: {Competitor1}, {Competitor2}, {Competitor3}..." 
Name 3-5 ACTUAL competitors from market_research.competitors[].name field.]

DESCRIPTION: [3-4 sentences. Self-contained.
- List specific dimensions to compare (pricing tiers, feature parity, customer reviews, 
  positioning gaps, weaknesses)
- Name the deliverable (a comparison report saved as a document)
- Name the decision this informs (positioning, pricing tier, feature priority)
Embed competitor names and dimensions inline. Do not reference other tasks.]

REASONING: [2 sentences, WORKER-VOICED. Why this competitive deep-dive now. How it sharpens 
the engineering task's scope or unlocks a positioning decision.]

═══ TASK_3 (slot: outreach, priority: medium, hours: 1, complexity: 4-5) ═══

Outreach agent CAN: company email ({slug}@baljia.app), Hunter.io email lookup/verification, 
personalized outreach sequences, web search for prospects.
Outreach agent CANNOT: write code, post on social platforms, run ads.

TITLE: [Name the EXACT customer profile + count. 
Format: "Cold outreach: Find {N} {role} in {industry/situation}"
Example: "Cold outreach: Find 10 indie authors who published 2+ books"]

DESCRIPTION: [3-4 sentences. Self-contained.
- Channels: pick channels appropriate for founders in {city}, {country} from GeoIP. Use the 
  geography's actual buyer channels (region-specific platforms, local communities, professional 
  networks popular in {country}). If GeoIP is "(unknown)", match channels to the AUDIENCE itself 
  (e.g. indie authors → KDP forums, dev communities → GitHub Discussions, ecommerce buyers → 
  Reddit subreddits) regardless of founder location. NEVER hardcode a country if no GeoIP.
- First message structure: 1-line value prop + 1 qualifying question
- Response signals: name what response means real interest (e.g. "asks about pricing", 
  not "shows interest")
Embed audience and channel inline. Do not reference other tasks.]

REASONING: [2 sentences, WORKER-VOICED. Why these specific people, not generic "early 
adopters." Why outreach now, before the product is finished.]

HARD RULES:
1. Each task description is SELF-CONTAINED — embed competitor names, audience details, infra 
   assumptions inline. Never say "see other task" or "see report".
2. Each task respects agent capability boundaries (declared per-slot above + PLATFORM 
   CAPABILITIES section). Don't put browsing in engineering, coding in research, or social 
   posting in outreach.
3. Engineering DESCRIPTION must contain all 5 sections and ≥6 sentences total.
4. Research TITLE must name ≥3 actual competitors from market_research.competitors[].
5. Outreach DESCRIPTION must use {city}, {country} from GeoIP if available, OR match channels 
   to the AUDIENCE if GeoIP is "(unknown)". NEVER hardcode a country name in fallback.
6. REASONING fields are WORKER-VOICED (queue justification), NOT founder-facing strategic 
   narrative. The strategic narrative lives in market_research's first_priorities[i].rationale.
7. No filler verbs anywhere: "explore", "investigate", "consider", "look into", "leverage", 
   "synergize", "deep-dive into" (research title is allowed "Scout the X" pattern only).
```

---

## Code changes required

All in [src/lib/services/onboarding.service.ts](../src/lib/services/onboarding.service.ts) (or in the future per-strategy file after Phase 0 refactor):

| Change | Function | Lines | LOC delta |
|---|---|---|---|
| Replace prompt with the new 5-section format above | `generatePersonalizedTasks` | 957-968 | +50 / -12 |
| Add `extract('TASK_N_REASONING')` for each slot | `generatePersonalizedTasks` | 985-1006 | +6 |
| Reorder return array: engineering first, research second, outreach third | `generatePersonalizedTasks` | 985-1006 | +0 (just reorder) |
| Update priority scheme: 100, 70, 70 (was 80, 70, 60) | `generatePersonalizedTasks` | 985-1006 | +0 |
| Add `complexity` per slot: 8, 3, 4 | `generatePersonalizedTasks` | 985-1006 | +3 |
| Add `estimated_hours` per slot: 3, 1, 1 | `generatePersonalizedTasks` | 985-1006 | +3 |
| Parallel `Promise.all` for the 3 task creates | `runCreateStarterTasks` | 912-925 | +5 / -8 |
| Update `task_type` per slot if column exists in `tasks` schema | `runCreateStarterTasks` | check schema | TBD |

**Total LOC delta: ~+57 / -20 = net +37 LOC** for substantially better task quality.

**No schema migration required** — `complexity` and `estimated_hours` columns already exist on the `tasks` table per [schema.ts:128, 135](../src/lib/db/schema.ts#L128).

---

## The dependency chain

Where task creation sits in the pipeline:

```
runMarketResearch (Tavily 3 searches → Codex synthesis)
   │
   ▼
runSaveMission (Codex → one_liner + mission)
   │
   ▼
runGenerateRoadmap (archetype + milestones)
   │
   ▼
runDeriveActiveMilestone (pick first milestone for task focus)
   │
   ▼
runCreateStarterTasks ─────► generatePersonalizedTasks (Codex prompt)
   │                              │
   │                              ▼
   │                          { engineering, research, outreach }
   │                              │
   ▼                              ▼
3 × taskService.createTask    Returns to runCreateStarterTasks
   │
   ▼
3 tasks in DB with status='todo', queue_order 1/2/3
```

**Why this order:**

- Tasks need market research (to name competitors in TASK_2)
- Tasks need mission (engineering task should align with one-liner)
- Tasks need active milestone (gives focus areas via `milestone_tags`)
- Tasks come BEFORE landing page (landing page is purely promotional, doesn't need task list)

**What runs in parallel after `runCreateStarterTasks`:**

- `runGenerateLandingPage` — landing HTML
- `runPostLaunchTweet` — Twitter post
- `runGenerateCeoSummary` — first chat message

These all consume the same upstream context but don't depend on tasks being created.

---

## Decisions locked / pending

### Locked (in the proposed prompt above)

| # | Decision | Choice |
|---|---|---|
| L1 | Always 3 tasks | Yes (matches Polsia) |
| L2 | Slot tags | engineering / research / outreach (keep `outreach` over `growth` for internal consistency with our agent lane naming) |
| L3 | Slot order | engineering → research → outreach (reversed from current) |
| L4 | Engineering description format | 5-section spec (Core flow / Key features / Tech stack / Success criteria / Out of scope) |
| L5 | Reasoning generation | LLM-generated per task (not hardcoded) |
| L6 | Schema additions needed | None — `complexity` and `estimated_hours` already exist |

### Pending (need user confirmation before Phase 3b implementation)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| P1 | Priority scheme | A. 100/70/70 (matches Polsia high/medium/medium). B. 100/80/60 (stronger gradient). C. Keep current 80/70/60. | **A** — matches Polsia |
| P2 | Complexity values | A. eng=8, research=3, outreach=4. B. eng=7-9 random within band. C. Skip. | **A** — fixed values, predictable |
| P3 | Estimated hours | A. eng=3, research=1, outreach=1 (matches Polsia). B. Let LLM decide. C. All=1. | **A** — matches Polsia |
| P4 | Parallel `Promise.all` for 3 task creates | A. Yes (saves ~300ms). B. Keep sequential. | **A** — free win |
| P5 | If LLM can't extract a TASK_N_REASONING, what happens? | A. Fall back to slot-specific hardcoded string. B. Throw and fail loud. C. Use empty string. | **A** — graceful degradation |

---

## How this connects to other docs

| Topic | Doc |
|---|---|
| What Research and Content Creation phases do (where tasks fit in) | [onboarding-research-and-content.md](./onboarding-research-and-content.md) |
| Phase ordering, time estimates, file layout | [onboarding-implementation-plan.md](./onboarding-implementation-plan.md) |
| Worker lane definitions (engineering = lane 30, research = lane 29, outreach = lane 54) | [CLAUDE.md § "9 Agents"](../CLAUDE.md) |
| Task lifecycle (todo → in_progress → verifying → completed) | [CLAUDE.md § "Task Lifecycle"](../CLAUDE.md) |

---

## TL;DR

| Question | Answer |
|---|---|
| Why always 3 tasks? | Minimum viable operating cycle: product + positioning + customers |
| Why these 3 slots? | Engineering builds it, research positions it, outreach sells it. All 3 needed in parallel to validate. |
| Why engineering first (slot 1)? | Longest task (3h), load-bearing (no product = no business), highest value if founder runs only 1 task |
| How specifics decided? | Strategy defines product angle, market research names competitors, founder location dictates outreach channel |
| Are tasks hardcoded? | **Structure** is hardcoded (3 slots, fixed tags, priority scheme). **Content** is LLM-generated fresh each time. |
| What's wrong with our current code? | 5 gaps: reversed order, wrong slot priority, hardcoded reasoning, thin engineering description, complexity/hours fields unused |
| What's the fix? | Phase 3b: new prompt (above), reorder slots, populate complexity + hours, parallelize creation. ~+37 LOC, no schema migration. |
