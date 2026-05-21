import { describe, expect, it } from 'vitest';

import {
  getReferenceRepoPatterns,
  matchReferenceRepos,
  retrieveComponentExamples,
} from './reference-pattern-registry';

const UI_CRAFT_REFERENCE_IDS = [
  'open-codesign-design-agent-patterns',
  'onlook-visual-repair-patterns',
  'radix-accessibility-primitives',
  'tremor-analytics-dashboard-patterns',
  'dub-saas-dashboard-patterns',
  'midday-business-ops-patterns',
  'twenty-crm-workspace-patterns',
];

function hasUiCraftReference(ids: string[]): boolean {
  return ids.some((id) => UI_CRAFT_REFERENCE_IDS.includes(id));
}

describe('reference pattern registry', () => {
  it('matches mixed AI course marketplace tasks to multiple relevant references', () => {
    // Catalog grew from 11 to 23 patterns (added 12 domain-specific groups).
    // For an AI+marketplace+uploads task, domain-tuned patterns like
    // llamaindex-rag-pipeline-patterns now legitimately outrank the generic
    // vercel-ai-chatbot-patterns. Either AI-capable reference is acceptable
    // here — the test verifies that AT LEAST ONE AI reference surfaces.
    const matches = matchReferenceRepos({
      title: 'Build AI course marketplace',
      description: 'Teachers upload lessons, students subscribe, AI summarizes lessons, admins approve content, and students browse listings.',
      capabilities: ['marketplace', 'uploads_storage', 'payments_stripe', 'ai_openai', 'admin_workflow', 'dashboard'],
    }, 14);
    const ids = matches.map((match) => match.pattern.id);

    expect(ids).toContain('vercel-commerce-marketplace-patterns');
    expect(ids).toContain('uploadthing-file-manager-patterns');
    expect(ids).toContain('stripe-billing-sample-patterns');
    const aiRefs = ['vercel-ai-chatbot-patterns', 'llamaindex-rag-pipeline-patterns'];
    expect(ids.some((id) => aiRefs.includes(id))).toBe(true);
    expect(matches.some((match) => match.mappedCapabilities.length >= 2)).toBe(true);
  });

  it('loads reference pattern details by id or repo', () => {
    const byId = getReferenceRepoPatterns('calcom-booking-patterns');
    const byRepo = getReferenceRepoPatterns('calcom/cal.com');

    expect(byId?.capabilities).toContain('booking');
    expect(byRepo?.id).toBe('calcom-booking-patterns');
    expect(byId?.caution.join(' ')).toMatch(/license|double-book/i);
  });

  it('retrieves component examples tied to requested capabilities', () => {
    const examples = retrieveComponentExamples({
      title: 'Build vendor compliance portal',
      description: 'Vendors upload documents and admins approve or reject them from a dashboard.',
      capabilities: ['uploads_storage', 'admin_workflow', 'dashboard'],
    });

    expect(examples.length).toBeGreaterThan(0);
    expect(examples.some((example) => example.capabilities.includes('uploads_storage'))).toBe(true);
    expect(examples.map((example) => example.example).join(' ')).toMatch(/upload|document|review|dashboard/i);
  });

  it('matches backend infrastructure capabilities beyond UI-heavy apps', () => {
    const matches = matchReferenceRepos({
      title: 'Build integration sync workflow',
      description: 'Connect to a third-party API, receive webhooks, run scheduled sync jobs, send notification-ready emails, and show live sync status.',
      capabilities: ['external_api', 'cron_jobs', 'email_notifications', 'realtime'],
    });
    const ids = matches.map((match) => match.pattern.id);

    expect(ids).toContain('nango-external-api-sync-patterns');
    expect(ids).toContain('inngest-job-workflow-patterns');
    expect(ids).toContain('resend-email-workflow-patterns');
    expect(ids).toContain('sse-realtime-status-patterns');
    expect(ids).not.toContain('open-codesign-design-agent-patterns');
    expect(ids).not.toContain('onlook-visual-repair-patterns');
    expect(ids).not.toContain('radix-accessibility-primitives');
    expect(ids).not.toContain('tremor-analytics-dashboard-patterns');
    expect(ids).not.toContain('dub-saas-dashboard-patterns');
    expect(hasUiCraftReference(ids)).toBe(false);
  });

  it('matches visual repair and accessibility references for browser-visible UI defects', () => {
    const matches = matchReferenceRepos({
      title: 'Fix vendor portal UI contrast',
      description: 'Browser UI screenshot shows white-on-white buttons, invisible dropdown/select options, and unreadable controls. Repair the exact failing surface.',
      capabilities: ['dashboard', 'crud', 'admin_workflow'],
    }, 10);
    const ids = matches.map((match) => match.pattern.id);

    expect(ids[0]).toBe('onlook-visual-repair-patterns');
    expect(ids).toContain('radix-accessibility-primitives');
    expect(matches.find((match) => match.pattern.id === 'onlook-visual-repair-patterns')?.reasons.join(' ')).toMatch(/visual repair/i);
  });

  it('matches dashboard craft references for SaaS analytics and billing surfaces', () => {
    const matches = matchReferenceRepos({
      title: 'Build SaaS billing analytics dashboard',
      description: 'Pricing account UI with billing status, KPI cards, charts, settings workspace, table filters, and polished dashboard metrics.',
      capabilities: ['auth', 'payments_stripe', 'dashboard', 'analytics'],
    }, 10);
    const ids = matches.map((match) => match.pattern.id);

    expect(ids).toContain('dub-saas-dashboard-patterns');
    expect(ids).toContain('tremor-analytics-dashboard-patterns');
    expect(ids).toContain('stripe-billing-sample-patterns');
  });

  it('matches CRM workspace UI references without turning every app into CRM', () => {
    const matches = matchReferenceRepos({
      title: 'Build CRM pipeline workspace',
      description: 'Contacts, companies, deals, object detail views, saved filters, and pipeline dashboard.',
      domains: ['business_website_crm'],
      capabilities: ['crud', 'roles', 'admin_workflow', 'dashboard'],
    }, 8);
    const ids = matches.map((match) => match.pattern.id);

    expect(ids[0]).toBe('twenty-crm-workspace-patterns');
    expect(ids).toContain('cal-business-leadcrm-patterns');
  });

  it('keeps one UI-craft reference in default results for canary-like app categories', () => {
    const cases = [
      {
        title: 'Build ecommerce store',
        description: 'Cart, checkout, orders, product browsing, account UI, and admin dashboard.',
        capabilities: ['marketplace', 'payments_stripe', 'dashboard', 'crud', 'auth'],
        expectedDomainRef: 'vercel-commerce-marketplace-patterns',
      },
      {
        title: 'Build vendor compliance portal',
        description: 'Vendor onboarding, document upload, admin approval, notification-ready flow, and dashboard UI.',
        domains: ['business_website_crm'],
        capabilities: ['auth', 'roles', 'crud', 'uploads_storage', 'email_notifications', 'admin_workflow', 'dashboard'],
        expectedDomainRef: 'documenso-approval-portal-patterns',
      },
      {
        title: 'Build booking scheduling app',
        description: 'Availability slots, booking creation, double-book prevention, and customer/admin views.',
        domains: ['local_service_booking'],
        capabilities: ['auth', 'crud', 'booking', 'dashboard'],
        expectedDomainRef: 'calcom-booking-patterns',
      },
      {
        title: 'Build AI document analyzer',
        description: 'Upload documents, extract and summarize with AI, store results, and provide searchable history.',
        domains: ['advanced_ai_mixed'],
        capabilities: ['auth', 'crud', 'uploads_storage', 'ai_openai', 'rag_search', 'dashboard'],
        expectedDomainRef: 'llamaindex-rag-pipeline-patterns',
      },
    ];

    for (const testCase of cases) {
      const ids = matchReferenceRepos(testCase).map((match) => match.pattern.id);
      expect(ids, testCase.title).toContain(testCase.expectedDomainRef);
      expect(hasUiCraftReference(ids), testCase.title).toBe(true);
    }
  });
});

describe('reference pattern registry: domain-specific groups', () => {
  const DOMAIN_PATTERN_EXPECTATIONS: Array<{ domain: string; patternId: string }> = [
    { domain: 'ecommerce_store', patternId: 'medusa-ecommerce-patterns' },
    { domain: 'business_website_crm', patternId: 'cal-business-leadcrm-patterns' },
    { domain: 'local_service_booking', patternId: 'calcom-booking-patterns' },
    { domain: 'inventory_operations', patternId: 'erpnext-inventory-warehouse-patterns' },
    { domain: 'construction_operations', patternId: 'construction-ops-board-patterns' },
    { domain: 'finance_crypto', patternId: 'finance-dashboard-patterns' },
    { domain: 'social_community', patternId: 'lemmy-social-community-patterns' },
    { domain: 'education_content', patternId: 'lms-education-content-patterns' },
    { domain: 'health_fitness_food', patternId: 'health-fitness-tracker-patterns' },
    { domain: 'media_creator', patternId: 'creator-portfolio-platform-patterns' },
    { domain: 'real_estate_property', patternId: 'real-estate-listing-patterns' },
    { domain: 'advanced_ai_mixed', patternId: 'llamaindex-rag-pipeline-patterns' },
  ];

  for (const { domain, patternId } of DOMAIN_PATTERN_EXPECTATIONS) {
    it(`domain=${domain} surfaces ${patternId}`, () => {
      const matches = matchReferenceRepos({
        title: `Build a ${domain} app`,
        description: 'Domain-driven match without capability keywords',
        domains: [domain],
      });
      const ids = matches.map((m) => m.pattern.id);
      expect(ids).toContain(patternId);
    });
  }

  it('unknown domain is ignored, no crash', () => {
    const matches = matchReferenceRepos({
      title: 'Vendor portal',
      description: 'Vendor uploads',
      capabilities: ['uploads_storage', 'admin_workflow'],
      domains: ['totally_not_a_domain'],
    });
    // Should still match by capabilities
    const ids = matches.map((m) => m.pattern.id);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('omitting domains preserves existing matching behavior', () => {
    const matches = matchReferenceRepos({
      title: 'Build AI course marketplace',
      description: 'Teachers upload lessons, students subscribe, AI summarizes lessons, admins approve content, and students browse listings.',
      capabilities: ['marketplace', 'uploads_storage', 'payments_stripe', 'ai_openai', 'admin_workflow', 'dashboard'],
    }, 14);
    const ids = matches.map((m) => m.pattern.id);
    expect(ids).toContain('vercel-commerce-marketplace-patterns');
    expect(ids).toContain('uploadthing-file-manager-patterns');
    const aiRefs = ['vercel-ai-chatbot-patterns', 'llamaindex-rag-pipeline-patterns'];
    expect(ids.some((id) => aiRefs.includes(id))).toBe(true);
  });
});
