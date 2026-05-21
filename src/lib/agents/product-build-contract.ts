import type {
  ApiContract,
  CapabilityArchitecturePlan,
  CapabilityId,
} from './capability-registry';
import { getDomainPack, type DomainPack } from './domain-registry';
import type { PlanningDepth } from './planning-depth';
import type { TaskIntent } from './task-intent';
import type { TaskLane } from './task-lane';

export type ProductContractSource = 'explicit' | 'assumed' | 'domain_augmented';

export type BuildBriefEvidence = {
  version: 1;
  lane: TaskLane;
  taskIntent: TaskIntent;
  planningDepth: PlanningDepth;
  primaryVerb: string;
  targetUsers: string[];
  assumptions: string[];
  nonGoals: string[];
  mvpFeatures: string[];
  optionalFeatures: string[];
  domains: string[];
  riskFlags: string[];
};

export type ProductContractField = {
  name: string;
  required: boolean;
};

export type ProductContractEntity = {
  name: string;
  fields: ProductContractField[];
  userScoped: boolean;
};

export type ProductContractScreen = {
  route: string;
  purpose: string;
  featureClaims: string[];
};

export type ProductContractApiAction = {
  method: string;
  path: string;
  action: string;
  authRequired: boolean;
  requestFields: string[];
  responseReadback: string[];
  dbTable: string | null;
};

export type ProductContractFlow = {
  id: string;
  name: string;
  laneRequired: TaskLane[];
  startPath: string;
  actions: string[];
  entitiesTouched: string[];
  successReadback: string[];
  dbAssertions: string[];
  authRequired: boolean;
};

export type ProductContractAcceptance = {
  ctaRules: string[];
  authBaseline: boolean;
  userIsolation: boolean;
  dbPersistence: boolean;
  noMockSuccess: boolean;
  publicDataLeakCheck: boolean;
};

export type ProductBuildContract = {
  version: 1;
  lane: TaskLane;
  source: ProductContractSource;
  roles: string[];
  screens: ProductContractScreen[];
  flows: ProductContractFlow[];
  entities: ProductContractEntity[];
  apiActions: ProductContractApiAction[];
  acceptance: ProductContractAcceptance;
};

export type AcceptanceProofEvidence = {
  passed: number;
  failed: number;
  contractFlows: number;
  passedFlowIds: string[];
  failedFlowIds: string[];
};

export type ContractFlowProofEvidence = {
  id: string;
  passed: boolean;
  interaction: string | null;
};

export type ContractFieldProofEvidence = {
  flowId: string;
  entity: string | null;
  dbTable: string | null;
  passed: boolean;
  fields: string[];
};

export type AuthIsolationProofEvidence = {
  present: boolean;
  passed: number;
  failed: number;
  checks: number;
};

export type ContractFieldRequirement = {
  flowId: string;
  flowName: string;
  entity: string;
  fields: string[];
};

export type ProductBuildContractInput = {
  title?: string | null;
  description?: string | null;
  productContext?: string | null;
  lane: TaskLane;
  taskIntent: TaskIntent;
  planningDepth: PlanningDepth;
  architecture: CapabilityArchitecturePlan;
  domains?: string[];
  capabilities?: string[];
  explicitAssumptions?: string[];
  explicitNonGoals?: string[];
  explicitMvpFeatures?: string[];
};

const DOMAIN_REQUIRED_ENTITY_FIELDS: Record<string, Record<string, string[]>> = {
  construction_operations: {
    projects: ['name', 'status', 'startDate', 'endDate', 'description'],
    bids: ['projectId', 'amount', 'status', 'submittedBy'],
    estimates: ['projectId', 'amount', 'status'],
    schedule_entries: ['projectId', 'title', 'startDate', 'endDate'],
    safety_logs: ['projectId', 'date', 'severity', 'category', 'description', 'correctiveAction'],
    equipment: ['name', 'status', 'assignedProjectId'],
    subcontractors: ['name', 'trade', 'contactEmail'],
    daily_reports: ['projectId', 'date', 'summary', 'createdBy'],
  },
};

const CAPABILITY_OPTIONAL_FEATURES: Partial<Record<CapabilityId, string[]>> = {
  analytics: ['analytics dashboards'],
  realtime: ['real-time collaboration'],
  email_notifications: ['email notifications'],
  import_export_csv: ['CSV import/export'],
  audit_logs: ['audit trail'],
  payments_stripe: ['payments and billing'],
  uploads_storage: ['file uploads'],
};

export function deriveBuildBrief(input: ProductBuildContractInput): BuildBriefEvidence {
  const capabilities = uniqueStrings(input.capabilities ?? input.architecture.capabilities);
  const domains = uniqueStrings(input.domains ?? input.architecture.domains);
  const domainPacks = loadedDomainPacks(domains);
  const mvpFeatures = uniqueStrings([
    ...coerceList(input.explicitMvpFeatures),
    ...domainPacks.flatMap((pack) => pack.verificationJourneys.map((journey) => journey.name)),
    ...input.architecture.verificationJourneys
      .filter((journey) => !/deployment health/i.test(journey.name))
      .map((journey) => journey.name),
  ]).slice(0, input.lane === 'standard' ? 5 : 12);

  const optionalFeatures = uniqueStrings(
    capabilities.flatMap((capability) => CAPABILITY_OPTIONAL_FEATURES[capability as CapabilityId] ?? []),
  );

  return {
    version: 1,
    lane: input.lane,
    taskIntent: input.taskIntent,
    planningDepth: input.planningDepth,
    primaryVerb: inferPrimaryVerb(input, domains, capabilities),
    targetUsers: uniqueStrings([
      ...input.architecture.actors,
      ...domainPacks.flatMap((pack) => pack.typicalActors),
    ]).slice(0, 8),
    assumptions: uniqueStrings([
      ...coerceList(input.explicitAssumptions),
      domains.length > 0
        ? `Use matched domain workflow requirements for ${domains.join(', ')}.`
        : 'Use capability-derived workflows because no domain pack was selected.',
      capabilities.includes('auth') ? 'Authenticated data is user-scoped unless explicitly public.' : null,
      input.lane === 'standard' ? 'Keep the first build to the core 1-3 vertical workflows.' : null,
    ]),
    nonGoals: uniqueStrings([
      ...coerceList(input.explicitNonGoals),
      'Do not ship landing-page claims without working routes/actions/readback.',
      'Do not copy a saved app template; derive the build from this task contract.',
    ]),
    mvpFeatures,
    optionalFeatures,
    domains,
    riskFlags: uniqueStrings([
      capabilities.includes('auth') ? 'auth_session' : null,
      capabilities.includes('roles') ? 'roles_permissions' : null,
      capabilities.includes('payments_stripe') ? 'payments' : null,
      capabilities.includes('uploads_storage') ? 'file_storage' : null,
      capabilities.includes('external_api') ? 'external_api' : null,
      capabilities.includes('rag_search') ? 'rag' : null,
    ]),
  };
}

export function deriveProductBuildContract(input: ProductBuildContractInput): ProductBuildContract {
  const brief = deriveBuildBrief(input);
  const capabilities = uniqueStrings(input.capabilities ?? input.architecture.capabilities);
  const domains = uniqueStrings(input.domains ?? input.architecture.domains);
  const domainPacks = loadedDomainPacks(domains);
  const authRequired = capabilities.includes('auth') || capabilities.includes('roles');
  const allScreens = buildScreens(input.architecture, domainPacks);
  const allEntities = buildEntities(input.architecture, domainPacks, authRequired);
  const allFlows = buildFlows(input.architecture, domainPacks, input.lane, authRequired);
  const flows = selectLaneFlows(allFlows, input.lane, domainPacks);

  return {
    version: 1,
    lane: input.lane,
    source: domains.length > 0 ? 'domain_augmented' : brief.assumptions.length > 0 ? 'assumed' : 'explicit',
    roles: brief.targetUsers,
    screens: allScreens,
    flows,
    entities: allEntities,
    apiActions: buildApiActions(input.architecture.apiContracts, domainPacks, authRequired),
    acceptance: {
      ctaRules: [
        'Every visible feature CTA must lead to a working route, modal, or submit action for the named feature.',
        'A signup route can satisfy a feature CTA only if the post-auth continuation completes that feature workflow.',
        'Reject href="#", empty href, javascript:void(0), disabled-only controls, and coming-soon/placeholder flows.',
      ],
      authBaseline: authRequired,
      userIsolation: authRequired,
      dbPersistence: true,
      noMockSuccess: true,
      publicDataLeakCheck: authRequired,
    },
  };
}

export function formatBuildBriefEvidence(brief: BuildBriefEvidence): string {
  return [
    `BUILD_BRIEF_EVIDENCE version=${brief.version} lane=${brief.lane} task_intent=${brief.taskIntent} planning_depth=${brief.planningDepth} primary_verb=${slug(brief.primaryVerb)} assumptions=${brief.assumptions.length} non_goals=${brief.nonGoals.length} mvp_features=${brief.mvpFeatures.length} domains=${brief.domains.join(',') || 'none'} risks=${brief.riskFlags.join(',') || 'none'}`,
    `BUILD_BRIEF_JSON ${JSON.stringify(brief)}`,
  ].join('\n');
}

export function formatProductBuildContractEvidence(contract: ProductBuildContract): string {
  return [
    `PRODUCT_BUILD_CONTRACT_EVIDENCE version=${contract.version} lane=${contract.lane} source=${contract.source} screens=${contract.screens.length} flows=${contract.flows.length} entities=${contract.entities.length} api_actions=${contract.apiActions.length} auth_baseline=${contract.acceptance.authBaseline ? 'true' : 'false'} user_isolation=${contract.acceptance.userIsolation ? 'true' : 'false'} flow_ids=${contract.flows.map((flow) => flow.id).join(',') || 'none'}`,
    `PRODUCT_BUILD_CONTRACT_JSON ${JSON.stringify(contract)}`,
  ].join('\n');
}

export function parseProductBuildContractEvidence(text: string): {
  present: boolean;
  flowCount: number;
  flowIds: string[];
  authBaseline: boolean;
  userIsolation: boolean;
  contract: ProductBuildContract | null;
} {
  const lines = markerLines(text, 'PRODUCT_BUILD_CONTRACT_EVIDENCE');
  const line = selectBestProductContractEvidenceLine(lines);
  if (!line) return { present: false, flowCount: 0, flowIds: [], authBaseline: false, userIsolation: false, contract: null };
  const flowIds = csvMarkerValues(line, 'flow_ids');
  const flowCount = Number(markerValue(line, 'flows') ?? 0) || 0;
  return {
    present: true,
    flowCount,
    flowIds,
    authBaseline: markerValue(line, 'auth_baseline') === 'true',
    userIsolation: markerValue(line, 'user_isolation') === 'true',
    contract: parseProductBuildContractJson(text, { flowCount, flowIds }),
  };
}

export function parseBuildBriefEvidence(text: string): { present: boolean } {
  return { present: Boolean(markerLine(text, 'BUILD_BRIEF_EVIDENCE')) };
}

export function parseAcceptanceProofEvidence(text: string): AcceptanceProofEvidence | null {
  const line = latestMarkerLine(text, 'ACCEPTANCE_PROOF_EVIDENCE');
  if (!line) return null;
  const flowProofs = parseContractFlowProofEvidence(text);
  return {
    passed: Number(markerValue(line, 'passed') ?? 0) || 0,
    failed: Number(markerValue(line, 'failed') ?? 0) || 0,
    contractFlows: Number(markerValue(line, 'contract_flows') ?? 0) || 0,
    passedFlowIds: uniqueStrings(flowProofs.filter((proof) => proof.passed).map((proof) => proof.id)),
    failedFlowIds: uniqueStrings(flowProofs.filter((proof) => !proof.passed).map((proof) => proof.id)),
  };
}

export function formatContractFlowProofLine(flowId: string, passed: boolean, interactionName: string): string {
  return `CONTRACT_FLOW_PROOF id=${slug(flowId)} passed=${passed ? 'true' : 'false'} interaction=${slug(interactionName)}`;
}

export function formatContractFieldProofLine(input: {
  flowId: string;
  entity?: string | null;
  dbTable?: string | null;
  fields: string[];
  passed: boolean;
}): string {
  return [
    'CONTRACT_FIELD_PROOF',
    `flow_id=${slug(input.flowId)}`,
    `passed=${input.passed ? 'true' : 'false'}`,
    `entity=${slug(input.entity ?? 'unknown')}`,
    `db_table=${slug(input.dbTable ?? input.entity ?? 'unknown')}`,
    `fields=${uniqueStrings(input.fields).map(slug).join(',') || 'none'}`,
  ].join(' ');
}

export function formatAuthIsolationProofEvidence(input: {
  passed: number;
  failed: number;
  checks: number;
}): string {
  return `AUTH_ISOLATION_PROOF_EVIDENCE passed=${input.passed} failed=${input.failed} checks=${input.checks}`;
}

export function parseContractFlowProofEvidence(text: string): ContractFlowProofEvidence[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('CONTRACT_FLOW_PROOF'))
    .map((line) => ({
      id: markerValue(line, 'id') ?? '',
      passed: markerValue(line, 'passed') === 'true',
      interaction: markerValue(line, 'interaction'),
    }))
    .filter((proof) => proof.id.length > 0);
}

export function parseContractFieldProofEvidence(text: string): ContractFieldProofEvidence[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('CONTRACT_FIELD_PROOF'))
    .map((line) => ({
      flowId: markerValue(line, 'flow_id') ?? '',
      entity: markerValue(line, 'entity'),
      dbTable: markerValue(line, 'db_table'),
      passed: markerValue(line, 'passed') === 'true',
      fields: csvMarkerValues(line, 'fields').map(slug),
    }))
    .filter((proof) => proof.flowId.length > 0);
}

export function parseAuthIsolationProofEvidence(text: string): AuthIsolationProofEvidence {
  const line = latestMarkerLine(text, 'AUTH_ISOLATION_PROOF_EVIDENCE');
  if (!line) return { present: false, passed: 0, failed: 0, checks: 0 };
  return {
    present: true,
    passed: Number(markerValue(line, 'passed') ?? 0) || 0,
    failed: Number(markerValue(line, 'failed') ?? 0) || 0,
    checks: Number(markerValue(line, 'checks') ?? 0) || 0,
  };
}

export function parseProductBuildContractJson(
  text: string,
  preferred?: { flowCount?: number; flowIds?: string[] },
): ProductBuildContract | null {
  const candidates = text
    .split(/\r?\n/)
    .filter((candidate) => candidate.startsWith('PRODUCT_BUILD_CONTRACT_JSON '))
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line.slice('PRODUCT_BUILD_CONTRACT_JSON '.length)) as ProductBuildContract;
        return parsed?.version === 1 && Array.isArray(parsed.flows) && Array.isArray(parsed.entities) ? [parsed] : [];
      } catch {
        return [];
      }
    });
  if (candidates.length === 0) return null;

  const preferredFlowIds = new Set((preferred?.flowIds ?? []).map(slug));
  return candidates
    .sort((a, b) => contractCandidateScore(b, preferred?.flowCount, preferredFlowIds) - contractCandidateScore(a, preferred?.flowCount, preferredFlowIds))
    [0] ?? null;
}

export function contractFieldRequirements(contract: ProductBuildContract | null): ContractFieldRequirement[] {
  if (!contract) return [];
  const entityByName = new Map(contract.entities.map((entity) => [entity.name, entity]));
  return contract.flows.flatMap((flow) => {
    if (flow.id === 'auth_session') return [];
    return flow.entitiesTouched.flatMap((entityName) => {
      const entity = entityByName.get(entityName);
      if (!entity) return [];
      const fields = entity.fields
        .filter((field) => field.required)
        .map((field) => field.name)
        .filter((field) => !isSystemManagedContractField(field))
        .map(slug);
      return fields.length > 0
        ? [{ flowId: flow.id, flowName: flow.name, entity: entity.name, fields }]
        : [];
    });
  });
}

export function missingContractFlowIds(requiredFlowIds: string[], proofs: ContractFlowProofEvidence[]): string[] {
  const passed = new Set(proofs.filter((proof) => proof.passed).map((proof) => proof.id));
  return uniqueStrings(requiredFlowIds).filter((id) => !passed.has(id));
}

export function missingContractFieldProofs(
  requirements: ContractFieldRequirement[],
  proofs: ContractFieldProofEvidence[],
): ContractFieldRequirement[] {
  const fieldsByFlow = new Map<string, Set<string>>();
  for (const proof of proofs.filter((item) => item.passed)) {
    const set = fieldsByFlow.get(proof.flowId) ?? new Set<string>();
    proof.fields.forEach((field) => set.add(slug(field)));
    fieldsByFlow.set(proof.flowId, set);
  }
  return requirements.filter((requirement) => {
    const proved = fieldsByFlow.get(requirement.flowId) ?? new Set<string>();
    return requirement.fields.some((field) => !proved.has(slug(field)));
  });
}

export function requiresProductBuildContract(input: {
  lane: TaskLane;
  taskIntent: TaskIntent;
  planningDepth: PlanningDepth;
  isUserFacing: boolean;
  focusedRepair: boolean;
  selectedDomains?: string[];
  selectedCapabilities?: string[];
  clearDomainSignals?: boolean;
}): boolean {
  if (input.focusedRepair || !input.isUserFacing || input.lane === 'fast') return false;
  const capabilities = new Set((input.selectedCapabilities ?? []).map((capability) => capability.trim()).filter(Boolean));
  const staticUiOnly = capabilities.size > 0 &&
    [...capabilities].every((capability) => ['deployment_render', 'seo_public_pages'].includes(capability)) &&
    (input.selectedDomains?.length ?? 0) === 0 &&
    !input.clearDomainSignals;
  if (staticUiOnly) return false;
  if (input.lane === 'strict' || input.lane === 'canary') return true;
  if (input.lane !== 'standard') return false;
  if (input.taskIntent === 'existing_app_extension' && input.planningDepth !== 'mixed_complex_app') {
    return false;
  }
  return input.taskIntent === 'new_app_build' ||
    input.planningDepth === 'standard_app' ||
    (input.selectedDomains?.length ?? 0) > 0 ||
    input.clearDomainSignals === true;
}

function buildScreens(plan: CapabilityArchitecturePlan, domainPacks: DomainPack[]): ProductContractScreen[] {
  const domainPages = domainPacks.flatMap((pack) => pack.expectedPages);
  const routes = uniqueStrings([...plan.pages, ...domainPages]);
  return routes.map((route) => ({
    route,
    purpose: screenPurpose(route),
    featureClaims: uniqueStrings([
      ...domainPacks
        .filter((pack) => pack.expectedPages.includes(route))
        .flatMap((pack) => pack.verificationJourneys.map((journey) => journey.name)),
      ...plan.browserUiChecks
        .filter((check) => check.pagePath === route)
        .flatMap((check) => [...check.required_text, ...check.required_buttons]),
    ]).slice(0, 8),
  }));
}

function buildEntities(
  plan: CapabilityArchitecturePlan,
  domainPacks: DomainPack[],
  authRequired: boolean,
): ProductContractEntity[] {
  const domainEntities = domainPacks.flatMap((pack) => pack.typicalEntities);
  const names = uniqueStrings([...plan.entities, ...domainEntities]);
  return names.map((name) => ({
    name,
    fields: entityFields(name, domainPacks, authRequired),
    userScoped: authRequired && !/^(users?|sessions?|accounts?|roles?|permissions?)$/i.test(name),
  }));
}

function buildApiActions(
  contracts: ApiContract[],
  domainPacks: DomainPack[],
  authRequired: boolean,
): ProductContractApiAction[] {
  const fromArchitecture = contracts.map((contract) => ({
    method: contract.method,
    path: contract.path,
    action: contract.purpose,
    authRequired: contract.auth !== 'public',
    requestFields: requestFieldsFromContract(contract.request),
    responseReadback: [contract.response],
    dbTable: tableFromDbExpectation(contract.dbExpectation),
  }));
  const fromDomains = domainPacks.flatMap((pack) => pack.expectedApiRoutes.map((route) => {
    const [method = 'GET', path = route] = route.split(/\s+/, 2);
    return {
      method,
      path,
      action: `${method} ${path}`,
      authRequired,
      requestFields: method === 'GET' ? [] : ['task-specific required fields'],
      responseReadback: ['created/listed record readback'],
      dbTable: tableFromRoute(path),
    };
  }));
  return dedupeApiActions([...fromArchitecture, ...fromDomains]);
}

function buildFlows(
  plan: CapabilityArchitecturePlan,
  domainPacks: DomainPack[],
  lane: TaskLane,
  authRequired: boolean,
): ProductContractFlow[] {
  const flows: ProductContractFlow[] = [];
  if (authRequired) {
    flows.push({
      id: 'auth_session',
      name: 'auth signup/login/logout session',
      laneRequired: ['standard', 'strict', 'canary'],
      startPath: '/login',
      actions: ['sign up or log in', 'open protected app surface', 'log out', 'revisit protected route'],
      entitiesTouched: ['users', 'sessions'],
      successReadback: ['authenticated app visible', 'logout clears session', 'protected route blocks anonymous access'],
      dbAssertions: ['user/session row exists and is scoped'],
      authRequired: false,
    });
  }

  for (const pack of domainPacks) {
    for (const journey of pack.verificationJourneys) {
      flows.push({
        id: `${pack.id}_${slug(journey.name)}`,
        name: journey.name,
        laneRequired: lane === 'standard' ? ['standard', 'strict', 'canary'] : ['strict', 'canary'],
        startPath: preferredStartPath(pack, journey.name),
        actions: journey.steps,
        entitiesTouched: entitiesForJourney(pack, journey.name),
        successReadback: journey.steps.filter((step) => /\b(visible|appears|shows|confirmation|readback|list|tab)\b/i.test(step)).slice(0, 4),
        dbAssertions: journey.steps.filter((step) => /\b(DB|row|persist|created|exists|written)\b/i.test(step)),
        authRequired,
      });
    }
  }

  if (flows.length === (authRequired ? 1 : 0)) {
    for (const journey of plan.verificationJourneys.filter((journey) => !/deployment health/i.test(journey.name))) {
      flows.push({
        id: slug(journey.name),
        name: journey.name,
        laneRequired: ['standard', 'strict', 'canary'],
        startPath: '/',
        actions: journey.steps,
        entitiesTouched: journey.covers,
        successReadback: journey.steps.filter((step) => /\b(visible|appears|shows|readback|list|renders)\b/i.test(step)).slice(0, 4),
        dbAssertions: journey.steps.filter((step) => /\b(DB|row|persist|created|exists|written)\b/i.test(step)),
        authRequired,
      });
    }
  }

  return uniqueFlows(flows);
}

function selectLaneFlows(
  allFlows: ProductContractFlow[],
  lane: TaskLane,
  domainPacks: DomainPack[],
): ProductContractFlow[] {
  if (lane !== 'standard') return allFlows;
  if (domainPacks.length > 0) {
    const domainFlowIds = new Set(domainPacks.flatMap((pack) =>
      pack.verificationJourneys.map((journey) => `${pack.id}_${slug(journey.name)}`),
    ));
    return allFlows.filter((flow) => flow.id === 'auth_session' || domainFlowIds.has(flow.id));
  }
  return allFlows.slice(0, Math.min(3, allFlows.length));
}

function entityFields(name: string, domainPacks: DomainPack[], authRequired: boolean): ProductContractField[] {
  const domainFields = domainPacks.flatMap((pack) => DOMAIN_REQUIRED_ENTITY_FIELDS[pack.id]?.[name] ?? []);
  const genericFields = /projects?/i.test(name)
    ? ['name', 'status']
    : /users?/i.test(name)
      ? ['email']
      : ['id', 'name'];
  return uniqueStrings([
    ...genericFields,
    ...domainFields,
    authRequired && !/users?|sessions?/i.test(name) ? 'ownerId' : null,
    'createdAt',
    'updatedAt',
  ]).map((field) => ({ name: field, required: !/updatedAt/i.test(field) }));
}

function inferPrimaryVerb(
  input: ProductBuildContractInput,
  domains: string[],
  capabilities: string[],
): string {
  const text = `${input.title ?? ''} ${input.description ?? ''} ${input.productContext ?? ''}`.toLowerCase();
  if (domains.includes('construction_operations')) return 'manage construction projects';
  if (domains.includes('ecommerce_store')) return 'sell products';
  if (domains.includes('local_service_booking')) return 'book appointments';
  if (domains.includes('inventory_operations')) return 'manage inventory';
  if (capabilities.includes('booking')) return 'book records';
  if (capabilities.includes('uploads_storage')) return 'upload documents';
  if (capabilities.includes('ai_openai') || capabilities.includes('rag_search')) return 'generate answers';
  const match = text.match(/\b(create|manage|track|book|sell|upload|analyze|approve|schedule)\b\s+([a-z0-9 -]{3,40})/i);
  return match ? `${match[1]} ${match[2]}`.trim() : 'manage records';
}

function loadedDomainPacks(domains: string[]): DomainPack[] {
  return domains
    .map((domain) => getDomainPack(domain))
    .filter((pack): pack is DomainPack => Boolean(pack));
}

function preferredStartPath(pack: DomainPack, journeyName: string): string {
  const lower = journeyName.toLowerCase();
  if (lower.includes('safety')) return pack.expectedPages.find((page) => /safety/i.test(page)) ?? '/';
  if (lower.includes('equipment')) return pack.expectedPages.find((page) => /equipment/i.test(page)) ?? '/';
  if (lower.includes('schedule')) return pack.expectedPages.find((page) => /schedule/i.test(page)) ?? '/';
  if (lower.includes('bid')) return pack.expectedPages.find((page) => /\[id\]/.test(page)) ?? pack.expectedPages[0] ?? '/';
  return pack.expectedPages[0] ?? '/';
}

function entitiesForJourney(pack: DomainPack, journeyName: string): string[] {
  const lower = journeyName.toLowerCase();
  return pack.typicalEntities.filter((entity) => {
    const label = entity.replace(/_/g, ' ');
    return entityLabelVariants(label).some((variant) => lower.includes(variant));
  }).slice(0, 4);
}

function entityLabelVariants(label: string): string[] {
  const variants = new Set<string>([label]);
  variants.add(label.replace(/ies\b/g, 'y'));
  variants.add(label.replace(/entries\b/g, 'entry'));
  variants.add(label.replace(/logs\b/g, 'log'));
  variants.add(label.replace(/s\b/g, ''));
  return [...variants].map((variant) => variant.trim()).filter(Boolean);
}

function isSystemManagedContractField(field: string): boolean {
  return /^(id|uuid|createdAt|updatedAt|createdBy|submittedBy)$/i.test(field) || /Id$/i.test(field);
}

function requestFieldsFromContract(request: string): string[] {
  if (/all required fields/i.test(request)) return ['all required fields'];
  return [];
}

function tableFromDbExpectation(expectation: string): string | null {
  return expectation.match(/\b(?:into|from)\s+([a-z0-9_]+)/i)?.[1] ?? null;
}

function tableFromRoute(path: string): string | null {
  const segment = path.split('/').filter((part) => part && part !== 'api' && !part.startsWith('[') && !part.startsWith(':'))[0];
  return segment ? segment.replace(/-/g, '_') : null;
}

function screenPurpose(route: string): string {
  if (route === '/') return 'primary app entry surface';
  if (/login|sign/i.test(route)) return 'authentication surface';
  if (/admin/i.test(route)) return 'admin operations surface';
  if (/\[id\]/.test(route)) return 'record detail workflow surface';
  return `${route.replace(/[\/\[\]-]+/g, ' ').trim()} workflow surface`;
}

function dedupeApiActions(actions: ProductContractApiAction[]): ProductContractApiAction[] {
  const seen = new Set<string>();
  const deduped: ProductContractApiAction[] = [];
  for (const action of actions) {
    const key = `${action.method} ${action.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(action);
  }
  return deduped;
}

function uniqueFlows(flows: ProductContractFlow[]): ProductContractFlow[] {
  const seen = new Set<string>();
  const deduped: ProductContractFlow[] = [];
  for (const flow of flows) {
    if (seen.has(flow.id)) continue;
    seen.add(flow.id);
    deduped.push(flow);
  }
  return deduped;
}

function markerLine(result: string, marker: string): string | null {
  return result.split(/\r?\n/).find((line) => line.startsWith(marker)) ?? null;
}

function markerLines(result: string, marker: string): string[] {
  return result.split(/\r?\n/).filter((line) => line.startsWith(marker));
}

function latestMarkerLine(result: string, marker: string): string | null {
  const lines = markerLines(result, marker);
  return lines.at(-1) ?? null;
}

function selectBestProductContractEvidenceLine(lines: string[]): string | null {
  if (lines.length === 0) return null;
  return [...lines]
    .sort((a, b) => productContractEvidenceLineScore(b) - productContractEvidenceLineScore(a))
    [0] ?? null;
}

function productContractEvidenceLineScore(line: string): number {
  const flowCount = Number(markerValue(line, 'flows') ?? 0) || 0;
  const sourceBonus = markerValue(line, 'source') === 'domain_augmented' ? 1000 : 0;
  const authBonus = markerValue(line, 'auth_baseline') === 'true' ? 50 : 0;
  const isolationBonus = markerValue(line, 'user_isolation') === 'true' ? 50 : 0;
  return sourceBonus + authBonus + isolationBonus + flowCount;
}

function contractCandidateScore(contract: ProductBuildContract, preferredFlowCount = 0, preferredFlowIds = new Set<string>()): number {
  const flowIds = new Set(contract.flows.map((flow) => slug(flow.id)));
  const exactCountBonus = preferredFlowCount > 0 && contract.flows.length === preferredFlowCount ? 500 : 0;
  const flowIdBonus = [...preferredFlowIds].filter((id) => flowIds.has(id)).length * 25;
  const sourceBonus = contract.source === 'domain_augmented' ? 1000 : 0;
  return sourceBonus + exactCountBonus + flowIdBonus + contract.flows.length;
}

function markerValue(line: string | null, key: string): string | null {
  if (!line) return null;
  const match = line.match(new RegExp(`(?:^|\\s)${key}=([^\\s]+)`));
  return match?.[1] ?? null;
}

function csvMarkerValues(line: string | null, key: string): string[] {
  const value = markerValue(line, key);
  if (!value || value === 'none') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_ -]+/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90) || 'flow';
}

function coerceList(values: string[] | undefined): string[] {
  return Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}
