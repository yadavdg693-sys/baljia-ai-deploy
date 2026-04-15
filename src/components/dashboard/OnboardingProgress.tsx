'use client';

import { useEffect, useState } from 'react';

interface OnboardingStep {
  key: string;
  label: string;
  description: string;
}

const STEPS: OnboardingStep[] = [
  { key: 'heartbeat',           label: 'Session started',         description: 'Founder connected' },
  { key: 'enrich_founder',      label: 'Founder enriched',        description: 'Background research done' },
  { key: 'extract_angle',       label: 'Angle extracted',         description: 'Unique positioning identified' },
  { key: 'enrich_business',     label: 'Business enriched',       description: 'Market context gathered' },
  { key: 'persist_context',     label: 'Context saved',           description: 'Memory layer written' },
  { key: 'strategy_selected',   label: 'Strategy selected',       description: 'Growth approach decided' },
  { key: 'company_named',       label: 'Company named',           description: 'Brand identity set' },
  { key: 'market_researched',   label: 'Market researched',       description: 'Opportunity mapped' },
  { key: 'infrastructure',      label: 'Infrastructure live',     description: 'Repo + deploy + DB ready' },
  { key: 'mission_saved',       label: 'Mission documented',      description: 'Documents written' },
  { key: 'starter_tasks',       label: 'Tasks created',           description: 'Initial work queue ready' },
  { key: 'completed',           label: 'Ready',                   description: 'Company launched 🚀' },
];

interface OnboardingProgressProps {
  companyId: string;
  /** Current onboarding_status from company row */
  status: 'initializing' | 'running' | 'completed' | 'failed';
}

export function OnboardingProgress({ companyId, status }: OnboardingProgressProps) {
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'completed') {
      setCompletedSteps(new Set(STEPS.map((s) => s.key)));
      setLoading(false);
      return;
    }

    // Poll events for onboarding_stage events
    async function fetchProgress() {
      try {
        const res = await fetch(`/api/companies/${companyId}/onboarding-progress`);
        if (!res.ok) return;
        const data = await res.json() as { completed_stages: string[]; current_stage: string | null };
        setCompletedSteps(new Set(data.completed_stages ?? []));
        setCurrentStep(data.current_stage ?? null);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    }

    fetchProgress();
    const interval = setInterval(fetchProgress, 3000);
    return () => clearInterval(interval);
  }, [companyId, status]);

  const completedCount = status === 'completed' ? STEPS.length : completedSteps.size;
  const pct = Math.round((completedCount / STEPS.length) * 100);

  if (loading) {
    return (
      <div className="rounded-xl bg-surface-card border border-border-default p-5 animate-pulse">
        <div className="h-4 bg-surface-secondary rounded w-2/3 mb-3" />
        <div className="h-2 bg-surface-secondary rounded" />
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-surface-card border border-border-default p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary">Onboarding Progress</h3>
        <span className="text-xs text-baljia-gold font-semibold">{pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-surface-secondary mb-4 overflow-hidden">
        <div
          className="h-full rounded-full bg-baljia-gold transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Step list */}
      <div className="space-y-2">
        {STEPS.map((step, i) => {
          const done = completedSteps.has(step.key) || status === 'completed';
          const active = currentStep === step.key && !done;
          const pending = !done && !active;

          return (
            <div key={step.key} className="flex items-start gap-2.5">
              {/* Icon */}
              <div className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[10px] ${
                done    ? 'bg-baljia-gold text-surface-primary' :
                active  ? 'bg-baljia-gold/20 border border-baljia-gold text-baljia-gold animate-pulse' :
                          'bg-surface-secondary border border-border-subtle text-text-muted'
              }`}>
                {done ? '✓' : active ? '⟳' : i + 1}
              </div>

              {/* Text */}
              <div className="min-w-0">
                <p className={`text-sm leading-none ${
                  done   ? 'text-text-primary' :
                  active ? 'text-baljia-gold font-medium' :
                           'text-text-muted'
                }`}>
                  {step.label}
                </p>
                {(done || active) && (
                  <p className="text-xs text-text-muted mt-0.5">{step.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Failed state */}
      {status === 'failed' && (
        <div className="mt-4 px-3 py-2.5 rounded-lg bg-status-error/10 border border-status-error/30 text-xs text-status-error">
          Onboarding encountered an issue. Your company may still be usable — check your tasks.
        </div>
      )}
    </div>
  );
}
