import { describe, expect, it, vi, beforeEach } from 'vitest';

// Default mock: no execution log for the task — used by unit-only tests like
// extractRequestedBrowserPaths. Per-test overrides below replace this for the
// deterministic-verifier scenarios.
const mockSelectChain = (rows: unknown[] = []) => {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => rows,
  };
  return chain;
};

vi.mock('@/lib/db', () => ({
  db: { select: () => mockSelectChain([]) },
  reports: {},
  companies: {},
  taskExecutions: { task_id: {}, created_at: {}, execution_log: {} },
}));

vi.mock('@/lib/services/task.service', () => ({}));
vi.mock('@/lib/services/event.service', () => ({}));
vi.mock('@/lib/agents/ceo/ceo.rolling-plan', () => ({
  releaseNextRollingPlanBatch: vi.fn(async () => ({
    released: 0,
    skipped: 0,
    remaining: 0,
    activeCount: 0,
    limit: 5,
  })),
}));

describe('verification requested path extraction', () => {
  it('extracts explicit app paths from task text', async () => {
    const { extractRequestedBrowserPaths } = await import('@/lib/services/verification.service');

    expect(extractRequestedBrowserPaths({
      title: 'Fix: ROI Calculator not visible on live site',
      description: 'The calculator route at /calculator returns 404 after deploy.',
    })).toEqual(['/calculator']);
  });

  it('keeps same-domain URLs and ignores external URLs', async () => {
    const { extractRequestedBrowserPaths } = await import('@/lib/services/verification.service');

    expect(extractRequestedBrowserPaths({
      title: 'Fix pricing route',
      description: 'Check https://acme.baljia.app/pricing and ignore https://docs.example.com/pricing.',
    }, 'acme.baljia.app')).toEqual(['/pricing']);
  });

  it('ignores route-like text inside explicit negative instructions', async () => {
    const { extractRequestedBrowserPaths } = await import('@/lib/services/verification.service');

    expect(extractRequestedBrowserPaths({
      title: 'CEO closeout: Strict replay verification',
      description: [
        'Do NOT run or block on a generic /api/auth/register, /login, or verify_interaction_contract auth/register proof.',
        'Do run scenario-specific verification including /api/health.',
      ].join('\n'),
    })).toEqual(['/api/health']);
  });
});

describe('verifyAndUpdate execution persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('persists successful verification evidence to the latest task execution', async () => {
    const task = {
      id: 'task-1',
      company_id: 'company-1',
      title: 'No-op verification task',
      description: 'Task that does not require additional verification.',
      tag: 'research',
      status: 'verifying',
      failure_class: null,
      turn_count: 1,
      max_turns: 10,
      verification_level: 'none',
    };
    const latestExecution = { id: 'execution-1' };
    const selectChain = {
      from: () => selectChain,
      where: () => selectChain,
      orderBy: () => selectChain,
      limit: async () => [latestExecution],
    };
    const updateWhere = vi.fn(async () => undefined);
    let persistedUpdate: { completed_at?: unknown } | undefined;
    const updateSet = vi.fn((value: { completed_at?: unknown }) => {
      persistedUpdate = value;
      return { where: updateWhere };
    });
    const update = vi.fn(() => ({ set: updateSet }));
    const finalizeTask = vi.fn(async () => ({ ...task, status: 'completed' }));
    const updateTask = vi.fn();
    const emit = vi.fn();

    vi.doMock('@/lib/db', () => ({
      db: {
        select: () => selectChain,
        update,
      },
      reports: {},
      companies: {},
      taskExecutions: {
        id: {},
        task_id: {},
        created_at: {},
        status: {},
        completed_at: {},
        verification_evidence: {},
        error_summary: {},
      },
    }));
    vi.doMock('@/lib/services/task.service', () => ({
      getTask: vi.fn(async () => task),
      finalizeTask,
      updateTask,
    }));
    vi.doMock('@/lib/services/event.service', () => ({ emit }));
    vi.doMock('@/lib/agents/ceo/ceo.rolling-plan', () => ({
      releaseNextRollingPlanBatch: vi.fn(async () => ({
        released: 0,
        skipped: 0,
        remaining: 0,
        activeCount: 0,
        limit: 5,
      })),
    }));

    const { verifyAndUpdate } = await import('@/lib/services/verification.service');
    const result = await verifyAndUpdate('task-1');

    expect(result.passed).toBe(true);
    expect(finalizeTask).toHaveBeenCalledWith('task-1', true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(persistedUpdate).toEqual(expect.objectContaining({
      status: 'completed',
      error_summary: null,
      verification_evidence: expect.objectContaining({
        level: 'none',
        passed: true,
      }),
    }));
    expect(persistedUpdate?.completed_at).toBeInstanceOf(Date);
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(updateTask).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('company-1', 'task_completed', expect.objectContaining({
      task_id: 'task-1',
      verification_passed: true,
    }));
  });
});

describe('deterministic verifier — user_journey_evidence (new hard gate)', () => {
  // Builds a task + an execution_log array. Mocks the db.select chain to
  // return that log so verifyDeterministic sees the agent's tool calls.
  function setupTask(toolCalls: Array<{ tool: string; result: string }>) {
    const exec = { execution_log: toolCalls };
    return vi.doMock('@/lib/db', () => ({
      db: { select: () => mockSelectChain([exec]) },
      reports: {},
      companies: {},
      taskExecutions: { task_id: {}, created_at: {}, execution_log: {} },
    }));
  }

  const baseTask = {
    id: 't-1', company_id: 'c-1', tag: 'engineering',
    title: 'Build it', description: 'desc',
    turn_count: 5, max_turns: 200,
    status: 'in_progress', failure_class: null,
  };
  function withProductContractEvidence(result: string, flowIds = 'primary_feature'): string {
    const count = flowIds.split(',').filter(Boolean).length;
    const ids = flowIds.split(',').filter(Boolean);
    const contract = {
      version: 1,
      lane: 'standard',
      source: 'assumed',
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
        authRequired: false,
      })),
      entities: [],
      apiActions: [],
      acceptance: {
        ctaRules: [],
        authBaseline: false,
        userIsolation: false,
        dbPersistence: true,
        noMockSuccess: true,
        publicDataLeakCheck: false,
      },
    };
    return [
      result,
      `BUILD_BRIEF_EVIDENCE version=1 lane=standard task_intent=new_app_build planning_depth=standard_app primary_verb=manage_records assumptions=2 non_goals=2 mvp_features=${count} domains=none risks=none`,
      `PRODUCT_BUILD_CONTRACT_EVIDENCE version=1 lane=standard source=assumed screens=2 flows=${count} entities=1 api_actions=1 auth_baseline=false user_isolation=false flow_ids=${flowIds}`,
      `PRODUCT_BUILD_CONTRACT_JSON ${JSON.stringify(contract)}`,
      'PRODUCT_BUILD_CONTRACT_ARTIFACT path=measurement-output/product-build-contracts/t-1.json',
    ].join('\n');
  }
  function withAcceptanceProof(result: string, flowIds = 'primary_feature'): string {
    const ids = flowIds.split(',').filter(Boolean);
    return [
      result,
      `ACCEPTANCE_PROOF_EVIDENCE passed=${ids.length} failed=0 contract_flows=${ids.length}`,
      ...ids.map((id) => `CONTRACT_FLOW_PROOF id=${id} passed=true interaction=${id}`),
    ].join('\n');
  }
  const capabilityCalls = [
    { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=crud\nCapability matches:\n1. crud score=10' },
    { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=crud\nCapability: crud - CRUD And Data Management' },
    { tool: 'compose_app_architecture', result: withProductContractEvidence('ARCHITECTURE_PLAN_EVIDENCE capabilities=crud reference_patterns=shadcn-dashboard-patterns design_system=linear-app\nCapability architecture plan:\nVerification journeys:') },
  ];
  const referenceCalls = [
    { tool: 'match_reference_repos', result: 'REFERENCE_MATCH_EVIDENCE selected=shadcn-dashboard-patterns\nReference repo matches (patterns only, do not copy whole apps):\n1. shadcn-dashboard-patterns score=10' },
    { tool: 'get_reference_repo_patterns', result: 'REFERENCE_PATTERN_EVIDENCE id=shadcn-dashboard-patterns repo=shadcn-ui/ui\nReference pattern: shadcn-dashboard-patterns - shadcn dashboard patterns' },
    { tool: 'retrieve_component_examples', result: 'COMPONENT_EXAMPLE_EVIDENCE count=1 references=shadcn-dashboard-patterns\nRetrieved component examples:\n1. Dashboard shell with sidebar navigation' },
  ];

  it('FAILS when agent calls deploy + check_url_health but skips verify_user_journey', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: '✅ https://x.com is UP — HTTP 200 in 50ms' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({ ...baseTask, verification_level: 'deterministic' } as never);
    const journey = result.checks.find((c) => c.name === 'user_journey_evidence');
    expect(journey?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('FAILS build-shaped tasks that skip capability planning', async () => {
    vi.resetModules();
    setupTask([
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "register flow" - all 3 steps passed.' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({ ...baseTask, verification_level: 'deterministic' } as never);
    const capabilityPlan = result.checks.find((c) => c.name === 'capability_plan_evidence');
    expect(capabilityPlan?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('PASSES capability evidence when successful planner output contains failure-mode guidance words', async () => {
    vi.resetModules();
    setupTask([
      { tool: 'match_capabilities', result: 'Capability matches:\n1. payments_stripe score=10\nverify: missing Stripe env fails clearly' },
      { tool: 'get_capability_pack', result: 'Capability: payments_stripe - Stripe Payments\nCommon failures: STRIPE_SECRET_KEY not configured at runtime; missing webhook secret.' },
      { tool: 'compose_app_architecture', result: 'Capability architecture plan:\nHybrid decisions: no reference pattern ids supplied yet; call match_reference_repos for UI work.' },
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "billing flow" - all 3 steps passed.' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({ ...baseTask, verification_level: 'deterministic' } as never);
    const capabilityPlan = result.checks.find((c) => c.name === 'capability_plan_evidence');
    expect(capabilityPlan?.passed).toBe(true);
  });

  it('marks missing design_critique as non-blocking for narrow UI repairs', async () => {
    vi.resetModules();
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    setupTask([
      { tool: 'match_capabilities', result: 'TASK_INTENT_EVIDENCE intent=focused_repair lane=repair reasons=repair_signal,ui_polish_signal\nPLANNING_DEPTH_EVIDENCE depth=simple_feature reasons=repair_lane,narrow_repair risks=none\nCAPABILITY_MATCH_EVIDENCE required=dashboard optional=deployment_render selected=dashboard,deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard\nCapability: dashboard' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=dashboard reference_patterns=none design_system=none' },
      { tool: 'render_deploy', result: 'Render deploy triggered' },
      { tool: 'check_url_health', result: 'https://x.onrender.com is UP - HTTP 200' },
      { tool: 'verify_user_journey', result: 'JOURNEY PASS: dashboard opens - all 2 steps passed.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: visual_contrast=pass.' },
      { tool: 'static_code_scan', result: 'STATIC CODE SCAN PASS high=0' },
      { tool: 'review_pushed_code', result: 'CODE REVIEW PASS high=0' },
      { tool: 'render_get_logs', result: 'Runtime logs clean\nReady in 1s' },
      { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings' },
    ]);

    try {
      const { verifyTask } = await import('@/lib/services/verification.service');
      const result = await verifyTask({
        ...baseTask,
        title: 'CEO repair: Fix Vendor Compliance UI contrast',
        description: 'Use the same repo and same service. Fix unreadable buttons and dropdowns on the existing dashboard.',
        verification_level: 'deterministic',
      } as never);
      const critique = result.checks.find((c) => c.name === 'design_critique_clean');

      expect(critique?.passed).toBe(true);
      expect(critique?.detail).toMatch(/not required/i);
      expect(critique?.detail).not.toMatch(/missing design_critique/i);
    } finally {
      if (previousGeminiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousGeminiKey;
      }
    }
  });

  it('FAILS UI architecture tasks that skip reference retrieval', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "dashboard flow" - all 3 steps passed.' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
      { tool: 'design_audit',          result: 'design_audit CLEAN - 0 findings on https://x.com' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      ...baseTask,
      title: 'Build dashboard app',
      description: 'Create a user-facing admin dashboard.',
      verification_level: 'deterministic',
    } as never);
    const referenceEvidence = result.checks.find((c) => c.name === 'reference_pattern_evidence');
    expect(referenceEvidence?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('PASSES focused repair tasks without full reference retrieval when repair intent evidence exists', async () => {
    vi.resetModules();
    setupTask([
      { tool: 'classify_task_intent', result: 'TASK_INTENT_EVIDENCE intent=focused_repair lane=repair reasons=repair_signal,existing_app_signal,ui_polish_signal' },
      ...capabilityCalls,
      { tool: 'github_create_commit', result: 'Committed focused UI contrast repair' },
      { tool: 'render_deploy',        result: 'Render deploy triggered for service srv-1' },
      { tool: 'check_url_health',     result: 'https://app.onrender.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',  result: 'JOURNEY PASS: "vendor flow" - all 5 steps passed.' },
      { tool: 'verify_browser_ui',    result: 'BROWSER UI PASS: rendered UI loaded without blocking runtime errors and required visible capability controls were present.' },
      { tool: 'verify_db_state',      result: 'DB STATE PASS: "vendor row" - 1 row(s) matched.' },
      { tool: 'static_code_scan',     result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'review_pushed_code',   result: 'CODE REVIEW PASS: Clean - no issues found.' },
      { tool: 'render_get_logs',      result: 'Logs: server started on port 10000\nready in 1.2s' },
      { tool: 'design_audit',         result: 'design_audit CLEAN - 0 findings on https://app.onrender.com' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      ...baseTask,
      source: 'founder_requested',
      title: 'CEO repair: Fix Vendor Compliance UI contrast',
      description: 'Repair the existing user-facing dashboard UI contrast in the same repo and same service. Preserve the app and verify browser UI.',
      verification_level: 'deterministic',
    } as never);
    const referenceEvidence = result.checks.find((c) => c.name === 'reference_pattern_evidence');
    expect(referenceEvidence?.passed).toBe(true);
    expect(referenceEvidence?.detail).toMatch(/Focused repair lane/);
    expect(result.passed).toBe(true);
  });

  it('PASSES focused repair capability evidence with only relevant packs loaded', async () => {
    vi.resetModules();
    setupTask([
      {
        tool: 'match_capabilities',
        result: [
          'TASK_INTENT_EVIDENCE intent=focused_repair lane=repair reasons=repair_signal,existing_app_signal,api_contract_signal',
          'CAPABILITY_MATCH_EVIDENCE required=deployment_render,rag_search,auth,crud,admin_workflow,dashboard,payments_stripe,search,uploads_storage selected=deployment_render,rag_search,auth,crud,admin_workflow,dashboard,payments_stripe,search,uploads_storage',
        ].join('\n'),
      },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=rag_search\nCapability: rag_search - RAG And Semantic Search' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=crud\nCapability: crud - CRUD And Data Management' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=rag_search,crud,deployment_render reference_patterns=none design_system=none\nCapability architecture plan:\nNarrow repair plan for document-search route and billing-status route.' },
      { tool: 'github_create_commit', result: 'Committed focused DB contract repair' },
      { tool: 'render_deploy',        result: 'Render deploy triggered for service srv-1' },
      { tool: 'check_url_health',     result: 'https://app.onrender.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',  result: 'JOURNEY PASS: "documents search billing flow" - all 6 steps passed.' },
      { tool: 'verify_browser_ui',    result: 'BROWSER UI PASS: rendered UI loaded without blocking runtime errors and required visible capability controls were present.' },
      { tool: 'verify_db_state',      result: 'DB STATE PASS: "canary_document_analyses row" - 1 row(s) matched.' },
      { tool: 'verify_interaction_contract', result: 'INTERACTION_PROOF_EVIDENCE passed=4 failed=0 expected=4\nCRITICAL_FLOW_PROOF kind=auth_session passed=true interaction=signup\nCRITICAL_FLOW_PROOF kind=payment_checkout passed=true interaction=billing\nCRITICAL_FLOW_PROOF kind=upload_file passed=true interaction=upload\nCRITICAL_FLOW_PROOF kind=ai_action passed=true interaction=document_search\nINTERACTION PROOF PASS: 4 interaction(s) passed.\npassed=signup, billing, upload, document search' },
      { tool: 'static_code_scan',     result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'review_pushed_code',   result: 'CODE REVIEW PASS: Clean - no issues found.' },
      { tool: 'render_get_logs',      result: 'Logs: server started on port 10000\nready in 1.2s' },
      { tool: 'design_audit',         result: 'design_audit CLEAN - 0 findings on https://app.onrender.com' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      ...baseTask,
      source: 'system',
      title: 'CEO repair task: Fix existing canary DB contract',
      description: 'Use the same repo and same service. Repair existing app document-search and billing persistence after replay failed.',
      verification_level: 'deterministic',
    } as never);

    const capabilityPlan = result.checks.find((c) => c.name === 'capability_plan_evidence');
    expect(capabilityPlan?.passed).toBe(true);
    expect(capabilityPlan?.detail).toMatch(/Focused repair capability plan/);
    expect(result.passed).toBe(true);
  });

  it('PASSES reference evidence when UI tasks retrieve patterns and examples', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      ...referenceCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "dashboard flow" - all 3 steps passed.' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
      { tool: 'design_audit',          result: 'design_audit CLEAN - 0 findings on https://x.com' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      ...baseTask,
      title: 'Build dashboard app',
      description: 'Create a user-facing admin dashboard.',
      verification_level: 'deterministic',
    } as never);
    const referenceEvidence = result.checks.find((c) => c.name === 'reference_pattern_evidence');
    expect(referenceEvidence?.passed).toBe(true);
  });

  it('FAILS user-facing apps that skip verify_browser_ui', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      ...referenceCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "dashboard flow" - all 3 steps passed.' },
      { tool: 'verify_db_state',       result: 'DB STATE PASS: "dashboard row" - 1 row(s) matched.' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
      { tool: 'design_audit',          result: 'design_audit CLEAN - 0 findings on https://x.com' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      ...baseTask,
      title: 'Build dashboard app',
      description: 'Create a user-facing admin dashboard.',
      verification_level: 'deterministic',
    } as never);
    const browserUi = result.checks.find((c) => c.name === 'browser_ui_evidence');
    expect(browserUi?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('PASSES user-facing apps only when final verify_browser_ui passes', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      ...referenceCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "dashboard flow" - all 3 steps passed.' },
      { tool: 'verify_db_state',       result: 'DB STATE PASS: "dashboard row" - 1 row(s) matched.' },
      { tool: 'verify_browser_ui',     result: 'BROWSER UI FAIL: missing_buttons=save' },
      { tool: 'verify_browser_ui',     result: 'BROWSER UI PASS: rendered UI loaded without blocking runtime errors and required visible capability controls were present.' },
      { tool: 'verify_interaction_contract', result: withAcceptanceProof('INTERACTION_PROOF_EVIDENCE passed=1 failed=0 expected=1\nCRITICAL_FLOW_PROOF kind=generic_feature passed=true interaction=create_dashboard_record\nINTERACTION PROOF PASS: 1 interaction(s) passed.\npassed=create dashboard record') },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
      { tool: 'design_audit',          result: 'design_audit CLEAN - 0 findings on https://x.com' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      ...baseTask,
      title: 'Build dashboard app',
      description: 'Create a user-facing admin dashboard.',
      verification_level: 'deterministic',
    } as never);
    const browserUi = result.checks.find((c) => c.name === 'browser_ui_evidence');
    expect(browserUi?.passed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('FAILS app-build logs that omit architecture-required Engineering lane outputs', async () => {
    vi.resetModules();
    const laneAwareCapabilityCalls = capabilityCalls.map((entry) => entry.tool === 'compose_app_architecture'
      ? {
          ...entry,
          result: [
            entry.result,
            'ENGINEERING_LANE_REQUIREMENTS roles=qa,deploy source=product_build_contract',
            'ENGINEERING_LANE_PACKET role=qa flows=primary_feature entities=record required_flow_ids=primary_feature',
            'ENGINEERING_LANE_PACKET role=deploy flows=primary_feature entities=record required_flow_ids=primary_feature',
          ].join('\n'),
        }
      : entry);
    const baseCalls = [
      ...laneAwareCapabilityCalls,
      ...referenceCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "dashboard flow" - all 3 steps passed.' },
      { tool: 'verify_db_state',       result: 'DB STATE PASS: "dashboard row" - 1 row(s) matched.' },
      { tool: 'verify_browser_ui',     result: 'BROWSER UI PASS: rendered UI loaded without blocking runtime errors and required visible capability controls were present.' },
      { tool: 'verify_interaction_contract', result: withAcceptanceProof('INTERACTION_PROOF_EVIDENCE passed=1 failed=0 expected=1\nCRITICAL_FLOW_PROOF kind=generic_feature passed=true interaction=create_dashboard_record\nINTERACTION PROOF PASS: 1 interaction(s) passed.\npassed=create dashboard record') },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
      { tool: 'design_audit',          result: 'design_audit CLEAN - 0 findings on https://x.com' },
    ];

    setupTask(baseCalls);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const missing = await verifyTask({
      ...baseTask,
      title: 'Build dashboard app',
      description: 'Create a user-facing admin dashboard.',
      verification_level: 'deterministic',
    } as never);
    const missingLaneCheck = missing.checks.find((c) => c.name === 'engineering_lane_outputs');

    expect(missingLaneCheck?.passed).toBe(false);
    expect(missingLaneCheck?.detail).toContain('qa, deploy');
    expect(missing.passed).toBe(false);

    vi.resetModules();
    setupTask([
      ...baseCalls,
      {
        tool: 'record_engineering_lane_output',
        result: 'ENGINEERING_LANE_OUTPUT role=qa status=completed cannot_complete_task=true sections=primary_feature evidence=CONTRACT_FLOW_PROOF blockers=0\nENGINEERING_LANE_OUTPUT_JSON {"role":"qa","status":"completed","contract_sections":["primary_feature"],"evidence_markers":["CONTRACT_FLOW_PROOF"],"files_touched":[],"blockers":[],"cannot_complete_task":true}',
      },
      {
        tool: 'record_engineering_lane_output',
        result: 'ENGINEERING_LANE_OUTPUT role=deploy status=completed cannot_complete_task=true sections=render evidence=check_url_health blockers=0\nENGINEERING_LANE_OUTPUT_JSON {"role":"deploy","status":"completed","contract_sections":["render"],"evidence_markers":["check_url_health"],"files_touched":[],"blockers":[],"cannot_complete_task":true}',
      },
    ]);
    const { verifyTask: verifyTaskAgain } = await import('@/lib/services/verification.service');
    const passed = await verifyTaskAgain({
      ...baseTask,
      title: 'Build dashboard app',
      description: 'Create a user-facing admin dashboard.',
      verification_level: 'deterministic',
    } as never);
    const passedLaneCheck = passed.checks.find((c) => c.name === 'engineering_lane_outputs');

    expect(passedLaneCheck?.passed).toBe(true);
    expect(passed.passed).toBe(true);
  });

  it('FAILS when interaction proof covers fewer interactions than the frontend plan declared', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      ...referenceCalls,
      { tool: 'compose_frontend_plan', result: 'FRONTEND_PLAN_EVIDENCE ui_type=dashboard pattern_ids=dashboard\nINTERACTION_CONTRACT_EVIDENCE count=2 db_writes=records' },
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "dashboard flow" - all 3 steps passed.' },
      { tool: 'verify_db_state',       result: 'DB STATE PASS: "dashboard row" - 1 row(s) matched.' },
      { tool: 'verify_browser_ui',     result: 'BROWSER UI PASS: rendered UI loaded without blocking runtime errors and required visible capability controls were present.' },
      { tool: 'verify_interaction_contract', result: 'INTERACTION_PROOF_EVIDENCE passed=1 failed=0 expected=1\nINTERACTION PROOF PASS: 1 interaction(s) passed.' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
      { tool: 'design_audit',          result: 'design_audit CLEAN - 0 findings on https://x.com' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      ...baseTask,
      title: 'Build dashboard app',
      description: 'Create a user-facing admin dashboard.',
      verification_level: 'deterministic',
    } as never);
    const interaction = result.checks.find((c) => c.name === 'interaction_contract_evidence');
    expect(interaction?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('FAILS when derived auth/booking critical flows have no browser interaction proof', async () => {
    vi.resetModules();
    setupTask([
      { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=auth,booking,crud,dashboard,deployment_render' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=auth\nCapability: auth' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=booking\nCapability: booking' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=crud\nCapability: crud' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard\nCapability: dashboard' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render\nCapability: deployment_render' },
      ...referenceCalls,
      { tool: 'compose_frontend_plan', result: 'FRONTEND_PLAN_EVIDENCE ui_type=booking_calendar pattern_ids=booking_calendar' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=auth,booking,crud,dashboard,deployment_render reference_patterns=calcom-booking-patterns design_system=linear-app' },
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "signup and booking flow" - all 6 steps passed.' },
      { tool: 'verify_db_state',       result: 'DB STATE PASS: "user and booking rows" - 2 row(s) matched.' },
      { tool: 'verify_browser_ui',     result: 'BROWSER UI PASS: booking UI loaded with sign up and reserve controls.' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
      { tool: 'design_audit',          result: 'design_audit CLEAN - 0 findings on https://x.com' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      ...baseTask,
      title: 'Build local service booking app',
      description: 'Customers sign up, pick a slot, and reserve an appointment.',
      verification_level: 'deterministic',
    } as never);
    const criticalInteraction = result.checks.find((c) => c.name === 'critical_flow_interaction_evidence');
    expect(criticalInteraction?.passed).toBe(false);
    expect(criticalInteraction?.detail).toMatch(/verify_interaction_contract/);
    expect(result.passed).toBe(false);
  });

  it('FAILS when auth/booking only appear in required capabilities and interaction proof is missing', async () => {
    vi.resetModules();
    setupTask([
      { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE required=auth,booking,crud,dashboard,deployment_render selected=deployment_render optional=none' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=auth\nCapability: auth' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=booking\nCapability: booking' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=crud\nCapability: crud' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard\nCapability: dashboard' },
      { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=deployment_render\nCapability: deployment_render' },
      ...referenceCalls,
      { tool: 'compose_frontend_plan', result: 'FRONTEND_PLAN_EVIDENCE ui_type=dashboard pattern_ids=dashboard' },
      { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=deployment_render reference_patterns=shadcn-dashboard-patterns design_system=linear-app' },
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "member portal flow" - all 6 steps passed.' },
      { tool: 'verify_db_state',       result: 'DB STATE PASS: "required capability rows" - 2 row(s) matched.' },
      { tool: 'verify_browser_ui',     result: 'BROWSER UI PASS: member portal UI loaded with required controls.' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
      { tool: 'design_audit',          result: 'design_audit CLEAN - 0 findings on https://x.com' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      ...baseTask,
      title: 'Build member portal',
      description: 'User-facing member portal. The detailed feature mix is present only in capability planning evidence.',
      verification_level: 'deterministic',
    } as never);
    const criticalInteraction = result.checks.find((c) => c.name === 'critical_flow_interaction_evidence');
    expect(criticalInteraction?.passed).toBe(false);
    expect(criticalInteraction?.detail).toMatch(/auth\/signup\/login session/);
    expect(criticalInteraction?.detail).toMatch(/booking\/reservation flow/);
    expect(result.passed).toBe(false);
  });

  it('PASSES when agent runs a successful verify_user_journey', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: '✅ https://x.com is UP — HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "register flow" - all 3 steps passed.\n  ...' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({ ...baseTask, verification_level: 'deterministic' } as never);
    const journey = result.checks.find((c) => c.name === 'user_journey_evidence');
    expect(journey?.passed).toBe(true);
  });

  it('FAILS when one of multiple check_url_health calls returned a 5xx (no longer accepts "any 2xx")', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: '✅ https://x.com/ is UP — HTTP 200 in 50ms' },
      { tool: 'check_url_health',      result: '⚠️ https://x.com/api/health returned HTTP 500 in 50ms — app may have an error.' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "x" - all 3 steps passed.' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({ ...baseTask, verification_level: 'deterministic' } as never);
    const health = result.checks.find((c) => c.name === 'render_health_evidence');
    expect(health?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('treats db_state_evidence as advisory — absent does NOT fail the task', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: '✅ https://x.com is UP — HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "register flow" - all 3 steps passed.' },
      // static_code_scan is HARD as of 2026-05-10; include a clean call so the
      // db_state advisory behavior can be tested in isolation.
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) — high=0 medium=0 low=0' },
      // deploy_logs_clean is HARD as of 2026-05-12 (audit round 4); include a
      // clean render_get_logs call so the db_state advisory can be tested in isolation.
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({ ...baseTask, verification_level: 'deterministic' } as never);
    const dbState = result.checks.find((c) => c.name === 'db_state_evidence');
    expect(dbState?.passed).toBe(false); // no DB-state call → check fails
    expect(result.passed).toBe(true);    // but task still passes (advisory)
  });

  it('FAILS canary/full-stack tasks without a passing verify_db_state call', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "course flow" - all 8 steps passed.' },
      { tool: 'verify_db_state',       result: 'DB STATE FAIL: "rows" - query threw: fetch failed' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      ...baseTask,
      verification_level: 'deterministic',
      title: 'CANARY ai-course-marketplace: AI course marketplace',
      description: 'verify_db_state proves at least one canary_lessons row and one canary_subscriptions row.',
    } as never);
    const dbState = result.checks.find((c) => c.name === 'db_state_evidence');
    expect(dbState?.passed).toBe(false);
    expect(dbState?.detail).toMatch(/^Required:/);
    expect(result.passed).toBe(false);
  });

  it('FAILS when review_pushed_code ran and reported high-severity findings', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "register flow" - all 3 steps passed.' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
      { tool: 'review_pushed_code',    result: 'CODE REVIEW FAIL: high=1 medium=0 low=0\n[HIGH] auth bypass' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({ ...baseTask, verification_level: 'deterministic' } as never);
    const reviewClean = result.checks.find((c) => c.name === 'llm_code_review_clean');
    expect(reviewClean?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('passes code-review cleanliness when a later review_pushed_code is clean', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "register flow" - all 3 steps passed.' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
      { tool: 'review_pushed_code',    result: 'CODE REVIEW FAIL: high=1 medium=0 low=0\n[HIGH] auth bypass' },
      { tool: 'github_create_commit',  result: 'Committed fix for auth bypass' },
      { tool: 'review_pushed_code',    result: 'CODE REVIEW PASS: Clean - no issues found.' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "final flow" - all 3 steps passed.' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({ ...baseTask, verification_level: 'deterministic' } as never);
    const reviewClean = result.checks.find((c) => c.name === 'llm_code_review_clean');
    expect(reviewClean?.passed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('allows verifier-rejected tasks to be rechecked after verifier fixes', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "register flow" - all 3 steps passed.' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      ...baseTask,
      failure_class: 'verification_reject',
      verification_level: 'deterministic',
    } as never);
    const noFailure = result.checks.find((c) => c.name === 'no_failure');
    expect(noFailure?.passed).toBe(true);
    expect(noFailure?.detail).toMatch(/re-checkable/);
    expect(result.passed).toBe(true);
  });

  it('keeps missing review_pushed_code advisory-only', async () => {
    vi.resetModules();
    setupTask([
      ...capabilityCalls,
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: 'https://x.com is UP - HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "register flow" - all 3 steps passed.' },
      { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
      { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({ ...baseTask, verification_level: 'deterministic' } as never);
    const review = result.checks.find((c) => c.name === 'llm_code_review');
    const reviewClean = result.checks.find((c) => c.name === 'llm_code_review_clean');
    expect(review?.passed).toBe(false);
    expect(reviewClean).toBeUndefined();
    expect(result.passed).toBe(true);
  });
});

describe('Backend Quality Bar — repo hygiene checks (advisory)', () => {
  // Mocks db.select chain to return both an execution log AND a company row
  // with the github_repo set, then mocks global fetch to simulate the
  // GitHub Contents API response.
  function setupRepo(opts: {
    toolCalls: Array<{ tool: string; result: string }>;
    githubRepo: string | null;
    treeEntries: Array<{ path: string; type: 'blob' | 'tree'; size?: number }>;
  }) {
    const { toolCalls, githubRepo, treeEntries } = opts;
    const exec = { execution_log: toolCalls };
    const companyRow = { github_repo: githubRepo };

    let callIdx = 0;
    const sequence = [exec, companyRow]; // execs first, company second; reports/etc after → []
    const makeChain = () => {
      const rows = sequence[callIdx] ?? [];
      callIdx++;
      const chain: Record<string, unknown> = {};
      const wrap = (val: unknown) => {
        const arr = Array.isArray(val) ? val : [val];
        const thenable = Object.assign([...arr], chain);
        return thenable;
      };
      chain.from     = () => chain;
      chain.where    = () => wrap(rows);
      chain.orderBy  = () => chain;
      chain.limit    = () => wrap(rows);
      return chain;
    };

    vi.doMock('@/lib/db', () => ({
      db: { select: () => makeChain() },
      reports:        { id: {}, title: {}, task_id: {} },
      companies:      { id: {}, github_repo: {} },
      taskExecutions: { task_id: {}, created_at: {}, execution_log: {} },
    }));

    // Mock global fetch — GitHub Trees API (recursive=1 in one call).
    // Returns the tree on /git/trees/main, 404 elsewhere so the master fallback path is exercised when needed.
    const fetchMock = vi.fn(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes(`/repos/${githubRepo}/git/trees/main`)) {
        return { ok: true, json: async () => ({ tree: treeEntries }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.stubEnv('GITHUB_TOKEN', 'test-token');
  }

  const baseTask = {
    id: 't-1', company_id: 'c-1', tag: 'engineering',
    title: 'Build it', description: 'desc',
    turn_count: 5, max_turns: 200,
    status: 'in_progress', failure_class: null,
    verification_level: 'deterministic',
  };
  const capabilityCalls = [
    { tool: 'match_capabilities', result: 'Capability matches:\n1. crud score=10' },
    { tool: 'get_capability_pack', result: 'Capability: crud - CRUD And Data Management' },
    { tool: 'compose_app_architecture', result: 'Capability architecture plan:\nVerification journeys:' },
  ];
  const passingCalls = [
    ...capabilityCalls,
    { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
    { tool: 'check_url_health',      result: '✅ https://x.com is UP — HTTP 200 in 50ms' },
    { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "x" - all 3 steps passed.' },
    // static_code_scan is HARD as of 2026-05-10; the repo-hygiene tests focus
    // on advisory checks so include a clean scan call to keep result.passed=true.
    { tool: 'static_code_scan',      result: 'STATIC SCAN: 0 finding(s) — high=0 medium=0 low=0' },
    // deploy_logs_clean is HARD as of 2026-05-12 (audit round 4); include a
    // clean render_get_logs call so the repo-hygiene advisory checks can be
    // tested in isolation.
    { tool: 'render_get_logs',       result: 'Logs: server started on port 10000\nready in 1.2s' },
  ];

  it('flags missing tests folder + missing README as failed (but advisory)', async () => {
    vi.resetModules();
    setupRepo({
      toolCalls: passingCalls,
      githubRepo: 'BALAJIapps/threadpulse',
      treeEntries: [
        { path: 'package.json', type: 'blob', size: 400 },
        { path: 'server.js',    type: 'blob', size: 30000 },
      ],
    });
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask(baseTask as never);
    const tests  = result.checks.find((c) => c.name === 'tests_folder_present');
    const readme = result.checks.find((c) => c.name === 'readme_present');
    expect(tests?.passed).toBe(false);
    expect(readme?.passed).toBe(false);
    expect(result.passed).toBe(true); // advisory only
  });

  it('passes both checks when tests/ has files and README is >=200 bytes', async () => {
    vi.resetModules();
    setupRepo({
      toolCalls: passingCalls,
      githubRepo: 'BALAJIapps/threadpulse',
      treeEntries: [
        { path: 'package.json',          type: 'blob', size: 400 },
        { path: 'server.js',             type: 'blob', size: 30000 },
        { path: 'README.md',             type: 'blob', size: 800 },
        { path: 'tests',                 type: 'tree' },
        { path: 'tests/auth.test.js',    type: 'blob', size: 1200 },
        { path: 'tests/health.test.js',  type: 'blob', size: 800 },
      ],
    });
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask(baseTask as never);
    const tests  = result.checks.find((c) => c.name === 'tests_folder_present');
    const readme = result.checks.find((c) => c.name === 'readme_present');
    expect(tests?.passed).toBe(true);
    expect(readme?.passed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('skips repo hygiene checks silently when repo unreachable (no github_repo)', async () => {
    vi.resetModules();
    setupRepo({
      toolCalls: passingCalls,
      githubRepo: null,
      treeEntries: [],
    });
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask(baseTask as never);
    const tests  = result.checks.find((c) => c.name === 'tests_folder_present');
    const readme = result.checks.find((c) => c.name === 'readme_present');
    expect(tests).toBeUndefined();   // not added when repo unreachable
    expect(readme).toBeUndefined();
    expect(result.passed).toBe(true);
  });
});

describe('getCompanyAppUrl helper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('prefers custom_domain when present', async () => {
    vi.doMock('@/lib/db', () => ({
      db: { select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{
          custom_domain: 'threadpulse.baljia.app',
          render_service_id: 'srv-x',
        }] }) }),
      }) },
      reports: {}, companies: { id: {}, custom_domain: {}, render_service_id: {} },
      taskExecutions: {},
    }));
    const { getCompanyAppUrl } = await import('@/lib/services/verification.service');
    const url = await getCompanyAppUrl('c1');
    expect(url).toBe('https://threadpulse.baljia.app');
  });

  it('falls back to Render service URL when no custom domain', async () => {
    vi.doMock('@/lib/db', () => ({
      db: { select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{
          custom_domain: null,
          render_service_id: 'srv-abc',
        }] }) }),
      }) },
      reports: {}, companies: { id: {}, custom_domain: {}, render_service_id: {} },
      taskExecutions: {},
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ service: { serviceDetails: { url: 'https://acme-xyz.onrender.com' } } }),
      { status: 200 },
    )));
    vi.stubEnv('RENDER_API_KEY', 'rnd_test');
    const { getCompanyAppUrl } = await import('@/lib/services/verification.service');
    const url = await getCompanyAppUrl('c1');
    expect(url).toBe('https://acme-xyz.onrender.com');
  });

  it('returns null when neither custom domain nor render service id', async () => {
    vi.doMock('@/lib/db', () => ({
      db: { select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{
          custom_domain: null,
          render_service_id: null,
        }] }) }),
      }) },
      reports: {}, companies: { id: {}, custom_domain: {}, render_service_id: {} },
      taskExecutions: {},
    }));
    const { getCompanyAppUrl } = await import('@/lib/services/verification.service');
    const url = await getCompanyAppUrl('c1');
    expect(url).toBeNull();
  });
});

describe('verifyBrowserFlow URL selection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubEnv('RENDER_API_KEY', '');
  });

  it('uses the latest verified Render URL from tool evidence instead of failing a stale custom domain', async () => {
    const exec = {
      execution_log: [
        { tool: 'classify_task_intent', result: 'TASK_INTENT_EVIDENCE intent=focused_repair lane=repair reasons=repair_signal,existing_app_signal' },
        { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=dashboard\nCapability matches:\n1. dashboard score=10' },
        { tool: 'get_capability_pack', result: 'CAPABILITY_PACK_EVIDENCE id=dashboard\nCapability: dashboard - Dashboard/Admin UI' },
        { tool: 'compose_app_architecture', result: 'ARCHITECTURE_PLAN_EVIDENCE capabilities=dashboard\nCapability architecture plan:\nVerification journeys:' },
        { tool: 'github_create_commit', result: 'Committed focused UI repair' },
        { tool: 'check_url_health', result: 'https://vendor-good.onrender.com is UP - HTTP 200 in 50ms' },
        { tool: 'verify_user_journey', result: 'JOURNEY PASS: "vendor flow" - all 5 steps passed.' },
        { tool: 'verify_db_state', result: 'DB STATE PASS: "vendor row" - 1 row(s) matched.' },
        { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: rendered UI loaded without blocking runtime errors and required visible capability controls were present.' },
        { tool: 'static_code_scan', result: 'STATIC SCAN: 0 finding(s) - high=0 medium=0 low=0' },
        { tool: 'review_pushed_code', result: 'CODE REVIEW PASS: Clean - no issues found.' },
        { tool: 'render_get_logs', result: 'Logs: server started on port 10000\nready in 1.2s' },
        { tool: 'design_audit', result: 'design_audit CLEAN - 0 findings on https://vendor-good.onrender.com' },
      ],
    };
    const companyRepo = { github_repo: null };
    const companyUrl = {
      subdomain: 'vendor-stale',
      custom_domain: 'vendor-stale.baljia.app',
      render_service_id: 'srv-1',
    };

    let callIdx = 0;
    const sequence: unknown[] = [exec, companyRepo, [], exec, companyUrl];
    const makeChain = () => {
      const rows = sequence[callIdx] ?? [];
      callIdx += 1;
      const chain: Record<string, unknown> = {};
      const wrap = (val: unknown) => Object.assign([...(Array.isArray(val) ? val : [val])], chain);
      chain.from = () => chain;
      chain.where = () => wrap(rows);
      chain.orderBy = () => chain;
      chain.limit = () => wrap(rows);
      return chain;
    };

    vi.doMock('@/lib/db', () => ({
      db: { select: () => makeChain() },
      reports: { id: {}, title: {}, task_id: {} },
      companies: { id: {}, subdomain: {}, custom_domain: {}, render_service_id: {}, github_repo: {} },
      taskExecutions: { task_id: {}, created_at: {}, execution_log: {} },
    }));

    const html = `<html><body>${'working vendor dashboard '.repeat(80)}</body></html>`;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const urlString = url.toString();
      if (urlString.startsWith('https://vendor-good.onrender.com')) {
        return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (urlString.startsWith('https://vendor-stale.baljia.app')) {
        return new Response('<html><title>404</title><body>Not found</body></html>', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      id: 't-browser-url',
      company_id: 'c1',
      tag: 'engineering',
      source: 'founder_requested',
      title: 'CEO repair: Fix Vendor Compliance UI contrast',
      description: 'Repair existing user-facing dashboard UI. Verify /app and /api/health after deploy.',
      turn_count: 5,
      max_turns: 200,
      status: 'in_progress',
      failure_class: null,
      verification_level: 'browser_flow',
    } as never);

    const site = result.checks.find((c) => c.name === 'site_accessible');
    const appRoute = result.checks.find((c) => c.name === 'requested_route:/app');
    const healthRoute = result.checks.find((c) => c.name === 'requested_route:/api/health');
    expect(site?.passed).toBe(true);
    expect(site?.detail).toContain('https://vendor-good.onrender.com');
    expect(appRoute?.passed).toBe(true);
    expect(healthRoute?.passed).toBe(true);
    expect(result.passed).toBe(true);
  });
});

describe('runFallbackJourney', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('returns null when company has no resolvable URL', async () => {
    vi.doMock('@/lib/db', () => ({
      db: { select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ custom_domain: null, render_service_id: null }] }) }),
      }) },
      reports: {}, companies: { id: {}, custom_domain: {}, render_service_id: {} },
      taskExecutions: {},
    }));
    const { runFallbackJourney } = await import('@/lib/services/verification.service');
    const result = await runFallbackJourney('c1');
    expect(result).toBeNull();
  });

  it('returns JOURNEY PASS when / and /api/health both 2xx', async () => {
    vi.doMock('@/lib/db', () => ({
      db: { select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ custom_domain: 'app.example.com', render_service_id: 'srv-x' }] }) }),
      }) },
      reports: {}, companies: { id: {}, custom_domain: {}, render_service_id: {} },
      taskExecutions: {},
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/html' } })));
    const { runFallbackJourney } = await import('@/lib/services/verification.service');
    const result = await runFallbackJourney('c1');
    expect(result).not.toBeNull();
    expect(result!.allPassed).toBe(true);
    expect(result!.summary).toMatch(/JOURNEY PASS/);
  });

  it('returns JOURNEY FAIL when / returns 5xx', async () => {
    vi.doMock('@/lib/db', () => ({
      db: { select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ custom_domain: 'app.example.com', render_service_id: 'srv-x' }] }) }),
      }) },
      reports: {}, companies: { id: {}, custom_domain: {}, render_service_id: {} },
      taskExecutions: {},
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 502 })));
    const { runFallbackJourney } = await import('@/lib/services/verification.service');
    const result = await runFallbackJourney('c1');
    expect(result).not.toBeNull();
    expect(result!.allPassed).toBe(false);
  });
});

describe('verifyDeterministic — journey fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  function setupForFallback(opts: { fetchStatus: number }) {
    const exec = {
      execution_log: [
        { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
        { tool: 'check_url_health',      result: '✅ https://app.x.com is UP — HTTP 200 in 50ms' },
      ],
    };
    const company = { custom_domain: 'app.x.com', render_service_id: 'srv-1', github_repo: null };

    let callIdx = 0;
    const sequence: unknown[] = [exec, company, company]; // 1: exec_log, 2: companies for repo hygiene, 3: companies for getCompanyAppUrl
    const makeChain = () => {
      const rows = sequence[callIdx] ?? [];
      callIdx++;
      const chain: Record<string, unknown> = {};
      const wrap = (val: unknown) => Object.assign([...(Array.isArray(val) ? val : [val])], chain);
      chain.from    = () => chain;
      chain.where   = () => wrap(rows);
      chain.orderBy = () => chain;
      chain.limit   = () => wrap(rows);
      return chain;
    };
    vi.doMock('@/lib/db', () => ({
      db: { select: () => makeChain() },
      reports: { id: {}, title: {}, task_id: {} },
      companies: { id: {}, custom_domain: {}, render_service_id: {}, github_repo: {} },
      taskExecutions: { task_id: {}, created_at: {}, execution_log: {} },
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: opts.fetchStatus })));
  }

  it('FAILS task when agent skipped verify_user_journey, even if fallback liveness probe passes (mandatory call enforcement)', async () => {
    setupForFallback({ fetchStatus: 200 });
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      id: 't1', company_id: 'c1', tag: 'engineering', title: 'x', description: '',
      turn_count: 5, max_turns: 200, status: 'in_progress', failure_class: null,
      verification_level: 'deterministic',
    } as never);
    const journeyCheck = result.checks.find((c) => c.name === 'user_journey_evidence');
    // Fallback is diagnostic only — agent skipping is a hard fail regardless
    expect(journeyCheck?.passed).toBe(false);
    expect(journeyCheck?.detail).toMatch(/agent skipped/i);
    expect(journeyCheck?.detail).toMatch(/fallback liveness probe PASSED/);
    expect(result.passed).toBe(false);
  });

  it('FAILS task when fallback journey probe fails (and agent skipped journey)', async () => {
    setupForFallback({ fetchStatus: 502 });
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      id: 't1', company_id: 'c1', tag: 'engineering', title: 'x', description: '',
      turn_count: 5, max_turns: 200, status: 'in_progress', failure_class: null,
      verification_level: 'deterministic',
    } as never);
    const journeyCheck = result.checks.find((c) => c.name === 'user_journey_evidence');
    expect(journeyCheck?.passed).toBe(false);
    expect(journeyCheck?.detail).toMatch(/agent skipped/i);
    expect(journeyCheck?.detail).toMatch(/fallback liveness probe FAILED/);
    expect(result.passed).toBe(false);
  });
});
