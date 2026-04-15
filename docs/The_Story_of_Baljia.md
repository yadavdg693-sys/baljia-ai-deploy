# The Story of Baljia: An AI Angel That Runs Your Company

---

## Prologue: The Promise

Somewhere in the world, a founder wakes up with an idea. Maybe it's a SaaS tool for freelancers. Maybe it's a marketplace for local artisans. Maybe it's something nobody has built before.

The problem is always the same: building a company is a full-time war on a hundred fronts. You need a website. You need customers. You need support. You need marketing. You need analytics. You need someone to fix the CSS at 2am when your hero section looks broken on mobile.

Baljia was built to fight that war for you.

**Baljia AI is a platform where AI agents autonomously run your company.** You sign up, describe your idea, and an AI team takes over -- building, marketing, supporting, and growing your business while you live your life.

One founder. Nine agents. Zero employees.

This is the story of how it works, told from the inside.

---

## Chapter 1: The Founder Arrives

A founder lands on `baljia.app` and clicks "Get Started." They sign in with Google or a magic link -- no password needed, no friction. The platform asks them three things:

1. **Who are you?** (Name, background, LinkedIn)
2. **What's your idea?** (A sentence or two is enough)
3. **Pick your journey:**
   - *Surprise Me* -- "I have a vague idea, shape it for me"
   - *Build My Idea* -- "I know what I want, build it"
   - *Grow My Company* -- "I already have something, help me scale"

The moment they hit submit, the founder sees a loading screen with a little golden angel mascot -- Baljia herself -- animating through states: *listening... planning... running...*

What the founder doesn't see is the machine that just woke up behind the curtain.

---

## Chapter 2: The Onboarding Machine

A 20-stage pipeline fires in the background. Not an agent -- a deterministic service (`onboarding.service.ts`) that bootstraps an entire company in under two minutes. The founder watches progress bars. The system does this:

**Stage 1-3: Understand the founder.**
The pipeline enriches the founder's identity. LinkedIn profile, public footprint, business context. Three enrichment tiers kick in:
- *Strong person signal?* Personalize around the founder's expertise.
- *Weak person, strong business?* Personalize around the business idea.
- *Weak both?* Fall back to a bounded archetype bucket -- "generic SaaS," "local service," "creator economy."

**Stage 4-6: Choose a strategy.**
Based on the enrichment and the chosen journey, the pipeline selects a strategy archetype. Is this a product-led SaaS? A service marketplace? A content business? The archetype determines everything downstream -- what the starter tasks will be, what the roadmap looks like, what the first night shift will prioritize.

**Stage 7-9: Name the company, provision infrastructure.**
The system names the company (if "Surprise Me"), provisions a Neon PostgreSQL database for the founder's app, sets up a subdomain, and creates a company email address. All programmatic. All invisible.

**Stage 10-14: Generate the brain.**
Market research is generated and saved. A mission document is written. A roadmap is created with milestones tied to the company's stage. An active milestone is derived. Starter tasks are created -- three of them, forming a dependency chain:
- **Research task** (understand the market)
- **Build task** (create the first product surface)
- **Growth task** (get the first customers)

**Stage 15-19: Launch signals.**
A landing page brief is generated. A welcome email is sent via Postmark. A launch tweet is drafted. The CEO agent gets a summary of everything that was built, so it can greet the founder intelligently.

**Stage 20: Celebrate.**
The mascot shifts to *growth_mode*. The founder's dashboard loads. Three tasks sit in the "To Do" column. A chat panel glows on the right side of the screen.

The founder types: *"Hey, what's the plan?"*

And the CEO wakes up.

---

## Chapter 3: The CEO -- Your AI Chief Executive

The CEO agent is not like the others. It doesn't build websites or send emails. It *thinks*.

When the founder sends a message, it enters a streaming chat interface powered by Claude Sonnet. But behind the warmth of "Hey! Great question -- here's what I'm thinking..." is a structured 10-step decision engine:

**Step 1: What does the founder want?**
The CEO classifies the message into one of three shapes:
- **Chat** -- just talking, no task needed. Free.
- **Task-like** -- the founder wants something done. Costs credits.
- **Hybrid** -- conversation that might become a task.

**Step 2-3: Can we do it?**
The CEO checks the company's lifecycle state (trial? active? suspended?), the credit balance, and whether the platform has the capability. If the founder asks for a mobile app, the CEO gently redirects: *"I can't build native apps yet, but I can build a responsive web app that works great on mobile. Want me to scope that instead?"*

**Step 4: The Hidden Handoff.**
This is where it gets interesting. The CEO doesn't decide costs on its own. It makes a hidden call to the **Governance Service** -- a separate system the founder never sees.

Governance returns a 5-field **Credit Quote**:
```
{
  credits_required: 1,
  task_split: [],
  founder_safe_reason: "This will cost 1 credit. I'll build...",
  included_scope: "Landing page with hero, features, CTA, footer",
  blockers: []
}
```

If the task is too big -- say "Build me a full dashboard with auth, billing, and analytics" -- Governance detects the bundle and suggests a split:
```
task_split: [
  { title: "Dashboard layout + navigation", tag: "dashboard" },
  { title: "Auth system (signup + login)", tag: "auth" },
  { title: "Billing page with Stripe", tag: "billing" },
  { title: "Analytics dashboard", tag: "reporting" }
]
credits_required: 4
```

The CEO presents this to the founder: *"This is actually 4 separate pieces of work. Want me to create them as individual tasks? That'll be 4 credits total."*

**Step 5: Known Issues Check.**
Before proposing the task, the CEO quietly checks the **Known Issue Registry** -- a database of failure fingerprints from previous tasks. If similar tasks have been failing, the CEO warns: *"Heads up: similar tasks have had issues recently. I'll approach this carefully."*

The founder never knows this check happened. They just see a CEO who seems unusually thoughtful.

**Step 6-10: Route, Brief, Propose.**
The CEO picks the right agent (Engineering for building, Research for analysis, etc.), writes a founder-safe task description, and proposes it:

> *"I'll build your landing page -- hero section, feature grid, CTA, and footer. Clean, responsive, on-brand. This will cost 1 credit. Want me to go ahead?"*

The founder says yes. The task moves to "To Do."

**What the CEO must never reveal:** Agent IDs, internal tool names, execution modes, verification levels, platform costs, infrastructure details. The CEO speaks business, not engineering. If a founder asks "how do you work?", the CEO talks about capabilities -- *"I can build websites, run ads, send outreach emails, analyze data..."* -- never about Claude, Render, Neon, or MCP servers.

---

## Chapter 4: The Control Plane -- Where Tasks Become Reality

The founder approved a task. Now the invisible machinery takes over.

### 4.1: Governance Decides How to Execute

Before any agent touches the task, the **Governance Service** makes three critical decisions:

**Execution Mode** -- How complex is this?
- **Deterministic:** CSS fixes, SEO meta tags, config changes. No reasoning needed. Use the fast, cheap model (Haiku). Finish in under 10 turns.
- **Template + Params:** Landing pages, auth flows, billing pages. Known patterns with custom details. Use Haiku. Finish in under 30 turns.
- **Full Agent:** Bug diagnosis, feature design, competitive research. Needs real reasoning. Use Sonnet. Up to 200 turns.

**Verification Level** -- How do we confirm it's done right?
- **None:** Low-risk bookkeeping tasks.
- **Deterministic:** API calls, DB queries -- assert the output exists.
- **Browser Flow:** A browser agent visits the page and checks it loads.
- **Quality Review:** An LLM reads the output and judges quality.
- **Hybrid:** All of the above combined.

**Permission Snapshot** -- What is this agent allowed to touch?
A locked envelope defining the risk ceiling, allowed tools, max turns, and data access boundaries. Once set, the agent cannot exceed these permissions during execution.

### 4.2: The Worker Launcher

The **Worker Launcher** (`worker-launcher.ts`) is the execution engine. Here's what happens, step by step:

**1. Slot Check.**
Only one task can run per company at a time. Night shifts and manual tasks share this single slot. If something is already running, the task waits.

**2. Lifecycle Gate.**
Is the company in an active state? Trial companies can execute. Suspended companies cannot. This check happens before any credit is spent.

**3. Circuit Breaker.**
If this is an auto-remediation task (a retry after failure), the system checks: have we already retried this type of task twice in the last 24 hours? If so, stop. Don't burn credits on a loop.

**4. Claim + Deduct.**
The task is atomically claimed (status: `todo` -> `in_progress`) and one credit is deducted. The atomic claim prevents a race condition where two processes try to launch the same task.

**5. Context Assembly.**
The system builds a **ContextPacket** -- a structured bundle of everything the agent needs:
- **Memory Layer 1** (Domain Knowledge): 15,000 tokens of company context
- **Memory Layer 2** (Founder Preferences): 3,000 tokens of personal style/preferences
- **Memory Layer 3** (Cross-Company Patterns): 15,000 tokens of anonymized platform-wide learnings
- **Prior Reports:** Summaries of the last 3 reports
- **Failure Fingerprints:** Recent failures relevant to this agent/tag
- **Compiled Briefing:** All of the above merged into a single prompt injection

Each memory layer has a token budget enforced by an eviction system. When Layer 1 exceeds 15,000 tokens, the oldest sections (split by `##` headers) are dropped first. Layer 2 (small budget) simply trims from the beginning, keeping the most recent preferences.

**6. Dispatch.**
The task is dispatched to the appropriate executor based on execution mode. A 10-minute timeout wraps the entire execution. If the agent hangs, it dies.

### 4.3: The Agent Loop

Inside the executor, an agent loop runs:

```
while (turns < maxTurns) {
  1. Watchdog health check (am I idle? stuck? looping?)
  2. Send conversation to Claude (or Gemini fallback)
  3. Parse response -- text or tool calls?
  4. If tool calls: execute tools, feed results back
  5. If text only: done
  6. Watchdog: record turn, check limits
}
```

The **Watchdog** (`watchdog.ts`) sits beside every agent, monitoring:
- **Turn count:** Did we exceed the budget? Kill.
- **Idle detection:** No activity for 2 minutes? Warning. 5 minutes? Kill.
- **Loop detection:** Same tool called 5 times consecutively? Kill.
- **Absolute time:** 4 hours max, period.

The Watchdog is the platform's immune system against runaway agents.

### 4.4: The Gemini Safety Net

Claude (Anthropic) is the primary LLM. But if Claude fails -- API outage, rate limit, network error -- the system falls back to Gemini (Google). The fallback preserves execution mode distinctions: deterministic/template tasks use Gemini Flash Lite, full agent tasks use Gemini 2.5 Flash.

This dual-provider architecture means a founder's task doesn't die because one AI company had a bad day.

---

## Chapter 5: The Nine Agents

Each agent is a specialist. They share a common tool surface (reports, learnings, task status, founder messaging) but have unique capabilities:

### Agent 0: CEO/Chat (5 turns, reactive)
The strategist. Talks to founders, proposes tasks, checks credits, reads memory. Never executes work directly -- it delegates. Max 5 turns per conversation because the CEO should be concise, not chatty.

### Agent 29: Research (200 turns, structured)
The analyst. Uses Tavily web search to study markets, competitors, and opportunities. Every claim must cite a URL source. Findings are rated by confidence: HIGH (multiple sources), MEDIUM (single source), LOW (model knowledge only). Creates structured reports with methodology sections.

### Agent 30: Engineering (200 turns, agentic)
The builder. Creates landing pages, dashboards, APIs, auth systems, billing integrations, webhooks, cron jobs, database schemas. Pushes code to GitHub. Deploys to Render. Default stack: Express + Postgres + Tailwind. "Completed" means deployed and running without server errors.

### Agent 32: Support (200 turns, structured)
The communicator. Sends emails via the company's provisioned email address. Handles customer inquiries. Writes professional, warm responses. Can conditionally access Gmail for companies that have connected it.

### Agent 33: Data (200 turns, structured)
The analyst's analyst. Runs SQL queries against the company's database. Builds analytics dashboards. Generates business intelligence reports. Turns raw data into decisions.

### Agent 40: Twitter (200 turns, graph-based)
The voice. Composes tweets in the founder's style. Schedules posts. Monitors engagement. Creates threads. Reads company documents to stay on-brand. Writes like the founder would, not like a corporate account.

### Agent 41: MetaAds (100 turns, graph-based)
The advertiser. Manages Facebook and Instagram ad campaigns through Meta's Marketing API. Creates audiences, sets budgets, uploads creative, monitors performance. Lower turn cap (100) because ad operations are bounded.

### Agent 42: Browser (200 turns, structured)
The hands. Uses Browserbase (cloud Playwright) to automate web browsing. Fills forms, takes screenshots, creates accounts, scrapes data. The only agent that can *see* and *interact with* the actual web. One browser session per task.

### Agent 54: ColdOutreach (200 turns, graph-based)
The networker. Finds prospect emails via Hunter.io, verifies them, then sends personalized cold outreach. Plain-text emails, 50-125 words, founder voice. Max ~2 cold emails per day. Checks inbound replies before sending new outreach. Follows up after 5+ days.

### The Tool Surface

Every agent gets a base toolkit:
- `update_task_status` / `get_task_status` -- track progress
- `create_report` / `query_reports` / `get_reports_by_date` -- document work
- `save_learning` / `query_learnings` / `search_learnings` -- write to company memory
- `report_bug` / `suggest_feature` -- flag platform issues
- `send_founder_message` -- async message to the founder
- `add_dashboard_link` -- surface useful URLs to the founder

On top of these, each agent gets domain-specific tools. Engineering gets GitHub tools. Browser gets 9 Browserbase tools. MetaAds gets 12 Meta API tools. Twitter gets tweet composition tools. Research gets Tavily search. The tool surface is carefully gated -- only Twitter and ColdOutreach can read company documents directly. All other agents get document content injected via their briefing prompt.

---

## Chapter 6: Verification -- Trust, But Verify

Here's the rule that makes Baljia different from "just throw an AI at it":

**The worker is never the final authority. The verifier decides if the task is done.**

When an agent finishes its work, the task enters `verifying` status. A separate verification system inspects the output:

**Deterministic verification:** Did the API endpoint return 200? Does the database row exist? Is the file present? Binary pass/fail.

**Browser verification:** A browser agent visits the deployed URL. Does the page load? Are the expected elements visible? Does the form submit without errors?

**Quality review:** An LLM reads the agent's output and scores it against a rubric. Is the copy on-brand? Is the research thorough? Does the code follow conventions?

**Hybrid:** All of the above, for complex tasks.

Only after verification passes does the task move to `completed`. If verification fails, the task moves to `failed` -- and the self-healing loop activates.

---

## Chapter 7: When Things Break -- The Self-Healing Loop

Things break. APIs time out. Agents get confused. External services go down. The question isn't whether failures happen -- it's how the platform recovers.

### 7.1: Failure Fingerprinting

Every failure is captured and normalized. Error messages are stripped of UUIDs, timestamps, IPs, and large numbers to create a stable "fingerprint" -- a 64-bit FNV-1a hash. The same type of failure always produces the same fingerprint, even if the specific details differ.

Each fingerprint is classified into one of 8 categories:
- `timeout` -- the agent or API took too long
- `tool_failure` -- a tool call failed
- `external` -- an external service was unreachable
- `scope` -- the task was too large or ambiguous
- `routing` -- the task was sent to the wrong agent
- Plus `infra_error`, `capability_miss`, `connector_failure`

### 7.2: Auto-Remediation

When a task fails, the **Remediation Service** decides what to do:

| Failure Class | Strategy | Why |
|--------------|----------|-----|
| `worker_failure` | Retry | Agent error, worth another shot |
| `external_dependency` | Retry | External service might recover |
| `platform_scoping` | Simplify | Task too complex, needs decomposition |
| `founder_ambiguity` | Escalate | Unclear requirements, ask the founder |
| `missing_prerequisite` | Skip | Can't auto-fix (needs OAuth, API key, etc.) |
| 3+ occurrences | Escalate | Recurring failure, needs human eyes |

Retry tasks are created automatically with `[Retry]` prefix, linked back to the original. A circuit breaker ensures no more than 2 auto-retries in 24 hours per company -- preventing infinite credit drain.

### 7.3: Regression Guard

When a failure fingerprint that was previously marked as `fixed` reappears, the system automatically:
1. Sets `regression_sensitive = true` on the fingerprint
2. Emits a `regression_detected` event
3. Flags it for the platform ops cron to review

The Regression Guard runs every 15 minutes, scanning for fixed fingerprints where `last_seen_at > fix_applied_at`. A ghost from the past means the fix didn't hold.

### 7.4: Auto-Resolve

The loop closes in the other direction too. When a retry task succeeds and passes verification, the system checks: are there failure fingerprints linked to this task? If so, mark them as `fixed` with a note: *"Auto-resolved: retry task succeeded."*

The self-healing loop: **detect -> fingerprint -> remediate -> verify -> resolve**.

---

## Chapter 8: The Night Shift

Every night at 2am UTC, while founders sleep, Baljia works.

The **Night Shift** (`night-shift.service.ts`) is a scheduled process that runs for every active company. It's not an agent -- it's a planner that creates work for agents.

### 8.1: Slot Check
First, the night shift checks: is there already a task running for this company? Night shifts and manual tasks share a single execution slot. If the slot is occupied, the night shift skips this company. No parallel runs.

### 8.2: Trust Recovery
Before planning new work, the night shift triages broken state:
1. **Broken work** -- failed tasks that need retry
2. **Credit issues** -- depleted balances that block execution
3. **Repair backlog** -- remediation tasks waiting in queue
4. **Regressions** -- previously-fixed issues that returned

### 8.3: Stage-Aware Gap Analysis
This is where Baljia's intelligence shows. Every company has a **stage**:
- `early` -- just getting started
- `validation` -- testing the idea with real users
- `monetization` -- making money
- `retention` -- keeping customers
- `scale` -- growing fast
- `compounding` -- everything compounds

Each stage has an ideal profile: what should be true at this stage? The night shift compares reality to the ideal and finds the biggest gaps.

For example, if a company is in `validation` stage but has no website, that's a critical gap. If they're in `monetization` but have never set up billing, that's the top priority. The night shift creates tasks to close the top 2 gaps, prefixed with `[Gap]`:

> `[Gap] Build landing page -- validation stage requires web presence`

This is how Baljia is proactive, not just reactive. The founder doesn't have to know what to build next. The platform figures it out from the gap between where they are and where they should be.

### 8.4: Recurring Tasks
Some tasks repeat. Weekly blog posts. Daily social media. Monthly analytics reports. The recurring task materializer runs every 6 hours, checking which recurring templates are due and creating fresh task instances.

---

## Chapter 9: The Rate Limiter -- The Escalation Ladder

When a company sends too many requests, Baljia doesn't just slam a 429 error. It escalates through 6 levels, each progressively stricter:

| Level | Behavior | De-escalation |
|-------|----------|--------------|
| **Observe** | Normal operation. Count violations. | Baseline |
| **Soft Limit** | Allow requests but add warning headers. | 10 min clean -> observe |
| **Degrade** | Block non-essential endpoints. Chat and tasks still work. | 15 min clean -> soft limit |
| **Cooldown** | Full 429 for all endpoints. 2-minute retry. | 30 min clean -> degrade |
| **Flag** | Full 429 + logged for manual review. 5-minute retry. | 1 hour clean -> cooldown |
| **Suspend** | Persistent block. Manual intervention required. | Manual only |

Each level has thresholds: 3 violations in 5 minutes triggers soft limit. 5 in 10 minutes triggers degrade. And so on.

The state is stored in Redis per company, with automatic de-escalation. A company that behaves for 10 clean minutes drops back one level. The ladder punishes sustained abuse, not temporary spikes.

---

## Chapter 10: The Billing Machine

Baljia's billing runs on 4 lanes, each tracked separately:

### Lane 1: Subscription
Monthly plan fee via Stripe. Tiers: Trial, Starter, Growth, Scale. Trial gets 10 credits and 3 night shifts. Full plans get monthly credit allocations and 30 night shifts.

### Lane 2: Task Credits
**1 task = 1 credit. Always.** Whether it's a 3-turn CSS fix or a 200-turn feature build, it costs 1 credit. Credits are deducted the moment a task moves from `todo` to `in_progress` -- not when it completes. Failed tasks consume their credit (no automatic refund, though `auto_eligible` tasks can get refunds). Credits don't roll over between billing periods.

The **free planning lane** is sacred: chatting with the CEO, scoping work, asking questions -- all free. The platform absorbs the LLM cost, bounded by rate limiting. Founders should never feel hesitant to talk.

### Lane 3: Ad Spend
Pass-through for Meta/Google ad budgets. Charged daily via Stripe. Tracked separately from task credits.

### Lane 4: Runtime AI
LLM tokens, browser minutes, search API calls -- the platform absorbs these. They're tracked for internal cost accounting but never billed to founders.

### The Billing Auditor
Every day at 5am UTC, a **Billing Credit Auditor** scans the ledger for anomalies:
- **Phantom charges:** Credits deducted for tasks that don't exist
- **Double charges:** Same task charged twice
- **Negative balances:** Companies below zero
- **Missing refunds:** Failed tasks eligible for refund but not refunded

Any anomaly emits a `billing_audit_anomaly` event for platform operators to investigate.

---

## Chapter 11: The Memory System -- How Baljia Learns

Agents don't start from scratch every task. They carry memory.

### Layer 1: Domain Knowledge (15,000 tokens)
What the company does, its market, its competitors, its tech stack. Written by the CEO and enriched by Research. Workers read this to understand context.

### Layer 2: Founder Preferences (3,000 tokens)
How the founder likes things done. Tone of voice, design preferences, communication style. The CEO auto-saves this every ~20 messages. Small budget because preferences are concise.

### Layer 3: Cross-Company Patterns (15,000 tokens)
Anonymized, quality-gated learnings from across the entire platform. "SaaS companies in this archetype tend to convert better with social proof above the fold." Platform-only writes -- no company can pollute the shared knowledge.

### Learnings
Separate from memory layers. After every task, the system extracts learnings:
- *"Task 'Build landing page' completed in 3 turns. This is an efficient pattern."*
- *"Task 'Stripe integration' failed with 'missing_prerequisite'. Avoid until API key is configured."*
- *"Task 'Competitor analysis' took 150 turns. Consider splitting future research tasks."*

Learnings are tagged, searchable, and injected into agent briefings for relevant future tasks. Workers can also write learnings mid-execution: *"Found that this company's customers respond better to informal tone."*

### Token Budget Enforcement
When a memory layer exceeds its budget, an eviction system trims it:
- **L1/L3 (15K tokens):** Splits content by `##` headers, drops the oldest sections first.
- **L2 (3K tokens):** Truncates from the beginning, keeping the most recent preferences.

This ensures agents never get bloated context windows. The most relevant, most recent information survives.

---

## Chapter 12: The Platform Ops Layer -- The Invisible Caretakers

Founders never see this layer. It's the platform healing itself.

Nine hidden processes run in the background, five fully implemented and four stubbed for future activation:

### Active Processes

**Infra Watchdog** -- Runs every 15 minutes.
- Queue depth: Are tasks stuck in `todo` for more than an hour?
- Stuck executions: Are tasks stuck in `in_progress` for more than 30 minutes?
- Error rate spikes: Are failures in the last hour 3x above the 24-hour average?
- Agent availability: Are all 8 worker agents active in the database?
- Redis connectivity: Can we ping the Upstash Redis instance?

**Failure Fingerprinter** -- Runs on every failure.
Normalizes error messages into stable fingerprints. Classifies into 8 categories. Links fingerprints to tasks. Detects regressions.

**Known Issue Registry** -- Queried by CEO before task creation.
Groups open failure fingerprints by tag and status. Returns `{ open, investigating, fixed, regressions }`. The CEO checks this before proposing similar work.

**Regression Guard** -- Runs every 15 minutes.
Scans for fixed fingerprints that reappeared. Flags them as regression-sensitive.

**Billing Credit Auditor** -- Runs daily at 5am UTC.
Scans the ledger for phantom charges, double charges, negative balances, and missing refunds.

### Future Processes (Stubbed)

**Prompt Policy Improver** -- Will analyze failure patterns grouped by agent and propose specific prompt changes. Never auto-deploys -- human review required.

**Bug Reproducer** -- Will reconstruct failed task inputs from logs and replay them in a sandbox to reproduce errors.

**Platform Support Triage** -- Will classify founder escalations into categories (bug, feature request, billing, abuse, incident) and route to the right handler.

**Routing Orchestration Analyst** -- Will compare task tags to assigned agents vs completion rates, identifying misrouting patterns and suggesting router updates.

All platform ops consume internal budget, never founder credits. The self-healing loop runs silently, improving reliability without anyone noticing.

---

## Chapter 13: The Dashboard -- What the Founder Sees

While all this machinery churns invisibly, the founder sees a clean, dark-themed dashboard with gold accents.

**Desktop: Three columns.**
- **Left:** The Baljia mascot (an angel in one of 7 real-time states) + key metrics (credits, tasks, stage)
- **Center:** Task board (6 tabs: To Do, Recurring, In Progress, Completed, Rejected, Failed) + company documents
- **Right:** Chat panel (resizable/expandable) + activity feeds (Twitter, email, ads)

**Mobile: Single column** with a floating chat button.

The task board is the founder's command center. Each task shows its title, tag, assigned agent name (not ID), credit cost, and status. The founder can approve, reject, or ask questions about any task through the CEO chat.

Documents live in 5 core slots: Mission, Strategy, Market Research, Product Brief, Brand Voice. These update via *suggestion* only -- the system proposes changes, the founder reviews and accepts. No silent auto-updates. The founder always has final say over their company's identity.

---

## Chapter 14: The Architecture in One Breath

If you had to describe Baljia's architecture in one paragraph:

**Next.js 15 serves the frontend and API routes. Neon PostgreSQL (via Drizzle ORM) stores 37+ tables of platform state. Custom JWT auth with magic link and Google OAuth handles identity. Claude Sonnet powers agent reasoning; Claude Haiku handles fast governance decisions; Gemini provides failover. Upstash Redis backs the event bus, rate limiter, and escalation state. Stripe processes subscriptions and credit purchases. Render hosts the app with 5 cron jobs (night shift, recurring tasks, trial expiry, credit renewal, platform ops). The agent factory assembles briefings, runs tool loops, and handles provider fallback. A watchdog monitors every execution. A 5-level verifier confirms every output. A failure fingerprinter catches every error. A remediation service retries what can be retried. And a governance service silently decides how every task should be executed -- all invisible to the founder who just typed "build me a landing page" into a chat box.**

---

## Epilogue: The Angel at Work

It's 3am. The founder is asleep.

The night shift wakes up. It checks the company's stage: `validation`. It runs the gap analysis: website exists, but no analytics tracking. No social proof. No email capture.

It creates two tasks:
- `[Gap] Add analytics tracking -- validation stage requires usage data`
- `[Gap] Add email capture form -- validation stage requires lead collection`

The first task launches. Governance classifies it as `deterministic` -- paste a tracking snippet. Haiku picks it up. 4 turns. Done. Verification passes.

The second task launches. `template_plus_params` -- standard email form with company branding. Haiku again. 12 turns. Done. Browser verification confirms the form renders.

The failure fingerprinter records: zero new failures tonight. The self-healing loop has nothing to heal. The billing auditor finds no anomalies. The infra watchdog reports: queue clear, no stuck tasks, error rate normal, all agents active, Redis healthy.

The founder wakes up. Opens the dashboard. Sees two new completed tasks in the "Completed" tab. The mascot is in `resolved` mode -- calm, confident.

The founder types: *"Nice work overnight! What should we focus on today?"*

The CEO reads the memory, checks the stage, reviews the gap analysis. Types back:

*"Thanks! I added analytics and an email capture form last night. Today I'd suggest we tackle social proof -- adding testimonials or a customer count to the landing page. That's the biggest gap for your validation stage. 1 credit. Want me to set it up?"*

The founder smiles. Types *"Do it."*

And the machine hums on.

---

*Baljia AI -- Your AI Angel. Runs your company while you enjoy life.*
