# Baljia Project Understanding Order

Use this file if you want to understand Baljia quickly without reading the whole repo randomly.

## Read these 9 files in order

### 1. `CLAUDE.md`
Why:
- project summary
- stack
- locked build decisions
- what is built vs missing
- top-level orientation

### 2. `docs/Baljia_Technical_Architecture_Spec_v2.md`
Why:
- main architecture truth
- system topology
- service boundaries
- database schema
- API contracts
- worker / onboarding / verification model

### 3. `docs/BALJIA_AGENTIC_SYSTEM_DEVELOPMENT_PLAN.md`
Why:
- explains how the current repo should evolve
- clarifies runtime vs orchestration vs workers
- gives the intended internal architecture direction

### 4. `src/lib/db/schema.ts`
Why:
- Drizzle schema is the **live** database source of truth
- applied to Neon via `drizzle-kit push`
- do not rely on `supabase/migrations/*.sql` — that folder is legacy/reference

### 5. `src/types/index.ts`
Why:
- current TypeScript model of the system
- entities
- enums
- status values
- service-facing types

### 6. `src/lib/agents/agent-factory.ts`
Why:
- biggest current file for understanding agent runtime behavior
- prompt assembly
- tool wiring
- model loop behavior

### 7. `src/lib/agents/worker-launcher.ts`
Why:
- shows how execution starts
- shows worker launch behavior
- shows execution handoff path

### 8. `src/lib/services/onboarding.service.ts`
Why:
- best file for understanding current onboarding/bootstrap implementation
- shows how company creation currently works in code

### 9. `src/lib/services/governance.service.ts`
Why:
- best file for understanding task sizing
- scoping logic
- execution mode selection
- credit/governance behavior

---

## Optional next 3 files

### 11. `src/lib/services/verification.service.ts`
Why:
- shows how completion is supposed to be checked
- helps understand verifier authority

### 12. `src/lib/services/task.service.ts`
Why:
- shows task lifecycle behavior in code
- helps connect UI/tasks/runtime

### 13. `src/lib/services/memory.service.ts`
Why:
- shows how memory is currently modeled
- useful for understanding context and continuity logic

---

## Short advice

If you only want the fastest understanding path, read:

1. `CLAUDE.md`
2. `docs/Baljia_Technical_Architecture_Spec_v2.md`
3. `docs/BALJIA_AGENTIC_SYSTEM_DEVELOPMENT_PLAN.md`
4. `src/lib/agents/agent-factory.ts`

That gives you the fastest high-level understanding of:
- what Baljia is
- how it is supposed to work
- how it currently works in code
