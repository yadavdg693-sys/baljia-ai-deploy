import { describe, expect, it } from 'vitest';

import {
  composeCapabilityArchitecture,
  getCapabilityPack,
  matchCapabilities,
} from './capability-registry';

describe('capability registry', () => {
  it('decomposes mixed AI marketplace tasks into multiple capabilities', () => {
    const matches = matchCapabilities({
      title: 'Build AI course marketplace',
      description: 'Teachers upload lessons, students subscribe, AI summarizes lessons, and admins approve payouts.',
    });
    const ids = matches.map((match) => match.id);

    expect(ids).toContain('marketplace');
    expect(ids).toContain('uploads_storage');
    expect(ids).toContain('payments_stripe');
    expect(ids).toContain('ai_openai');
    expect(ids).toContain('admin_workflow');
    expect(ids).toContain('deployment_render');
  });

  it('does not classify market price tracking as Stripe payments', () => {
    const matches = matchCapabilities({
      title: 'Build a crypto portfolio dashboard',
      description: 'Track holdings, create price alerts, record transaction history, and show stale market price data when the external API is down.',
      domains: ['finance_crypto'],
      workflows: ['create portfolio', 'price alert', 'transaction history', 'external API fallback'],
      entities: ['portfolios', 'price_alerts', 'transactions', 'price_snapshots'],
    });
    const ids = matches.map((match) => match.id);

    expect(ids).toEqual(expect.arrayContaining([
      'auth',
      'crud',
      'dashboard',
      'external_api',
      'deployment_render',
    ]));
    expect(ids).not.toContain('payments_stripe');
  });

  it('does not infer Stripe from pricing-page language without checkout or subscription intent', () => {
    const matches = matchCapabilities({
      title: 'Build marketing pricing page',
      description: 'Show three public price tiers, feature comparison, and lead capture.',
    });
    const ids = matches.map((match) => match.id);

    expect(ids).toEqual(expect.arrayContaining(['deployment_render']));
    expect(ids).not.toContain('payments_stripe');
  });

  it('does not infer booking from generic project schedule wording', () => {
    const matches = matchCapabilities({
      title: 'Build construction project tracker',
      description: 'Track projects, bids, schedule tasks, safety logs, equipment, and dashboard status.',
      domains: ['construction_operations'],
      entities: ['projects', 'bids', 'schedule_entries', 'safety_logs', 'equipment'],
      workflows: ['create project', 'add bid', 'add schedule entry', 'add safety log'],
    });
    const ids = matches.map((match) => match.id);

    expect(ids).toEqual(expect.arrayContaining(['crud', 'dashboard', 'deployment_render']));
    expect(ids).not.toContain('booking');
  });

  it('returns implementation and verification requirements for capability packs', () => {
    const pack = getCapabilityPack('payments-stripe');
    expect(pack?.id).toBe('payments_stripe');
    expect(pack?.envVars).toContain('STRIPE_SECRET_KEY');
    expect(pack?.verificationRequirements.join(' ')).toMatch(/checkout|webhook/i);
  });

  it('composes vertical slices and app-specific verification journeys', () => {
    const plan = composeCapabilityArchitecture({
      title: 'Build vendor onboarding portal',
      description: 'Vendors submit details, upload compliance documents, and admins approve or reject them.',
      actors: ['vendor', 'admin'],
      entities: ['vendors', 'vendor_documents'],
      designSystem: 'linear-app',
      referencePatterns: ['documenso-approval-portal-patterns', 'uploadthing-file-manager-patterns'],
    });

    expect(plan.capabilities).toContain('uploads_storage');
    expect(plan.capabilities).toContain('admin_workflow');
    expect(plan.capabilities).toContain('deployment_render');
    expect(plan.referencePatterns).toContain('documenso-approval-portal-patterns');
    expect(plan.apiRoutes).toContain('GET/POST /api/vendors');
    expect(plan.hybridRetrieval.sources).toContain('GitHub/reference patterns');
    expect(plan.hybridRetrieval.decisions.join(' ')).toMatch(/vertical slices|reference patterns/i);
    expect(plan.verticalSlices.some((slice) => slice.capability === 'uploads_storage')).toBe(true);
    expect(plan.verificationJourneys.some((journey) => journey.name.includes('upload'))).toBe(true);
    expect(plan.verificationJourneys.some((journey) => journey.name.includes('admin approval'))).toBe(true);
  });

  it('does not treat vendor compliance portals as marketplaces by default', () => {
    const matches = matchCapabilities({
      title: 'Build vendor compliance portal',
      description: 'Vendors onboard, upload insurance documents, admins approve vendors, and notification records are shown on an operations dashboard.',
    });
    const ids = matches.map((match) => match.id);

    expect(ids).toEqual(expect.arrayContaining([
      'roles',
      'crud',
      'uploads_storage',
      'admin_workflow',
      'email_notifications',
      'dashboard',
      'deployment_render',
    ]));
    expect(ids).not.toContain('marketplace');
  });

  it('marks only the narrow repair capabilities as required for focused repairs', () => {
    const matches = matchCapabilities({
      title: 'CEO repair: Fix Vendor Compliance UI contrast',
      description: 'Use the same repo and same service. Fix unreadable dashboard buttons and dropdowns.',
      taskIntent: 'focused_repair',
      taskIntentLane: 'repair',
      domains: [],
    });
    const required = matches.filter((match) => match.requirement === 'required').map((match) => match.id);
    const optional = matches.filter((match) => match.requirement === 'optional').map((match) => match.id);

    expect(required.length).toBeLessThanOrEqual(2);
    expect(required.length).toBeGreaterThan(0);
    expect(optional.length).toBeGreaterThan(0);
  });

  it('does not let optional repair capabilities expand the architecture plan', () => {
    const matches = matchCapabilities({
      title: 'CEO repair: Fix Vendor Compliance UI contrast',
      description: 'Use the same repo and same service. Fix unreadable dashboard buttons and dropdowns.',
      taskIntent: 'focused_repair',
      taskIntentLane: 'repair',
    });
    const required = matches.filter((match) => match.requirement === 'required').map((match) => match.id);
    const optional = matches.filter((match) => match.requirement === 'optional').map((match) => match.id);
    const plan = composeCapabilityArchitecture({
      title: 'CEO repair: Fix Vendor Compliance UI contrast',
      description: 'Use the same repo and same service. Fix unreadable dashboard buttons and dropdowns.',
      taskIntent: 'focused_repair',
      taskIntentLane: 'repair',
      capabilities: matches.map((match) => match.id),
    });

    expect(required.length).toBeGreaterThan(0);
    expect(optional.length).toBeGreaterThan(0);
    expect(plan.capabilities).toEqual(expect.arrayContaining(required));
    expect(plan.capabilities.some((id) => optional.includes(id))).toBe(false);
  });
});

describe('capability registry: deeper packs (additive)', () => {
  const DEEPER_PACK_IDS = [
    'cart_orders_checkout',
    'coupons_tax_shipping',
    'payment_lifecycle',
    'stripe_webhooks',
    'teams_workspaces',
    'oauth_password_reset',
    'multi_tenant_isolation',
    'rich_text_cms',
    'import_export_csv',
    'audit_logs',
    'soft_delete_restore',
    'file_privacy_validation',
    'notification_preferences',
    'realtime_collaboration',
    'queue_workers',
    'long_running_ai_jobs',
    'ai_safety_cost_controls',
    'seo_public_pages',
    'security_ops',
    'rollback_backup_ops',
  ];

  it('all 20 deeper packs resolve via getCapabilityPack', () => {
    for (const id of DEEPER_PACK_IDS) {
      const pack = getCapabilityPack(id);
      expect(pack, `pack ${id} should exist`).toBeTruthy();
      expect(pack?.requiredSkills.length).toBeGreaterThan(0);
      expect(pack?.verificationRequirements.length).toBeGreaterThan(0);
      expect(pack?.verticalSlice.length).toBeGreaterThan(0);
    }
  });

  it('cart/orders signal in task → cart_orders_checkout matches', () => {
    const matches = matchCapabilities({
      title: 'Online store',
      description: 'Customers add to cart and checkout, orders persist',
    });
    expect(matches.map((m) => m.id)).toContain('cart_orders_checkout');
  });

  it('audit signal in task → audit_logs matches', () => {
    const matches = matchCapabilities({
      title: 'Admin tool',
      description: 'Admins approve records and we need a full audit trail of every change.',
    });
    expect(matches.map((m) => m.id)).toContain('audit_logs');
  });

  it('csv import signal → import_export_csv matches', () => {
    const matches = matchCapabilities({
      title: 'Inventory',
      description: 'Bulk CSV import of items with per-row errors and export to CSV',
    });
    expect(matches.map((m) => m.id)).toContain('import_export_csv');
  });

  it('queue/worker signal → queue_workers matches', () => {
    const matches = matchCapabilities({
      title: 'Doc processor',
      description: 'Background workers process files from a queue and retry on failure',
    });
    expect(matches.map((m) => m.id)).toContain('queue_workers');
  });

  it('does not treat booking scheduler wording as cron or queue-worker scope', () => {
    const matches = matchCapabilities({
      title: 'CANARY booking-scheduling-app: Booking scheduling app',
      description: [
        'A booking app with availability slots, booking creation, duplicate-book prevention, and separate customer/admin views.',
        'Homepage shows slot picker/calendar-like availability, customer booking flow, admin booking queue, and status badges.',
      ].join('\n'),
      domains: ['local_service_booking'],
    });
    const ids = matches.map((m) => m.id);

    expect(ids).toContain('booking');
    expect(ids).not.toContain('cron_jobs');
    expect(ids).not.toContain('queue_workers');
    expect(ids).not.toContain('audit_logs');
  });
});

describe('capability registry: architecture output (extended fields)', () => {
  it('includes api_contracts with method/path/purpose/auth/db expectation', () => {
    const plan = composeCapabilityArchitecture({
      title: 'Vendor portal',
      description: 'Vendors submit documents, admins approve',
      capabilities: ['auth', 'crud', 'uploads_storage', 'admin_workflow', 'deployment_render'],
    });
    expect(plan.apiContracts.length).toBeGreaterThan(0);
    const adminContract = plan.apiContracts.find((c) => c.path === '/api/admin/:entity/:id/status');
    expect(adminContract).toBeDefined();
    expect(adminContract?.auth).toBe('role-required');
    expect(adminContract?.statusCodes).toContain(403);
    expect(adminContract?.dbExpectation).toMatch(/audit/);
  });

  it('includes db_state_checks for each write capability', () => {
    const plan = composeCapabilityArchitecture({
      title: 'Booking app',
      description: 'Customers book slots',
      capabilities: ['auth', 'crud', 'booking', 'deployment_render'],
    });
    expect(plan.dbStateChecks.length).toBeGreaterThan(0);
    expect(plan.dbStateChecks.some((c) => c.name.includes('double-book'))).toBe(true);
  });

  it('includes browser_ui_checks per page', () => {
    const plan = composeCapabilityArchitecture({
      title: 'Service booking',
      description: 'Customers pick slot and book',
      capabilities: ['auth', 'crud', 'booking', 'deployment_render'],
    });
    expect(plan.browserUiChecks.length).toBeGreaterThan(0);
    const bookPage = plan.browserUiChecks.find((c) => c.pagePath === '/book');
    expect(bookPage?.required_buttons.some((b) => b.includes('Confirm'))).toBe(true);
  });

  it('includes domains and frontendPlanSummary when domains supplied', () => {
    const plan = composeCapabilityArchitecture({
      title: 'Storefront',
      description: 'Cart and checkout',
      domains: ['ecommerce_store'],
      capabilities: ['auth', 'crud', 'payments_stripe', 'deployment_render'],
    });
    expect(plan.domains).toContain('ecommerce_store');
    expect(plan.frontendPlanSummary?.patternIds).toContain('ecommerce_storefront');
  });
});

describe('capability registry: domain-driven boost (back-compat)', () => {
  it('domain context boosts capabilities listed in the domain pack', () => {
    // Without domains: cart_orders_checkout might or might not show up if signals are weak.
    // With domains=['ecommerce_store'], it should reliably score high.
    const withDomain = matchCapabilities({
      title: 'Generic store build',
      description: 'A store',
      domains: ['ecommerce_store'],
    });
    const ids = withDomain.map((m) => m.id);
    expect(ids).toContain('cart_orders_checkout');
    expect(ids).toContain('payments_stripe');
    expect(ids).toContain('payment_lifecycle');
    expect(ids).toContain('stripe_webhooks');
  });

  it('omitting domains preserves original (signal-only) behavior', () => {
    const matches = matchCapabilities({
      title: 'Build AI course marketplace',
      description: 'Teachers upload lessons, students subscribe, AI summarizes lessons, and admins approve payouts.',
    });
    const ids = matches.map((match) => match.id);
    // Same expectations as the original "decomposes mixed AI marketplace tasks" test.
    expect(ids).toContain('marketplace');
    expect(ids).toContain('uploads_storage');
    expect(ids).toContain('payments_stripe');
    expect(ids).toContain('ai_openai');
    expect(ids).toContain('admin_workflow');
    expect(ids).toContain('deployment_render');
  });

  it('unknown domain id is ignored, no crash', () => {
    const matches = matchCapabilities({
      title: 'Store',
      description: 'cart and checkout',
      domains: ['totally_not_a_domain'],
    });
    expect(matches.map((m) => m.id)).toContain('cart_orders_checkout');
  });
});
