'use client';

import { useState, useEffect, useRef, Suspense, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { OnboardingJourney } from '@/types';
import { ONBOARDING_STAGE_LABELS } from '@/lib/founder-labels';
import { OnboardingLogStrip } from '@/components/onboarding/OnboardingLogStrip';

type Step = 'level1' | 'level2' | 'idea_input' | 'url_input' | 'creating';

interface StageUpdate {
  type: 'stage' | 'activity' | 'mood' | 'transformation' | 'completed' | 'failed' | 'ping' | 'timeout';
  stage?: string;
  status?: 'running' | 'done' | 'error' | 'skipped';
  label?: string;
  company_name?: string;
  error?: string;
  text?: string;
  tool?: string | null;
  timestamp?: number;
  mood?: string;
  original?: string;
  refined?: string;
  changes_made?: string | null;
}

export interface ActivityLine {
  id: number;
  text: string;
  tool: string | null;
  stage: string | null;
  timestamp: number;
}

const STAGE_ORDER_BY_JOURNEY: Record<OnboardingJourney, string[]> = {
  build_my_idea: [
    'heartbeat',
    'refine_idea',
    'name_company',
    'generate_market_research',
    'provision_infrastructure',
    'send_startup_email',
    'post_launch_tweet',
    'generate_landing_page',
    'save_mission',
    'create_starter_tasks',
    'send_inbox_message',
    'generate_magic_link',
    'send_completion_email',
    'celebrate',
  ],
  grow_my_company: [
    'heartbeat',
    'fetch_business_url',
    'name_company',
    'generate_market_research',
    'provision_infrastructure',
    'send_startup_email',
    'post_launch_tweet',
    'generate_landing_page',
    'save_mission',
    'create_starter_tasks',
    'send_inbox_message',
    'generate_magic_link',
    'send_completion_email',
    'celebrate',
  ],
  surprise_me: [
    'heartbeat',
    'enrich_geo',
    'extract_founder_angle',
    'persist_context',
    'invent_idea',
    'refine_idea',
    'name_company',
    'generate_market_research',
    'provision_infrastructure',
    'send_startup_email',
    'post_launch_tweet',
    'generate_landing_page',
    'save_mission',
    'create_starter_tasks',
    'send_inbox_message',
    'generate_magic_link',
    'send_completion_email',
    'celebrate',
  ],
};

const GROW_STAGE_LABELS: Record<string, string> = {
  fetch_business_url: 'Reading your company website',
  name_company: 'Confirming your company name',
  generate_market_research: 'Analyzing your growth market',
  generate_landing_page: 'Creating your growth page',
  save_mission: 'Sharpening your company mission',
  create_starter_tasks: 'Creating growth tasks',
};

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      </div>
    }>
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
  const [currentJourney, setCurrentJourney] = useState<OnboardingJourney>('surprise_me');
  const [stages, setStages] = useState<Record<string, 'running' | 'done' | 'error' | 'skipped'>>({});
  const [currentStageLabel, setCurrentStageLabel] = useState('Starting up...');
  const [activityLines, setActivityLines] = useState<ActivityLine[]>([]);
  const [mood, setMood] = useState<string>('listening');
  const [logDone, setLogDone] = useState(false);
  const activityIdRef = useRef(0);
  const [transformation, setTransformation] = useState<{
    original: string; refined: string; changes_made: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const dashboardRedirected = useRef(false);
  const resumeTriggered = useRef(false);
  const visibleStages = useMemo(
    () => STAGE_ORDER_BY_JOURNEY[currentJourney] ?? STAGE_ORDER_BY_JOURNEY.surprise_me,
    [currentJourney],
  );
  const labelForStage = useCallback((stage: string) => {
    if (currentJourney === 'grow_my_company' && GROW_STAGE_LABELS[stage]) {
      return GROW_STAGE_LABELS[stage];
    }
    return ONBOARDING_STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ');
  }, [currentJourney]);

  const handoffToDashboard = useCallback((id: string) => {
    if (dashboardRedirected.current) return;
    dashboardRedirected.current = true;
    eventSourceRef.current?.close();
    router.push(`/dashboard/${id}`);
  }, [router]);

  useEffect(() => {
    if (!resumeCompanyId || resumeTriggered.current) return;
    resumeTriggered.current = true;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ journey: 'surprise_me', timezone }),
    }).then(async (res) => {
      if (!res.ok) {
        const data = await res.json();
        if (res.status === 409 && data.company_id) { router.push(`/dashboard/${data.company_id}`); return; }
        throw new Error(data.error ?? 'Failed to resume setup');
      }
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to resume setup');
      setStep('level1');
    });
  }, [resumeCompanyId, router]);

  useEffect(() => {
    if (!companyId) return;
    const es = new EventSource(`/api/onboarding/status?company_id=${companyId}`);
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      const update: StageUpdate = JSON.parse(e.data);
      if (update.type === 'ping') return;
      if (update.type === 'stage' && update.stage) {
        setStages(prev => ({ ...prev, [update.stage!]: update.status ?? 'running' }));
        if (update.status === 'running') setCurrentStageLabel(labelForStage(update.stage));
        if (update.stage === 'create_starter_tasks' && update.status === 'done') {
          setLogDone(true);
          setTimeout(() => handoffToDashboard(companyId), 700);
        }
      }
      if (update.type === 'activity' && update.text) {
        setActivityLines(prev => [...prev, { id: ++activityIdRef.current, text: update.text!, tool: update.tool ?? null, stage: update.stage ?? null, timestamp: update.timestamp ?? Date.now() }]);
      }
      if (update.type === 'mood' && update.mood) setMood(update.mood);
      if (update.type === 'transformation' && update.original && update.refined) {
        setTransformation({ original: update.original, refined: update.refined, changes_made: update.changes_made ?? null });
      }
      if (update.type === 'completed') { setLogDone(true); es.close(); setTimeout(() => handoffToDashboard(companyId), 700); }
      if (update.type === 'failed') { setLogDone(true); es.close(); setError(update.error ?? 'Setup failed.'); setStep('level1'); }
      if (update.type === 'timeout') { setLogDone(true); es.close(); handoffToDashboard(companyId); }
    };
    es.onerror = () => { es.close(); setError('Connection lost during setup.'); setStep('level1'); };
    return () => es.close();
  }, [companyId, handoffToDashboard, labelForStage]);

  useEffect(() => {
    if (!companyId || step !== 'creating') return;
    const timer = window.setTimeout(() => handoffToDashboard(companyId), 20_000);
    return () => window.clearTimeout(timer);
  }, [companyId, step, handoffToDashboard]);

  async function startOnboarding(journey: OnboardingJourney, input?: string) {
    setCurrentJourney(journey);
    setStages({});
    setActivityLines([]);
    setTransformation(null);
    setLogDone(false);
    setCurrentStageLabel('Starting up...');
    activityIdRef.current = 0;
    dashboardRedirected.current = false;
    setStep('creating'); setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const payload = { journey, timezone, ...(journey === 'build_my_idea' ? { idea: input } : {}), ...(journey === 'grow_my_company' ? { business_url: input } : {}) };
      const res = await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.status === 401 && prefillEmail) {
        const qsRes = await fetch('/api/quick-start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, email: prefillEmail }) });
        if (!qsRes.ok) { const data = await qsRes.json(); throw new Error(data.error ?? 'Failed'); }
        const data = await qsRes.json(); router.push(data.redirect); return;
      }
      if (!res.ok) {
        const data = await res.json();
        if (res.status === 409 && data.company_id) { router.push(`/dashboard/${data.company_id}`); return; }
        if (res.status === 401) { router.push('/login?redirect=/onboarding'); return; }
        throw new Error(data.error ?? 'Failed');
      }
      const { company_id } = await res.json(); setCompanyId(company_id);
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong'); setStep('level1'); }
  }

  const doneCount = visibleStages.filter(s => stages[s] === 'done').length;
  const progress = Math.round((doneCount / visibleStages.length) * 100);

  // ─── STYLES ───
  const pageStyle: React.CSSProperties = {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 24, background: 'var(--bg)', color: 'var(--text)',
    fontFamily: "'Inter', system-ui, sans-serif",
    transition: 'background .45s, color .45s',
  };
  const containerStyle: React.CSSProperties = { width: '100%', maxWidth: 520 };
  const logoWrapStyle: React.CSSProperties = { textAlign: 'center' as const, marginBottom: 32 };
  const logoMarkStyle: React.CSSProperties = {
    width: 118,
    height: 104,
    margin: '0 auto 18px',
    display: 'grid',
    placeItems: 'center',
    animation: 'bob 3s ease-in-out infinite alternate',
  };
  const mascotStyle: React.CSSProperties = {
    width: 94, height: 94, objectFit: 'contain' as const,
    display: 'block',
    filter: 'drop-shadow(0 18px 34px rgba(217,119,6,0.22)) drop-shadow(0 0 22px rgba(252,211,77,0.16)) brightness(1.08) saturate(1.2)',
  };
  const titleStyle: React.CSSProperties = {
    fontFamily: "'Newsreader', Georgia, serif", fontSize: 34, fontWeight: 500,
    letterSpacing: '-.7px', marginBottom: 5, color: 'var(--ink)',
  };
  const subtitleStyle: React.CSSProperties = {
    fontFamily: "'Newsreader', Georgia, serif", fontSize: 14, fontStyle: 'italic',
    color: '#D97706',
  };
  const headingStyle: React.CSSProperties = {
    fontSize: 20, fontWeight: 600, textAlign: 'center' as const, marginBottom: 20,
    color: 'var(--ink)',
  };
  const cardBtnStyle: React.CSSProperties = {
    width: '100%', padding: '22px 24px', borderRadius: 14,
    border: '1px solid var(--line)', background: 'var(--bg-card)',
    textAlign: 'left' as const, cursor: 'pointer',
    transition: 'all .25s', boxShadow: '0 1px 2px rgba(24,18,10,0.04)',
  };
  const cardTitleStyle: React.CSSProperties = {
    fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 4,
  };
  const cardDescStyle: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)' };
  const primaryBtnStyle = (enabled: boolean): React.CSSProperties => ({
    width: '100%', padding: 14, borderRadius: 12, border: 'none',
    background: enabled ? 'linear-gradient(135deg, #E1B12C, #D97706)' : 'var(--bg-muted)',
    color: enabled ? '#fff' : 'var(--text-dim)', fontWeight: 700, fontSize: 15,
    cursor: enabled ? 'pointer' : 'not-allowed',
    boxShadow: enabled ? '0 6px 18px rgba(217,119,6,0.28), inset 0 1px 0 rgba(255,255,255,0.3)' : 'none',
    transition: 'all .25s',
  });
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: 14, borderRadius: 12,
    border: '1px solid var(--line)', background: 'var(--bg-card)',
    color: 'var(--text)', fontFamily: 'inherit', fontSize: 14,
    outline: 'none', resize: 'vertical' as const, minHeight: 120,
  };
  const backBtnStyle: React.CSSProperties = {
    background: 'transparent', border: 'none', padding: '4px 0',
    fontSize: 13, color: 'var(--text-dim)', cursor: 'pointer', marginBottom: 12,
  };
  const errorStyle: React.CSSProperties = {
    marginBottom: 20, padding: 12, borderRadius: 10,
    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
    color: '#DC2626', fontSize: 13,
  };
  const progressBarBg: React.CSSProperties = {
    width: '100%', height: 4, background: 'var(--bg-alt)', borderRadius: 2, marginBottom: 16,
  };
  const progressBarFill = (pct: number): React.CSSProperties => ({
    width: `${Math.max(pct, 4)}%`, height: 4,
    background: 'linear-gradient(90deg, #E1B12C, #FCD34D)',
    borderRadius: 2, transition: 'width .5s',
  });
  const stageLabelStyle: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
    color: '#D97706', marginBottom: 20, minHeight: 16, textAlign: 'center' as const,
  };
  const stageListStyle: React.CSSProperties = {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 12, padding: 16, textAlign: 'left' as const,
    boxShadow: '0 1px 2px rgba(24,18,10,0.04)',
  };
  const stageRowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: '3px 0',
  };
  const transformBannerStyle: React.CSSProperties = {
    marginBottom: 20, padding: 16, borderRadius: 14, textAlign: 'left' as const,
    background: 'var(--gold-bg)', border: '1px solid var(--gold-border)',
  };

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        {/* Logo */}
        <div style={logoWrapStyle}>
          <div style={logoMarkStyle}>
            <img src="/mascot.png" alt="Baljia" style={mascotStyle} />
          </div>
          <h1 style={titleStyle}>
            <span style={{ color: '#A35F05' }}>Baljia</span>
          </h1>
          <p style={subtitleStyle}>Your AI Angel</p>
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        {/* Step: Level 1 */}
        {step === 'level1' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <h2 style={headingStyle}>What are we starting with?</h2>
            <button
              style={cardBtnStyle}
              onClick={() => setStep('level2')}
              onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = '#D97706'; (e.target as HTMLElement).style.transform = 'translateY(-2px)'; (e.target as HTMLElement).style.boxShadow = 'var(--shadow-md)'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = 'var(--line)'; (e.target as HTMLElement).style.transform = 'none'; (e.target as HTMLElement).style.boxShadow = '0 1px 2px rgba(24,18,10,0.04)'; }}
            >
              <div style={cardTitleStyle}>Start a new company</div>
              <div style={cardDescStyle}>We&apos;ll come up with the idea, build it, and run it for you.</div>
            </button>
            <button
              style={cardBtnStyle}
              onClick={() => setStep('url_input')}
              onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = '#D97706'; (e.target as HTMLElement).style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = 'var(--line)'; (e.target as HTMLElement).style.transform = 'none'; }}
            >
              <div style={cardTitleStyle}>I already have a business</div>
              <div style={cardDescStyle}>Share your website and we&apos;ll handle growth, marketing, and operations.</div>
            </button>
          </div>
        )}

        {/* Step: Level 2 */}
        {step === 'level2' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <button style={backBtnStyle} onClick={() => setStep('level1')}>← Back</button>
            <h2 style={headingStyle}>Do you have an idea?</h2>
            <button style={cardBtnStyle} onClick={() => startOnboarding('surprise_me')}
              onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = '#D97706'; (e.target as HTMLElement).style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = 'var(--line)'; (e.target as HTMLElement).style.transform = 'none'; }}
            >
              <div style={cardTitleStyle}>No, suggest one for me</div>
              <div style={cardDescStyle}>We&apos;ll look at your background and pick an idea that fits you.</div>
            </button>
            <button style={cardBtnStyle} onClick={() => setStep('idea_input')}
              onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = '#D97706'; (e.target as HTMLElement).style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = 'var(--line)'; (e.target as HTMLElement).style.transform = 'none'; }}
            >
              <div style={cardTitleStyle}>Yes, I have one</div>
              <div style={cardDescStyle}>Tell us the idea and we&apos;ll turn it into a working company.</div>
            </button>
          </div>
        )}

        {/* Step: Idea Input */}
        {step === 'idea_input' && (
          <div style={{ display: 'grid', gap: 14 }}>
            <button style={backBtnStyle} onClick={() => setStep('level2')}>← Back</button>
            <h2 style={headingStyle}>What&apos;s your idea?</h2>
            <textarea style={inputStyle} value={idea} onChange={e => setIdea(e.target.value)}
              placeholder="e.g. A social media agency for small restaurants"
              onFocus={e => { e.target.style.borderColor = '#D97706'; e.target.style.boxShadow = '0 0 0 3px rgba(225,177,44,0.14)'; }}
              onBlur={e => { e.target.style.borderColor = 'var(--line)'; e.target.style.boxShadow = 'none'; }}
            />
            <button style={primaryBtnStyle(!!idea.trim())} disabled={!idea.trim()}
              onClick={() => startOnboarding('build_my_idea', idea)}>
              Start building →
            </button>
          </div>
        )}

        {/* Step: URL Input */}
        {step === 'url_input' && (
          <div style={{ display: 'grid', gap: 14 }}>
            <button style={backBtnStyle} onClick={() => setStep('level1')}>← Back</button>
            <h2 style={headingStyle}>What&apos;s your company&apos;s website?</h2>
            <input type="url" style={{ ...inputStyle, minHeight: 'auto' }} value={businessUrl}
              onChange={e => setBusinessUrl(e.target.value)} placeholder="yourcompany.com"
              onFocus={e => { e.target.style.borderColor = '#D97706'; e.target.style.boxShadow = '0 0 0 3px rgba(225,177,44,0.14)'; }}
              onBlur={e => { e.target.style.borderColor = 'var(--line)'; e.target.style.boxShadow = 'none'; }}
            />
            <button style={primaryBtnStyle(!!businessUrl.trim())} disabled={!businessUrl.trim()}
              onClick={() => startOnboarding('grow_my_company', businessUrl)}>
              Get started →
            </button>
          </div>
        )}

        {/* Step: Creating */}
        {(step === 'creating') && (
          <div style={{ textAlign: 'center' as const }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 6, color: 'var(--ink)' }}>
              Your AI Angel is setting up your company
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
              We&apos;ll move you to the dashboard in about 20 seconds while setup keeps building in the background.
            </p>
            <div style={progressBarBg}><div style={progressBarFill(progress)}></div></div>
            <p style={stageLabelStyle}>{currentStageLabel}</p>

            {transformation && (
              <div style={transformBannerStyle}>
                <p style={{ fontSize: 10, color: '#D97706', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1.5, marginBottom: 8 }}>
                  ✦ We interpreted your idea as
                </p>
                <p style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600, marginBottom: 8 }}>
                  {transformation.refined}
                </p>
                {transformation.changes_made && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{transformation.changes_made}</p>
                )}
                <p style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  You typed: &quot;{transformation.original}&quot;
                </p>
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <OnboardingLogStrip lines={activityLines} mood={mood} currentStageLabel={currentStageLabel} done={logDone} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
