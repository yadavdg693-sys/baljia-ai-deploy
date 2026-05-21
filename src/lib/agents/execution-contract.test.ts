import { describe, expect, it } from 'vitest';
import {
  engineeringContractBlockReason,
  formatExecutionContractForPrompt,
  hasCompleteExecutionContract,
  requiresExecutionContractForEngineering,
  validateExecutionContract,
} from './execution-contract';

const completeContract = {
  version: 1,
  intent: 'new_app',
  assigned_agent_id: 30,
  confirmation_source: 'founder_confirmed',
  founder_visible_summary: 'Build a project operations app.',
  product_scope: 'Users sign in, create projects, track schedules, bids, safety logs, and equipment.',
  assumptions: ['Founder accepted the default construction ops MVP.'],
  open_questions: [],
  user_flow: ['Sign up', 'Create project', 'Add schedule, bid, safety log, and equipment records', 'Review dashboard'],
  screens: ['Landing', 'Auth', 'Dashboard', 'Project detail'],
  data_fields: ['project.name', 'project.start_date', 'bid.amount', 'safety_log.hazard', 'equipment.name'],
  api_actions: ['POST /auth/signup', 'POST /projects', 'POST /projects/:id/safety-logs'],
  integrations: [],
  acceptance_criteria: ['Created records persist and reappear after refresh.'],
  out_of_scope: ['Payments'],
  ui_freedom: true,
};

describe('execution contract', () => {
  it('accepts a complete CEO-owned Engineering contract', () => {
    expect(validateExecutionContract(completeContract, { expectedAgentId: 30 }).ok).toBe(true);
    expect(hasCompleteExecutionContract(completeContract)).toBe(true);
  });

  it('does not require CEO to provide repo layout for old or lightweight contracts', () => {
    const result = validateExecutionContract(completeContract, { expectedAgentId: 30 });

    expect(result.ok).toBe(true);
  });

  it('adds default Next.js repo layout guidance to the Engineering prompt', () => {
    const prompt = formatExecutionContractForPrompt(completeContract);

    expect(prompt).toContain('Repo layout');
    expect(prompt).toContain('app/<route>/page.tsx');
    expect(prompt).toContain('app/api/<feature>/route.ts');
    expect(prompt).toContain('components/<feature>/');
    expect(prompt).toContain('lib/<feature>/');
    expect(prompt).toContain('db/schema.ts');
  });

  it('uses CEO-provided repo layout when present', () => {
    const prompt = formatExecutionContractForPrompt({
      ...completeContract,
      repo_layout: {
        stack: 'nextjs',
        pages: ['app/reports/page.tsx'],
        api_routes: ['app/api/reports/route.ts'],
        components: ['components/reports/ReportTable.tsx'],
        shared_logic: ['lib/reports/service.ts'],
        database: ['db/schema.ts: reports table'],
        tests: ['tests/e2e/reports.spec.ts'],
      },
    });

    expect(prompt).toContain('app/reports/page.tsx');
    expect(prompt).toContain('app/api/reports/route.ts');
    expect(prompt).toContain('components/reports/ReportTable.tsx');
  });

  it('accepts common camelCase repo layout aliases from tool calls', () => {
    const prompt = formatExecutionContractForPrompt({
      ...completeContract,
      repo_layout: {
        stack: 'nextjs',
        pages: ['app/reports/page.tsx'],
        apiRoutes: ['app/api/reports/route.ts'],
        components: ['components/reports/ReportTable.tsx'],
        sharedLogic: ['lib/reports/service.ts'],
        database: ['db/schema.ts: reports table'],
        tests: ['tests/e2e/reports.spec.ts'],
      },
    });

    expect(prompt).toContain('app/api/reports/route.ts');
    expect(prompt).toContain('lib/reports/service.ts');
  });

  it('rejects contracts with open questions before Engineering assignment', () => {
    const result = validateExecutionContract({
      ...completeContract,
      open_questions: ['Should it have payments?'],
    }, { expectedAgentId: 30 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('open_questions');
  });

  it('requires contracts for CEO-assigned app and feature builds', () => {
    expect(requiresExecutionContractForEngineering({
      title: 'Build project dashboard',
      description: 'Create the main project app dashboard and CRUD flow.',
      tag: 'feature',
      source: 'ceo_suggested',
      assigned_to_agent_id: 30,
    })).toBe(true);
  });

  it('does not require a product contract for focused repairs', () => {
    expect(requiresExecutionContractForEngineering({
      title: 'Fix signup redirect',
      description: 'Repair the logout redirect bug in the existing app.',
      tag: 'bug-fix',
      source: 'ceo_suggested',
      assigned_to_agent_id: 30,
    })).toBe(false);
  });

  it('returns a pre-start block reason when Engineering product scope is missing', () => {
    const reason = engineeringContractBlockReason({
      title: 'Build construction ops dashboard',
      description: 'Create projects and safety logs.',
      tag: 'mvp',
      source: 'ceo_suggested',
      assigned_to_agent_id: 30,
    });

    expect(reason).toContain('blocked before start');
    expect(reason).toContain('execution_contract');
  });
});
