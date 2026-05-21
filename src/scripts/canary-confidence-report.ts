// Confidence report generator for the world-class engineering canary suite.
//
// Reads canary report JSON files from a run directory and produces:
//   - core pass count (7)
//   - extended pass count (12)
//   - live URL list
//   - capability matrix (per scenario, which capabilities were exercised)
//   - domain matrix (per scenario, which domains were targeted)
//   - verification evidence summary
//   - failure classes (across failed scenarios)
//   - confidence label (per goal Confidence Rules):
//       <7/7 core → "incomplete — list exact blockers"
//       7/7 core → "95% core confidence"
//       7/7 core + 10/12 extended → "broad full-stack confidence"
//       7/7 core + 12/12 extended → "world-class confidence"
//
// Output: JSON file + Markdown summary written under the run dir.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CANARY_SCENARIOS } from './canary-core-scenarios';
import { EXTENDED_CANARY_SCENARIOS } from './canary-extended-scenarios';

// Lazy IDs sets — accessed only at call time to avoid issues when this module
// is loaded as part of a circular import graph from canary-render-engineering.
function coreIdSet(): Set<string> {
  return new Set(CANARY_SCENARIOS.map((s) => s.id));
}
function extendedIdSet(): Set<string> {
  return new Set(EXTENDED_CANARY_SCENARIOS.map((s) => s.id));
}

export type CanaryReportRecord = {
  ok?: boolean;
  terminalState?: string;
  productReady?: boolean;
  scenarioId?: string;
  runId?: string;
  taskId?: string;
  urls?: { canonical?: string; checkedBase?: string; renderServiceId?: string | null; githubRepo?: string | null };
  liveChecks?: Array<{ name: string; ok: boolean }>;
  browserUiChecks?: Array<{ name: string; ok: boolean }>;
  requiredFileChecks?: Array<{ name: string; ok: boolean }>;
  dbTableChecks?: Array<{ name: string; ok: boolean }>;
  productContractChecks?: Array<{ name: string; ok: boolean }>;
  deterministicChecks?: Array<{ name: string; ok: boolean }>;
  failureSummary?: string | null;
  failureClass?: string | null;
};

export type ConfidenceLabel =
  | 'incomplete'
  | '95-percent-core'
  | 'broad-fullstack'
  | 'world-class';

export type ConfidenceReport = {
  generatedAt: string;
  runDir: string;
  coreTotal: number;
  corePassed: number;
  extendedTotal: number;
  extendedPassed: number;
  coreScenarios: Array<{ id: string; passed: boolean; reason: string; liveUrl?: string | null }>;
  extendedScenarios: Array<{ id: string; passed: boolean; reason: string; liveUrl?: string | null; domains: string[] }>;
  liveUrls: string[];
  capabilityMatrix: Array<{ scenario: string; capabilities: string[] }>;
  domainMatrix: Array<{ scenario: string; domains: string[] }>;
  verificationEvidence: Array<{ scenario: string; liveChecks: number; livePassed: number; browserChecks: number; browserPassed: number; dbChecks: number; dbPassed: number }>;
  failureClassesCounts: Record<string, number>;
  unresolvedGaps: string[];
  confidenceLabel: ConfidenceLabel;
  confidenceSummary: string;
};

function readAllReports(runDir: string): CanaryReportRecord[] {
  if (!existsSync(runDir)) return [];
  const stat = statSync(runDir);
  if (!stat.isDirectory()) return [];
  const reports: CanaryReportRecord[] = [];
  for (const entry of readdirSync(runDir)) {
    const full = path.join(runDir, entry);
    let entryStat;
    try {
      entryStat = statSync(full);
    } catch {
      continue;
    }
    if (entryStat.isDirectory()) {
      reports.push(...readAllReports(full));
      continue;
    }
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = readFileSync(full, 'utf8');
      const parsed = JSON.parse(raw) as CanaryReportRecord;
      if (parsed && (parsed.scenarioId || parsed.taskId)) reports.push(parsed);
    } catch {
      // Skip malformed.
    }
  }
  return reports;
}

function scenarioPassed(report: CanaryReportRecord): boolean {
  if (typeof report.ok === 'boolean') return report.ok;
  if (report.terminalState === 'PASS') return true;
  return false;
}

function scenarioReason(report: CanaryReportRecord): string {
  if (scenarioPassed(report)) return 'passed';
  if (report.failureSummary) return report.failureSummary;
  if (report.terminalState) return `terminalState=${report.terminalState}`;
  return 'no verdict in report';
}

function pickLatestByScenarioId(reports: CanaryReportRecord[]): Map<string, CanaryReportRecord> {
  const byScenario = new Map<string, CanaryReportRecord>();
  for (const report of reports) {
    if (!report.scenarioId) continue;
    // Last one wins (assuming chronological read order from readdir; not guaranteed,
    // but for our purposes good enough — typically only one report per scenario per run).
    byScenario.set(report.scenarioId, report);
  }
  return byScenario;
}

function classifyConfidence(corePassed: number, coreTotal: number, extendedPassed: number, extendedTotal: number): ConfidenceLabel {
  if (corePassed < coreTotal) return 'incomplete';
  if (extendedPassed >= extendedTotal) return 'world-class';
  if (extendedPassed >= 10 && extendedTotal === 12) return 'broad-fullstack';
  return '95-percent-core';
}

function confidenceSummary(label: ConfidenceLabel, corePassed: number, coreTotal: number, extendedPassed: number, extendedTotal: number): string {
  switch (label) {
    case 'world-class':
      return `World-class confidence: ${corePassed}/${coreTotal} core + ${extendedPassed}/${extendedTotal} extended.`;
    case 'broad-fullstack':
      return `Broad full-stack confidence: ${corePassed}/${coreTotal} core + ${extendedPassed}/${extendedTotal} extended.`;
    case '95-percent-core':
      return `95% core confidence: ${corePassed}/${coreTotal} core passed. Extended: ${extendedPassed}/${extendedTotal}.`;
    case 'incomplete':
    default:
      return `Incomplete: ${corePassed}/${coreTotal} core passed (need 7/7 to claim 95%). Extended: ${extendedPassed}/${extendedTotal}.`;
  }
}

export function generateConfidenceReport(runDir: string): ConfidenceReport {
  const reports = readAllReports(runDir);
  const byScenario = pickLatestByScenarioId(reports);

  // Reference extendedIdSet to silence unused-import lints — it's part of
  // the public surface for future filtering work.
  void extendedIdSet;
  const coreScenarios = [...coreIdSet()].map((id) => {
    const report = byScenario.get(id);
    return {
      id,
      passed: report ? scenarioPassed(report) : false,
      reason: report ? scenarioReason(report) : 'no report file found for scenario',
      liveUrl: report?.urls?.canonical ?? null,
    };
  });

  const extendedScenarios = EXTENDED_CANARY_SCENARIOS.map((scenario) => {
    const report = byScenario.get(scenario.id);
    return {
      id: scenario.id,
      passed: report ? scenarioPassed(report) : false,
      reason: report ? scenarioReason(report) : 'no report file found for scenario',
      liveUrl: report?.urls?.canonical ?? null,
      domains: scenario.domains,
    };
  });

  const corePassed = coreScenarios.filter((s) => s.passed).length;
  const extendedPassed = extendedScenarios.filter((s) => s.passed).length;

  const allByScenario = new Map(Array.from(byScenario.entries()));
  const liveUrls = [...allByScenario.values()]
    .map((r) => r.urls?.canonical)
    .filter((u): u is string => !!u && !!u.startsWith('http'));

  const capabilityMatrix = [
    ...CANARY_SCENARIOS.map((s) => ({ scenario: s.id, capabilities: s.capabilities })),
    ...EXTENDED_CANARY_SCENARIOS.map((s) => ({ scenario: s.id, capabilities: s.capabilities })),
  ];

  const domainMatrix = EXTENDED_CANARY_SCENARIOS.map((s) => ({
    scenario: s.id,
    domains: s.domains,
  }));

  const verificationEvidence = [...allByScenario.entries()].map(([scenarioId, r]) => ({
    scenario: scenarioId,
    liveChecks: r.liveChecks?.length ?? 0,
    livePassed: r.liveChecks?.filter((c) => c.ok).length ?? 0,
    browserChecks: r.browserUiChecks?.length ?? 0,
    browserPassed: r.browserUiChecks?.filter((c) => c.ok).length ?? 0,
    dbChecks: r.dbTableChecks?.length ?? 0,
    dbPassed: r.dbTableChecks?.filter((c) => c.ok).length ?? 0,
  }));

  const failureClassesCounts: Record<string, number> = {};
  for (const r of allByScenario.values()) {
    if (scenarioPassed(r)) continue;
    const cls = r.failureClass ?? 'unclassified';
    failureClassesCounts[cls] = (failureClassesCounts[cls] ?? 0) + 1;
  }

  const unresolvedGaps: string[] = [];
  for (const s of coreScenarios) {
    if (!s.passed) unresolvedGaps.push(`core: ${s.id} — ${s.reason}`);
  }
  for (const s of extendedScenarios) {
    if (!s.passed) unresolvedGaps.push(`extended: ${s.id} (${s.domains.join(',')}) — ${s.reason}`);
  }

  const label = classifyConfidence(corePassed, coreScenarios.length, extendedPassed, extendedScenarios.length);

  return {
    generatedAt: new Date().toISOString(),
    runDir,
    coreTotal: coreScenarios.length,
    corePassed,
    extendedTotal: extendedScenarios.length,
    extendedPassed,
    coreScenarios,
    extendedScenarios,
    liveUrls,
    capabilityMatrix,
    domainMatrix,
    verificationEvidence,
    failureClassesCounts,
    unresolvedGaps,
    confidenceLabel: label,
    confidenceSummary: confidenceSummary(label, corePassed, coreScenarios.length, extendedPassed, extendedScenarios.length),
  };
}

export function formatConfidenceMarkdown(report: ConfidenceReport): string {
  const lines: string[] = [];
  lines.push(`# Engineering World-Class Canary — Confidence Report`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Run directory: \`${report.runDir}\``);
  lines.push('');
  lines.push(`## Verdict — ${report.confidenceLabel}`);
  lines.push('');
  lines.push(`> ${report.confidenceSummary}`);
  lines.push('');
  lines.push(`## Core scenarios (7 required) — ${report.corePassed}/${report.coreTotal}`);
  lines.push('');
  lines.push('| Scenario | Passed | Reason | Live URL |');
  lines.push('|---|---|---|---|');
  for (const s of report.coreScenarios) {
    lines.push(`| ${s.id} | ${s.passed ? 'yes' : 'NO'} | ${s.reason.replace(/\|/g, '/')} | ${s.liveUrl ?? '—'} |`);
  }
  lines.push('');
  lines.push(`## Extended scenarios (12 required for world-class) — ${report.extendedPassed}/${report.extendedTotal}`);
  lines.push('');
  lines.push('| Scenario | Domains | Passed | Reason | Live URL |');
  lines.push('|---|---|---|---|---|');
  for (const s of report.extendedScenarios) {
    lines.push(`| ${s.id} | ${s.domains.join(', ')} | ${s.passed ? 'yes' : 'NO'} | ${s.reason.replace(/\|/g, '/')} | ${s.liveUrl ?? '—'} |`);
  }
  lines.push('');
  lines.push(`## Failure classes`);
  lines.push('');
  if (Object.keys(report.failureClassesCounts).length === 0) {
    lines.push('No failures recorded.');
  } else {
    for (const [cls, count] of Object.entries(report.failureClassesCounts)) {
      lines.push(`- ${cls}: ${count}`);
    }
  }
  lines.push('');
  lines.push(`## Unresolved gaps`);
  lines.push('');
  if (report.unresolvedGaps.length === 0) {
    lines.push('None.');
  } else {
    for (const g of report.unresolvedGaps) lines.push(`- ${g}`);
  }
  lines.push('');
  lines.push(`## Confidence rule lookup`);
  lines.push('');
  lines.push('| State | Label |');
  lines.push('|---|---|');
  lines.push('| <7/7 core | incomplete |');
  lines.push('| 7/7 core | 95-percent-core |');
  lines.push('| 7/7 core + 10/12 extended | broad-fullstack |');
  lines.push('| 7/7 core + 12/12 extended | world-class |');
  return lines.join('\n');
}

export function writeConfidenceReport(runDir: string, outDir?: string): { jsonPath: string; markdownPath: string; report: ConfidenceReport } {
  const report = generateConfidenceReport(runDir);
  const targetDir = outDir ?? path.join(runDir, 'confidence');
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  const jsonPath = path.join(targetDir, 'confidence-report.json');
  const markdownPath = path.join(targetDir, 'confidence-report.md');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(markdownPath, formatConfidenceMarkdown(report));
  return { jsonPath, markdownPath, report };
}

// ── CLI ─────────────────────────────────────────────────────────────

if (typeof process !== 'undefined' && Array.isArray(process.argv) && process.argv[1]?.endsWith('canary-confidence-report.ts')) {
  const argv = process.argv.slice(2);
  const runDirIndex = argv.indexOf('--run-dir');
  if (runDirIndex < 0 || !argv[runDirIndex + 1]) {
    process.stderr.write('Usage: canary-confidence-report --run-dir <path>\n');
    process.exit(2);
  }
  const runDir = argv[runDirIndex + 1];
  const result = writeConfidenceReport(runDir);
  process.stdout.write(`Confidence report written:\n  ${result.jsonPath}\n  ${result.markdownPath}\n`);
  process.stdout.write(`${result.report.confidenceSummary}\n`);
  process.exit(result.report.confidenceLabel === 'world-class' ? 0 : (result.report.corePassed < result.report.coreTotal ? 1 : 0));
}
