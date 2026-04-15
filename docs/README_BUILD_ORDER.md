# Baljia Build Order Guide

This file explains which docs to use, in what order, when building Baljia.

## Core rule

Do **not** build from a single document alone.

Use the docs in layers:
1. product truth
2. technical system truth
3. edge cases and corrections
4. implementation direction

---

## Primary build docs

These are the **3 primary files to use when building Baljia**:

### 1. `Baljia_Technical_Architecture_Spec_v2.md`
Use for:
- service boundaries
- database schema
- API contracts
- event bus contracts
- worker/verification/onboarding specifications
- system topology

This is the main system-contract doc.

### 2. `BALJIA_AGENTIC_SYSTEM_DEVELOPMENT_PLAN.md`
Use for:
- how to evolve the current repo into the right internal architecture
- runtime/core refactor direction
- orchestration vs execution split
- capability registry direction
- connector subsystem direction
- memory/context architecture direction
- worker isolation strategy
- phased implementation order

This is the implementation-direction doc.


---

## Supporting reference docs

### `Baljia_Knowledge_Graph_v2.md`
Use for:
- founder experience
- product behavior
- agent roles
- lifecycle and operating model
- locked product decisions
- broader product truth and rationale

Use this when implementation questions need product-behavior clarification.

### `Baljia_Audit_Findings.md`
Use for:
- historical audit context
- why certain spec fixes exist
- older contradictions and failure patterns that informed v2

This is useful as a background/reference file, but should not be treated as one of the primary build docs if its findings are already incorporated.
---

## Recommended reading order

### Default build order
1. `Baljia_Technical_Architecture_Spec_v2.md`
2. `BALJIA_AGENTIC_SYSTEM_DEVELOPMENT_PLAN.md`


### When to read `Baljia_Knowledge_Graph_v2.md`
Read it as a secondary check when you need:
- founder-experience clarification
- product-behavior clarification
- lifecycle or journey clarification
- locked product intent that is broader than the implementation docs

### If building architecture/runtime/control-plane code
1. `Baljia_Technical_Architecture_Spec_v2.md`
2. `BALJIA_AGENTIC_SYSTEM_DEVELOPMENT_PLAN.md`

4. `Baljia_Knowledge_Graph_v2.md` only when product behavior needs clarification

### If building founder-facing product/UI
1. `Baljia_Technical_Architecture_Spec_v2.md`
2. `BALJIA_AGENTIC_SYSTEM_DEVELOPMENT_PLAN.md`

4. `Baljia_Knowledge_Graph_v2.md` for surface-behavior validation

### If building workers/agents/tools
1. `Baljia_Technical_Architecture_Spec_v2.md`
2. `BALJIA_AGENTIC_SYSTEM_DEVELOPMENT_PLAN.md`

4. `Baljia_Knowledge_Graph_v2.md` for capability/promise validation
---

## Practical usage rule

When implementing a feature:

- use `Baljia_Technical_Architecture_Spec_v2.md` to confirm the system contract
- use `BALJIA_AGENTIC_SYSTEM_DEVELOPMENT_PLAN.md` to decide where the code should live and how the internals should evolve

- use `Baljia_Knowledge_Graph_v2.md` only when you need product-behavior clarification or broader product intent
- use `Baljia_Audit_Findings.md` only when historical audit context is useful

---

## What not to do

Do not:
- treat `BALJIA_AGENTIC_SYSTEM_DEVELOPMENT_PLAN.md` as replacing the original architecture docs
- build from the technical spec alone without checking product behavior
- build from the knowledge graph alone without checking implementation contracts
- ignore audit findings when something looks underspecified

---

## Short version

If you are building Baljia, the default 3 docs to use are:

1. `Baljia_Technical_Architecture_Spec_v2.md`
2. `BALJIA_AGENTIC_SYSTEM_DEVELOPMENT_PLAN.md`

Use `Baljia_Knowledge_Graph_v2.md` as a secondary reference when you need product-behavior clarification.
Use `Baljia_Audit_Findings.md` as historical/reference context when needed.