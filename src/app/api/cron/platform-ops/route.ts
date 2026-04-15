// Cron: Platform Ops — unified platform health, regression guard, billing audit
// Runs every 15 minutes (infra checks). Billing audit runs daily (hour === 5 UTC).
// Auth: CRON_SECRET header
//
// SPEC-OPS-001: 9 hidden platform-side agents — 5 implemented as service functions here.

import { NextRequest, NextResponse } from 'next/server';
import { runInfraHealthCheck } from '@/lib/services/infra-watchdog.service';
import { detectRegressions, getKnownIssuesSummary } from '@/lib/services/failure.service';
import { auditCredits } from '@/lib/services/billing-audit.service';
import * as eventService from '@/lib/services/event.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('CronPlatformOps');

// Use a system company ID for platform-level events
const PLATFORM_COMPANY_ID = '00000000-0000-0000-0000-000000000000';

export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  // 1. Infra health check (every run)
  try {
    const healthReport = await runInfraHealthCheck();
    results.infra = { alerts: healthReport.alerts.length, report: healthReport };

    if (healthReport.alerts.length > 0) {
      await eventService.emit(PLATFORM_COMPANY_ID, 'infra_health_alert', {
        alerts: healthReport.alerts,
        checked_at: healthReport.checked_at,
      });
    }
  } catch (e) {
    log.error('Infra health check failed', { error: e instanceof Error ? e.message : 'unknown' });
    results.infra = { error: 'check failed' };
  }

  // 2. Regression guard (every run)
  try {
    const regressions = await detectRegressions();
    results.regressions = { count: regressions.length };

    if (regressions.length > 0) {
      log.warn('Regressions detected', { count: regressions.length, ids: regressions.map(r => r.id) });
    }
  } catch (e) {
    log.error('Regression check failed', { error: e instanceof Error ? e.message : 'unknown' });
    results.regressions = { error: 'check failed' };
  }

  // 3. Known issue summary (every run — lightweight)
  try {
    const summary = await getKnownIssuesSummary();
    results.known_issues = summary;
  } catch (e) {
    results.known_issues = { error: 'check failed' };
  }

  // 4. Billing audit (daily only — run at 5 UTC hour)
  const currentHour = new Date().getUTCHours();
  if (currentHour === 5) {
    try {
      const auditReport = await auditCredits();
      results.billing_audit = { anomalies: auditReport.total_anomalies };

      if (auditReport.total_anomalies > 0) {
        await eventService.emit(PLATFORM_COMPANY_ID, 'billing_audit_anomaly', {
          phantom: auditReport.phantom_charges.length,
          double: auditReport.double_charges.length,
          negative: auditReport.negative_balances.length,
          refunds: auditReport.missing_refunds.length,
          audited_at: auditReport.audited_at,
        });
      }
    } catch (e) {
      log.error('Billing audit failed', { error: e instanceof Error ? e.message : 'unknown' });
      results.billing_audit = { error: 'audit failed' };
    }
  } else {
    results.billing_audit = { skipped: 'runs at 05:00 UTC only' };
  }

  // 5. Emit summary event
  try {
    await eventService.emit(PLATFORM_COMPANY_ID, 'platform_ops_summary', results);
  } catch { /* non-blocking */ }

  log.info('Platform ops cron completed', results);

  return NextResponse.json({ ok: true, results });
}
