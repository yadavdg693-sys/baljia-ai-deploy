'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { OnboardingJourney } from '@/types';
import { ONBOARDING_STAGE_LABELS } from '@/lib/founder-labels';

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
  'extract_founder_angle',
  'select_strategy',
  'classify_archetype',
  'name_company',
  'provision_infrastructure',
  'generate_market_research',
  'save_mission',
  'generate_roadmap',
  'derive_active_milestone',
  'create_starter_tasks',
  'generate_landing_page',
  'send_welcome_email',
  'post_launch_tweet',
  'generate_ceo_summary',
  'flush_diagnostics',
  'celebrate',
];

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface-primary flex items-center justify-center"><p className="text-text-secondary">Loading...</p></div>}>
      <OnboardingPageInner />
    </Suspense>
  );
}

function OnboardingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillEmail = searchParams.get('email') ?? '';
  const resumeCompanyId = searchParams.get('resume');
  const [step, setStep] = useState<Step>(resumeCompanyId ? 'creating' : 'level1');
  const [idea, setIdea] = useState('');
  const [businessUrl, setBusinessUrl] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(resumeCompanyId);
  const [stages, setStages] = useState<Record<string, 'running' | 'done' | 'error'>>({});
  const [currentStageLabel, setCurrentStageLabel] = useState('Starting up...');
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const resumeTriggered = useRef(false);

  // Auto-resume pipeline for pending_auth companies (redirected from dashboard)
  useEffect(() => {
    if (!resumeCompanyId || resumeTriggered.current) return;
    resumeTriggered.current = true;

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // POST to /api/onboarding — the route detects pending_auth and resumes the pipeline.
    // Journey is read from company.onboarding_journey on the server side.
    fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ journey: 'surprise_me', timezone }),
    }).then(async (res) => {
      if (!res.ok) {
        const data = await res.json();
        // 409 = already has completed company — just go to dashboard
        if (res.status === 409 && data.company_id) {
          router.push(`/dashboard/${data.company_id}`);
          return;
        }
        throw new Error(data.error ?? 'Failed to resume setup');
      }
      // Pipeline started — SSE stream will pick up progress via companyId state
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to resume setup');
      setStep('level1');
    });
  }, [resumeCompanyId, router]);

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
        // Audit #14: Don't blindly navigate — show a recoverable message.
        // The company exists but setup may be incomplete.
        setError('Setup is taking longer than expected. You can wait or check your dashboard — some features may still be loading.');
        setStep('level1');
      }
    };

    es.onerror = () => {
      // Audit #14: SSE connection lost — don't blindly navigate to a half-ready dashboard.
      es.close();
      setError('Connection lost during setup. Your company was created — you can retry or check your dashboard.');
      setStep('level1');
    };

    return () => es.close();
  }, [companyId, router]);

  async function startOnboarding(journey: OnboardingJourney, input?: string) {
    setStep('creating');
    setError(null);

    try {
      // Capture browser timezone for enrichment
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Audit #15: Send only the field relevant to the chosen journey
      const payload = {
        journey,
        timezone,
        ...(journey === 'build_my_idea' ? { idea: input } : {}),
        ...(journey === 'grow_my_company' ? { business_url: input } : {}),
      };

      // Try authenticated endpoint first
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 401 && prefillEmail) {
        // Unauthenticated — use quick-start to create draft, then redirect to login
        const qsRes = await fetch('/api/quick-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, email: prefillEmail }),
        });

        if (!qsRes.ok) {
          const data = await qsRes.json();
          throw new Error(data.error ?? 'Failed to start setup');
        }

        const data = await qsRes.json();
        // Redirect to login with dashboard target — pipeline resumes after auth
        router.push(data.redirect);
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        // Already has a company — redirect to it
        if (res.status === 409 && data.company_id) {
          router.push(`/dashboard/${data.company_id}`);
          return;
        }
        // Unauthenticated without email — redirect to login
        if (res.status === 401) {
          router.push('/login?redirect=/onboarding');
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
              Let&apos;s get started.
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
              Let&apos;s build something.
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
              placeholder="e.g. A social media agency for small restaurants"
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
              Start building →
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
              placeholder="yourcompany.com"
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
                      {ONBOARDING_STAGE_LABELS[s] ?? s.replace(/_/g, ' ')}
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
