import { describe, expect, it } from 'vitest';
import { composeCapabilityArchitecture } from './capability-registry';
import {
  deriveBuildBrief,
  deriveProductBuildContract,
  formatProductBuildContractEvidence,
  missingContractFieldProofs,
  missingContractFlowIds,
  parseAcceptanceProofEvidence,
  parseAuthIsolationProofEvidence,
  parseContractFieldProofEvidence,
  parseContractFlowProofEvidence,
  parseProductBuildContractEvidence,
  requiresProductBuildContract,
} from './product-build-contract';
import type { ProductBuildContract } from './product-build-contract';

function constructionArchitecture() {
  return composeCapabilityArchitecture({
    title: 'Build construction project operations',
    description: 'Projects, bids, schedule, safety logs, equipment, auth, and dashboard.',
    domains: ['construction_operations'],
    capabilities: ['auth', 'roles', 'crud', 'admin_workflow', 'audit_logs', 'dashboard', 'deployment_render'],
    designSystem: 'linear-app',
    referencePatterns: ['shadcn-dashboard-patterns'],
    taskIntent: 'new_app_build',
    taskIntentLane: 'build',
    planningDepth: 'canary_world_class',
  });
}

describe('product build contract', () => {
  it('turns a domain app into an assumption brief without saving a template', () => {
    const architecture = constructionArchitecture();
    const brief = deriveBuildBrief({
      title: 'Build construction project operations',
      lane: 'standard',
      taskIntent: 'new_app_build',
      planningDepth: 'standard_app',
      architecture,
      domains: ['construction_operations'],
      capabilities: architecture.capabilities,
    });

    expect(brief.primaryVerb).toBe('manage construction projects');
    expect(brief.mvpFeatures).toEqual(expect.arrayContaining(['project create', 'bid creation']));
    expect(brief.nonGoals.join(' ')).toContain('Do not copy a saved app template');
  });

  it('keeps standard domain app contracts complete for required domain flows', () => {
    const architecture = constructionArchitecture();
    const standard = deriveProductBuildContract({
      title: 'Build construction project operations',
      lane: 'standard',
      taskIntent: 'new_app_build',
      planningDepth: 'standard_app',
      architecture,
      domains: ['construction_operations'],
      capabilities: architecture.capabilities,
    });
    const canary = deriveProductBuildContract({
      title: 'Build construction project operations',
      lane: 'canary',
      taskIntent: 'new_app_build',
      planningDepth: 'canary_world_class',
      architecture,
      domains: ['construction_operations'],
      capabilities: architecture.capabilities,
    });

    expect(standard.flows.map((flow) => flow.id)).toEqual(expect.arrayContaining([
      'construction_operations_project_create',
      'construction_operations_bid_creation',
      'construction_operations_schedule_entry',
      'construction_operations_safety_log_entry',
      'construction_operations_equipment_record',
    ]));
    expect(canary.flows.map((flow) => flow.id)).toEqual(expect.arrayContaining([
      'construction_operations_project_create',
      'construction_operations_bid_creation',
      'construction_operations_schedule_entry',
      'construction_operations_safety_log_entry',
      'construction_operations_equipment_record',
    ]));
    expect(canary.entities.find((entity) => entity.name === 'projects')?.fields.map((field) => field.name))
      .toEqual(expect.arrayContaining(['name', 'startDate', 'endDate', 'description']));
    expect(canary.acceptance.userIsolation).toBe(true);
    expect(canary.acceptance.publicDataLeakCheck).toBe(true);
  });

  it('formats parseable contract evidence for gates and testers', () => {
    const architecture = constructionArchitecture();
    const contract = deriveProductBuildContract({
      lane: 'canary',
      taskIntent: 'new_app_build',
      planningDepth: 'canary_world_class',
      architecture,
      domains: ['construction_operations'],
      capabilities: architecture.capabilities,
    });
    const evidence = formatProductBuildContractEvidence(contract);
    const parsed = parseProductBuildContractEvidence(evidence);

    expect(evidence).toContain('PRODUCT_BUILD_CONTRACT_JSON');
    expect(parsed.present).toBe(true);
    expect(parsed.flowCount).toBe(contract.flows.length);
    expect(parsed.flowIds).toContain('construction_operations_safety_log_entry');
    expect(parsed.contract?.flows.length).toBe(contract.flows.length);
  });

  it('evaluates exact contract flow and field proof instead of trusting counts', () => {
    const required = ['auth_session', 'construction_operations_project_create'];
    const duplicateProof = [
      'ACCEPTANCE_PROOF_EVIDENCE passed=2 failed=0 contract_flows=2',
      'CONTRACT_FLOW_PROOF id=auth_session passed=true interaction=signup',
      'CONTRACT_FLOW_PROOF id=auth_session passed=true interaction=signup_again',
    ].join('\n');
    const proofs = parseContractFlowProofEvidence(duplicateProof);
    expect(parseAcceptanceProofEvidence(duplicateProof)?.passed).toBe(2);
    expect(missingContractFlowIds(required, proofs)).toEqual(['construction_operations_project_create']);

    const fieldProofs = parseContractFieldProofEvidence(
      'CONTRACT_FIELD_PROOF flow_id=construction_operations_project_create passed=true entity=projects db_table=projects fields=name,startdate',
    );
    expect(missingContractFieldProofs([
      {
        flowId: 'construction_operations_project_create',
        flowName: 'project create',
        entity: 'projects',
        fields: ['name', 'startdate', 'enddate'],
      },
    ], fieldProofs)).toHaveLength(1);
  });

  it('uses the latest acceptance and auth proof markers during repair replay', () => {
    const replayLog = [
      'ACCEPTANCE_PROOF_EVIDENCE passed=0 failed=1 contract_flows=1',
      'AUTH_ISOLATION_PROOF_EVIDENCE passed=0 failed=1 checks=1',
      'CONTRACT_FLOW_PROOF id=auth_session passed=false interaction=first_try',
      'ACCEPTANCE_PROOF_EVIDENCE passed=1 failed=0 contract_flows=1',
      'AUTH_ISOLATION_PROOF_EVIDENCE passed=1 failed=0 checks=1',
      'CONTRACT_FLOW_PROOF id=auth_session passed=true interaction=repair_try',
    ].join('\n');

    expect(parseAcceptanceProofEvidence(replayLog)).toMatchObject({
      passed: 1,
      failed: 0,
      contractFlows: 1,
    });
    expect(parseAuthIsolationProofEvidence(replayLog)).toMatchObject({
      present: true,
      passed: 1,
      failed: 0,
      checks: 1,
    });
  });

  it('prefers the strongest original product contract over a smaller repair contract', () => {
    const contractFlow = (id: string) => ({
      id,
      name: id,
      laneRequired: ['canary' as const],
      startPath: '/',
      actions: [],
      entitiesTouched: [],
      successReadback: [],
      dbAssertions: [],
      authRequired: id !== 'auth_session',
    });
    const originalContract: ProductBuildContract = {
      version: 1,
      lane: 'canary',
      source: 'domain_augmented',
      roles: ['investor'],
      screens: [],
      flows: [
        'auth_session',
        'finance_crypto_create_portfolio',
        'finance_crypto_price_alert',
        'finance_crypto_transaction_history',
        'finance_crypto_external_api_fallback',
      ].map(contractFlow),
      entities: [],
      apiActions: [],
      acceptance: {
        ctaRules: [],
        authBaseline: true,
        userIsolation: true,
        dbPersistence: true,
        noMockSuccess: true,
        publicDataLeakCheck: true,
      },
    };
    const repairContract: ProductBuildContract = {
      ...originalContract,
      flows: [
        'auth_session',
        'auth_access_journey',
        'create_and_list_record_journey',
        'billing_journey',
      ].map(contractFlow),
    };

    const evidence = parseProductBuildContractEvidence([
      formatProductBuildContractEvidence(originalContract),
      formatProductBuildContractEvidence(repairContract),
    ].join('\n'));

    expect(evidence.flowCount).toBe(5);
    expect(evidence.flowIds).toEqual([
      'auth_session',
      'finance_crypto_create_portfolio',
      'finance_crypto_price_alert',
      'finance_crypto_transaction_history',
      'finance_crypto_external_api_fallback',
    ]);
    expect(evidence.contract?.flows.map((flow) => flow.id)).toEqual(evidence.flowIds);
  });

  it('requires product contracts only for real app builds, not fast repairs', () => {
    expect(requiresProductBuildContract({
      lane: 'fast',
      taskIntent: 'ui_polish',
      planningDepth: 'simple_feature',
      isUserFacing: true,
      focusedRepair: true,
    })).toBe(false);

    expect(requiresProductBuildContract({
      lane: 'standard',
      taskIntent: 'new_app_build',
      planningDepth: 'standard_app',
      isUserFacing: true,
      focusedRepair: false,
    })).toBe(true);
  });
});
