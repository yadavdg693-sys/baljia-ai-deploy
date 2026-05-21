#!/usr/bin/env tsx

import './load-env-local';
import { desc, eq } from 'drizzle-orm';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import path from 'path';

import { engineeringCompletionGate } from '@/lib/agents/agent-factory';
import { auditPageVisualContrast, formatVisualContrastIssues } from '@/lib/agents/browser-visual-audit';
import { launchTask } from '@/lib/agents/worker-launcher';
import { db, companies, taskExecutions, tasks, users } from '@/lib/db';
import { hasRenderPipelineQuotaSignal } from '@/lib/failure-classification';
import { getCompanyDatabase } from '@/lib/services/neon.service';
import { isDesignCritiqueConfigured } from '@/lib/services/design-critic.service';
import { formatPreflightFailures, preflightCheck } from '@/lib/services/preflight.service';
import {
  contractFieldRequirements,
  missingContractFieldProofs,
  missingContractFlowIds,
  parseAuthIsolationProofEvidence,
  parseContractFieldProofEvidence,
  parseContractFlowProofEvidence,
  parseProductBuildContractEvidence,
} from '@/lib/agents/product-build-contract';
import * as taskService from '@/lib/services/task.service';
import { CANARY_SCENARIOS } from './canary-core-scenarios';
import { EXTENDED_CANARY_SCENARIOS } from './canary-extended-scenarios';
import { writeConfidenceReport } from './canary-confidence-report';
import type { BrowserJourneySpec, BrowserUiCheckSpec, CanaryInteractionSpec, CanaryScenario, LiveCheckSpec } from './canary-scenario-types';

export { CANARY_SCENARIOS } from './canary-core-scenarios';
export type { BrowserJourneySpec, BrowserUiCheckSpec, CanaryInteractionSpec, CanaryScenario, LiveCheckSpec } from './canary-scenario-types';

type ToolCallSummary = {
  toolName: string;
  count: number;
};

type EvidenceCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

type CanaryTerminalState = 'PASS' | 'PRODUCT_PASS_ORCHESTRATION_FAIL' | 'FAIL';

type TaskExecutionRow = {
  id?: string | null;
  status?: string | null;
  turn_count?: number | null;
  error_summary?: string | null;
  execution_log?: unknown;
  verification_evidence?: unknown;
  [key: string]: unknown;
};

type CanaryReport = {
  ok: boolean;
  terminalState: CanaryTerminalState;
  productReady: boolean;
  scenarioId: string;
  runId: string;
  companyId: string;
  companySlug: string;
  taskId: string;
  taskStatus: string | null;
  executionStatus: string | null;
  taskTitle: string;
  executionId: string | null;
  turns: number | null;
  toolCounts: ToolCallSummary[];
  missingCriticalTools: string[];
  urls: {
    canonical: string;
    checkedBase: string;
    renderServiceId: string | null;
    githubRepo: string | null;
  };
  liveChecks: Array<{
    name: string;
    ok: boolean;
    status?: number;
    detail?: string;
  }>;
  browserUiChecks: Array<{
    name: string;
    ok: boolean;
    status?: number | null;
    title?: string;
    screenshotPath?: string;
    missingTextPatterns: string[];
    missingButtonPatterns: string[];
    consoleIssues: string[];
    visualContrastIssues?: string[];
    detail: string;
  }>;
  requiredFileChecks: EvidenceCheck[];
  dbTableChecks: EvidenceCheck[];
  productContractChecks: EvidenceCheck[];
  productContractReason: string | null;
  deterministicChecks: EvidenceCheck[];
  completionGateReason: string | null;
  completionGateEvents: string[];
  failureSummary?: string | null;
  verificationEvidence: unknown;
  reportPath: string;
};

const BASE_CRITICAL_TOOLS = [
  'list_skills',
  'match_capabilities',
  'get_capability_pack',
  'match_reference_repos',
  'get_reference_repo_patterns',
  'retrieve_component_examples',
  'compose_app_architecture',
  'create_instance',
  'match_design_system',
  'get_design_system',
  'render_get_deploy_status',
  'render_get_logs',
  'check_url_health',
  'verify_user_journey',
  'verify_db_state',
  'verify_browser_ui',
  'static_code_scan',
  'review_pushed_code',
  'design_audit',
  'write_codebase_map',
  'create_report',
];

const DEFAULT_CANARY_TASK_TIMEOUT_MS = 90 * 60 * 1000;

export function canaryTaskTimeoutMs(envValue = process.env.CANARY_TASK_TIMEOUT_MS): number {
  if (!envValue) return DEFAULT_CANARY_TASK_TIMEOUT_MS;
  const parsed = Number(envValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CANARY_TASK_TIMEOUT_MS;
}

function stamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, '')
    .toLowerCase();
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env) {
  const scenarioIndex = argv.indexOf('--scenario');
  const runAll = argv.includes('--all');
  const runCore = argv.includes('--core');
  const runExtended = argv.includes('--extended');
  const confidenceRun = argv.includes('--confidence-run');
  const help = argv.includes('--help') || argv.includes('-h');
  const runIdIndex = argv.indexOf('--run-id');
  const replayTaskIndex = argv.indexOf('--replay-task');
  const forceAfterQuotaRestored =
    argv.includes('--force-after-quota-restored') ||
    env.CANARY_FORCE_AFTER_QUOTA_RESTORED === 'true';
  return {
    help,
    runAll,
    runCore,
    runExtended,
    confidenceRun,
    forceAfterQuotaRestored,
    scenarioId: scenarioIndex >= 0 ? argv[scenarioIndex + 1] : null,
    runId: runIdIndex >= 0 ? argv[runIdIndex + 1] : `engineering-world-class-${stamp()}`,
    replayTaskId: replayTaskIndex >= 0 ? argv[replayTaskIndex + 1] : null,
  };
}

export function canaryUsage(): string {
  return [
    'Usage: npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts [options]',
    '',
    'Options:',
    '  --scenario <id>       Run one core or extended scenario',
    '  --core                Run the 7 core scenarios',
    '  --extended            Run the 12 extended scenarios',
    '  --all                 Run all 19 scenarios',
    '  --confidence-run      Run selected scenarios and emit confidence reports',
    '  --replay-task <id>    Replay deterministic checks for a previous task; requires --scenario',
    '  --force-after-quota-restored',
    '                        After operator confirms Render quota is restored, skip only the historical quota-event probe',
    '  --run-id <id>         Override measurement-output run id',
    '  --help, -h            Print this help without launching a canary',
  ].join('\n');
}

function canaryRunnerPreflightOptions(forceAfterQuotaRestored = false) {
  return {
    bypassCache: true,
    renderQuotaEvents: !forceAfterQuotaRestored,
  };
}

export async function assertCanaryRunnerPreflightReady(forceAfterQuotaRestored = false): Promise<void> {
  const result = await preflightCheck(canaryRunnerPreflightOptions(forceAfterQuotaRestored));
  if (!result.ok) {
    throw new Error(formatPreflightFailures(result.failures));
  }
}

async function canaryRunnerPreflightResult(forceAfterQuotaRestored = false) {
  return preflightCheck(canaryRunnerPreflightOptions(forceAfterQuotaRestored));
}

function extractEarliestRetryAfter(failures: Array<{ reason: string }>): string | null {
  for (const failure of failures) {
    const match = failure.reason.match(/(?:^|[;\s])earliest_retry_after=([^;\s]+)/);
    if (match?.[1]) return match[1];
  }
  return null;
}

function preflightRetryCacheEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CANARY_PREFLIGHT_RETRY_CACHE !== 'off' && env.CANARY_PREFLIGHT_RETRY_CACHE !== 'false';
}

function futureRetryAfter(value: unknown, nowMs = Date.now()): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const retryMs = Date.parse(value);
  if (!Number.isFinite(retryMs) || retryMs <= nowMs) return null;
  return value;
}

function hasRenderQuotaPreflightBlock(summary: Record<string, unknown>): boolean {
  const failures = (summary.preflight as { failures?: unknown } | undefined)?.failures;
  if (!Array.isArray(failures)) return false;
  return failures.some((failure) => {
    const candidate = failure as { integration?: unknown; reason?: unknown };
    return candidate.integration === 'render' &&
      typeof candidate.reason === 'string' &&
      candidate.reason.includes('recent pipeline_minutes_exhausted event detected before canary launch');
  });
}

export function cachedCanaryPreflightBlock(
  treeRoot: 'engineering-world-class' | 'engineering-95',
  nowMs = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): Array<{ integration: string; reason: string }> | null {
  const root = path.join(process.cwd(), 'measurement-output', treeRoot);
  if (!existsSync(root)) return null;

  const summaries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() &&
      (env.CANARY_PREFLIGHT_RETRY_CACHE_INCLUDE_UNIT === 'true' || !entry.name.startsWith('unit-')))
    .map((entry) => path.join(root, entry.name, 'summary.json'))
    .filter((summaryPath) => existsSync(summaryPath))
    .map((summaryPath) => ({ summaryPath, mtimeMs: statSync(summaryPath).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 100);

  for (const { summaryPath } of summaries) {
    try {
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
      if (summary.ok !== false || !hasRenderQuotaPreflightBlock(summary)) continue;
      const retryAfter = futureRetryAfter(summary.earliestRetryAfter, nowMs);
      if (!retryAfter) continue;
      return [{
        integration: 'render',
        reason: [
          'cached recent pipeline_minutes_exhausted preflight block is still inside retry window',
          `source_summary=${summaryPath}`,
          `earliest_retry_after=${retryAfter}`,
          'use --force-after-quota-restored only after operator confirms Render quota was restored',
        ].join('; '),
      }];
    } catch {
      continue;
    }
  }

  return null;
}

export function cachedCanaryPreflightBlockForRun(
  treeRoot: 'engineering-world-class' | 'engineering-95',
  forceAfterQuotaRestored: boolean,
  nowMs = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): Array<{ integration: string; reason: string }> | null {
  if (forceAfterQuotaRestored || !preflightRetryCacheEnabled(env)) return null;
  return cachedCanaryPreflightBlock(treeRoot, nowMs, env);
}

function writePreflightBlockedSummary(
  runId: string,
  treeRoot: 'engineering-world-class' | 'engineering-95',
  scenarios: CanaryScenario[],
  failures: Array<{ integration: string; reason: string }>,
) {
  const outputDir = path.join(process.cwd(), 'measurement-output', treeRoot, runId);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const summaryPath = path.join(outputDir, 'summary.json');
  const blocker = formatPreflightFailures(failures);
  const earliestRetryAfter = extractEarliestRetryAfter(failures);
  const summary = {
    runId,
    ok: false,
    passed: 0,
    total: scenarios.length,
    earliestRetryAfter,
    preflight: {
      ok: false,
      failures,
    },
    reports: scenarios.map((scenario) => ({
      scenarioId: scenario.id,
      ok: false,
      terminalState: 'PREFLIGHT_BLOCKED',
      productReady: false,
      taskId: null,
      liveUrl: null,
      reportPath: null,
      blocker,
      earliestRetryAfter,
    })),
  };
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
  return summary;
}

function parseExecutionLog(log: unknown): Record<string, unknown>[] {
  if (Array.isArray(log)) return log as Record<string, unknown>[];
  if (typeof log === 'string') {
    try {
      const parsed = JSON.parse(log);
      return Array.isArray(parsed) ? parsed as Record<string, unknown>[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

function eventToolName(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const record = event as Record<string, unknown>;
  const maybeToolName = record.toolName ?? record.tool_name ?? record.name;
  if (typeof maybeToolName === 'string') return maybeToolName;
  const tool = record.tool;
  if (typeof tool === 'string') return tool;
  if (tool && typeof tool === 'object') {
    const toolRecord = tool as Record<string, unknown>;
    if (typeof toolRecord.name === 'string') return toolRecord.name;
  }
  return null;
}

function summarizeTools(events: unknown[]): ToolCallSummary[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const toolName = eventToolName(event);
    if (!toolName) continue;
    counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([toolName, count]) => ({ toolName, count }))
    .sort((a, b) => b.count - a.count || a.toolName.localeCompare(b.toolName));
}

function eventResultText(event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const record = event as Record<string, unknown>;
  for (const key of ['result', 'output', 'content', 'response', 'error', 'error_summary']) {
    const value = record[key];
    if (typeof value === 'string') return value;
    if (value !== undefined && value !== null) return JSON.stringify(value);
  }
  return JSON.stringify(record);
}

function hasToolResult(events: unknown[], toolName: string, pattern: RegExp): boolean {
  return events.some((event) => eventToolName(event) === toolName && pattern.test(eventResultText(event)));
}

function hasAgentToolResult(events: unknown[], toolName: string, pattern: RegExp): boolean {
  return events.some((event) => {
    if (eventToolName(event) !== toolName) return false;
    const source = event && typeof event === 'object'
      ? (event as Record<string, unknown>).source
      : null;
    if (source === 'canary_runner_db_table_proof') return false;
    return pattern.test(eventResultText(event));
  });
}

function interactionProofCountsFromText(text: string): { passed: number; failed: number } | null {
  const match = text.match(/INTERACTION_PROOF_EVIDENCE[^\n]*passed=(\d+)[^\n]*failed=(\d+)/);
  if (!match) return null;
  return {
    passed: Number(match[1]) || 0,
    failed: Number(match[2]) || 0,
  };
}

function latestInteractionProofCounts(events: unknown[]): { passed: number; failed: number } | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (eventToolName(events[i]) !== 'verify_interaction_contract') continue;
    const counts = interactionProofCountsFromText(eventResultText(events[i]));
    if (counts) return counts;
    if (/^INTERACTION PROOF PASS\b/m.test(eventResultText(events[i]))) {
      return { passed: 1, failed: 0 };
    }
  }
  return null;
}

function hasPassingInteractionProof(events: unknown[], minPassed = 1): boolean {
  const counts = latestInteractionProofCounts(events);
  return counts !== null && counts.failed === 0 && counts.passed >= minPassed;
}

function executionLogOf(execution: TaskExecutionRow | null | undefined): unknown {
  return execution?.execution_log ?? execution?.executionLog;
}

function executionTurnCountOf(execution: TaskExecutionRow | null | undefined): number | null {
  const value = execution?.turn_count ?? execution?.turnCount;
  return typeof value === 'number' ? value : null;
}

function executionErrorSummaryOf(execution: TaskExecutionRow | null | undefined): string | null {
  const value = execution?.error_summary ?? execution?.errorSummary;
  return typeof value === 'string' && value.trim() ? value : null;
}

function executionVerificationEvidenceOf(execution: TaskExecutionRow | null | undefined): unknown {
  return execution?.verification_evidence ?? execution?.verificationEvidence ?? null;
}

export function verificationEvidenceCompletionGateResolved(evidence: unknown): boolean {
  if (!evidence || typeof evidence !== 'object') return false;
  const checks = (evidence as Record<string, unknown>).checks;
  if (!Array.isArray(checks)) return false;
  return checks.some((check) => {
    if (!check || typeof check !== 'object') return false;
    const record = check as Record<string, unknown>;
    return record.name === 'completion_gate_resolved' && record.passed === true;
  });
}

export function selectEvidenceExecution(executions: TaskExecutionRow[]): { execution: TaskExecutionRow | null; events: Record<string, unknown>[] } {
  let best: { execution: TaskExecutionRow; events: Record<string, unknown>[]; score: number } | null = null;
  const mergedEvents: Record<string, unknown>[] = [];

  for (const execution of [...executions].reverse()) {
    mergedEvents.push(...parseExecutionLog(executionLogOf(execution)));
  }

  for (const execution of executions) {
    const events = parseExecutionLog(executionLogOf(execution));
    const toolCount = events.filter((event) => eventToolName(event)).length;
    const completedBonus = execution.status === 'completed' ? 1_000_000 : 0;
    const failedBonus = execution.status === 'failed' ? 500_000 : 0;
    const score = toolCount * 100 + events.length + completedBonus + failedBonus;
    if (!best || score > best.score) best = { execution, events, score };
  }

  return {
    execution: best?.execution ?? executions[0] ?? null,
    events: mergedEvents.length > 0
      ? mergedEvents
      : best?.events ?? parseExecutionLog(executionLogOf(executions[0])),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function errorMessageOf(error: unknown, depth = 0): string {
  if (depth > 4) return String(error);
  if (error instanceof Error) {
    const parts = [error.message];
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause) parts.push(`cause: ${errorMessageOf(cause, depth + 1)}`);
    return parts.join('\n');
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [
      typeof record.message === 'string' ? record.message : null,
      typeof record.code === 'string' ? `code=${record.code}` : null,
      record.cause ? `cause: ${errorMessageOf(record.cause, depth + 1)}` : null,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join('\n');
  }
  return String(error);
}

export function isTransientDbReadError(error: unknown): boolean {
  const message = errorMessageOf(error).toLowerCase();
  if (/connect timeout|connection timeout|econnreset|etimedout|fetch failed|network|socket|terminated|timeout|enotfound|temporarily unavailable/i.test(message)) {
    return true;
  }

  // Drizzle can wrap transient driver failures as only "Failed query: select ...".
  // Canary reporting reads fixed tables with generated SQL, so retrying those
  // read wrappers is safer than falsely scoring a live product as failed.
  return /failed query:\s*select\b/i.test(message);
}

async function retryDbRead<T>(label: string, operation: () => Promise<T>, attempts = 20): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDbReadError(error) || attempt === attempts) break;
      const delayMs = Math.min(30_000, 1_000 * attempt);
      console.warn(`${label} failed transiently; retrying in ${delayMs}ms (${attempt}/${attempts}): ${errorMessageOf(error)}`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function loadTaskExecutionsWithEvidence(taskId: string): Promise<TaskExecutionRow[]> {
  let executions: TaskExecutionRow[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    executions = await retryDbRead(`load task executions for ${taskId}`, async () => (
      await db
        .select()
        .from(taskExecutions)
        .where(eq(taskExecutions.task_id, taskId))
        .orderBy(desc(taskExecutions.started_at))
        .limit(10)
    ) as TaskExecutionRow[]);

    const selected = selectEvidenceExecution(executions);
    if (selected.events.length > 0 || attempt === 7) return executions;
    await sleep(1_500 + attempt * 500);
  }
  return executions;
}

export function relatedTaskIdsOf(task: unknown): string[] {
  if (!task || typeof task !== 'object') return [];
  const record = task as Record<string, unknown>;
  const raw = record.related_task_ids ?? record.relatedTaskIds;
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (typeof raw !== 'string' || raw.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

async function loadRelatedTaskEvidenceEvents(task: unknown, currentTaskId: string): Promise<Record<string, unknown>[]> {
  const relatedTaskIds = relatedTaskIdsOf(task).filter((id) => id !== currentTaskId);
  if (relatedTaskIds.length === 0) return [];

  const relatedEvents: Record<string, unknown>[] = [];
  for (const relatedTaskId of relatedTaskIds.slice(0, 5)) {
    try {
      const relatedExecutions = await loadTaskExecutionsWithEvidence(relatedTaskId);
      const selected = selectEvidenceExecution(relatedExecutions);
      relatedEvents.push(...selected.events);
    } catch (error) {
      console.warn(`Could not load related canary evidence for ${relatedTaskId}: ${errorMessageOf(error)}`);
    }
  }
  return relatedEvents;
}

export function criticalToolsForScenario(scenario: CanaryScenario): string[] {
  return [
    ...BASE_CRITICAL_TOOLS,
    'match_domain_app',
    'get_domain_pack_or_compose_ad_hoc_domain',
    'compose_frontend_plan',
    ...((scenario.interactionChecks?.length ?? 0) > 0 ? ['verify_interaction_contract'] : []),
    ...(isDesignCritiqueConfigured() ? ['design_critique'] : []),
    ...(scenario.extraCriticalTools ?? []),
  ];
}

function hasResumeProvisioningEvidence(
  calledTools: Set<string>,
  company: { github_repo?: string | null; render_service_id?: string | null } | null | undefined,
  allowExistingProvisioning = false,
): boolean {
  const hasRenderEvidence =
    calledTools.has('render_get_service') ||
    calledTools.has('render_set_env_vars') ||
    calledTools.has('render_update_service_config') ||
    calledTools.has('render_get_deploy_status') ||
    calledTools.has('check_url_health');

  const hasRepoEvidence =
    calledTools.has('github_fork_skeleton') ||
    (
      allowExistingProvisioning &&
      (
        calledTools.has('read_codebase_map') ||
        calledTools.has('github_read_file') ||
        calledTools.has('github_create_commit') ||
        calledTools.has('github_push_file')
      )
    );

  return Boolean(
    company?.github_repo &&
    company?.render_service_id &&
    hasRepoEvidence &&
    hasRenderEvidence,
  );
}

type MissingCriticalToolOptions = {
  allowExistingProvisioning?: boolean;
  dbProofPassed?: boolean;
};

export function missingCriticalToolsForRun(
  criticalTools: string[],
  calledTools: Set<string>,
  company?: { github_repo?: string | null; render_service_id?: string | null } | null,
  options: MissingCriticalToolOptions = {},
): string[] {
  const missingCriticalTools = criticalTools
    .filter((tool) => !['run_drizzle_push', 'run_migration', 'github_create_commit', 'github_push_file'].includes(tool))
    .filter((tool) => {
      if (tool === 'create_instance' && hasResumeProvisioningEvidence(calledTools, company, options.allowExistingProvisioning)) return false;
      if (tool === 'get_domain_pack_or_compose_ad_hoc_domain') {
        return !calledTools.has('get_domain_pack') && !calledTools.has('compose_ad_hoc_domain');
      }
      return !calledTools.has(tool);
    });
  const existingDbProofAllowed = Boolean(options.allowExistingProvisioning && options.dbProofPassed);
  if (!calledTools.has('run_drizzle_push') && !calledTools.has('run_migration') && !existingDbProofAllowed) {
    missingCriticalTools.push('run_drizzle_push_or_run_migration');
  }
  if (!calledTools.has('github_create_commit') && !calledTools.has('github_push_file')) {
    missingCriticalTools.push('github_create_commit_or_github_push_file');
  }
  return missingCriticalTools;
}

export function baselineCanaryStatus(
  taskStatus: string | null | undefined,
  executionStatus: string | null | undefined,
  completionGateReason: string | null,
  failureSummary?: string | null,
): { ok: boolean; reason: string | null } {
  if (failureSummary) {
    return { ok: false, reason: `baseline task failed before completion: ${failureSummary}` };
  }
  if (taskStatus !== 'completed') {
    return { ok: false, reason: `baseline task status is ${taskStatus ?? 'missing'}` };
  }
  if (executionStatus !== 'completed') {
    return { ok: false, reason: `baseline execution status is ${executionStatus ?? 'missing'}` };
  }
  if (completionGateReason) {
    return { ok: false, reason: `baseline completion gate blocked: ${completionGateReason}` };
  }
  return { ok: true, reason: null };
}

export function hasGenericStarterSurface(text: string): boolean {
  const normalized = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/Your app,\s*generated\.\s*Yours to keep\./i.test(normalized)) return true;
  if (/This is your authenticated app shell/i.test(normalized)) return true;
  if (/Specialist agents will add features/i.test(normalized)) return true;
  if (/\bYour database\b/i.test(normalized) && /\bNeon Postgres\b|db\/schema\.ts/i.test(normalized)) return true;
  if (/\bAI is pre-wired\b/i.test(normalized) && /@\/lib\/ai|official SDK|Baljia'?s gateway/i.test(normalized)) return true;
  if (/Import anthropic or openai from @\/lib\/ai/i.test(normalized)) return true;
  return /\bBaljia App\b/i.test(normalized) &&
    /\b(Get started|Sign in)\b/i.test(normalized) &&
    /\b(generated|yours to keep|build your app|app generated)\b/i.test(normalized);
}

export function productContractChecksForScenario(input: {
  events: unknown[];
  liveChecks: CanaryReport['liveChecks'];
  liveCheckSpecs: LiveCheckSpec[];
  requiredFileChecks: EvidenceCheck[];
  dbTableChecks: EvidenceCheck[];
  browserUiChecks: CanaryReport['browserUiChecks'];
}): EvidenceCheck[] {
  const requiredLivePairs = input.liveCheckSpecs
    .map((spec, index) => ({ spec, check: input.liveChecks[index] }))
    .filter(({ spec }) => isRequiredLiveCheck(spec));
  const failedLiveChecks = requiredLivePairs
    .filter(({ check }) => !check?.ok)
    .map(({ spec, check }) => `${spec.name}${check?.status ? ` HTTP ${check.status}` : ''}`);
  const failedFiles = input.requiredFileChecks.filter((check) => !check.ok).map((check) => check.name);
  const failedDbTables = input.dbTableChecks.filter((check) => !check.ok).map((check) => check.name);
  const failedBrowserChecks = input.browserUiChecks.filter((check) => !check.ok).map((check) => check.name);
  const eventText = allEventText(input.events);
  const contract = parseProductBuildContractEvidence(eventText);
  const lines = eventText.split(/\r?\n/);
  const contractLine = lines.filter((line) => line.startsWith('PRODUCT_BUILD_CONTRACT_EVIDENCE')).at(-1);
  const acceptanceLine = lines.filter((line) => line.startsWith('ACCEPTANCE_PROOF_EVIDENCE')).at(-1);
  const flowProofs = parseContractFlowProofEvidence(eventText);
  const missingFlowIds = missingContractFlowIds(contract.flowIds, flowProofs);
  const contractFlowIdSet = new Set(contract.flowIds);
  const latestRelevantFlowProofs = new Map<string, boolean>();
  for (const proof of flowProofs) {
    if (contractFlowIdSet.has(proof.id)) latestRelevantFlowProofs.set(proof.id, proof.passed);
  }
  const provedFlowIds = new Set(flowProofs.filter((proof) => proof.passed && contractFlowIdSet.has(proof.id)).map((proof) => proof.id));
  const acceptancePassed = contract.flowIds.filter((id) => provedFlowIds.has(id)).length;
  const failedRelevantFlowIds = contract.flowIds.filter((id) => latestRelevantFlowProofs.get(id) === false && !provedFlowIds.has(id));
  const fieldRequirements = contractFieldRequirements(contract.contract);
  const missingFieldProofs = missingContractFieldProofs(fieldRequirements, parseContractFieldProofEvidence(eventText));
  const authIsolation = parseAuthIsolationProofEvidence(eventText);
  const authRequired = contract.authBaseline || contract.userIsolation;

  return [
    {
      name: 'build brief evidence',
      ok: eventText.includes('BUILD_BRIEF_EVIDENCE'),
      detail: 'Canary app builds must lock a lane-sized Build Brief before coding.',
    },
    {
      name: 'product build contract evidence',
      ok: contract.present && contract.flowCount > 0 && contract.contract !== null,
      detail: contract.present
        ? `Product Build Contract declared ${contract.flowCount} flow(s) with ${contract.contract ? 'JSON contract' : 'missing JSON contract'}.`
        : 'Missing PRODUCT_BUILD_CONTRACT_EVIDENCE; tester would be validating the builder summary instead of an independent contract.',
    },
    {
      name: 'product build contract artifact',
      ok: eventText.includes('PRODUCT_BUILD_CONTRACT_ARTIFACT'),
      detail: 'Canary app builds must persist the Build Brief/Product Build Contract artifact for replay and repair.',
    },
    {
      name: 'acceptance proof evidence',
      ok: Boolean(acceptanceLine) && contract.flowCount > 0 && missingFlowIds.length === 0,
      detail: acceptanceLine
        ? `Acceptance proof covered ${acceptancePassed}/${contract.flowCount} contract flow(s), failed_ids=${failedRelevantFlowIds.join(',') || 'none'}, missing_ids=${missingFlowIds.join(',') || 'none'}.`
        : 'Missing ACCEPTANCE_PROOF_EVIDENCE from verify_interaction_contract with contract_flow_id.',
    },
    {
      name: 'contract field proof evidence',
      ok: missingFieldProofs.length === 0,
      detail: missingFieldProofs.length > 0
        ? `Missing field proof for: ${missingFieldProofs.map((item) => `${item.flowId}:${item.entity}[${item.fields.join(',')}]`).join('; ')}.`
        : `${fieldRequirements.length} contract field requirement(s) covered.`,
    },
    {
      name: 'auth isolation proof evidence',
      ok: !authRequired || (authIsolation.present && authIsolation.failed === 0 && authIsolation.passed > 0),
      detail: authRequired
        ? `Auth isolation ${authIsolation.present ? `passed=${authIsolation.passed} failed=${authIsolation.failed}` : 'missing'}.`
        : 'Contract does not require auth isolation.',
    },
    {
      name: 'required live API contract',
      ok: requiredLivePairs.length > 0 && failedLiveChecks.length === 0,
      detail: failedLiveChecks.length > 0
        ? `Failed required live checks: ${failedLiveChecks.join(', ')}.`
        : `${requiredLivePairs.length} required live check(s) passed.`,
    },
    {
      name: 'required route files pushed',
      ok: input.requiredFileChecks.length > 0 && failedFiles.length === 0,
      detail: failedFiles.length > 0
        ? `Missing required route files: ${failedFiles.join(', ')}.`
        : `${input.requiredFileChecks.length} required route file(s) found in GitHub.`,
    },
    {
      name: 'required DB tables persisted rows',
      ok: input.dbTableChecks.length > 0 && failedDbTables.length === 0,
      detail: failedDbTables.length > 0
        ? `DB table checks failed: ${failedDbTables.join(', ')}.`
        : `${input.dbTableChecks.length} required DB table(s) contained rows.`,
    },
    {
      name: 'browser UI contract',
      ok: input.browserUiChecks.length > 0 && failedBrowserChecks.length === 0,
      detail: failedBrowserChecks.length > 0
        ? `Browser UI checks failed: ${failedBrowserChecks.join(', ')}.`
        : `${input.browserUiChecks.length} browser UI check(s) passed.`,
    },
  ];
}

export function productContractGate(checks: EvidenceCheck[]): { ok: boolean; reason: string | null } {
  const failed = checks.find((check) => !check.ok);
  if (!failed) return { ok: true, reason: null };
  return { ok: false, reason: `${failed.name}: ${failed.detail}` };
}

export function classifyCanaryTerminalState(input: { ok: boolean; productReady: boolean }): CanaryTerminalState {
  if (input.ok) return 'PASS';
  if (input.productReady) return 'PRODUCT_PASS_ORCHESTRATION_FAIL';
  return 'FAIL';
}

export function shouldAutoReplayCanaryReport(report: Pick<CanaryReport, 'ok' | 'productReady' | 'taskId'>): boolean {
  return !report.ok && report.productReady && Boolean(report.taskId);
}

function deterministicEvidenceChecks(events: unknown[], critiqueRequired: boolean, runnerDbProofPassed = false): EvidenceCheck[] {
  const checks: EvidenceCheck[] = [
    {
      name: 'verify_user_journey passed',
      ok: hasToolResult(events, 'verify_user_journey', /^JOURNEY PASS\b/m),
      detail: 'At least one app-specific journey must return JOURNEY PASS.',
    },
    {
      name: 'verify_db_state passed',
      ok: hasToolResult(events, 'verify_db_state', /^DB STATE PASS\b/m) || runnerDbProofPassed,
      detail: runnerDbProofPassed
        ? 'Runner-side DB table proof passed for this deployed canary.'
        : 'At least one DB-writing flow must be proven with DB STATE PASS.',
    },
    {
      name: 'static_code_scan high=0',
      ok: hasToolResult(events, 'static_code_scan', /^STATIC SCAN PASS\b|high=0\b/im),
      detail: 'Static scan must pass or report high=0.',
    },
    {
      name: 'design_audit clean',
      ok: hasToolResult(events, 'design_audit', /design_audit CLEAN/i),
      detail: 'User-facing canaries must pass design_audit.',
    },
    {
      name: 'codebase map updated',
      ok: hasToolResult(events, 'write_codebase_map', /Codebase map saved/i),
      detail: 'Completion requires write_codebase_map after the final app state.',
    },
    {
      name: 'final report created',
      ok: events.some((event) => eventToolName(event) === 'create_report'),
      detail: 'Completion requires create_report with live URL and verification evidence.',
    },
  ];

  if (critiqueRequired) {
    checks.push({
      name: 'design_critique clean',
      ok: hasToolResult(events, 'design_critique', /design_critique CLEAN|0 blockers/i),
      detail: 'Configured vision critique must be clean with 0 blockers; score is advisory unless a stricter score gate is configured.',
    });
  }

  return checks;
}

type ScenarioWithExtendedEvidence = CanaryScenario & {
  domains?: string[];
  requiredEvidence?: string[];
  dbChecks?: Array<{ name: string; table: string; expects: string }>;
};

function allEventText(events: unknown[]): string {
  return events.map((event) => eventResultText(event)).join('\n');
}

function requiredEvidencePatternMatches(events: unknown[], requirement: string): boolean {
  const normalized = requirement.trim();
  if (!normalized) return true;
  const lower = normalized.toLowerCase();
  if (lower === 'verify_browser_ui pass') {
    return hasToolResult(events, 'verify_browser_ui', /^BROWSER UI PASS\b/m);
  }
  if (lower === 'verify_db_state pass') {
    return hasToolResult(events, 'verify_db_state', /^DB STATE PASS\b/m);
  }
  if (lower === 'verify_user_journey pass') {
    return hasToolResult(events, 'verify_user_journey', /^JOURNEY PASS\b/m);
  }
  if (lower === 'verify_interaction_contract pass') {
    return hasPassingInteractionProof(events, 1);
  }

  const text = allEventText(events);
  if (text.includes(normalized)) return true;

  const marker = normalized.split(/\s+/)[0];
  if (/^[A-Z0-9_]+_EVIDENCE$/.test(marker)) {
    const markerLines = text.split(/\r?\n/).filter((line) => line.startsWith(marker));
    if (markerLines.length === 0) return false;
    const containsMatch = normalized.match(/^[A-Z0-9_]+_EVIDENCE\s+([a-zA-Z0-9_]+)\s+contains\s+([a-zA-Z0-9_-]+)/);
    if (containsMatch) {
      const [, key, expected] = containsMatch;
      return markerLines.some((line) => line.includes(`${key}=`) && line.includes(expected));
    }
    const requiredTokens = normalized
      .slice(marker.length)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return requiredTokens.every((token) => markerLines.some((line) => line.includes(token)));
  }

  return text.toLowerCase().includes(lower);
}

export function requiredEvidenceChecksForScenario(events: unknown[], scenario: ScenarioWithExtendedEvidence): EvidenceCheck[] {
  const requiredEvidence = scenario.requiredEvidence ?? [];
  const checks: EvidenceCheck[] = requiredEvidence.map((requirement) => ({
    name: `required evidence: ${requirement}`,
    ok: requiredEvidencePatternMatches(events, requirement),
    detail: `Scenario requires execution-log evidence matching "${requirement}".`,
  }));

  if ((scenario.domains ?? []).length > 0 && !requiredEvidence.some((item) => item.includes('DOMAIN_MATCH_EVIDENCE'))) {
    checks.push({
      name: 'required evidence: DOMAIN_MATCH_EVIDENCE',
      ok: allEventText(events).includes('DOMAIN_MATCH_EVIDENCE'),
      detail: 'Extended domain scenarios must prove match_domain_app was used.',
    });
  }
  if (scenario.browserUiChecks.length > 0 && !requiredEvidence.some((item) => item.includes('FRONTEND_PLAN_EVIDENCE'))) {
    checks.push({
      name: 'required evidence: FRONTEND_PLAN_EVIDENCE',
      ok: allEventText(events).includes('FRONTEND_PLAN_EVIDENCE'),
      detail: 'UI scenarios must prove compose_frontend_plan was used.',
    });
  }
  if ((scenario.browserUiChecks.length > 0 || (scenario.interactionChecks?.length ?? 0) > 0) && !requiredEvidence.some((item) => item.includes('PRODUCT_BUILD_CONTRACT_EVIDENCE'))) {
    const eventText = allEventText(events);
    checks.push({
      name: 'required evidence: PRODUCT_BUILD_CONTRACT_EVIDENCE',
      ok: eventText.includes('PRODUCT_BUILD_CONTRACT_EVIDENCE') && eventText.includes('PRODUCT_BUILD_CONTRACT_JSON'),
      detail: 'App-build scenarios must emit a machine-readable Product Build Contract before coding.',
    });
    checks.push({
      name: 'required evidence: PRODUCT_BUILD_CONTRACT_ARTIFACT',
      ok: eventText.includes('PRODUCT_BUILD_CONTRACT_ARTIFACT'),
      detail: 'App-build scenarios must persist the Product Build Contract artifact for repair/replay.',
    });
  }
  if ((scenario.interactionChecks?.length ?? 0) > 0) {
    const expectedInteractions = scenario.interactionChecks?.length ?? 0;
    const counts = latestInteractionProofCounts(events);
    const eventText = allEventText(events);
    const contract = parseProductBuildContractEvidence(eventText);
    const missingFlowIds = contract.present
      ? missingContractFlowIds(contract.flowIds, parseContractFlowProofEvidence(eventText))
      : [];
    checks.push({
      name: 'required evidence: verify_interaction_contract proves every scenario interaction',
      ok: counts !== null && counts.failed === 0 && counts.passed >= expectedInteractions && missingFlowIds.length === 0,
      detail: counts
        ? `Scenario requires ${expectedInteractions} interaction proof(s); latest verify_interaction_contract proved ${counts.passed}, failed ${counts.failed}, missing_contract_flow_ids=${missingFlowIds.join(',') || 'none'}.`
        : `Scenario requires ${expectedInteractions} interaction proof(s), but no verify_interaction_contract marker was found.`,
    });
  }

  return checks;
}

export function scenarioDbEvidenceChecks(
  events: unknown[],
  scenario: ScenarioWithExtendedEvidence,
  dbTableChecks: EvidenceCheck[] = [],
  verifyDbStateResult?: string,
): EvidenceCheck[] {
  const dbChecks = scenario.dbChecks ?? [];
  if (dbChecks.length === 0) return [];

  const verifyDbPassed =
    /^DB STATE PASS\b/m.test(verifyDbStateResult ?? '') ||
    hasAgentToolResult(events, 'verify_db_state', /^DB STATE PASS\b/m);
  const tableEvidenceText = JSON.stringify(dbTableChecks);

  return [
    {
      name: 'scenario db evidence: verify_db_state',
      ok: verifyDbPassed,
      detail: 'Extended scenario dbChecks require verify_db_state evidence.',
    },
    ...dbChecks.map((check) => ({
      name: `scenario db evidence: ${check.table}`,
      ok: verifyDbPassed && dbTableChecks.some((tableCheck) =>
        tableCheck.ok &&
        (tableCheck.name.includes(check.table) || tableCheck.detail.includes(check.table) || tableEvidenceText.includes(check.table))
      ),
      detail: `${check.name}: ${check.expects}`,
    })),
  ];
}

function findCompletionGateEvents(events: unknown[]): string[] {
  return events
    .map((event) => JSON.stringify(event))
    .filter((serialized) =>
      serialized.includes('completion_gate') ||
      serialized.includes('PRE_CODE_PLANNING_GATE') ||
      serialized.includes('Cannot mark complete')
    )
    .slice(-20)
    .map((serialized) => serialized.slice(0, 2000));
}

function eventsWithRunnerDbProof(events: Record<string, unknown>[], dbTableChecksPassed: boolean): Record<string, unknown>[] {
  if (!dbTableChecksPassed || hasToolResult(events, 'verify_db_state', /^DB STATE PASS\b/m)) return events;
  return [
    ...events,
    {
      tool: 'verify_db_state',
      source: 'canary_runner_db_table_proof',
      result: 'DB STATE PASS: "runner-side required table proof" — required canary tables contain at least one row each.',
    },
  ];
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function nestedValue(body: unknown, pathParts: string[]) {
  let current = body as Record<string, unknown> | unknown;
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function liveCheckResponsePolicyFailures(
  responseText: string,
  spec: Pick<LiveCheckSpec, 'rejectTruthyJsonPaths' | 'rejectResponseTextPatterns'>,
): string[] {
  const failures: string[] = [];

  for (const pattern of spec.rejectResponseTextPatterns ?? []) {
    if (matchesPattern(responseText, pattern)) {
      failures.push(`response matched rejected pattern "${pattern}"`);
    }
  }

  if (spec.rejectTruthyJsonPaths?.length) {
    try {
      const parsed = JSON.parse(responseText) as unknown;
      for (const path of spec.rejectTruthyJsonPaths) {
        const value = nestedValue(parsed, path.split('.'));
        if (Boolean(value)) {
          failures.push(`JSON path "${path}" was truthy (${JSON.stringify(value)})`);
        }
      }
    } catch {
      failures.push('response was not JSON; could not evaluate rejected JSON paths');
    }
  }

  return failures;
}

export function shouldRetryLiveCheckAttempt(input: {
  method: string;
  status?: number | null;
  detail?: string | null;
  attempt: number;
  maxAttempts: number;
}): boolean {
  if (input.attempt >= input.maxAttempts) return false;
  if (input.method.toUpperCase() !== 'GET') return false;
  if (input.status && [408, 425, 429, 500, 502, 503, 504].includes(input.status)) return true;
  return /aborted|fetch failed|network|socket|terminated|timeout|econnreset|etimedout/i.test(input.detail ?? '');
}

async function checkUrl(name: string, baseUrl: string, spec: LiveCheckSpec, state: Record<string, unknown>) {
  const relativePath = typeof spec.path === 'function' ? spec.path(state) : spec.path;
  const url = new URL(relativePath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  const method = spec.method ?? 'GET';
  const body = typeof spec.body === 'function' ? spec.body(state) : spec.body;
  const origin = new URL(baseUrl).origin;
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
  };
  if (body) headers['content-type'] = 'application/json';
  if (method.toUpperCase() !== 'GET') {
    headers.Origin = origin;
    headers.Referer = new URL('/', origin).toString();
  }
  const maxAttempts = method.toUpperCase() === 'GET' ? 3 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      const expectOk = spec.expectOk ?? true;
      const starterSurface = method.toUpperCase() === 'GET' && response.ok && hasGenericStarterSurface(text);
      const policyFailures = liveCheckResponsePolicyFailures(text, spec);
      const ok = (expectOk ? response.ok : !response.ok) && !starterSurface && policyFailures.length === 0;
      if (spec.capture) {
        try {
          const parsed = JSON.parse(text);
          for (const candidate of spec.capture.from) {
            const value = nestedValue(parsed, candidate.split('.'));
            if (typeof value === 'string' || typeof value === 'number') {
              state[spec.capture.key] = String(value);
              break;
            }
          }
        } catch {
          // Non-JSON responses are fine unless the check itself failed.
        }
      }
      const result = {
        name,
        ok,
        status: response.status,
        detail: starterSurface
          ? `starter_surface=true: generic/internal starter app rendered at ${relativePath}. ${text.slice(0, 500)}`
          : [
            policyFailures.length > 0 ? `response_policy_failures=${policyFailures.join(' | ')}` : null,
            text.slice(0, 500),
          ].filter(Boolean).join('\n'),
      };
      if (shouldRetryLiveCheckAttempt({ method, status: response.status, detail: result.detail, attempt, maxAttempts })) {
        await sleep(1_500 * attempt);
        continue;
      }
      return result;
    } catch (error) {
      const result = { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
      if (shouldRetryLiveCheckAttempt({ method, detail: result.detail, attempt, maxAttempts })) {
        await sleep(1_500 * attempt);
        continue;
      }
      return result;
    }
  }
  return { name, ok: false, detail: 'Live check failed after retries.' };
}

export function isRequiredLiveCheck(spec: Pick<LiveCheckSpec, 'method' | 'optional' | 'required'>): boolean {
  if (spec.optional === true) return false;
  if (spec.required === true) return true;
  // GET probes are public liveness/read contracts by default. Mutating API
  // probes are required only when the scenario marks them as the public API
  // contract, because many app-specific writes need auth/cookie state.
  return (spec.method ?? 'GET').toUpperCase() === 'GET';
}

export function hasCanaryFrameworkErrorOverlay(bodyText: string): boolean {
  const frameworkOverlayPatterns = [
    /\bUnhandled Runtime Error\b/i,
    /\bRuntime Error\b/i,
    /\bApplication error:\s*a client-side exception has occurred\b/i,
    /\bBuild Error\b/i,
    /\bFailed to compile\b/i,
    /\bModule not found\b/i,
    /\bwebpack-internal:\//i,
    /\bnext-devtools\b/i,
    /\bHydration failed\b/i,
    /\bText content does not match server-rendered HTML\b/i,
    /\bThere was an error while hydrating\b/i,
  ];
  return frameworkOverlayPatterns.some((pattern) => pattern.test(bodyText));
}

function matchesPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return value.toLowerCase().includes(pattern.toLowerCase());
  }
}

function browserJourneyValue(value: string, stamp: string, state: Record<string, unknown> = {}): string {
  let resolved = value
    .replace(/<timestamp>/g, stamp)
    .replace(/\{\{timestamp\}\}/g, stamp);
  for (const [key, stateValue] of Object.entries(state)) {
    resolved = resolved
      .replace(new RegExp(`<${escapeRegExp(key)}>`, 'g'), String(stateValue ?? ''))
      .replace(new RegExp(`\\{\\{${escapeRegExp(key)}\\}\\}`, 'g'), String(stateValue ?? ''));
  }
  return resolved;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function browserFieldLabelPattern(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function anyMatchesPattern(values: string[], pattern: string): boolean {
  return values.some((value) => matchesPattern(value, pattern));
}

type BrowserActionCandidate = {
  text?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  value?: string | null;
  href?: string | null;
};

export function normalizeBrowserActionLabels(candidates: BrowserActionCandidate[]): string[] {
  const labels = new Set<string>();
  for (const candidate of candidates) {
    for (const value of [candidate.text, candidate.ariaLabel, candidate.title, candidate.value, candidate.href]) {
      const label = String(value ?? '').replace(/\s+/g, ' ').trim();
      if (label) labels.add(label);
    }
  }
  return [...labels];
}

async function extractBrowserActionLabels(page: import('@playwright/test').Page): Promise<string[]> {
  const candidates = await page.locator([
    'button',
    '[role="button"]',
    'input[type="button"]',
    'input[type="submit"]',
    'a[role="button"]',
    'a[aria-label]',
    'a[class*="button" i]',
    'a[class*="btn" i]',
  ].join(',')).evaluateAll((elements) => elements.map((element) => ({
    text: element.textContent,
    ariaLabel: element.getAttribute('aria-label'),
    title: element.getAttribute('title'),
    value: element instanceof HTMLInputElement ? element.value : null,
    href: element instanceof HTMLAnchorElement ? element.href : null,
  }))).catch(() => []);
  return normalizeBrowserActionLabels(candidates);
}

export const BROWSER_JOURNEY_ACTION_SELECTOR_PHASES = [
  [
    'form button',
    'form input[type="submit"]',
    'form input[type="button"]',
    'form :not(a)[role="button"]',
  ],
  [
    'button',
    'input[type="submit"]',
    'input[type="button"]',
    ':not(a)[role="button"]',
  ],
  [
    'a[role="button"]',
    'a[aria-label]',
    'a[class*="button" i]',
    'a[class*="btn" i]',
  ],
] as const;

async function clickFirstMatchingBrowserAction(
  page: import('@playwright/test').Page,
  submitPattern: string,
): Promise<boolean> {
  for (const selectorPhase of BROWSER_JOURNEY_ACTION_SELECTOR_PHASES) {
    const actionElements = page.locator(selectorPhase.join(','));
    const actionCount = await actionElements.count().catch(() => 0);
    for (let index = 0; index < Math.min(actionCount, 80); index += 1) {
      const locator = actionElements.nth(index);
      const labels = normalizeBrowserActionLabels([await locator.evaluate((element) => ({
        text: element.textContent,
        ariaLabel: element.getAttribute('aria-label'),
        title: element.getAttribute('title'),
        value: element instanceof HTMLInputElement ? element.value : null,
        href: element instanceof HTMLAnchorElement ? element.href : null,
      })).catch(() => ({}))]);
      if (labels.some((label) => matchesPattern(label, submitPattern))) {
        const didClick = await locator.click({ timeout: 10_000 }).then(() => true).catch(() => false);
        if (didClick) return true;
      }
    }
  }
  return false;
}

async function waitForBrowserJourneyExpectations(
  page: import('@playwright/test').Page,
  expectTextPatterns: string[],
  rejectTextPatterns: string[] | undefined,
  context: string,
): Promise<{ ok: boolean; detail: string }> {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(1_000).catch(() => undefined);
  let bodyText = '';
  let missingText = [...expectTextPatterns];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
    missingText = expectTextPatterns.filter((pattern) => !matchesPattern(bodyText, pattern));
    if (missingText.length === 0) break;
    await page.waitForTimeout(1_000).catch(() => undefined);
  }
  if (hasGenericStarterSurface(bodyText)) {
    return { ok: false, detail: `${context} reached a generic/internal starter shell instead of a product-specific app surface.` };
  }
  const rejectedText = (rejectTextPatterns ?? []).filter((pattern) => matchesPattern(bodyText, pattern));
  if (rejectedText.length > 0) {
    return { ok: false, detail: `${context} rendered forbidden text: ${rejectedText.join(', ')}` };
  }
  if (missingText.length > 0) {
    return { ok: false, detail: `${context} expected UI text missing: ${missingText.join(', ')}` };
  }
  return { ok: true, detail: `${context} expectations passed` };
}

async function runBrowserJourneyPostAction(
  page: import('@playwright/test').Page,
  baseUrl: string,
  action: NonNullable<BrowserJourneySpec['postSubmitActions']>[number],
): Promise<{ ok: boolean; detail: string }> {
  const context = action.name ?? `${action.type} action`;
  if (action.type === 'click') {
    if (!action.labelPattern) {
      return { ok: false, detail: `${context} is missing labelPattern` };
    }
    const clicked = await clickFirstMatchingBrowserAction(page, action.labelPattern);
    if (!clicked) {
      return { ok: false, detail: `${context} missing clickable action matching /${action.labelPattern}/i` };
    }
  } else if (action.type === 'goto') {
    if (!action.path) {
      return { ok: false, detail: `${context} is missing path` };
    }
    const target = new URL(action.path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  if (action.expectUrlPattern && !matchesPattern(page.url(), action.expectUrlPattern)) {
    return { ok: false, detail: `${context} URL ${page.url()} did not match /${action.expectUrlPattern}/i` };
  }
  return waitForBrowserJourneyExpectations(
    page,
    action.expectTextPatterns ?? [],
    action.rejectTextPatterns,
    context,
  );
}

async function runBrowserJourney(
  page: import('@playwright/test').Page,
  baseUrl: string,
  journey: BrowserJourneySpec,
  state: Record<string, unknown> = {},
): Promise<{ ok: boolean; detail: string }> {
  const target = new URL(journey.startPath ?? '/', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

  for (const action of journey.preSubmitActions ?? []) {
    const actionState = await runBrowserJourneyPostAction(page, baseUrl, action);
    if (!actionState.ok) return actionState;
  }

  const missingFields: string[] = [];
  const journeyStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (const [field, value] of Object.entries(journey.formFields)) {
    const fieldPattern = browserFieldLabelPattern(field);
    let locator = page.locator([
      `input[name="${field}"]`,
      `textarea[name="${field}"]`,
      `select[name="${field}"]`,
      `input[id="${field}"]`,
      `textarea[id="${field}"]`,
      `select[id="${field}"]`,
      `input[aria-label*="${fieldPattern}" i]`,
      `textarea[aria-label*="${fieldPattern}" i]`,
      `input[placeholder*="${fieldPattern}" i]`,
      `textarea[placeholder*="${fieldPattern}" i]`,
    ].join(',')).first();
    if (!(await locator.count().catch(() => 0))) {
      locator = page.getByLabel(new RegExp(escapeRegExp(fieldPattern), 'i')).first();
    }
    if (await locator.count().catch(() => 0)) {
      const tag = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => 'input');
      const resolvedValue = browserJourneyValue(value, journeyStamp, state);
      if (tag === 'select') {
        await locator.selectOption({ label: resolvedValue }).catch(async () => locator.selectOption(resolvedValue).catch(() => undefined));
      } else {
        await locator.fill(resolvedValue).catch(() => undefined);
      }
    } else {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    return { ok: false, detail: `Missing UI form fields: ${missingFields.join(', ')}` };
  }

  const clicked = await clickFirstMatchingBrowserAction(page, journey.submitPattern);

  if (!clicked) {
    return { ok: false, detail: `Missing submit action matching /${journey.submitPattern}/i` };
  }
  const submitState = await waitForBrowserJourneyExpectations(
    page,
    journey.expectTextPatterns,
    journey.rejectTextPatterns,
    'Journey submitted',
  );
  if (!submitState.ok) {
    return submitState;
  }
  const visualContrastIssues = await auditPageVisualContrast(page, { maxIssues: 12 }).catch(() => []);
  if (visualContrastIssues.length > 0) {
    return { ok: false, detail: `Journey submitted but rendered low-contrast UI: ${formatVisualContrastIssues(visualContrastIssues)}` };
  }
  for (const action of journey.postSubmitActions ?? []) {
    const actionState = await runBrowserJourneyPostAction(page, baseUrl, action);
    if (!actionState.ok) return actionState;
  }
  return { ok: true, detail: `Journey passed: ${journey.name}` };
}

async function runBrowserUiChecks(
  scenario: CanaryScenario,
  baseUrl: string,
  outputDir: string,
  state: Record<string, unknown> = {},
): Promise<CanaryReport['browserUiChecks']> {
  const checkSpecs: BrowserUiCheckSpec[] = scenario.browserUiChecks.length > 0
    ? scenario.browserUiChecks
    : (scenario.interactionChecks?.length ?? 0) > 0
      ? [{
          name: 'scenario interaction contracts',
          requiredTextPatterns: [],
          requiredButtonPatterns: [],
          requireNoConsoleErrors: true,
        }]
      : [];
  if (checkSpecs.length === 0) return [];

  try {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const consoleIssues: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleIssues.push(message.text());
    });
    page.on('pageerror', (error) => {
      consoleIssues.push(error.message);
    });

    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    const bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
    const buttonLabels = await extractBrowserActionLabels(page);
    const title = await page.title().catch(() => '');
    const screenshotPath = path.join(outputDir, `${scenario.id}-browser-ui.png`);
    const visualContrastIssues = await auditPageVisualContrast(page, { maxIssues: 20 }).catch(() => []);
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
    const journeyResults = new Map<string, Array<{ ok: boolean; detail: string }>>();
    for (const spec of checkSpecs) {
      const results = [];
      for (const journey of spec.journeys ?? []) {
        if (journey.required === false) continue;
        results.push(await runBrowserJourney(page, baseUrl, journey, state));
      }
      journeyResults.set(spec.name, results);
    }
    const interactionResults: Array<{ ok: boolean; detail: string }> = [];
    for (const interaction of scenario.interactionChecks ?? []) {
      interactionResults.push(await runBrowserJourney(page, baseUrl, {
        name: `interaction contract: ${interaction.name}`,
        startPath: interaction.startPath,
        formFields: interaction.fields ?? {},
        submitPattern: interaction.labelPattern,
        expectTextPatterns: interaction.expectTextPatterns,
        rejectTextPatterns: interaction.rejectTextPatterns,
      }, state));
    }
    await browser.close();

    const frameworkOverlay = hasCanaryFrameworkErrorOverlay(bodyText);
    const starterSurface = hasGenericStarterSurface(bodyText);
    const failedInteractions = interactionResults.filter((result) => !result.ok);
    return checkSpecs.map((spec) => {
      const missingTextPatterns = spec.requiredTextPatterns.filter((pattern) => !matchesPattern(bodyText, pattern));
      const missingButtonPatterns = spec.requiredButtonPatterns.filter((pattern) => !anyMatchesPattern(buttonLabels, pattern));
      const blockingConsoleIssues = spec.requireNoConsoleErrors ? consoleIssues : [];
      const specJourneyResults = journeyResults.get(spec.name) ?? [];
      const failedJourneys = specJourneyResults.filter((journey) => !journey.ok);
      const ok =
        response?.ok() === true &&
        !frameworkOverlay &&
        !starterSurface &&
        missingTextPatterns.length === 0 &&
        missingButtonPatterns.length === 0 &&
        visualContrastIssues.length === 0 &&
        blockingConsoleIssues.length === 0 &&
        failedJourneys.length === 0 &&
        failedInteractions.length === 0;

      return {
        name: spec.name,
        ok,
        status: response?.status() ?? null,
        title,
        screenshotPath,
        missingTextPatterns,
        missingButtonPatterns,
        consoleIssues: blockingConsoleIssues.slice(0, 10),
        visualContrastIssues: visualContrastIssues.map((issue) =>
          `${issue.kind} ${issue.element} "${issue.text.slice(0, 48)}" ratio=${issue.ratio.toFixed(2)} required=${issue.minRatio.toFixed(1)}`,
        ),
        detail: ok
          ? `Browser UI proof passed. Buttons seen: ${buttonLabels.join(', ') || 'none'}. ${formatVisualContrastIssues([])}.`
          : [
              response?.ok() === true ? null : `Homepage status ${response?.status() ?? 'unknown'}`,
              frameworkOverlay ? 'Framework/runtime overlay text detected.' : null,
              starterSurface ? 'Generic starter app surface detected at /.' : null,
              missingTextPatterns.length > 0 ? `Missing text patterns: ${missingTextPatterns.join(', ')}` : null,
              missingButtonPatterns.length > 0 ? `Missing button patterns: ${missingButtonPatterns.join(', ')}` : null,
              visualContrastIssues.length > 0 ? formatVisualContrastIssues(visualContrastIssues) : null,
              blockingConsoleIssues.length > 0 ? `Console/page errors: ${blockingConsoleIssues.slice(0, 3).join(' | ')}` : null,
              failedJourneys.length > 0 ? `Browser journeys failed: ${failedJourneys.map((journey) => journey.detail).join(' | ')}` : null,
              failedInteractions.length > 0 ? `Interaction contracts failed: ${failedInteractions.map((result) => result.detail).join(' | ')}` : null,
            ].filter(Boolean).join(' '),
      };
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return checkSpecs.map((spec) => ({
      name: spec.name,
      ok: false,
      missingTextPatterns: spec.requiredTextPatterns,
      missingButtonPatterns: spec.requiredButtonPatterns,
      consoleIssues: [],
      detail: `Browser UI proof failed to run: ${detail}`,
    }));
  }
}

function routeCandidates(route: string): string[] {
  const normalized = route.replace(/^\/+/, '');
  const candidates = [normalized];
  if (normalized.startsWith('app/')) candidates.push(`src/${normalized}`);
  return candidates;
}

async function checkRequiredRepoFiles(repo: string | null | undefined, routes: string[]): Promise<EvidenceCheck[]> {
  if (!repo) {
    return routes.map((route) => ({
      name: route,
      ok: false,
      detail: 'No GitHub repo recorded for this canary company.',
    }));
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return routes.map((route) => ({
      name: route,
      ok: false,
      detail: 'GITHUB_TOKEN missing; cannot verify required route files.',
    }));
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'baljia-engineering-canary',
  };

  let tree: Array<{ path?: string; type?: string }> = [];
  let lastError = '';
  for (const branch of ['main', 'master']) {
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`, {
        headers,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        lastError = `GitHub tree ${branch} returned HTTP ${response.status}`;
        continue;
      }
      const data = await response.json() as { tree?: Array<{ path?: string; type?: string }> };
      tree = data.tree ?? [];
      if (tree.length > 0) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (tree.length === 0) {
    return routes.map((route) => ({
      name: route,
      ok: false,
      detail: lastError || 'GitHub repo tree was empty.',
    }));
  }

  const repoPaths = new Set(tree.filter((entry) => entry.type === 'blob' && entry.path).map((entry) => entry.path as string));
  return routes.map((route) => {
    const candidates = routeCandidates(route);
    const matched = candidates.find((candidate) => repoPaths.has(candidate));
    return {
      name: route,
      ok: !!matched,
      detail: matched ? `found ${matched}` : `missing; checked ${candidates.join(', ')}`,
    };
  });
}

function quotePgIdent(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function checkRequiredDbTables(companyId: string, tables: string[]): Promise<EvidenceCheck[]> {
  const dbInfo = await getCompanyDatabase(companyId);
  if (!dbInfo?.connectionUri) {
    return tables.map((table) => ({
      name: `${table} has rows`,
      ok: false,
      detail: 'No founder database provisioned for this canary company.',
    }));
  }

  const { neon } = await import('@neondatabase/serverless');
  const neonSql = neon(dbInfo.connectionUri);
  const checks: EvidenceCheck[] = [];

  for (const table of tables) {
    try {
      const rows = await retryDbRead(
        `check required DB table ${table}`,
        async () => await neonSql.query(`SELECT 1 AS ok FROM ${quotePgIdent(table)} LIMIT 1`) as Array<Record<string, unknown>>,
        5,
      );
      checks.push({
        name: `${table} has rows`,
        ok: rows.length > 0,
        detail: rows.length > 0 ? 'At least one row exists.' : 'Table exists but has no rows.',
      });
    } catch (error) {
      checks.push({
        name: `${table} has rows`,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return checks;
}

async function resolveRenderServiceUrl(serviceId: string | null | undefined): Promise<string | null> {
  if (!serviceId || !process.env.RENDER_API_KEY) return null;
  try {
    const response = await fetch(`https://api.render.com/v1/services/${serviceId}`, {
      headers: {
        Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const data = await response.json() as {
      url?: string;
      service?: { url?: string; serviceDetails?: { url?: string } };
      serviceDetails?: { url?: string };
    };
    return data.service?.serviceDetails?.url ?? data.service?.url ?? data.serviceDetails?.url ?? data.url ?? null;
  } catch {
    return null;
  }
}

function placeholdersForLiveChecks(scenario: CanaryScenario): Record<string, unknown> {
  const placeholders: Record<string, unknown> = {};
  for (const check of scenario.liveChecks) {
    if (check.capture) {
      placeholders[check.capture.key] = `<${check.capture.key} from ${check.name}>`;
    }
  }
  return placeholders;
}

function renderBodyForPrompt(body: LiveCheckSpec['body'], placeholders: Record<string, unknown>): string {
  if (!body) return '(none)';
  const resolved = typeof body === 'function' ? body(placeholders) : body;
  return JSON.stringify(resolved, null, 2);
}

function renderPathForPrompt(pathSpec: LiveCheckSpec['path'], placeholders: Record<string, unknown>): string {
  const resolved = typeof pathSpec === 'function' ? pathSpec(placeholders) : pathSpec;
  try {
    return decodeURIComponent(resolved);
  } catch {
    return resolved;
  }
}

export function formatLiveCheckContract(scenario: CanaryScenario): string[] {
  const placeholders = placeholdersForLiveChecks(scenario);
  return scenario.liveChecks.flatMap((check) => {
    const method = (check.method ?? 'GET').toUpperCase();
    const required = isRequiredLiveCheck(check) ? 'required' : 'optional';
    const lines = [
      `- [${required}] ${check.name}: ${method} ${renderPathForPrompt(check.path, placeholders)}`,
    ];
    if (check.body) lines.push(`  body:\n${renderBodyForPrompt(check.body, placeholders).split('\n').map((line) => `    ${line}`).join('\n')}`);
    if (check.capture) lines.push(`  capture ${check.capture.key} from response paths: ${check.capture.from.join(', ')}`);
    if (check.expectOk === false) lines.push('  expected result: non-2xx rejection is success for this negative check');
    if (check.rejectTruthyJsonPaths?.length) lines.push(`  rejected truthy JSON paths: ${check.rejectTruthyJsonPaths.join(', ')}`);
    if (check.rejectResponseTextPatterns?.length) lines.push(`  rejected response text patterns: ${check.rejectResponseTextPatterns.join(', ')}`);
    return lines;
  });
}

export function formatBrowserUiContract(scenario: CanaryScenario): string[] {
  return scenario.browserUiChecks.flatMap((check) => {
    const lines = [
      `- ${check.name}`,
      `  required text patterns: ${check.requiredTextPatterns.join(' | ')}`,
      `  required action/button patterns: ${check.requiredButtonPatterns.join(' | ')}`,
      `  semantic actions count as buttons: <button>, [role=button], submit inputs, aria-label actions, and link-buttons`,
      `  visual contrast: visible text, buttons, link-buttons, selects, dropdown triggers, and native option rows must be readable; white-on-white or black-on-dark controls fail the canary`,
      check.requireNoConsoleErrors ? '  runtime: no fatal browser console/page errors' : null,
    ].filter((line): line is string => !!line);
    for (const journey of check.journeys ?? []) {
      if (journey.required === false) continue;
      lines.push(`  browser journey "${journey.name}": start ${journey.startPath ?? '/'}; fill ${Object.keys(journey.formFields).join(', ')}; click action matching /${journey.submitPattern}/i; expect ${journey.expectTextPatterns.join(' | ')}`);
      for (const action of journey.preSubmitActions ?? []) {
        if (action.type === 'click') {
          lines.push(`    before fill click action matching /${action.labelPattern}/i; expect ${action.expectTextPatterns?.join(' | ') || 'form becomes available'}`);
        } else {
          lines.push(`    before fill visit ${action.path}; expect ${action.expectTextPatterns?.join(' | ') || 'form becomes available'}`);
        }
        if (action.rejectTextPatterns?.length) {
          lines.push(`      reject visible text: ${action.rejectTextPatterns.join(' | ')}`);
        }
      }
      if (journey.rejectTextPatterns?.length) {
        lines.push(`    reject visible internal/starter text: ${journey.rejectTextPatterns.join(' | ')}`);
      }
      for (const action of journey.postSubmitActions ?? []) {
        if (action.type === 'click') {
          lines.push(`    then click action matching /${action.labelPattern}/i; expect ${action.expectTextPatterns?.join(' | ') || 'no additional text requirement'}`);
        } else {
          lines.push(`    then visit ${action.path}; expect ${action.expectTextPatterns?.join(' | ') || 'no additional text requirement'}`);
        }
        if (action.expectUrlPattern) {
          lines.push(`      URL must match /${action.expectUrlPattern}/i`);
        }
        if (action.rejectTextPatterns?.length) {
          lines.push(`      reject visible text: ${action.rejectTextPatterns.join(' | ')}`);
        }
      }
    }
    return lines;
  });
}

export function formatInteractionContract(scenario: CanaryScenario): string[] {
  const checks = scenario.interactionChecks ?? [];
  if (checks.length === 0) return ['- No additional scenario-specific interaction contracts beyond browser journeys.'];
  return checks.map((check) => [
    `- ${check.name}: start ${check.startPath ?? '/'}; click /${check.labelPattern}/i`,
    check.fields ? `  fields: ${Object.keys(check.fields).join(', ')}` : null,
    check.api ? `  backend/API: ${check.api}` : null,
    check.dbTables?.length ? `  DB proof tables: ${check.dbTables.join(', ')}` : null,
    `  UI readback must match: ${check.expectTextPatterns.join(' | ')}`,
  ].filter((line): line is string => !!line).join('\n'));
}

export function buildTaskDescription(scenario: CanaryScenario, appName: string) {
  return [
    `Build and deploy this app: ${scenario.originalIdea}`,
    '',
    'Use the normal Engineering app-build workflow before implementation:',
    '1. Call list_skills and read only the skills relevant to the selected product capabilities, database, deployment, and verification.',
    '2. Call match_domain_app. If no known domain fits, call compose_ad_hoc_domain and explain the product shape.',
    '3. Call get_domain_pack for selected known domains.',
    '4. Call match_capabilities with domain/product context derived from the requested app surface, routes, data contracts, and user journeys. Do not add integrations unless the product contract requires them.',
    '5. Call get_capability_pack for every selected capability.',
    '6. Call match_design_system and get_design_system for the user-facing UI.',
    '7. Call match_reference_repos, get_reference_repo_patterns for the top selected references, and retrieve_component_examples when they help the product shape or UI contract.',
    '8. Call compose_frontend_plan for the user-facing UI contract.',
    '9. Call compose_app_architecture with selected domains/capabilities, selected design_system, selected reference_patterns, and frontend plan before any create_instance, skeleton fork, GitHub write, migration, or Render deploy tool. Its output must include BUILD_BRIEF_EVIDENCE, PRODUCT_BUILD_CONTRACT_EVIDENCE, PRODUCT_BUILD_CONTRACT_JSON, and PRODUCT_BUILD_CONTRACT_ARTIFACT; build from the contract, not from a generic template.',
    scenario.requiresExistingBaseline ? 'Existing-app extension extra: call read_codebase_map, then build_code_graph and query_code_graph before editing; use the graph output to target existing files/routes/entities. Extend the existing app; do not replace it with a new generic app.' : null,
    `10. Call create_instance with app_name "${appName}" and an app-specific description.`,
    '',
    'Required app surface:',
    ...scenario.surfaceRequirements.map((line) => `- ${line}`),
    '',
    'Required routes/files:',
    ...scenario.requiredRoutes.map((route) => `- ${route}`),
    '',
    'Exact live API contract the deployed app must satisfy:',
    '- Endpoints must accept the exact method/path/body shown below. Do not rename snake_case fields to camelCase unless you also accept the snake_case contract. Dynamic placeholders such as <vendorId from POST /api/canary-vendors> mean use the ID returned by the earlier live check.',
    ...formatLiveCheckContract(scenario),
    '',
    'Exact browser/UI contract the deployed app must satisfy:',
    ...formatBrowserUiContract(scenario),
    '',
    'Exact interaction contract the Engineering agent must prove:',
    ...formatInteractionContract(scenario),
    '',
    'Required database tables:',
    ...scenario.requiredTables.map((table) => `- ${table}`),
    '',
    'Required verification:',
    '- Commit/push changes, deploy on Render, and do not complete until render_get_deploy_status reports live after the latest push.',
    '- If Render custom-domain attachment is blocked by quota or SSL provisioning, continue with the Render-assigned .onrender.com URL and report the custom-domain blocker as non-fatal.',
    '- After final deploy, call render_get_logs and confirm no fresh build/runtime errors.',
    '- Call check_url_health for /. If /api/health exists, check it too.',
    ...scenario.verificationRequirements.map((line) => `- ${line}`),
    '- Call verify_browser_ui with scenario-specific required_text and required_buttons from the visible UI. It must return BROWSER UI PASS; fix missing buttons, low-contrast/invisible buttons or dropdowns, runtime console errors, blank shells, or stale UI state before completing.',
    '- Call verify_interaction_contract for the scenario-specific interaction contract and every Product Build Contract flow. It must click critical buttons/forms, submit realistic values for every required contract field, prove UI readback, set contract_flow_id from PRODUCT_BUILD_CONTRACT_EVIDENCE, and set critical_kind for derived flows such as auth_session, booking_reservation, ecommerce_order, payment_checkout, crm_record, inventory_record, domain_workflow, upload_file, ai_action, or generic_feature. Pair DB-writing interactions with verify_db_state. The verifier must emit ACCEPTANCE_PROOF_EVIDENCE, one CONTRACT_FLOW_PROOF per exact required flow id, CONTRACT_FIELD_PROOF for data fields, and AUTH_ISOLATION_PROOF_EVIDENCE when auth_baseline/user_isolation is true.',
    '- Do not complete if / or any authenticated app surface still shows generic/internal Baljia starter copy such as "Your app, generated. Yours to keep.", "Baljia App", "This is your authenticated app shell", "Specialist agents will add features", "Your database", "AI is pre-wired", "db/schema.ts", Neon implementation copy, SDK import guidance, or gateway implementation details. Replace the chassis with scenario-specific product UI.',
    '- For pgvector/RAG in founder/user apps, use gemini-embedding-001 with vector(3072) on the fixed Gemini gateway. Do not create ivfflat or hnsw indexes on vector(3072); use exact scan for small canary data, reduce dimensions to <=2000, or use halfvec if an ANN index is truly required.',
    '- For AI text generation in founder/user apps, use the fixed Gemini provider contract: AI_GATEWAY_URL=https://generativelanguage.googleapis.com/v1beta/openai, AI_TEXT_MODEL=gemini-2.5-flash, AI_JSON_MODEL=gemini-2.5-flash. Do not use OpenAI model names or the Baljia gateway for Gemini runtime calls. Do not pass AI canaries with fallback=true while AI_GATEWAY_URL/AI_GATEWAY_TOKEN are configured.',
    '- Call static_code_scan, review_pushed_code, design_audit, and design_critique when configured.',
    '- Update codebase map and create a final report with live URL, capabilities built, verification evidence, and remaining gaps.',
    '',
    'Completion rule: only complete after the deployed app passes app-specific journeys, DB state verification, clean logs, clean static scan, design audit, and design critique.',
  ].filter(Boolean).join('\n');
}

async function createCanaryCompany(scenario: CanaryScenario, slug: string) {
  const email = `${slug}@baljia.test`;
  const [user] = await db.insert(users).values({
    email,
    name: `Render Canary ${scenario.id}`,
    role: 'user',
  }).returning();

  const [company] = await db.insert(companies).values({
    name: `Render Canary ${scenario.id}`,
    slug,
    owner_id: user.id,
    original_idea: scenario.originalIdea,
    onboarding_status: 'completed',
    lifecycle: 'trial_active',
    execution_state: 'active',
    plan_tier: 'free',
    billing_state: 'free',
    hosting_state: 'live',
    subdomain: slug,
  }).returning();

  return company;
}

async function runScenario(
  scenario: CanaryScenario,
  runId: string,
  treeRoot: 'engineering-world-class' | 'engineering-95' = 'engineering-95',
): Promise<CanaryReport> {
  const idStamp = stamp();
  const slug = `canary-${scenario.id}-${idStamp}`.slice(0, 63);
  const appName = slug;
  const company = await createCanaryCompany(scenario, slug);
  const launchOptions = {
    subscriptionFunded: true,
    maxExecutionMs: canaryTaskTimeoutMs(),
  };

  if (scenario.requiresExistingBaseline) {
    const baselineDescription = [
      scenario.baselineTaskDescription ?? 'Build and deploy a minimal baseline app.',
      '',
      'Evaluation baseline setup requirements:',
      '1. Call list_skills and relevant full-stack/Render skills.',
      '2. Call match_capabilities, get_capability_pack for each selected capability, match_design_system/get_design_system, match_reference_repos/get_reference_repo_patterns/retrieve_component_examples, and compose_app_architecture before coding. compose_app_architecture must emit BUILD_BRIEF_EVIDENCE, PRODUCT_BUILD_CONTRACT_EVIDENCE, PRODUCT_BUILD_CONTRACT_JSON, and PRODUCT_BUILD_CONTRACT_ARTIFACT.',
      `3. Call create_instance with app_name "${appName}" and description "existing app baseline".`,
      '4. Build a small existing customer notes app with a visible existing-product homepage signal and GET /api/canary-existing-health returning {"ok":true,"baseline":true}.',
      '5. Deploy on Render, run render_get_logs, check_url_health, verify_user_journey, static_code_scan, design_audit, and design_critique when configured.',
      '6. Write or update the codebase map before completing.',
    ].join('\n');
    const baselineTask = await taskService.createTask({
      company_id: company.id,
      title: `Existing app baseline ${scenario.id} ${idStamp}`,
      description: baselineDescription,
      tag: 'engineering-canary',
      source: 'system',
      priority: 90,
      complexity: 4,
      status: 'todo',
      assigned_to_agent_id: 30,
      execution_mode: 'full_agent',
      verification_level: 'deterministic',
      max_turns: 150,
    });
    console.log(`Preparing existing-app baseline task: ${baselineTask.id}`);
    await launchTask(baselineTask.id, launchOptions);

    const [freshBaselineTask] = await retryDbRead(`read baseline task ${baselineTask.id}`, async () => (
      await db.select().from(tasks).where(eq(tasks.id, baselineTask.id)).limit(1)
    ));
    const baselineExecutions = await loadTaskExecutionsWithEvidence(baselineTask.id);
    const { execution: baselineExecution, events: baselineEvents } = selectEvidenceExecution(baselineExecutions);
    const baselineGateReason = engineeringCompletionGate(30, baselineEvents, freshBaselineTask as never);
    const baselineFailureSummary = freshBaselineTask?.status === 'failed' || baselineExecution?.status === 'failed'
      ? executionErrorSummaryOf(baselineExecution) ?? (typeof freshBaselineTask?.failure_class === 'string' ? freshBaselineTask.failure_class : null)
      : null;
    const baselineStatus = baselineCanaryStatus(
      freshBaselineTask?.status,
      baselineExecution?.status,
      baselineGateReason,
      baselineFailureSummary,
    );
    if (!baselineStatus.ok) {
      throw new Error(`Existing-app baseline did not pass; refusing to run extension canary. ${baselineStatus.reason}`);
    }
  }

  const description = buildTaskDescription(scenario, appName);

  console.log(`Starting scenario ${scenario.id}: ${slug}`);

  const task = await taskService.createTask({
    company_id: company.id,
    title: `Build ${scenario.title} ${idStamp}`,
    description,
    tag: 'engineering-canary',
    source: 'system',
    priority: 95,
    complexity: scenario.id === 'adversarial-booking-marketplace' ? 8 : 6,
    status: 'todo',
    assigned_to_agent_id: 30,
    execution_mode: 'full_agent',
    verification_level: 'deterministic',
    max_turns: 150,
  });

  console.log(`Company: ${company.id} (${slug})`);
  console.log(`Task: ${task.id}`);

  let launchError: string | null = null;
  try {
    await launchTask(task.id, launchOptions);
  } catch (error) {
    launchError = error instanceof Error ? error.message : String(error);
    console.error(`Scenario ${scenario.id} launch failed: ${launchError}`);
  }

  let freshTask: typeof task | undefined;
  let freshCompany: typeof company | undefined;
  let executions: TaskExecutionRow[] = [];
  try {
    [freshTask] = await retryDbRead(`read canary task ${task.id}`, async () => (
      await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
    ));
    [freshCompany] = await retryDbRead(`read canary company ${company.id}`, async () => (
      await db.select().from(companies).where(eq(companies.id, company.id)).limit(1)
    ));
    if (!freshTask) throw new Error(`task not found after launch: ${task.id}`);
    if (!freshCompany) throw new Error(`company not found after launch: ${company.id}`);
    executions = await loadTaskExecutionsWithEvidence(task.id);
  } catch (reportError) {
    const outputDir = path.join(process.cwd(), 'measurement-output', treeRoot, runId);
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    const reportPath = path.join(outputDir, `${scenario.id}.json`);
    const canonical = company.custom_domain
      ? `https://${company.custom_domain}`
      : `https://${company.subdomain ?? slug}.baljia.app`;
    const report: CanaryReport = {
      ok: false,
      terminalState: 'FAIL',
      productReady: false,
      scenarioId: scenario.id,
      runId,
      companyId: company.id,
      companySlug: slug,
      taskId: task.id,
      taskStatus: null,
      executionStatus: null,
      taskTitle: task.title,
      executionId: null,
      turns: null,
      toolCounts: [],
      missingCriticalTools: [],
      urls: {
        canonical,
        checkedBase: canonical,
        renderServiceId: company.render_service_id ?? null,
        githubRepo: company.github_repo ?? null,
      },
      liveChecks: [],
      browserUiChecks: scenario.browserUiChecks.map((spec) => ({
        name: spec.name,
        ok: false,
        missingTextPatterns: spec.requiredTextPatterns,
        missingButtonPatterns: spec.requiredButtonPatterns,
        consoleIssues: [],
        detail: `Canary reporter could not read platform DB after launch: ${errorMessageOf(reportError)}`,
      })),
      requiredFileChecks: [],
      dbTableChecks: [],
      productContractChecks: [{
        name: 'canary reporter evidence collection',
        ok: false,
        detail: `Canary reporter could not read platform DB after launch: ${errorMessageOf(reportError)}`,
      }],
      productContractReason: `canary reporter evidence collection: Canary reporter could not read platform DB after launch: ${errorMessageOf(reportError)}`,
      deterministicChecks: [],
      completionGateReason: `Canary reporter could not read platform DB after launch: ${errorMessageOf(reportError)}`,
      completionGateEvents: [],
      failureSummary: launchError,
      verificationEvidence: null,
      reportPath,
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  const { execution, events } = selectEvidenceExecution(executions);
  const toolCounts = summarizeTools(events);
  const calledTools = new Set(toolCounts.map((summary) => summary.toolName));
  const criticalTools = criticalToolsForScenario(scenario);
  const missingCriticalTools = missingCriticalToolsForRun(criticalTools, calledTools, freshCompany);

  const canonical = freshCompany?.custom_domain
    ? `https://${freshCompany.custom_domain}`
    : `https://${freshCompany?.subdomain ?? slug}.baljia.app`;
  const renderUrl = await resolveRenderServiceUrl(freshCompany?.render_service_id);
  const checkedBase = renderUrl ?? canonical;
  const state: Record<string, unknown> = {};
  const liveChecks = [];
  for (const spec of scenario.liveChecks) {
    liveChecks.push(await checkUrl(spec.name, checkedBase, spec, state));
  }
  const requiredFileChecks = await checkRequiredRepoFiles(freshCompany?.github_repo, scenario.requiredRoutes);
  const dbTableChecks = await checkRequiredDbTables(company.id, scenario.requiredTables);
  const dbTableChecksPassed = dbTableChecks.every((check) => check.ok);
  const gateEvents = eventsWithRunnerDbProof(events, dbTableChecksPassed);
  const deterministicChecks = [
    ...deterministicEvidenceChecks(gateEvents, isDesignCritiqueConfigured(), dbTableChecksPassed),
    ...requiredEvidenceChecksForScenario(gateEvents, scenario),
    ...scenarioDbEvidenceChecks(events, scenario, dbTableChecks),
  ];

  const verificationEvidence = executionVerificationEvidenceOf(execution);
  const gateReason = verificationEvidenceCompletionGateResolved(verificationEvidence)
    ? null
    : engineeringCompletionGate(30, gateEvents, freshTask as never);
  const failureSummary = freshTask?.status === 'failed' || execution?.status === 'failed'
    ? executionErrorSummaryOf(execution) ?? (typeof freshTask?.failure_class === 'string' ? freshTask.failure_class : null)
    : null;
  const completionGateReason = launchError
    ? `External/tooling blocker before agent execution: ${launchError}`
    : failureSummary
      ? `Task failed before completion: ${failureSummary}`
      : gateReason;
  const verificationPassed = execution?.status === 'completed';
  const deterministicChecksPassed = deterministicChecks.every((check) => check.ok);
  const outputDir = path.join(process.cwd(), 'measurement-output', treeRoot, runId);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const browserUiChecks = await runBrowserUiChecks(scenario, checkedBase, outputDir, state);
  const productContractChecks = productContractChecksForScenario({
    events: lineageGateEvents,
    liveChecks,
    liveCheckSpecs: scenario.liveChecks,
    requiredFileChecks,
    dbTableChecks,
    browserUiChecks,
  });
  const productGate = productContractGate(productContractChecks);
  const productReady = productGate.ok;
  const ok =
    !launchError &&
    freshTask?.status === 'completed' &&
    verificationPassed &&
    productReady &&
    deterministicChecksPassed &&
    missingCriticalTools.length === 0 &&
    completionGateReason === null;
  const terminalState = classifyCanaryTerminalState({ ok, productReady });

  const reportPath = path.join(outputDir, `${scenario.id}.json`);

  const report: CanaryReport = {
    ok,
    terminalState,
    productReady,
    scenarioId: scenario.id,
    runId,
    companyId: company.id,
    companySlug: slug,
    taskId: task.id,
    taskStatus: freshTask?.status ?? null,
    executionStatus: execution?.status ?? null,
    taskTitle: task.title,
    executionId: execution?.id ?? null,
    turns: executionTurnCountOf(execution),
    toolCounts,
    missingCriticalTools,
    urls: {
      canonical,
      checkedBase,
      renderServiceId: freshCompany?.render_service_id ?? null,
      githubRepo: freshCompany?.github_repo ?? null,
    },
    liveChecks,
    browserUiChecks,
    requiredFileChecks,
    dbTableChecks,
    productContractChecks,
    productContractReason: productGate.reason,
    deterministicChecks,
    completionGateReason,
    completionGateEvents: findCompletionGateEvents(gateEvents),
    failureSummary,
    verificationEvidence,
    reportPath,
  };

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function replayScenarioReport(
  scenario: CanaryScenario,
  runId: string,
  taskId: string,
  treeRoot: 'engineering-world-class' | 'engineering-95' = 'engineering-95',
): Promise<CanaryReport> {
  const [freshTask] = await retryDbRead(`read replay task ${taskId}`, async () => (
    await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  ));
  if (!freshTask) throw new Error(`Cannot replay canary report: task not found: ${taskId}`);

  const [freshCompany] = await retryDbRead(`read replay company ${freshTask.company_id}`, async () => (
    await db.select().from(companies).where(eq(companies.id, freshTask.company_id)).limit(1)
  ));
  if (!freshCompany) throw new Error(`Cannot replay canary report: company not found: ${freshTask.company_id}`);

  const executions = await loadTaskExecutionsWithEvidence(taskId);
  const { execution, events } = selectEvidenceExecution(executions);
  const relatedEvents = await loadRelatedTaskEvidenceEvents(freshTask, taskId);
  const lineageEvents = [...relatedEvents, ...events];
  const toolCounts = summarizeTools(events);
  const calledTools = new Set(summarizeTools(lineageEvents).map((summary) => summary.toolName));
  const criticalTools = criticalToolsForScenario(scenario);

  const slug = freshCompany.slug ?? freshCompany.subdomain ?? scenario.id;
  const canonical = freshCompany.custom_domain
    ? `https://${freshCompany.custom_domain}`
    : `https://${freshCompany.subdomain ?? slug}.baljia.app`;
  const renderUrl = await resolveRenderServiceUrl(freshCompany.render_service_id);
  const checkedBase = renderUrl ?? canonical;
  const state: Record<string, unknown> = {};
  const liveChecks = [];
  for (const spec of scenario.liveChecks) {
    liveChecks.push(await checkUrl(spec.name, checkedBase, spec, state));
  }
  const requiredFileChecks = await checkRequiredRepoFiles(freshCompany.github_repo, scenario.requiredRoutes);
  const dbTableChecks = await checkRequiredDbTables(freshCompany.id, scenario.requiredTables);
  const dbTableChecksPassed = dbTableChecks.every((check) => check.ok);
  const missingCriticalTools = missingCriticalToolsForRun(criticalTools, calledTools, freshCompany, {
    allowExistingProvisioning: true,
    dbProofPassed: dbTableChecksPassed,
  });
  const gateEvents = eventsWithRunnerDbProof(events, dbTableChecksPassed);
  const lineageGateEvents = eventsWithRunnerDbProof(lineageEvents, dbTableChecksPassed);
  const deterministicChecks = [
    ...deterministicEvidenceChecks(gateEvents, isDesignCritiqueConfigured(), dbTableChecksPassed),
    ...requiredEvidenceChecksForScenario(lineageGateEvents, scenario),
    ...scenarioDbEvidenceChecks(events, scenario, dbTableChecks),
  ];

  const verificationEvidence = executionVerificationEvidenceOf(execution);
  const gateReason = verificationEvidenceCompletionGateResolved(verificationEvidence)
    ? null
    : engineeringCompletionGate(30, gateEvents, freshTask as never);
  const failureSummary = freshTask.status === 'failed' || execution?.status === 'failed'
    ? executionErrorSummaryOf(execution) ?? (typeof freshTask.failure_class === 'string' ? freshTask.failure_class : null)
    : null;
  const completionGateReason = failureSummary
    ? `Task failed before completion: ${failureSummary}`
    : gateReason;
  const verificationPassed = execution?.status === 'completed';
  const deterministicChecksPassed = deterministicChecks.every((check) => check.ok);
  const outputDir = path.join(process.cwd(), 'measurement-output', treeRoot, runId);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const browserUiChecks = await runBrowserUiChecks(scenario, checkedBase, outputDir, state);
  const productContractChecks = productContractChecksForScenario({
    events: lineageGateEvents,
    liveChecks,
    liveCheckSpecs: scenario.liveChecks,
    requiredFileChecks,
    dbTableChecks,
    browserUiChecks,
  });
  const productGate = productContractGate(productContractChecks);
  const productReady = productGate.ok;
  const ok =
    freshTask.status === 'completed' &&
    verificationPassed &&
    productReady &&
    deterministicChecksPassed &&
    missingCriticalTools.length === 0 &&
    completionGateReason === null;
  const terminalState = classifyCanaryTerminalState({ ok, productReady });

  const reportPath = path.join(outputDir, `${scenario.id}.json`);

  const report: CanaryReport = {
    ok,
    terminalState,
    productReady,
    scenarioId: scenario.id,
    runId,
    companyId: freshCompany.id,
    companySlug: slug,
    taskId,
    taskStatus: freshTask.status ?? null,
    executionStatus: execution?.status ?? null,
    taskTitle: freshTask.title,
    executionId: execution?.id ?? null,
    turns: executionTurnCountOf(execution),
    toolCounts,
    missingCriticalTools,
    urls: {
      canonical,
      checkedBase,
      renderServiceId: freshCompany.render_service_id ?? null,
      githubRepo: freshCompany.github_repo ?? null,
    },
    liveChecks,
    browserUiChecks,
    requiredFileChecks,
    dbTableChecks,
    productContractChecks,
    productContractReason: productGate.reason,
    deterministicChecks,
    completionGateReason,
    completionGateEvents: findCompletionGateEvents(gateEvents),
    failureSummary,
    verificationEvidence,
    reportPath,
  };

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

export function blockerForReport(report: CanaryReport): string | null {
  if (report.ok) return null;
  const renderQuotaBlocker = renderPipelineQuotaBlockerForReport(report);
  if (renderQuotaBlocker) return renderQuotaBlocker;
  if (report.productReady) {
    const orchestrationGaps = [
      report.missingCriticalTools.length > 0
        ? `missing tools: ${report.missingCriticalTools.join(', ')}`
        : null,
      ...report.deterministicChecks
        .filter((check) => !check.ok)
        .map((check) => `failed deterministic check: ${check.name}`),
      report.completionGateReason ? `completion gate: ${report.completionGateReason}` : null,
    ].filter(Boolean);
    return orchestrationGaps.length > 0
      ? `working product; orchestration incomplete: ${orchestrationGaps.join(' | ')}`
      : 'working product; orchestration incomplete';
  }
  const failedBeforeProvisioning = !report.urls.renderServiceId && !report.urls.githubRepo;
  if (failedBeforeProvisioning && report.completionGateReason) {
    return `pre-implementation failure: ${report.completionGateReason}`;
  }
  if (report.productContractReason) return report.productContractReason;
  if (report.completionGateReason) return report.completionGateReason;
  if (report.missingCriticalTools.length > 0) return report.missingCriticalTools.join(', ');
  const failedBrowserChecks = report.browserUiChecks.filter((check) => !check.ok).map((check) => check.name);
  if (failedBrowserChecks.length > 0) return failedBrowserChecks.join(', ');
  const failedDeterministic = report.deterministicChecks.filter((check) => !check.ok).map((check) => check.name);
  if (failedDeterministic.length > 0) return failedDeterministic.join(', ');
  const failedDbTables = report.dbTableChecks.filter((check) => !check.ok).map((check) => check.name);
  if (failedDbTables.length > 0) return failedDbTables.join(', ');
  const failedFiles = report.requiredFileChecks.filter((check) => !check.ok).map((check) => check.name);
  if (failedFiles.length > 0) return failedFiles.join(', ');
  return 'live checks or deterministic verification failed';
}

function renderPipelineQuotaBlockerForReport(report: CanaryReport): string | null {
  const candidates = [
    report.failureSummary,
    report.completionGateReason,
    report.productContractReason,
    ...(Array.isArray(report.completionGateEvents) ? report.completionGateEvents : []),
    ...(Array.isArray(report.deterministicChecks) ? report.deterministicChecks.map((check) => `${check.name}: ${check.detail}`) : []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const match = candidates.find((value) => hasRenderPipelineQuotaSignal(value));
  if (!match) return null;

  return [
    'external Render quota blocker: pipeline_minutes_exhausted',
    'Render rejected or circuit-broke the build before app build logs; this is not an app-code failure.',
    'Rerun deploy verification only after Render build minutes/quota are restored.',
    `detail: ${match.slice(0, 500)}`,
  ].join(' ');
}

export function selectScenariosForRun(parsed: ReturnType<typeof parseArgs>): CanaryScenario[] {
  const allScenariosCatalog: CanaryScenario[] = [...CANARY_SCENARIOS, ...EXTENDED_CANARY_SCENARIOS];
  if (parsed.scenarioId) {
    const found = allScenariosCatalog.find((scenario) => scenario.id === parsed.scenarioId);
    if (!found) {
      throw new Error(`Unknown scenario "${parsed.scenarioId}". Available: ${allScenariosCatalog.map((s) => s.id).join(', ')}`);
    }
    return [found];
  }
  if (parsed.runAll || parsed.confidenceRun) return allScenariosCatalog;
  if (parsed.runExtended && parsed.runCore) return allScenariosCatalog;
  if (parsed.runExtended) return EXTENDED_CANARY_SCENARIOS;
  if (parsed.runCore) return CANARY_SCENARIOS;
  return CANARY_SCENARIOS;
}

export function resolveTreeRoot(parsed: ReturnType<typeof parseArgs>): 'engineering-world-class' | 'engineering-95' {
  return parsed.runAll || parsed.confidenceRun || parsed.runExtended
    ? 'engineering-world-class'
    : 'engineering-95';
}

export async function runCanaryMatrix(args = process.argv.slice(2)) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    console.log(canaryUsage());
    return {
      runId: parsed.runId,
      ok: true,
      passed: 0,
      total: 0,
      reports: [],
      help: true,
    };
  }
  const treeRoot = resolveTreeRoot(parsed);
  if (parsed.replayTaskId && !parsed.scenarioId) throw new Error('--replay-task requires --scenario <id>');
  const selectedScenarios = selectScenariosForRun(parsed);
  const cachedBlock = cachedCanaryPreflightBlockForRun(treeRoot, parsed.forceAfterQuotaRestored);
  if (cachedBlock) {
    return writePreflightBlockedSummary(parsed.runId, treeRoot, selectedScenarios, cachedBlock);
  }
  const preflight = await canaryRunnerPreflightResult(parsed.forceAfterQuotaRestored);
  if (!preflight.ok) {
    return writePreflightBlockedSummary(parsed.runId, treeRoot, selectedScenarios, preflight.failures);
  }
  if (parsed.replayTaskId) {
    const scenario = selectedScenarios[0];
    if (!scenario) {
      const allScenariosCatalog: CanaryScenario[] = [...CANARY_SCENARIOS, ...EXTENDED_CANARY_SCENARIOS];
      throw new Error(`Unknown scenario "${parsed.scenarioId}". Available: ${allScenariosCatalog.map((candidate) => candidate.id).join(', ')}`);
    }
    const report = await replayScenarioReport(scenario, parsed.runId, parsed.replayTaskId, treeRoot);
    const outputDir = path.join(process.cwd(), 'measurement-output', treeRoot, parsed.runId);
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    const summaryPath = path.join(outputDir, 'summary.json');
    const summary = {
      runId: parsed.runId,
      ok: report.ok,
      passed: report.ok ? 1 : 0,
      total: 1,
      reports: [{
        scenarioId: report.scenarioId,
        ok: report.ok,
        terminalState: report.terminalState,
        productReady: report.productReady,
        taskId: report.taskId,
        liveUrl: report.urls.checkedBase,
        reportPath: report.reportPath,
        blocker: blockerForReport(report),
      }],
    };
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) process.exitCode = 1;
    return summary;
  }

  // Scenario selection — supports the goal's Section 7 CLI:
  //   --scenario <id>     run exactly that scenario (core or extended)
  //   --core              run only the 7 core scenarios
  //   --extended          run only the 12 extended scenarios
  //   --all               run all 19 (core + extended)
  //   --confidence-run    after the run, emit confidence-report JSON + Markdown
  //   (no flag)           same as previous default — full core runway
  const scenarios = selectedScenarios;
  const runFullRunway = scenarios.length > 1;

  // World-class runs (--all / --confidence-run / --extended) write under the
  // dedicated engineering-world-class/<run-id>/ tree per goal Section 7.
  // Older engineering-95 tree is preserved for legacy runs.
  const reports: CanaryReport[] = [];
  for (const scenario of scenarios) {
    let report = await runScenario(scenario, parsed.runId, treeRoot);
    if (shouldAutoReplayCanaryReport(report)) {
      try {
        report = await replayScenarioReport(scenario, parsed.runId, report.taskId, treeRoot);
      } catch (error) {
        console.warn(`Automatic canary replay failed for ${scenario.id}/${report.taskId}: ${errorMessageOf(error)}`);
      }
    }
    reports.push(report);
    if (!report.ok && !runFullRunway) break;
  }

  const outputDir = path.join(process.cwd(), 'measurement-output', treeRoot, parsed.runId);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const summaryPath = path.join(outputDir, 'summary.json');
  const summary = {
    runId: parsed.runId,
    ok: reports.length === scenarios.length && reports.every((report) => report.ok),
    passed: reports.filter((report) => report.ok).length,
    total: scenarios.length,
    reports: reports.map((report) => ({
      scenarioId: report.scenarioId,
      ok: report.ok,
      terminalState: report.terminalState,
      productReady: report.productReady,
      taskId: report.taskId,
      liveUrl: report.urls.checkedBase,
      reportPath: report.reportPath,
      blocker: blockerForReport(report),
    })),
  };
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));

  if (parsed.confidenceRun) {
    try {
      const { jsonPath, markdownPath, report } = writeConfidenceReport(outputDir);
      console.log(`\nConfidence report written:\n  ${jsonPath}\n  ${markdownPath}\n${report.confidenceSummary}`);
    } catch (error) {
      console.error('Failed to write confidence report:', error);
    }
  }

  if (!summary.ok) process.exitCode = 1;
  return summary;
}

if (require.main === module) {
  runCanaryMatrix()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      process.exit(process.exitCode ?? 0);
    });
}
