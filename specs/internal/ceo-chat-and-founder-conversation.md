# Spec: CEO/Chat and Founder Conversation

- `Spec ID`: `SPEC-CEO-001`
- `Status`: new
- `Subsystem`: CEO/chat agent, founder conversation, task shaping
- `Classification`: product subsystem
- `Sensitivity`: internal spec plus sanitized build spec
- `Related specs`:
  - [specs/internal/control-plane-runtime-and-task-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane-runtime-and-task-agents.md)
  - [specs/internal/control-plane/memory-context-tools-and-connectors.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/memory-context-tools-and-connectors.md)
  - [specs/internal/control-plane/lane-and-agent-responsibility-model.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/lane-and-agent-responsibility-model.md)
  - [specs/internal/billing/credits-and-task-charging.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/credits-and-task-charging.md)

## Purpose

Define the CEO/chat agent as the founder's primary conversational surface and the platform's task-shaping brain. This spec owns:

- the 10-step decision flow from founder message to queued work
- free planning lane boundaries
- credit quoting format and governance contract
- message type classification
- stage-aware gap-based planning model
- rate limiting and anti-abuse escalation
- what CEO must and must not reveal
- CEO tool surface and routing tools

The CEO is not a simple chatbot or a thin wrapper over task creation. It is a dynamic task-shaping layer that converts messy founder intent into clean executable work while preserving a "smart CEO" product feel.

## Founder-Visible Contract

The founder should experience CEO/chat like this:

- CEO feels like a knowledgeable business partner who knows the company deeply
- chatting, planning, shaping, and preparing work are free — credits are only consumed when execution starts
- CEO proactively estimates credit cost before creating tasks
- CEO pushes back on vague, oversized, or infeasible requests rather than pretending everything fits one run
- CEO explains what is blocked, what prerequisites are missing, and what alternatives exist
- CEO never reveals internal token costs, margin formulas, complexity scoring, or anti-abuse thresholds
- CEO speaks in credits and tasks, not in tokens and models

## Hidden-System Contract

- CEO/chat is the main visible credit-scope guardrail between founder intent and worker execution
- CEO has the richest continuity context of any agent (direct read/write to all 3 memory layers)
- CEO asks hidden governance for credit quotes and relays founder-safe responses
- CEO routes tasks using `find_best_agent` and `find_agent_for_task` but is not blindly bound by historical volume bias
- rate limiting and cost controls operate silently — the founder sees graceful degradation, not raw policy
- the CEO decision flow is a genuine planning/orchestration brain, not static prompts plus naive tag routing

## In Scope

- CEO decision model (10-step flow)
- free planning lane definition
- credit quoting format and governance handoff
- message type classification
- stage-aware planning
- routing tool usage
- rate limiting and anti-abuse escalation
- information the CEO must not reveal
- CEO tool surface inventory
- task decomposition rules

## Out of Scope

- worker execution lifecycle (owned by runtime spec)
- credit charging mechanics (owned by credits-and-task-charging)
- memory layer storage implementation (owned by memory spec)
- exact prompt wording
- UI/chat component design

## Canonical Noun Imports

### `free_planning_lane`

- **Meaning:** the set of founder interactions that consume no execution credits
- **Owned here**

### `credit_quote`

- **Meaning:** the founder-safe cost estimate returned before task creation
- **Owned here**

### `task_shaping`

- **Meaning:** the process of converting raw founder intent into structured executable tasks
- **Owned here**

### `worker_lane`

- **Imported meaning:** specialist executor family chosen for the task
- **Owned elsewhere:** lane-and-agent-responsibility-model.md
- **Used here for:** routing decisions only

### `manual_credits_remaining`

- **Imported meaning:** credit availability for charge-governed execution
- **Owned elsewhere:** credits-and-task-charging.md
- **Used here for:** credit quoting and pushback decisions

## CEO Decision Model (10-Step Flow)

When the founder sends a message, the CEO processes it through this sequence:

### Step 1: Interpret founder intent

Parse the founder's message to understand what they actually want, not just the literal words.

### Step 2: Classify the request shape

Determine the request category:

- **chat-only** — strategy discussion, question, explanation, status check
- **one executable task** — a single clear deliverable
- **multiple ordered tasks** — work that must be decomposed into sequenced deliverables
- **blocked on setup** — the work is valid but prerequisites are missing
- **outside platform scope** — the request cannot be fulfilled by the platform

### Step 3: Check company state

Reason over:

- company phase and current maturity stage
- existing queue and task order
- completed and failed tasks
- reports, docs, and known artifacts
- known issue / regression context

### Step 4: Check credits and subscription state

- current `manual_credits_remaining`
- subscription posture (trial, active, keep-live)
- whether the work fits within available credits

### Step 5: Check connections, tools, and feasibility

- required connectors and their auth/ownership posture
- whether the target agent lane has the tools needed
- whether external dependencies are met

### Step 6: Decide the response path

Based on steps 1-5, choose one of:

| Decision | When | CEO behavior |
|---|---|---|
| Chat-only response | No execution needed | Answer directly from context, memory, and knowledge |
| Create one task | Clear single deliverable, credits available, prerequisites met | Quote credits, explain scope, queue task |
| Create multiple tasks | Work must be decomposed | Quote total credits, explain decomposition, queue ordered tasks |
| Block and explain | Prerequisites missing (connector, auth, dependency) | Explain what is missing and how to resolve it |
| Narrow the request | Too vague, too large, or partially infeasible | Offer the highest-value slice that fits current constraints |
| Refuse cleanly | Outside platform scope or unsafe | Explain why and suggest alternatives if any |

### Step 7: Estimate credit cost

- ask hidden governance for the quote (see Credit Quoting section)
- if the founder lacks sufficient credits, push back with alternatives:
  - pick the highest-value slice that fits the current credit budget
  - buy more credits
  - use referral credits if available

### Step 8: Choose the best-fit agent

- use `find_best_agent(query)` for historical outcome lookup
- use `find_agent_for_task(task_tag)` for capability/rules-based routing
- override historical volume bias when a specialist clearly fits better
- do not route to an agent that lacks the tools needed for the task

### Step 9: Write the worker-facing task brief

- write the exact task description that the worker will receive
- split large asks into founder-visible deliverables, not internal engineering substeps
- include scope boundaries, expected outputs, and verification expectations

### Step 10: Queue, defer, or refuse

- queue the task(s) for execution
- defer if credits are insufficient or dependencies unmet
- refuse if the work is outside scope

## Free Planning Lane

The following founder interactions consume **zero** execution credits:

- strategy discussion
- planning and brainstorming
- task creation and scoping
- task reordering and queue shaping
- document editing and review
- general questions and explanations
- credit balance inquiries
- status checks
- company state inquiries

Credits are consumed only when a task transitions from `todo` to `in_progress` (worker execution starts).

**Why this matters:** Free planning is a core product promise. If chat cost credits, founders would avoid using the CEO, defeating the purpose of having an AI executive. The platform absorbs chat LLM costs as a cost of doing business, bounded by rate limiting.

## Credit Quoting

### Founder-facing quote format

When the founder asks how much something costs, or when the CEO creates tasks, the quote follows this shape:

1. **Total credits** — `"This will cost 2 credits."`
2. **Task count** — `"That means 2 tasks: auth flow and founder dashboard."`
3. **Founder-safe reason** — why the split or cost
4. **Included scope** — `"Includes: build and verification."`
5. **Blockers** — `"Blocked by: connect GitHub first."` (if applicable)

### Governance handoff

The CEO does not compute quotes internally. The flow is:

1. CEO sends the scoped request to hidden governance
2. governance returns a founder-safe response object:
   - `credits_required`
   - `task_split` (array of task descriptions)
   - `founder_safe_reason`
   - `included_scope`
   - `blockers`
3. CEO relays the response in natural language

This preserves a helpful CEO experience without turning CEO into a leak surface for internal economics.

### What CEO must NOT reveal

- token counts or model costs
- provider names or model identifiers
- margin targets or unit economics
- hidden complexity scoring formulas
- anti-abuse thresholds or anomaly scores
- internal policy scoring details
- exact rate limit numbers
- internal cost accounting or ledger details
- platform service internals

### Founder-safe language for limits

When rate limiting or cost controls activate, CEO uses safe language:

- `"You're temporarily rate limited. Please try again shortly."`
- `"This request is unusually heavy. I've paused it for now."`
- `"I need to slow down this session to protect system stability."`

## Message Type Classification

| Message type | Credit cost | CEO behavior |
|---|---|---|
| Strategy/planning chat | Free | Answer from context and memory |
| Status inquiry | Free | Report current state from live data |
| Credit/billing question | Free | Report balance, explain options |
| Task creation request | Free (quote only) | Scope, quote, and queue |
| Task execution | 1 credit per task (at worker start) | Hand off to worker via governance |
| Document edit request | Free | Edit or suggest changes |
| Queue management | Free | Reorder, prioritize, remove |
| Bug report / feature suggestion | Free | Escalate via `report_bug` / `suggest_feature` |
| Connection/setup guidance | Free | Explain what to connect and how |

## Stage-Aware Gap-Based Planning

The CEO should not plan reactively ("what looks missing right now?"). Instead, it should plan from stage awareness:

### Planning inputs

- **Company archetype:** SaaS, marketplace, local business, agency, content/tool product, creator product
- **Current stage:** foundation, validation, monetization, retention, scale, compounding
- **Current state:** what is deployed, completed, failed, queued, documented, recently emphasized by founder
- **Current constraints:** credits, missing connections, blocked dependencies, verification burden

### Planning principle

> Next task = strongest gap between ideal stage progression and current company state

This is better than: next task = whatever missing thing feels noticeable right now.

### Archetype playbooks

- archetype-specific playbooks define the ideal growth cycle underneath
- adaptive state-aware planner operates on top
- the system can have ideal default progressions for different business types without pretending there is one universal fixed script

### Stage-aware guidance

CEO should be able to generate guidance like:

- "You are in validation stage."
- "The next best tasks are onboarding, analytics, and pricing setup."
- "Because the current product already has auth and a working core flow."

## Task Decomposition Rules

When the CEO decides to create multiple tasks:

- split into **founder-visible deliverables**, not internal engineering substeps
- each task should be independently verifiable
- each task consumes exactly 1 credit
- tasks should be ordered by dependency, then by leverage
- the founder should understand what each task produces

**Anti-pattern:** splitting "add auth + dashboard" into "create migration", "add middleware", "build UI" — these are engineering substeps, not founder deliverables. The correct split is "add authentication flow" (1 credit) and "build founder dashboard" (1 credit).

## CEO Tool Surface

The CEO operates with a privileged control-plane tool surface distinct from worker agents:

### Control and task tools (~30)

- task CRUD (create, update, list, get, approve, reject)
- queue management (reorder, prioritize)
- report access
- document access and suggestions
- company state inspection
- subscription and credit state access
- bug reporting and feature suggestion (`report_bug`, `suggest_feature`)

### Routing and introspection tools (~6)

- `find_best_agent(query)` — returns recommended agent, confidence, similar task counts, average scores, success rates, common outcomes, warnings
- `find_agent_for_task(task_tag)` — capability/rules-based agent lookup
- capabilities inspection
- agent availability checks

### Memory tools (2)

- `search_memory` — search across memory layers
- `read_memory` — read specific memory layer content
- (CEO also has write access to memory layers, unlike workers)

### Search tools (~6)

- web search (Tavily in Baljia, replacing Brave in Polsia)
- search summarization

## Routing Tool Behavior

### `find_best_agent(query)`

Returns:

- recommended agent
- confidence score
- similar task count from history
- average quality scores
- success rates
- common outcomes
- warnings or suggestions

### `find_agent_for_task(task_tag)`

- capability and rules-based lookup
- more deterministic than `find_best_agent`
- the two routing systems can disagree — CEO must use judgment

### Volume bias override

Historical routing can be volume-biased: agents with more historical attempts (especially Engineering) accumulate recommendation gravity even when their score is worse than a specialist's. CEO should:

- prefer specialist fit over historical volume
- check whether the recommended agent actually has the tools needed
- override routing when a specialist clearly fits better

## Rate Limiting and Anti-Abuse

### Escalation ladder (6 steps)

| Step | Action | Trigger |
|---|---|---|
| 1. Observe and log | Silent monitoring | Normal usage |
| 2. Soft-limit | Gentle throttling | Usage approaches soft ceiling |
| 3. Degrade to cheaper mode | Shorter context, cheaper model, summary mode | Sustained high usage |
| 4. Temporary cooldown | Brief pause before resuming | Bursty exploit-like behavior |
| 5. Flag for review | Internal alert to platform ops | Repeated abnormal patterns |
| 6. Suspend | Account-level block | Confirmed abuse after review |

### Graceful degradation order

Before hard blocking, the platform should try:

1. cheaper model
2. shorter context window
3. less frequent search/tool use
4. summary mode instead of deep mode
5. cooldown
6. review
7. hard block only if necessary

### Anomaly signals

- unusually high model-token burn
- unusually high search/tool usage
- repeated long CEO chat sessions with low execution value
- bursty repeated task-scoping or quote requests
- repeated regeneration loops
- abnormal browser or tool usage relative to account history

### Trust-aware elasticity

Not every heavy user is abusive. Trust factors that increase elasticity:

- account age
- paid vs trial state
- history of successful completed tasks
- payment health
- dispute/abuse history
- connected founder-owned integrations

Trusted paid accounts get more elasticity than fresh trial accounts.

### Rolling windows

Usage is monitored across multiple windows simultaneously:

- per request
- per 10 minutes
- per hour
- per day
- per month

This catches both burst abuse and slow sustained overconsumption.

### Margin-first budgeting

Each account type has a hidden expected-cost envelope:

- paid companies → larger hidden budget envelope
- trial accounts → smaller envelope
- free planning-only usage → smallest envelope

If projected usage would push the account below acceptable margin, controls tighten automatically.

### Distinguishing valid use from abuse

Exploit-like patterns (should trigger escalation):

- rapid-fire identical or near-identical requests
- systematic probing of limits or capabilities
- requests designed to maximize token output with no execution intent
- repeated quote requests with no task creation
- conversation patterns that look like prompt extraction attempts

Heavy but valid patterns (should be allowed with elasticity):

- long strategic planning sessions that lead to task creation
- detailed debugging discussions about failed tasks
- thorough onboarding conversations for complex businesses

## CEO Session Continuity

Each new chat session does not carry the full prior transcript automatically. Continuity is restored from:

- **Short-range:** recent conversation context within the active session
- **Medium-range:** Layer 2 memory (autosaved every ~20 messages) and other memory layers
- **Long-range:** structured product state (tasks, reports, documents, credits, subscription)
- **Live freshness:** MCP-backed access to current tools, documents, reports, and connected data

This is stronger than raw transcript replay alone or memory layers alone.

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| "Chat and planning are free." | Rate limiting stays within budget envelope | Degraded mode, not billing | Guaranteed free lane with hidden cost controls |
| "CEO knows the company context." | CEO continuity layer has richer direct access than workers | CEO explains limits honestly | Best-effort continuity with real asymmetry |
| "CEO will tell you the cost before running." | Governance returns a valid credit quote | CEO explains uncertainty or inability to quote | Guaranteed quote attempt before execution |
| "CEO pushes back on bad ideas." | Decision model classifies and narrows/refuses | CEO may miss edge cases | Best-effort with structured decision flow |
| "CEO routes to the best agent." | Routing tools return valid recommendations | CEO falls back to rules-based routing | Best-effort routing with override capability |

## Data and Interface Contract

### CEO decision output

- `decision_type`: `chat_only | one_task | multiple_tasks | blocked | narrowed | refused`
- `credit_quote`: governance-returned quote object
- `selected_agent_family`: chosen worker lane
- `task_briefs`: array of structured task descriptions
- `decomposition_reason`: why split was needed (if applicable)
- `blockers`: array of missing prerequisites
- `founder_explanation`: natural language summary of decision

### Governance quote request

- `company_id`
- `founder_message_summary`
- `requested_scope`
- `company_state_snapshot`
- `available_credits`

### Governance quote response

- `credits_required`
- `task_split`
- `founder_safe_reason`
- `included_scope`
- `blockers`
- `executability_type`
- `required_prerequisites`

### Rate limit state

- `account_trust_tier`
- `current_window_usage` (per-window counters)
- `cost_envelope_remaining`
- `escalation_level`: `observe | soft_limit | degraded | cooldown | flagged | suspended`
- `last_escalation_at`

## Implementation Trap Notes

### Trap 1: treating CEO as a thin task-creation wrapper

- **Wrong assumption:** CEO just parses the message and creates a task with a tag.
- **Why it is wrong:** the 10-step decision flow, credit quoting, decomposition, and feasibility checking are the core value.
- **Correct interpretation:** CEO is a genuine planning/orchestration brain.

### Trap 2: exposing internal economics through CEO

- **Wrong assumption:** the CEO can explain costs in terms of tokens, models, or margins.
- **Why it is wrong:** this turns CEO into a leak surface for internal economics.
- **Correct interpretation:** CEO speaks in credits and tasks only, relaying governance quotes.

### Trap 3: treating free planning as unlimited

- **Wrong assumption:** because planning is free, there are no cost controls on chat.
- **Why it is wrong:** free chat is an LLM cost the platform absorbs; unbounded usage breaks margin.
- **Correct interpretation:** free planning with hidden rate limiting and margin-first budgeting.

### Trap 4: copying reactive planning from Polsia

- **Wrong assumption:** CEO should just spot the next missing thing and queue it.
- **Why it is wrong:** stage-aware gap-based planning is stronger and a Baljia improvement.
- **Correct interpretation:** CEO plans from ideal stage progression, not from whatever looks obviously missing.

### Trap 5: trusting historical routing blindly

- **Wrong assumption:** `find_best_agent` always returns the right agent.
- **Why it is wrong:** historical routing is volume-biased and may recommend agents without the needed tools.
- **Correct interpretation:** CEO uses routing tools as input, not as final authority.

## Acceptance Criteria

- CEO decision flow covers all 10 steps before creating tasks
- free planning lane is enforced — chat/planning/scoping never consumes credits
- credit quotes follow the 5-field founder-safe format
- CEO never reveals token costs, margins, or internal scoring
- task decomposition produces founder-visible deliverables, not engineering substeps
- rate limiting follows the 6-step escalation ladder
- stage-aware planning uses archetype and company state, not just reactive gap-spotting
- routing overrides historical volume bias when specialist fit is clear
- governance handoff keeps internal economics hidden from the CEO conversation surface
- session continuity restores context from memory layers and live state, not raw transcript replay

## Plain-Language New-Reader Tests

- What happens when a founder sends a message? (10 steps)
- Does chatting and planning cost credits?
- How does CEO decide how many credits something costs?
- What does CEO say when it cannot fulfill a request?
- Can CEO reveal how much a task costs the platform internally?
- How does the platform prevent chat from becoming an infinite cost drain?
- How does CEO decide what to work on next for a company?

If a new reader cannot answer these directly from this file, the CEO model is still ambiguous.

## Traceability

### Source material

- Polsia_Exact_Architecture_Details.md §26.2.1 (CEO decision model, lines 9575-9642)
- Polsia_Exact_Architecture_Details.md §2.5E (credit quoting, lines 1225-1287)
- Polsia_Exact_Architecture_Details.md §2.5F (abuse guardrails, lines 1289-1503)
- Polsia_Exact_Architecture_Details.md §2.4A (free planning lane, lines 704-718)
- Polsia_Exact_Architecture_Details.md §26.2.1B (stage-aware planning, lines 9644-9758)
- Polsia_Exact_Architecture_Details.md §11.3-11.6 (routing, CEO tools, lines 4598-4794)

### Source decisions

- `DEC-CEO-001` (CEO as task-shaping layer)
- `DEC-CEO-002` (CEO memory asymmetry)
- `DEC-PLAN-001` (free planning lane)
- `DEC-ABUSE-001` (rate limiting escalation)

## Change Log

- `2026-04-13`: created CEO/chat and founder conversation spec from Polsia source material and audit findings
