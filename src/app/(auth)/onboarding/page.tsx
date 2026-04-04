'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { OnboardingJourney } from '@/types';

type Step = 'level1' | 'level2' | 'idea_input' | 'url_input' | 'creating';

interface StageUpdate {
  type: 'stage' | 'completed' | 'failed' | 'ping' | 'timeout';
  stage?: string;
  status?: 'running' | 'done' | 'error';
  label?: string;
  company_name?: string;
  error?: string;
}

const STAGE_ORDER = [
  'heartbeat',
  'enrich_founder',
  'enrich_business',
  'persist_context',
  'select_strategy',
  'name_company',
  'generate_market_research',
  'provision_infrastructure',
  'save_mission',
  'create_starter_tasks',
  'flush_diagnostics',
  'celebrate',
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('level1');
  const [idea, setIdea] = useState('');
  const [businessUrl, setBusinessUrl] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [stages, setStages] = useState<Record<string, 'running' | 'done' | 'error'>>({});
  const [currentStageLabel, setCurrentStageLabel] = useState('Starting up...');
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Start SSE stream once we have a company_id
  useEffect(() => {
    if (!companyId) return;

    const es = new EventSource(`/api/onboarding/status?company_id=${companyId}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const update: StageUpdate = JSON.parse(e.data);

      if (update.type === 'ping') return;

      if (update.type === 'stage' && update.stage) {
        setStages(prev => ({ ...prev, [update.stage!]: update.status ?? 'running' }));
        if (update.status === 'running' && update.label) {
          setCurrentStageLabel(update.label);
        }
      }

      if (update.type === 'completed') {
        es.close();
        // Short delay so user sees the final "Ready!" state
        setTimeout(() => router.push(`/dashboard/${companyId}`), 1200);
      }

      if (update.type === 'failed') {
        es.close();
        setError(update.error ?? 'Setup failed. Please try again.');
        setStep('level1');
      }

      if (update.type === 'timeout') {
        es.close();
        // Still navigate — company was created, pipeline may still be running
        router.push(`/dashboard/${companyId}`);
      }
    };

    es.onerror = () => {
      // SSE error — still navigate if we have a company
      es.close();
      if (companyId) router.push(`/dashboard/${companyId}`);
    };

    return () => es.close();
  }, [companyId, router]);

  async function startOnboarding(journey: OnboardingJourney, input?: string) {
    setStep('creating');
    setError(null);

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ journey, idea: input, business_url: input }),
      });

      if (!res.ok) {
        const data = await res.json();
        // Already has a company — redirect to it
        if (res.status === 409 && data.company_id) {
          router.push(`/dashboard/${data.company_id}`);
          return;
        }
        throw new Error(data.error ?? 'Failed to start setup');
      }

      const { company_id } = await res.json();
      setCompanyId(company_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStep('level1');
    }
  }

  // Progress bar: count done stages / total
  const doneCount = Object.values(stages).filter(s => s === 'done').length;
  const progress = Math.round((doneCount / STAGE_ORDER.length) * 100);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-primary p-6">
      <div className="w-full max-w-lg">

        {/* Logo */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold font-[family-name:var(--font-display)] text-baljia-gold mb-2">
            Baljia
          </h1>
          <p className="text-text-secondary text-sm">Your AI Angel</p>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 p-3 rounded-lg bg-status-error/10 border border-status-error/30 text-status-error text-sm">
            {error}
          </div>
        )}

        {/* Step: Level 1 — Create vs Grow */}
        {step === 'level1' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-center mb-8 text-text-primary">
              What would you like to do?
            </h2>

            <button
              onClick={() => setStep('level2')}
              className={cn(
                'w-full p-6 rounded-xl border border-border-default bg-surface-card',
                'hover:border-baljia-gold hover:bg-surface-hover transition-all duration-200',
                'text-left group'
              )}
            >
              <div className="text-lg font-semibold text-text-primary group-hover:text-baljia-gold transition-colors">
                Create a new company
              </div>
              <div className="text-sm text-text-muted mt-1">
                Start from scratch — we&apos;ll build everything for you
              </div>
            </button>

            <button
              onClick={() => setStep('url_input')}
              className={cn(
                'w-full p-6 rounded-xl border border-border-default bg-surface-card',
                'hover:border-baljia-gold hover:bg-surface-hover transition-all duration-200',
                'text-left group'
              )}
            >
              <div className="text-lg font-semibold text-text-primary group-hover:text-baljia-gold transition-colors">
                Grow my company
              </div>
              <div className="text-sm text-text-muted mt-1">
                I already have a business — help me scale it
              </div>
            </button>
          </div>
        )}

        {/* Step: Level 2 — Surprise Me vs Build My Idea */}
        {step === 'level2' && (
          <div className="space-y-4">
            <button
              onClick={() => setStep('level1')}
              className="text-sm text-text-muted hover:text-text-secondary mb-4 block"
            >
              ← Back
            </button>

            <h2 className="text-xl font-semibold text-center mb-8 text-text-primary">
              How should we start?
            </h2>

            <button
              onClick={() => startOnboarding('surprise_me')}
              className={cn(
                'w-full p-6 rounded-xl border border-border-default bg-surface-card',
                'hover:border-baljia-gold hover:bg-surface-hover transition-all duration-200',
                'text-left group'
              )}
            >
              <div className="text-lg font-semibold text-text-primary group-hover:text-baljia-gold transition-colors">
                ✨ Surprise me
              </div>
              <div className="text-sm text-text-muted mt-1">
                We&apos;ll research you and find an idea that makes sense for you
              </div>
            </button>

            <button
              onClick={() => setStep('idea_input')}
              className={cn(
                'w-full p-6 rounded-xl border border-border-default bg-surface-card',
                'hover:border-baljia-gold hover:bg-surface-hover transition-all duration-200',
                'text-left group'
              )}
            >
              <div className="text-lg font-semibold text-text-primary group-hover:text-baljia-gold transition-colors">
                💡 Build my idea
              </div>
              <div className="text-sm text-text-muted mt-1">
                I have an idea — let&apos;s bring it to life
              </div>
            </button>
          </div>
        )}

        {/* Step: Idea Input */}
        {step === 'idea_input' && (
          <div className="space-y-4">
            <button
              onClick={() => setStep('level2')}
              className="text-sm text-text-muted hover:text-text-secondary mb-4 block"
            >
              ← Back
            </button>

            <h2 className="text-xl font-semibold text-center mb-6 text-text-primary">
              What&apos;s your idea?
            </h2>

            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Describe your business idea in a few sentences..."
              className={cn(
                'w-full p-4 rounded-xl border border-border-default bg-surface-card',
                'text-text-primary placeholder:text-text-muted',
                'focus:border-baljia-gold focus:outline-none focus:ring-1 focus:ring-baljia-gold/50',
                'resize-none h-32'
              )}
            />

            <button
              onClick={() => startOnboarding('build_my_idea', idea)}
              disabled={!idea.trim()}
              className={cn(
                'w-full p-4 rounded-xl font-semibold transition-all duration-200',
                idea.trim()
                  ? 'bg-baljia-gold text-surface-primary hover:bg-baljia-gold-light'
                  : 'bg-surface-tertiary text-text-muted cursor-not-allowed'
              )}
            >
              Get started →
            </button>
          </div>
        )}

        {/* Step: URL Input (Grow My Company) */}
        {step === 'url_input' && (
          <div className="space-y-4">
            <button
              onClick={() => setStep('level1')}
              className="text-sm text-text-muted hover:text-text-secondary mb-4 block"
            >
              ← Back
            </button>

            <h2 className="text-xl font-semibold text-center mb-6 text-text-primary">
              What&apos;s your company&apos;s website?
            </h2>

            <input
              type="url"
              value={businessUrl}
              onChange={(e) => setBusinessUrl(e.target.value)}
              placeholder="https://yourcompany.com"
              className={cn(
                'w-full p-4 rounded-xl border border-border-default bg-surface-card',
                'text-text-primary placeholder:text-text-muted',
                'focus:border-baljia-gold focus:outline-none focus:ring-1 focus:ring-baljia-gold/50'
              )}
            />

            <button
              onClick={() => startOnboarding('grow_my_company', businessUrl)}
              disabled={!businessUrl.trim()}
              className={cn(
                'w-full p-4 rounded-xl font-semibold transition-all duration-200',
                businessUrl.trim()
                  ? 'bg-baljia-gold text-surface-primary hover:bg-baljia-gold-light'
                  : 'bg-surface-tertiary text-text-muted cursor-not-allowed'
              )}
            >
              Get started →
            </button>
          </div>
        )}

        {/* Step: Creating — live pipeline progress */}
        {step === 'creating' && (
          <div className="text-center py-8">
            <div className="text-6xl mb-6 animate-pulse">🪽</div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              Your AI Angel is setting up your company
            </h2>
            <p className="text-sm text-text-muted mb-8">
              This takes about 30–60 seconds
            </p>

            {/* Progress bar */}
            <div className="w-full bg-surface-secondary rounded-full h-1.5 mb-6">
              <div
                className="bg-baljia-gold h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(progress, 4)}%` }}
              />
            </div>

            {/* Current stage label */}
            <p className="text-sm text-baljia-gold font-mono mb-6 min-h-[1.25rem]">
              {currentStageLabel}
            </p>

            {/* Stage checklist */}
            <div className="p-4 rounded-lg bg-surface-secondary border border-border-subtle text-left space-y-1.5">
              {STAGE_ORDER.map((s) => {
                const status = stages[s];
                return (
                  <div key={s} className="flex items-center gap-2 font-mono text-xs">
                    <span className="w-4 text-center">
                      {status === 'done' ? (
                        <span className="text-status-success">✓</span>
                      ) : status === 'running' ? (
                        <span className="text-baljia-gold animate-pulse">▶</span>
                      ) : status === 'error' ? (
                        <span className="text-status-error">✗</span>
                      ) : (
                        <span className="text-border-default">·</span>
                      )}
                    </span>
                    <span className={cn(
                      status === 'done' ? 'text-text-secondary' :
                      status === 'running' ? 'text-text-primary' :
                      'text-text-muted'
                    )}>
                      {s.replace(/_/g, ' ')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
