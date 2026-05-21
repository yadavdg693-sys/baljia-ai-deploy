import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
  agents: {},
  reports: {},
  companies: {},
  tasks: {},
  taskExecutions: {},
}));

import { engineeringCompletionGate } from './agent-factory';
import { shouldAutoFinalizeEngineeringWorkerError } from './runtime/clean-gate-finalizer';

const backendTask = {
  id: 'task-webhook',
  company_id: 'company-1',
  tag: 'engineering',
  title: 'Add webhook ingestion endpoint',
  description: 'Create a backend API endpoint that stores third-party webhook events in Postgres.',
} as never;

const cleanBackendLog = [
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

describe('worker clean-gate auto-finalization', () => {
  it('allows Engineering tasks to finalize after a provider error only when the completion gate is clean', () => {
    expect(shouldAutoFinalizeEngineeringWorkerError({
      agentId: 30,
      logEntries: cleanBackendLog,
      task: backendTask,
      errorSummary: '401 Invalid authentication credentials',
      completionGate: engineeringCompletionGate,
    })).toBe(true);

    expect(shouldAutoFinalizeEngineeringWorkerError({
      agentId: 30,
      logEntries: cleanBackendLog.filter((entry) => entry.tool !== 'verify_db_state'),
      task: backendTask,
      errorSummary: '401 Invalid authentication credentials',
      completionGate: engineeringCompletionGate,
    })).toBe(false);
  });

  it('does not auto-finalize non-Engineering tasks or empty errors', () => {
    expect(shouldAutoFinalizeEngineeringWorkerError({
      agentId: 10,
      logEntries: cleanBackendLog,
      task: backendTask,
      errorSummary: '401 Invalid authentication credentials',
      completionGate: engineeringCompletionGate,
    })).toBe(false);

    expect(shouldAutoFinalizeEngineeringWorkerError({
      agentId: 30,
      logEntries: cleanBackendLog,
      task: backendTask,
      errorSummary: null,
      completionGate: engineeringCompletionGate,
    })).toBe(false);
  });
});
