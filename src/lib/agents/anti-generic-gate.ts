// Anti-Generic Fallback Gate
//
// The Engineering agent has every reason to collapse any task into the
// "crud + dashboard + deployment_render" shape because those packs are the
// best-tested and the matcher gives them a strong baseline. That collapse
// is what produces a 7/7 core canary green run but a 0/12 extended run —
// the agent quietly forfeits product shape and ships a generic SaaS
// dashboard for tasks that wanted a storefront, a feed, a booking calendar,
// or a creator portfolio.
//
// This gate detects that collapse and, depending on `ENGINEERING_DOMAIN_GATE_MODE`,
// either warns the agent (warn mode, default) or refuses the architecture
// plan and forces a replanning loop (hard mode).
//
// Modes:
//   off   — gate is disabled (legacy behavior)
//   warn  — gate emits a warning marker but allows the call
//   hard  — gate emits BLOCKED and refuses the architecture plan
//
// The mode is read from process.env.ENGINEERING_DOMAIN_GATE_MODE.
// Default is `warn` for production rollout (Phase B), `hard` for canary/test runs.

import { hasClearDomainSignals } from './domain-registry';

export type DomainGateMode = 'off' | 'warn' | 'hard';

export type GateInput = {
  taskTitle?: string | null;
  taskDescription?: string | null;
  productContext?: string | null;
  matchedDomains?: string[];
  selectedCapabilities: string[];
};

export type GateResult =
  | { kind: 'pass' }
  | { kind: 'warn'; reason: string; marker: string }
  | { kind: 'block'; reason: string; marker: string };

const GENERIC_ONLY_CAPABILITIES = new Set(['crud', 'dashboard', 'deployment_render']);

export const DOMAIN_GENERIC_FALLBACK_GATE_MESSAGE =
  'DOMAIN_GENERIC_FALLBACK_GATE: this task has domain signals but the plan collapsed to generic CRUD/dashboard. Call match_domain_app, get_domain_pack, re-run match_capabilities (pass domains=[...]), load all packs, retrieve domain references, and re-run compose_app_architecture.';

export function readDomainGateMode(env: Record<string, string | undefined> = process.env): DomainGateMode {
  const raw = (env.ENGINEERING_DOMAIN_GATE_MODE ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'warn' || raw === 'hard') return raw;
  return 'warn'; // default per goal Phase B rollout
}

/**
 * Return true when the selected capabilities are *only* the generic fallback
 * (crud, dashboard, deployment_render — any subset of those three).
 */
export function isGenericFallback(selectedCapabilities: string[]): boolean {
  if (selectedCapabilities.length === 0) return true;
  return selectedCapabilities.every((cap) => GENERIC_ONLY_CAPABILITIES.has(cap));
}

export function evaluateDomainGate(input: GateInput, mode: DomainGateMode = readDomainGateMode()): GateResult {
  if (mode === 'off') return { kind: 'pass' };

  const hasMatchedDomains = (input.matchedDomains ?? []).filter(Boolean).length > 0;
  const hasSignals =
    hasMatchedDomains ||
    hasClearDomainSignals({
      title: input.taskTitle ?? undefined,
      description: input.taskDescription ?? undefined,
      productContext: input.productContext ?? undefined,
    });

  if (!hasSignals) return { kind: 'pass' };

  if (!isGenericFallback(input.selectedCapabilities)) return { kind: 'pass' };

  const reason = DOMAIN_GENERIC_FALLBACK_GATE_MESSAGE;
  if (mode === 'hard') {
    return {
      kind: 'block',
      reason,
      marker: 'DOMAIN_GATE_BLOCKED mode=hard fallback=generic',
    };
  }
  return {
    kind: 'warn',
    reason,
    marker: 'DOMAIN_GATE_WARNING mode=warn fallback=generic',
  };
}
