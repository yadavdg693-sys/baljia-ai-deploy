import { describe, expect, it } from 'vitest';

import {
  FRONTEND_PATTERNS,
  composeFrontendPlan,
  formatFrontendPlan,
  getFrontendPattern,
  listFrontendPatterns,
  patternsForDomain,
} from './frontend-pattern-registry';

const EXPECTED_PATTERN_IDS = [
  'landing_site',
  'dashboard',
  'marketplace_listing',
  'ecommerce_storefront',
  'booking_calendar',
  'admin_portal',
  'crm_pipeline',
  'inventory_table',
  'ai_workspace',
  'document_portal',
  'social_feed',
  'real_estate_listing',
  'media_creator_gallery',
  'education_lms',
  'health_plan_tracker',
  'construction_ops_board',
  'finance_dashboard',
];

describe('frontend-pattern-registry: pattern catalog', () => {
  it('contains all 17 patterns', () => {
    const ids = FRONTEND_PATTERNS.map((p) => p.id).sort();
    expect(ids).toEqual([...EXPECTED_PATTERN_IDS].sort());
  });

  it('every pattern has the required shape', () => {
    for (const pattern of FRONTEND_PATTERNS) {
      expect(pattern.title.length).toBeGreaterThan(0);
      expect(pattern.summary.length).toBeGreaterThan(0);
      expect(pattern.requiredComponents.length).toBeGreaterThanOrEqual(2);
      expect(pattern.requiredIcons.length).toBeGreaterThanOrEqual(2);
      expect(pattern.pageStructure.length).toBeGreaterThanOrEqual(2);
      expect(pattern.requiredText.length).toBeGreaterThanOrEqual(1);
      expect(pattern.antiPatterns.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('listFrontendPatterns returns the full list', () => {
    expect(listFrontendPatterns().map((p) => p.id).sort()).toEqual([...EXPECTED_PATTERN_IDS].sort());
  });

  it('getFrontendPattern resolves by id', () => {
    expect(getFrontendPattern('ecommerce_storefront')?.title).toBe('Ecommerce Storefront');
    expect(getFrontendPattern('not_a_pattern')).toBeNull();
  });

  it('patternsForDomain returns mapping', () => {
    expect(patternsForDomain('ecommerce_store')).toContain('ecommerce_storefront');
    expect(patternsForDomain('local_service_booking')).toContain('booking_calendar');
    expect(patternsForDomain('social_community')).toContain('social_feed');
    expect(patternsForDomain('advanced_ai_mixed')).toContain('ai_workspace');
  });
});

describe('frontend-pattern-registry: composeFrontendPlan', () => {
  it('selects domain-specific UI surface for ecommerce', () => {
    const plan = composeFrontendPlan({
      taskTitle: 'Online clothing store',
      domains: ['ecommerce_store'],
      capabilities: ['auth', 'crud', 'payments_stripe'],
    });
    expect(plan.patternIds).toContain('ecommerce_storefront');
    expect(plan.uiType).not.toBe('generic');
    expect(plan.pageMap.find((p) => p.path === '/shop')).toBeDefined();
    expect(plan.shadcnComponents).toContain('Sheet (cart drawer)');
    expect(plan.lucideIcons).toContain('ShoppingCart');
  });

  it('selects booking calendar for service booking', () => {
    const plan = composeFrontendPlan({
      taskTitle: 'Salon appointments',
      domains: ['local_service_booking'],
      capabilities: ['auth', 'crud', 'booking'],
    });
    expect(plan.patternIds).toContain('booking_calendar');
    expect(plan.pageMap.find((p) => p.path === '/book')).toBeDefined();
    expect(plan.browserUiRequiredButtons).toContain('Confirm booking');
    expect(plan.interactionContracts.some((contract) => contract.kind === 'book_reserve')).toBe(true);
  });

  it('selects ai_workspace for advanced AI', () => {
    const plan = composeFrontendPlan({
      taskTitle: 'Document AI pipeline',
      domains: ['advanced_ai_mixed'],
      capabilities: ['auth', 'uploads_storage', 'ai_openai'],
    });
    expect(plan.patternIds).toContain('ai_workspace');
    expect(plan.pageMap.find((p) => p.path.startsWith('/jobs'))).toBeDefined();
  });

  it('different domains produce different page maps (category-neutrality)', () => {
    const ecom = composeFrontendPlan({ domains: ['ecommerce_store'] }).pageMap.map((p) => p.uiType);
    const booking = composeFrontendPlan({ domains: ['local_service_booking'] }).pageMap.map((p) => p.uiType);
    const social = composeFrontendPlan({ domains: ['social_community'] }).pageMap.map((p) => p.uiType);
    const inventory = composeFrontendPlan({ domains: ['inventory_operations'] }).pageMap.map((p) => p.uiType);

    // They share `dashboard` / `admin_portal` only when admin_workflow is in capabilities.
    expect(new Set([ecom.join(','), booking.join(','), social.join(','), inventory.join(',')]).size).toBe(4);
  });

  it('falls back to dashboard when no domains supplied', () => {
    const plan = composeFrontendPlan({ taskTitle: 'Add /healthz endpoint', capabilities: ['crud', 'deployment_render'] });
    expect(plan.patternIds).toContain('dashboard');
    expect(plan.uiType).not.toBe('generic');
  });

  it('always pushes admin_portal when admin_workflow capability is present', () => {
    const plan = composeFrontendPlan({
      domains: ['business_website_crm'],
      capabilities: ['auth', 'crud', 'admin_workflow'],
    });
    expect(plan.patternIds).toContain('admin_portal');
  });

  it('every page in pageMap has required_text or marks audience public', () => {
    const plan = composeFrontendPlan({ domains: ['ecommerce_store'], capabilities: ['auth', 'crud', 'payments_stripe'] });
    for (const page of plan.pageMap) {
      // Either has required text OR is explicitly admin/account routes that just inherit from pattern.
      const hasContract = page.required_text.length > 0 || page.required_buttons.length > 0 || page.uiType === 'generic';
      expect(hasContract).toBe(true);
    }
  });

  it('blockingRules include the goal-mandated completion gates', () => {
    const plan = composeFrontendPlan({ domains: ['ecommerce_store'] });
    expect(plan.blockingRules.some((r) => r.includes('API docs'))).toBe(true);
    expect(plan.blockingRules.some((r) => r.includes('generic SaaS dashboard'))).toBe(true);
    expect(plan.blockingRules.some((r) => r.includes('call backend'))).toBe(true);
    expect(plan.blockingRules.some((r) => r.includes('mobile viewport'))).toBe(true);
    expect(plan.blockingRules.some((r) => r.includes('design_audit'))).toBe(true);
    expect(plan.blockingRules.some((r) => r.includes('design_critique'))).toBe(true);
    expect(plan.blockingRules.some((r) => r.includes('verify_browser_ui'))).toBe(true);
  });

  it('emits category-neutral interaction contracts for critical buttons/forms', () => {
    const store = composeFrontendPlan({ domains: ['ecommerce_store'], capabilities: ['auth', 'payments_stripe'] });
    expect(store.interactionContracts.map((contract) => contract.kind)).toEqual(expect.arrayContaining([
      'checkout',
      'auth_session',
    ]));
    expect(store.interactionContracts.some((contract) => (
      contract.labelPattern.includes('checkout') &&
      contract.dbWrites.some((table) => table.includes('orders'))
    ))).toBe(true);

    const ai = composeFrontendPlan({ domains: ['advanced_ai_mixed'], capabilities: ['uploads_storage', 'ai_openai', 'rag_search'] });
    expect(ai.interactionContracts.map((contract) => contract.kind)).toEqual(expect.arrayContaining([
      'ai_action',
      'search_filter',
    ]));
  });

  it('public landing is added for public-surface domains', () => {
    const ecomPlan = composeFrontendPlan({ domains: ['ecommerce_store'] });
    expect(ecomPlan.patternIds).toContain('landing_site');
    // Internal-only domain (inventory) should NOT auto-add landing.
    const invPlan = composeFrontendPlan({ domains: ['inventory_operations'] });
    expect(invPlan.patternIds.includes('landing_site')).toBe(false);
  });

  it('carries UI-craft references into visual and accessibility rules', () => {
    const plan = composeFrontendPlan({
      domains: ['business_website_crm'],
      capabilities: ['auth', 'crud', 'admin_workflow', 'dashboard'],
      referencePatterns: [
        'open-codesign-design-agent-patterns',
        'onlook-visual-repair-patterns',
        'radix-accessibility-primitives',
        'tremor-analytics-dashboard-patterns',
      ],
    });

    expect(plan.uiReferencePatterns).toEqual(expect.arrayContaining([
      'open-codesign-design-agent-patterns',
      'onlook-visual-repair-patterns',
      'radix-accessibility-primitives',
      'tremor-analytics-dashboard-patterns',
    ]));
    expect(plan.visualQualityRules.join(' ')).toMatch(/white-on-white|dropdown/i);
    expect(plan.visualQualityRules.join(' ')).toMatch(/exact route\/component\/control/i);
    expect(plan.visualQualityRules.join(' ')).toMatch(/real data|fake demo metrics/i);
    expect(plan.componentAccessibilityRules.join(' ')).toMatch(/icon-only controls require aria-label/i);
    expect(plan.componentAccessibilityRules.join(' ')).toMatch(/keyboard navigation|readable hover\/focus\/selected options/i);
    expect(plan.blockingRules.join(' ')).toMatch(/icon-only unlabeled controls/i);
  });
});

describe('frontend-pattern-registry: formatter', () => {
  it('formatFrontendPlan returns multi-section text', () => {
    const plan = composeFrontendPlan({ domains: ['local_service_booking'], capabilities: ['auth', 'booking'] });
    const text = formatFrontendPlan(plan);
    expect(text).toContain('Frontend plan ui_type=');
    expect(text).toContain('Page map:');
    expect(text).toContain('shadcn/ui components');
    expect(text).toContain('lucide-react icons');
    expect(text).toContain('UI reference patterns');
    expect(text).toContain('Visual quality rules');
    expect(text).toContain('Component accessibility rules');
    expect(text).toContain('Browser UI required_text');
    expect(text).toContain('Interaction contracts');
    expect(text).toContain('Blocking rules');
  });
});
