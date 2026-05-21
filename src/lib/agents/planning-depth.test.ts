import { describe, expect, it } from 'vitest';

import { classifyPlanningDepth, formatPlanningDepthEvidence, maxPlanningDepth, parsePlanningDepth } from './planning-depth';

describe('planning-depth classifier', () => {
  it('classifies narrow low-risk work as simple_feature', () => {
    expect(classifyPlanningDepth({
      title: 'Add one API route',
      description: 'Add one endpoint that returns server status JSON.',
    }).depth).toBe('simple_feature');

    expect(classifyPlanningDepth({
      title: 'Fix button copy',
      description: 'Update one page button label and spacing.',
    }).depth).toBe('simple_feature');
  });

  it('escalates product-shaped apps to standard_app', () => {
    const result = classifyPlanningDepth({
      title: 'Build booking scheduling app',
      description: 'Customers book available slots and admins manage availability.',
      selectedCapabilities: ['crud', 'booking', 'dashboard', 'deployment_render'],
    });

    expect(result.depth).toBe('standard_app');
    expect(result.riskSignals).toContain('booking');
  });

  it('escalates mixed feature combinations to mixed_complex_app', () => {
    const result = classifyPlanningDepth({
      title: 'Build AI course marketplace',
      description: 'Teachers upload lessons, students subscribe, AI summarizes lessons, and admins approve content.',
      selectedCapabilities: ['marketplace', 'auth', 'uploads_storage', 'payments_stripe', 'ai_openai', 'admin_workflow', 'dashboard', 'crud'],
    });

    expect(result.depth).toBe('mixed_complex_app');
    expect(result.reasons).toEqual(expect.arrayContaining(['many_capabilities', 'mixed_capability_combination']));
  });

  it('classifies existing app extensions without treating canary wording as planning authority', () => {
    expect(classifyPlanningDepth({
      title: 'Existing-app extension canary',
      description: 'Extend the existing app with billing and RAG document search.',
    }).depth).toBe('mixed_complex_app');

    expect(classifyPlanningDepth({
      title: 'Extend existing app',
      description: 'Update the existing repo with one dashboard widget.',
    }).depth).toBe('existing_app_extension');
  });

  it('does not promote product wording about canary monitoring into canary_world_class depth', () => {
    const result = classifyPlanningDepth({
      title: 'Build canary monitoring dashboard',
      description: 'Users track deployment canaries, confidence runs, status history, and service health.',
      selectedCapabilities: ['crud', 'dashboard', 'deployment_render'],
    });

    expect(result.depth).toBe('standard_app');
    expect(result.reasons).not.toContain('canary_or_world_class_run');
  });

  it('does not let existing-app wording hide mixed-complex extension work', () => {
    const result = classifyPlanningDepth({
      title: 'Extend existing app with billing, RAG document search, and admin dashboard',
      description: 'Preserve the existing route while adding subscriptions, document analysis history, and admin reporting.',
      selectedCapabilities: ['payments_stripe', 'rag_search', 'ai_openai', 'admin_workflow', 'dashboard', 'crud'],
    });

    expect(result.depth).toBe('mixed_complex_app');
    expect(result.reasons).toEqual(expect.arrayContaining(['existing_app_extension', 'many_capabilities']));
  });

  it('caps focused repairs so many inferred capabilities do not trigger full mixed-app planning', () => {
    const result = classifyPlanningDepth({
      title: 'CEO repair: Fix Vendor Compliance UI contrast',
      description: 'Use the same repo and same service. Fix the unreadable buttons and dropdown on the existing dashboard.',
      taskIntent: 'focused_repair',
      taskIntentLane: 'repair',
      selectedCapabilities: ['auth', 'roles', 'crud', 'uploads_storage', 'email_notifications', 'admin_workflow', 'dashboard', 'deployment_render'],
    });

    expect(result.depth).toBe('simple_feature');
    expect(result.reasons).toEqual(expect.arrayContaining(['repair_lane', 'narrow_repair']));
  });

  it('keeps broad multi-capability repairs at mixed-complex depth', () => {
    const result = classifyPlanningDepth({
      title: 'CEO repair: Fix existing app auth, billing, uploads, RAG, and admin dashboard',
      description: 'Use the same repo and same service. Login, Stripe checkout, document uploads, AI document search, and admin approval are all broken.',
      taskIntent: 'focused_repair',
      taskIntentLane: 'repair',
      selectedCapabilities: ['auth', 'payments_stripe', 'uploads_storage', 'rag_search', 'ai_openai', 'admin_workflow', 'dashboard', 'deployment_render'],
    });

    expect(result.depth).toBe('mixed_complex_app');
    expect(result.reasons).toEqual(expect.arrayContaining(['repair_lane', 'broad_repair', 'many_capabilities']));
  });

  it('keeps world-class/canary as the most restrictive depth', () => {
    expect(maxPlanningDepth('simple_feature', 'canary_world_class')).toBe('canary_world_class');
    expect(maxPlanningDepth('mixed_complex_app', 'standard_app')).toBe('mixed_complex_app');
  });

  it('parses and formats planning depth evidence markers', () => {
    const result = classifyPlanningDepth({ title: 'Add one API route' });
    const marker = formatPlanningDepthEvidence(result);

    expect(marker).toContain('PLANNING_DEPTH_EVIDENCE depth=simple_feature');
    expect(parsePlanningDepth('simple_feature')).toBe('simple_feature');
    expect(parsePlanningDepth('not-real')).toBeNull();
  });
});
