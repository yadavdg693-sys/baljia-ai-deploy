# Spec: Internal Ledgers and Unit Economics

- `Spec ID`: `SPEC-BILL-105`
- `Status`: rebuilt
- `Subsystem`: billing internal ledgers and unit economics
- `Classification`: internal system
- `Sensitivity`: internal only with sanitized build translation
- `Parent spec`: [specs/internal/billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md)
- `Parent build spec`: [specs/build/billing/internal-ledgers-and-unit-economics.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/billing/internal-ledgers-and-unit-economics.md)

## Purpose

Define the hidden money model that sits underneath founder-visible credits, subscription status, ads spend, company revenue, and payouts so the product can stay founder-simple while remaining finance-correct internally.

This child spec owns:

- ledger-family boundaries
- hidden task actual-cost truth
- margin-relevant cost components
- payment and payout rail references
- hidden forecasting inputs from historical cost data
- fee-model conflict resolution

## Founder-Visible Contract

The founder should experience economics like this:

- founders should not see raw token, search, model, browser, verification, retry, or remediation accounting
- founder-visible `1 task = 1 credit` stays intact even when internal cost varies materially by task family
- the CEO may use `up to about 4 hours` only as a founder-safe scoping heuristic
- founders may see simple balances such as:
  - subscription active/inactive
  - task credits remaining
  - ads spend or campaign budget summaries
  - company revenue or withdrawable balance summaries
- founders should not be forced to reason about hidden ledger boundaries to use the product

## Hidden-System Contract

The hidden system must keep these money buckets separate:

- subscription and add-on billing
- founder-visible task-credit charging events
- hidden task actual-cost and margin accounting
- company runtime AI/search usage
- ads spend and ad-platform fee behavior
- company customer revenue
- founder payout and withdrawal balance

Stripe-backed processor rails must hold subscription, payment-method, transaction, and Connect-style payout references without collapsing them into one generic balance.

## In Scope

- ledger families and money-bucket boundaries
- task actual-cost truth
- margin-relevant cost components
- payment and payout rail references
- forecasting inputs from historical cost data
- fee-model conflict resolution
- ads-spend separation from manual task credits
- responsibility boundaries between visible charging and hidden accounting

## Out of Scope

- founder-visible credit copy
- hosted checkout UI
- keep-live and suspension messaging
- founder modal behavior

## Canonical Noun Imports

### `billing_lane`

- **Imported meaning:** economic lane that funds or accounts for work
- **Owned elsewhere:** billing umbrella
- **Used here for:** separating ledger families and execution economics

### visible `Credits`

- **Imported meaning:** founder-visible manual execution counter
- **Owned elsewhere:** credits-and-task-charging child
- **Used here for:** mapping visible charging to hidden accounting without redefining the founder rule

### `actual_internal_cost`

- **Meaning:** hidden post-run variable cost truth
- **Owned here**
- **Must not be confused with:** founder-visible charge event

## State Authority Section

| State / field | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| founder-visible credit charge event | Canonical elsewhere | credits-and-task-charging child | input to accounting story | re-owned here as founder pricing rule |
| post-run actual-cost record | Canonical | this spec | hidden unit-economics truth | exposed as founder pricing copy |
| ledger family boundaries | Canonical | this spec | keep money buckets separate | flattened into one generic balance |
| payout rail references | Canonical | this spec | track withdrawal state internally | confused with company revenue |
| `billing_lane` separation | Canonical elsewhere | billing umbrella | align ledgers to correct economic lane | redefined as worker or run identity |

## Accounting Story

1. the founder sees one simple pricing rule: `1 task = 1 credit`
2. a visible charge event is decided at execution start using the charging child spec
3. the task runs through one or more internal workers and control-plane steps
4. after the run completes, fails, or terminates, the system writes actual-cost data for what really happened
5. that record is decomposed into hidden cost components such as tokens, search, browser/runtime, verification, retries, remediation, and any triggered human-review cost
6. margin and task-family history update without changing the founder-visible charge that already happened
7. later forecasting can use this history to predict likely internal cost or likely future credit needs without redefining credits as raw-hours or raw-compute units

## Hidden Ledger Families

### 1. Subscription and Add-On Billing Ledger

Tracks founder payments to the platform for:

- subscription plans
- add-on companies
- add-on task-credit packs where applicable
- keep-live or continuity billing where applicable

### 2. Task Credit Ledger

Tracks the founder-visible unit event:

- credit consumed
- credit granted
- credit expired
- credit restored

This is the visible billing story, but it is not the full unit-economics story.

### 3. Task Actual-Cost Ledger

Tracks what the platform actually spent to deliver or attempt the task.

Must remain separate from the visible task-credit ledger because one founder credit can map to different real costs by task family.

### 4. Runtime AI/Search Ledger

Tracks company-runtime AI/search cost that belongs to the founder’s app/runtime rather than to Baljia doing platform work for the founder.

### 5. Ads Spend Ledger

Tracks campaign spend and associated fee behavior for ads.

- fully independent billing lane — not gated by subscription status or task credits
- founder deposits money for ads; platform takes `20%` as platform fee; remaining `80%` goes to actual ad spend
- ads continue operating regardless of subscription state as long as ads balance has funds

Must remain separate from manual task credits and company customer revenue.

### 6. Company Revenue Ledger

Tracks money earned by the founder’s business from customer payments.

Must stay isolated from platform subscription billing and task-cost accounting.

### 7. Payout and Withdrawal Ledger

Tracks withdrawable balances, holds, payout attempts, payout minimums/caps, and Connect-style payout state.

## Hidden-System Rule vs Founder-Visible Rule

### Founder-visible rule

- `1 task = 1 credit`
- one visible credits counter
- simple balances and summaries

### Hidden-system rule

- one founder-visible credit event is not the same thing as actual internal cost
- actual-cost accounting happens after the run resolves
- ledger families remain separate even when founders see summarized balances
- ads, runtime AI/search, customer revenue, and payouts must not collapse into the visible task-credit story

## Forecasting and Pricing Guidance

- historical actual-cost records become the basis for:
  - task-family margin analysis
  - pricing calibration
  - likely credit forecasting
  - internal guardrail tuning
- the platform should learn from real cost history instead of locking a raw-hours formula too early
- the founder-safe `~4 hour` language remains a soft scoping envelope, not the hidden billing formula
- tool-specific hidden limits remain internal cost controls and should not be exposed as raw founder counters

## Revenue and Fee Policy

- platform takes a `15%` fee on company customer revenue
- this is separate from Stripe's processing fees which the customer also pays
- fee breakdown for a $100 customer payment:
  - Stripe processing: ~$2.90 (2.9% + $0.30)
  - platform fee: $15.00 (15%)
  - net to founder company: $82.10
- fee percentage may be adjusted per plan tier in the future but `15%` is the locked default
- older conflicting evidence about no-extra-cut is superseded by this policy

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “1 task = 1 credit.” | visible charging spec applies at execution start | founder still sees simple visible charging even if hidden cost varies | Guaranteed founder-visible rule |
| “My balance is simple.” | hidden ledgers stay separate and summarized correctly | summaries may delay or omit internal-only components | Best-effort simple summaries over hidden ledgers |
| “Ads spend is separate.” | ads billing lane and ledger remain isolated | founder sees ads-specific billing state rather than task-credit depletion | Guaranteed lane separation |
| “My revenue is my company’s revenue.” | company revenue and payout ledgers remain separate from platform billing | holds/fees/disputes may affect withdrawable amount | Guaranteed separated accounting model |

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| execution started | founder-visible charge event recorded | charging boundary crossed | credits child | admitted execution exists | task-credit ledger entry may be written | later hidden cost accounting must not change this founder-visible event |
| run resolved | task actual-cost recorded | post-run costing step executes | this spec with verification child data | cost components available enough to record | task actual-cost ledger entry written | delayed components may append/update internal record later |
| customer payment received | company revenue delta recorded | payment settles | this spec | processor/payment refs available | company revenue ledger updated; platform fee and processor fee separated | payout/withdrawal flows consume later balances |
| payout requested | payout-state update | withdrawal flow advances | this spec | payout eligibility and rail refs available | payout ledger updated | later holds/failures update payout state |

## Data and Interface Contract

### Shared Ledger Entry Shape

- `ledger_entry_id`
- `founder_id`
- `company_id`
- `ledger_family`
- `ledger_subtype`
- `amount`
- `currency`
- `direction`
- `source_event_id`
- `processor_reference`
- `visibility_scope`
- `created_at`

### Ledger Families

- `subscription_billing_ledger`
- `task_credit_ledger`
- `task_actual_cost_ledger`
- `runtime_ai_search_ledger`
- `ads_spend_ledger`
- `company_revenue_ledger`
- `payout_ledger`

### Task Unit-Economics Record

- `task_run_id`
- `task_id`
- `company_id`
- `founder_credit_units_charged`
- `credit_source`
- `task_family`
- `worker_lane_ref`
- `actual_internal_cost`
- `model_cost`
- `search_cost`
- `browser_runtime_cost`
- `verification_cost`
- `retry_cost`
- `remediation_cost`
- `media_generation_cost`
- `human_review_cost`
- `margin_snapshot`
- `forecast_model_inputs`
- `recorded_at`

### Customer Payment and Revenue Record

- `customer_payment_id`
- `company_id`
- `gross_amount`
- `platform_fee_amount`
- `processor_fee_amount`
- `net_company_balance_delta`
- `chargeback_or_dispute_state`
- `processor_payment_reference`

### Payout Record

- `payout_id`
- `company_id`
- `connect_account_reference`
- `available_balance`
- `held_balance`
- `payout_status`
- `withdrawal_amount`
- `payout_reference`

### Visibility Rules

- `visibility_scope = founder_visible` is allowed only for simple summaries such as credit balance, ads summary, revenue balance, or payout status
- `visibility_scope = founder_summarized` is allowed for aggregates derived from hidden ledgers
- `visibility_scope = internal_only` is required for raw task actual-cost components and internal budget controls

## Edge Cases and Failure Handling

- actual-cost accounting must include retries and repair or margin becomes falsely optimistic
- same-scope repair remains founder-free in the visible charging story, but repair cost still belongs in hidden economics
- ads spend must never silently drain the manual task-credit pool
- runtime AI/search cost must never silently drain the manual task-credit pool
- payout state must stay separate from gross company revenue

## Implementation Trap Notes

### Trap 1: treating task credit ledger as full economics truth

- **Wrong assumption:** if one founder credit was charged, internal cost truth is already captured.
- **Why it is wrong:** visible charging and hidden cost accounting are different layers.
- **Correct interpretation:** keep task-credit ledger separate from task actual-cost ledger.

### Trap 2: collapsing all money into one balance

- **Wrong assumption:** subscriptions, ads, customer revenue, and payouts can share one conceptual balance.
- **Why it is wrong:** founders, finance logic, and policy boundaries need separate buckets.
- **Correct interpretation:** keep ledger families explicit.

### Trap 3: letting hidden economics leak into founder pricing copy

- **Wrong assumption:** actual cost should explain or change the founder-visible price directly.
- **Why it is wrong:** founder-visible simplicity is a deliberate product contract.
- **Correct interpretation:** hidden economics inform calibration, not visible unit language.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- credits child owns when a visible founder credit is charged
- verification/remediation child owns how post-run cost evidence is produced
- this child owns how those cost events are ledgered and kept separate from other money buckets
- continuity child owns entitlement and hosting posture, not unit-economics accounting
- purchase-surface child owns checkout entry and modal behavior, not internal ledger truth

### Reconciliation notes

- this rebuilt child now clearly separates founder-visible charge events from hidden actual-cost truth
- this rebuilt child now aligns with the rebuilt verification/remediation child on post-run costing inputs
- this rebuilt child now keeps ads, runtime AI/search, revenue, and payout ledgers separate from manual task credits

## Acceptance Criteria

- internal cost accounting exists separately from founder-visible task-credit charging
- every executed or terminated task can write a post-run actual-cost record
- actual-cost records capture the major variable-cost components needed for margin learning
- ads spend is not silently collapsed into the manual task-credit pool
- runtime AI/search cost is not silently collapsed into the manual task-credit pool
- company customer revenue stays separate from platform subscription billing
- payout and withdrawal state stays separate from company gross revenue
- later revenue-fee policy wins over the older conflicting no-extra-cut wording
- historical actual cost can be used for later prediction without exposing raw infra math to founders
- the founder-visible `1 task = 1 credit` rule remains intact

## Plain-Language New-Reader Tests

- What is the difference between a task credit charge and a task actual-cost record?
- Can ads spend ever drain task credits?
- Can company-runtime AI/search usage ever drain task credits?
- Is company revenue the same as withdrawable balance?
- Which reading wins on fees: the older no-extra-cut wording or the later policy-style fee reading?

If a new reader cannot answer these directly from this file, the hidden money model is still ambiguous.

## Traceability

### Source topics

- [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
- [knowledge/topics/payments-revenue-and-company-identity.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/payments-revenue-and-company-identity.md)
- [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)

### Source facts

- `FACT-MON-015`
- `FACT-MON-016`
- `FACT-EXEC-008`
- `FACT-EXEC-009`
- `FACT-EXEC-026`

### Source decisions

- `DEC-PAY-001`
- `DEC-PAY-002`
- `DEC-EXEC-004`
- `DEC-CEO-003`

### Claim-to-anchor audit

- hidden actual-cost accounting remains separate from founder-visible task-credit charging:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
    - [specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md)
  - facts:
    - `FACT-EXEC-008`
    - `FACT-EXEC-026`
  - decisions:
    - `DEC-EXEC-004`

- founder-safe scoping language stays separate from hidden billing formula:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-MON-016`
  - decisions:
    - `DEC-CEO-003`

- later fee-policy reading wins over the older no-extra-cut reading:
  - topics:
    - [knowledge/topics/payments-revenue-and-company-identity.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/payments-revenue-and-company-identity.md)
  - facts:
    - `FACT-MON-015`
  - decisions:
    - `DEC-PAY-002`

- tool-specific hidden limits remain internal cost controls, not founder-visible counters:
  - topics:
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
  - facts:
    - `FACT-EXEC-009`
  - decisions:
    - `DEC-EXEC-004`

## Change Log

- `2026-04-08`: seeded initial internal ledgers and unit economics spec
- `2026-04-12`: rebuilt the hidden money model to align with the billing umbrella and verification/cost siblings, keeping founder-visible charging simple while separating all internal money buckets and post-run actual-cost truth
