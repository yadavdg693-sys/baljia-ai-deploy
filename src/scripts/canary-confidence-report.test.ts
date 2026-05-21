import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  formatConfidenceMarkdown,
  generateConfidenceReport,
} from './canary-confidence-report';
import { EXTENDED_CANARY_SCENARIOS } from './canary-extended-scenarios';
import { CANARY_SCENARIOS } from './canary-render-engineering';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `canary-conf-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeReport(dir: string, scenarioId: string, ok: boolean, urls?: { canonical: string }): void {
  const file = path.join(dir, `${scenarioId}.json`);
  writeFileSync(file, JSON.stringify({
    ok,
    terminalState: ok ? 'PASS' : 'FAIL',
    scenarioId,
    runId: 'test-run',
    taskId: scenarioId,
    urls: urls ?? { canonical: `https://example-${scenarioId}.onrender.com` },
    liveChecks: [{ name: 'GET /', ok }],
    browserUiChecks: [{ name: 'surface', ok }],
    dbTableChecks: [{ name: 'rows present', ok }],
    failureSummary: ok ? null : 'simulated failure',
    failureClass: ok ? null : 'frontend pattern gap',
  }));
}

describe('confidence report: classification', () => {
  it('labels < 7/7 core as incomplete', () => {
    const dir = tmpDir();
    // Pass only 5 core scenarios — should be incomplete
    const coreIds = CANARY_SCENARIOS.map((s) => s.id);
    for (let i = 0; i < 5; i++) writeReport(dir, coreIds[i], true);
    for (let i = 5; i < 7; i++) writeReport(dir, coreIds[i], false);

    const report = generateConfidenceReport(dir);
    expect(report.confidenceLabel).toBe('incomplete');
    expect(report.corePassed).toBe(5);
    expect(report.coreTotal).toBe(7);
    rmSync(dir, { recursive: true, force: true });
  });

  it('labels 7/7 core + 0 extended as 95-percent-core', () => {
    const dir = tmpDir();
    for (const s of CANARY_SCENARIOS) writeReport(dir, s.id, true);
    const report = generateConfidenceReport(dir);
    expect(report.confidenceLabel).toBe('95-percent-core');
    expect(report.corePassed).toBe(7);
    expect(report.extendedPassed).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('labels 7/7 core + 10/12 extended as broad-fullstack', () => {
    const dir = tmpDir();
    for (const s of CANARY_SCENARIOS) writeReport(dir, s.id, true);
    for (let i = 0; i < 10; i++) writeReport(dir, EXTENDED_CANARY_SCENARIOS[i].id, true);
    for (let i = 10; i < 12; i++) writeReport(dir, EXTENDED_CANARY_SCENARIOS[i].id, false);
    const report = generateConfidenceReport(dir);
    expect(report.confidenceLabel).toBe('broad-fullstack');
    expect(report.extendedPassed).toBe(10);
    rmSync(dir, { recursive: true, force: true });
  });

  it('labels 7/7 core + 12/12 extended as world-class', () => {
    const dir = tmpDir();
    for (const s of CANARY_SCENARIOS) writeReport(dir, s.id, true);
    for (const s of EXTENDED_CANARY_SCENARIOS) writeReport(dir, s.id, true);
    const report = generateConfidenceReport(dir);
    expect(report.confidenceLabel).toBe('world-class');
    expect(report.corePassed).toBe(7);
    expect(report.extendedPassed).toBe(12);
    expect(report.liveUrls.length).toBe(19);
    rmSync(dir, { recursive: true, force: true });
  });

  it('emits per-failed-scenario gaps and failure-class counts', () => {
    const dir = tmpDir();
    for (const s of CANARY_SCENARIOS) writeReport(dir, s.id, true);
    // 9 extended pass, 3 fail
    for (let i = 0; i < 9; i++) writeReport(dir, EXTENDED_CANARY_SCENARIOS[i].id, true);
    for (let i = 9; i < 12; i++) writeReport(dir, EXTENDED_CANARY_SCENARIOS[i].id, false);
    const report = generateConfidenceReport(dir);
    expect(report.confidenceLabel).toBe('95-percent-core');
    expect(report.unresolvedGaps.length).toBe(3);
    expect(report.failureClassesCounts['frontend pattern gap']).toBe(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it('markdown formatter renders all sections', () => {
    const dir = tmpDir();
    for (const s of CANARY_SCENARIOS) writeReport(dir, s.id, true);
    for (const s of EXTENDED_CANARY_SCENARIOS) writeReport(dir, s.id, true);
    const report = generateConfidenceReport(dir);
    const md = formatConfidenceMarkdown(report);
    expect(md).toContain('# Engineering World-Class Canary');
    expect(md).toContain('## Verdict — world-class');
    expect(md).toContain('## Core scenarios (7 required) — 7/7');
    expect(md).toContain('## Extended scenarios (12 required for world-class) — 12/12');
    expect(md).toContain('## Confidence rule lookup');
    rmSync(dir, { recursive: true, force: true });
  });

  it('handles empty run dir gracefully', () => {
    const dir = tmpDir();
    const report = generateConfidenceReport(dir);
    expect(report.confidenceLabel).toBe('incomplete');
    expect(report.corePassed).toBe(0);
    expect(report.extendedPassed).toBe(0);
    expect(report.unresolvedGaps.length).toBe(7 + 12);
    rmSync(dir, { recursive: true, force: true });
  });

  it('non-existent run dir returns zero-state report', () => {
    const ghost = path.join(os.tmpdir(), `canary-conf-ghost-${randomUUID()}`);
    expect(existsSync(ghost)).toBe(false);
    const report = generateConfidenceReport(ghost);
    expect(report.confidenceLabel).toBe('incomplete');
  });
});
