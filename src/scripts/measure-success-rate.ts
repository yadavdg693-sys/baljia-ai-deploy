// Measure first-shot engineering-task success rate against the locked
// envelope. Runs N engineering tasks back-to-back against a target
// company and reports:
//   - first-shot pass count (verifier passes on first run, no remediation)
//   - cost per task
//   - whether the agent called verify_user_journey, write_codebase_map,
//     read_known_issues (the new hard-gate / new memory wiring)
//   - whether the static_code_scan was clean
//   - stop_reason distribution (watchdog/loop/cost/prompt-too-long/end_turn)
//   - turn_count + wall_clock_seconds distributions
//   - per-run JSON dump (full execution_log) under --output-dir for offline analysis
//
// Usage:
//   npx tsx --env-file=.env.local src/scripts/measure-success-rate.ts \
//     --company <slug-or-id> [--limit N] [--task "title|description|complexity"] \
//     [--output-dir measurement-output]
//
// Defaults to a small built-in task suite if no --task flags are passed.
//
// SAFETY: each task burns real API spend (typically $0.30 - $1.50). Default
// limit is 1 (pilot). Pass --limit 10 only after reviewing pilot output.

import * as taskService from '@/lib/services/task.service';
import { launchTask } from '@/lib/agents/worker-launcher';
import { db, companies, taskExecutions } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface SampleTask {
  title: string;
  description: string;
  complexity: number;
}

// 20 distinct read-only endpoint-addition tasks. Each adds a unique route so
// repeated runs against the same company don't conflict. All call shape:
// add HTTP route → deploy → check_url_health → verify_user_journey → write_codebase_map.
const DEFAULT_TASKS: SampleTask[] = [
  { title: 'Add /healthz endpoint',        description: 'Add GET /healthz returning 200 { ok: true, ts: <ISO> }. Public route. Verify with verify_user_journey: GET /healthz → 200 + body contains "ok":true.', complexity: 2 },
  { title: 'Add /api/version endpoint',    description: 'Add GET /api/version returning 200 { version: <package.json version>, node: <process.version> }. Verify: GET /api/version → 200 + body contains "version".', complexity: 2 },
  { title: 'Add /api/ping endpoint',       description: 'Add GET /api/ping returning 200 { pong: true, ts: <ISO> }. Verify: GET /api/ping → 200 + body contains "pong":true.', complexity: 2 },
  { title: 'Add /api/now endpoint',        description: 'Add GET /api/now returning 200 { now_iso: <ISO>, now_unix: <ms>, tz: <process.env.TZ ?? "UTC"> }. Verify: GET /api/now → 200 + body contains "now_iso".', complexity: 2 },
  { title: 'Add /api/uuid endpoint',       description: 'Add GET /api/uuid returning 200 { uuid: <crypto.randomUUID()> }. Verify: GET /api/uuid → 200 + body contains "uuid".', complexity: 2 },
  { title: 'Add /api/server-info',         description: 'Add GET /api/server-info returning 200 { hostname: <os.hostname()>, uptime_s: <process.uptime()>, node: <process.version> }. Verify: GET /api/server-info → 200 + body contains "hostname".', complexity: 2 },
  { title: 'Add /api/echo POST endpoint',  description: 'Add POST /api/echo that returns 200 { echoed: <request body> }. Accept any JSON body. Verify: POST /api/echo {"x":1} → 200 + body contains "echoed".', complexity: 2 },
  { title: 'Add /api/coin-flip endpoint',  description: 'Add GET /api/coin-flip returning 200 { result: "heads" | "tails" }. Verify: GET /api/coin-flip → 200 + body contains "result".', complexity: 2 },
  { title: 'Add /api/uppercase POST',      description: 'Add POST /api/uppercase that accepts { text: string } and returns 200 { input: <text>, output: <UPPERCASE> }. Reject non-string with 400. Verify: POST /api/uppercase {"text":"hi"} → 200 + body contains "OUTPUT":"HI" (case-insensitive on key, exact on value "HI").', complexity: 3 },
  { title: 'Add /api/reverse POST',        description: 'Add POST /api/reverse that accepts { text: string } and returns 200 { input, output: <reversed string> }. Reject non-string with 400. Verify: POST /api/reverse {"text":"abc"} → 200 + body contains "cba".', complexity: 3 },
  { title: 'Add /api/word-count POST',     description: 'Add POST /api/word-count that accepts { text: string } and returns 200 { word_count: <integer> }. Verify: POST /api/word-count {"text":"hello world foo"} → 200 + body contains "word_count":3.', complexity: 3 },
  { title: 'Add /api/timestamps endpoint', description: 'Add GET /api/timestamps returning 200 { iso: <ISO>, unix_s: <seconds>, unix_ms: <milliseconds> }. Verify: GET /api/timestamps → 200 + body contains "unix_s".', complexity: 2 },
  { title: 'Add /api/base64-encode POST',  description: 'Add POST /api/base64-encode that accepts { text: string } and returns 200 { input, output: <base64 of text> }. Verify: POST /api/base64-encode {"text":"hi"} → 200 + body contains "aGk=".', complexity: 3 },
  { title: 'Add /api/json-validate POST',  description: 'Add POST /api/json-validate that accepts raw text body and returns 200 { is_valid_json: boolean, parsed?: any }. Verify: POST /api/json-validate with body `{"x":1}` → 200 + body contains "is_valid_json":true.', complexity: 3 },
  { title: 'Add /api/headers-debug',       description: 'Add GET /api/headers-debug returning 200 { user_agent: <req header>, accept: <req header>, all_headers: <count of headers> }. Verify: GET /api/headers-debug → 200 + body contains "user_agent".', complexity: 2 },
  { title: 'Add /api/random endpoint',     description: 'Add GET /api/random returning 200 { value: <Math.random()>, ts: <ISO> }. Verify: GET /api/random → 200 + body contains "value".', complexity: 2 },
  { title: 'Add /api/sleep endpoint',      description: 'Add GET /api/sleep?ms=N (N capped at 5000) that delays then returns 200 { slept_ms: <N> }. Verify: GET /api/sleep?ms=100 → 200 + body contains "slept_ms":100.', complexity: 3 },
  { title: 'Add /api/lipsum endpoint',     description: 'Add GET /api/lipsum returning 200 { text: <static 100 chars of placeholder text>, length: 100 }. Verify: GET /api/lipsum → 200 + body contains "length":100.', complexity: 2 },
  { title: 'Add /api/method-list',         description: 'Add GET /api/method-list returning 200 { supported: ["GET","POST","PUT","DELETE","PATCH"] }. Verify: GET /api/method-list → 200 + body contains "supported".', complexity: 2 },
  { title: 'Add /api/whoami endpoint',     description: 'Add GET /api/whoami returning 200 { ip: <req.ip>, user_agent: <req header>, ts: <ISO> }. Trust proxy must be set. Verify: GET /api/whoami → 200 + body contains "ip".', complexity: 2 },
];

// Terminal stop reasons emitted to execution_log by agent-factory.ts.
// Anything else (provider exhaustion, prompt-too-long, 4-hour timeout,
// abort-on-watchdog) surfaces in execution.error_summary instead.
type StopReason =
  | 'end_turn'              // model produced text-only response (natural completion)
  | 'completed'             // tool result emitted a final completion summary
  | 'watchdog_kill'         // turn or time budget exceeded
  | 'watchdog_health_kill'  // idle/stuck detected by active monitor
  | 'loop_kill'             // same tool repeated past LOOP_THRESHOLD
  | 'cost_kill'             // cost ceiling exceeded
  | 'prompt_too_long'       // 413 / context_length_exceeded / "prompt is too long"
  | 'outer_timeout'         // 4-hour MAX_EXECUTION_MS hit
  | 'provider_exhausted'    // all providers in chain failed
  | 'network_outage'        // ECONNRESET / ENOENT / fetch failed — local or upstream net issue
  | 'auth_error'            // 401 from Anthropic (OAuth token expired/refresh failed)
  | 'launch_threw'          // launchTask threw before agent loop entered
  | 'unknown';              // log empty or unrecognised tail

type RunResult = {
  task_id: string;
  title: string;
  complexity: number;
  status: string;            // task status after verifier
  verifier_passed: boolean;
  stop_reason: StopReason;
  turn_count: number;
  wall_clock_seconds: number;
  cost_usd: number;
  cost_ceiling_usd: number | null;
  called_verify_user_journey: boolean;
  called_write_codebase_map: boolean;
  called_read_known_issues: boolean;
  called_static_code_scan: boolean;
  static_scan_clean: boolean;
  tool_calls_total: number;
  tools_per_turn_avg: number;
  failure_reason: string | null;
  error_summary: string | null;
};

function parseArgs(): { company: string | null; limit: number; tasks: SampleTask[]; outputDir: string } {
  const args = process.argv.slice(2);
  let company: string | null = null;
  let limit = 1;
  let outputDir = `measurement-output/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const tasks: SampleTask[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--company') company = args[++i];
    else if (args[i] === '--limit') limit = Math.max(1, parseInt(args[++i], 10) || 1);
    else if (args[i] === '--output-dir') outputDir = args[++i];
    else if (args[i] === '--task') {
      const [title, description, complexity] = args[++i].split('|');
      tasks.push({ title, description, complexity: parseInt(complexity, 10) || 3 });
    }
  }
  return { company, limit, tasks: tasks.length > 0 ? tasks : DEFAULT_TASKS, outputDir };
}

// Detects whether an error_summary string is the API rejecting the prompt
// for being too long. Tracks Anthropic, OpenAI, and Gemini variants.
const PROMPT_TOO_LONG_RE =
  /prompt is too long|prompt_too_long|413|context[_ ]length[_ ]exceeded|maximum context length|input length|input is too long/i;

// Network-outage signatures — both Anthropic streaming drops and Neon DNS
// failures land here. We classify these separately because they're external
// events, not engineering-agent failures, and the credit shouldn't count
// against the harness's success rate.
const NETWORK_OUTAGE_RE =
  /ECONNRESET|ENOENT|fetch failed|getaddrinfo|ENOTFOUND|ETIMEDOUT|socket hang up|read ECONN/i;

// 401 / authentication_error from Anthropic — OAuth token expired or rejected.
// Equityzen 2026-05-12 task #17 (/api/sleep) hit this mid-run; check_url_health
// fix didn't help because the agent never got past turn 0 — every API call 401'd.
const AUTH_ERROR_RE =
  /\b401\b|authentication_error|invalid authentication credentials|invalid api key|invalid bearer/i;

function classifyStopReason(
  log: unknown[],
  errorSummary: string | null,
  status: string
): StopReason {
  // 1. error_summary takes precedence — if the run threw, that's the real story
  if (errorSummary) {
    if (AUTH_ERROR_RE.test(errorSummary)) return 'auth_error';
    if (PROMPT_TOO_LONG_RE.test(errorSummary)) return 'prompt_too_long';
    if (NETWORK_OUTAGE_RE.test(errorSummary)) return 'network_outage';
    if (/timed out after \d+s/i.test(errorSummary)) return 'outer_timeout';
    if (/killed by watchdog/i.test(errorSummary)) return 'watchdog_health_kill';
    if (/all providers (failed|exhausted)|provider chain exhausted/i.test(errorSummary)) return 'provider_exhausted';
    if (status === 'launch_threw') return 'launch_threw';
  }

  // 2. Walk execution_log backward for the most recent terminal event
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (typeof e !== 'object' || e === null) continue;
    const event = (e as Record<string, unknown>).event;
    if (
      event === 'end_turn' ||
      event === 'completed' ||
      event === 'watchdog_kill' ||
      event === 'watchdog_health_kill' ||
      event === 'loop_kill' ||
      event === 'cost_kill'
    ) {
      return event as StopReason;
    }
  }

  return 'unknown';
}

function countToolCalls(log: unknown[]): { total: number; turns: number } {
  let total = 0;
  const turns = new Set<number>();
  for (const e of log) {
    if (typeof e !== 'object' || e === null) continue;
    const entry = e as Record<string, unknown>;
    if (typeof entry.tool === 'string' && entry.event === undefined) {
      total++;
      if (typeof entry.turn === 'number') turns.add(entry.turn);
    }
  }
  return { total, turns: turns.size };
}

async function resolveCompanyId(input: string): Promise<string> {
  // Accept either a UUID id or a slug.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(input)) return input;
  const [c] = await db.select({ id: companies.id })
    .from(companies)
    .where(eq(companies.slug, input))
    .limit(1);
  if (!c) throw new Error(`No company found with slug "${input}"`);
  return c.id;
}

async function loadExecutionDetails(taskId: string) {
  const [execution] = await db.select({
    execution_log: taskExecutions.execution_log,
    turn_count: taskExecutions.turn_count,
    token_usage: taskExecutions.token_usage,
    status: taskExecutions.status,
    wall_clock_seconds: taskExecutions.wall_clock_seconds,
    error_summary: taskExecutions.error_summary,
    watchdog_events: taskExecutions.watchdog_events,
    verification_evidence: taskExecutions.verification_evidence,
  })
    .from(taskExecutions)
    .where(eq(taskExecutions.task_id, taskId))
    .orderBy(desc(taskExecutions.started_at))
    .limit(1);
  return execution ?? null;
}

function calledTool(log: unknown[], toolName: string): boolean {
  return log.some((e) => typeof e === 'object' && e !== null && (e as Record<string, unknown>).tool === toolName);
}

function staticScanClean(log: unknown[]): boolean {
  for (const e of log) {
    if (typeof e !== 'object' || e === null) continue;
    const entry = e as Record<string, unknown>;
    if (entry.tool === 'static_code_scan' && typeof entry.result === 'string') {
      if (/STATIC SCAN PASS\b|high=0\b/.test(entry.result)) return true;
    }
  }
  return false;
}

async function runOne(companyId: string, sample: SampleTask, outputDir: string): Promise<RunResult> {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Task: ${sample.title}`);
  console.log(`Complexity: ${sample.complexity}`);

  const created = await taskService.createTask({
    company_id: companyId,
    title: sample.title,
    description: sample.description,
    tag: 'engineering',
    priority: 50,           // mid-priority integer
    estimated_credits: 1,
    complexity: sample.complexity,
    source: 'system',
    authorized_by: 'measurement_script',
    authorization_reason: 'measure-success-rate',
  } as never);

  console.log(`Task created: ${created.id}`);
  const startedAt = Date.now();

  const result: RunResult = {
    task_id: created.id,
    title: sample.title,
    complexity: sample.complexity,
    status: 'unknown',
    verifier_passed: false,
    stop_reason: 'unknown',
    turn_count: 0,
    wall_clock_seconds: 0,
    cost_usd: 0,
    cost_ceiling_usd: null,
    called_verify_user_journey: false,
    called_write_codebase_map: false,
    called_read_known_issues: false,
    called_static_code_scan: false,
    static_scan_clean: false,
    tool_calls_total: 0,
    tools_per_turn_avg: 0,
    failure_reason: null,
    error_summary: null,
  };

  try {
    const execution = await launchTask(created.id, { subscriptionFunded: true });
    result.status = execution.status;
    result.turn_count = execution.turn_count ?? 0;
  } catch (err) {
    result.failure_reason = err instanceof Error ? err.message : String(err);
    result.status = 'launch_threw';
    console.log(`  ✗ launchTask threw: ${result.failure_reason}`);
  }

  // Re-read task + execution AFTER verifier has run.
  // Wrapped in try/catch so a transient network blip during inspection does
  // NOT lose the per-run dump (the script previously crashed here when both
  // Anthropic and Neon went unreachable mid-run).
  let finalTask: Awaited<ReturnType<typeof taskService.getTask>> | null = null;
  let exec: Awaited<ReturnType<typeof loadExecutionDetails>> = null;
  try {
    finalTask = await taskService.getTask(created.id);
  } catch (err) {
    console.log(`  ! getTask failed (post-run inspection): ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    exec = await loadExecutionDetails(created.id);
  } catch (err) {
    console.log(`  ! loadExecutionDetails failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (finalTask) {
    result.status = finalTask.status;
    result.verifier_passed = finalTask.status === 'completed';
  }

  let log: unknown[] = [];
  if (exec) {
    result.turn_count = exec.turn_count ?? result.turn_count;
    result.wall_clock_seconds = exec.wall_clock_seconds ?? 0;
    result.error_summary = exec.error_summary ?? null;
    const tokenUsage = exec.token_usage as { cost_usd?: number; ceiling_usd?: number | null } | null;
    if (tokenUsage) {
      result.cost_usd = tokenUsage.cost_usd ?? 0;
      result.cost_ceiling_usd = tokenUsage.ceiling_usd ?? null;
    }
    log = (exec.execution_log ?? []) as unknown[];
    result.called_verify_user_journey = calledTool(log, 'verify_user_journey');
    result.called_write_codebase_map  = calledTool(log, 'write_codebase_map');
    result.called_read_known_issues   = calledTool(log, 'read_known_issues');
    result.called_static_code_scan    = calledTool(log, 'static_code_scan');
    result.static_scan_clean          = staticScanClean(log);
    result.stop_reason                = classifyStopReason(log, result.error_summary, result.status);
    const counts = countToolCalls(log);
    result.tool_calls_total           = counts.total;
    result.tools_per_turn_avg         = counts.turns > 0 ? counts.total / counts.turns : 0;
  } else {
    result.stop_reason = classifyStopReason([], result.failure_reason, result.status);
  }

  // Persist full per-run dump for offline analysis (execution_log, error, evidence)
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    const dump = {
      task_id: created.id,
      title: sample.title,
      complexity: sample.complexity,
      result,
      execution_log: log,
      error_summary: exec?.error_summary ?? null,
      watchdog_events: exec?.watchdog_events ?? null,
      verification_evidence: exec?.verification_evidence ?? null,
    };
    fs.writeFileSync(
      path.join(outputDir, `${created.id}.json`),
      JSON.stringify(dump, null, 2),
    );
  } catch (writeErr) {
    console.log(`  ! failed to persist run dump: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`);
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`  status=${result.status}  passed=${result.verifier_passed}  stop=${result.stop_reason}  turns=${result.turn_count}  wall=${result.wall_clock_seconds}s  cost=$${result.cost_usd.toFixed(4)}/${result.cost_ceiling_usd ?? '?'}  elapsed=${elapsed}s`);
  console.log(`  tools: total=${result.tool_calls_total} avg/turn=${result.tools_per_turn_avg.toFixed(2)}  journey=${result.called_verify_user_journey} codebase_map_write=${result.called_write_codebase_map} known_issues=${result.called_read_known_issues} static_scan=${result.called_static_code_scan}(clean=${result.static_scan_clean})`);
  if (result.failure_reason) console.log(`  ✗ reason: ${result.failure_reason}`);
  if (result.error_summary && result.error_summary !== result.failure_reason) console.log(`  ✗ error_summary: ${result.error_summary.substring(0, 200)}`);

  return result;
}

function summariseDistribution<T extends string>(values: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

void (async () => {
  const { company, limit, tasks, outputDir } = parseArgs();
  if (!company) {
    console.error('Usage: --company <slug-or-id> [--limit N] [--task "title|description|complexity"] [--output-dir DIR]');
    process.exit(2);
  }

  const companyId = await resolveCompanyId(company);
  const [comp] = await db.select({
    slug: companies.slug, lifecycle: companies.lifecycle,
    render_service_id: companies.render_service_id, github_repo: companies.github_repo,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Target: ${comp?.slug ?? '?'} (${companyId})`);
  console.log(`Lifecycle: ${comp?.lifecycle}  Render: ${comp?.render_service_id ?? '(none)'}  Repo: ${comp?.github_repo ?? '(none)'}`);
  console.log(`Output dir: ${outputDir}`);
  console.log(`Tasks queued: ${Math.min(limit, tasks.length)} of ${tasks.length} available`);

  fs.mkdirSync(outputDir, { recursive: true });

  const results: RunResult[] = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    const r = await runOne(companyId, tasks[i], outputDir);
    results.push(r);
  }

  // Summary
  const n = results.length;
  const passed = results.filter((r) => r.verifier_passed).length;
  const totalCost = results.reduce((s, r) => s + r.cost_usd, 0);
  const journeyRate     = results.filter((r) => r.called_verify_user_journey).length / n;
  const codebaseMapRate = results.filter((r) => r.called_write_codebase_map).length / n;
  const knownIssuesRate = results.filter((r) => r.called_read_known_issues).length / n;
  const staticScanRate  = results.filter((r) => r.called_static_code_scan).length / n;

  const stopReasonDist = summariseDistribution(results.map((r) => r.stop_reason));
  const stopReasonsFailedOnly = summariseDistribution(
    results.filter((r) => !r.verifier_passed).map((r) => r.stop_reason),
  );

  const turnsSorted = results.map((r) => r.turn_count).sort((a, b) => a - b);
  const wallSorted = results.map((r) => r.wall_clock_seconds).sort((a, b) => a - b);
  const toolsPerTurnSorted = results.map((r) => r.tools_per_turn_avg).sort((a, b) => a - b);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`SUMMARY  (n=${n})`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`First-shot pass:    ${passed}/${n}  (${Math.round(passed / n * 100)}%)`);
  console.log(`Total cost:         $${totalCost.toFixed(4)}  (avg $${(totalCost / n).toFixed(4)}/task)`);
  console.log(`verify_user_journey: ${Math.round(journeyRate * 100)}% of tasks`);
  console.log(`write_codebase_map:  ${Math.round(codebaseMapRate * 100)}% of tasks`);
  console.log(`read_known_issues:   ${Math.round(knownIssuesRate * 100)}% of tasks`);
  console.log(`static_code_scan:    ${Math.round(staticScanRate * 100)}% of tasks`);
  console.log(``);
  console.log(`Turns:               p50=${percentile(turnsSorted, 50)}  p90=${percentile(turnsSorted, 90)}  max=${percentile(turnsSorted, 100)}`);
  console.log(`Wall-clock (s):      p50=${percentile(wallSorted, 50)}  p90=${percentile(wallSorted, 90)}  max=${percentile(wallSorted, 100)}`);
  console.log(`Tools/turn:          p50=${percentile(toolsPerTurnSorted, 50).toFixed(2)}  p90=${percentile(toolsPerTurnSorted, 90).toFixed(2)}  max=${percentile(toolsPerTurnSorted, 100).toFixed(2)}`);
  console.log(``);
  console.log(`Stop reasons (all runs):`);
  for (const [reason, count] of Object.entries(stopReasonDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(22)} ${count}  (${Math.round(count / n * 100)}%)`);
  }
  if (Object.keys(stopReasonsFailedOnly).length > 0) {
    console.log(``);
    console.log(`Stop reasons (failed runs only):`);
    const failedN = n - passed;
    for (const [reason, count] of Object.entries(stopReasonsFailedOnly).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason.padEnd(22)} ${count}  (${Math.round(count / failedN * 100)}%)`);
    }
  }

  // Persist aggregate summary so future-you doesn't need stdout scrollback
  const summaryPath = path.join(outputDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    company: { id: companyId, slug: comp?.slug ?? null },
    timestamp: new Date().toISOString(),
    n,
    passed,
    pass_rate: passed / n,
    total_cost_usd: totalCost,
    avg_cost_usd: totalCost / n,
    tool_call_rates: {
      verify_user_journey: journeyRate,
      write_codebase_map: codebaseMapRate,
      read_known_issues: knownIssuesRate,
      static_code_scan: staticScanRate,
    },
    distributions: {
      turns:        { p50: percentile(turnsSorted, 50),        p90: percentile(turnsSorted, 90),        max: percentile(turnsSorted, 100) },
      wall_seconds: { p50: percentile(wallSorted, 50),         p90: percentile(wallSorted, 90),         max: percentile(wallSorted, 100) },
      tools_per_turn: { p50: percentile(toolsPerTurnSorted, 50), p90: percentile(toolsPerTurnSorted, 90), max: percentile(toolsPerTurnSorted, 100) },
    },
    stop_reasons_all: stopReasonDist,
    stop_reasons_failed: stopReasonsFailedOnly,
    runs: results,
  }, null, 2));
  console.log(``);
  console.log(`Summary written: ${summaryPath}`);
  console.log(`Per-run dumps:    ${outputDir}/<task_id>.json`);

  process.exit(passed === n ? 0 : 1);
})();
