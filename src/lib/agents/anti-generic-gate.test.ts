import { describe, expect, it } from 'vitest';

import {
  evaluateDomainGate,
  isGenericFallback,
  readDomainGateMode,
} from './anti-generic-gate';

describe('anti-generic-gate: mode resolution', () => {
  it('default mode is warn', () => {
    expect(readDomainGateMode({})).toBe('warn');
    expect(readDomainGateMode({ ENGINEERING_DOMAIN_GATE_MODE: '' })).toBe('warn');
  });

  it('respects off/warn/hard', () => {
    expect(readDomainGateMode({ ENGINEERING_DOMAIN_GATE_MODE: 'off' })).toBe('off');
    expect(readDomainGateMode({ ENGINEERING_DOMAIN_GATE_MODE: 'warn' })).toBe('warn');
    expect(readDomainGateMode({ ENGINEERING_DOMAIN_GATE_MODE: 'hard' })).toBe('hard');
  });

  it('rejects unknown values and falls back to warn', () => {
    expect(readDomainGateMode({ ENGINEERING_DOMAIN_GATE_MODE: 'strict' })).toBe('warn');
  });

  it('case-insensitive', () => {
    expect(readDomainGateMode({ ENGINEERING_DOMAIN_GATE_MODE: 'HARD' })).toBe('hard');
    expect(readDomainGateMode({ ENGINEERING_DOMAIN_GATE_MODE: 'Off' })).toBe('off');
  });
});

describe('anti-generic-gate: isGenericFallback', () => {
  it('true for empty selection', () => {
    expect(isGenericFallback([])).toBe(true);
  });

  it('true for crud + dashboard + deployment_render only', () => {
    expect(isGenericFallback(['crud', 'dashboard', 'deployment_render'])).toBe(true);
    expect(isGenericFallback(['crud'])).toBe(true);
    expect(isGenericFallback(['dashboard', 'deployment_render'])).toBe(true);
  });

  it('false when any non-generic capability is selected', () => {
    expect(isGenericFallback(['crud', 'dashboard', 'deployment_render', 'booking'])).toBe(false);
    expect(isGenericFallback(['cart_orders_checkout'])).toBe(false);
    expect(isGenericFallback(['marketplace'])).toBe(false);
  });
});

describe('anti-generic-gate: evaluateDomainGate', () => {
  it('passes when off regardless of fallback', () => {
    const result = evaluateDomainGate({
      taskTitle: 'Online store with cart',
      taskDescription: 'cart and checkout',
      selectedCapabilities: ['crud', 'dashboard', 'deployment_render'],
    }, 'off');
    expect(result.kind).toBe('pass');
  });

  it('passes when no domain signals (generic infra task)', () => {
    const result = evaluateDomainGate({
      taskTitle: 'Add /healthz endpoint',
      taskDescription: 'Return ok 200',
      selectedCapabilities: ['crud', 'deployment_render'],
    }, 'hard');
    expect(result.kind).toBe('pass');
  });

  it('passes when domains present and plan is NOT generic', () => {
    const result = evaluateDomainGate({
      taskTitle: 'Salon booking',
      taskDescription: 'Customers book slots',
      matchedDomains: ['local_service_booking'],
      selectedCapabilities: ['crud', 'dashboard', 'deployment_render', 'booking', 'email_notifications'],
    }, 'hard');
    expect(result.kind).toBe('pass');
  });

  it('warns in warn mode when signals present + plan is generic', () => {
    const result = evaluateDomainGate({
      taskTitle: 'Online clothing store with cart and checkout',
      taskDescription: 'Customers buy products and pay via Stripe',
      selectedCapabilities: ['crud', 'dashboard', 'deployment_render'],
    }, 'warn');
    expect(result.kind).toBe('warn');
    if (result.kind === 'warn') {
      expect(result.marker).toMatch(/DOMAIN_GATE_WARNING/);
      expect(result.reason).toMatch(/DOMAIN_GENERIC_FALLBACK_GATE/);
    }
  });

  it('blocks in hard mode when signals present + plan is generic', () => {
    const result = evaluateDomainGate({
      taskTitle: 'Online clothing store with cart and checkout',
      taskDescription: 'Customers buy products and pay via Stripe',
      selectedCapabilities: ['crud', 'dashboard', 'deployment_render'],
    }, 'hard');
    expect(result.kind).toBe('block');
    if (result.kind === 'block') {
      expect(result.marker).toMatch(/DOMAIN_GATE_BLOCKED/);
      expect(result.reason).toMatch(/DOMAIN_GENERIC_FALLBACK_GATE/);
      expect(result.reason).toMatch(/match_domain_app/);
    }
  });

  it('uses provided matchedDomains as signal source', () => {
    const result = evaluateDomainGate({
      taskTitle: 'X',
      taskDescription: 'Y',
      matchedDomains: ['ecommerce_store'],
      selectedCapabilities: ['crud', 'dashboard', 'deployment_render'],
    }, 'hard');
    expect(result.kind).toBe('block');
  });
});
