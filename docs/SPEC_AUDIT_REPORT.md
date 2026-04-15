# Baljia AI Spec Audit Report

## Scope audited
This audit covers the full internal spec corpus under `specs/internal/`, including:

### Core specs
- `specs/internal/control-plane-runtime-and-task-agents.md`
- `specs/internal/billing-credits-and-subscription-state.md`
- `specs/internal/onboarding-bootstrap.md`
- `specs/internal/founder-dashboard-and-taskboard.md`
- `specs/internal/roadmap-and-documents.md`
- `specs/internal/live-wall-and-projections.md`
- `specs/internal/ceo-chat-and-founder-conversation.md`
- `specs/internal/platform-ops-and-self-healing.md`

### Control-plane children
- `specs/internal/control-plane/control-plane-overview.md`
- `specs/internal/control-plane/runtime-entities-and-task-lifecycle.md`
- `specs/internal/control-plane/scheduler-queue-night-shift-and-recurring.md`
- `specs/internal/control-plane/lane-and-agent-responsibility-model.md`
- `specs/internal/control-plane/memory-context-tools-and-connectors.md`
- `specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md`

### Billing children
- `specs/internal/billing/trial-and-execution-unlock.md`
- `specs/internal/billing/purchase-surfaces-and-expansion.md`
- `specs/internal/billing/credits-and-task-charging.md`
- `specs/internal/billing/subscription-continuity-and-hosting-state.md`
- `specs/internal/billing/internal-ledgers-and-unit-economics.md`

### Supporting documents
- `specs/internal/confuse.md`
- `specs/internal/decide-later.md`
- `specs/internal/README.md`
- `specs/internal/claude_spec_workflow.md`
- `specs/internal/spec-fix-order.md`

---

## Executive summary
The spec system is much stronger than the code in terms of conceptual clarity, but it still has a handful of unresolved authority problems that would create implementation drift if left open.

The biggest remaining risks are:

1. recurring materialization contradicts itself
2. stop-loss / founder-decision outcomes are not represented in the runtime state model
3. night-shift ownership is inconsistent across billing specs
4. repair/remediation semantics are not fully closed as one canonical model
5. several important product seams remain under-specified: CEO quote contract, document edit rules, live wall truth rules, and platform-ops authority

The codebase already shows drift on several of these unresolved areas, which confirms these are not theoretical issues.

---

# Critical spec issues

## 1) Recurring materialization contradicts itself
**Files**
- `specs/internal/control-plane/scheduler-queue-night-shift-and-recurring.md:162`
- `specs/internal/control-plane/scheduler-queue-night-shift-and-recurring.md:237`

**Issue**
The spec first says every due recurring occurrence **must materialize immediately as a durable task**. Later, it says once the cap is reached, further due occurrences are **logged but not materialized**.

**Why it matters**
This breaks the claimed alignment between:
- board truth
- scheduler truth
- runtime truth

**Impact**
Implementations will diverge on whether hidden recurring intents are real system objects or not.

**Recommended fix**
Choose one canonical rule:
- always materialize and mark gated, or
- permit non-materialized scheduler intents and define them as first-class objects.

---

## 2) Stop-loss produces an outcome the runtime state model does not own
**Files**
- `specs/internal/control-plane-runtime-and-task-agents.md`
- `specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md`
- `specs/internal/control-plane/runtime-entities-and-task-lifecycle.md:332`

**Issue**
The remediation specs describe a **founder-decision / re-scope posture** after stop-loss, but the runtime lifecycle has no matching canonical state.

**Why it matters**
A major execution outcome exists conceptually but cannot be represented cleanly in the canonical state machine.

**Impact**
UI, scheduler, reporting, and retry logic will each invent their own meaning.

**Recommended fix**
Add one of:
- a canonical task state,
- a canonical founder-decision object,
- or an explicitly modeled blocked/escalated runtime posture.

---

## 3) Night-shift scope is inconsistent across billing specs
**Files**
- `specs/internal/billing-credits-and-subscription-state.md:51`
- `specs/internal/billing/trial-and-execution-unlock.md:205`
- `specs/internal/billing/subscription-continuity-and-hosting-state.md`

**Issue**
The billing umbrella says manual credits and night shifts are founder-level shared pools, but `trial-and-execution-unlock.md` still models `trial_night_shifts_remaining` per company.

**Why it matters**
This affects:
- schema design
- scheduler fairness
- multi-company founders
- trial-to-paid transition logic

**Impact**
Different teams will implement founder-level vs company-level night-shift behavior differently.

**Recommended fix**
Lock one of these explicitly:
- founder-level night-shift pool
- company-level night-shift pool
- hybrid model with exact conversion/priority rules

---

## 4) Repair/remediation semantics are still not fully closed
**Files**
- `specs/internal/control-plane/runtime-entities-and-task-lifecycle.md:363`
- `specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md`
- `specs/internal/confuse.md:84`

**Issue**
The specs strongly imply that repair should remain on the original task, but the surrounding language still leaves too much room for alternate implementations.

**Why it matters**
Repair semantics drive:
- trust recovery
- billing integrity
- founder-visible history
- execution analytics

**Impact**
Teams can still accidentally model remediation as a second task.

**Recommended fix**
Make one canonical rule unmissable:
- repair is always another `Run` on the original `Task`
- never a second founder-purchased task

---

# High-priority spec issues

## 5) CEO quote contract is internally inconsistent
**Files**
- `specs/internal/ceo-chat-and-founder-conversation.md:198`

**Issue**
The spec defines a 5-field founder-safe quote object, but other sections imply extra fields like `executability_type` and `required_prerequisites`.

**Why it matters**
The quote contract is not stable.

**Impact**
Implementations may leak internal governance fields into founder-visible surfaces or diverge on the interface.

**Recommended fix**
Split the contracts:
- founder-safe quote object
- internal governance decision object

---

## 6) Verification policy is not fully canonically closed
**Files**
- `specs/internal/control-plane/control-plane-overview.md`
- `specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md`
- `specs/internal/control-plane/runtime-entities-and-task-lifecycle.md`

**Issue**
Verification is supposed to be the final authority, but the family still does not fully close:
- the verification policy enum
- whether `verifying` is a canonical runtime state
- the exact handoff between run completion and founder-visible finality

**Why it matters**
This is a core control-plane invariant.

**Impact**
Runtime, dashboard, and analytics can disagree on when work is actually done.

**Recommended fix**
Add one canonical end-to-end verification contract across overview, runtime, and verification specs.

---

## 7) Session meaning is still somewhat overloaded
**Files**
- `specs/internal/confuse.md:84`
- `specs/internal/control-plane/runtime-entities-and-task-lifecycle.md:258`

**Issue**
The cleanup guidance warns against overloading `Session`, but runtime examples still use it for execution, verification, remediation, and onboarding bootstrap.

**Why it matters**
This creates ambiguity in schema/API and weakens the object model.

**Impact**
Developers may stretch one entity across too many concerns.

**Recommended fix**
Either:
- keep `Session` strictly runtime-execution-scoped, or
- officially bless multiple session types and remove conflicting warnings elsewhere.

---

## 8) Platform ops authority boundary is not fully closed
**Files**
- `specs/internal/platform-ops-and-self-healing.md`
- `specs/internal/control-plane/control-plane-overview.md`

**Issue**
Platform ops is meant to stay hidden and not bypass ordinary governance loosely, but is also allowed to kill runs, block task shapes, mark failures, and influence routing.

**Why it matters**
Hidden ops needs a tightly defined seam with visible product state.

**Impact**
Invisible actors may mutate founder-visible truth without a clear contract.

**Recommended fix**
Define which ops actions are:
- direct authority
- advisory only
- must pass through runtime/governance

---

## 9) Document editing behavior is not operationally crisp
**Files**
- `specs/internal/roadmap-and-documents.md`
- `specs/internal/ceo-chat-and-founder-conversation.md:180`

**Issue**
CEO spec says document editing is free, while roadmap/documents says post-bootstrap updates usually stage as suggestions except explicit founder requests or strong signals.

**Why it matters**
A common founder action still lacks an unmistakable operational rule.

**Impact**
Different implementations may choose direct mutation vs suggestion staging inconsistently.

**Recommended fix**
Define a simple rule table:
- explicit founder edit request → direct edit
- system-suggested improvement → suggestion
- ambiguous / inferred change → suggestion

---

## 10) Live wall truth model is still underdefined
**File**
- `specs/internal/live-wall-and-projections.md`

**Issue**
The spec is conceptually strong but still weak on:
- source priority
- freshness TTLs
- projection event taxonomy
- redaction rules
- current-vs-historical authority

**Why it matters**
Projection layers drift fast without hard source rules.

**Impact**
Public proof and founder-facing “live” narratives can become untrustworthy.

**Recommended fix**
Add a canonical projection input contract and freshness model.

---

# Important unresolved decisions still blocking safe implementation

## 11) Repair stop-loss is only partially locked
**File**
- `specs/internal/decide-later.md:5`

Still unresolved:
- max elapsed repair time
- max internal remediation cost
- side-effect acceleration rules

## 12) Credit model is still incomplete
**File**
- `specs/internal/decide-later.md:28`

Still unresolved:
- credit expiration / rollover
- extra credit pack sizes and pricing

## 13) Night-shift fairness is still unresolved
**File**
- `specs/internal/decide-later.md:48`

Still unresolved:
- max companies per founder
- exact fairness algorithm

## 14) Keep-live is still commercially incomplete
**File**
- `specs/internal/decide-later.md:43`

Still unresolved:
- exact pricing
- whether any execution allowance exists

---

# Biggest spec-to-code drifts

## 15) Manual credits vs night-shift capacity is not implemented per spec
**Code**
- `src/lib/services/credit.service.ts`
- `src/lib/services/night-shift.service.ts`
- `src/app/api/onboarding/route.ts`

**Specs**
- `specs/internal/billing-credits-and-subscription-state.md`
- `specs/internal/billing/credits-and-task-charging.md`
- `specs/internal/control-plane/scheduler-queue-night-shift-and-recurring.md`

**Drift**
The specs distinguish founder-visible manual credits from subscription-funded night-shift capacity. The code does not cleanly preserve that distinction.

---

## 16) Remediation is implemented as a new task, not same-scope repair
**Code**
- `src/lib/services/remediation.service.ts:48`

**Specs**
- `specs/internal/control-plane/runtime-entities-and-task-lifecycle.md:397`
- `specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md`

**Drift**
The code creates retry/simplified tasks. The spec wants repair to stay on the original task lineage.

---

## 17) Dashboard still exposes raw runtime mechanics instead of founder-safe projections
**Code**
- `src/components/dashboard/TaskBoard.tsx`
- `src/components/dashboard/TaskCard.tsx`
- `src/components/dashboard/TaskDetailDialog.tsx`

**Specs**
- `specs/internal/founder-dashboard-and-taskboard.md`
- `specs/internal/control-plane/runtime-entities-and-task-lifecycle.md:378`

**Drift**
The founder-facing UI still surfaces raw internal states and mechanics rather than the founder-safe projection model described by the specs.

---

## 18) Runtime entity model is only partially adopted in implementation
**Code**
- `src/lib/db/schema.ts`
- `src/lib/agents/worker-launcher.ts`
- `src/lib/services/task.service.ts`

**Specs**
- `specs/internal/control-plane/runtime-entities-and-task-lifecycle.md`
- `specs/internal/control-plane/control-plane-overview.md`

**Drift**
The schema includes `sessions`, `runs`, `artifacts`, and `approval_records`, but the runtime behavior still centers mostly around `tasks` and `task_executions`.

---

## 19) Layer 3 memory is not yet truly platform-only in implementation
**Code**
- `src/lib/services/memory.service.ts`
- `src/lib/services/chat.service.ts`

**Spec**
- `specs/internal/control-plane/memory-context-tools-and-connectors.md`

**Drift**
The spec defines Layer 3 as anonymized, quality-gated, and platform-only. The current implementation is much more company-local in practice.

---

## 20) CEO 10-step flow is still more prompt-driven than system-enforced
**Code**
- `src/lib/agents/ceo/ceo.prompt.ts`
- `src/lib/agents/ceo/ceo.tool-handlers.ts`
- `src/lib/agents/ceo/ceo.agent.ts`

**Spec**
- `specs/internal/ceo-chat-and-founder-conversation.md`

**Drift**
The implementation is closer here than elsewhere, but the decision model is still less structurally enforced than the spec implies.

---

# Overall assessment

## What is strong
- Vocabulary is substantially improved.
- The control-plane family is cleaner than most architecture spec sets at this stage.
- `confuse.md` correctly identifies many real implementation traps.
- Founder-visible vs hidden-system separation is mostly strong.

## What is still risky
The remaining issues are mostly authority and contract issues, not writing-quality issues:

1. who owns night-shift truth and pools
2. how verification becomes canonical task truth
3. how repair/stop-loss outcomes become runtime truth
4. how hidden platform ops may change visible outcomes
5. how strongly the actual code follows the written model

---

# Recommended fix order

1. **Lock night-shift scope and fairness**
   - founder-level vs company-level pool
   - trial vs paid behavior
   - exact scheduler fairness rule

2. **Close repair/remediation semantics**
   - no alternate repair model
   - explicit stop-loss outcome
   - canonical founder-visible projection

3. **Close verification contract**
   - policy enum
   - runtime state semantics
   - final authority handoff

4. **Close approval lineage**
   - approval object
   - scope binding
   - invalidation on edits/repair
   - durable authority model

5. **Close document-edit and live-wall source rules**
   - direct edit vs suggestion
   - event-source truth for projections
