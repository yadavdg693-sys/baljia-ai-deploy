import { describe, expect, it } from 'vitest';

import { CANARY_SCENARIOS } from './canary-core-scenarios';
import { EXTENDED_CANARY_SCENARIOS, EXTENDED_SCENARIO_IDS } from './canary-extended-scenarios';

const EXPECTED_EXTENDED_IDS = [
  'ecommerce-store',
  'business-website-crm',
  'local-service-booking',
  'inventory-operations',
  'construction-operations',
  'finance-crypto-dashboard',
  'social-community',
  'education-content-platform',
  'health-fitness-meal-planner',
  'media-creator-platform',
  'real-estate-property',
  'advanced-mixed-ai-workflow',
];

const EXPECTED_CORE_IDS = [
  'ai-course-marketplace',
  'vendor-compliance-portal',
  'booking-scheduling-app',
  'saas-billing-dashboard',
  'ai-document-analyzer',
  'adversarial-booking-marketplace',
  'existing-app-extension',
];

describe('canary scenario inventory', () => {
  it('7 core scenarios remain intact (regression — must not be broken)', () => {
    const coreIds = CANARY_SCENARIOS.map((s) => s.id).sort();
    expect(coreIds).toEqual([...EXPECTED_CORE_IDS].sort());
  });

  it('12 extended scenarios are present', () => {
    expect(EXTENDED_SCENARIO_IDS.sort()).toEqual([...EXPECTED_EXTENDED_IDS].sort());
    expect(EXTENDED_CANARY_SCENARIOS.length).toBe(12);
  });

  it('every extended scenario declares domains, capabilities, requiredEvidence, expectedFailureClasses', () => {
    for (const scenario of EXTENDED_CANARY_SCENARIOS) {
      expect(scenario.domains.length).toBeGreaterThanOrEqual(1);
      expect(scenario.capabilities.length).toBeGreaterThanOrEqual(3);
      expect(scenario.requiredEvidence.length).toBeGreaterThanOrEqual(1);
      expect(scenario.expectedFailureClasses.length).toBeGreaterThanOrEqual(1);
      expect(scenario.dbChecks.length).toBeGreaterThanOrEqual(1);
      expect(scenario.liveChecks.length).toBeGreaterThanOrEqual(2);
      expect(scenario.browserUiChecks.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('extended scenario ids never collide with core scenario ids', () => {
    const coreSet = new Set(CANARY_SCENARIOS.map((s) => s.id));
    for (const id of EXTENDED_SCENARIO_IDS) {
      expect(coreSet.has(id), `extended id ${id} should not collide with a core scenario`).toBe(false);
    }
  });

  it('canary matrix covers 7 core + 12 extended (19 total)', () => {
    const allIds = new Set([...CANARY_SCENARIOS.map((s) => s.id), ...EXTENDED_SCENARIO_IDS]);
    expect(allIds.size).toBe(19);
  });

  it('different domains produce different verification journeys (category-neutrality smoke)', () => {
    // For at least 4 distinct domains, the verification journeys / required tables should differ.
    const fingerprints = EXTENDED_CANARY_SCENARIOS.map((s) =>
      [s.domains.join(','), s.requiredTables.join(','), s.capabilities.sort().join(',')].join('|'),
    );
    const distinct = new Set(fingerprints);
    expect(distinct.size).toBe(12);
  });

  it('ecommerce canary requires admin product creation through the rendered UI', () => {
    const scenario = EXTENDED_CANARY_SCENARIOS.find((s) => s.id === 'ecommerce-store');
    expect(scenario?.requiredRoutes).toContain('app/admin/products/page.tsx');
    expect(scenario?.liveChecks.some((check) => check.name === 'GET /admin/products')).toBe(true);

    const productCreateCheck = scenario?.liveChecks.find((check) => check.name === 'POST /api/canary-products');
    expect(productCreateCheck?.required).toBe(true);

    const journeys = scenario?.browserUiChecks.flatMap((check) => check.journeys ?? []) ?? [];
    const adminProductJourney = journeys.find((journey) => journey.startPath === '/admin/products');
    expect(adminProductJourney?.preSubmitActions?.some((action) => (
      action.type === 'click' &&
      /add product/i.test(action.labelPattern ?? '') &&
      action.expectTextPatterns?.some((pattern) => /SKU/.test(pattern))
    ))).toBe(true);
    expect(adminProductJourney?.submitPattern).toMatch(/add product/i);
    expect(adminProductJourney?.formFields).toMatchObject({
      name: expect.stringContaining('Canary Admin Product'),
      sku: expect.stringContaining('ADMIN-'),
      price: '32.00',
      stock: '7',
    });
    expect(adminProductJourney?.postSubmitActions?.some((action) => (
      action.type === 'goto' &&
      action.path === '/' &&
      action.expectTextPatterns?.some((pattern) => /Canary Admin Product/.test(pattern))
    ))).toBe(true);
  });

  it('local service booking canary requires real browser booking from /book', () => {
    const scenario = EXTENDED_CANARY_SCENARIOS.find((s) => s.id === 'local-service-booking');
    expect(scenario?.liveChecks.some((check) => (
      check.name === 'POST /api/canary-availability (browser slot)' &&
      check.capture?.key === 'browserSlotId'
    ))).toBe(true);
    expect(scenario?.liveChecks.some((check) => (
      check.name === 'POST /api/auth/sign-up/email' &&
      check.required === true
    ))).toBe(true);

    const journeys = scenario?.browserUiChecks.flatMap((check) => check.journeys ?? []) ?? [];
    const bookingJourney = journeys.find((journey) => journey.startPath === '/book');
    const signUpJourney = journeys.find((journey) => journey.startPath === '/sign-up');

    expect(bookingJourney?.preSubmitActions?.some((action) => (
      action.type === 'click' &&
      /haircut|service|select/i.test(action.labelPattern ?? '') &&
      action.rejectTextPatterns?.some((pattern) => /no services available/i.test(pattern))
    ))).toBe(true);
    expect(bookingJourney?.preSubmitActions?.some((action) => (
      action.type === 'click' &&
      /slot|available|choose time/i.test(action.labelPattern ?? '') &&
      action.rejectTextPatterns?.some((pattern) => /no slots|no availability/i.test(pattern))
    ))).toBe(true);
    expect(bookingJourney?.formFields).toMatchObject({
      email: expect.stringContaining('@example.com'),
    });
    expect(bookingJourney?.submitPattern).toMatch(/book|reserve|confirm|schedule/);
    expect(bookingJourney?.expectTextPatterns.some((pattern) => /confirmed|booked|appointment|success/i.test(pattern))).toBe(true);

    expect(signUpJourney?.formFields).toMatchObject({
      name: expect.stringContaining('Canary Auth'),
      email: expect.stringContaining('@example.com'),
      password: 'Password123!',
    });
    expect(signUpJourney?.submitPattern).toMatch(/create account|sign up/);
    expect(signUpJourney?.expectTextPatterns).toEqual(
      expect.arrayContaining(['dashboard|settings|subscription|sign out']),
    );
    expect(signUpJourney?.expectTextPatterns.some((pattern) => /\baccount\b/i.test(pattern))).toBe(false);
    expect(signUpJourney?.rejectTextPatterns?.some((pattern) => /creating account|sign.?up failed|welcome back/i.test(pattern))).toBe(true);
    expect(signUpJourney?.postSubmitActions?.some((action) => (
      action.type === 'goto' &&
      action.path === '/app' &&
      action.expectTextPatterns?.some((pattern) => /dashboard|sign out/i.test(pattern)) &&
      action.rejectTextPatterns?.some((pattern) => /welcome back|sign in/i.test(pattern))
    ))).toBe(true);
  });

  it('construction canary requires authenticated UI CRUD plus sign-out proof', () => {
    const scenario = EXTENDED_CANARY_SCENARIOS.find((s) => s.id === 'construction-operations');

    expect(scenario?.liveChecks.some((check) => (
      check.name === 'POST /api/auth/sign-up/email' &&
      check.required === true
    ))).toBe(true);
    expect(scenario?.requiredEvidence).toContain('verify_browser_ui pass');
    expect(scenario?.verificationRequirements.join(' ')).toMatch(/sign-out/i);
    expect(scenario?.dbChecks.map((check) => check.table)).toEqual(
      expect.arrayContaining([
        'canary_projects',
        'canary_bids',
        'canary_schedule_entries',
        'canary_safety_logs',
        'canary_equipment',
      ]),
    );

    const journeys = scenario?.browserUiChecks.flatMap((check) => check.journeys ?? []) ?? [];
    const signUpJourney = journeys.find((journey) => journey.startPath === '/sign-up');
    const projectJourney = journeys.find((journey) => journey.name === 'project create preserves dates and details');
    const bidJourney = journeys.find((journey) => journey.name === 'bid create appears in the authenticated product UI');
    const scheduleJourney = journeys.find((journey) => journey.name === 'schedule entry appears in the authenticated product UI');
    const safetyJourney = journeys.find((journey) => journey.name === 'safety log appears in the authenticated product UI');
    const equipmentJourney = journeys.find((journey) => journey.name === 'equipment assignment appears in the authenticated product UI');
    const signOutJourney = journeys.find((journey) => journey.name === 'sign-out clears the authenticated app session');

    expect(signUpJourney?.formFields).toMatchObject({
      name: expect.stringContaining('Canary Construction'),
      email: expect.stringContaining('@example.com'),
      password: 'Password123!',
    });
    expect(signUpJourney?.postSubmitActions?.some((action) => (
      action.type === 'goto' &&
      action.path === '/app' &&
      action.expectTextPatterns?.some((pattern) => /equipment/i.test(pattern)) &&
      action.rejectTextPatterns?.some((pattern) => /welcome back|sign in/i.test(pattern))
    ))).toBe(true);

    expect(projectJourney?.preSubmitActions?.some((action) => (
      action.type === 'click' &&
      /new project|add project|create project/i.test(action.labelPattern ?? '') &&
      action.expectTextPatterns?.some((pattern) => /Start Date|Start/.test(pattern))
    ))).toBe(true);
    expect(projectJourney?.formFields).toMatchObject({
      name: expect.stringContaining('Canary Jobsite'),
      start_date: '2030-04-01',
      end_date: '2030-06-30',
    });
    expect(projectJourney?.expectTextPatterns.some((pattern) => /2030-04-01/.test(pattern))).toBe(true);
    expect(projectJourney?.expectTextPatterns.some((pattern) => /2030-06-30/.test(pattern))).toBe(true);

    expect(bidJourney?.preSubmitActions?.some((action) => /add bid|new bid|submit bid/i.test(action.labelPattern ?? ''))).toBe(true);
    expect(scheduleJourney?.preSubmitActions?.some((action) => /add task|new task|schedule/i.test(action.labelPattern ?? ''))).toBe(true);
    expect(safetyJourney?.preSubmitActions?.some((action) => /add safety log|new safety|safety log|add log/i.test(action.labelPattern ?? ''))).toBe(true);
    expect(equipmentJourney?.preSubmitActions?.some((action) => /add equipment|track equipment|new equipment/i.test(action.labelPattern ?? ''))).toBe(true);

    expect(signOutJourney?.submitPattern).toMatch(/sign out|log out/);
    expect(signOutJourney?.postSubmitActions?.some((action) => (
      action.type === 'goto' &&
      action.path === '/app' &&
      action.expectTextPatterns?.some((pattern) => /welcome back|sign in/i.test(pattern)) &&
      action.rejectTextPatterns?.some((pattern) => /dashboard|sign out|project list|equipment/i.test(pattern))
    ))).toBe(true);
  });
});
