import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
  companies: {},
  tasks: {},
  taskExecutions: {},
  failureFingerprints: {},
}));

const indexBody = readFileSync(resolve(__dirname, '../../../../.claude/skills/design-systems/INDEX.md'), 'utf8');

describe('matchDesignSystemsFromIndex', () => {
  it('matches fintech/payment briefs to finance-grade systems', async () => {
    const { matchDesignSystemsFromIndex } = await import('./engineering.tools');
    const matches = matchDesignSystemsFromIndex(
      indexBody,
      'Build a fintech invoicing and payment dashboard for small businesses with billing analytics.',
      { limit: 5 },
    );
    const names = matches.map((m) => m.entry.name);
    expect(names.some((name) => ['stripe', 'coinbase', 'wise', 'revolut', 'mastercard'].includes(name))).toBe(true);
  });

  it('matches AI agent briefs to AI/developer references', async () => {
    const { matchDesignSystemsFromIndex } = await import('./engineering.tools');
    const matches = matchDesignSystemsFromIndex(
      indexBody,
      'Build an AI agent copilot dashboard for engineering teams with chat, runs, and deployment status.',
      { limit: 5 },
    );
    const names = matches.map((m) => m.entry.name);
    expect(names.some((name) => ['openai', 'claude', 'linear-app', 'vercel', 'replicate'].includes(name))).toBe(true);
  });

  it('honors a preferred category hint', async () => {
    const { matchDesignSystemsFromIndex } = await import('./engineering.tools');
    const matches = matchDesignSystemsFromIndex(
      indexBody,
      'Build a structured admin dashboard with reporting and workflow controls.',
      { preferredCategory: 'Professional & Corporate', limit: 3 },
    );
    expect(matches[0]?.entry.category).toBe('Professional & Corporate');
  });
});

describe('Render deployment guardrails', () => {
  it('uses a Render-safe Next.js skeleton build command', async () => {
    const { RENDER_NEXTJS_BUILD_COMMAND, RENDER_NEXTJS_START_COMMAND, getEngineeringTools } = await import('./engineering.tools');
    expect(RENDER_NEXTJS_BUILD_COMMAND).toContain('--no-frozen-lockfile');
    expect(RENDER_NEXTJS_BUILD_COMMAND).toContain('--prod=false');
    expect(RENDER_NEXTJS_BUILD_COMMAND).not.toContain('pnpm db:push');
    expect(RENDER_NEXTJS_START_COMMAND).toContain('0.0.0.0');
    expect(RENDER_NEXTJS_START_COMMAND).toContain('$PORT');

    const createService = getEngineeringTools().find((tool) => tool.name === 'render_create_service');
    expect(createService?.description).toContain(RENDER_NEXTJS_BUILD_COMMAND);
    expect(JSON.stringify(createService?.input_schema)).toContain('health_check_path');
  });

  it('blocks Render service config masquerading as env vars', async () => {
    const { findRenderConfigEnvKeys, getEngineeringTools } = await import('./engineering.tools');
    expect(findRenderConfigEnvKeys([
      { key: 'BUILD_COMMAND' },
      { key: 'DATABASE_URL' },
      { key: 'start_command' },
    ])).toEqual(['BUILD_COMMAND', 'START_COMMAND']);

    const setEnv = getEngineeringTools().find((tool) => tool.name === 'render_set_env_vars');
    expect(setEnv?.description).toContain('BUILD_COMMAND');
    expect(setEnv?.description).toContain('rejected');

    const updateConfig = getEngineeringTools().find((tool) => tool.name === 'render_update_service_config');
    expect(updateConfig?.description).toContain('health check path');
    expect(JSON.stringify(updateConfig?.input_schema)).toContain('start_command');
  });

  it('uses actual Render URL until a custom domain is verified', async () => {
    const { chooseRenderAppUrlAfterDomain } = await import('./engineering.tools');
    expect(chooseRenderAppUrlAfterDomain({
      requestedUrl: 'https://example.baljia.app',
      actualRenderUrl: 'https://example-abc.onrender.com',
      customDomain: 'example.baljia.app',
      customDomainStatus: 'pending',
    })).toBe('https://example-abc.onrender.com');

    expect(chooseRenderAppUrlAfterDomain({
      requestedUrl: 'https://example.baljia.app',
      actualRenderUrl: 'https://example-abc.onrender.com',
      customDomain: 'example.baljia.app',
      customDomainStatus: 'verified',
    })).toBe('https://example.baljia.app');
  });

  it('patches skeleton storage helper away from Node 26 Blob/BodyInit Buffer errors', async () => {
    const { patchStorageTemplateForNode26 } = await import('./engineering.tools');
    const source = [
      'type StorageProvider = "uploadthing" | "r2" | "vercel-blob" | "local";',
      'function detectProvider(): StorageProvider { return "local"; }',
      'async function uploadToUploadthing(file: File | Buffer, filename: string, options?: { contentType?: string }) {',
      'const blob = file instanceof Buffer',
      '    ? new Blob([file], { type: options?.contentType || "application/octet-stream" })',
      '    : file;',
      '}',
      'async function uploadToR2(file: File | Buffer) {',
      'const body = file instanceof Buffer ? file : Buffer.from(await file.arrayBuffer());',
      'return fetch("https://example.com", { method: "PUT", body });',
      '}',
      'async function uploadToVercelBlob(file: File | Buffer) {',
      'const body = file instanceof Buffer ? file : Buffer.from(await file.arrayBuffer());',
      'return fetch("https://example.com", { method: "PUT", body });',
      '}',
      'async function uploadToLocal(file: File | Buffer) {',
      'const body = file instanceof Buffer ? file : Buffer.from(await file.arrayBuffer());',
      'return body.length;',
      '}',
    ].join('\n');
    const patched = patchStorageTemplateForNode26(source);
    expect(patched).toContain('async function toArrayBuffer(file: File | Buffer): Promise<ArrayBuffer>');
    expect(patched).toContain('const ab = new ArrayBuffer(file.byteLength)');
    expect(patched).toContain('return (file as File).arrayBuffer()');
    expect(patched).toContain('function toBlob(ab: ArrayBuffer, contentType: string): Blob');
    expect(patched).toContain('return new Blob([ab]');
    expect(patched).toContain('body: blob');
    expect(patched).toContain('Buffer.from(ab)');
    expect(patched).toContain('size: ab.byteLength');
    expect(patched).not.toContain('.buffer.slice');
    expect(patched).not.toContain('new Blob([file]');
    expect(patched).not.toContain('body = file instanceof Buffer ? file');
    expect(patched).not.toContain('Buffer.from(await file.arrayBuffer())');
  });

  it('removes tw-animate-css import when the package is unavailable', async () => {
    const { patchMissingTwAnimateCssImport } = await import('./engineering.tools');
    const globals = '@import "tailwindcss";\n@import "tw-animate-css";\n\n:root { --bg: #000; }\n';
    const withoutDep = '{"dependencies":{"next":"15.1.6"}}';
    const withDep = '{"dependencies":{"next":"15.1.6","tw-animate-css":"^1.0.0"}}';

    expect(patchMissingTwAnimateCssImport(globals, withoutDep)).not.toContain('tw-animate-css');
    expect(patchMissingTwAnimateCssImport(globals, withDep)).toContain('@import "tw-animate-css";');
  });

  it('builds default founder env vars for AI and payment-ready skeleton routes', async () => {
    const { platformProvidedFounderEnvVars } = await import('./engineering.tools');
    const env = platformProvidedFounderEnvVars({
      GEMINI_API_KEY: 'gemini-key',
    } as unknown as NodeJS.ProcessEnv);

    expect(env.AI_GATEWAY_URL).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(env.AI_GATEWAY_TOKEN).toBe('gemini-key');
    expect(env.GEMINI_API_KEY).toBe('gemini-key');
    expect(env.AI_TEXT_MODEL).toBe('gemini-2.5-flash');
    expect(env.AI_JSON_MODEL).toBe('gemini-2.5-flash');
    expect(env.AI_EMBEDDING_MODEL).toBe('gemini-embedding-001');
    expect(env.AI_EMBEDDING_DIMENSIONS).toBe('3072');
    expect(env.STRIPE_SECRET_KEY).toMatch(/^sk_test_placeholder/);
    expect(env.STRIPE_WEBHOOK_SECRET).toMatch(/^whsec_placeholder/);
  });

  it('pins founder app AI env to Gemini even if platform gateway env points elsewhere', async () => {
    const { platformProvidedFounderEnvVars } = await import('./engineering.tools');
    const env = platformProvidedFounderEnvVars({
      AI_GATEWAY_URL: 'https://ai.baljia.app/v1',
      AI_GATEWAY_TOKEN: 'baljia-token',
      GEMINI_API_KEY: 'gemini-key',
    } as unknown as NodeJS.ProcessEnv);

    expect(env.AI_GATEWAY_URL).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(env.AI_GATEWAY_TOKEN).toBe('gemini-key');
    expect(env.AI_TEXT_MODEL).toBe('gemini-2.5-flash');
  });

  it('pins founder app embeddings to Gemini regardless of platform gateway env', async () => {
    const { hasKnownBadRagEmbeddingGuidance, platformEmbeddingGuidance } = await import('./engineering.tools');

    expect(platformEmbeddingGuidance({
      AI_GATEWAY_URL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    })).toMatchObject({
      gateway: 'google-openai-compatible',
      model: 'gemini-embedding-001',
      dimensions: 3072,
    });

    expect(platformEmbeddingGuidance({
      AI_GATEWAY_URL: 'https://ai.baljia.app/v1',
    })).toMatchObject({
      gateway: 'google-openai-compatible',
      model: 'gemini-embedding-001',
      dimensions: 3072,
    });

    const googleEnv = { AI_GATEWAY_URL: 'https://generativelanguage.googleapis.com/v1beta/openai' };
    expect(hasKnownBadRagEmbeddingGuidance(
      { productContext: 'Use text-embedding-3-small with vector(1536).' },
      googleEnv,
    )).toBe(true);
    expect(hasKnownBadRagEmbeddingGuidance(
      { productContext: 'Existing DB has legacy vector(1536); do not use embeddings until migrated. Use ILIKE fallback for search.' },
      googleEnv,
    )).toBe(false);
    expect(hasKnownBadRagEmbeddingGuidance(
      { productContext: 'For RAG, choose embedding model/dimensions from AI_GATEWAY_URL: Google generativelanguage /v1beta/openai uses gemini-embedding-001 with vector(3072); Baljia/OpenAI-compatible uses text-embedding-3-small with vector(1536). Never use text-embedding-004/768-dim unless verified live.' },
      googleEnv,
    )).toBe(true);
    expect(hasKnownBadRagEmbeddingGuidance(
      { productContext: 'Use gemini-embedding-001 with vector(3072).' },
      googleEnv,
    )).toBe(false);
  });

  it('does not treat normal framework marketing text as a browser error overlay', async () => {
    const { hasFrameworkErrorOverlay } = await import('./engineering.tools');

    expect(hasFrameworkErrorOverlay('Built with Baljia, Next.js, Neon, Better Auth, and Stripe.')).toBe(false);
    expect(hasFrameworkErrorOverlay('Unhandled Runtime Error: Cannot read properties of undefined')).toBe(true);
    expect(hasFrameworkErrorOverlay('Application error: a client-side exception has occurred while loading this page.')).toBe(true);
  });

  it('detects generic starter surfaces and semantic browser actions', async () => {
    const { hasGenericStarterSurface, normalizeBrowserActionLabels } = await import('./engineering.tools');

    expect(hasGenericStarterSurface('Baljia App Your app, generated. Yours to keep. Get started Sign in')).toBe(true);
    expect(hasGenericStarterSurface('Welcome This is your authenticated app shell. Specialist agents will add features here as you describe them in chat.')).toBe(true);
    expect(hasGenericStarterSurface('Your database You have your own isolated Neon Postgres. Schema lives in db/schema.ts.')).toBe(true);
    expect(hasGenericStarterSurface('AI is pre-wired Import anthropic or openai from @/lib/ai - official SDK pointed at Baljia gateway.')).toBe(true);
    expect(hasGenericStarterSurface('Billing dashboard Get started with account setup Sign in to manage invoices')).toBe(false);
    expect(normalizeBrowserActionLabels([
      { text: 'Approve vendor' },
      { ariaLabel: 'Upload document' },
      { value: 'Submit booking' },
      { href: 'https://example.com/checkout', title: 'Checkout link' },
    ])).toEqual(expect.arrayContaining([
      'Approve vendor',
      'Upload document',
      'Submit booking',
      'Checkout link',
    ]));
  });

  it('extracts exact task browser contracts without splitting regex alternations', async () => {
    const { extractTaskBrowserUiContract } = await import('./engineering.tools');
    const contract = extractTaskBrowserUiContract({
      description: [
        'Exact browser/UI contract the deployed app must satisfy:',
        '- AI document analyzer browser surface',
        '  required text patterns: document | analy[sz]e|extract|summary | history|stored | search|RAG',
        '  required action/button patterns: upload|submit|add|save | analy[sz]e|extract|summarize | search',
      ].join('\n'),
    } as never);

    expect(contract.requiredText).toEqual([
      'document',
      'analy[sz]e|extract|summary',
      'history|stored',
      'search|RAG',
    ]);
    expect(contract.requiredButtons).toEqual([
      'upload|submit|add|save',
      'analy[sz]e|extract|summarize',
      'search',
    ]);
  });

  it('rejects pgvector ANN index plans for 3072-dim embeddings', async () => {
    const { hasKnownBadRagEmbeddingGuidance, platformEmbeddingGuidance } = await import('./engineering.tools');
    const googleEnv = { AI_GATEWAY_URL: 'https://generativelanguage.googleapis.com/v1beta/openai' };

    expect(platformEmbeddingGuidance(googleEnv).note).toContain('do not create ivfflat/hnsw indexes on vector(3072)');
    expect(hasKnownBadRagEmbeddingGuidance({
      productContext: 'Use gemini-embedding-001 with vector(3072) and CREATE INDEX documents_embedding_idx USING ivfflat (embedding vector_cosine_ops).',
    }, googleEnv)).toBe(true);
    expect(hasKnownBadRagEmbeddingGuidance({
      productContext: 'Use gemini-embedding-001 with vector(3072). Do not create ivfflat/hnsw indexes on vector(3072); exact scan is fine for the canary dataset.',
    }, googleEnv)).toBe(false);
  });
});

describe('Migration SQL splitting', () => {
  it('splits benign multi-statement migrations', async () => {
    const { splitMigrationStatements } = await import('./engineering.tools');
    expect(splitMigrationStatements('CREATE TABLE a (id uuid); CREATE INDEX a_id_idx ON a(id);')).toEqual([
      'CREATE TABLE a (id uuid)',
      'CREATE INDEX a_id_idx ON a(id)',
    ]);
  });

  it('ignores trailing semicolons and comment-only tails', async () => {
    const { splitMigrationStatements } = await import('./engineering.tools');
    expect(splitMigrationStatements('CREATE TABLE a (id uuid); -- done;')).toEqual([
      'CREATE TABLE a (id uuid)',
    ]);
  });

  it('does not split semicolons inside strings or dollar-quoted blocks', async () => {
    const { splitMigrationStatements } = await import('./engineering.tools');
    const sql = [
      "INSERT INTO notes (body) VALUES ('alpha; beta');",
      "CREATE FUNCTION f() RETURNS text AS $$ BEGIN RETURN 'x;y'; END; $$ LANGUAGE plpgsql;",
    ].join('\n');
    expect(splitMigrationStatements(sql)).toHaveLength(2);
  });

  it('classifies transient Neon HTTP failures for retry', async () => {
    const { isTransientNeonHttpError } = await import('./engineering.tools');
    expect(isTransientNeonHttpError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientNeonHttpError(new Error('read ECONNRESET'))).toBe(true);
    expect(isTransientNeonHttpError(new Error('syntax error at or near "CREATEE"'))).toBe(false);
  });

  it('uniquifies fixed interaction email values for repeatable browser proofs', async () => {
    const { interactionValue } = await import('./engineering.tools');
    expect(interactionValue('vendor_email', 'ui-vendor@example.com', 'stamp123')).toBe('ui-vendor+stamp123@example.com');
    expect(interactionValue('company_name', 'UI Vendor Supplies', 'stamp123')).toBe('UI Vendor Supplies');
    expect(interactionValue('vendor_email', 'ui-vendor-<timestamp>@example.com', 'stamp123')).toBe('ui-vendor-stamp123@example.com');
  });
});

describe('Engineering capability planning tools', () => {
  it('registers capability planner tools alongside design tools', async () => {
    const { getEngineeringTools } = await import('./engineering.tools');
    const names = getEngineeringTools().map((tool) => tool.name);

    expect(names).toContain('match_capabilities');
    expect(names).toContain('get_capability_pack');
    expect(names).toContain('compose_app_architecture');
    expect(names).toContain('list_capability_packs');
    expect(names).toContain('match_reference_repos');
    expect(names).toContain('get_reference_repo_patterns');
    expect(names).toContain('retrieve_component_examples');
    expect(names).toContain('verify_interaction_contract');

    const planner = getEngineeringTools().find((tool) => tool.name === 'match_capabilities');
    expect(planner?.description).toContain('CEO-assigned');
    expect(JSON.stringify(planner?.input_schema)).toContain('workflows');

    const references = getEngineeringTools().find((tool) => tool.name === 'match_reference_repos');
    expect(references?.description).toContain('patterns only');
    expect(JSON.stringify(references?.input_schema)).toContain('capabilities');

    const interactionVerifier = getEngineeringTools().find((tool) => tool.name === 'verify_interaction_contract');
    expect(interactionVerifier?.description).toContain('button/form proof');
    expect(JSON.stringify(interactionVerifier?.input_schema)).toContain('critical_kind');
    expect(JSON.stringify(interactionVerifier?.input_schema)).toContain('auth_session');
  });

  it('emits deterministic planning evidence markers from planning tools', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');
    const task = {
      title: 'Build AI course marketplace',
      description: 'Teachers upload lessons, students subscribe, AI summarizes lessons, and admins approve content.',
      company_id: 'company-1',
    } as never;

    await expect(handleEngineeringTool('match_capabilities', {}, task)).resolves.toContain('CAPABILITY_MATCH_EVIDENCE');
    await expect(handleEngineeringTool('get_capability_pack', { id: 'marketplace' }, task)).resolves.toContain('CAPABILITY_PACK_EVIDENCE id=marketplace');
    await expect(handleEngineeringTool('match_reference_repos', { capabilities: ['marketplace', 'dashboard'] }, task)).resolves.toContain('REFERENCE_MATCH_EVIDENCE');
    await expect(handleEngineeringTool('get_reference_repo_patterns', { id: 'shadcn-dashboard-patterns' }, task)).resolves.toContain('REFERENCE_PATTERN_EVIDENCE id=shadcn-dashboard-patterns');
    await expect(handleEngineeringTool('retrieve_component_examples', { capabilities: ['marketplace', 'dashboard'] }, task)).resolves.toContain('COMPONENT_EXAMPLE_EVIDENCE');
    await expect(handleEngineeringTool('compose_app_architecture', {
      capabilities: ['marketplace', 'dashboard', 'deployment_render'],
      reference_patterns: ['shadcn-dashboard-patterns'],
      design_system: 'linear-app',
    }, task)).resolves.toContain('ARCHITECTURE_PLAN_EVIDENCE');
    await expect(handleEngineeringTool('compose_frontend_plan', {
      task_title: 'Build booking app',
      domain_ids: ['local_service_booking'],
      capabilities: ['booking', 'crud', 'deployment_render'],
    }, task)).resolves.toContain('INTERACTION_CONTRACT_EVIDENCE');
  });

  it('does not force hidden scenario capabilities from task description prose', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');
    const task = {
      title: 'Build simple operations dashboard',
      description: [
        'Users create and review internal status records.',
        'Required scenario capabilities: payments_stripe, booking, email_notifications.',
      ].join('\n'),
      company_id: 'company-1',
    } as never;

    const result = await handleEngineeringTool('match_capabilities', {}, task);

    expect(result).toContain('CAPABILITY_MATCH_EVIDENCE');
    expect(result).not.toContain('payments_stripe');
    expect(result).not.toContain('booking');
    expect(result).not.toContain('email_notifications');
  });

  it('keeps product contract after harness planning text without importing unrelated integrations', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');
    const task = {
      title: 'Build vendor compliance portal',
      description: [
        'Build and deploy this app: Vendor compliance portal.',
        '',
        'Use the normal Engineering app-build workflow before implementation:',
        '1. Call list_skills and read relevant skills for frontend, Neon/Postgres, Render, verification, Stripe/payments, uploads, AI/RAG, realtime/cron/email when applicable.',
        '2. Call match_capabilities with domain/product context.',
        '',
        'Required app surface:',
        '- Vendors upload insurance documents.',
        '- Admins approve submissions on an operations dashboard.',
        '',
        'Exact live API contract the deployed app must satisfy:',
        '- POST /api/vendors accepts vendor_email and company_name.',
      ].join('\n'),
      company_id: 'company-1',
    } as never;

    const result = await handleEngineeringTool('match_capabilities', {}, task);

    expect(result).toContain('uploads_storage');
    expect(result).toContain('admin_workflow');
    expect(result).toContain('dashboard');
    expect(result).not.toContain('payments_stripe');
    expect(result).not.toContain('ai_openai');
    expect(result).not.toContain('email_notifications');
  });

  it('rejects known-bad RAG embedding plans before emitting architecture evidence', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');
    const previousGateway = process.env.AI_GATEWAY_URL;
    process.env.AI_GATEWAY_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
    const task = {
      title: 'Build AI document analyzer',
      description: 'Upload documents and search them with RAG.',
      company_id: 'company-1',
    } as never;

    try {
      const result = await handleEngineeringTool('compose_app_architecture', {
        capabilities: ['rag_search', 'crud', 'dashboard', 'deployment_render'],
        product_context: 'Use text-embedding-3-small with vector 1536 dims for document search.',
        reference_patterns: ['vercel-ai-chatbot-patterns'],
        design_system: 'linear-app',
      }, task);

      expect(result).toContain('rejected a known-bad RAG embedding plan');
      expect(result).toContain('gemini-embedding-001');
      expect(result).toContain('3072');
      expect(result).not.toContain('ARCHITECTURE_PLAN_EVIDENCE');
    } finally {
      if (previousGateway === undefined) {
        delete process.env.AI_GATEWAY_URL;
      } else {
        process.env.AI_GATEWAY_URL = previousGateway;
      }
    }
  });

  it('does not reject corrected RAG architecture guidance as a false positive', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');
    const previousGateway = process.env.AI_GATEWAY_URL;
    process.env.AI_GATEWAY_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
    const task = {
      title: 'Extend existing app with billing and RAG document search',
      description: 'An existing NoteKeeper app needs billing, RAG document search, and an admin dashboard without replacing the existing product.',
      company_id: 'company-1',
    } as never;

    try {
      const result = await handleEngineeringTool('compose_app_architecture', {
        capabilities: ['deployment_render', 'crud', 'rag_search', 'uploads_storage', 'ai_openai', 'auth', 'dashboard', 'admin_workflow', 'payments_stripe'],
        product_context: [
          'Use gemini-embedding-001 with vector(3072) on the Google OpenAI-compatible gateway.',
          'Never use text-embedding-004/768-dim or text-embedding-3-small/1536-dim for founder apps.',
          'Do not create ivfflat/hnsw indexes on vector(3072); use exact scan for small canary data.',
        ].join(' '),
        reference_patterns: ['vercel-ai-chatbot-patterns'],
        design_system: 'linear-app',
      }, task);

      expect(result).toContain('ARCHITECTURE_PLAN_EVIDENCE');
      expect(result).toContain('gemini-embedding-001');
      expect(result).toContain('vector(3072)');
      expect(result).not.toContain('rejected generated known-bad RAG embedding guidance');
    } finally {
      if (previousGateway === undefined) {
        delete process.env.AI_GATEWAY_URL;
      } else {
        process.env.AI_GATEWAY_URL = previousGateway;
      }
    }
  });
});

describe('browser visual contrast audit', () => {
  it('catches unreadable buttons, text, and native select options', async () => {
    const { chromium } = await import('@playwright/test');
    const { auditPageVisualContrast, contrastRatioForCssColors } = await import('../browser-visual-audit');

    expect(contrastRatioForCssColors('rgb(255, 255, 255)', 'rgb(255, 255, 255)')).toBeCloseTo(1);
    expect(contrastRatioForCssColors('rgb(255, 255, 255)', 'rgb(10, 10, 10)') ?? 0).toBeGreaterThan(10);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <main style="background: #050505; padding: 24px">
          <button style="background: #ffffff; color: #ffffff">Manage Vendors</button>
          <p style="background: #111111; color: #111111">Invisible vendor row</p>
          <select style="background: #ffffff; color: #ffffff">
            <option style="background: #ffffff; color: #ffffff">Medium risk</option>
          </select>
          <div role="listbox" style="background: #ffffff; color: #ffffff">
            <div role="option" style="background: #ffffff; color: #ffffff">High risk</div>
          </div>
          <button style="background: #111111; color: #eeeeee">
            <svg aria-hidden="true" width="16" height="16"><path d="M1 1h10v10H1z"></path></svg>
          </button>
        </main>
      `);

      const issues = await auditPageVisualContrast(page);
      const issueText = issues.map((issue) => `${issue.kind}:${issue.text}`).join('\n');

      expect(issueText).toContain('control:Manage Vendors');
      expect(issueText).toContain('text:Invisible vendor row');
      expect(issueText).toContain('control:Medium risk');
      expect(issues.some((issue) => issue.kind === 'select-option')).toBe(true);
      expect(issues.some((issue) => issue.kind === 'custom-option' && issue.text === 'High risk')).toBe(true);
      expect(issues.some((issue) => issue.kind === 'icon-control')).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
