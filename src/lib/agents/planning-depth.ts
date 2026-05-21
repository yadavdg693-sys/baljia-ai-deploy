import type { TaskIntent } from './task-intent';

export type PlanningDepth =
  | 'simple_feature'
  | 'standard_app'
  | 'mixed_complex_app'
  | 'existing_app_extension'
  | 'canary_world_class';

export type PlanningDepthResult = {
  depth: PlanningDepth;
  reasons: string[];
  riskSignals: string[];
};

export type PlanningDepthInput = {
  title?: string | null;
  description?: string | null;
  tag?: string | null;
  productContext?: string | null;
  taskIntent?: TaskIntent | null;
  taskIntentLane?: 'build' | 'extend' | 'repair' | 'verify' | null;
  selectedCapabilities?: string[];
  selectedDomains?: string[];
};

const DEPTH_RANK: Record<PlanningDepth, number> = {
  simple_feature: 0,
  standard_app: 1,
  existing_app_extension: 2,
  mixed_complex_app: 3,
  canary_world_class: 4,
};

const GENERIC_CAPABILITIES = new Set(['crud', 'dashboard', 'deployment_render']);

const HIGH_RISK_CAPABILITY_SIGNALS: Record<string, string> = {
  auth: 'auth',
  roles: 'roles',
  payments_stripe: 'payments',
  uploads_storage: 'uploads',
  ai_openai: 'ai',
  rag_search: 'rag',
  marketplace: 'marketplace',
  booking: 'booking',
  admin_workflow: 'admin_workflow',
  email_notifications: 'notifications',
  analytics: 'analytics',
  realtime: 'realtime',
  cron_jobs: 'background_jobs',
  background_jobs: 'background_jobs',
  external_api: 'external_api',
};

const TEXT_RISK_PATTERNS: Array<[RegExp, string]> = [
  [/\b(auth|login|signup|sign[- ]?in|account|session|password|oauth)\b/i, 'auth'],
  [/\b(role|permission|admin|approval|approve|moderation)\b/i, 'roles_or_admin'],
  [/\b(stripe|payment|billing|checkout|subscription|invoice|refund|payout)\b/i, 'payments'],
  [/\b(upload|file|document|storage|r2|s3|media|image|asset)\b/i, 'uploads'],
  [/\b(ai|openai|llm|summar|extract|generate|ocr|classification)\b/i, 'ai'],
  [/\b(rag|semantic|embedding|vector|knowledge base|document search)\b/i, 'rag'],
  [/\b(marketplace|seller|buyer|vendor|listing|directory)\b/i, 'marketplace'],
  [/\b(booking|schedule|appointment|reservation|slot|calendar|availability)\b/i, 'booking'],
  [/\b(webhook|external api|integration|google calendar|slack|discord|maps|crm)\b/i, 'external_api'],
  [/\b(realtime|real-time|live update|presence|chat|websocket|sse|collaboration)\b/i, 'realtime'],
  [/\b(cron|background job|queue|worker|scheduled|retry|backoff)\b/i, 'background_jobs'],
  [/\b(analytics|reporting|chart|dashboard metrics|insight|kpi)\b/i, 'analytics'],
  [/\b(multi[- ]?tenant|team|workspace|organization)\b/i, 'multi_tenant'],
];

const SIMPLE_FEATURE_RE = /\b(add|fix|update|change|repair|implement)\b[\s\S]{0,80}\b(endpoint|api route|form|field|copy|style|button|widget|card|small page|single page|one page|one endpoint|one form|one table|bug|polish|validation)\b/i;
const STANDARD_APP_RE = /\b(app|portal|dashboard|crm|store|shop|website|booking|scheduler|cms|blog|wiki|inventory|lms|course|billing|document portal|admin panel|tool)\b/i;
const MIXED_APP_RE = /\b(platform|marketplace|multi[- ]?tenant|saas|ai-powered|workflow automation|end-to-end|full[- ]?stack app|combination|mixed)\b/i;
const EXISTING_APP_RE = /\b(existing-app[-\s]+extension|existing deployed app|extend(?:ing)?\s+(?:the\s+)?existing\s+app|update\s+(?:the\s+)?existing\s+(?:repo|app|codebase)|debug\s+(?:the\s+)?existing\s+(?:repo|app|codebase)|preserve\s+existing\s+route|baseline app)\b/i;
const CANARY_TAG_RE = /\b(engineering-canary|canary-eval|canary-runner|render-canary)\b/i;
const NARROW_REPAIR_RE = /\b(single|one|small|narrow|specific|button|dropdown|select|contrast|copy|spacing|style|label|form|field|endpoint|route|payload|contract|api|login|signup|auth|health|env|build|bug|visual|polish)\b/i;
const VISUAL_REPAIR_RE = /\b(button|dropdown|select|contrast|copy|spacing|style|label|visual|polish|color|readable|unreadable|font|typography)\b/i;
const BROAD_REPAIR_RE = /\b(auth|role|permission|billing|payment|checkout|stripe|upload|storage|rag|ai|database|schema|migration|webhook|queue|cron|analytics|external api|integration|admin approval|multi[- ]?tenant)\b/i;

export function planningDepthRank(depth: PlanningDepth): number {
  return DEPTH_RANK[depth];
}

export function maxPlanningDepth(a: PlanningDepth, b: PlanningDepth): PlanningDepth {
  return planningDepthRank(a) >= planningDepthRank(b) ? a : b;
}

export function parsePlanningDepth(value: string | null | undefined): PlanningDepth | null {
  if (!value) return null;
  const normalized = value.trim() as PlanningDepth;
  return Object.prototype.hasOwnProperty.call(DEPTH_RANK, normalized) ? normalized : null;
}

export function classifyPlanningDepth(input: PlanningDepthInput): PlanningDepthResult {
  const text = `${input.title ?? ''}\n${input.description ?? ''}\n${input.tag ?? ''}\n${input.productContext ?? ''}`;
  const tagText = `${input.tag ?? ''}`;
  const capabilities = unique(input.selectedCapabilities ?? []);
  const domains = unique(input.selectedDomains ?? []);
  const reasons: string[] = [];
  const riskSignals = unique([
    ...capabilities.map((capability) => HIGH_RISK_CAPABILITY_SIGNALS[capability]).filter(Boolean),
    ...TEXT_RISK_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, signal]) => signal),
  ]);

  if (CANARY_TAG_RE.test(tagText)) {
    return { depth: 'canary_world_class', reasons: ['explicit_canary_harness_tag'], riskSignals };
  }

  const isExistingAppExtension = EXISTING_APP_RE.test(text);
  const meaningfulCapabilities = capabilities.filter((capability) => !GENERIC_CAPABILITIES.has(capability));
  const hasMixedCombination =
    (capabilities.includes('marketplace') && capabilities.includes('payments_stripe')) ||
    (capabilities.includes('booking') && capabilities.includes('payments_stripe')) ||
    (capabilities.includes('ai_openai') && capabilities.includes('rag_search')) ||
    (capabilities.includes('uploads_storage') && capabilities.includes('admin_workflow')) ||
    (capabilities.includes('roles') && capabilities.includes('payments_stripe')) ||
    (capabilities.includes('analytics') && /\b(database|db|postgres|write|persist)\b/i.test(text));

  if (MIXED_APP_RE.test(text)) reasons.push('mixed_app_wording');
  if (meaningfulCapabilities.length >= 4) reasons.push('many_capabilities');
  if (riskSignals.length >= 3) reasons.push('many_risk_signals');
  if (isExistingAppExtension && riskSignals.length >= 2) reasons.push('existing_app_extension_high_risk');
  if (hasMixedCombination) reasons.push('mixed_capability_combination');

  const isRepairLane = input.taskIntentLane === 'repair' ||
    input.taskIntent === 'focused_repair' ||
    input.taskIntent === 'ui_polish' ||
    input.taskIntent === 'api_contract_fix' ||
    input.taskIntent === 'auth_security_fix' ||
    input.taskIntent === 'deployment_fix';

  if (isRepairLane) {
    const visualOnlyRepair = VISUAL_REPAIR_RE.test(text) && !BROAD_REPAIR_RE.test(text);
    const broadRepair = !visualOnlyRepair && reasons.length > 0;
    if (broadRepair) {
      return {
        depth: 'mixed_complex_app',
        reasons: unique([
          'repair_lane',
          'broad_repair',
          isExistingAppExtension ? 'existing_app_extension' : '',
          ...reasons,
        ]),
        riskSignals,
      };
    }

    const narrowRepair = SIMPLE_FEATURE_RE.test(text) || NARROW_REPAIR_RE.test(text);
    if (narrowRepair) {
      return { depth: 'simple_feature', reasons: ['repair_lane', 'narrow_repair'], riskSignals };
    }

    return { depth: 'existing_app_extension', reasons: ['repair_lane', 'existing_app_repair'], riskSignals };
  }

  if (reasons.length > 0) {
    return {
      depth: 'mixed_complex_app',
      reasons: unique([
        isExistingAppExtension ? 'existing_app_extension' : '',
        ...reasons,
      ]),
      riskSignals,
    };
  }

  if (isExistingAppExtension) {
    return { depth: 'existing_app_extension', reasons: ['existing_app_extension'], riskSignals };
  }

  if (SIMPLE_FEATURE_RE.test(text) && riskSignals.length === 0 && meaningfulCapabilities.length <= 1 && domains.length === 0) {
    return { depth: 'simple_feature', reasons: ['narrow_single_feature'], riskSignals };
  }

  if (SIMPLE_FEATURE_RE.test(text) && riskSignals.length <= 1 && meaningfulCapabilities.length <= 2 && !domains.length) {
    return { depth: 'simple_feature', reasons: ['narrow_single_feature_low_risk'], riskSignals };
  }

  if (STANDARD_APP_RE.test(text) || domains.length > 0 || meaningfulCapabilities.length > 0 || riskSignals.length > 0) {
    return {
      depth: 'standard_app',
      reasons: unique([
        STANDARD_APP_RE.test(text) ? 'product_or_app_shape' : '',
        domains.length > 0 ? 'domain_selected' : '',
        meaningfulCapabilities.length > 0 ? 'capabilities_selected' : '',
        riskSignals.length > 0 ? 'risk_signals_present' : '',
      ]),
      riskSignals,
    };
  }

  return { depth: 'simple_feature', reasons: ['no_product_shape_or_risk_signals'], riskSignals };
}

export function formatPlanningDepthEvidence(result: PlanningDepthResult): string {
  return `PLANNING_DEPTH_EVIDENCE depth=${result.depth} reasons=${result.reasons.join(',') || 'none'} risks=${result.riskSignals.join(',') || 'none'}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
