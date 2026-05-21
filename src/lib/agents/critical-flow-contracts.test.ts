import { describe, expect, it } from 'vitest';
import {
  criticalFlowEvidenceChecks,
  detectCriticalFlowContracts,
  requiredCriticalFlowContracts,
} from './critical-flow-contracts';
import { TASK_LANE_POLICIES } from './task-lane';

describe('critical flow contracts', () => {
  it('detects auth, booking, ecommerce, and generic primary-feature flows', () => {
    expect(detectCriticalFlowContracts({
      title: 'Build signup and login',
      description: 'Users register, sign in, and see their account session.',
    }).map((contract) => contract.kind)).toContain('auth_session');

    expect(detectCriticalFlowContracts({
      title: 'Build local service booking app',
      description: 'Customers select a date and reserve an appointment slot.',
    }, {
      selectedCapabilities: ['booking'],
      selectedDomains: ['local_service_booking'],
    }).map((contract) => contract.kind)).toContain('booking_reservation');

    expect(detectCriticalFlowContracts({
      title: 'Build ecommerce store',
      description: 'Customers add products to cart and place orders at checkout.',
    }, {
      selectedCapabilities: ['cart_orders_checkout'],
    }).map((contract) => contract.kind)).toEqual(expect.arrayContaining(['ecommerce_order', 'payment_checkout']));

    expect(detectCriticalFlowContracts({
      title: 'Build custom grant analyzer',
      description: 'User-facing app where founders submit a grant description and generate an eligibility analysis.',
    }, {
      isUserFacing: true,
    }).map((contract) => contract.kind)).toEqual(expect.arrayContaining(['ai_action']));
  });

  it('ignores generic canary boilerplate when deriving required critical kinds', () => {
    const contracts = detectCriticalFlowContracts({
      title: 'CANARY construction-operations: Construction project operations',
      description: [
        'Build and deploy: Project tracker for a contractor: projects, bids, schedule, safety logs, equipment, plus a dashboard.',
        'Mandatory planning before implementation:',
        '1. Call list_skills and read relevant skills for frontend, Neon/Postgres, Render, verification, Stripe/payments, uploads, AI/RAG, realtime/cron/email when applicable.',
        'Required app surface:',
        '- /projects lists projects with status. /projects/[id] has tabs: overview, schedule, bids, safety, equipment.',
        '- Equipment can be assigned to one project at a time.',
        'Required verification:',
        '- Call verify_interaction_contract for the scenario-specific interaction contract. It must set critical_kind for derived flows such as auth_session, booking_reservation, ecommerce_order, payment_checkout, crm_record, inventory_record, upload_file, ai_action, or generic_feature.',
        '- For AI text generation in founder/user apps, use the fixed Gemini provider contract.',
      ].join('\n'),
    }, {
      isUserFacing: true,
      selectedCapabilities: ['crud', 'dashboard', 'deployment_render', 'admin_workflow', 'roles', 'audit_logs', 'auth', 'booking'],
      selectedDomains: ['construction_operations'],
      frontendPlanPatterns: ['dashboard', 'document_portal', 'construction_ops_board', 'admin_portal'],
      taskIntent: 'new_app_build',
      planningDepth: 'canary_world_class',
    });

    const kinds = contracts.map((contract) => contract.kind);
    expect(kinds).toEqual(expect.arrayContaining(['auth_session', 'crm_record', 'domain_workflow']));
    expect(kinds).not.toEqual(expect.arrayContaining([
      'payment_checkout',
      'booking_reservation',
      'upload_file',
      'ai_action',
    ]));
  });

  it('keeps fast UI copy repairs out of broad critical-flow gates', () => {
    const contracts = detectCriticalFlowContracts({
      title: 'Fix button copy',
      description: 'Small existing UI repair: change primary CTA label spacing.',
    }, {
      isUserFacing: true,
    });

    expect(requiredCriticalFlowContracts(TASK_LANE_POLICIES.fast, contracts)).toEqual([]);
  });

  it('requires strict fast-lane flows only when auth/payment risk is present', () => {
    const contracts = detectCriticalFlowContracts({
      title: 'Fix login submit button',
      description: 'Focused repair: login button does not create a session.',
    }, {
      isUserFacing: true,
      selectedCapabilities: ['auth'],
    });

    expect(requiredCriticalFlowContracts(TASK_LANE_POLICIES.fast, contracts).map((contract) => contract.kind))
      .toEqual(['auth_session']);
  });

  it('fails API-only evidence when a critical browser interaction is required', () => {
    const required = requiredCriticalFlowContracts(TASK_LANE_POLICIES.standard, detectCriticalFlowContracts({
      title: 'Build booking scheduling app',
      description: 'Customers sign up, pick a slot, and reserve it.',
    }, {
      isUserFacing: true,
      selectedCapabilities: ['auth', 'booking', 'crud'],
    }));

    const checks = criticalFlowEvidenceChecks([
      { tool: 'create_instance', result: 'Instance ready: https://example.onrender.com' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: API booking flow - all 4 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: booking row exists.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: buttons visible.' },
    ], required);

    expect(checks.find((check) => check.name === 'critical_flow_interaction_evidence')?.passed).toBe(false);
  });

  it('passes when interaction, journey, and DB proof cover every required flow after deploy', () => {
    const required = requiredCriticalFlowContracts(TASK_LANE_POLICIES.strict, detectCriticalFlowContracts({
      title: 'Build booking scheduling app',
      description: 'Customers sign up, pick a slot, and reserve it.',
    }, {
      isUserFacing: true,
      selectedCapabilities: ['auth', 'booking', 'crud'],
    }));

    const checks = criticalFlowEvidenceChecks([
      { tool: 'create_instance', result: 'Instance ready: https://example.onrender.com' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: signup and booking flow - all 6 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: user and booking rows exist.' },
      { tool: 'verify_interaction_contract', result: [
        'INTERACTION_PROOF_EVIDENCE passed=2 failed=0 expected=2',
        'CRITICAL_FLOW_PROOF kind=auth_session passed=true interaction=signup',
        'CRITICAL_FLOW_PROOF kind=booking_reservation passed=true interaction=reserve_slot',
        'INTERACTION PROOF PASS: 2 interaction(s) passed.',
        'passed=signup, reserve slot',
      ].join('\n') },
    ], required);

    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it('rejects stale critical-flow proof that ran before a later app-changing push', () => {
    const required = requiredCriticalFlowContracts(TASK_LANE_POLICIES.standard, detectCriticalFlowContracts({
      title: 'Build CRM portal',
      description: 'Admins add leads and approve records.',
    }, {
      isUserFacing: true,
      selectedCapabilities: ['crud', 'admin_workflow'],
    }));

    const checks = criticalFlowEvidenceChecks([
      { tool: 'create_instance', result: 'Instance ready: https://example.onrender.com' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: lead flow passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: lead row exists.' },
      { tool: 'verify_interaction_contract', result: [
        'INTERACTION_PROOF_EVIDENCE passed=1 failed=0 expected=1',
        'CRITICAL_FLOW_PROOF kind=crm_record passed=true interaction=create_lead',
        'INTERACTION PROOF PASS: 1 interaction(s) passed.',
      ].join('\n') },
      { tool: 'github_create_commit', result: 'Committed a later UI fix' },
    ], required);

    expect(checks.find((check) => check.name === 'critical_flow_interaction_evidence')?.detail)
      .toContain('before the latest app-changing deploy/push');
  });

  it('rejects count-only interaction proof when required kinds are not labeled', () => {
    const required = requiredCriticalFlowContracts(TASK_LANE_POLICIES.strict, detectCriticalFlowContracts({
      title: 'Build booking scheduling app',
      description: 'Customers sign up, pick a slot, and reserve it.',
    }, {
      isUserFacing: true,
      selectedCapabilities: ['auth', 'booking', 'crud'],
    }));

    const checks = criticalFlowEvidenceChecks([
      { tool: 'create_instance', result: 'Instance ready: https://example.onrender.com' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: signup and booking flow - all 6 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: user and booking rows exist.' },
      { tool: 'verify_interaction_contract', result: 'INTERACTION_PROOF_EVIDENCE passed=2 failed=0 expected=2\nINTERACTION PROOF PASS: 2 interaction(s) passed.' },
    ], required);

    const interaction = checks.find((check) => check.name === 'critical_flow_interaction_evidence');
    expect(interaction?.passed).toBe(false);
    expect(interaction?.detail).toContain('kind-matched proof');
  });
});
