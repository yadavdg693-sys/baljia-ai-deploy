import { describe, expect, it } from 'vitest';
import {
  ENGINEERING_SUBAGENTS,
  assertParentOnlyCanComplete,
  blockedEngineeringLaneOutputs,
  buildEngineeringLanePackets,
  collectEngineeringLaneOutputs,
  engineeringLaneCompletionIssues,
  formatEngineeringLaneOutputEvidence,
  formatEngineeringLanePacketEvidence,
  formatEngineeringLaneRequirementsEvidence,
  normalizeEngineeringLaneOutput,
  parseEngineeringLaneOutputEvidence,
  parseEngineeringLaneRequirementsEvidence,
  requiredEngineeringSubagents,
  selectEngineeringLanes,
} from './engineering-subagents';

describe('engineering lane model', () => {
  it('keeps completion authority with the parent Engineering Agent', () => {
    expect(ENGINEERING_SUBAGENTS.backend.canCompleteTask).toBe(false);
    expect(() => assertParentOnlyCanComplete('backend')).toThrow(/cannot mark tasks complete/i);
    expect(() => assertParentOnlyCanComplete('parent')).not.toThrow();
  });

  it('selects no heavy lanes for small UI-only polish', () => {
    expect(requiredEngineeringSubagents('Fix button label color and spacing')).toEqual([]);
    expect(requiredEngineeringSubagents('Create settings button on existing page')).toEqual([]);
  });

  it('selects repair and qa for focused failed-gate work', () => {
    expect(selectEngineeringLanes({
      taskText: 'Fix failed completion gate for existing app auth logout issue',
      taskIntent: 'focused_repair',
    })).toEqual(['repair', 'qa']);
  });

  it('selects full app lanes plus reviewer for canary app builds', () => {
    expect(selectEngineeringLanes({
      taskText: 'CANARY build a construction operations full app',
      lane: 'canary',
      taskIntent: 'new_app_build',
      planningDepth: 'canary_world_class',
      productContractRequired: true,
      selectedDomains: ['construction_ops'],
      selectedCapabilities: ['auth', 'crud', 'dashboard', 'deployment_render'],
      isUserFacing: true,
    })).toEqual(['planner', 'domain', 'frontend', 'backend', 'qa', 'deploy', 'reviewer']);
  });

  it('builds role-specific packets from the same Product Build Contract', () => {
    const packets = buildEngineeringLanePackets({
      task: { title: 'Build projects app', description: 'Create projects with dates', tag: 'engineering' },
      roles: ['frontend', 'backend', 'qa'],
      selectedCapabilities: ['auth', 'crud'],
      productContract: {
        version: 1,
        lane: 'standard',
        source: 'assumed',
        roles: ['owner'],
        screens: [{ route: '/projects', purpose: 'project list', featureClaims: ['create project'] }],
        flows: [{
          id: 'project_create',
          name: 'Create project',
          laneRequired: ['standard'],
          startPath: '/projects',
          actions: ['submit project form'],
          entitiesTouched: ['project'],
          successReadback: ['project appears'],
          dbAssertions: ['project row exists'],
          authRequired: true,
        }],
        entities: [{ name: 'project', userScoped: true, fields: [{ name: 'name', required: true }, { name: 'start_date', required: true }] }],
        apiActions: [{ method: 'POST', path: '/api/projects', action: 'create project', authRequired: true, requestFields: ['name', 'start_date'], responseReadback: ['id'], dbTable: 'projects' }],
        acceptance: { ctaRules: [], authBaseline: true, userIsolation: true, dbPersistence: true, noMockSuccess: true, publicDataLeakCheck: false },
      },
      requiredFlowIds: ['project_create'],
      fieldRequirements: [{ flowId: 'project_create', flowName: 'Create project', entity: 'project', fields: ['name', 'start_date'] }],
    });

    expect(packets.frontend?.contract.screens?.[0]?.route).toBe('/projects');
    expect(packets.backend?.contract.apiActions?.[0]?.path).toBe('/api/projects');
    expect(packets.qa?.contract.requiredFlowIds).toEqual(['project_create']);
  });

  it('formats and parses lane output evidence', () => {
    const output = normalizeEngineeringLaneOutput({
      role: 'qa',
      status: 'blocked',
      contract_sections: ['project_create'],
      evidence_markers: ['CONTRACT_FLOW_PROOF:project_create'],
      blockers: ['missing field proof'],
    });
    const marker = formatEngineeringLaneOutputEvidence(output);
    expect(parseEngineeringLaneOutputEvidence(marker)).toMatchObject({
      role: 'qa',
      status: 'blocked',
      cannot_complete_task: true,
    });
    expect(blockedEngineeringLaneOutputs([output])).toHaveLength(1);
  });

  it('formats PBC-derived lane requirement and packet evidence', () => {
    const packets = buildEngineeringLanePackets({
      task: { title: 'Build projects app', description: 'Create projects with dates', tag: 'engineering' },
      roles: ['frontend', 'backend', 'qa'],
      productContract: {
        version: 1,
        lane: 'standard',
        source: 'assumed',
        roles: ['owner'],
        screens: [{ route: '/projects', purpose: 'project list', featureClaims: ['create project'] }],
        flows: [{
          id: 'project_create',
          name: 'Create project',
          laneRequired: ['standard'],
          startPath: '/projects',
          actions: ['submit project form'],
          entitiesTouched: ['project'],
          successReadback: ['project appears'],
          dbAssertions: ['project row exists'],
          authRequired: true,
        }],
        entities: [{ name: 'project', userScoped: true, fields: [{ name: 'name', required: true }] }],
        apiActions: [{ method: 'POST', path: '/api/projects', action: 'create project', authRequired: true, requestFields: ['name'], responseReadback: ['id'], dbTable: 'projects' }],
        acceptance: { ctaRules: [], authBaseline: true, userIsolation: true, dbPersistence: true, noMockSuccess: true, publicDataLeakCheck: false },
      },
      requiredFlowIds: ['project_create'],
    });

    const requirements = formatEngineeringLaneRequirementsEvidence({
      roles: ['frontend', 'backend', 'qa'],
      source: 'product_build_contract',
    });
    const packetEvidence = formatEngineeringLanePacketEvidence(packets);

    expect(parseEngineeringLaneRequirementsEvidence(requirements)).toEqual(['frontend', 'backend', 'qa']);
    expect(packetEvidence).toContain('ENGINEERING_LANE_PACKET role=frontend');
    expect(packetEvidence).toContain('flows=project_create');
    expect(packetEvidence).toContain('entities=project');
    expect(packetEvidence).toContain('required_flow_ids=project_create');
  });

  it('indexes collected outputs and rejects weak or stale completed lanes', () => {
    const strong = formatEngineeringLaneOutputEvidence(normalizeEngineeringLaneOutput({
      role: 'qa',
      status: 'completed',
      contract_sections: ['project_create'],
      evidence_markers: ['CONTRACT_FLOW_PROOF:project_create'],
    }));
    const weak = formatEngineeringLaneOutputEvidence(normalizeEngineeringLaneOutput({
      role: 'deploy',
      status: 'completed',
    }));

    const outputs = collectEngineeringLaneOutputs([
      { tool: 'noop', result: 'ignored' },
      { tool: 'record_engineering_lane_output', result: strong },
      { tool: 'record_engineering_lane_output', result: weak },
    ]);

    expect(outputs[0].logIndex).toBe(1);
    expect(engineeringLaneCompletionIssues(['qa'], outputs, { minLogIndex: 2 })[0]?.reason).toBe('stale');
    expect(engineeringLaneCompletionIssues(['deploy'], outputs)[0]?.reason).toBe('weak');
    expect(engineeringLaneCompletionIssues(['qa'], outputs, { minLogIndex: 1 })).toEqual([]);
  });

  it('keeps blocked lane output sticky until a completed output resolves it', () => {
    const blocked = normalizeEngineeringLaneOutput({
      role: 'qa',
      status: 'blocked',
      blockers: ['missing auth isolation'],
    });
    const skipped = normalizeEngineeringLaneOutput({
      role: 'qa',
      status: 'skipped',
    });
    const completed = normalizeEngineeringLaneOutput({
      role: 'qa',
      status: 'completed',
      contract_sections: ['auth_session'],
      evidence_markers: ['AUTH_ISOLATION_PROOF_EVIDENCE'],
    });
    const weakCompleted = normalizeEngineeringLaneOutput({
      role: 'qa',
      status: 'completed',
    });

    expect(blockedEngineeringLaneOutputs([blocked, skipped])).toHaveLength(1);
    expect(blockedEngineeringLaneOutputs([blocked, weakCompleted])).toHaveLength(1);
    expect(blockedEngineeringLaneOutputs([blocked, skipped, completed])).toHaveLength(0);
  });
});
