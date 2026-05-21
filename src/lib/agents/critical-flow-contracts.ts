import type { PlanningDepth } from './planning-depth';
import type { TaskIntent } from './task-intent';
import type { TaskLanePolicy } from './task-lane';

export type CriticalFlowKind =
  | 'auth_session'
  | 'booking_reservation'
  | 'ecommerce_order'
  | 'payment_checkout'
  | 'crm_record'
  | 'inventory_record'
  | 'domain_workflow'
  | 'upload_file'
  | 'ai_action'
  | 'generic_feature';

export const CRITICAL_FLOW_KINDS: CriticalFlowKind[] = [
  'auth_session',
  'booking_reservation',
  'ecommerce_order',
  'payment_checkout',
  'crm_record',
  'inventory_record',
  'domain_workflow',
  'upload_file',
  'ai_action',
  'generic_feature',
];

export type CriticalFlowContract = {
  kind: CriticalFlowKind;
  label: string;
  reason: string;
  minInteractionProofs: number;
  requiresJourney: boolean;
  requiresDbState: boolean;
  strictOnly?: boolean;
};

export type CriticalFlowTaskInput = {
  title?: string | null;
  description?: string | null;
  tag?: string | null;
  source?: string | null;
};

export type CriticalFlowLogEntry = {
  tool?: unknown;
  result?: unknown;
  event?: unknown;
  reason?: unknown;
  input?: unknown;
};

export type CriticalFlowContext = {
  selectedCapabilities?: string[];
  selectedDomains?: string[];
  frontendPlanPatterns?: string[];
  taskIntent?: TaskIntent | null;
  planningDepth?: PlanningDepth | null;
  isUserFacing?: boolean;
  logEntries?: CriticalFlowLogEntry[];
};

export type CriticalFlowEvidenceCheck = {
  name: string;
  passed: boolean;
  detail: string;
};

type FlowCandidate = Omit<CriticalFlowContract, 'minInteractionProofs' | 'requiresJourney'> & {
  minInteractionProofs?: number;
  requiresJourney?: boolean;
};

const AUTH_RE = /\b(auth|oauth|sign[- ]?in|sign[- ]?up|signup|login|logout|register|registration|session|password|account)\b/i;
const PAYMENT_RE = /\b(stripe|payment|billing|checkout|subscription|invoice|refund|card|paid plan)\b/i;
const BOOKING_RE = /\b(booking|book|appointment|reservation|reserve|reserved|slot|availability)\b|\bschedul(?:e|ing)\s+(?:appointment|service|call|visit|booking|reservation|slot)\b|\b(?:appointment|service|booking|reservation)\s+schedul(?:e|ing)\b/i;
const ECOMMERCE_RE = /\b(ecommerce|e-commerce|store|shop|cart|order|catalog|checkout|coupon|shipping|tax)\b/i;
const CRM_RE = /\b(crm|lead|contact|customer|pipeline|deal|follow[- ]?up|vendor onboarding|approval|approve|admin review)\b/i;
const INVENTORY_RE = /\b(inventory|stock|warehouse|sku|item|reorder|import|export|csv)\b/i;
const UPLOAD_RE = /\b(upload|file|document|attachment|image|media|storage|r2|s3)\b/i;
const AI_RE = /\b(ai|openai|llm|generate|summarize|summarise|extract|classify|chat|rag|semantic|knowledge base|document search)\b/i;
const MUTATION_RE = /\b(create|add|submit|save|update|delete|book|reserve|checkout|order|upload|import|send|message|comment|generate|analyze|analyse|track|record)\b/i;
const UI_RE = /\b(user[- ]?facing|frontend|front[- ]?end|ui|app|portal|dashboard|website|store|shop|booking|calendar|crm|inventory|admin|form|button)\b/i;
const DB_RE = /\b(database|postgres|db|persist|stored?|row|table|crud|history|record|create|save|submit|booking|order|payment|upload|comment|message)\b/i;

const STRICT_FLOW_KINDS = new Set<CriticalFlowKind>([
  'auth_session',
  'payment_checkout',
]);

const CRITICAL_FLOW_KIND_SET = new Set<string>(CRITICAL_FLOW_KINDS);

export function isCriticalFlowKind(value: string): value is CriticalFlowKind {
  return CRITICAL_FLOW_KIND_SET.has(value);
}

export function detectCriticalFlowContracts(
  task: CriticalFlowTaskInput | undefined,
  context: CriticalFlowContext = {},
): CriticalFlowContract[] {
  const capabilities = normalizeList(context.selectedCapabilities);
  const domains = normalizeList(context.selectedDomains);
  const frontendPatterns = normalizeList(context.frontendPlanPatterns);
  const text = criticalFlowText(task, context, capabilities, domains, frontendPatterns);
  const candidates: FlowCandidate[] = [];
  const hasCapability = (...ids: string[]) => ids.some((id) => capabilities.includes(id));
  const hasDomain = (...ids: string[]) => ids.some((id) => domains.includes(id));
  const hasPattern = (...ids: string[]) => ids.some((id) => frontendPatterns.includes(id));
  const dbSignals = DB_RE.test(text) ||
    hasCapability('crud', 'uploads_storage', 'booking', 'payments_stripe', 'cart_orders_checkout', 'admin_workflow', 'marketplace');

  if (AUTH_RE.test(text) || hasCapability('auth', 'roles')) {
    candidates.push({
      kind: 'auth_session',
      label: 'auth/signup/login session',
      reason: 'auth/session signals require a real browser signup/login proof, not just API health.',
      requiresDbState: true,
    });
  }

  if (PAYMENT_RE.test(text) || hasCapability('payments_stripe', 'payment_lifecycle', 'stripe_webhooks') || hasPattern('ecommerce_storefront')) {
    candidates.push({
      kind: 'payment_checkout',
      label: 'payment/checkout flow',
      reason: 'payment/checkout work must prove the visible checkout action and resulting readback.',
      requiresDbState: true,
    });
  }

  const operationalScheduleDomain = hasDomain('construction_operations', 'inventory_operations');
  if (
    BOOKING_RE.test(text) ||
    hasDomain('local_service_booking') ||
    hasPattern('booking_calendar') ||
    (hasCapability('booking') && !operationalScheduleDomain)
  ) {
    candidates.push({
      kind: 'booking_reservation',
      label: 'booking/reservation flow',
      reason: 'booking apps must prove slot/date selection plus reserve/booking readback.',
      requiresDbState: true,
    });
  }

  if (
    ECOMMERCE_RE.test(text) ||
    hasCapability('cart_orders_checkout', 'coupons_tax_shipping') ||
    hasPattern('ecommerce_storefront')
  ) {
    candidates.push({
      kind: 'ecommerce_order',
      label: 'ecommerce cart/order flow',
      reason: 'storefront apps must prove add-to-cart/order/checkout controls, not only page render.',
      requiresDbState: true,
    });
  }

  if (CRM_RE.test(text) || hasDomain('business_website_crm') || hasPattern('crm_pipeline', 'admin_portal')) {
    candidates.push({
      kind: 'crm_record',
      label: 'CRM/admin record flow',
      reason: 'CRM/admin portals must prove a real create/update/approval action through the UI.',
      requiresDbState: true,
    });
  }

  if (INVENTORY_RE.test(text) || hasDomain('inventory_operations') || hasPattern('inventory_table')) {
    candidates.push({
      kind: 'inventory_record',
      label: 'inventory record flow',
      reason: 'inventory apps must prove item/stock mutation through the UI.',
      requiresDbState: true,
    });
  }

  const domainWorkflowDomains = [
    'construction_operations',
    'finance_crypto',
    'social_community',
    'education_content',
    'health_fitness_food',
    'media_creator',
    'real_estate_property',
    'advanced_ai_mixed',
  ];
  const domainWorkflowPatterns = [
    'construction_ops_board',
    'finance_dashboard',
    'social_feed',
    'education_lms',
    'health_plan_tracker',
    'media_creator_gallery',
    'real_estate_listing',
    'ai_workspace',
  ];
  if (domainWorkflowDomains.some((id) => hasDomain(id)) || domainWorkflowPatterns.some((id) => hasPattern(id))) {
    candidates.push({
      kind: 'domain_workflow',
      label: 'domain-specific product workflow',
      reason: 'domain-shaped apps must prove at least one named domain workflow through the UI, API, DB, and readback contract.',
      requiresDbState: true,
    });
  }

  if (UPLOAD_RE.test(text) || hasCapability('uploads_storage')) {
    candidates.push({
      kind: 'upload_file',
      label: 'file/upload flow',
      reason: 'upload/document apps must prove the browser can submit the file/document action and read it back.',
      requiresDbState: true,
    });
  }

  if (AI_RE.test(text) || hasCapability('ai_openai', 'rag_search')) {
    candidates.push({
      kind: 'ai_action',
      label: 'AI action flow',
      reason: 'AI apps must prove the visible prompt/action path returns usable readback.',
      requiresDbState: dbSignals,
    });
  }

  const hasSpecificFlow = candidates.length > 0;
  const userFacing = context.isUserFacing === true || UI_RE.test(text) || frontendPatterns.length > 0;
  const genericMutationCapability = hasCapability('crud', 'dashboard', 'admin_workflow', 'search', 'realtime', 'analytics');
  const focusedRepair =
    context.taskIntent === 'focused_repair' ||
    context.taskIntent === 'ui_polish' ||
    context.taskIntent === 'deployment_fix';
  const staticMarketingPage =
    /\b(landing page|marketing page|homepage|brochure|public website)\b/i.test(text) &&
    !/\b(form|signup|sign[- ]?up|register|book|booking|checkout|order|submit|save|contact form|lead|payment|upload)\b/i.test(text) &&
    !genericMutationCapability;
  if (
    userFacing &&
    !staticMarketingPage &&
    !hasSpecificFlow &&
    (MUTATION_RE.test(text) || (!focusedRepair && (genericMutationCapability || context.taskIntent === 'new_app_build')))
  ) {
    candidates.push({
      kind: 'generic_feature',
      label: 'primary feature flow',
      reason: 'unclassified user-facing app still needs one real primary button/form proof.',
      requiresDbState: dbSignals,
    });
  }

  return dedupeContracts(candidates.map((candidate) => ({
    minInteractionProofs: 1,
    requiresJourney: true,
    ...candidate,
  })));
}

export function requiredCriticalFlowContracts(
  policy: Pick<TaskLanePolicy, 'lane'>,
  contracts: CriticalFlowContract[],
): CriticalFlowContract[] {
  const deduped = dedupeContracts(contracts);
  if (deduped.length === 0) return [];
  if (policy.lane === 'canary' || policy.lane === 'strict') return deduped;
  if (policy.lane === 'standard') return deduped.filter((contract) => !contract.strictOnly);
  return deduped.filter((contract) => STRICT_FLOW_KINDS.has(contract.kind));
}

export function criticalFlowEvidenceChecks(
  logEntries: CriticalFlowLogEntry[],
  requiredContracts: CriticalFlowContract[],
): CriticalFlowEvidenceCheck[] {
  if (requiredContracts.length === 0) return [];

  const requiredKinds = [...new Set(requiredContracts.map((contract) => contract.kind))];
  const contractLabels = requiredContracts.map((contract) => contract.label).join(', ');
  const checks: CriticalFlowEvidenceCheck[] = [];
  const latestAppChangeAt = latestAppChangeIndex(logEntries);
  const latestInteraction = latestTool(logEntries, 'verify_interaction_contract');
  const latestInteractionCounts = latestInteraction ? interactionProofCountsFromText(latestInteraction.result) : null;
  const latestInteractionFailed = latestInteraction
    ? latestInteractionCounts
      ? latestInteractionCounts.failed > 0
      : !/^INTERACTION PROOF PASS\b/m.test(latestInteraction.result)
    : true;
  const latestKindProofs = latestCriticalFlowProofsByKind(logEntries, latestAppChangeAt);
  const missingKinds = requiredKinds.filter((kind) => latestKindProofs[kind] === undefined);
  const failedKinds = requiredKinds.filter((kind) => latestKindProofs[kind] === false);
  const interactionPassed = Boolean(
    latestInteraction &&
    latestInteraction.index >= latestAppChangeAt &&
    !latestInteractionFailed &&
    missingKinds.length === 0 &&
    failedKinds.length === 0
  );

  checks.push({
    name: 'critical_flow_interaction_evidence',
    passed: interactionPassed,
    detail: !latestInteraction
      ? `Critical flow contract(s) required but no verify_interaction_contract proof was run. Required: ${contractLabels}.`
      : latestInteraction.index < latestAppChangeAt
        ? `Latest verify_interaction_contract proof ran before the latest app-changing deploy/push. Re-run it for: ${contractLabels}.`
        : latestInteractionFailed
          ? `Latest verify_interaction_contract still failed. Required critical flow kind(s): ${requiredKinds.join(', ')}. Fix the failed interaction and rerun.`
        : missingKinds.length > 0
          ? `Latest verify_interaction_contract did not include kind-matched proof for: ${missingKinds.join(', ')}. Add critical_kind to each required interaction and rerun. Required: ${contractLabels}.`
        : failedKinds.length > 0
          ? `Latest verify_interaction_contract reported failed critical flow kind(s): ${failedKinds.join(', ')}. Fix and rerun. Required: ${contractLabels}.`
        : interactionPassed
          ? `Latest verify_interaction_contract proved required critical flow kind(s): ${requiredKinds.join(', ')}.`
          : `Latest verify_interaction_contract did not prove all required critical flow kind(s). Required: ${contractLabels}.`,
  });

  if (requiredContracts.some((contract) => contract.requiresJourney)) {
    const latestJourney = latestTool(logEntries, 'verify_user_journey');
    const journeyPassed = Boolean(latestJourney && /^JOURNEY PASS\b/m.test(latestJourney.result) && latestJourney.index >= latestAppChangeAt);
    checks.push({
      name: 'critical_flow_journey_evidence',
      passed: journeyPassed,
      detail: !latestJourney
        ? `Critical flow contract(s) require verify_user_journey. Required: ${contractLabels}.`
        : latestJourney.index < latestAppChangeAt
          ? `Latest verify_user_journey ran before the latest app-changing deploy/push. Re-run the end-to-end flow for: ${contractLabels}.`
          : journeyPassed
            ? `Latest verify_user_journey passed for critical flow coverage.`
            : `Latest verify_user_journey did not pass. Critical flow(s) still unproved: ${contractLabels}.`,
    });
  }

  if (requiredContracts.some((contract) => contract.requiresDbState)) {
    const latestDb = latestTool(logEntries, 'verify_db_state');
    const dbPassed = Boolean(latestDb && /^DB STATE PASS\b/m.test(latestDb.result) && latestDb.index >= latestAppChangeAt);
    checks.push({
      name: 'critical_flow_db_evidence',
      passed: dbPassed,
      detail: !latestDb
        ? `Critical flow contract(s) write data but no verify_db_state proof was run. Required: ${contractLabels}.`
        : latestDb.index < latestAppChangeAt
          ? `Latest verify_db_state ran before the latest app-changing deploy/push. Re-run DB proof for: ${contractLabels}.`
          : dbPassed
            ? `Latest verify_db_state passed for data-writing critical flow(s).`
            : `Latest verify_db_state did not pass. Data-writing critical flow(s) still unproved: ${contractLabels}.`,
    });
  }

  return checks;
}

export function formatCriticalFlowBriefing(contracts: CriticalFlowContract[]): string {
  if (contracts.length === 0) {
    return [
      '## Critical Flow Contracts',
      '- No derived critical-flow contract beyond the lane baseline.',
      '- Still verify the exact changed surface; do not add reference/report/design ceremony unless the lane requires it.',
    ].join('\n');
  }

  return [
    '## Critical Flow Contracts',
    `- Required flows: ${contracts.map((contract) => `${contract.kind} (${contract.label})`).join(', ')}`,
    '- Prove each with verify_interaction_contract against the deployed UI. Set critical_kind on each required interaction, click the real button/form, and assert visible readback.',
    '- Pair data-writing flows with verify_db_state. API-only or health-only proof is not enough for these flows.',
  ].join('\n');
}

function criticalFlowText(
  task: CriticalFlowTaskInput | undefined,
  context: CriticalFlowContext,
  _capabilities: string[],
  _domains: string[],
  _frontendPatterns: string[],
): string {
  return [
    task?.title ?? '',
    criticalFlowRelevantDescription(task?.description),
    task?.tag ?? '',
    task?.source ?? '',
    context.taskIntent ?? '',
    context.planningDepth ?? '',
  ].join('\n').toLowerCase();
}

function criticalFlowRelevantDescription(description: string | null | undefined): string {
  return (description ?? '')
    .split(/\r?\n/)
    .filter((line) => !isCriticalFlowBoilerplateLine(line))
    .join('\n');
}

function isCriticalFlowBoilerplateLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return (
    /^mandatory planning\b/i.test(trimmed) ||
    /^required verification\b/i.test(trimmed) ||
    /^completion rule\b/i.test(trimmed) ||
    /^-?\s*call\s+/i.test(trimmed) ||
    /\bwhen applicable\b/i.test(trimmed) ||
    /\bderived flows such as\b/i.test(trimmed) ||
    /\bcritical_kind\b/i.test(trimmed) ||
    /\bfor pgvector\/rag\b/i.test(trimmed) ||
    /\bfor ai text generation\b/i.test(trimmed) ||
    /\bdo not complete if\b/i.test(trimmed) ||
    /\bBaljia starter copy\b/i.test(trimmed) ||
    /\bSDK import guidance\b/i.test(trimmed) ||
    /\bgateway implementation details\b/i.test(trimmed)
  );
}

function normalizeList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function dedupeContracts(contracts: CriticalFlowContract[]): CriticalFlowContract[] {
  const seen = new Set<CriticalFlowKind>();
  const deduped: CriticalFlowContract[] = [];
  for (const contract of contracts) {
    if (seen.has(contract.kind)) continue;
    seen.add(contract.kind);
    deduped.push(contract);
  }
  return deduped;
}

function latestTool(logEntries: CriticalFlowLogEntry[], toolName: string): { index: number; result: string } | null {
  for (let i = logEntries.length - 1; i >= 0; i -= 1) {
    const entry = logEntries[i];
    if (entry.tool !== toolName) continue;
    const result = typeof entry.result === 'string' ? entry.result : '';
    if (result) return { index: i, result };
  }
  return null;
}

function latestAppChangeIndex(logEntries: CriticalFlowLogEntry[]): number {
  const appChangeTools = new Set<string>([
    'create_instance',
    'github_push_file',
    'github_create_commit',
    'github_delete_file',
    'render_create_service',
    'render_deploy',
    'render_set_env_vars',
    'deploy_to_render',
  ]);
  let latest = -1;
  for (let i = 0; i < logEntries.length; i += 1) {
    const rawTool = logEntries[i].tool;
    const tool = typeof rawTool === 'string' ? rawTool : '';
    if (appChangeTools.has(tool)) latest = i;
  }
  return latest;
}

function interactionProofCountsFromText(text: string): { passed: number; failed: number } | null {
  const match = text.match(/INTERACTION_PROOF_EVIDENCE[^\n]*passed=(\d+)[^\n]*failed=(\d+)/);
  if (!match) return null;
  return {
    passed: Number(match[1]) || 0,
    failed: Number(match[2]) || 0,
  };
}

function latestCriticalFlowProofsByKind(
  logEntries: CriticalFlowLogEntry[],
  minIndex: number,
): Partial<Record<CriticalFlowKind, boolean>> {
  const proofs: Partial<Record<CriticalFlowKind, boolean>> = {};
  for (let i = 0; i < logEntries.length; i += 1) {
    if (i < minIndex) continue;
    const entry = logEntries[i];
    if (entry.tool !== 'verify_interaction_contract') continue;
    const result = typeof entry.result === 'string' ? entry.result : '';
    const regex = /^CRITICAL_FLOW_PROOF[^\n]*\bkind=([a-z_]+)[^\n]*\bpassed=(true|false|1|0|yes|no)\b/gim;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(result))) {
      const kind = match[1];
      if (!isCriticalFlowKind(kind)) continue;
      proofs[kind] = /^(true|1|yes)$/i.test(match[2]);
    }
  }
  return proofs;
}
