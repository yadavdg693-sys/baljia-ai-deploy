// DashboardShell — Polsia reference port (FIXED).
// FIXES APPLIED:
// 1. handleApprove/handleReject now call real API endpoints
// 2. DocumentSuggestionPanel wired in
// 3. Documents filter shows populated docs even if is_empty flag is stale
// 4. Email empty state has helpful CTA text
// 5. Auto-refresh every 30s

'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import type { Company, Task, Document, Report, User } from '@/types';
import { TaskDetailDialog } from './TaskDetailDialog';
import { DocumentDialog } from './DocumentDialog';
import { PurchaseCreditsDialog } from './PurchaseCreditsDialog';
import { UpgradeDialog } from './UpgradeDialog';
import { DashboardMenu } from './DashboardMenu';
import { LiveBanner } from './LiveBanner';
import { CelebrationOverlay } from './CelebrationOverlay';
import { StatusAvatar } from './StatusAvatar';
import { DocumentSuggestionPanel } from './DocumentSuggestionPanel';
import { FounderChatRail } from '@/components/chat/FounderChatRail';

interface DocumentSuggestion {
  id: string;
  document_id: string;
  suggested_content: string;
  reason: string | null;
  status: string;
  created_at: string;
}

interface EmailRow {
  id: string;
  subject: string | null;
  to_address: string;
  from_address: string | null;
  direction: string | null;
  created_at: string;
}

interface DashboardShellProps {
  company: Company;
  tasks: Task[];
  documents: Document[];
  reports: Report[];
  creditBalance: number;
  recentUsage: number[];
  pendingSuggestions: DocumentSuggestion[];
  emails: EmailRow[];
  user: User;
  liveCompanyCount: number;
}

function formatAge(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export function DashboardShell({
  company,
  tasks: initialTasks,
  documents,
  reports: _reports,
  creditBalance: initialCreditBalance,
  recentUsage: _recentUsage,
  pendingSuggestions: _pendingSuggestions,
  emails: initialEmails,
  user,
  liveCompanyCount,
}: DashboardShellProps) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tasks, setTasks] = useState(initialTasks);
  const [emails, setEmails] = useState(initialEmails);
  const [creditBalance, setCreditBalance] = useState(initialCreditBalance);
  const [celebrateTask, setCelebrateTask] = useState<{ id: string; title: string } | null>(null);

  const latestEmail = emails[0] ?? null;
  const companyEmailAddress =
    (company as unknown as { company_email?: string | null; email_identity?: string | null }).company_email
    ?? (company as unknown as { company_email?: string | null; email_identity?: string | null }).email_identity
    ?? null;

  // FIX #8: Auto-refresh dashboard data every 30s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/dashboard?company_id=${company.id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.tasks) setTasks(data.tasks);
        if (data.emails) setEmails(data.emails);
        if (data.credits?.balance !== undefined) setCreditBalance(data.credits.balance);
      } catch { /* silent */ }
    }, 30000);
    return () => clearInterval(interval);
  }, [company.id]);

  // Celebration trigger — diff completed tasks against the last snapshot
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `baljia:seen-completed:${company.id}`;
    let seen: string[];
    try { seen = JSON.parse(sessionStorage.getItem(key) ?? '[]'); } catch { seen = []; }
    const completed = initialTasks.filter((t) => t.status === 'completed');
    const seenSet = new Set(seen);
    const fresh = completed.find((t) => !seenSet.has(t.id));
    if (fresh) setCelebrateTask({ id: fresh.id, title: fresh.title ?? 'Task complete' });
    sessionStorage.setItem(key, JSON.stringify(completed.map((t) => t.id)));
  }, [initialTasks, company.id]);

  // CEO chat rail needs warnings derived from current state
  const chatWarnings = useMemo<string[]>(() => {
    const w: string[] = [];
    if (creditBalance <= 0 && company.plan_tier !== 'trial') {
      w.push("You're out of task credits. Add more before queueing new work.");
    } else if (creditBalance > 0 && creditBalance <= 3) {
      w.push(`Only ${creditBalance} task ${creditBalance === 1 ? 'credit' : 'credits'} left — top up soon.`);
    }
    if (company.onboarding_status === 'initializing' || company.onboarding_status === 'running') {
      w.push('Baljia is still setting things up — research, landing, and inbox are in flight.');
    }
    if (company.onboarding_status === 'failed') {
      w.push('Setup paused before finishing. Resume from the banner above to continue.');
    }
    if (company.hosting_state === 'suspended') {
      w.push('Your app is suspended — resolve billing to bring it back online.');
    }
    return w;
  }, [creditBalance, company.plan_tier, company.onboarding_status, company.hosting_state]);

  // FIX #3: Approve now calls real API before updating local state
  const handleApprove = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/approve`, { method: 'POST' });
      if (res.ok || (res.status === 409)) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'in_progress' as const } : t)));
      }
    } catch { /* silent — optimistic update skipped on network error */ }
  }, []);

  // FIX #3: Reject now calls real API before updating local state
  const handleReject = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/reject`, { method: 'POST' });
      if (res.ok) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'rejected' as const } : t)));
      }
    } catch { /* silent */ }
  }, []);

  // Tasks shown as cards on the main column — top 5 most-recent non-terminal.
  const previewTasks = useMemo(() => {
    const priority: Record<string, number> = {
      todo: 0, in_progress: 1, verifying: 2, repair: 3,
      completed: 4, failed: 5, failed_permanent: 5, rejected: 6,
    };
    return [...tasks]
      .sort((a, b) => (priority[a.status] ?? 99) - (priority[b.status] ?? 99))
      .slice(0, 5);
  }, [tasks]);

  // FIX #1: Show docs even if is_empty flag is stale
  const docsSorted = useMemo(
    () => [...documents]
      .filter((d) => !d.is_empty || (d.content && d.content.trim().length > 0))
      .sort((a, b) => new Date(b.updated_at ?? b.created_at ?? 0).getTime()
                     - new Date(a.updated_at ?? a.created_at ?? 0).getTime()),
    [documents],
  );

  const sitePath = company.subdomain ? `https://${company.subdomain}.baljia.app` : '';
  const inboxAddress = companyEmailAddress ?? '';

  const founderGridStyle = { ['--chat-pane-width' as string]: '300px' } as React.CSSProperties;

  const onboardingFailed = company.onboarding_status === 'failed';

  return (
    <div className="dashboard-shell">
      <LiveBanner liveCount={liveCompanyCount} />

      {onboardingFailed && (
        <div
          role="alert"
          style={{
            margin: '12px 16px 0',
            padding: '14px 18px',
            border: '1px solid #D97706',
            background: '#FFF7ED',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong className="serif" style={{ fontSize: 15, display: 'block', marginBottom: 4 }}>
              Setup didn&apos;t finish
            </strong>
            <span style={{ fontSize: 12, color: '#5C5147' }}>
              Something went wrong while building <strong>{company.name}</strong>. Your work is saved
              — pick up where Baljia stopped.
            </span>
          </div>
          <Link
            className="chrome-button chrome-button--hero"
            href={`/onboarding?resume=${company.id}`}
          >
            Resume setup →
          </Link>
        </div>
      )}

      <header className="dashboard-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* FIX #7: Use real mascot image */}
          <img
            src="/mascot.png"
            alt="Baljia"
            style={{
              width: 36, height: 36, objectFit: 'contain',
              filter: 'drop-shadow(0 2px 8px rgba(225,177,44,0.3)) brightness(1.08) saturate(1.2)',
            }}
          />
          <div className="dashboard-topbar__title serif">{company.name}</div>
        </div>
        <div className="dashboard-topbar__actions">
          <Link className="chrome-button chrome-button--small" href="/portfolio">
            Portfolio
          </Link>
          <Link className="chrome-button chrome-button--small" href="/onboarding">
            + New
          </Link>
          <button
            className="chrome-button chrome-button--small"
            onClick={() => setMenuOpen((v) => !v)}
            type="button"
          >
            Menu
          </button>
        </div>
      </header>

      <div className="dashboard-grid dashboard-grid--founder" style={founderGridStyle}>
        {/* ── Left column ── */}
        <section className="dashboard-column dashboard-column--left">
          <div className="panel-title"><span className="serif">Baljia</span></div>
          <div className="status-block">
            {/* FIX #7: Real mascot instead of emoji StatusAvatar */}
            <img
              src="/mascot.png"
              alt="Baljia"
              style={{
                width: 56, height: 56, objectFit: 'contain',
                filter: 'drop-shadow(0 4px 12px rgba(225,177,44,0.3)) brightness(1.08) saturate(1.2)',
              }}
            />
            <div>
              <h2 className="serif">{company.one_liner ?? 'Ready'}</h2>
              <p>
                {company.onboarding_status === 'completed'
                  ? 'Company online. Chat with the CEO or approve a task.'
                  : onboardingFailed
                    ? 'Setup paused — resume above to finish bringing your company online.'
                    : 'Baljia is still setting things up.'}
              </p>
            </div>
          </div>

          {company.plan_tier === 'trial' && (
            <div className="trial-card">
              <h3 className="serif">Hire Your AI Employee</h3>
              <p>$1.63/day · Works while you sleep</p>
              <button
                className="chrome-button chrome-button--hero"
                onClick={() => setUpgradeOpen(true)}
                type="button"
              >
                Start free trial
              </button>
              <small>3-day trial · $49/mo</small>
            </div>
          )}

          <div className="panel-title"><span className="serif">Business</span></div>
          <div className="business-list">
            <div><span>Revenue:</span><strong>$0.00</strong></div>
            <div><span>Lifetime Earnings:</span><strong>$0.00</strong></div>
            <div><span>Payments paused</span></div>
          </div>
          <button
            className="verify-button"
            onClick={() => setPurchaseOpen(true)}
            type="button"
          >
            Complete verification to accept payments
          </button>
          <div className="refresh-note">
            Credits: {creditBalance} · {company.company_stage?.replace(/_/g, ' ') ?? 'pre-launch'}
          </div>
        </section>

        {/* ── Main column: tasks / documents / suggestions / links ── */}
        <section className="dashboard-column dashboard-column--main">
          <div className="dashboard-section">
            <div className="panel-title"><span className="serif">Tasks</span></div>
            <div className="task-preview-list">
              {previewTasks.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--dash-muted, #6f6f6f)', padding: '10px 0' }}>
                  No tasks yet. Chat with the CEO to get started.
                </p>
              ) : previewTasks.map((task) => (
                <button
                  className="task-preview-card"
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  type="button"
                >
                  <h3>{task.title}</h3>
                  {task.description && <p>{task.description}</p>}
                  <div className="task-preview-card__meta">
                    <span className="micro-pill">{task.tag ?? task.status.replace(/_/g, ' ')}</span>
                    {task.status === 'in_progress' && (
                      <span className="micro-pill micro-pill--dark">Running</span>
                    )}
                    {task.status === 'todo' && (
                      <span className="micro-pill micro-pill--dark">Awaiting approval</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
            {tasks.length > previewTasks.length && (
              <Link className="text-link" href={`/dashboard/${company.id}/tasks`}>
                Manage all {tasks.length} tasks →
              </Link>
            )}
          </div>

          {/* FIX #9: Wire DocumentSuggestionPanel */}
          <DocumentSuggestionPanel companyId={company.id} />

          <div className="dashboard-section">
            <div className="panel-title"><span className="serif">Documents</span></div>
            <div className="document-list">
              {docsSorted.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--dash-muted, #6f6f6f)', padding: '4px 0' }}>
                  No documents yet.
                </p>
              ) : docsSorted.slice(0, 5).map((doc) => (
                <button
                  className="document-row document-row--button"
                  key={doc.id}
                  onClick={() => setSelectedDoc(doc)}
                  type="button"
                >
                  <span className="document-row__icon">≡</span>
                  <div><strong>{doc.title ?? doc.doc_type}</strong></div>
                  <small>{formatAge(doc.updated_at ?? doc.created_at ?? null)}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="dashboard-section">
            <div className="panel-title"><span className="serif">Links</span></div>
            <div className="links-list">
              {sitePath && (
                <a className="link-item" href={sitePath} target="_blank" rel="noopener noreferrer">
                  <strong>{company.name}</strong>
                  <span>{sitePath.replace(/^https?:\/\//, '')}</span>
                </a>
              )}
              {inboxAddress && (
                <div className="link-item">
                  <strong>Company Inbox</strong>
                  <span>{inboxAddress}</span>
                </div>
              )}
              {sitePath && (
                <a className="link-item" href={`${sitePath}/trial/${company.slug}`} target="_blank" rel="noopener noreferrer">
                  <strong>Hosted Checkout</strong>
                  <span>{sitePath.replace(/^https?:\/\//, '')}/trial/{company.slug}</span>
                </a>
              )}
            </div>
          </div>
        </section>

        {/* ── Channels column: Twitter / Email / Ads ── */}
        <section className="dashboard-column dashboard-column--channels">
          <div className="dashboard-section">
            <div className="panel-title"><span className="serif">Twitter</span></div>
            <div className="channel-handle">@{company.slug ?? 'baljia'}</div>
            <div className="tweet-box">
              <p style={{ color: 'var(--dash-muted, #6f6f6f)' }}>No tweets yet — run a Twitter task to see posts here.</p>
            </div>
            <button className="chrome-button chrome-button--small" type="button" disabled>
              Tweet
            </button>
          </div>

          <div className="dashboard-section">
            <div className="panel-title"><span className="serif">Email</span></div>
            <div className="channel-handle">{inboxAddress || '—'}</div>
            <div className="mail-list">
              {emails.length === 0 ? (
                <div>
                  <p style={{ fontSize: 12, color: 'var(--dash-muted, #6f6f6f)' }}>No emails yet.</p>
                  {/* FIX #4: Helpful CTA when no emails */}
                  <p style={{ fontSize: 11, color: 'var(--dash-faint, #8a8a8a)', marginTop: 4 }}>
                    Ask the CEO to run a cold outreach task to start sending emails.
                  </p>
                </div>
              ) : emails.slice(0, 3).map((e) => (
                <div className="mail-row" key={e.id}>
                  <strong>{e.subject ?? '(no subject)'}</strong>
                  <span>{e.direction === 'outbound' ? `To: ${e.to_address}` : `From: ${e.from_address ?? e.to_address}`}</span>
                  <small>{formatAge(e.created_at)}</small>
                </div>
              ))}
            </div>
            <button className="chrome-button chrome-button--small" type="button" disabled>
              Cold Outreach
            </button>
          </div>

          <div className="dashboard-section">
            <div className="panel-title"><span className="serif">Ads</span></div>
            <button className="chrome-button chrome-button--small" type="button" disabled>
              Run Ads
            </button>
            <div className="ads-summary">
              No campaigns. Spend today: $0.00.
            </div>
          </div>

          {latestEmail && emails.length > 3 && (
            <p style={{ fontSize: 11, color: 'var(--dash-faint, #8a8a8a)' }}>
              +{emails.length - 3} more in inbox
            </p>
          )}
        </section>

        {/* ── CEO chat rail ── */}
        <FounderChatRail companyId={company.id} warnings={chatWarnings} />
      </div>

      {/* ── Overlays + dialogs ── */}
      {menuOpen && (
        <DashboardMenu
          user={user}
          company={company}
          creditBalance={creditBalance}
          onClose={() => setMenuOpen(false)}
          onOpenUpgrade={() => { setMenuOpen(false); setUpgradeOpen(true); }}
          onOpenPurchase={() => { setMenuOpen(false); setPurchaseOpen(true); }}
        />
      )}

      <TaskDetailDialog
        task={selectedTask}
        open={selectedTask !== null}
        onOpenChange={(open) => { if (!open) setSelectedTask(null); }}
        onApprove={handleApprove}
        onReject={handleReject}
      />

      <DocumentDialog
        doc={selectedDoc}
        onClose={() => setSelectedDoc(null)}
        companySlug={company.slug ?? undefined}
      />

      <PurchaseCreditsDialog
        open={purchaseOpen}
        onOpenChange={setPurchaseOpen}
        currentBalance={creditBalance}
      />

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        companyId={company.id}
      />

      {celebrateTask && (
        <CelebrationOverlay
          taskTitle={celebrateTask.title}
          onDismiss={() => setCelebrateTask(null)}
        />
      )}
    </div>
  );
}
