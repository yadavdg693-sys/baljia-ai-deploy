import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/lib/db', () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
  agents: {},
  reports: {},
  companies: {},
  tasks: {},
  taskExecutions: {},
}));

const task = {
  id: 'task-1',
  company_id: 'company-1',
  tag: 'engineering',
  title: 'Build AI course marketplace',
  description: 'Teachers upload lessons, students subscribe, AI summarizes lessons, and admins approve content in a dashboard.',
} as never;

const executionContract = {
  version: 1,
  intent: 'new_app',
  assigned_agent_id: 30,
  confirmation_source: 'founder_confirmed',
  founder_visible_summary: 'Build an AI course marketplace.',
  product_scope: 'Teachers upload lessons, students subscribe, AI summarizes lessons, and admins approve content.',
  assumptions: ['Founder confirmed the marketplace MVP.'],
  open_questions: [],
  user_flow: ['Sign up', 'Create course', 'Subscribe', 'Review admin approval'],
  screens: ['Landing', 'Auth', 'Dashboard', 'Course detail', 'Admin'],
  data_fields: ['course.title', 'lesson.body', 'subscription.status', 'approval.status'],
  api_actions: ['POST /auth/signup', 'POST /courses', 'POST /subscriptions', 'PATCH /admin/courses/:id'],
  integrations: ['OpenAI'],
  acceptance_criteria: ['Course creation, subscription, AI summary, and admin approval work end to end.'],
  out_of_scope: ['Native mobile'],
  ui_freedom: true,
};

function withProductContractEvidence(result: string, flowIds = 'auth_session,primary_feature'): string {
  const count = flowIds.split(',').filter(Boolean).length;
  const ids = flowIds.split(',').filter(Boolean);
  const contract = {
    version: 1,
    lane: 'standard',
    source: 'domain_augmented',
    roles: ['user'],
    screens: [],
    flows: ids.map((id) => ({
      id,
      name: id,
      laneRequired: ['standard', 'strict', 'canary'],
      startPath: '/',
      actions: [],
      entitiesTouched: [],
      successReadback: [],
      dbAssertions: [],
      authRequired: id !== 'auth_session',
    })),
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
  return [
    result,
    `BUILD_BRIEF_EVIDENCE version=1 lane=standard task_intent=new_app_build planning_depth=standard_app primary_verb=manage_records assumptions=2 non_goals=2 mvp_features=${count} domains=test risks=auth_session`,
    `PRODUCT_BUILD_CONTRACT_EVIDENCE version=1 lane=standard source=domain_augmented screens=3 flows=${count} entities=3 api_actions=3 auth_baseline=true user_isolation=true flow_ids=${flowIds}`,
    `PRODUCT_BUILD_CONTRACT_JSON ${JSON.stringify(contract)}`,
    'PRODUCT_BUILD_CONTRACT_ARTIFACT path=measurement-output/product-build-contracts/task-1.json',
  ].join('\n');
}

function withAcceptanceProof(result: string, flowIds = 'auth_session,primary_feature'): string {
  const ids = flowIds.split(',').filter(Boolean);
  return [
    result,
    `ACCEPTANCE_PROOF_EVIDENCE passed=${ids.length} failed=0 contract_flows=${ids.length}`,
    'AUTH_ISOLATION_PROOF_EVIDENCE passed=1 failed=0 checks=1',
    ...ids.map((id) => `CONTRACT_FLOW_PROOF id=${id} passed=true interaction=${id}`),
  ].join('\n');
}

function completedLaneOutputs(
  roles = ['planner', 'domain', 'frontend', 'backend', 'qa', 'deploy', 'reviewer'],
): Array<{ tool: string; result: string }> {
  return roles.map((role) => ({
    tool: 'record_engineering_lane_output',
    result: [
      `ENGINEERING_LANE_OUTPUT role=${role} status=completed cannot_complete_task=true sections=final evidence=lane_${role}_complete blockers=0`,
      `ENGINEERING_LANE_OUTPUT_JSON ${JSON.stringify({
        role,
        status: 'completed',
        contract_sections: ['final'],
        evidence_markers: [`lane_${role}_complete`],
        files_touched: [],
        blockers: [],
        cannot_complete_task: true,
      })}`,
    ].join('\n'),
  }));
}

const completePlanningLog = [
  { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=marketplace,auth,uploads_storage,payments_stripe,ai_openai,admin_workflow,dashboard,crud,deployment_render' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=marketplace' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=auth' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=uploads_storage' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=payments_stripe' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=ai_openai' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=admin_workflow' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=crud' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
  { tool: 'match_design_system', result: 'DESIGN_SYSTEM_MATCH_EVIDENCE selected=linear-app\nMatched design systems:\n1. linear-app' },
  { tool: 'get_design_system', result: 'DESIGN_SYSTEM_EVIDENCE name=linear-app\nDesign system: linear-app' },
  { tool: 'match_reference_repos', result: 'REFERENCE_MATCH_EVIDENCE selected=vercel-commerce-marketplace-patterns,vercel-ai-chatbot-patterns,open-codesign-design-agent-patterns,radix-accessibility-primitives' },
  { tool: 'get_reference_repo_patterns', result: 'REFERENCE_PATTERN_EVIDENCE id=vercel-commerce-marketplace-patterns repo=vercel/commerce' },
  { tool: 'get_reference_repo_patterns', result: 'REFERENCE_PATTERN_EVIDENCE id=open-codesign-design-agent-patterns repo=OpenCoworkAI/open-codesign' },
  { tool: 'retrieve_component_examples', result: 'COMPONENT_EXAMPLE_EVIDENCE count=3 references=vercel-commerce-marketplace-patterns,open-codesign-design-agent-patterns' },
  { tool: 'compose_app_architecture', result: withProductContractEvidence('ARCHITECTURE_PLAN_EVIDENCE capabilities=marketplace,auth,uploads_storage,payments_stripe,ai_openai,admin_workflow,dashboard,crud,deployment_render reference_patterns=vercel-commerce-marketplace-patterns,open-codesign-design-agent-patterns design_system=linear-app', 'auth_session,marketplace_listing,admin_approval') },
];

const vendorPortalPlanningLog = [
  { tool: 'match_domain_app', result: 'DOMAIN_MATCH_EVIDENCE selected=business_website_crm' },
  { tool: 'get_domain_pack', result: 'DOMAIN_PACK_EVIDENCE id=business_website_crm' },
  { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=auth,roles,crud,uploads_storage,email_notifications,admin_workflow,dashboard,deployment_render' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=auth' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=roles' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=crud' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=uploads_storage' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=email_notifications' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=admin_workflow' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
  { tool: 'match_design_system', result: 'DESIGN_SYSTEM_MATCH_EVIDENCE selected=linear-app' },
  { tool: 'get_design_system', result: 'DESIGN_SYSTEM_EVIDENCE name=linear-app' },
  { tool: 'match_reference_repos', result: 'REFERENCE_MATCH_EVIDENCE selected=documenso-approval-portal-patterns,uploadthing-file-manager-patterns,resend-email-workflow-patterns,radix-accessibility-primitives,onlook-visual-repair-patterns' },
  { tool: 'get_reference_repo_patterns', result: 'REFERENCE_PATTERN_EVIDENCE id=documenso-approval-portal-patterns repo=documenso/documenso' },
  { tool: 'get_reference_repo_patterns', result: 'REFERENCE_PATTERN_EVIDENCE id=radix-accessibility-primitives repo=radix-ui/primitives' },
  { tool: 'retrieve_component_examples', result: 'COMPONENT_EXAMPLE_EVIDENCE count=3 references=documenso-approval-portal-patterns,radix-accessibility-primitives' },
  { tool: 'compose_frontend_plan', result: 'FRONTEND_PLAN_EVIDENCE ui_type=admin_portal pattern_ids=admin-approval,document-portal ui_refs=radix-accessibility-primitives pages=/=admin_portal required_text_count=5 required_buttons_count=3 form_checks_count=2' },
  { tool: 'compose_app_architecture', result: withProductContractEvidence('ARCHITECTURE_PLAN_EVIDENCE capabilities=auth,roles,crud,uploads_storage,email_notifications,admin_workflow,dashboard,deployment_render reference_patterns=documenso-approval-portal-patterns,radix-accessibility-primitives design_system=linear-app', 'auth_session,upload_document,approve_record') },
];

const bookingPlanningLog = [
  { tool: 'match_domain_app', result: 'DOMAIN_MATCH_EVIDENCE selected=local_service_booking' },
  { tool: 'get_domain_pack', result: 'DOMAIN_PACK_EVIDENCE id=local_service_booking' },
  { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=auth,crud,booking,email_notifications,dashboard,deployment_render' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=auth' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=crud' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=booking' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=email_notifications' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard' },
  { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
  { tool: 'match_design_system', result: 'DESIGN_SYSTEM_MATCH_EVIDENCE selected=linear-app' },
  { tool: 'get_design_system', result: 'DESIGN_SYSTEM_EVIDENCE name=linear-app' },
  { tool: 'match_reference_repos', result: 'REFERENCE_MATCH_EVIDENCE selected=calcom-booking-patterns,resend-email-workflow-patterns,radix-accessibility-primitives' },
  { tool: 'get_reference_repo_patterns', result: 'REFERENCE_PATTERN_EVIDENCE id=calcom-booking-patterns repo=calcom/cal.com' },
  { tool: 'get_reference_repo_patterns', result: 'REFERENCE_PATTERN_EVIDENCE id=radix-accessibility-primitives repo=radix-ui/primitives' },
  { tool: 'retrieve_component_examples', result: 'COMPONENT_EXAMPLE_EVIDENCE count=2 references=calcom-booking-patterns,radix-accessibility-primitives' },
  { tool: 'compose_frontend_plan', result: 'FRONTEND_PLAN_EVIDENCE ui_type=booking_calendar pattern_ids=booking-calendar ui_refs=radix-accessibility-primitives pages=/=booking_calendar required_text_count=5 required_buttons_count=3 form_checks_count=2' },
  { tool: 'compose_app_architecture', result: withProductContractEvidence('ARCHITECTURE_PLAN_EVIDENCE capabilities=auth,crud,booking,email_notifications,dashboard,deployment_render reference_patterns=calcom-booking-patterns,radix-accessibility-primitives design_system=linear-app', 'auth_session,booking_reservation') },
];

const domainFrontendPlanningLog = [
  { tool: 'match_domain_app', result: 'DOMAIN_MATCH_EVIDENCE selected=education_content' },
  { tool: 'get_domain_pack', result: 'DOMAIN_PACK_EVIDENCE id=education_content' },
  ...completePlanningLog.slice(0, -1),
  { tool: 'compose_frontend_plan', result: 'FRONTEND_PLAN_EVIDENCE ui_type=education_lms pattern_ids=education-lms,admin-approval ui_refs=open-codesign-design-agent-patterns pages=/=education_lms required_text_count=5 required_buttons_count=3 form_checks_count=2' },
  completePlanningLog[completePlanningLog.length - 1],
];

function withHardDomainGate<T>(fn: () => T): T {
  const previous = process.env.ENGINEERING_DOMAIN_GATE_MODE;
  process.env.ENGINEERING_DOMAIN_GATE_MODE = 'hard';
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.ENGINEERING_DOMAIN_GATE_MODE;
    } else {
      process.env.ENGINEERING_DOMAIN_GATE_MODE = previous;
    }
  }
}

describe('Engineering pre-code planning gate', () => {
  it('prompt and dispatcher include runtime code graph guidance for existing-app work', () => {
    const source = readFileSync(resolve(__dirname, 'agent-factory.ts'), 'utf8');

    expect(source).toContain('build_code_graph');
    expect(source).toContain('query_code_graph');
    expect(source).toContain('CODE_GRAPH_UNAVAILABLE');
    expect(source).toContain('verify_browser_ui');
    expect(source).toContain("'verify_browser_ui', 'verify_interaction_contract', 'review_pushed_code'");
    expect(source).toContain('code_graph_path');
    expect(source).toContain('isMoonshotAvailable');
    expect(source).toContain('runWithMoonshot');
    expect(source).toContain('RENDER_INFRASTRUCTURE_BLOCKER: pipeline_minutes_exhausted');
    expect(source).toContain('RENDER_DEPLOY_BLOCKED_RECENT_PIPELINE_MINUTES_EXHAUSTED');
    expect(source).toContain('force_after_quota_restored=true');
  });

  it('sanitizes Engineering tool schemas for Gemini function declarations', async () => {
    const { getAgentTools, sanitizeSchemaForGeminiTool } = await import('./agent-factory');
    const tool = getAgentTools(30).find((candidate) => candidate.name === 'write_codebase_map');
    expect(tool).toBeDefined();

    const sanitized = sanitizeSchemaForGeminiTool(tool?.input_schema) as {
      properties: Record<string, { type?: unknown; enum?: unknown; properties?: Record<string, { type?: unknown }> }>;
    };

    expect(sanitized.properties.schema_version.type).toBe('integer');
    expect(sanitized.properties.schema_version.enum).toBeUndefined();
    expect(sanitized.properties.deploy.properties?.github_repo.type).toBe('string');
    expect(JSON.stringify(sanitized)).not.toContain('"type":["');
    expect(JSON.stringify(sanitized)).not.toContain('"enum":[1]');
  });

  it('blocks implementation before capability planning', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const result = engineeringPreToolGate('create_instance', [], task);
    expect(result).toContain('PRE_CODE_PLANNING_GATE');
    expect(result).toContain('match_capabilities');
  });

  it('does not force capability/domain planning when CEO provided an execution contract', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const contractedTask = { ...(task as object), execution_contract: executionContract } as never;

    expect(engineeringPreToolGate('create_instance', [], contractedTask)).toBeNull();
  });

  it('does not derive payment/booking critical flows from keywords when CEO provided an execution contract', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const contractedTask = {
      ...(task as object),
      title: 'Build pricing alert dashboard',
      description: 'Users create price alerts and see alert history. This is not Stripe billing.',
      execution_contract: {
        ...executionContract,
        product_scope: 'Users create price alerts and review alert history. Payments are out of scope.',
        integrations: [],
        out_of_scope: ['Stripe', 'billing', 'checkout'],
      },
    } as never;

    const verifiedContractLog = [
      { tool: 'github_fork_skeleton', result: 'Forked Next.js skeleton' },
      { tool: 'github_create_commit', result: 'Committed pricing alert dashboard' },
      { tool: 'render_deploy', result: 'Render deploy triggered' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: price alert flow - all 4 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: "price alert row" - 1 row(s) matched.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: price alert UI loaded and controls were present.' },
      { tool: 'verify_interaction_contract', result: 'INTERACTION_PROOF_EVIDENCE passed=1 failed=0 expected=1\nINTERACTION PROOF PASS: 1 interaction(s) passed.' },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 1 table(s), 1 route(s)).' },
      { tool: 'create_report', result: 'Report created: "Price alert dashboard final report"' },
    ];

    expect(engineeringCompletionGate(30, verifiedContractLog, contractedTask)).toBeNull();
  });

  it('does not trust product contract evidence printed by non-planning tools', async () => {
    const { engineeringPlanningEvidence } = await import('./agent-factory');
    const evidence = engineeringPlanningEvidence([
      {
        tool: 'create_report',
        result: withProductContractEvidence('Report says everything is planned', 'auth_session,primary_feature'),
      },
    ], task);

    expect(evidence.buildBriefPresent).toBe(false);
    expect(evidence.productContractPresent).toBe(false);
    expect(evidence.productContractRequiredFlowIds).toEqual([]);
  });

  it('does not classify planning instructions that say explain product shape as read-only', async () => {
    const { isCapabilityPlanningTask, engineeringPreToolGate } = await import('./agent-factory');
    const canaryStyleTask = {
      id: 'task-canary-style',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'CANARY ai-course-marketplace: AI course marketplace',
      description: [
        'Build and deploy an AI-powered course marketplace.',
        'Mandatory planning before implementation:',
        'If no known domain fits, call compose_ad_hoc_domain and explain the product shape.',
        'Call compose_frontend_plan for the user-facing UI contract.',
      ].join('\n'),
    } as never;

    expect(isCapabilityPlanningTask(canaryStyleTask, [])).toBe(true);
    expect(engineeringPreToolGate('create_instance', [], canaryStyleTask)).toContain('match_capabilities');
  });

  it('routes domain and frontend planning tools through the Engineering dispatcher', async () => {
    const { handleToolCall } = await import('./agent-factory');

    await expect(handleToolCall('match_domain_app', {
      title: 'AI course marketplace',
      description: 'Teachers upload lessons, students subscribe, and admins approve course content.',
    }, task, 30)).resolves.toContain('DOMAIN_MATCH_EVIDENCE');

    await expect(handleToolCall('compose_frontend_plan', {
      task_title: 'AI course marketplace',
      task_description: 'Teachers upload lessons, students subscribe, and admins approve course content.',
      domain_ids: ['education_content'],
      capabilities: ['marketplace', 'admin_workflow', 'dashboard'],
      design_system: 'linear-app',
      pages: ['/'],
      actors: ['teacher', 'student', 'admin'],
    }, task, 30)).resolves.toContain('FRONTEND_PLAN_EVIDENCE');
  });

  it('blocks implementation until every selected capability pack is loaded', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const result = engineeringPreToolGate('github_fork_skeleton', [
      { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=marketplace,auth,deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=marketplace' },
    ], task);
    expect(result).toContain('auth');
    expect(result).toContain('deployment_render');
  });

  it('keeps simple backend features on a lightweight planning path', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const simpleTask = {
      id: 'task-simple-api',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Add one API route',
      description: 'Add one endpoint that returns server status JSON.',
    } as never;
    const simpleLog = [
      { tool: 'match_capabilities', result: 'PLANNING_DEPTH_EVIDENCE depth=simple_feature reasons=narrow_single_feature risks=none\nCAPABILITY_MATCH_EVIDENCE selected=deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=deployment_render reference_patterns=none design_system=none' },
    ];

    expect(engineeringPreToolGate('github_push_file', simpleLog, simpleTask)).toBeNull();
  });

  it('requires capability packs only for required capabilities when optional capabilities are present', async () => {
    const { engineeringPlanningEvidence, engineeringPreToolGate } = await import('./agent-factory');
    const task = {
      id: 'task-required-optional',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Add one API route',
      description: 'Add one endpoint that returns server status JSON.',
    } as never;
    const log = [
      { tool: 'match_capabilities', result: 'PLANNING_DEPTH_EVIDENCE depth=simple_feature reasons=narrow_single_feature risks=none\nCAPABILITY_MATCH_EVIDENCE required=deployment_render optional=crud,dashboard selected=deployment_render,crud,dashboard' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=deployment_render reference_patterns=none design_system=none' },
    ];

    expect(engineeringPlanningEvidence(log, task)).toMatchObject({
      requiredCapabilities: ['deployment_render'],
      optionalCapabilities: ['crud', 'dashboard'],
      missingCapabilityPacks: [],
    });
    expect(engineeringPreToolGate('github_push_file', log, task)).toBeNull();
  });

  it('keeps simple UI changes from requiring GitHub references or frontend plan', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const simpleUiTask = {
      id: 'task-simple-ui',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Update one page button',
      description: 'Change one dashboard page button label and spacing.',
    } as never;
    const simpleUiLog = [
      { tool: 'match_capabilities', result: 'PLANNING_DEPTH_EVIDENCE depth=simple_feature reasons=narrow_single_feature risks=none\nCAPABILITY_MATCH_EVIDENCE selected=deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
      { tool: 'match_design_system', result: 'DESIGN_SYSTEM_MATCH_EVIDENCE selected=linear-app' },
      { tool: 'get_design_system', result: 'DESIGN_SYSTEM_EVIDENCE name=linear-app' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=deployment_render reference_patterns=none design_system=linear-app' },
    ];

    expect(engineeringPreToolGate('github_push_file', simpleUiLog, simpleUiTask)).toBeNull();
  });

  it('uses focused repair intent to avoid full world-class planning for one failed interaction', async () => {
    const { engineeringPreToolGate, engineeringPlanningEvidence } = await import('./agent-factory');
    const repairTask = {
      id: 'task-repair',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'CEO repair task: fix Vendor Compliance canary app',
      description: 'Fix the existing app. Use the same repo and Render service. The original canary failed because Save document did not render the saved document after clicking the button.',
    } as never;
    const repairLog = [
      { tool: 'read_codebase_map', result: 'Codebase map loaded: routes=/ tables=canary_vendor_documents' },
      { tool: 'query_code_graph', result: 'CODE_GRAPH_EVIDENCE repo_sha=abc files=12 report_saved=true\nRelevant files: app/page.tsx, app/api/canary-vendor-documents/route.ts' },
      { tool: 'match_capabilities', result: 'TASK_INTENT_EVIDENCE intent=focused_repair lane=repair reasons=repair_signal,existing_app_signal\nPLANNING_DEPTH_EVIDENCE depth=mixed_complex_app reasons=many_capabilities risks=auth,uploads,admin_workflow\nCAPABILITY_MATCH_EVIDENCE selected=auth,roles,crud,uploads_storage,email_notifications,admin_workflow,dashboard,deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=uploads_storage' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=uploads_storage reference_patterns=none design_system=none\nFocused repair plan: patch app/page.tsx document submit readback and rerun document UI proof.' },
    ];

    expect(engineeringPlanningEvidence(repairLog, repairTask)).toMatchObject({
      taskIntent: 'focused_repair',
      taskIntentLane: 'repair',
    });
    expect(engineeringPreToolGate('github_push_file', repairLog, repairTask)).toBeNull();
  });

  it('forces full planning for explicit canary harness tasks', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const canaryTask = {
      id: 'task-canary',
      company_id: 'company-1',
      tag: 'engineering-canary',
      title: 'Build AI course marketplace evaluation task',
      description: 'Run the explicit Engineering canary harness.',
    } as never;

    expect(engineeringPreToolGate('create_instance', completePlanningLog, canaryTask)).toContain('domain planning');
    expect(engineeringPreToolGate('create_instance', domainFrontendPlanningLog, canaryTask)).toBeNull();

    const previous = process.env.ENGINEERING_DOMAIN_GATE_MODE;
    process.env.ENGINEERING_DOMAIN_GATE_MODE = 'off';
    try {
      expect(engineeringPreToolGate('create_instance', completePlanningLog, canaryTask)).toContain('domain planning');
    } finally {
      if (previous === undefined) {
        delete process.env.ENGINEERING_DOMAIN_GATE_MODE;
      } else {
        process.env.ENGINEERING_DOMAIN_GATE_MODE = previous;
      }
    }
  });

  it('blocks deploy and verification churn after Render pipeline quota is exhausted', async () => {
    const { engineeringInfrastructureBlockerGate } = await import('./agent-factory');
    const quotaLog = [
      { tool: 'render_get_deploy_status', result: 'Deploy dep-quota status: build_failed\nRENDER_INFRASTRUCTURE_BLOCKER: pipeline_minutes_exhausted\nRender rejected the build before app build logs were produced because the account has exhausted pipeline/build minutes.' },
    ];

    expect(engineeringInfrastructureBlockerGate('render_deploy', quotaLog)).toContain('pipeline_minutes_exhausted');
    expect(engineeringInfrastructureBlockerGate('verify_user_journey', quotaLog)).toContain('Stop code/config/deploy/verification churn');
    expect(engineeringInfrastructureBlockerGate('static_code_scan', quotaLog)).toBeNull();
    expect(engineeringInfrastructureBlockerGate('create_report', quotaLog)).toBeNull();
    expect(engineeringInfrastructureBlockerGate('github_create_commit', [
      ...quotaLog,
      { tool: 'review_pushed_code', result: 'CODE REVIEW: 2 finding(s) — high=1 medium=1\n[HIGH] auth bypass' },
    ])).toBeNull();
    expect(engineeringInfrastructureBlockerGate('github_create_commit', [
      ...quotaLog,
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS: Clean — no issues found.' },
    ])).toContain('pipeline_minutes_exhausted');
  });

  it('recognizes render_deploy quota guard output as an active Render pipeline blocker', async () => {
    const { engineeringInfrastructureBlockerGate } = await import('./agent-factory');
    const guardedDeployLog = [
      { tool: 'render_deploy', result: 'RENDER_DEPLOY_BLOCKED_RECENT_PIPELINE_MINUTES_EXHAUSTED\nRender service srv-test has a recent pipeline_minutes_exhausted event, so render_deploy is refusing to trigger another build attempt.\nBuild ID: bld-quota\nCircuit breaker window: 1440 minute(s)' },
    ];

    expect(engineeringInfrastructureBlockerGate('render_deploy', guardedDeployLog)).toContain('pipeline_minutes_exhausted');
    expect(engineeringInfrastructureBlockerGate('verify_user_journey', guardedDeployLog)).toContain('Stop code/config/deploy/verification churn');
    expect(engineeringInfrastructureBlockerGate('create_report', guardedDeployLog)).toBeNull();
  });

  it('does not treat known-issue references as active Render pipeline quota blockers', async () => {
    const { engineeringInfrastructureBlockerGate } = await import('./agent-factory');
    const historicalIssueLog = [
      {
        tool: 'read_known_issues',
        result: 'KNOWN ISSUES: [FIXED] Render deploy build_failed with empty deploy logs because service events contain RENDER_INFRASTRUCTURE_BLOCKER: pipeline_minutes_exhausted. This is historical guidance, not active deploy evidence.',
      },
    ];

    expect(engineeringInfrastructureBlockerGate('github_create_commit', historicalIssueLog)).toBeNull();
    expect(engineeringInfrastructureBlockerGate('render_get_deploy_status', historicalIssueLog)).toBeNull();
  });

  it('blocks destructive deploy churn during normal Engineering builds', async () => {
    const { engineeringDeployChurnGate } = await import('./agent-factory');
    const buildTask = {
      title: 'Build vendor compliance portal',
      description: 'Create a user-facing full-stack app and deploy it.',
      tag: 'engineering',
    };
    const provisionedLog = [
      { tool: 'create_instance', result: 'Step 4/4: Instance ready!\nService ID: srv-test\nApp URL: https://vendor-test.onrender.com' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: vendor flow - all steps passed.' },
    ];

    expect(engineeringDeployChurnGate('render_delete_service', provisionedLog, buildTask)).toContain('blocked');
    expect(engineeringDeployChurnGate('create_instance', provisionedLog, buildTask)).toContain('already provisioned');
    expect(engineeringDeployChurnGate('render_delete_service', provisionedLog, {
      ...buildTask,
      title: 'Tear down Render service for retired app',
    })).toBeNull();
  });

  it('blocks repeated custom-domain work after a domain failure in the same task', async () => {
    const { engineeringDeployChurnGate } = await import('./agent-factory');
    const domainFailureLog = [
      { tool: 'attach_custom_domain', result: 'Failed to attach custom domain. Make sure a website has been deployed to Render first (use render_create_service).' },
    ];

    expect(engineeringDeployChurnGate('attach_custom_domain', domainFailureLog, task)).toContain('custom-domain');
    expect(engineeringDeployChurnGate('verify_custom_domain', domainFailureLog, task)).toContain('onrender.com');
    expect(engineeringDeployChurnGate('check_url_health', domainFailureLog, task)).toBeNull();
  });

  it('blocks repeated skill discovery loops and points Engineering back to planning', async () => {
    const { engineeringSkillLoopGate } = await import('./agent-factory');
    const firstCall = engineeringSkillLoopGate('list_skills', [], task);
    const repeated = engineeringSkillLoopGate('list_skills', [
      { tool: 'list_skills', result: 'Available skills: skeleton-nextjs, render-infra, frontend-design' },
    ], task);

    expect(firstCall).toBeNull();
    expect(repeated).toContain('SKILL_DISCOVERY_GATE');
    expect(repeated).toContain('match_capabilities');
    expect(repeated).toContain('compose_app_architecture');
    expect(engineeringSkillLoopGate('read_skill', [
      { tool: 'list_skills', result: 'Available skills: skeleton-nextjs, render-infra, frontend-design' },
    ], task)).toBeNull();
  });

  it('allows final blocker reporting for Render pipeline-minute exhaustion without fake live verification', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const quotaBaseLog = [
      ...domainFrontendPlanningLog,
      { tool: 'github_push_file', result: 'File pushed successfully: app/page.tsx' },
      { tool: 'render_deploy', result: 'Deployment triggered! Deploy ID: dep-quota\nNEXT_REQUIRED_TOOL: render_get_deploy_status service_id=srv-test deploy_id=dep-quota wait_for_terminal=true' },
      { tool: 'render_get_deploy_status', result: 'Deploy dep-quota status: build_failed\nFinished: 2026-05-15T12:30:12Z\nRENDER_INFRASTRUCTURE_BLOCKER: pipeline_minutes_exhausted\nRender rejected the build before app build logs were produced because the account has exhausted pipeline/build minutes.' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
    ];

    expect(engineeringCompletionGate(30, quotaBaseLog, task)).toContain('write_codebase_map');

    const withMap = [
      ...quotaBaseLog,
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 2 table(s), 4 route(s)).' },
    ];
    expect(engineeringCompletionGate(30, withMap, task)).toContain('final blocker report');

    expect(engineeringCompletionGate(30, [
      ...withMap,
      {
        tool: 'create_report',
        input: {
          title: 'Render quota blocker',
          summary: 'RENDER_INFRASTRUCTURE_BLOCKER: pipeline_minutes_exhausted. Rerun deploy verification after Render build minutes are restored.',
        },
        result: 'Report created: "Render quota blocker"',
      },
    ], task)).toBeNull();
  });

  it('accepts fresh verify_release pass as bundled release evidence', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const contractedTask = {
      ...(task as Record<string, unknown>),
      execution_contract: executionContract,
    } as never;
    const log = [
      { tool: 'ensure_founder_app_instance', result: '{"repo":"BALAJIapps/course-marketplace","repoStatus":"reused"}' },
      { tool: 'github_create_commit', result: 'Committed 1 file(s) to BALAJIapps/course-marketplace/main\nCommit: abc1234' },
      { tool: 'render_deploy', result: 'Deployment triggered! Deploy ID: dep-1' },
      {
        tool: 'verify_release',
        result: 'VERIFY_RELEASE_PASS {"passed":true,"selectedVerificationUrl":"https://course.onrender.com","finalFounderUrl":"https://course.baljia.app","checks":[{"name":"all","passed":true,"summary":"ok"}],"blockers":[]}',
      },
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 2 table(s), 4 route(s)).' },
      { tool: 'create_report', result: 'Report created: "Release verified"' },
    ];

    expect(engineeringCompletionGate(30, log, contractedTask)).toBeNull();
  });

  it('requires final UI reports to name the selected design system and how it was applied', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const uiLog = [
      ...domainFrontendPlanningLog,
      { tool: 'ensure_founder_app_instance', result: '{"repo":"BALAJIapps/course-marketplace","repoStatus":"reused"}' },
      { tool: 'github_create_commit', result: 'Committed 1 file(s) to BALAJIapps/course-marketplace/main\nCommit: abc1234' },
      { tool: 'render_deploy', result: 'Deployment triggered! Deploy ID: dep-1' },
      {
        tool: 'verify_release',
        result: 'VERIFY_RELEASE_PASS {"passed":true,"selectedVerificationUrl":"https://course.onrender.com","finalFounderUrl":"https://course.baljia.app","checks":[{"name":"all","passed":true,"summary":"ok"}],"blockers":[]}',
      },
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 2 table(s), 4 route(s)).' },
      {
        tool: 'create_report',
        input: { title: 'Release verified', content: 'Live URL and verification evidence are included.' },
        result: 'Report created: "Release verified"',
      },
      ...completedLaneOutputs(),
    ];

    expect(engineeringCompletionGate(30, uiLog, task)).toContain('selected design system');

    const fixed = uiLog.map((entry) => entry.tool === 'create_report'
      ? {
        tool: 'create_report',
        input: {
          title: 'Release verified',
          content: 'Design system: linear-app. How applied: used its density, typography rhythm, dashboard spacing, and subdued interaction style across the shipped UI.',
        },
        result: 'Report created: "Release verified"',
      }
      : entry);
    expect(engineeringCompletionGate(30, fixed, task)).toBeNull();
  });

  it('keeps complex existing-app extensions on the mixed planning path after graph evidence', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const existingComplexTask = {
      id: 'task-existing-complex',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Extend existing app with billing, RAG document search, and admin dashboard',
      description: 'Preserve the existing route while adding subscriptions, document analysis history, and admin reporting.',
    } as never;
    const existingComplexLog = [
      { tool: 'read_codebase_map', result: 'Codebase map loaded: routes=/dashboard tables=documents' },
      { tool: 'build_code_graph', result: 'CODE_GRAPH_EVIDENCE repo_sha=abc files=12 report_saved=true' },
      { tool: 'query_code_graph', result: 'Relevant files: app/dashboard/page.tsx, db/schema.ts' },
      { tool: 'match_domain_app', result: 'DOMAIN_MATCH_EVIDENCE selected=saas_billing' },
      { tool: 'get_domain_pack', result: 'DOMAIN_PACK_EVIDENCE id=saas_billing' },
      { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=payments_stripe,rag_search,ai_openai,admin_workflow,dashboard,crud,deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=payments_stripe' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=rag_search' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=ai_openai' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=admin_workflow' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=crud' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
      { tool: 'match_design_system', result: 'DESIGN_SYSTEM_MATCH_EVIDENCE selected=linear-app' },
      { tool: 'get_design_system', result: 'DESIGN_SYSTEM_EVIDENCE name=linear-app' },
    ];

    expect(engineeringPreToolGate('github_push_file', existingComplexLog, existingComplexTask)).toContain('compose_frontend_plan');
  });

  it('allows implementation after capability, design, reference, component, and architecture evidence', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    expect(engineeringPreToolGate('create_instance', domainFrontendPlanningLog, task)).toBeNull();
    expect(engineeringPreToolGate('github_push_file', domainFrontendPlanningLog, task)).toBeNull();
  });

  it('blocks manual first-deploy Render service creation for full-stack apps before create_instance', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');

    const result = engineeringPreToolGate('render_create_service', domainFrontendPlanningLog, task);

    expect(result).toContain('create_instance');
    expect(result).toContain('canonical onboarding repo/DB');
  });

  it('allows manual Render service creation when create_instance gives an explicit manual fallback', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const manualFallbackLog = [
      ...domainFrontendPlanningLog,
      {
        tool: 'create_instance',
        result: [
          'Step 3/4: Repository ready.',
          'RENDER_API_KEY not configured - cannot create Render service automatically.',
          'Manual step: Create a Render web service with:',
          '- repo: BALAJIapps/careerops',
        ].join('\n'),
      },
    ];

    const result = engineeringPreToolGate('render_create_service', manualFallbackLog, task);

    expect(result).toBeNull();
  });

  it('still blocks duplicate GitHub repo creation when create_instance only gives a Render manual fallback', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const manualRenderFallbackLog = [
      ...domainFrontendPlanningLog,
      {
        tool: 'create_instance',
        result: [
          'Step 3/4: Repository ready.',
          'RENDER_API_KEY not configured - cannot create Render service automatically.',
          'Manual step: Create a Render web service with:',
          '- repo: BALAJIapps/careerops',
        ].join('\n'),
      },
    ];

    const result = engineeringPreToolGate('github_create_repo', manualRenderFallbackLog, task);

    expect(result).toContain('create_instance');
    expect(result).toContain('canonical onboarding repo/DB');
  });

  it('allows non-marketplace mixed apps after complete planning evidence', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const vendorTask = {
      id: 'task-vendor',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Build vendor compliance portal',
      description: 'Vendors onboard, upload documents, admins approve submissions, notifications are recorded, and a dashboard shows status.',
    } as never;
    const bookingTask = {
      id: 'task-booking',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Build booking scheduling app',
      description: 'Customers book available slots, duplicate bookings are prevented, and admins manage availability.',
    } as never;

    expect(engineeringPreToolGate('create_instance', vendorPortalPlanningLog, vendorTask)).toBeNull();
    expect(engineeringPreToolGate('create_instance', bookingPlanningLog, bookingTask)).toBeNull();
  });

  it('treats selected dashboard/admin capabilities as UI even when task title is generic', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const genericExtensionTask = {
      id: 'task-generic-extension',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Existing app extension task',
      description: 'Extend the existing app.',
    } as never;
    const log = [
      { tool: 'read_codebase_map', result: 'Codebase map saved previously.' },
      { tool: 'build_code_graph', result: 'CODE_GRAPH_UNAVAILABLE: graphify missing' },
      { tool: 'read_known_issues', result: 'KNOWN ISSUES: none match this context.' },
      { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=dashboard,admin_workflow,deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=admin_workflow' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
      { tool: 'match_reference_repos', result: 'REFERENCE_MATCH_EVIDENCE selected=shadcn-dashboard-patterns' },
      { tool: 'get_reference_repo_patterns', result: 'REFERENCE_PATTERN_EVIDENCE id=shadcn-dashboard-patterns repo=shadcn-ui/ui' },
      { tool: 'retrieve_component_examples', result: 'COMPONENT_EXAMPLE_EVIDENCE count=2 references=shadcn-dashboard-patterns' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=dashboard,admin_workflow,deployment_render reference_patterns=shadcn-dashboard-patterns design_system=none' },
    ];

    expect(engineeringPreToolGate('github_create_commit', log, genericExtensionTask)).toContain('match_design_system');
  });

  it('requires query_code_graph before editing existing-app extensions when Graphify is available', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const extensionTask = {
      id: 'task-extension',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Existing-app extension canary',
      description: 'Extend the existing app with billing, RAG document search, and an admin dashboard.',
    } as never;
    const graphLog = [
      { tool: 'read_codebase_map', result: 'Codebase map saved previously: app routes and db schema.' },
      { tool: 'build_code_graph', result: 'CODE_GRAPH_EVIDENCE repo_sha=abc files=42 report_saved=true' },
      ...domainFrontendPlanningLog,
    ];

    expect(engineeringPreToolGate('github_create_commit', graphLog, extensionTask)).toContain('query_code_graph');
    expect(engineeringPreToolGate('github_create_commit', [
      graphLog[0],
      graphLog[1],
      { tool: 'query_code_graph', result: 'CODE_GRAPH_QUERY_EVIDENCE repo_sha=abc files=8\nRelevant files: app/app/page.tsx, db/schema.ts' },
      ...domainFrontendPlanningLog,
    ], extensionTask)).toContain('read_known_issues');
    expect(engineeringPreToolGate('github_create_commit', [
      graphLog[0],
      graphLog[1],
      { tool: 'query_code_graph', result: 'CODE_GRAPH_QUERY_EVIDENCE repo_sha=abc files=8\nRelevant files: app/app/page.tsx, db/schema.ts' },
      { tool: 'read_known_issues', result: 'KNOWN ISSUES: 1 relevant entry\nfix: provider-aware embedding guidance' },
      ...domainFrontendPlanningLog,
    ], extensionTask)).toBeNull();
  });

  it('blocks known-bad RAG embedding architecture before code or migrations', async () => {
    const { engineeringPreToolGate, engineeringCompletionGate } = await import('./agent-factory');
    const ragTask = {
      id: 'task-rag',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Build AI document analyzer',
      description: 'Upload documents, generate summaries, and search documents with RAG.',
    } as never;
    const badRagLog = [
      { tool: 'match_domain_app', result: 'DOMAIN_MATCH_EVIDENCE selected=advanced_ai_mixed' },
      { tool: 'get_domain_pack', result: 'DOMAIN_PACK_EVIDENCE id=advanced_ai_mixed' },
      { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=auth,crud,rag_search,dashboard,deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=auth' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=crud' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=rag_search' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
      { tool: 'match_design_system', result: 'DESIGN_SYSTEM_MATCH_EVIDENCE selected=linear-app' },
      { tool: 'get_design_system', result: 'DESIGN_SYSTEM_EVIDENCE name=linear-app' },
      { tool: 'match_reference_repos', result: 'REFERENCE_MATCH_EVIDENCE selected=vercel-ai-chatbot-patterns,radix-accessibility-primitives' },
      { tool: 'get_reference_repo_patterns', result: 'REFERENCE_PATTERN_EVIDENCE id=vercel-ai-chatbot-patterns repo=vercel/ai-chatbot' },
      { tool: 'get_reference_repo_patterns', result: 'REFERENCE_PATTERN_EVIDENCE id=radix-accessibility-primitives repo=radix-ui/primitives' },
      { tool: 'retrieve_component_examples', result: 'COMPONENT_EXAMPLE_EVIDENCE count=2 references=vercel-ai-chatbot-patterns,radix-accessibility-primitives' },
      { tool: 'compose_frontend_plan', result: 'FRONTEND_PLAN_EVIDENCE ui_type=ai_workspace pattern_ids=ai-workspace ui_refs=radix-accessibility-primitives pages=/=ai_workspace required_text_count=5 required_buttons_count=3 form_checks_count=2' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=auth,crud,rag_search,dashboard,deployment_render reference_patterns=vercel-ai-chatbot-patterns,radix-accessibility-primitives design_system=linear-app\nUse Gemini text-embedding-004 with vector 768 dims.' },
    ];

    expect(engineeringPreToolGate('run_migration', badRagLog, ragTask)).toContain('known-bad');
    expect(engineeringCompletionGate(30, badRagLog, ragTask)).toContain('known-bad');
  });

  it('requires architecture to include selected reference patterns', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const log = domainFrontendPlanningLog.map((entry) =>
      entry.tool === 'compose_app_architecture'
        ? { ...entry, result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=marketplace,auth reference_patterns=none design_system=linear-app' }
        : entry
    );
    const result = engineeringPreToolGate('create_instance', log, task);
    expect(result).toContain('selected reference_patterns');
  });

  it('blocks UI implementation when the loaded design system differs from the matched company design system', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const mismatchLog = domainFrontendPlanningLog.map((entry) => {
      if (entry.tool === 'match_design_system') {
        return { ...entry, result: 'DESIGN_SYSTEM_MATCH_EVIDENCE selected=linear-app\nReused existing company design system.' };
      }
      if (entry.tool === 'get_design_system') {
        return { ...entry, result: 'DESIGN_SYSTEM_EVIDENCE name=stripe\nDesign system: stripe' };
      }
      if (entry.tool === 'compose_app_architecture') {
        return { ...entry, result: withProductContractEvidence('ARCHITECTURE_PLAN_EVIDENCE capabilities=marketplace,auth,uploads_storage,payments_stripe,ai_openai,admin_workflow,dashboard,crud,deployment_render reference_patterns=vercel-commerce-marketplace-patterns,open-codesign-design-agent-patterns design_system=stripe', 'auth_session,marketplace_listing,admin_approval') };
      }
      return entry;
    });

    const result = engineeringPreToolGate('create_instance', mismatchLog, task);
    expect(result).toContain('loaded design system');
    expect(result).toContain('linear-app');
  });

  it('requires UI-craft reference evidence for strict/canary UI implementation', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const noUiCraftLoaded = domainFrontendPlanningLog.filter((entry) =>
      !(entry.tool === 'get_reference_repo_patterns' && String(entry.result).includes('open-codesign-design-agent-patterns'))
    );
    const missingFrontendUiRefs = domainFrontendPlanningLog.map((entry) =>
      entry.tool === 'compose_frontend_plan'
        ? { ...entry, result: 'FRONTEND_PLAN_EVIDENCE ui_type=education_lms pattern_ids=education-lms,admin-approval pages=/=education_lms required_text_count=5 required_buttons_count=3 form_checks_count=2' }
        : entry
    );
    const missingArchitectureUiRefs = domainFrontendPlanningLog.map((entry) =>
      entry.tool === 'compose_app_architecture'
        ? { ...entry, result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=marketplace,auth,uploads_storage,payments_stripe,ai_openai,admin_workflow,dashboard,crud,deployment_render reference_patterns=vercel-commerce-marketplace-patterns design_system=linear-app' }
        : entry
    );

    expect(engineeringPreToolGate('create_instance', noUiCraftLoaded, task)).toContain('UI-craft reference');
    expect(engineeringPreToolGate('create_instance', missingFrontendUiRefs, task)).toContain('compose_frontend_plan');
    expect(engineeringPreToolGate('create_instance', missingArchitectureUiRefs, task)).toContain('UI-craft reference');
  });

  it('requires architecture to run after reference retrieval completes', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    const earlyArchitectureLog = [
      ...domainFrontendPlanningLog.filter((entry) => entry.tool !== 'compose_app_architecture' && entry.tool !== 'get_reference_repo_patterns' && entry.tool !== 'retrieve_component_examples'),
      domainFrontendPlanningLog.find((entry) => entry.tool === 'compose_app_architecture')!,
      ...domainFrontendPlanningLog.filter((entry) => entry.tool === 'get_reference_repo_patterns' || entry.tool === 'retrieve_component_examples'),
    ];
    const result = engineeringPreToolGate('create_instance', earlyArchitectureLog, task);
    expect(result).toContain('ran before reference pattern/component retrieval');
  });

  it('parses deterministic planning evidence markers', async () => {
    const { engineeringPlanningEvidence } = await import('./agent-factory');
    const evidence = engineeringPlanningEvidence(completePlanningLog, task);
    expect(evidence.selectedCapabilities).toContain('marketplace');
    expect(evidence.missingCapabilityPacks).toEqual([]);
    expect(evidence.loadedReferencePatterns).toContain('vercel-commerce-marketplace-patterns');
    expect(evidence.architectureReferencePatterns).toContain('vercel-commerce-marketplace-patterns');
    expect(evidence.loadedDesignSystem).toBe('linear-app');
  });

  it('parses task intent and interaction evidence markers', async () => {
    const { engineeringPlanningEvidence } = await import('./agent-factory');
    const evidence = engineeringPlanningEvidence([
      { tool: 'match_capabilities', result: 'TASK_INTENT_EVIDENCE intent=new_app_build lane=build reasons=build_or_default\nCAPABILITY_MATCH_EVIDENCE selected=crud,dashboard,deployment_render' },
      { tool: 'compose_frontend_plan', result: 'FRONTEND_PLAN_EVIDENCE ui_type=dashboard pattern_ids=dashboard ui_refs=radix-accessibility-primitives\nINTERACTION_CONTRACT_EVIDENCE count=2 db_writes=records,audit_logs' },
      { tool: 'verify_interaction_contract', result: 'INTERACTION_PROOF_EVIDENCE passed=2 failed=0\nINTERACTION PROOF PASS: 2 interaction(s) passed.' },
    ], task);

    expect(evidence.taskIntent).toBe('new_app_build');
    expect(evidence.interactionContractComposed).toBe(true);
    expect(evidence.interactionContractCount).toBe(2);
    expect(evidence.interactionContractDbWrites).toEqual(['records', 'audit_logs']);
    expect(evidence.frontendPlanUiReferences).toContain('radix-accessibility-primitives');
    expect(evidence.interactionProofPassed).toBe(true);
  });

  it('parses domain, frontend, and ad-hoc planning evidence markers', async () => {
    const { engineeringPlanningEvidence } = await import('./agent-factory');
    const evidence = engineeringPlanningEvidence([
      ...domainFrontendPlanningLog,
      { tool: 'compose_ad_hoc_domain', result: 'AD_HOC_DOMAIN_EVIDENCE name=drone_inspection entities=drones,inspections workflows=schedule_and_confirm capabilities_hint=crud,dashboard,deployment_render' },
    ], task);

    expect(evidence.domainMatched).toBe(true);
    expect(evidence.selectedDomains).toEqual(expect.arrayContaining(['education_content', 'drone_inspection']));
    expect(evidence.loadedDomainPacks).toContain('education_content');
    expect(evidence.missingDomainPacks).toEqual([]);
    expect(evidence.adHocDomainComposed).toBe(true);
    expect(evidence.frontendPlanComposed).toBe(true);
    expect(evidence.frontendPlanUiType).toBe('education_lms');
    expect(evidence.frontendPlanPatterns).toEqual(expect.arrayContaining(['education-lms', 'admin-approval']));
  });

  it('hard-mode pre-code gate blocks clear domain tasks before domain planning', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    withHardDomainGate(() => {
      const result = engineeringPreToolGate('create_instance', completePlanningLog, task);
      expect(result).toContain('domain planning');
      expect(result).toContain('match_domain_app');
    });
  });

  it('hard-mode pre-code gate requires compose_frontend_plan before UI implementation', async () => {
    const { engineeringPreToolGate } = await import('./agent-factory');
    withHardDomainGate(() => {
      const result = engineeringPreToolGate('github_fork_skeleton', domainFrontendPlanningLog.filter((entry) => entry.tool !== 'compose_frontend_plan'), task);
      expect(result).toContain('compose_frontend_plan');
      expect(engineeringPreToolGate('github_fork_skeleton', domainFrontendPlanningLog, task)).toBeNull();
    });
  });

  it('blocks duplicate Render service creation after create_instance already provisioned the app', async () => {
    const { engineeringDeployChurnGate } = await import('./agent-factory');
    const provisionedLog = [
      { tool: 'create_instance', result: 'Step 4/4: Instance ready!\nService ID: srv-test\nApp URL: https://careerops.baljia.app' },
    ];

    const result = engineeringDeployChurnGate('render_create_service', provisionedLog, task);

    expect(result).toContain('already provisioned');
    expect(result).toContain('render_deploy');
  });

  it('hard-mode completion gate blocks missing domain/frontend evidence but does not block backend-only tasks', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const backendTask = {
      id: 'task-webhook-hard',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Add webhook ingestion endpoint',
      description: 'Create a backend API endpoint that stores third-party webhook events in Postgres.',
    } as never;
    const backendLog = [
      { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=external_api,crud,deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=external_api' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=crud' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=external_api,crud,deployment_render reference_patterns=none design_system=none' },
      { tool: 'create_instance', result: 'Instance ready: https://example.onrender.com' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: webhook create - all 2 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: "webhook row" - 1 row(s) matched.' },
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 1 table(s), 1 route(s)).' },
      { tool: 'create_report', result: 'Report created: "Webhook final report"' },
    ];

    withHardDomainGate(() => {
      expect(engineeringCompletionGate(30, completePlanningLog, task)).toContain('domain evidence');
      expect(engineeringCompletionGate(30, domainFrontendPlanningLog.filter((entry) => entry.tool !== 'compose_frontend_plan'), task)).toContain('FRONTEND_PLAN_EVIDENCE');
      expect(engineeringCompletionGate(30, [
        { tool: 'match_domain_app', result: 'DOMAIN_MATCH_EVIDENCE selected=education_content' },
        { tool: 'get_domain_pack', result: 'DOMAIN_PACK_EVIDENCE id=education_content' },
        { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=crud,dashboard,deployment_render' },
        { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=crud' },
        { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard' },
        { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
        { tool: 'compose_frontend_plan', result: 'FRONTEND_PLAN_EVIDENCE ui_type=education_lms pattern_ids=education-lms' },
        { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=crud,dashboard,deployment_render reference_patterns=none design_system=linear-app' },
      ], task)).toContain('generic CRUD/dashboard');
      expect(engineeringCompletionGate(30, backendLog, backendTask)).toBeNull();
    });
  });

  it('completion gate requires verify_db_state for DB-writing backend tasks', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const backendTask = {
      id: 'task-webhook',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Add webhook ingestion endpoint',
      description: 'Create a backend API endpoint that stores third-party webhook events in Postgres.',
    } as never;
    const backendLog = [
      { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=external_api,crud,deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=external_api' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=crud' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=external_api,crud,deployment_render reference_patterns=none design_system=none' },
      { tool: 'create_instance', result: 'Instance ready: https://example.onrender.com' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: webhook create - all 2 steps passed.' },
    ];

    expect(engineeringCompletionGate(30, backendLog, backendTask)).toContain('verify_db_state');
    expect(engineeringCompletionGate(30, [
      ...backendLog,
      { tool: 'verify_db_state', result: 'DB STATE PASS: "webhook row" - 1 row(s) matched.' },
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 1 table(s), 1 route(s)).' },
      { tool: 'create_report', result: 'Report created: "Webhook final report"' },
    ], backendTask)).toBeNull();
  });

  it('completion gate treats zero-blocker design critique scores as clean and still blocks explicit blockers', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    const landingTask = {
      id: 'task-landing',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Build frontend landing page',
      description: 'Create a user-facing landing page for the product.',
    } as never;
    const landingLog = [
      { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
      { tool: 'match_design_system', result: 'DESIGN_SYSTEM_MATCH_EVIDENCE selected=linear-app' },
      { tool: 'get_design_system', result: 'DESIGN_SYSTEM_EVIDENCE name=linear-app' },
      { tool: 'match_reference_repos', result: 'REFERENCE_MATCH_EVIDENCE selected=shadcn-dashboard-patterns' },
      { tool: 'get_reference_repo_patterns', result: 'REFERENCE_PATTERN_EVIDENCE id=shadcn-dashboard-patterns repo=shadcn-ui/ui' },
      { tool: 'retrieve_component_examples', result: 'COMPONENT_EXAMPLE_EVIDENCE count=2 references=shadcn-dashboard-patterns' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=deployment_render reference_patterns=shadcn-dashboard-patterns design_system=linear-app' },
      { tool: 'create_instance', result: 'Instance ready: https://example.onrender.com' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: landing loads - all 1 steps passed.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: rendered UI loaded without blocking runtime errors and required visible capability controls were present.' },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
      { tool: 'design_critique', result: 'design_critique score=6/10 found 0 BLOCKER and 0 ADVISORY finding(s)' },
    ];

    try {
      expect(engineeringCompletionGate(30, [
        ...landingLog,
        { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 0 table(s), 1 route(s)).' },
        { tool: 'create_report', result: 'Report created: "Landing final report"' },
      ], landingTask)).toBeNull();
      expect(engineeringCompletionGate(30, [
        ...landingLog.slice(0, -1),
        { tool: 'design_critique', result: 'design_critique score=8/10 found 1 BLOCKER and 0 ADVISORY finding(s)\n  [BLOCKER] Accent restraint: buttons use four competing accent colors.' },
      ], landingTask)).toContain('design_critique');
    } finally {
      if (previousGeminiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousGeminiKey;
      }
    }
  });

  it('does not hard-require design_critique for narrow focused repairs when browser UI and design_audit pass', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    const repairTask = {
      id: 'task-repair-ui',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'CEO repair: Fix Vendor Compliance UI contrast',
      description: 'Use the same repo and same service. Fix unreadable buttons and dropdowns on the existing dashboard.',
    } as never;
    const repairLog = [
      { tool: 'read_codebase_map', result: 'Codebase map loaded.' },
      { tool: 'query_code_graph', result: 'CODE_GRAPH_EVIDENCE repo_sha=abc files=4 report_saved=true\nRelevant files: app/page.tsx' },
      { tool: 'match_capabilities', result: 'TASK_INTENT_EVIDENCE intent=focused_repair lane=repair reasons=repair_signal,existing_app_signal,ui_polish_signal\nPLANNING_DEPTH_EVIDENCE depth=simple_feature reasons=repair_lane,narrow_repair risks=none\nCAPABILITY_MATCH_EVIDENCE required=dashboard optional=deployment_render selected=dashboard,deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=dashboard reference_patterns=none design_system=none\nFocused repair plan: patch contrast and verify browser UI.' },
      { tool: 'github_create_commit', result: 'Committed UI contrast repair' },
      { tool: 'render_deploy', result: 'Render deploy triggered' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: dashboard opens - all 2 steps passed.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: visual_contrast=pass.' },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 0 table(s), 1 route(s)).' },
      { tool: 'create_report', result: 'Report created: "UI contrast repair final report"' },
    ];

    try {
      expect(engineeringCompletionGate(30, repairLog, repairTask)).toBeNull();
    } finally {
      if (previousGeminiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousGeminiKey;
      }
    }
  });

  it('lets computed narrow repair depth override stale mixed planning markers', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    const repairTask = {
      id: 'task-repair-stale-depth',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'CEO repair: Fix Vendor Compliance UI contrast',
      description: 'Use the same repo and same service. Fix unreadable buttons and dropdowns on the existing dashboard.',
    } as never;
    const repairLog = [
      { tool: 'read_codebase_map', result: 'Codebase map loaded.' },
      { tool: 'query_code_graph', result: 'CODE_GRAPH_EVIDENCE repo_sha=abc files=4 report_saved=true\nRelevant files: app/page.tsx' },
      { tool: 'match_capabilities', result: 'TASK_INTENT_EVIDENCE intent=focused_repair lane=repair reasons=repair_signal,existing_app_signal,ui_polish_signal\nPLANNING_DEPTH_EVIDENCE depth=mixed_complex_app reasons=stale_marker risks=none\nCAPABILITY_MATCH_EVIDENCE required=dashboard optional=deployment_render selected=dashboard,deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=dashboard reference_patterns=none design_system=none\nFocused repair plan: patch contrast and verify browser UI.' },
      { tool: 'github_create_commit', result: 'Committed UI contrast repair' },
      { tool: 'render_deploy', result: 'Render deploy triggered' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: dashboard opens - all 2 steps passed.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: visual_contrast=pass.' },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 0 table(s), 1 route(s)).' },
      { tool: 'create_report', result: 'Report created: "UI contrast repair final report"' },
    ];

    try {
      expect(engineeringCompletionGate(30, repairLog, repairTask)).toBeNull();
    } finally {
      if (previousGeminiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousGeminiKey;
      }
    }
  });

  it('completion gate requires real browser UI evidence for user-facing apps', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const uiTask = {
      id: 'task-ui',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Build vendor compliance portal',
      description: 'User-facing portal where vendors onboard, upload documents, admins approve records, and teams see a dashboard.',
    } as never;
    const uiLog = [
      ...vendorPortalPlanningLog,
      { tool: 'github_fork_skeleton', result: 'Forked Next.js skeleton' },
      { tool: 'github_create_commit', result: 'Committed changes' },
      { tool: 'render_deploy', result: 'Render deploy triggered' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: vendor flow - all 5 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: "vendor row" - 1 row(s) matched.' },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
    ];

    expect(engineeringCompletionGate(30, uiLog, uiTask)).toContain('verify_browser_ui');
    expect(engineeringCompletionGate(30, [
      ...uiLog,
      { tool: 'verify_browser_ui', result: 'BROWSER UI FAIL: missing_buttons=record|upload|save.*document' },
    ], uiTask)).toContain('verify_browser_ui');
    expect(engineeringCompletionGate(30, [
      ...uiLog,
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: rendered UI loaded without blocking runtime errors and required visible capability controls were present.' },
      { tool: 'verify_interaction_contract', result: withAcceptanceProof('INTERACTION_PROOF_EVIDENCE passed=3 failed=0 expected=3\nCRITICAL_FLOW_PROOF kind=auth_session passed=true interaction=signup\nCRITICAL_FLOW_PROOF kind=upload_file passed=true interaction=upload_document\nCRITICAL_FLOW_PROOF kind=crm_record passed=true interaction=approve_record\nINTERACTION PROOF PASS: 3 interaction(s) passed.\npassed=signup, upload document, approve record', 'auth_session,upload_document,approve_record') },
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 1 table(s), 1 route(s)).' },
      { tool: 'create_report', result: 'Report created: "Vendor portal final report"' },
      ...completedLaneOutputs(),
    ], uiTask)).toBeNull();
  });

  it('completion gate requires interaction proof when frontend plan emits interaction contracts', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const uiTask = {
      id: 'task-ui-interactions',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Build booking scheduling app',
      description: 'User-facing booking app where customers reserve slots and admins see a dashboard.',
    } as never;
    const verifiedLog = [
      ...bookingPlanningLog.map((entry) => entry.tool === 'compose_frontend_plan'
        ? {
            ...entry,
            result: `${entry.result}\nINTERACTION_CONTRACT_EVIDENCE count=1 db_writes=bookings`,
          }
        : entry),
      { tool: 'github_fork_skeleton', result: 'Forked Next.js skeleton' },
      { tool: 'github_create_commit', result: 'Committed changes' },
      { tool: 'render_deploy', result: 'Render deploy triggered' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: booking flow - all 4 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: "booking row" - 1 row(s) matched.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: rendered UI loaded without blocking runtime errors and required visible capability controls were present.' },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
    ];

    expect(engineeringCompletionGate(30, verifiedLog, uiTask)).toContain('verify_interaction_contract');
    expect(engineeringCompletionGate(30, [
      ...verifiedLog,
      { tool: 'verify_interaction_contract', result: 'INTERACTION_PROOF_EVIDENCE passed=0 failed=1\nINTERACTION PROOF FAIL: missing UI readback' },
    ], uiTask)).toContain('verify_interaction_contract');
    const twoContractLog = verifiedLog.map((entry) => entry.tool === 'compose_frontend_plan'
      ? { ...entry, result: String(entry.result).replace('INTERACTION_CONTRACT_EVIDENCE count=1', 'INTERACTION_CONTRACT_EVIDENCE count=2') }
      : entry);
    expect(engineeringCompletionGate(30, [
      ...twoContractLog,
      { tool: 'verify_interaction_contract', result: 'INTERACTION_PROOF_EVIDENCE passed=1 failed=0\nINTERACTION PROOF PASS: 1 interaction(s) passed.' },
    ], uiTask)).toContain('only proved 1');
    expect(engineeringCompletionGate(30, [
      ...verifiedLog,
      {
        tool: 'verify_interaction_contract',
        result: [
          'INTERACTION_PROOF_EVIDENCE passed=2 failed=0 expected=2',
          'ACCEPTANCE_PROOF_EVIDENCE passed=2 failed=0 contract_flows=2',
          'AUTH_ISOLATION_PROOF_EVIDENCE passed=1 failed=0 checks=1',
          'CONTRACT_FLOW_PROOF id=auth_session passed=true interaction=signup',
          'CONTRACT_FLOW_PROOF id=auth_session passed=true interaction=signup_again',
          'INTERACTION PROOF PASS: 2 interaction(s) passed.',
        ].join('\n'),
      },
    ], uiTask)).toContain('exact Product Build Contract flow ids');
    expect(engineeringCompletionGate(30, [
      ...verifiedLog,
      { tool: 'verify_interaction_contract', result: withAcceptanceProof('INTERACTION_PROOF_EVIDENCE passed=2 failed=0\nCRITICAL_FLOW_PROOF kind=auth_session passed=true interaction=signup\nCRITICAL_FLOW_PROOF kind=booking_reservation passed=true interaction=reserve_slot\nINTERACTION PROOF PASS: 2 interaction(s) passed.\npassed=signup, reserve slot', 'auth_session,booking_reservation') },
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 1 table(s), 1 route(s)).' },
      { tool: 'create_report', result: 'Report created: "Booking final report"' },
      ...completedLaneOutputs(),
    ], uiTask)).toBeNull();
  });

  it('completion gate derives critical interaction requirements even when the frontend plan forgot contracts', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const uiTask = {
      id: 'task-derived-critical-flow',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Build booking scheduling app',
      description: 'User-facing booking app where customers sign up, reserve slots, and admins see booking rows.',
    } as never;
    const log = [
      ...bookingPlanningLog,
      { tool: 'github_fork_skeleton', result: 'Forked Next.js skeleton' },
      { tool: 'github_create_commit', result: 'Committed changes' },
      { tool: 'render_deploy', result: 'Render deploy triggered' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: signup and booking flow - all 6 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: "user and booking rows" - 2 row(s) matched.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: booking UI loaded and required buttons were present.' },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
    ];

    expect(engineeringCompletionGate(30, log, uiTask)).toContain('verify_interaction_contract');
    expect(engineeringCompletionGate(30, [
      ...log,
      { tool: 'verify_interaction_contract', result: withAcceptanceProof('INTERACTION_PROOF_EVIDENCE passed=2 failed=0 expected=2\nCRITICAL_FLOW_PROOF kind=auth_session passed=true interaction=signup\nCRITICAL_FLOW_PROOF kind=booking_reservation passed=true interaction=reserve_slot\nINTERACTION PROOF PASS: 2 interaction(s) passed.\npassed=signup, reserve slot', 'auth_session,booking_reservation') },
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 1 table(s), 1 route(s)).' },
      { tool: 'create_report', result: 'Report created: "Booking final report"' },
      ...completedLaneOutputs(),
    ], uiTask)).toBeNull();
  });

  it('completion gate treats required-only capabilities as critical-flow signals', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const uiTask = {
      id: 'task-required-only-critical-flow',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Build member portal',
      description: 'User-facing member portal. The detailed feature mix is present only in capability planning evidence.',
    } as never;
    const log = [
      { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE required=auth,booking,crud,dashboard,deployment_render selected=deployment_render optional=none' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=auth' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=booking' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=crud' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render' },
      { tool: 'match_design_system', result: 'DESIGN_SYSTEM_MATCH_EVIDENCE selected=linear-app' },
      { tool: 'get_design_system', result: 'DESIGN_SYSTEM_EVIDENCE name=linear-app' },
      { tool: 'match_reference_repos', result: 'REFERENCE_MATCH_EVIDENCE selected=calcom-booking-patterns,radix-accessibility-primitives' },
      { tool: 'get_reference_repo_patterns', result: 'REFERENCE_PATTERN_EVIDENCE id=calcom-booking-patterns repo=calcom/cal.com' },
      { tool: 'get_reference_repo_patterns', result: 'REFERENCE_PATTERN_EVIDENCE id=radix-accessibility-primitives repo=radix-ui/primitives' },
      { tool: 'retrieve_component_examples', result: 'COMPONENT_EXAMPLE_EVIDENCE count=2 references=calcom-booking-patterns,radix-accessibility-primitives' },
      { tool: 'compose_frontend_plan', result: 'FRONTEND_PLAN_EVIDENCE ui_type=dashboard pattern_ids=dashboard ui_refs=radix-accessibility-primitives pages=/=dashboard required_text_count=3 required_buttons_count=2 form_checks_count=1' },
      { tool: 'compose_app_architecture', result: withProductContractEvidence('ARCHITECTURE_PLAN_EVIDENCE capabilities=deployment_render reference_patterns=calcom-booking-patterns,radix-accessibility-primitives design_system=linear-app', 'auth_session,booking_reservation') },
      { tool: 'github_fork_skeleton', result: 'Forked Next.js skeleton' },
      { tool: 'github_create_commit', result: 'Committed changes' },
      { tool: 'render_deploy', result: 'Render deploy triggered' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: customer portal flow - all 6 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: "account and booking rows" - 2 row(s) matched.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: customer portal UI loaded and controls were present.' },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
    ];

    expect(engineeringCompletionGate(30, log, uiTask)).toContain('verify_interaction_contract');
    expect(engineeringCompletionGate(30, [
      ...log,
      { tool: 'verify_interaction_contract', result: withAcceptanceProof('INTERACTION_PROOF_EVIDENCE passed=2 failed=0 expected=2\nCRITICAL_FLOW_PROOF kind=auth_session passed=true interaction=signup\nCRITICAL_FLOW_PROOF kind=booking_reservation passed=true interaction=reserve_slot\nINTERACTION PROOF PASS: 2 interaction(s) passed.\npassed=signup, reserve slot', 'auth_session,booking_reservation') },
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 1 table(s), 1 route(s)).' },
      { tool: 'create_report', result: 'Report created: "Customer portal final report"' },
      ...completedLaneOutputs(),
    ], uiTask)).toBeNull();
  });

  it('completion gate requires final report after the latest verification evidence', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    const uiTask = {
      id: 'task-ui-report',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Build vendor compliance portal',
      description: 'User-facing portal where vendors onboard, upload documents, admins approve records, and teams see a dashboard.',
    } as never;
    const verifiedLog = [
      ...vendorPortalPlanningLog,
      { tool: 'github_fork_skeleton', result: 'Forked Next.js skeleton' },
      { tool: 'github_create_commit', result: 'Committed changes' },
      { tool: 'render_deploy', result: 'Render deploy triggered' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: vendor flow - all 5 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: "vendor row" - 1 row(s) matched.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: rendered UI loaded without blocking runtime errors and required visible capability controls were present.' },
      { tool: 'verify_interaction_contract', result: withAcceptanceProof('INTERACTION_PROOF_EVIDENCE passed=3 failed=0 expected=3\nCRITICAL_FLOW_PROOF kind=auth_session passed=true interaction=signup\nCRITICAL_FLOW_PROOF kind=upload_file passed=true interaction=upload_document\nCRITICAL_FLOW_PROOF kind=crm_record passed=true interaction=approve_record\nINTERACTION PROOF PASS: 3 interaction(s) passed.\npassed=signup, upload document, approve record', 'auth_session,upload_document,approve_record') },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
    ];

    try {
      expect(engineeringCompletionGate(30, [
        ...verifiedLog,
        { tool: 'design_critique', result: 'design_critique CLEAN - score=9/10, 0 blockers' },
      ], uiTask)).toContain('write_codebase_map');
      expect(engineeringCompletionGate(30, [
        ...verifiedLog,
        { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 1 table(s), 1 route(s)).' },
        { tool: 'create_report', result: 'Report created: "Vendor portal final report"' },
        { tool: 'design_critique', result: 'design_critique CLEAN - score=9/10, 0 blockers' },
      ], uiTask)).toContain('`create_report` ran before');
      expect(engineeringCompletionGate(30, [
        ...verifiedLog,
        { tool: 'design_critique', result: 'design_critique CLEAN - score=9/10, 0 blockers' },
        { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 1 table(s), 1 route(s)).' },
        { tool: 'create_report', result: 'Report created: "Vendor portal final report"' },
        ...completedLaneOutputs(),
      ], uiTask)).toBeNull();
    } finally {
      if (previousGeminiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousGeminiKey;
      }
    }
  });

  it('completion gate lets fast UI repairs finish without canary-grade report or critique ceremony', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const fastRepairTask = {
      id: 'task-fast-ui',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Fix button copy',
      description: 'Small existing UI repair: change the primary CTA button label and spacing.',
    } as never;
    const fastRepairLog = [
      { tool: 'github_create_commit', result: 'Committed targeted UI copy fix' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: primary CTA button label and spacing are visible on the deployed page.' },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
    ];

    expect(engineeringCompletionGate(30, fastRepairLog, fastRepairTask)).toBeNull();
  });

  it('completion gate keeps canary tasks on strict report and critique requirements', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    const canaryTask = {
      id: 'task-canary',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'CANARY local-service-booking strict replay',
      description: 'World-class canary run with final replay and report.',
    } as never;
    const canaryLog = [
      ...bookingPlanningLog,
      { tool: 'github_fork_skeleton', result: 'Forked Next.js skeleton' },
      { tool: 'github_create_commit', result: 'Committed booking app' },
      { tool: 'render_deploy', result: 'Render deploy triggered' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: booking flow - all 4 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: "booking row" - 1 row(s) matched.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: booking UI loaded and required buttons were present.' },
      { tool: 'verify_interaction_contract', result: withAcceptanceProof('INTERACTION_PROOF_EVIDENCE passed=2 failed=0 expected=2\nCRITICAL_FLOW_PROOF kind=auth_session passed=true interaction=signup\nCRITICAL_FLOW_PROOF kind=booking_reservation passed=true interaction=reserve_slot\nINTERACTION PROOF PASS: 2 interaction(s) passed.\npassed=signup, reserve slot', 'auth_session,booking_reservation') },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
    ];

    try {
      expect(engineeringCompletionGate(30, canaryLog, canaryTask)).toContain('design_critique');
      expect(engineeringCompletionGate(30, [
        ...canaryLog,
        { tool: 'design_critique', result: 'design_critique CLEAN - score=9/10, 0 blockers' },
      ], canaryTask)).toContain('write_codebase_map');
    } finally {
      if (previousGeminiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousGeminiKey;
      }
    }
  });

  it('blocks completion when a bounded Engineering lane reports a blocker', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const task = {
      id: 'task-lane-blocked',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Fix failed completion gate',
      description: 'Repair a failed verifier surface.',
    } as never;

    expect(engineeringCompletionGate(30, [
      {
        tool: 'record_engineering_lane_output',
        result: 'ENGINEERING_LANE_OUTPUT role=qa status=blocked cannot_complete_task=true sections=project_create evidence=CONTRACT_FLOW_PROOF blockers=1\nENGINEERING_LANE_OUTPUT_JSON {"role":"qa","status":"blocked","contract_sections":["project_create"],"evidence_markers":["CONTRACT_FLOW_PROOF"],"files_touched":[],"blockers":["missing field proof"],"cannot_complete_task":true}',
      },
    ], task)).toContain('bounded Engineering lane output is blocked');
  });

  it('does not let completed lane output replace exact Product Build Contract proof', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const uiTask = {
      id: 'task-lane-not-proof',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Build booking scheduling app',
      description: 'User-facing booking app where customers sign up and reserve slots.',
    } as never;
    const verifiedLog = [
      ...bookingPlanningLog,
      { tool: 'github_fork_skeleton', result: 'Forked Next.js skeleton' },
      { tool: 'github_create_commit', result: 'Committed booking app' },
      { tool: 'render_deploy', result: 'Render deploy triggered' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: booking flow - all 4 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: "booking row" - 1 row(s) matched.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: booking UI loaded and required buttons were present.' },
      {
        tool: 'record_engineering_lane_output',
        result: 'ENGINEERING_LANE_OUTPUT role=qa status=completed cannot_complete_task=true sections=auth_session,booking_reservation evidence=CONTRACT_FLOW_PROOF blockers=0\nENGINEERING_LANE_OUTPUT_JSON {"role":"qa","status":"completed","contract_sections":["auth_session","booking_reservation"],"evidence_markers":["CONTRACT_FLOW_PROOF"],"files_touched":[],"blockers":[],"cannot_complete_task":true}',
      },
      ...completedLaneOutputs(['planner', 'domain', 'frontend', 'backend', 'deploy', 'reviewer']),
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
    ];

    expect(engineeringCompletionGate(30, verifiedLog, uiTask)).toContain('ACCEPTANCE_PROOF_EVIDENCE');
  });

  it('requires completed lane output for otherwise complete app-build tasks', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const uiTask = {
      id: 'task-lane-required',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Build booking scheduling app',
      description: 'User-facing booking app where customers sign up and reserve slots.',
    } as never;
    const completeWithoutLanes = [
      ...bookingPlanningLog,
      { tool: 'github_fork_skeleton', result: 'Forked Next.js skeleton' },
      { tool: 'github_create_commit', result: 'Committed booking app' },
      { tool: 'render_deploy', result: 'Render deploy triggered' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: booking flow - all 4 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: "booking row" - 1 row(s) matched.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: booking UI loaded and required buttons were present.' },
      { tool: 'verify_interaction_contract', result: withAcceptanceProof('INTERACTION_PROOF_EVIDENCE passed=2 failed=0\nCRITICAL_FLOW_PROOF kind=auth_session passed=true interaction=signup\nCRITICAL_FLOW_PROOF kind=booking_reservation passed=true interaction=reserve_slot\nINTERACTION PROOF PASS: 2 interaction(s) passed.\npassed=signup, reserve slot', 'auth_session,booking_reservation') },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 1 table(s), 1 route(s)).' },
      { tool: 'create_report', result: 'Report created: "Booking final report"' },
    ];

    expect(engineeringCompletionGate(30, completeWithoutLanes, uiTask)).toContain('missing completed bounded Engineering lane output');
    expect(engineeringCompletionGate(30, [
      ...completeWithoutLanes,
      ...completedLaneOutputs(),
    ], uiTask)).toBeNull();
  });

  it('uses architecture-emitted lane requirements and rejects weak or stale lane outputs', async () => {
    const { engineeringCompletionGate } = await import('./agent-factory');
    const uiTask = {
      id: 'task-lane-requirements',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Build booking scheduling app',
      description: 'User-facing booking app where customers sign up and reserve slots.',
    } as never;
    const planningWithRequirements = bookingPlanningLog.map((entry) => entry.tool === 'compose_app_architecture'
      ? {
          ...entry,
          result: [
            entry.result,
            'ENGINEERING_LANE_REQUIREMENTS roles=qa,deploy source=product_build_contract',
            'ENGINEERING_LANE_PACKET role=qa flows=auth_session,booking_reservation entities=booking required_flow_ids=auth_session,booking_reservation',
            'ENGINEERING_LANE_PACKET role=deploy flows=auth_session,booking_reservation entities=booking required_flow_ids=auth_session,booking_reservation',
          ].join('\n'),
        }
      : entry);
    const verifiedWithoutLanes = [
      ...planningWithRequirements,
      { tool: 'github_fork_skeleton', result: 'Forked Next.js skeleton' },
      { tool: 'github_create_commit', result: 'Committed booking app' },
      { tool: 'render_deploy', result: 'Render deploy triggered' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'check_url_health', result: 'https://example.onrender.com is UP - HTTP 200' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: booking flow - all 4 steps passed.' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: "booking row" - 1 row(s) matched.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: booking UI loaded and required buttons were present.' },
      { tool: 'verify_interaction_contract', result: withAcceptanceProof('INTERACTION_PROOF_EVIDENCE passed=2 failed=0\nCRITICAL_FLOW_PROOF kind=auth_session passed=true interaction=signup\nCRITICAL_FLOW_PROOF kind=booking_reservation passed=true interaction=reserve_slot\nINTERACTION PROOF PASS: 2 interaction(s) passed.\npassed=signup, reserve slot', 'auth_session,booking_reservation') },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
      { tool: 'write_codebase_map', result: 'Codebase map saved (1 feature(s) tracked, 1 table(s), 1 route(s)).' },
      { tool: 'create_report', result: 'Report created: "Booking final report"' },
    ];
    const weakQa = {
      tool: 'record_engineering_lane_output',
      result: [
        'ENGINEERING_LANE_OUTPUT role=qa status=completed cannot_complete_task=true sections=none evidence=none blockers=0',
        'ENGINEERING_LANE_OUTPUT_JSON {"role":"qa","status":"completed","contract_sections":[],"evidence_markers":[],"files_touched":[],"blockers":[],"cannot_complete_task":true}',
      ].join('\n'),
    };

    expect(engineeringCompletionGate(30, verifiedWithoutLanes, uiTask)).toContain('qa, deploy');
    expect(engineeringCompletionGate(30, [
      ...planningWithRequirements,
      ...completedLaneOutputs(['qa', 'deploy']),
      ...verifiedWithoutLanes.slice(planningWithRequirements.length),
    ], uiTask)).toContain('stale');
    expect(engineeringCompletionGate(30, [
      ...verifiedWithoutLanes,
      weakQa,
      ...completedLaneOutputs(['deploy']),
    ], uiTask)).toContain('weak');
    expect(engineeringCompletionGate(30, [
      ...verifiedWithoutLanes,
      ...completedLaneOutputs(['qa', 'deploy']),
    ], uiTask)).toBeNull();
  });

  it('records status=blocked without blockers as a sticky lane blocker', async () => {
    const { handleEngineeringTool } = await import('./tools/engineering.tools');
    const { engineeringCompletionGate } = await import('./agent-factory');
    const task = {
      id: 'task-invalid-lane-block',
      company_id: 'company-1',
      tag: 'engineering',
      title: 'Fix failed gate',
      description: 'Repair task.',
    } as never;
    const result = await handleEngineeringTool('record_engineering_lane_output', {
      role: 'qa',
      status: 'blocked',
    }, task);

    expect(result).toContain('ENGINEERING_LANE_OUTPUT_JSON');
    expect(result).toContain('requires at least one concrete blocker');
    expect(engineeringCompletionGate(30, [
      { tool: 'record_engineering_lane_output', result },
    ], task)).toContain('bounded Engineering lane output is blocked');
  });
});
