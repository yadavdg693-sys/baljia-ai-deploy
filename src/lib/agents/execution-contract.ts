export type ExecutionContractIntent = 'new_app' | 'feature' | 'repair' | 'ui_fix' | 'integration';
export type ExecutionContractConfirmationSource = 'explicit_request' | 'founder_confirmed';

export interface ExecutionContractRepoLayout {
  stack: string;
  pages: string[];
  api_routes: string[];
  components: string[];
  shared_logic: string[];
  database: string[];
  tests: string[];
  docs: string[];
}

export interface ExecutionContract {
  version: 1;
  intent: ExecutionContractIntent;
  assigned_agent_id: number;
  confirmation_source: ExecutionContractConfirmationSource;
  founder_visible_summary: string;
  product_scope: string;
  assumptions: string[];
  open_questions: string[];
  user_flow: string[];
  screens: string[];
  data_fields: string[];
  api_actions: string[];
  integrations: string[];
  acceptance_criteria: string[];
  out_of_scope: string[];
  ui_freedom: boolean;
  repo_layout?: ExecutionContractRepoLayout;
}

type ContractTaskLike = {
  title?: string | null;
  description?: string | null;
  tag?: string | null;
  source?: string | null;
  execution_mode?: string | null;
  assigned_to_agent_id?: number | null;
  execution_contract?: unknown;
};

const INTENTS = new Set<ExecutionContractIntent>(['new_app', 'feature', 'repair', 'ui_fix', 'integration']);
const CONFIRMATION_SOURCES = new Set<ExecutionContractConfirmationSource>(['explicit_request', 'founder_confirmed']);

const ENGINEERING_CONTRACT_SKIP_TAGS = new Set([
  'bug',
  'bug-fix',
  'fix',
  'css',
  'seo',
  'seo-meta',
  'deploy',
  'config',
  'error-page',
  'legal',
  'pricing-page',
  'about-page',
  'changelog',
  'faq',
  'blog-post',
  'copy',
  'email-template',
  'video-script',
  'win-back-email',
  'promo',
  'promo-video',
]);

const ENGINEERING_CONTRACT_REQUIRED_TAGS = new Set([
  'engineering',
  'mvp',
  'feature',
  'complex-feature',
  'landing-page',
  'dashboard',
  'admin',
  'auth',
  'api',
  'crud',
  'database',
  'form',
  'onboarding',
  'onboarding-flow',
  'client-portal',
  'full-crud',
  'integration',
  'multi-user',
  'activity-log',
  'custom-fields',
  'automation',
  'redesign',
  'rebrand',
]);

const BUILD_TEXT_RE =
  /\b(build|create|ship|launch|implement|add|extend|full[- ]?stack|mvp|app|portal|dashboard|marketplace|crm|admin|workflow|auth|login|integration|feature)\b/i;
const REPAIR_TEXT_RE =
  /\b(fix|bug|repair|debug|audit only|verify only|status only|read-only|investigate only|explain only|no code change|copy|css|style|spacing|color|typo)\b/i;

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseContractInput(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return objectRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return objectRecord(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean);
}

function stringListField(raw: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const values = stringList(raw[key]);
    if (values.length > 0) return values;
  }
  return [];
}

function boolValue(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function parseRepoLayout(value: unknown): ExecutionContractRepoLayout | undefined {
  const raw = objectRecord(value);
  if (!raw) return undefined;

  const layout: ExecutionContractRepoLayout = {
    stack: stringValue(raw.stack) || 'nextjs',
    pages: stringListField(raw, 'pages'),
    api_routes: stringListField(raw, 'api_routes', 'apiRoutes'),
    components: stringListField(raw, 'components'),
    shared_logic: stringListField(raw, 'shared_logic', 'sharedLogic'),
    database: stringListField(raw, 'database'),
    tests: stringListField(raw, 'tests'),
    docs: stringListField(raw, 'docs'),
  };

  const hasAnyPlacement =
    layout.pages.length > 0 ||
    layout.api_routes.length > 0 ||
    layout.components.length > 0 ||
    layout.shared_logic.length > 0 ||
    layout.database.length > 0 ||
    layout.tests.length > 0 ||
    layout.docs.length > 0;

  return hasAnyPlacement ? layout : undefined;
}

function defaultRepoLayoutForContract(contract: Pick<ExecutionContract, 'intent'>): ExecutionContractRepoLayout {
  if (contract.intent === 'repair' || contract.intent === 'ui_fix') {
    return {
      stack: 'existing',
      pages: ['Keep the existing route/page structure; touch only files required by the bug or UI change.'],
      api_routes: ['Keep existing API route placement; add a new route only if the task explicitly requires one.'],
      components: ['Prefer the existing component near the affected screen before creating a new component.'],
      shared_logic: ['Put reusable fix logic beside the existing feature module, not in a new global abstraction.'],
      database: ['Do not change db/schema.ts unless the task explicitly requires a schema fix.'],
      tests: ['Run the narrow verification for the repaired flow plus any existing regression test that covers it.'],
      docs: ['Do not add documentation unless the task asks for handoff notes.'],
    };
  }

  return {
    stack: 'nextjs',
    pages: [
      'app/page.tsx for the public product surface.',
      'app/<route>/page.tsx for product screens and dashboards.',
      'app/(auth)/login/page.tsx and app/(auth)/register/page.tsx only when auth is in scope.',
    ],
    api_routes: [
      'app/api/<feature>/route.ts for collection actions.',
      'app/api/<feature>/<id>/route.ts for detail, update, and delete actions.',
      'Use server actions only when they already match the skeleton pattern.',
    ],
    components: [
      'components/ui/ for existing shadcn primitives.',
      'components/<feature>/ for reusable product UI.',
      'Keep one-off page layout inside the page file until reuse is real.',
    ],
    shared_logic: [
      'lib/<feature>/ for business rules, API helpers, provider calls, and formatting.',
      'Extend existing lib/auth.ts, lib/db.ts, or integration helpers instead of duplicating them.',
    ],
    database: [
      'db/schema.ts for Drizzle tables, relations, and schema changes.',
      'Use migrations/run_migration or run_drizzle_push according to the deployed app path.',
    ],
    tests: [
      'Verify deployed user flow with verify_user_journey or verify_interaction_contract.',
      'Verify persisted writes with verify_db_state.',
      'Add tests/e2e/<feature>.spec.ts only when repo tests are part of the task or existing app pattern.',
    ],
    docs: [
      'README.md or memory/PRD.md only for requested handoff/documentation updates.',
    ],
  };
}

export function parseExecutionContract(value: unknown): ExecutionContract | null {
  const raw = parseContractInput(value);
  if (!raw) return null;

  const intent = raw.intent;
  const confirmationSource = raw.confirmation_source;
  if (!INTENTS.has(intent as ExecutionContractIntent)) return null;
  if (!CONFIRMATION_SOURCES.has(confirmationSource as ExecutionContractConfirmationSource)) return null;

  return {
    version: raw.version === 1 ? 1 : 1,
    intent: intent as ExecutionContractIntent,
    assigned_agent_id: typeof raw.assigned_agent_id === 'number' ? raw.assigned_agent_id : 0,
    confirmation_source: confirmationSource as ExecutionContractConfirmationSource,
    founder_visible_summary: stringValue(raw.founder_visible_summary),
    product_scope: stringValue(raw.product_scope),
    assumptions: stringList(raw.assumptions),
    open_questions: stringList(raw.open_questions),
    user_flow: stringList(raw.user_flow),
    screens: stringList(raw.screens),
    data_fields: stringList(raw.data_fields),
    api_actions: stringList(raw.api_actions),
    integrations: stringList(raw.integrations),
    acceptance_criteria: stringList(raw.acceptance_criteria),
    out_of_scope: stringList(raw.out_of_scope),
    ui_freedom: boolValue(raw.ui_freedom),
    repo_layout: parseRepoLayout(raw.repo_layout),
  };
}

export function validateExecutionContract(
  value: unknown,
  options: { expectedAgentId?: number } = {},
): { ok: true; contract: ExecutionContract } | { ok: false; reason: string } {
  const raw = parseContractInput(value);
  if (!raw) return { ok: false, reason: 'execution_contract must be a JSON object.' };
  if (raw.version !== 1) return { ok: false, reason: 'execution_contract.version must be 1.' };

  const contract = parseExecutionContract(raw);
  if (!contract) return { ok: false, reason: 'execution_contract has an invalid intent or confirmation_source.' };

  if (options.expectedAgentId !== undefined && contract.assigned_agent_id !== options.expectedAgentId) {
    return {
      ok: false,
      reason: `execution_contract.assigned_agent_id must be ${options.expectedAgentId}.`,
    };
  }
  if (!contract.founder_visible_summary) return { ok: false, reason: 'execution_contract.founder_visible_summary is required.' };
  if (!contract.product_scope) return { ok: false, reason: 'execution_contract.product_scope is required.' };
  if (contract.open_questions.length > 0) return { ok: false, reason: 'execution_contract.open_questions must be empty before Engineering assignment.' };
  if (contract.acceptance_criteria.length === 0) return { ok: false, reason: 'execution_contract.acceptance_criteria needs at least one testable criterion.' };

  if (contract.intent === 'new_app' || contract.intent === 'feature') {
    if (contract.user_flow.length === 0) return { ok: false, reason: 'execution_contract.user_flow is required for app and feature work.' };
    if (contract.screens.length === 0) return { ok: false, reason: 'execution_contract.screens is required for app and feature work.' };
    if (contract.data_fields.length === 0) return { ok: false, reason: 'execution_contract.data_fields is required for app and feature work.' };
    if (contract.api_actions.length === 0) return { ok: false, reason: 'execution_contract.api_actions is required for app and feature work.' };
  }
  if (contract.intent === 'integration') {
    if (contract.user_flow.length === 0) return { ok: false, reason: 'execution_contract.user_flow is required for integration work.' };
    if (contract.api_actions.length === 0) return { ok: false, reason: 'execution_contract.api_actions is required for integration work.' };
  }

  return { ok: true, contract };
}

export function hasCompleteExecutionContract(value: unknown, expectedAgentId = 30): boolean {
  return validateExecutionContract(value, { expectedAgentId }).ok;
}

export function requiresExecutionContractForEngineering(task: ContractTaskLike, agentId = task.assigned_to_agent_id ?? 30): boolean {
  if (agentId !== 30) return false;
  if (hasCompleteExecutionContract(task.execution_contract, agentId)) return false;

  const tag = (task.tag ?? '').toLowerCase().trim();
  if (ENGINEERING_CONTRACT_SKIP_TAGS.has(tag)) return false;
  if (task.source === 'auto_remediation') return false;

  const text = `${task.title ?? ''}\n${task.description ?? ''}\n${tag}`;
  if (REPAIR_TEXT_RE.test(text) && !ENGINEERING_CONTRACT_REQUIRED_TAGS.has(tag)) return false;
  if (ENGINEERING_CONTRACT_REQUIRED_TAGS.has(tag)) return true;
  if (task.source === 'ceo_suggested' || task.source === 'founder_requested' || task.source === 'onboarding') {
    return BUILD_TEXT_RE.test(text);
  }
  return false;
}

export function engineeringContractBlockReason(task: ContractTaskLike, agentId = task.assigned_to_agent_id ?? 30): string | null {
  if (!requiresExecutionContractForEngineering(task, agentId)) return null;
  const validation = validateExecutionContract(task.execution_contract, { expectedAgentId: agentId });
  if (validation.ok) return null;
  return `Engineering task blocked before start: CEO must provide a complete execution_contract. ${validation.reason}`;
}

export function formatExecutionContractForPrompt(value: unknown): string | null {
  const validation = validateExecutionContract(value, { expectedAgentId: 30 });
  if (!validation.ok) return null;
  const c = validation.contract;
  const list = (items: string[]) => items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- none';
  const layout = c.repo_layout ?? defaultRepoLayoutForContract(c);
  const layoutSection = `**Repo layout**
Use this only for file placement and maintainability. It does not add product scope.

Stack: ${layout.stack}

Pages/routes
${list(layout.pages)}

API routes/actions
${list(layout.api_routes)}

Components
${list(layout.components)}

Shared logic
${list(layout.shared_logic)}

Database
${list(layout.database)}

Tests/proofs
${list(layout.tests)}

Docs/memory
${list(layout.docs)}`;

  return `## Execution Contract (CEO-owned product scope)
This is the source of truth. Do not infer product scope outside it. You may choose implementation details and UI treatment only where ui_freedom allows it.

**Intent:** ${c.intent}
**Founder-visible summary:** ${c.founder_visible_summary}
**Product scope:** ${c.product_scope}
**UI freedom:** ${c.ui_freedom ? 'yes, choose UX/design details inside the scope' : 'no, follow the specified UI'}

**User flow**
${list(c.user_flow)}

**Screens**
${list(c.screens)}

**Data fields**
${list(c.data_fields)}

**API/actions**
${list(c.api_actions)}

**Integrations**
${list(c.integrations)}

**Acceptance criteria**
${list(c.acceptance_criteria)}

**Out of scope**
${list(c.out_of_scope)}

${layoutSection}`;
}
