import type { ContextPacket } from '@/types';
import type { ContractFieldRequirement, ProductBuildContract } from '../product-build-contract';
import type { PlanningDepth } from '../planning-depth';
import type { TaskIntent } from '../task-intent';
import type { TaskLane } from '../task-lane';

export type EngineeringLaneRole =
  | 'planner'
  | 'domain'
  | 'frontend'
  | 'backend'
  | 'qa'
  | 'deploy'
  | 'repair'
  | 'reviewer';

export type EngineeringSubagentRole = EngineeringLaneRole;

export type EngineeringLaneStatus = 'completed' | 'blocked' | 'skipped';

export interface EngineeringSubagentDefinition {
  role: EngineeringLaneRole;
  name: string;
  owns: string[];
  canCompleteTask: false;
  handoffRequires: string[];
}

export interface EngineeringLaneSelectionInput {
  taskText?: string | null;
  lane?: TaskLane | null;
  taskIntent?: TaskIntent | null;
  planningDepth?: PlanningDepth | null;
  isUserFacing?: boolean;
  selectedCapabilities?: string[];
  selectedDomains?: string[];
  productContractRequired?: boolean;
}

export interface EngineeringLanePacketInput {
  task: {
    title?: string | null;
    description?: string | null;
    tag?: string | null;
  };
  contextPacket?: ContextPacket;
  productContract?: ProductBuildContract | null;
  requiredFlowIds?: string[];
  fieldRequirements?: ContractFieldRequirement[];
  selectedCapabilities?: string[];
  selectedDomains?: string[];
  deployedUrl?: string | null;
  roles?: EngineeringLaneRole[];
}

export interface EngineeringLanePacket {
  role: EngineeringLaneRole;
  task: {
    title: string;
    description: string;
    tag: string;
  };
  contract: {
    screens?: ProductBuildContract['screens'];
    flows?: ProductBuildContract['flows'];
    entities?: ProductBuildContract['entities'];
    apiActions?: ProductBuildContract['apiActions'];
    acceptance?: ProductBuildContract['acceptance'];
    requiredFlowIds?: string[];
    fieldRequirements?: ContractFieldRequirement[];
  };
  context: {
    companyState?: ContextPacket['company_state'];
    codebaseMap?: string | null;
    founderPreferences?: string;
    domainKnowledge?: string;
    selectedCapabilities: string[];
    selectedDomains: string[];
    deployedUrl?: string | null;
  };
  instructions: string[];
}

export interface EngineeringLaneOutput {
  role: EngineeringLaneRole;
  status: EngineeringLaneStatus;
  contract_sections: string[];
  evidence_markers: string[];
  files_touched: string[];
  blockers: string[];
  notes?: string | null;
  cannot_complete_task: true;
  logIndex?: number;
}

export interface EngineeringLaneRequirementEvidence {
  roles: EngineeringLaneRole[];
  source?: string | null;
}

export type EngineeringLaneCompletionIssueReason = 'missing' | 'not_completed' | 'weak' | 'stale';

export interface EngineeringLaneCompletionIssue {
  role: EngineeringLaneRole;
  reason: EngineeringLaneCompletionIssueReason;
  detail: string;
}

export const ENGINEERING_SUBAGENTS: Record<EngineeringLaneRole, EngineeringSubagentDefinition> = {
  planner: {
    role: 'planner',
    name: 'Planner',
    owns: ['build_brief', 'product_build_contract', 'assumptions', 'non_goals'],
    canCompleteTask: false,
    handoffRequires: ['BUILD_BRIEF_EVIDENCE', 'PRODUCT_BUILD_CONTRACT_EVIDENCE'],
  },
  domain: {
    role: 'domain',
    name: 'Domain',
    owns: ['domain_workflows', 'domain_entities', 'required_fields', 'anti_generic_checks'],
    canCompleteTask: false,
    handoffRequires: ['DOMAIN_MATCH_EVIDENCE or AD_HOC_DOMAIN_EVIDENCE'],
  },
  frontend: {
    role: 'frontend',
    name: 'Frontend',
    owns: ['routes', 'screens', 'forms', 'cta_mapping', 'ui_readback'],
    canCompleteTask: false,
    handoffRequires: ['FRONTEND_PLAN_EVIDENCE', 'INTERACTION_CONTRACT_EVIDENCE'],
  },
  backend: {
    role: 'backend',
    name: 'Backend',
    owns: ['api_routes', 'db_entities', 'auth_rules', 'persistence'],
    canCompleteTask: false,
    handoffRequires: ['schema/api implementation summary', 'DB proof requirements'],
  },
  qa: {
    role: 'qa',
    name: 'QA',
    owns: ['contract_flow_proofs', 'field_proofs', 'auth_isolation', 'browser_ui', 'db_state'],
    canCompleteTask: false,
    handoffRequires: ['CONTRACT_FLOW_PROOF', 'CONTRACT_FIELD_PROOF'],
  },
  deploy: {
    role: 'deploy',
    name: 'Deploy',
    owns: ['render_service', 'env_vars', 'logs', 'health', 'deployment_url'],
    canCompleteTask: false,
    handoffRequires: ['render logs clean', 'check_url_health 2xx'],
  },
  repair: {
    role: 'repair',
    name: 'Repair',
    owns: ['single_failed_gate', 'single_verifier_failure', 'targeted_patch'],
    canCompleteTask: false,
    handoffRequires: ['repair_summary', 'rerun_required_gate'],
  },
  reviewer: {
    role: 'reviewer',
    name: 'Reviewer',
    owns: ['semantic_review', 'risk_analysis', 'missing_tests', 'regression_risk'],
    canCompleteTask: false,
    handoffRequires: ['review_findings'],
  },
};

const UI_CAPABILITIES = new Set([
  'dashboard',
  'admin_workflow',
  'booking',
  'marketplace',
  'cart_orders_checkout',
  'search',
  'rich_text_cms',
  'seo_public_pages',
]);

const BACKEND_CAPABILITIES = new Set([
  'auth',
  'roles',
  'crud',
  'uploads_storage',
  'payments_stripe',
  'stripe_webhooks',
  'ai_openai',
  'rag_search',
  'cron_jobs',
  'email_notifications',
  'audit_logs',
]);

export function requiredEngineeringSubagents(taskText: string): EngineeringLaneRole[] {
  return selectEngineeringLanes({
    taskText,
    isUserFacing: /\b(ui|frontend|page|dashboard|form|button|screen|app|website|landing|mobile|browser)\b/i.test(taskText),
    productContractRequired: /\b(new app|full app|full[-\s]?stack|canary|world-class|saas|portal|marketplace|booking)\b/i.test(taskText) ||
      /\b(build|create|make|generate)\b[\s\S]{0,80}\b(app|saas|portal|marketplace|dashboard|booking|crm|store|platform)\b/i.test(taskText),
  });
}

export function selectEngineeringLanes(input: EngineeringLaneSelectionInput): EngineeringLaneRole[] {
  const text = `${input.taskText ?? ''}`.toLowerCase();
  const capabilities = new Set((input.selectedCapabilities ?? []).map((item) => item.trim()).filter(Boolean));
  const roles: EngineeringLaneRole[] = [];
  const add = (role: EngineeringLaneRole) => {
    if (!roles.includes(role)) roles.push(role);
  };

  const repairLike =
    input.taskIntent === 'focused_repair' ||
    /\b(fix|repair|failed|failure|broken|regression|gate|verify|debug)\b/i.test(text);
  const fullAppLike =
    input.productContractRequired ||
    input.taskIntent === 'new_app_build' ||
    input.planningDepth === 'standard_app' ||
    input.planningDepth === 'mixed_complex_app' ||
    input.planningDepth === 'canary_world_class' ||
    input.lane === 'strict' ||
    input.lane === 'canary' ||
    /\b(full[-\s]?stack|full app|new app|build.*app|saas|portal|marketplace|booking|canary|world-class)\b/i.test(text);
  const uiOnly =
    /\b(copy|color|spacing|font|typography|layout|visual|button|cta|polish)\b/i.test(text) &&
    !/\b(api|db|database|auth|login|signup|submit|save|backend|endpoint)\b/i.test(text);
  const hasUiCapability = [...capabilities].some((capability) => UI_CAPABILITIES.has(capability));
  const hasBackendCapability = [...capabilities].some((capability) => BACKEND_CAPABILITIES.has(capability));
  const hasDomainShape = (input.selectedDomains?.length ?? 0) > 0 || /\b(construction|crm|ecommerce|inventory|finance|health|real estate|education|booking)\b/i.test(text);

  if (uiOnly && !fullAppLike) return [];

  if (repairLike && !fullAppLike) {
    add('repair');
    add('qa');
    return roles;
  }

  if (fullAppLike) {
    add('planner');
    if (hasDomainShape || input.planningDepth === 'mixed_complex_app' || input.planningDepth === 'canary_world_class') add('domain');
    add('frontend');
    add('backend');
    add('qa');
    add('deploy');
    if (input.lane === 'strict' || input.lane === 'canary' || input.planningDepth === 'canary_world_class') add('reviewer');
    return roles;
  }

  if (input.isUserFacing || hasUiCapability) {
    add('planner');
    add('frontend');
  }
  if (hasBackendCapability || /\b(api|db|database|auth|login|signup|backend|endpoint|webhook|cron)\b/i.test(text)) {
    add('planner');
    add('backend');
  }
  if (roles.length > 0) add('qa');
  return roles;
}

export function buildEngineeringLanePackets(input: EngineeringLanePacketInput): Partial<Record<EngineeringLaneRole, EngineeringLanePacket>> {
  const roles = input.roles ?? requiredEngineeringSubagents(`${input.task.title ?? ''}\n${input.task.description ?? ''}`);
  const packets: Partial<Record<EngineeringLaneRole, EngineeringLanePacket>> = {};
  for (const role of roles) {
    packets[role] = buildLanePacket(role, input);
  }
  return packets;
}

export function normalizeEngineeringLaneOutput(input: Record<string, unknown>): EngineeringLaneOutput {
  const role = String(input.role ?? '').trim() as EngineeringLaneRole;
  if (!isEngineeringLaneRole(role)) {
    throw new Error(`Invalid Engineering lane role: ${String(input.role ?? '')}`);
  }
  const status = String(input.status ?? 'completed').trim() as EngineeringLaneStatus;
  if (!isEngineeringLaneStatus(status)) {
    throw new Error(`Invalid Engineering lane status: ${String(input.status ?? '')}`);
  }
  return {
    role,
    status,
    contract_sections: stringArray(input.contract_sections),
    evidence_markers: stringArray(input.evidence_markers),
    files_touched: stringArray(input.files_touched),
    blockers: stringArray(input.blockers),
    notes: typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim().slice(0, 1000) : null,
    cannot_complete_task: true,
  };
}

export function formatEngineeringLaneOutputEvidence(output: EngineeringLaneOutput): string {
  const jsonOutput = { ...output };
  delete jsonOutput.logIndex;
  return [
    `ENGINEERING_LANE_OUTPUT role=${output.role} status=${output.status} cannot_complete_task=true sections=${output.contract_sections.join(',') || 'none'} evidence=${output.evidence_markers.join(',') || 'none'} blockers=${output.blockers.length}`,
    `ENGINEERING_LANE_OUTPUT_JSON ${JSON.stringify(jsonOutput)}`,
  ].join('\n');
}

export function formatEngineeringLaneRequirementsEvidence(input: EngineeringLaneRequirementEvidence): string {
  const roles = uniqueLaneRoles(input.roles);
  const source = markerSafe(input.source ?? 'product_build_contract');
  return `ENGINEERING_LANE_REQUIREMENTS roles=${roles.join(',') || 'none'} source=${source}`;
}

export function parseEngineeringLaneRequirementsEvidence(text: string): EngineeringLaneRole[] {
  const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith('ENGINEERING_LANE_REQUIREMENTS '));
  if (!line) return [];
  return uniqueLaneRoles(markerCsv(line, 'roles').filter(isEngineeringLaneRole));
}

export function formatEngineeringLanePacketEvidence(
  packets: Partial<Record<EngineeringLaneRole, EngineeringLanePacket>>,
): string {
  return Object.values(packets)
    .filter((packet): packet is EngineeringLanePacket => Boolean(packet))
    .map((packet) => {
      const flows = packet.contract.flows?.map((flow) => flow.id) ?? [];
      const entities = packet.contract.entities?.map((entity) => entity.name) ?? [];
      const apiActions = packet.contract.apiActions?.map((action) => `${action.method}:${action.path}`) ?? [];
      const requiredFlowIds = packet.contract.requiredFlowIds ?? [];
      const fieldRequirements = packet.contract.fieldRequirements?.map((requirement) => `${requirement.flowId}:${requirement.entity}`) ?? [];
      return [
        'ENGINEERING_LANE_PACKET',
        `role=${packet.role}`,
        `flows=${flows.map(markerSafe).join(',') || 'none'}`,
        `entities=${entities.map(markerSafe).join(',') || 'none'}`,
        `api_actions=${apiActions.map(markerSafe).join(',') || 'none'}`,
        `required_flow_ids=${requiredFlowIds.map(markerSafe).join(',') || 'none'}`,
        `field_requirements=${fieldRequirements.map(markerSafe).join(',') || 'none'}`,
      ].join(' ');
    })
    .join('\n');
}

export function parseEngineeringLaneOutputEvidence(text: string): EngineeringLaneOutput | null {
  const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith('ENGINEERING_LANE_OUTPUT_JSON '));
  if (!line) return null;
  try {
    return normalizeEngineeringLaneOutput(JSON.parse(line.slice('ENGINEERING_LANE_OUTPUT_JSON '.length)) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function collectEngineeringLaneOutputs(logEntries: Array<Record<string, unknown>>): EngineeringLaneOutput[] {
  const outputs: EngineeringLaneOutput[] = [];
  for (let i = 0; i < logEntries.length; i++) {
    const entry = logEntries[i];
    if (entry.tool !== 'record_engineering_lane_output' || typeof entry.result !== 'string') continue;
    const parsed = parseEngineeringLaneOutputEvidence(entry.result);
    if (parsed) outputs.push({ ...parsed, logIndex: i });
  }
  return outputs;
}

export function latestEngineeringLaneOutputs(outputs: EngineeringLaneOutput[]): Partial<Record<EngineeringLaneRole, EngineeringLaneOutput>> {
  const latest: Partial<Record<EngineeringLaneRole, EngineeringLaneOutput>> = {};
  for (const output of outputs) latest[output.role] = output;
  return latest;
}

export function blockedEngineeringLaneOutputs(outputs: EngineeringLaneOutput[]): EngineeringLaneOutput[] {
  const unresolved = new Map<EngineeringLaneRole, EngineeringLaneOutput>();
  for (const output of outputs) {
    if (output.status === 'blocked') {
      unresolved.set(output.role, output);
    } else if (output.status === 'completed' && engineeringLaneOutputIsMeaningful(output)) {
      unresolved.delete(output.role);
    }
  }
  return [...unresolved.values()];
}

export function engineeringLaneOutputIsMeaningful(output: EngineeringLaneOutput): boolean {
  if (output.status !== 'completed') return true;
  return output.contract_sections.length > 0 && output.evidence_markers.length > 0;
}

export function engineeringLaneCompletionIssues(
  requiredRoles: EngineeringLaneRole[],
  outputs: EngineeringLaneOutput[],
  options: { minLogIndex?: number } = {},
): EngineeringLaneCompletionIssue[] {
  const latest = latestEngineeringLaneOutputs(outputs);
  const minLogIndex = options.minLogIndex ?? -1;
  return uniqueLaneRoles(requiredRoles).flatMap((role): EngineeringLaneCompletionIssue[] => {
    const output = latest[role];
    if (!output) {
      return [{ role, reason: 'missing', detail: `${role} has no recorded lane output` }];
    }
    if (output.status !== 'completed') {
      return [{ role, reason: 'not_completed', detail: `${role} latest lane output is ${output.status}` }];
    }
    if (!engineeringLaneOutputIsMeaningful(output)) {
      return [{
        role,
        reason: 'weak',
        detail: `${role} completed output must include at least one contract section and one evidence marker`,
      }];
    }
    if ((output.logIndex ?? -1) < minLogIndex) {
      return [{
        role,
        reason: 'stale',
        detail: `${role} completed output is stale; record it after the latest product contract, push/deploy, and proof evidence`,
      }];
    }
    return [];
  });
}

export function assertParentOnlyCanComplete(role: EngineeringLaneRole | 'parent'): void {
  if (role !== 'parent') {
    throw new Error('Engineering subagents cannot mark tasks complete; parent Engineering Agent must reconcile outputs and pass the completion gate.');
  }
}

function buildLanePacket(role: EngineeringLaneRole, input: EngineeringLanePacketInput): EngineeringLanePacket {
  const productContract = input.productContract ?? null;
  return {
    role,
    task: {
      title: input.task.title ?? '',
      description: input.task.description ?? '',
      tag: input.task.tag ?? '',
    },
    contract: contractSliceForRole(role, productContract, input.requiredFlowIds ?? [], input.fieldRequirements ?? []),
    context: {
      companyState: input.contextPacket?.company_state,
      codebaseMap: input.contextPacket?.codebase_map ?? null,
      founderPreferences: input.contextPacket?.memory_layers.l2_user_preferences ?? '',
      domainKnowledge: input.contextPacket?.memory_layers.l1_domain_knowledge ?? '',
      selectedCapabilities: input.selectedCapabilities ?? [],
      selectedDomains: input.selectedDomains ?? [],
      deployedUrl: input.deployedUrl ?? null,
    },
    instructions: laneInstructions(role),
  };
}

function contractSliceForRole(
  role: EngineeringLaneRole,
  contract: ProductBuildContract | null,
  requiredFlowIds: string[],
  fieldRequirements: ContractFieldRequirement[],
): EngineeringLanePacket['contract'] {
  if (!contract) return { requiredFlowIds, fieldRequirements };
  switch (role) {
    case 'frontend':
      return {
        screens: contract.screens,
        flows: contract.flows,
        entities: contract.entities,
        acceptance: contract.acceptance,
        requiredFlowIds,
        fieldRequirements,
      };
    case 'backend':
      return {
        flows: contract.flows,
        entities: contract.entities,
        apiActions: contract.apiActions,
        acceptance: contract.acceptance,
        fieldRequirements,
      };
    case 'qa':
      return {
        flows: contract.flows,
        entities: contract.entities,
        apiActions: contract.apiActions,
        acceptance: contract.acceptance,
        requiredFlowIds,
        fieldRequirements,
      };
    case 'domain':
      return {
        screens: contract.screens,
        flows: contract.flows,
        entities: contract.entities,
        fieldRequirements,
      };
    default:
      return {
        screens: contract.screens,
        flows: contract.flows,
        entities: contract.entities,
        apiActions: contract.apiActions,
        acceptance: contract.acceptance,
        requiredFlowIds,
        fieldRequirements,
      };
  }
}

function laneInstructions(role: EngineeringLaneRole): string[] {
  switch (role) {
    case 'planner':
      return ['Lock assumptions, non-goals, MVP features, Product Build Contract flows, and acceptance criteria before coding.'];
    case 'domain':
      return ['Ensure domain-critical workflows, entities, and fields are present; reject generic CRUD collapse.'];
    case 'frontend':
      return ['Map every promised screen/CTA/form to a route, submit action, and visible readback.'];
    case 'backend':
      return ['Implement API, auth, persistence, and tenant/user scoping required by the contract.'];
    case 'qa':
      return ['Verify exact PBC flow ids, field proofs, auth isolation, DB state, and browser UI against the deployed app.'];
    case 'deploy':
      return ['Verify Render deploy, logs, health, URL, env vars, and final sweep freshness.'];
    case 'repair':
      return ['Fix one failed gate surface, then rerun only the required proof for that failed surface.'];
    case 'reviewer':
      return ['Review semantic risk, missing tests, security, auth scoping, and regression risk.'];
  }
}

function isEngineeringLaneRole(value: string): value is EngineeringLaneRole {
  return Object.prototype.hasOwnProperty.call(ENGINEERING_SUBAGENTS, value);
}

function isEngineeringLaneStatus(value: string): value is EngineeringLaneStatus {
  return value === 'completed' || value === 'blocked' || value === 'skipped';
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 50);
}

function uniqueLaneRoles(values: EngineeringLaneRole[]): EngineeringLaneRole[] {
  const roles: EngineeringLaneRole[] = [];
  for (const value of values) {
    if (isEngineeringLaneRole(value) && !roles.includes(value)) roles.push(value);
  }
  return roles;
}

function markerCsv(line: string, key: string): string[] {
  const value = markerValue(line, key);
  if (!value || value === 'none') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function markerValue(line: string, key: string): string | null {
  const match = line.match(new RegExp(`(?:^|\\s)${key}=([^\\s]+)`));
  return match?.[1] ?? null;
}

function markerSafe(value: string): string {
  return value.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_./,:-]/g, '').slice(0, 160) || 'none';
}
