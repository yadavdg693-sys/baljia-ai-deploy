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
import type { Company, Task, Document, Report, User, ChatAction } from '@/types';
import { TaskDetailDialog } from './TaskDetailDialog';
import { DocumentDialog } from './DocumentDialog';
import { PurchaseCreditsDialog } from './PurchaseCreditsDialog';
import { UpgradeDialog } from './UpgradeDialog';
import { DashboardMenu } from './DashboardMenu';
import { LiveBanner } from './LiveBanner';
import { CelebrationOverlay } from './CelebrationOverlay';
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
  body: string | null;
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
  const [selectedEmail, setSelectedEmail] = useState<EmailRow | null>(null);
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

  // Re-fetch dashboard from /api/dashboard. Used by both the 30s timer and
  // the on-action refresh hook so chat-created tasks appear instantly.
  const refreshDashboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard?company_id=${company.id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.tasks) setTasks(data.tasks);
      if (data.emails) setEmails(data.emails);
      if (data.credits?.balance !== undefined) setCreditBalance(data.credits.balance);
    } catch { /* silent */ }
  }, [company.id]);

  // 30s safety-net poll. Most updates come via the chat onAction hook below.
  useEffect(() => {
    const interval = setInterval(refreshDashboard, 30000);
    return () => clearInterval(interval);
  }, [refreshDashboard]);

  // CEO action → instant refresh. Closes the up-to-30s blind spot where a
  // chat-created task sat in the DB but wasn't yet visible on the dashboard.
  const handleChatAction = useCallback((action: ChatAction) => {
    if (
      action.type === 'task_proposal'
      || action.type === 'task_approved'
      || action.type === 'document_updated'
      || action.type === 'credit_quote'
    ) {
      refreshDashboard();
    }
  }, [refreshDashboard]);

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

  // FIX: Approve now calls real API before updating local state
  const handleApprove = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/approve`, { method: 'POST' });
      if (res.ok || (res.status === 409)) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'in_progress' as const } : t)));
      }
    } catch { /* silent — optimistic update skipped on network error */ }
  }, []);

  // FIX: Reject now calls real API before updating local state
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

  // FIX: Show docs even if is_empty flag is stale
  const docsSorted = useMemo(
    () => [...documents]
      .filter((d) => !d.is_empty || (d.content && d.content.trim().length > 0))
      .sort((a, b) => new Date(b.updated_at ?? b.created_at ?? 0).getTime()
                     - new Date(a.updated_at ?? a.created_at ?? 0).getTime()),
    [documents],
  );

  const sitePath = company.subdomain ? `https://${company.subdomain}.baljia.app` : '';
  const inboxAddress = companyEmailAddress ?? '';


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

      <div className="dashboard-layout-flex">
      <div className="dashboard-grid dashboard-grid--founder">
        {/* ── Left column ── */}
        <section className="dashboard-column dashboard-column--left">
          <div className="panel-title"><span className="serif">Baljia</span></div>
          <div className="status-block">
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
                  Message Baljia to set up your first company.
                </p>
              ) : previewTasks.map((task) => (
                <div
                  className="task-preview-card"
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedTask(task); }}
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
                  {/* Inline approve/reject for todo tasks — matches prototype */}
                  {task.status === 'todo' && (
                    <div
                      className="task-preview-card__actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="task-action-btn task-action-btn--reject"
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleReject(task.id); }}
                      >
                        ✗ Reject
                      </button>
                      <button
                        className="task-action-btn task-action-btn--approve"
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleApprove(task.id); }}
                      >
                        ✓ Approve
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {tasks.length > previewTasks.length && (
              <Link className="text-link" href={`/dashboard/${company.id}/tasks`}>
                Manage all {tasks.length} tasks →
              </Link>
            )}
          </div>

          {/* FIX: Wire DocumentSuggestionPanel */}
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
                  {/* FIX: Helpful CTA when no emails */}
                  <p style={{ fontSize: 11, color: 'var(--dash-faint, #8a8a8a)', marginTop: 4 }}>
                    Ask Baljia to run a cold outreach task to start sending emails.
                  </p>
                </div>
              ) : emails.slice(0, 3).map((e) => (
                <button
                  className="mail-row mail-row--clickable"
                  key={e.id}
                  type="button"
                  onClick={() => setSelectedEmail(e)}
                >
                  <strong>{e.subject ?? '(no subject)'}</strong>
                  <span>{e.direction === 'outbound' ? `To: ${e.to_address}` : `From: ${e.from_address ?? e.to_address}`}</span>
                  <small>{formatAge(e.created_at)}</small>
                </button>
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
      </div>

        {/* ── Baljia chat sidebar (docked right) ── */}
        <FounderChatRail companyId={company.id} warnings={chatWarnings} onAction={handleChatAction} />
      </div>

      {/* ── Email viewer dialog ── */}
      {selectedEmail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setSelectedEmail(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-xl flex flex-col"
            style={{ background: 'var(--dash-surface, #FFFDF9)', border: '1px solid var(--dash-line, #e8dfd4)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--dash-line, #e8dfd4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: 'var(--dash-ink)' }}>
                  {selectedEmail.subject ?? '(no subject)'}
                </h2>
                <p style={{ fontSize: 12, color: 'var(--dash-muted, #6f6f6f)' }}>
                  {selectedEmail.direction === 'outbound'
                    ? `To: ${selectedEmail.to_address}`
                    : `From: ${selectedEmail.from_address ?? selectedEmail.to_address}`}
                  {' · '}{formatAge(selectedEmail.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEmail(null)}
                style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--dash-line, #e8dfd4)', background: 'var(--dash-surface-muted)', fontSize: 12, cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
            {/* Body */}
            <div style={{ overflow: 'auto', padding: '20px', flex: 1 }}>
              {selectedEmail.body ? (
                <pre style={{ fontFamily: 'var(--font-body, Inter, sans-serif)', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--dash-ink)', margin: 0 }}>
                  {selectedEmail.body}
                </pre>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--dash-muted, #6f6f6f)', fontStyle: 'italic' }}>
                  No message body stored.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

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
