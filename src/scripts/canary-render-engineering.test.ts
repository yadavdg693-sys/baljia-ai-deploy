import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/agents/agent-factory', () => ({
  engineeringCompletionGate: vi.fn(() => null),
}));

vi.mock('@/lib/agents/worker-launcher', () => ({
  launchTask: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {},
  companies: {},
  taskExecutions: {},
  tasks: {},
  users: {},
}));

vi.mock('@/lib/services/task.service', () => ({
  createTask: vi.fn(),
}));

const preflightMocks = vi.hoisted(() => ({
  preflightCheck: vi.fn(),
  formatPreflightFailures: vi.fn((failures: Array<{ integration: string; reason: string }>) =>
    `Preflight failed: ${failures.map((failure) => `${failure.integration} (${failure.reason})`).join('; ')}`),
}));

vi.mock('@/lib/services/preflight.service', () => ({
  preflightCheck: preflightMocks.preflightCheck,
  formatPreflightFailures: preflightMocks.formatPreflightFailures,
}));

describe('Engineering 95% canary scenario matrix', () => {
  beforeEach(() => {
    process.env.CANARY_PREFLIGHT_RETRY_CACHE = 'off';
    preflightMocks.preflightCheck.mockReset();
    preflightMocks.formatPreflightFailures.mockClear();
    preflightMocks.preflightCheck.mockResolvedValue({ ok: true, failures: [], checkedAt: Date.now() });
  });

  it('defines the full 7-canary evidence runway', async () => {
    const { CANARY_SCENARIOS } = await import('./canary-render-engineering');
    expect(CANARY_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'ai-course-marketplace',
      'vendor-compliance-portal',
      'booking-scheduling-app',
      'saas-billing-dashboard',
      'ai-document-analyzer',
      'adversarial-booking-marketplace',
      'existing-app-extension',
    ]);
  });

  it('requires planning-sensitive routes, tables, capabilities, and live checks for every scenario', async () => {
    const { CANARY_SCENARIOS } = await import('./canary-render-engineering');
    for (const scenario of CANARY_SCENARIOS) {
      expect(scenario.capabilities.length, scenario.id).toBeGreaterThanOrEqual(4);
      expect(scenario.requiredRoutes.length, scenario.id).toBeGreaterThanOrEqual(2);
      expect(scenario.requiredTables.length, scenario.id).toBeGreaterThanOrEqual(1);
      expect(scenario.liveChecks.some((check) => check.name === 'GET /'), scenario.id).toBe(true);
      expect(scenario.browserUiChecks.length, scenario.id).toBeGreaterThanOrEqual(1);
      expect(scenario.browserUiChecks.some((check) => check.requireNoConsoleErrors), scenario.id).toBe(true);
      expect(scenario.verificationRequirements.join(' '), scenario.id).toMatch(/verify_user_journey|verify_db_state/i);
    }
  });

  it('requires browser proof for real user-facing capability controls', async () => {
    const { CANARY_SCENARIOS } = await import('./canary-render-engineering');
    const vendor = CANARY_SCENARIOS.find((scenario) => scenario.id === 'vendor-compliance-portal');
    const vendorBrowserCheck = vendor?.browserUiChecks[0];

    expect(vendorBrowserCheck?.requiredTextPatterns.join(' ')).toMatch(/vendor/i);
    expect(vendorBrowserCheck?.requiredTextPatterns.join(' ')).toMatch(/document/i);
    expect(vendorBrowserCheck?.requiredButtonPatterns.join(' ')).toMatch(/approve/i);
    expect(vendorBrowserCheck?.requiredButtonPatterns.join(' ')).toMatch(/document/i);
    expect(vendorBrowserCheck?.journeys?.some((journey) => (
      journey.name.match(/document form/i) &&
      journey.formFields.lp_vendor_id === '<vendorId>' &&
      journey.expectTextPatterns.join(' ').match(/browser-doc/i)
    ))).toBe(true);
    const authJourney = vendorBrowserCheck?.journeys?.find((journey) => journey.startPath === '/sign-up');
    expect(authJourney?.expectTextPatterns.join(' ')).toMatch(/Dashboard/i);
    expect(authJourney?.postSubmitActions?.some((action) => (
      action.type === 'click' &&
      action.labelPattern?.match(/sign out/i) &&
      action.rejectTextPatterns?.join(' ').match(/Compliance Dashboard/i)
    ))).toBe(true);
    expect(authJourney?.postSubmitActions?.some((action) => (
      action.type === 'goto' &&
      action.path === '/app' &&
      action.expectTextPatterns?.join(' ').match(/sign in|email|password/i)
    ))).toBe(true);
    expect(vendor?.interactionChecks?.some((check) => (
      check.name.match(/register vendor/i) &&
      check.api === 'POST /api/canary-vendors' &&
      check.dbTables?.includes('canary_vendors')
    ))).toBe(true);
  });

  it('prefers real form submit controls before header or nav link-buttons in browser journeys', async () => {
    const { BROWSER_JOURNEY_ACTION_SELECTOR_PHASES } = await import('./canary-render-engineering');
    const firstPhase = BROWSER_JOURNEY_ACTION_SELECTOR_PHASES[0].join(',');
    const lastPhase = BROWSER_JOURNEY_ACTION_SELECTOR_PHASES.at(-1)?.join(',') ?? '';
    const earlyPhases = BROWSER_JOURNEY_ACTION_SELECTOR_PHASES.slice(0, -1).flat().join(',');

    expect(firstPhase).toContain('form button');
    expect(firstPhase).toContain('form input[type="submit"]');
    expect(earlyPhases).not.toContain('a[role="button"]');
    expect(lastPhase).toContain('a[role="button"]');
    expect(lastPhase).toContain('a[class*="button" i]');
  });

  it('includes one adversarial mixed app and one existing-app extension canary', async () => {
    const { CANARY_SCENARIOS } = await import('./canary-render-engineering');
    const adversarial = CANARY_SCENARIOS.find((scenario) => scenario.id === 'adversarial-booking-marketplace');
    expect(adversarial?.capabilities).toEqual(expect.arrayContaining([
      'marketplace',
      'booking',
      'payments_stripe',
      'uploads_storage',
      'analytics',
    ]));

    const extension = CANARY_SCENARIOS.find((scenario) => scenario.id === 'existing-app-extension');
    expect(extension?.requiresExistingBaseline).toBe(true);
    expect(extension?.extraCriticalTools).toContain('read_codebase_map');
    expect(extension?.extraCriticalTools).toContain('build_code_graph');
    expect(extension?.extraCriticalTools).toContain('query_code_graph');
  });

  it('selects the execution row with real evidence even when field casing differs', async () => {
    const { selectEvidenceExecution } = await import('./canary-render-engineering');
    const selected = selectEvidenceExecution([
      { id: 'empty', status: 'failed', turn_count: 0, execution_log: [] },
      {
        id: 'rich',
        status: 'failed',
        turnCount: 41,
        executionLog: [
          { tool: 'match_capabilities', result: 'CAPABILITY_MATCH_EVIDENCE selected=auth' },
          { tool: 'create_instance', result: 'Instance ready' },
        ],
      },
    ]);

    expect(selected.execution?.id).toBe('rich');
    expect(selected.events).toHaveLength(2);
  });

  it('prefers a completed resumed execution over an older longer failed execution', async () => {
    const { selectEvidenceExecution } = await import('./canary-render-engineering');
    const olderFailedLog = Array.from({ length: 80 }, (_, index) => ({ tool: `tool_${index}`, result: 'old evidence' }));
    const selected = selectEvidenceExecution([
      { id: 'older-failed', status: 'failed', turn_count: 80, execution_log: olderFailedLog },
      {
        id: 'completed-resume',
        status: 'completed',
        turn_count: 12,
        execution_log: [
          { tool: 'verify_user_journey', result: 'JOURNEY PASS' },
          { tool: 'create_report', result: 'Report created' },
        ],
      },
    ]);

    expect(selected.execution?.id).toBe('completed-resume');
    expect(selected.events.some((event) => event.tool === 'tool_0')).toBe(true);
    expect(selected.events.some((event) => event.tool === 'create_report')).toBe(true);
  });

  it('accepts existing repo/service provisioning evidence on same-task canary resumes', async () => {
    const { missingCriticalToolsForRun } = await import('./canary-render-engineering');
    const missing = missingCriticalToolsForRun(
      ['create_instance', 'github_fork_skeleton', 'render_get_deploy_status', 'run_migration', 'github_push_file'],
      new Set(['github_fork_skeleton', 'render_get_service', 'render_get_deploy_status', 'run_migration', 'github_push_file']),
      { github_repo: 'BALAJIapps/canary-existing', render_service_id: 'srv_123' },
    );

    expect(missing).not.toContain('create_instance');
    expect(missing).toEqual([]);
  });

  it('accepts repair replay evidence from an existing repo/service with DB proof', async () => {
    const { missingCriticalToolsForRun } = await import('./canary-render-engineering');
    const tools = ['create_instance', 'render_get_deploy_status', 'run_migration', 'github_push_file'];
    const called = new Set(['read_codebase_map', 'github_read_file', 'render_get_deploy_status', 'check_url_health']);
    const company = { github_repo: 'BALAJIapps/canary-existing', render_service_id: 'srv_123' };

    expect(missingCriticalToolsForRun(tools, called, company)).toEqual([
      'create_instance',
      'run_drizzle_push_or_run_migration',
      'github_create_commit_or_github_push_file',
    ]);
    expect(missingCriticalToolsForRun(tools, called, company, {
      allowExistingProvisioning: true,
      dbProofPassed: true,
    })).toEqual(['github_create_commit_or_github_push_file']);
  });

  it('reads related task ids for repair replay lineage evidence', async () => {
    const { relatedTaskIdsOf } = await import('./canary-render-engineering');

    expect(relatedTaskIdsOf({ related_task_ids: ['original-task', '', 123] })).toEqual(['original-task']);
    expect(relatedTaskIdsOf({ relatedTaskIds: '["original-task","older-repair"]' })).toEqual(['original-task', 'older-repair']);
    expect(relatedTaskIdsOf({ related_task_ids: 'not-json' })).toEqual([]);
  });

  it('trusts final verification evidence when replay sees stale completion gate blocks', async () => {
    const { verificationEvidenceCompletionGateResolved } = await import('./canary-render-engineering');

    expect(verificationEvidenceCompletionGateResolved({
      checks: [
        { name: 'deploy_logs_clean', passed: true },
        { name: 'completion_gate_resolved', passed: true },
      ],
    })).toBe(true);
    expect(verificationEvidenceCompletionGateResolved({
      checks: [{ name: 'completion_gate_resolved', passed: false }],
    })).toBe(false);
  });

  it('requires domain/frontend critical tools only when scenario evidence asks for them', async () => {
    const { criticalToolsForScenario, missingCriticalToolsForRun } = await import('./canary-render-engineering');
    const scenario = {
      id: 'extended-ui',
      title: 'Extended UI scenario',
      originalIdea: 'Build a store.',
      capabilities: ['crud', 'dashboard', 'deployment_render'],
      requiredRoutes: ['app/api/health/route.ts'],
      requiredTables: ['canary_products'],
      surfaceRequirements: [],
      verificationRequirements: [],
      liveChecks: [{ name: 'GET /', path: '/' }],
      browserUiChecks: [{ name: 'ui', requiredTextPatterns: ['store'], requiredButtonPatterns: ['checkout'] }],
      domains: ['ecommerce_store'],
      requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=ecommerce_store', 'FRONTEND_PLAN_EVIDENCE ui_type'],
      dbChecks: [],
      expectedFailureClasses: [],
    };

    const tools = criticalToolsForScenario(scenario);
    expect(tools).toEqual(expect.arrayContaining(['match_domain_app', 'get_domain_pack_or_compose_ad_hoc_domain', 'compose_frontend_plan']));
    expect(missingCriticalToolsForRun(tools, new Set([
      ...tools.filter((tool) => tool !== 'get_domain_pack_or_compose_ad_hoc_domain'),
      'compose_ad_hoc_domain',
      'run_migration',
      'github_push_file',
    ]))).not.toContain('get_domain_pack_or_compose_ad_hoc_domain');
  });

  it('requires interaction verifier when scenario declares interaction contracts', async () => {
    const { criticalToolsForScenario, requiredEvidenceChecksForScenario } = await import('./canary-render-engineering');
    const scenario = {
      id: 'interaction-ui',
      title: 'Interaction UI scenario',
      originalIdea: 'Build an app with a working form.',
      capabilities: ['crud', 'dashboard', 'deployment_render'],
      requiredRoutes: ['app/api/health/route.ts'],
      requiredTables: ['canary_records'],
      surfaceRequirements: [],
      verificationRequirements: [],
      liveChecks: [{ name: 'GET /', path: '/' }],
      browserUiChecks: [{ name: 'ui', requiredTextPatterns: ['records'], requiredButtonPatterns: ['save'] }],
      interactionChecks: [{
        name: 'save record',
        labelPattern: 'save',
        fields: { name: 'Record <timestamp>' },
        api: 'POST /api/records',
        dbTables: ['canary_records'],
        expectTextPatterns: ['Record'],
      }, {
        name: 'approve record',
        labelPattern: 'approve',
        fields: { review_note: 'Looks good' },
        api: 'POST /api/records/<id>/approve',
        dbTables: ['canary_records'],
        expectTextPatterns: ['Approved'],
      }],
    };

    expect(criticalToolsForScenario(scenario)).toContain('verify_interaction_contract');
    expect(requiredEvidenceChecksForScenario([], scenario).some((check) => check.name.includes('verify_interaction_contract') && !check.ok)).toBe(true);
    expect(requiredEvidenceChecksForScenario([
      { tool: 'verify_interaction_contract', result: 'INTERACTION_PROOF_EVIDENCE passed=1 failed=0 expected=1\nINTERACTION PROOF PASS: 1 interaction(s) passed.' },
    ], scenario).find((check) => check.name.includes('verify_interaction_contract'))?.ok).toBe(false);
    expect(requiredEvidenceChecksForScenario([
      { tool: 'verify_interaction_contract', result: 'INTERACTION_PROOF_EVIDENCE passed=2 failed=0 expected=2\nINTERACTION PROOF PASS: 2 interaction(s) passed.' },
    ], scenario).find((check) => check.name.includes('verify_interaction_contract'))?.ok).toBe(true);
  });

  it('checks extended scenario required evidence and db evidence deterministically', async () => {
    const { requiredEvidenceChecksForScenario, scenarioDbEvidenceChecks } = await import('./canary-render-engineering');
    const scenario = {
      id: 'extended-ui',
      title: 'Extended UI scenario',
      originalIdea: 'Build a store.',
      capabilities: ['crud', 'dashboard', 'deployment_render'],
      requiredRoutes: ['app/api/health/route.ts'],
      requiredTables: ['canary_products'],
      surfaceRequirements: [],
      verificationRequirements: [],
      liveChecks: [{ name: 'GET /', path: '/' }],
      browserUiChecks: [{ name: 'ui', requiredTextPatterns: ['store'], requiredButtonPatterns: ['checkout'] }],
      domains: ['ecommerce_store'],
      requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=ecommerce_store', 'FRONTEND_PLAN_EVIDENCE ui_type', 'FRONTEND_PLAN_EVIDENCE pattern_ids contains ecommerce-storefront', 'verify_browser_ui pass'],
      dbChecks: [{ name: 'product persisted', table: 'canary_products', expects: 'one row' }],
      expectedFailureClasses: [],
    };

    const missingChecks = requiredEvidenceChecksForScenario([], scenario);
    expect(missingChecks.some((check) => !check.ok)).toBe(true);

    const events = [
      { tool: 'match_domain_app', result: 'DOMAIN_MATCH_EVIDENCE selected=ecommerce_store' },
      { tool: 'compose_frontend_plan', result: 'FRONTEND_PLAN_EVIDENCE ui_type=storefront pattern_ids=ecommerce-storefront' },
      { tool: 'compose_app_architecture', result: `BUILD_BRIEF_EVIDENCE version=1 lane=canary task_intent=new_app_build planning_depth=canary_world_class primary_verb=sell_products assumptions=2 non_goals=2 mvp_features=2 domains=ecommerce_store risks=none\nPRODUCT_BUILD_CONTRACT_EVIDENCE version=1 lane=canary source=domain_augmented screens=4 flows=1 entities=3 api_actions=3 auth_baseline=false user_isolation=false flow_ids=ecommerce_order\nPRODUCT_BUILD_CONTRACT_JSON ${JSON.stringify({ version: 1, lane: 'canary', source: 'domain_augmented', roles: ['shopper'], screens: [], flows: [{ id: 'ecommerce_order', name: 'checkout to order', laneRequired: ['canary'], startPath: '/', actions: [], entitiesTouched: [], successReadback: [], dbAssertions: [], authRequired: false }], entities: [], apiActions: [], acceptance: { ctaRules: [], authBaseline: false, userIsolation: false, dbPersistence: true, noMockSuccess: true, publicDataLeakCheck: false } })}\nPRODUCT_BUILD_CONTRACT_ARTIFACT path=measurement-output/product-build-contracts/test.json` },
      { tool: 'verify_interaction_contract', result: 'INTERACTION_PROOF_EVIDENCE passed=1 failed=0 expected=1\nACCEPTANCE_PROOF_EVIDENCE passed=1 failed=0 contract_flows=1\nCONTRACT_FLOW_PROOF id=ecommerce_order passed=true interaction=ecommerce_order\nINTERACTION PROOF PASS: 1 interaction(s) passed.' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS: storefront controls visible' },
      { tool: 'verify_db_state', result: 'DB STATE PASS: product row matched' },
    ];
    expect(requiredEvidenceChecksForScenario(events, scenario).every((check) => check.ok)).toBe(true);
    expect(scenarioDbEvidenceChecks(events, scenario, [{ name: 'canary_products', ok: true, detail: 'canary_products exists' }]).every((check) => check.ok)).toBe(true);
    expect(scenarioDbEvidenceChecks([
      { tool: 'verify_db_state', source: 'canary_runner_db_table_proof', result: 'DB STATE PASS: "runner-side required table proof" - required canary tables contain at least one row each.' },
    ], scenario, [{ name: 'canary_products', ok: true, detail: 'canary_products exists' }]).some((check) => !check.ok)).toBe(true);
    expect(scenarioDbEvidenceChecks([], scenario, [{ name: 'canary_products', ok: true, detail: 'canary_products exists' }]).some((check) => !check.ok)).toBe(true);
  });

  it('scores acceptance against selected contract flow ids, not unrelated later repair failures', async () => {
    const { productContractChecksForScenario } = await import('./canary-render-engineering');
    const contract = {
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
      ].map((id) => ({
        id,
        name: id,
        laneRequired: ['canary'],
        startPath: '/',
        actions: [],
        entitiesTouched: id === 'finance_crypto_create_portfolio' ? ['canary_portfolios'] : [],
        successReadback: [],
        dbAssertions: [],
        authRequired: id !== 'auth_session',
      })),
      entities: [{
        name: 'canary_portfolios',
        fields: [{ name: 'name', required: true }],
        userScoped: true,
      }],
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
    const events = [
      { tool: 'compose_app_architecture', result: [
        'BUILD_BRIEF_EVIDENCE version=1 lane=canary',
        'PRODUCT_BUILD_CONTRACT_EVIDENCE version=1 lane=canary source=domain_augmented screens=1 flows=5 entities=1 api_actions=1 auth_baseline=true user_isolation=true flow_ids=auth_session,finance_crypto_create_portfolio,finance_crypto_price_alert,finance_crypto_transaction_history,finance_crypto_external_api_fallback',
        `PRODUCT_BUILD_CONTRACT_JSON ${JSON.stringify(contract)}`,
        'PRODUCT_BUILD_CONTRACT_ARTIFACT path=measurement-output/product-build-contracts/test.json',
      ].join('\n') },
      { tool: 'verify_interaction_contract', result: [
        'ACCEPTANCE_PROOF_EVIDENCE passed=4 failed=0 contract_flows=4',
        'CONTRACT_FLOW_PROOF id=auth_session passed=true interaction=auth',
        'CONTRACT_FLOW_PROOF id=finance_crypto_price_alert passed=true interaction=alert',
        'CONTRACT_FLOW_PROOF id=finance_crypto_transaction_history passed=true interaction=transaction',
        'CONTRACT_FLOW_PROOF id=finance_crypto_external_api_fallback passed=true interaction=fallback',
      ].join('\n') },
      { tool: 'verify_user_journey', result: [
        'JOURNEY PASS: portfolio create',
        'ACCEPTANCE_PROOF_EVIDENCE passed=1 failed=0 contract_flows=1',
        'CONTRACT_FLOW_PROOF id=finance_crypto_create_portfolio passed=true interaction=portfolio_create',
      ].join('\n') },
      { tool: 'verify_interaction_contract', result: [
        'ACCEPTANCE_PROOF_EVIDENCE passed=1 failed=1 contract_flows=2',
        'CONTRACT_FLOW_PROOF id=finance_crypto_create_portfolio passed=false interaction=later_ui_attempt_after_api_proof',
        'CONTRACT_FLOW_PROOF id=billing_journey passed=false interaction=unrelated_billing',
      ].join('\n') },
      { tool: 'verify_db_state', result: 'DB STATE PASS: portfolio row\nCONTRACT_FIELD_PROOF flow_id=finance_crypto_create_portfolio passed=true entity=canary_portfolios db_table=canary_portfolios fields=name' },
      { tool: 'verify_browser_ui', result: 'BROWSER UI PASS' },
      { tool: 'verify_db_state', source: 'canary_runner_db_table_proof', result: 'DB STATE PASS: "runner-side required table proof" - required canary tables contain at least one row each.' },
      { tool: 'auth_isolation', result: 'AUTH_ISOLATION_PROOF_EVIDENCE passed=1 failed=0 checks=1' },
    ];

    const checks = productContractChecksForScenario({
      events,
      liveChecks: [{ name: 'POST /api/canary-portfolios', ok: true, status: 201, detail: '' }],
      liveCheckSpecs: [{ name: 'POST /api/canary-portfolios', path: '/api/canary-portfolios', method: 'POST', required: true }],
      requiredFileChecks: [{ name: 'app/api/canary-portfolios/route.ts', ok: true, detail: 'found' }],
      dbTableChecks: [{ name: 'canary_portfolios has rows', ok: true, detail: 'rows' }],
      browserUiChecks: [{
        name: 'ui',
        ok: true,
        status: 200,
        missingTextPatterns: [],
        missingButtonPatterns: [],
        consoleIssues: [],
        detail: 'ok',
      }],
    });

    expect(checks.find((check) => check.name === 'acceptance proof evidence')).toMatchObject({ ok: true });
  });

  it('resolves legacy and world-class output roots without running canaries', async () => {
    const { canaryUsage, parseArgs, resolveTreeRoot } = await import('./canary-render-engineering');
    expect(resolveTreeRoot(parseArgs(['--core']))).toBe('engineering-95');
    expect(resolveTreeRoot(parseArgs(['--extended']))).toBe('engineering-world-class');
    expect(resolveTreeRoot(parseArgs(['--all']))).toBe('engineering-world-class');
    expect(resolveTreeRoot(parseArgs(['--confidence-run']))).toBe('engineering-world-class');
    expect(parseArgs(['--help']).help).toBe(true);
    expect(canaryUsage()).toContain('--scenario <id>');
  });

  it('uses a bounded per-task timeout for canary launches', async () => {
    const { canaryTaskTimeoutMs } = await import('./canary-render-engineering');
    expect(canaryTaskTimeoutMs()).toBe(90 * 60 * 1000);
    expect(canaryTaskTimeoutMs('60000')).toBe(60_000);
    expect(canaryTaskTimeoutMs('not-a-number')).toBe(90 * 60 * 1000);
  });

  it('runs canary launch preflight with Render quota-event probing', async () => {
    const { assertCanaryRunnerPreflightReady } = await import('./canary-render-engineering');
    await assertCanaryRunnerPreflightReady();

    expect(preflightMocks.preflightCheck).toHaveBeenCalledWith({
      bypassCache: true,
      renderQuotaEvents: true,
    });
  });

  it('allows a narrow operator retry after Render quota is restored', async () => {
    const { assertCanaryRunnerPreflightReady } = await import('./canary-render-engineering');
    await assertCanaryRunnerPreflightReady(true);

    expect(preflightMocks.preflightCheck).toHaveBeenCalledWith({
      bypassCache: true,
      renderQuotaEvents: false,
    });
  });

  it('blocks canary launch when Render quota preflight fails', async () => {
    preflightMocks.preflightCheck.mockResolvedValueOnce({
      ok: false,
      checkedAt: Date.now(),
      failures: [{ integration: 'render', reason: 'recent pipeline_minutes_exhausted event detected before canary launch' }],
    });

    const { assertCanaryRunnerPreflightReady } = await import('./canary-render-engineering');

    await expect(assertCanaryRunnerPreflightReady()).rejects.toThrow(/pipeline_minutes_exhausted/);
    expect(preflightMocks.formatPreflightFailures).toHaveBeenCalled();
  });

  it('writes a structured preflight-blocked summary without creating a task', async () => {
    preflightMocks.preflightCheck.mockResolvedValueOnce({
      ok: false,
      checkedAt: Date.now(),
      failures: [{ integration: 'render', reason: 'recent pipeline_minutes_exhausted event detected before canary launch; earliest_retry_after=2026-05-19T20:10:06.398Z' }],
    });

    const { runCanaryMatrix } = await import('./canary-render-engineering');
    const { createTask } = await import('@/lib/services/task.service');
    const { launchTask } = await import('@/lib/agents/worker-launcher');

    const summary = await runCanaryMatrix([
      '--scenario',
      'social-community',
      '--run-id',
      'unit-preflight-blocked-summary',
    ]);

    expect(summary.ok).toBe(false);
    expect(summary.passed).toBe(0);
    expect(summary.total).toBe(1);
    expect(summary.earliestRetryAfter).toBe('2026-05-19T20:10:06.398Z');
    expect(summary.preflight.failures[0].integration).toBe('render');
    expect(summary.reports[0]).toMatchObject({
      scenarioId: 'social-community',
      ok: false,
      terminalState: 'PREFLIGHT_BLOCKED',
      taskId: null,
      earliestRetryAfter: '2026-05-19T20:10:06.398Z',
    });
    expect(createTask).not.toHaveBeenCalled();
    expect(launchTask).not.toHaveBeenCalled();
    process.exitCode = 0;
  });

  it('uses cached preflight retry timing before live preflight churn', async () => {
    process.env.CANARY_PREFLIGHT_RETRY_CACHE = 'on';
    process.env.CANARY_PREFLIGHT_RETRY_CACHE_INCLUDE_UNIT = 'true';
    const { mkdirSync, rmSync, writeFileSync } = await import('fs');
    const path = await import('path');
    const cacheDir = path.join(process.cwd(), 'measurement-output', 'engineering-95', 'unit-cached-render-quota-block');
    const outputDir = path.join(process.cwd(), 'measurement-output', 'engineering-95', 'unit-preflight-cache-blocked-summary');
    rmSync(cacheDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(cacheDir, 'summary.json'), `${JSON.stringify({
      ok: false,
      earliestRetryAfter: '2099-01-01T00:00:00.000Z',
      preflight: {
        ok: false,
        failures: [{
          integration: 'render',
          reason: 'recent pipeline_minutes_exhausted event detected before canary launch; earliest_retry_after=2099-01-01T00:00:00.000Z',
        }],
      },
      reports: [],
    }, null, 2)}\n`);

    const { runCanaryMatrix } = await import('./canary-render-engineering');
    const { createTask } = await import('@/lib/services/task.service');
    const { launchTask } = await import('@/lib/agents/worker-launcher');

    const summary = await runCanaryMatrix([
      '--scenario',
      'social-community',
      '--run-id',
      'unit-preflight-cache-blocked-summary',
    ]);

    expect(summary.ok).toBe(false);
    expect(summary.earliestRetryAfter).toBe('2099-01-01T00:00:00.000Z');
    expect(summary.preflight.failures[0].reason).toContain('cached recent pipeline_minutes_exhausted');
    expect(preflightMocks.preflightCheck).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    expect(launchTask).not.toHaveBeenCalled();
    rmSync(cacheDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
    delete process.env.CANARY_PREFLIGHT_RETRY_CACHE_INCLUDE_UNIT;
    process.exitCode = 0;
  });

  it('bypasses cached retry timing when operator confirms Render quota restoration', async () => {
    const { mkdirSync, rmSync, writeFileSync } = await import('fs');
    const path = await import('path');
    const cacheDir = path.join(process.cwd(), 'measurement-output', 'engineering-95', 'unit-force-bypasses-render-quota-cache');
    rmSync(cacheDir, { recursive: true, force: true });
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(cacheDir, 'summary.json'), `${JSON.stringify({
      ok: false,
      earliestRetryAfter: '2099-01-01T00:00:00.000Z',
      preflight: {
        ok: false,
        failures: [{
          integration: 'render',
          reason: 'recent pipeline_minutes_exhausted event detected before canary launch; earliest_retry_after=2099-01-01T00:00:00.000Z',
        }],
      },
      reports: [],
    }, null, 2)}\n`);

    const { cachedCanaryPreflightBlockForRun } = await import('./canary-render-engineering');
    const env = { CANARY_PREFLIGHT_RETRY_CACHE: 'on', CANARY_PREFLIGHT_RETRY_CACHE_INCLUDE_UNIT: 'true' } as NodeJS.ProcessEnv;

    expect(cachedCanaryPreflightBlockForRun('engineering-95', false, Date.now(), env)?.[0]?.reason)
      .toContain('cached recent pipeline_minutes_exhausted');
    expect(cachedCanaryPreflightBlockForRun('engineering-95', true, Date.now(), env)).toBeNull();

    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('treats only public GET live probes as hard live checks', async () => {
    const { isRequiredLiveCheck } = await import('./canary-render-engineering');
    expect(isRequiredLiveCheck({ method: 'GET' })).toBe(true);
    expect(isRequiredLiveCheck({})).toBe(true);
    expect(isRequiredLiveCheck({ method: 'POST' })).toBe(false);
    expect(isRequiredLiveCheck({ method: 'POST', required: true })).toBe(true);
    expect(isRequiredLiveCheck({ method: 'GET', optional: true })).toBe(false);
  });

  it('generates contract-exact vendor canary prompt from the scenario spec', async () => {
    const { CANARY_SCENARIOS, buildTaskDescription, formatLiveCheckContract, formatBrowserUiContract, formatInteractionContract } = await import('./canary-render-engineering');
    const vendor = CANARY_SCENARIOS.find((scenario) => scenario.id === 'vendor-compliance-portal');
    expect(vendor).toBeTruthy();
    const prompt = buildTaskDescription(vendor!, 'canary-vendor-test');
    const liveContract = formatLiveCheckContract(vendor!).join('\n');
    const browserContract = formatBrowserUiContract(vendor!).join('\n');
    const interactionContract = formatInteractionContract(vendor!).join('\n');

    expect(prompt).toContain('vendor_email');
    expect(prompt).toContain('vendor_id');
    expect(prompt).toContain('document_name');
    expect(prompt).toContain('document_type');
    expect(prompt).toContain('review_note');
    expect(prompt).toContain('<vendorId from POST /api/canary-vendors>');
    expect(prompt).toContain('Do not rename snake_case fields to camelCase');
    expect(liveContract).toContain('[required] POST /api/canary-vendors');
    expect(browserContract).toContain('semantic actions count as buttons');
    expect(browserContract).toContain('browser journey "vendor onboarding form submits through UI"');
    expect(browserContract).toContain('browser journey "document form submits through UI and renders saved document"');
    expect(browserContract).toContain('then click action matching /sign out|logout/i');
    expect(browserContract).toContain('then visit /app');
    expect(prompt).toContain('Call verify_interaction_contract');
    expect(interactionContract).toContain('register vendor button writes and renders vendor');
    expect(interactionContract).toContain('POST /api/canary-vendors');
  });

  it('does not inject canary-only planning depth or forced capability lists into the engineering task', async () => {
    const { CANARY_SCENARIOS, buildTaskDescription } = await import('./canary-render-engineering');
    const vendor = CANARY_SCENARIOS.find((scenario) => scenario.id === 'vendor-compliance-portal');
    expect(vendor).toBeTruthy();

    const prompt = buildTaskDescription(vendor!, 'canary-vendor-test');

    expect(prompt).not.toContain('canary_world_class');
    expect(prompt).not.toContain('Required scenario capabilities:');
    expect(prompt).toContain('Call match_capabilities with domain/product context');
  });

  it('adds reusable deployment, starter-surface, and pgvector guardrails to canary prompts', async () => {
    const { CANARY_SCENARIOS, buildTaskDescription } = await import('./canary-render-engineering');
    const documentAnalyzer = CANARY_SCENARIOS.find((scenario) => scenario.id === 'ai-document-analyzer');
    expect(documentAnalyzer).toBeTruthy();
    const prompt = buildTaskDescription(documentAnalyzer!, 'canary-doc-test');

    expect(prompt).toContain('.onrender.com URL');
    expect(prompt).toContain('generic/internal Baljia starter copy');
    expect(prompt).toContain('Your app, generated. Yours to keep.');
    expect(prompt).toContain('authenticated app surface');
    expect(prompt).toContain('This is your authenticated app shell');
    expect(prompt).toContain('db/schema.ts');
    expect(prompt).toContain('Do not create ivfflat or hnsw indexes on vector(3072)');
    expect(prompt).toContain('fixed Gemini provider contract');
    expect(prompt).toContain('AI_TEXT_MODEL=gemini-2.5-flash');
    expect(prompt).toContain('Do not use OpenAI model names or the Baljia gateway');
    expect(prompt).toContain('Do not pass AI canaries with fallback=true');
    expect(prompt).toContain('browser journey "document analyzer form submits through UI"');
    expect(prompt).toContain('click action matching /upload|submit|add|save|analy[sz]e document/i');
  });

  it('requires real AI analyzer API responses instead of fallback-only success', async () => {
    const {
      CANARY_SCENARIOS,
      formatLiveCheckContract,
      liveCheckResponsePolicyFailures,
    } = await import('./canary-render-engineering');
    const documentAnalyzer = CANARY_SCENARIOS.find((scenario) => scenario.id === 'ai-document-analyzer');
    const analyzeCheck = documentAnalyzer?.liveChecks.find((check) => check.name === 'POST /api/canary-analyze');
    const liveContract = formatLiveCheckContract(documentAnalyzer!).join('\n');

    expect(analyzeCheck?.required).toBe(true);
    expect(analyzeCheck?.rejectTruthyJsonPaths).toEqual(expect.arrayContaining(['analysis.fallback']));
    expect(analyzeCheck?.rejectResponseTextPatterns).toEqual(expect.arrayContaining(['AI FALLBACK', 'Analysis failed']));
    expect(liveContract).toContain('rejected truthy JSON paths: analysis.fallback, fallback');

    expect(liveCheckResponsePolicyFailures(JSON.stringify({
      ok: true,
      analysis: {
        summary: '[AI FALLBACK] Analysis failed.',
        fallback: true,
      },
    }), analyzeCheck!)).toEqual(expect.arrayContaining([
      'response matched rejected pattern "AI FALLBACK"',
      'response matched rejected pattern "Analysis failed"',
      'JSON path "analysis.fallback" was truthy (true)',
    ]));
  });

  it('browser action labels include semantic buttons, submit values, link-buttons, and aria labels', async () => {
    const { browserFieldLabelPattern, normalizeBrowserActionLabels } = await import('./canary-render-engineering');
    const labels = normalizeBrowserActionLabels([
      { text: 'Approve vendor' },
      { ariaLabel: 'Save document record' },
      { value: 'Submit onboarding' },
      { href: 'https://example.com/pricing', title: 'Checkout link' },
    ]);

    expect(labels).toEqual(expect.arrayContaining([
      'Approve vendor',
      'Save document record',
      'Submit onboarding',
      'Checkout link',
    ]));
    expect(browserFieldLabelPattern('document_text')).toBe('document text');
    expect(browserFieldLabelPattern('sourceName')).toBe('source name');
  });

  it('retries only transient GET live checks', async () => {
    const { shouldRetryLiveCheckAttempt } = await import('./canary-render-engineering');

    expect(shouldRetryLiveCheckAttempt({
      method: 'GET',
      detail: 'This operation was aborted',
      attempt: 1,
      maxAttempts: 3,
    })).toBe(true);
    expect(shouldRetryLiveCheckAttempt({
      method: 'GET',
      status: 502,
      attempt: 1,
      maxAttempts: 3,
    })).toBe(true);
    expect(shouldRetryLiveCheckAttempt({
      method: 'POST',
      detail: 'This operation was aborted',
      attempt: 1,
      maxAttempts: 3,
    })).toBe(false);
    expect(shouldRetryLiveCheckAttempt({
      method: 'GET',
      status: 404,
      attempt: 1,
      maxAttempts: 3,
    })).toBe(false);
  });

  it('detects generic starter surfaces without blocking normal product CTAs', async () => {
    const { hasGenericStarterSurface } = await import('./canary-render-engineering');

    expect(hasGenericStarterSurface('Baljia App Your app, generated. Yours to keep. Get started Sign in')).toBe(true);
    expect(hasGenericStarterSurface('Welcome This is your authenticated app shell. Specialist agents will add features here as you describe them in chat.')).toBe(true);
    expect(hasGenericStarterSurface('Your database You have your own isolated Neon Postgres. Schema lives in db/schema.ts.')).toBe(true);
    expect(hasGenericStarterSurface('AI is pre-wired Import anthropic or openai from @/lib/ai - official SDK pointed at Baljia gateway.')).toBe(true);
    expect(hasGenericStarterSurface('VendorOS dashboard Get started with vendor onboarding Sign in to approve documents')).toBe(false);
  });

  it('requires auth canaries to prove the signed-in product surface is not the skeleton shell', async () => {
    const { CANARY_SCENARIOS, formatBrowserUiContract } = await import('./canary-render-engineering');
    const course = CANARY_SCENARIOS.find((scenario) => scenario.id === 'ai-course-marketplace');
    expect(course).toBeTruthy();

    const contract = formatBrowserUiContract(course!).join('\n');
    expect(contract).toContain('browser journey "signup reaches product-specific marketplace dashboard"');
    expect(contract).toContain('start /sign-up');
    expect(contract).toContain('reject visible internal/starter text');
    expect(contract).toContain('Specialist agents');
    expect(contract).toContain('db/schema\\.ts');
  });

  it('separates externally working products from orchestration/reporting failures', async () => {
    const { blockerForReport, classifyCanaryTerminalState, productContractGate, shouldAutoReplayCanaryReport } = await import('./canary-render-engineering');

    expect(productContractGate([
      { name: 'required live API contract', ok: true, detail: 'passed' },
      { name: 'browser UI contract', ok: true, detail: 'passed' },
    ])).toEqual({ ok: true, reason: null });
    expect(productContractGate([
      { name: 'required live API contract', ok: false, detail: 'POST /api/canary-vendors HTTP 404' },
    ])).toMatchObject({
      ok: false,
      reason: expect.stringContaining('POST /api/canary-vendors'),
    });
    expect(classifyCanaryTerminalState({ ok: true, productReady: true })).toBe('PASS');
    expect(classifyCanaryTerminalState({ ok: false, productReady: true })).toBe('PRODUCT_PASS_ORCHESTRATION_FAIL');
    expect(classifyCanaryTerminalState({ ok: false, productReady: false })).toBe('FAIL');
    expect(shouldAutoReplayCanaryReport({ ok: false, productReady: true, taskId: 'task-123' } as never)).toBe(true);
    expect(shouldAutoReplayCanaryReport({ ok: false, productReady: false, taskId: 'task-123' } as never)).toBe(false);
    expect(shouldAutoReplayCanaryReport({ ok: true, productReady: true, taskId: 'task-123' } as never)).toBe(false);
    expect(blockerForReport({
      ok: false,
      terminalState: 'PRODUCT_PASS_ORCHESTRATION_FAIL',
      productReady: true,
      missingCriticalTools: ['verify_user_journey'],
      deterministicChecks: [{ name: 'design_audit clean', ok: false, detail: 'missing' }],
      completionGateReason: 'old agent gate reason',
      productContractReason: null,
      browserUiChecks: [],
      dbTableChecks: [],
      requiredFileChecks: [],
    } as never)).toContain('working product; orchestration incomplete');

    expect(blockerForReport({
      ok: false,
      terminalState: 'FAIL',
      productReady: false,
      urls: { renderServiceId: null, githubRepo: null },
      missingCriticalTools: ['match_capabilities'],
      deterministicChecks: [],
      completionGateReason: 'Task failed before completion: verification_reject',
      productContractReason: 'required live API contract: GET / HTTP 404',
      browserUiChecks: [],
      dbTableChecks: [],
      requiredFileChecks: [],
    } as never)).toContain('pre-implementation failure: Task failed before completion');

    expect(blockerForReport({
      ok: false,
      terminalState: 'FAIL',
      productReady: false,
      urls: { renderServiceId: 'srv-test', githubRepo: 'org/repo' },
      missingCriticalTools: [],
      deterministicChecks: [],
      completionGateReason: 'RENDER_DEPLOY_BLOCKED_RECENT_PIPELINE_MINUTES_EXHAUSTED\nRender service srv-test has a recent pipeline_minutes_exhausted event.',
      productContractReason: 'required live API contract: GET / HTTP 404',
      browserUiChecks: [],
      dbTableChecks: [],
      requiredFileChecks: [],
      completionGateEvents: [],
    } as never)).toContain('external Render quota blocker: pipeline_minutes_exhausted');
  });

  it('treats wrapped canary DB read failures as transient so reports can recover', async () => {
    const { errorMessageOf, isTransientDbReadError } = await import('./canary-render-engineering');
    const wrapped = new Error('Failed query: select "id" from "tasks" where "tasks"."id" = $1');
    (wrapped as Error & { cause?: unknown }).cause = Object.assign(new Error('getaddrinfo ENOTFOUND db.example.internal'), {
      code: 'ENOTFOUND',
    });

    expect(errorMessageOf(wrapped)).toContain('ENOTFOUND');
    expect(isTransientDbReadError(wrapped)).toBe(true);
    expect(isTransientDbReadError(new Error('Failed query: select "id" from "tasks" where "tasks"."id" = $1'))).toBe(true);
    expect(isTransientDbReadError(new Error('syntax error at or near "from"'))).toBe(false);
  });

  it('does not treat healthy framework text as a runtime overlay', async () => {
    const { hasCanaryFrameworkErrorOverlay } = await import('./canary-render-engineering');
    expect(hasCanaryFrameworkErrorOverlay('Built with Next.js, Neon, Better Auth, and Stripe.')).toBe(false);
    expect(hasCanaryFrameworkErrorOverlay('Unhandled Runtime Error: Cannot read properties of undefined')).toBe(true);
    expect(hasCanaryFrameworkErrorOverlay('Application error: a client-side exception has occurred while loading this page.')).toBe(true);
  });

  it('blocks existing-app extension canaries unless the baseline passed strict verification', async () => {
    const { baselineCanaryStatus } = await import('./canary-render-engineering');
    expect(baselineCanaryStatus('completed', 'completed', null).ok).toBe(true);
    expect(baselineCanaryStatus('failed', 'completed', null).reason).toMatch(/baseline task status/i);
    expect(baselineCanaryStatus('completed', 'failed', null).reason).toMatch(/baseline execution status/i);
    expect(baselineCanaryStatus('completed', 'completed', 'missing browser proof').reason).toMatch(/completion gate blocked/i);
  });
});
