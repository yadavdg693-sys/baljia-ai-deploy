'use client';

// Platform Ops Monitor — Admin View
// Shows: failure fingerprints, guardrail events, task stats, company states
// Access: requires ADMIN_EMAILS env var — will 401/403 otherwise

import { useState, useEffect, useCallback } from 'react';

interface OpsHealth {
  generated_at: string;
  failure_summary: {
    total_fingerprints: number;
    total_occurrences: number;
    fixed: number;
    unfixed: number;
    by_category: Record<string, number>;
  };
  top_failures: Array<{
    id: string;
    category: string;
    description: string;
    occurrence_count: number;
    fix_status: string;
    regression_sensitive: boolean;
    last_seen_at: string;
  }>;
  recent_failures_24h: number;
  guardrail_events_24h: Array<{
    payload: Record<string, unknown>;
    created_at: string;
  }>;
  task_stats_7d: Array<{ status: string; count: number }>;
  company_execution_states: Array<{ execution_state: string; count: number }>;
  event_volume_24h: number;
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'text-status-success',
  verifying: 'text-baljia-gold',
  failed: 'text-status-error',
  failed_permanent: 'text-status-error',
  in_progress: 'text-status-info',
  todo: 'text-text-muted',
  repair: 'text-status-warning',
  blocked_pre_start: 'text-status-warning',
  blocked_in_run: 'text-status-warning',
  rejected: 'text-text-muted',
};

const FIX_BADGE: Record<string, string> = {
  open: 'bg-status-error/10 text-status-error border-status-error/30',
  investigating: 'bg-baljia-gold/10 text-baljia-gold border-baljia-gold/30',
  fixed: 'bg-status-success/10 text-status-success border-status-success/30',
  wont_fix: 'bg-surface-secondary text-text-muted border-border-subtle',
};

export default function OpsMonitorPage() {
  const [data, setData] = useState<OpsHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/health');
      if (res.status === 401 || res.status === 403) {
        setError('Admin access required. Set ADMIN_EMAILS and use a listed address.');
        return;
      }
      if (!res.ok) throw new Error('Failed to load ops data');
      const json = await res.json() as OpsHealth;
      setData(json);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
    // Auto-refresh every 60 seconds
    const interval = setInterval(() => { void fetchHealth(); }, 60_000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  return (
    <div className="min-h-screen bg-surface-primary p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary font-display">Platform Ops</h1>
          <p className="text-sm text-text-muted mt-0.5">Internal health monitoring · Admin only</p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-text-muted">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => { setLoading(true); void fetchHealth(); }}
            className="px-4 py-2 rounded-lg bg-surface-card border border-border-default text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-status-error/10 border border-status-error/30 p-4 text-sm text-status-error">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="text-center py-20 text-text-muted text-sm">Loading platform data…</div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Fingerprints', value: data.failure_summary.total_fingerprints, sub: `${data.failure_summary.unfixed} open` },
              { label: 'Occurrences (All)', value: data.failure_summary.total_occurrences, sub: `${data.failure_summary.fixed} fixed` },
              { label: 'Failures (24h)', value: data.recent_failures_24h, sub: 'new fingerprint hits' },
              { label: 'Events (24h)', value: data.event_volume_24h, sub: 'platform events' },
            ].map((card) => (
              <div key={card.label} className="rounded-xl bg-surface-card border border-border-default p-4">
                <p className="text-xs text-text-muted uppercase tracking-wider">{card.label}</p>
                <p className="text-3xl font-bold text-text-primary mt-1">{card.value}</p>
                <p className="text-xs text-text-secondary mt-1">{card.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Top Failure Fingerprints */}
            <div className="rounded-xl bg-surface-card border border-border-default p-5 space-y-3">
              <h2 className="text-sm font-semibold text-text-primary">Top Failure Fingerprints</h2>
              {data.top_failures.length === 0 ? (
                <p className="text-xs text-text-muted">No fingerprints yet.</p>
              ) : data.top_failures.map((fp) => (
                <div key={fp.id} className="border border-border-subtle rounded-lg p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono uppercase ${FIX_BADGE[fp.fix_status] ?? FIX_BADGE.open}`}>
                      {fp.fix_status}
                    </span>
                    {fp.regression_sensitive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-status-warning/10 text-status-warning border-status-warning/30">
                        regression risk
                      </span>
                    )}
                    <span className="ml-auto text-xs text-text-muted">{fp.occurrence_count}×</span>
                  </div>
                  <p className="text-xs font-semibold text-text-secondary capitalize">{fp.category}</p>
                  <p className="text-xs text-text-muted font-mono truncate">{fp.description}</p>
                </div>
              ))}
            </div>

            {/* Task stats + Company states */}
            <div className="space-y-4">
              <div className="rounded-xl bg-surface-card border border-border-default p-5 space-y-2">
                <h2 className="text-sm font-semibold text-text-primary">Task Status (7 days)</h2>
                {data.task_stats_7d.map((s) => (
                  <div key={s.status} className="flex justify-between items-center text-xs">
                    <span className={`capitalize ${STATUS_COLORS[s.status] ?? 'text-text-secondary'}`}>
                      {s.status.replaceAll('_', ' ')}
                    </span>
                    <span className="font-mono text-text-muted">{s.count}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-surface-card border border-border-default p-5 space-y-2">
                <h2 className="text-sm font-semibold text-text-primary">Company Execution States</h2>
                {data.company_execution_states.map((s) => (
                  <div key={s.execution_state} className="flex justify-between items-center text-xs">
                    <span className="capitalize text-text-secondary">{s.execution_state}</span>
                    <span className="font-mono text-text-muted">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Guardrail Events */}
          {data.guardrail_events_24h.length > 0 && (
            <div className="rounded-xl bg-surface-card border border-border-default p-5 space-y-3">
              <h2 className="text-sm font-semibold text-text-primary">Guardrail Events (24h)</h2>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {data.guardrail_events_24h.map((ev, i) => {
                  const isEscalation = (ev.payload as Record<string, unknown>).level !== undefined;
                  return (
                    <div key={i} className="flex gap-3 text-xs items-start">
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${isEscalation ? 'bg-status-error/10 text-status-error border-status-error/30' : 'bg-status-success/10 text-status-success border-status-success/30'}`}>
                        {isEscalation ? `${(ev.payload as any).level}` : 'cleared'}
                      </span>
                      <span className="text-text-muted">{(ev.payload as any).reason}</span>
                      <span className="ml-auto text-text-muted whitespace-nowrap">
                        {new Date(ev.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Failure by category */}
          {Object.keys(data.failure_summary.by_category).length > 0 && (
            <div className="rounded-xl bg-surface-card border border-border-default p-5 space-y-2">
              <h2 className="text-sm font-semibold text-text-primary">Failures by Category</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(data.failure_summary.by_category).map(([cat, count]) => (
                  <div key={cat} className="bg-surface-secondary rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-text-primary">{count}</p>
                    <p className="text-xs text-text-muted capitalize mt-0.5">{cat.replaceAll('_', ' ')}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
