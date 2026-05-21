// DashboardShell — Production redesign matching prototype aesthetic.
// All functionality preserved: API calls, auto-refresh, chat, dialogs, etc.
// Styled with inline styles using CSS vars from globals.css (warm cream + dark mode).
// No dependency on polsia-shell.css for layout — self-contained.

'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Film } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Company, Task, Document, Report, User, ChatAction, PromoVideoJob } from '@/types';
import { TaskDetailDialog } from './TaskDetailDialog';
import { DocumentDialog } from './DocumentDialog';
import { PurchaseCreditsDialog } from './PurchaseCreditsDialog';
import { UpgradeDialog } from './UpgradeDialog';
import { DashboardMenu } from './DashboardMenu';
import { CelebrationOverlay } from './CelebrationOverlay';
import { DocumentSuggestionPanel } from './DocumentSuggestionPanel';
import { NewTaskDialog } from './NewTaskDialog';
import { RunAdsDialog } from './RunAdsDialog';
import { PromoVideoDialog } from './PromoVideoDialog';
import { PromoVideoPanel } from './PromoVideoPanel';
import { RecurringTasksDialog } from './RecurringTasksDialog';
import { AddLinkDialog } from './AddLinkDialog';
import { FounderChatRail } from '@/components/chat/FounderChatRail';
import { FOUNDER_AGENT_LABELS, ONBOARDING_STAGE_LABELS } from '@/lib/founder-labels';

interface DocumentSuggestion { id: string; document_id: string; suggested_content: string; reason: string | null; status: string; created_at: string; }
interface EmailRow { id: string; subject: string | null; to_address: string; from_address: string | null; direction: string | null; body: string | null; created_at: string; }
interface DashboardLinkRow { id: string; label: string; url: string; }
interface SetupEventRow { id: string; event_type: string; payload: Record<string, unknown>; created_at: string; }
interface AdCampaignRow { id: string; status: string | null; daily_budget: string | null; spend: string | null; created_at: string | null; }

interface DashboardShellProps {
  company: Company; tasks: Task[]; documents: Document[]; reports: Report[];
  creditBalance: number; recentUsage: number[]; pendingSuggestions: DocumentSuggestion[];
  emails: EmailRow[]; links?: DashboardLinkRow[]; setupEvents?: SetupEventRow[]; ads?: AdCampaignRow[]; promoVideos?: PromoVideoJob[]; user: User;
}

function formatAge(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return d < 7 ? `${d}d ago` : d < 30 ? `${Math.floor(d / 7)}w ago` : `${Math.floor(d / 30)}mo ago`;
}

// ─── Inline style constants ───
const S = {
  page: { minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Inter', system-ui, sans-serif", transition: 'background .45s, color .45s' } as React.CSSProperties,
  topbar: { position: 'sticky' as const, top: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px', minHeight: 60, background: 'color-mix(in oklab, var(--bg) 92%, transparent)', backdropFilter: 'blur(14px)', boxShadow: '0 10px 30px rgba(24,18,10,0.04)' } as React.CSSProperties,
  topbarTitle: { fontFamily: "'Newsreader', Georgia, serif", fontSize: 22, fontWeight: 600, letterSpacing: '-.4px', color: 'var(--ink)' } as React.CSSProperties,
  topbarSubtitle: { fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Newsreader', Georgia, serif", fontStyle: 'italic' } as React.CSSProperties,
  mascotSm: { width: 36, height: 36, objectFit: 'contain' as const, filter: 'drop-shadow(0 2px 8px rgba(225,177,44,0.3)) brightness(1.08) saturate(1.2)' } as React.CSSProperties,
  mascotMd: { width: 64, height: 64, objectFit: 'contain' as const, filter: 'drop-shadow(0 4px 12px rgba(225,177,44,0.3)) brightness(1.08) saturate(1.2)' } as React.CSSProperties,
  grid: { display: 'flex', minHeight: 'calc(100vh - 60px)' } as React.CSSProperties,
  colLeft: { width: 240, flexShrink: 0, padding: '22px 16px', overflowY: 'auto' as const } as React.CSSProperties,
  colMain: { flex: 1, minWidth: 0, padding: '22px 16px', overflowY: 'auto' as const } as React.CSSProperties,
  colChannels: { width: 220, flexShrink: 0, padding: '22px 12px 22px 8px', overflowY: 'auto' as const } as React.CSSProperties,
  panelHeading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6, marginBottom: 12, fontSize: 11, fontWeight: 750, letterSpacing: '1.1px', textTransform: 'uppercase' as const, color: 'var(--text-dim)' } as React.CSSProperties,
  section: { marginBottom: 28 } as React.CSSProperties,
  workboardRow: { display: 'grid', gridTemplateColumns: 'minmax(420px, 560px) minmax(280px, 1fr)', gap: 18, alignItems: 'start' } as React.CSSProperties,
  workboardColumn: { minWidth: 0 } as React.CSSProperties,
  inboxColumn: { minWidth: 0 } as React.CSSProperties,
  workboardSurface: { display: 'grid', gap: 10, padding: 0, background: 'transparent', boxShadow: 'none' } as React.CSSProperties,
  card: { minHeight: 92, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '13px 15px', boxShadow: '0 1px 2px rgba(24,18,10,0.04)', transition: 'transform .2s ease, box-shadow .2s ease, background .2s ease', cursor: 'pointer', position: 'relative' as const, overflow: 'hidden' } as React.CSSProperties,
  cardAccent: { position: 'absolute' as const, left: 0, top: 10, bottom: 10, width: 3, background: 'linear-gradient(180deg, #E1B12C, #D97706)', borderRadius: 999 } as React.CSSProperties,
  badge: (variant: string) => {
    const colors: Record<string, { bg: string; color: string; border: string }> = {
      success: { bg: 'rgba(34,197,94,0.1)', color: '#047857', border: 'rgba(34,197,94,0.2)' },
      running: { bg: 'rgba(225,177,44,0.12)', color: '#D97706', border: 'rgba(225,177,44,0.28)' },
      danger: { bg: 'rgba(239,68,68,0.1)', color: '#DC2626', border: 'rgba(239,68,68,0.2)' },
      dark: { bg: 'var(--ink)', color: '#fff', border: 'transparent' },
      default: { bg: 'var(--bg-alt)', color: 'var(--text-muted)', border: 'var(--border)' },
    };
    const c = colors[variant] || colors.default;
    return { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 650, background: c.bg, color: c.color, whiteSpace: 'nowrap' as const } as React.CSSProperties;
  },
  btn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: '1px solid transparent', background: 'var(--bg-card)', color: 'var(--ink)', fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all .2s', boxShadow: '0 5px 16px rgba(24,18,10,0.06)' } as React.CSSProperties,
  btnPrimary: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #E1B12C, #D97706)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 6px 18px rgba(217,119,6,0.28), inset 0 1px 0 rgba(255,255,255,0.3)' } as React.CSSProperties,
  btnSm: { padding: '4px 9px', fontSize: 11 } as React.CSSProperties,
  btnGhost: { background: 'transparent', border: 'none', boxShadow: 'none', color: 'var(--text-muted)', padding: '3px 6px', fontSize: 12, cursor: 'pointer' } as React.CSSProperties,
  docRow: { display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 8, alignItems: 'center', padding: '8px 0', fontSize: 13, cursor: 'pointer', transition: 'color .2s, background .2s', background: 'transparent', border: 'none', width: '100%', textAlign: 'left' as const } as React.CSSProperties,
  linkItem: { display: 'grid', gap: 3, fontSize: 13, padding: '7px 0' } as React.CSSProperties,
  softPanel: { padding: 12, borderRadius: 10, background: 'var(--bg-alt)', border: '1px solid var(--border)', boxShadow: '0 1px 2px rgba(24,18,10,0.04)' } as React.CSSProperties,
  trialCard: { background: 'var(--bg-alt)', borderRadius: 12, padding: 20, marginBottom: 20, textAlign: 'center' as const, boxShadow: '0 4px 16px rgba(24,18,10,0.045)' } as React.CSSProperties,
  emailModal: { position: 'fixed' as const, inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', padding: 24 } as React.CSSProperties,
};

const statusBadge = (s: string) => {
  const map: Record<string, string> = { completed: 'success', in_progress: 'running', todo: 'default', failed: 'danger', failed_permanent: 'danger', rejected: 'danger', verifying: 'running', repair: 'running' };
  return map[s] || 'default';
};

// ─── Sortable task card ───
// Wraps a task card with @dnd-kit's useSortable so todo tasks can be dragged
// up/down. Non-todo tasks pass `draggable={false}` and act as plain cards.
function SortableTaskCard({
  task, agentName, draggable, onSelect, onApprove, onReject, onRunNow,
}: {
  task: Task;
  agentName: string | null;
  draggable: boolean;
  onSelect: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRunNow: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable,
  });
  const cardStyle: React.CSSProperties = {
    ...S.card,
    display: 'flex',
    flexDirection: 'column',
    transform: CSS.Transform.toString(transform),
    transition: transition ?? S.card.transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };
  // Drag listeners only attach when draggable; click-to-open still works
  // (PointerSensor's distance:8 constraint means a click without drag fires onClick).
  const dragProps = draggable ? { ...attributes, ...listeners } : {};
  return (
    <div
      ref={setNodeRef}
      style={cardStyle}
      className={`dashboard-task-card${isDragging ? ' is-dragging' : ''}`}
      data-draggable={draggable ? 'true' : 'false'}
      onClick={onSelect}
      {...dragProps}
    >
      <div style={S.cardAccent}></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10, marginLeft: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 style={{ fontSize: 14, fontWeight: 750, color: 'var(--ink)', marginBottom: 3, lineHeight: 1.22, wordBreak: 'break-word' as const }}>{task.title}</h4>
          {task.description && <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: task.status === 'todo' && !task.authorized_by ? 1 : 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>{task.description}</p>}
        </div>
        <span style={S.badge(statusBadge(task.status))}>{task.status.replace(/_/g, ' ')}</span>
      </div>
      {task.status === 'in_progress' && task.started_at && (
        <div style={{ marginTop: 8, marginLeft: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', marginBottom: 3 }}>
            <span>Turn {task.turn_count}/{task.max_turns}</span><span>Working...</span>
          </div>
          <div style={{ height: 3, background: 'var(--bg-alt)', borderRadius: 2 }}>
            <div style={{ width: `${Math.min((task.turn_count / task.max_turns) * 100, 100)}%`, height: 3, background: 'linear-gradient(90deg, #E1B12C, #FCD34D)', borderRadius: 2, transition: 'width .5s' }}></div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' as const, marginTop: 8, marginLeft: 8 }}>
        <span style={S.badge('default')}>{task.tag}</span>
        {agentName && <span style={S.badge('default')}>🤖 {agentName}</span>}
        <span style={{ flex: 1 }}></span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{formatAge(task.created_at)}</span>
      </div>
      {task.status === 'todo' && !task.authorized_by && (
        <div
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          className="dashboard-task-actions"
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginTop: 9, paddingTop: 0, marginLeft: 8 }}
        >
          <button style={{ ...S.btnGhost, color: '#DC2626' }} onClick={e => { e.stopPropagation(); onReject(task.id); }}>✗ Reject</button>
          <span style={{ flex: 1 }}></span>
          <button style={{ ...S.btn, ...S.btnSm }} onClick={e => { e.stopPropagation(); onApprove(task.id); }}>✓ Approve</button>
          <button style={{ ...S.btnPrimary, ...S.btnSm }} onClick={e => { e.stopPropagation(); onRunNow(task.id); }}>▶ Run Now</button>
        </div>
      )}
      {task.status === 'todo' && task.authorized_by && (
        <div style={{ marginTop: 8, marginLeft: 8 }}><span style={S.badge('running')}>Queued · launching</span></div>
      )}
    </div>
  );
}

export function DashboardShell({ company: initialCompany, tasks: initialTasks, documents, reports: _reports, creditBalance: initialCreditBalance, recentUsage: _recentUsage, pendingSuggestions: _pendingSuggestions, emails: initialEmails, links: initialLinks, setupEvents: initialSetupEvents, ads: initialAds, promoVideos: initialPromoVideos, user }: DashboardShellProps) {
  const [company, setCompany] = useState(initialCompany);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailRow | null>(null);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tasks, setTasks] = useState(initialTasks);
  const [docs, setDocs] = useState(documents);
  const [emails, setEmails] = useState(initialEmails);
  const [creditBalance, setCreditBalance] = useState(initialCreditBalance);
  const [links, setLinks] = useState<DashboardLinkRow[]>(initialLinks ?? []);
  const [setupEvents, setSetupEvents] = useState<SetupEventRow[]>(initialSetupEvents ?? []);
  const [ads, setAds] = useState<AdCampaignRow[]>(initialAds ?? []);
  const [promoVideos, setPromoVideos] = useState<PromoVideoJob[]>(initialPromoVideos ?? []);
  const [celebrateTask, setCelebrateTask] = useState<{ id: string; title: string } | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [runAdsOpen, setRunAdsOpen] = useState(false);
  const [promoVideoOpen, setPromoVideoOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<DashboardLinkRow | null>(null);

  const companyEmailAddress = (company as unknown as { company_email?: string | null; email_identity?: string | null }).company_email ?? (company as unknown as { company_email?: string | null; email_identity?: string | null }).email_identity ?? null;
  const sitePath = company.custom_domain ? (/^https?:\/\//i.test(company.custom_domain) ? company.custom_domain : `https://${company.custom_domain}`) : company.subdomain ? `https://${company.subdomain}.baljia.app` : '';
  const inboxAddress = companyEmailAddress ?? '';
  const onboardingFailed = company.onboarding_status === 'failed';

  const refreshDashboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard?company_id=${company.id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.company) setCompany(prev => ({ ...prev, ...data.company }));
      if (data.tasks) setTasks(data.tasks);
      if (data.documents) setDocs(data.documents);
      if (data.emails) setEmails(data.emails);
      if (data.credits?.balance !== undefined) setCreditBalance(data.credits.balance);
      if (Array.isArray(data.links)) setLinks(data.links);
      if (Array.isArray(data.setup_events)) setSetupEvents(data.setup_events);
      if (Array.isArray(data.ads)) setAds(data.ads);
      if (Array.isArray(data.promo_videos)) setPromoVideos(data.promo_videos);
    } catch { /* silent */ }
  }, [company.id]);

  const handleReorder = useCallback(async (taskId: string, queue_order: number) => {
    try { const res = await fetch(`/api/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queue_order }) }); if (res.ok) await refreshDashboard(); } catch {}
  }, [refreshDashboard]);

  const handleRunNow = useCallback(async (taskId: string) => {
    try { const res = await fetch(`/api/tasks/${taskId}/approve`, { method: 'POST' }); if (res.ok || res.status === 409) { setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'in_progress' as const } : t)); await refreshDashboard(); } } catch {}
  }, [refreshDashboard]);

  const onboardingActive = company.onboarding_status === 'initializing' || company.onboarding_status === 'running';

  useEffect(() => {
    const i = setInterval(refreshDashboard, onboardingActive ? 3000 : 30000);
    return () => clearInterval(i);
  }, [refreshDashboard, onboardingActive]);

  // Live setup-log SSE stream (only while onboarding is running). Same source
  // the waitlist terminal uses — events are pushed the instant they happen.
  useEffect(() => {
    if (!onboardingActive) return;
    const es = new EventSource(`/api/events/stream?companyId=${company.id}`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const incoming = msg.type === 'snapshot' || msg.type === 'events' ? msg.events : null;
        if (!incoming || !Array.isArray(incoming)) return;
        setSetupEvents(prev => {
          const seen = new Set(prev.map(p => p.id));
          const merged = [...prev];
          for (const ev of incoming) if (!seen.has(ev.id)) merged.push(ev);
          return merged.slice(-50);
        });
      } catch { /* ignore malformed frame */ }
    };
    es.onerror = () => { /* browser auto-reconnects */ };
    return () => { es.close(); };
  }, [onboardingActive, company.id]);

  const handleChatAction = useCallback((action: ChatAction) => {
    if (action.type === 'task_proposal' || action.type === 'task_approved' || action.type === 'document_updated' || action.type === 'credit_quote') refreshDashboard();
  }, [refreshDashboard]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `baljia:seen-completed:${company.id}`;
    let seen: string[]; try { seen = JSON.parse(sessionStorage.getItem(key) ?? '[]'); } catch { seen = []; }
    const completed = initialTasks.filter(t => t.status === 'completed');
    const seenSet = new Set(seen);
    const fresh = completed.find(t => !seenSet.has(t.id));
    if (fresh) setCelebrateTask({ id: fresh.id, title: fresh.title ?? 'Task complete' });
    sessionStorage.setItem(key, JSON.stringify(completed.map(t => t.id)));
  }, [initialTasks, company.id]);

  const chatWarnings = useMemo<string[]>(() => {
    const w: string[] = [];
    if (creditBalance <= 0 && company.plan_tier !== 'trial') w.push("You're out of task credits.");
    else if (creditBalance > 0 && creditBalance <= 3) w.push(`Only ${creditBalance} credit${creditBalance === 1 ? '' : 's'} left.`);
    if (onboardingActive) w.push('Still setting up — research, landing, and inbox in flight.');
    if (company.onboarding_status === 'failed') w.push('Setup paused. Resume from the banner above.');
    if (company.hosting_state === 'suspended') w.push('App suspended — resolve billing.');
    return w;
  }, [creditBalance, company.plan_tier, onboardingActive, company.onboarding_status, company.hosting_state]);

  const handleApprove = useCallback(async (taskId: string) => {
    try { const res = await fetch(`/api/tasks/${taskId}/approve`, { method: 'POST' }); if (res.ok || res.status === 409) { setTasks(prev => prev.map(t => t.id === taskId ? { ...t, authorized_by: 'founder' } : t)); setTimeout(() => { void refreshDashboard(); }, 1500); } } catch {}
  }, [refreshDashboard]);

  const handleReject = useCallback(async (taskId: string) => {
    try { const res = await fetch(`/api/tasks/${taskId}/reject`, { method: 'POST' }); if (res.ok) setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'rejected' as const } : t)); } catch {}
  }, []);

  const previewTasks = useMemo(() => {
    const p: Record<string, number> = { todo: 0, in_progress: 1, verifying: 2, repair: 3, completed: 4, failed: 5, failed_permanent: 5, rejected: 6 };
    return [...tasks].sort((a, b) => {
      const pa = p[a.status] ?? 99;
      const pb = p[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      return (a.queue_order ?? 0) - (b.queue_order ?? 0);
    }).slice(0, 5);
  }, [tasks]);

  // ─── Drag-and-drop reordering for the task preview ───
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = previewTasks.findIndex(t => t.id === active.id);
    const newIndex = previewTasks.findIndex(t => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(previewTasks, oldIndex, newIndex);
    // Optimistic local update so the user sees the reorder instantly.
    setTasks(prev => {
      const newOrders = new Map(reordered.map((t, idx) => [t.id, idx]));
      return prev.map(t => newOrders.has(t.id) ? { ...t, queue_order: newOrders.get(t.id)! } : t);
    });
    // Persist new queue_order for each affected task in parallel.
    Promise.all(reordered.map((t, idx) =>
      fetch(`/api/tasks/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue_order: idx }),
      }).catch(() => null)
    )).then(() => { void refreshDashboard(); });
  }, [previewTasks, refreshDashboard]);

  const setupLines = useMemo(() => setupEvents.map((event) => {
    const payload = event.payload ?? {};
    if (event.event_type === 'onboarding_activity' && typeof payload.text === 'string') {
      return { id: event.id, text: payload.text, at: event.created_at };
    }
    if (event.event_type === 'onboarding_stage' && typeof payload.stage === 'string') {
      const label = ONBOARDING_STAGE_LABELS[payload.stage] ?? payload.stage.replace(/_/g, ' ');
      const status = typeof payload.status === 'string' ? payload.status : 'running';
      return { id: event.id, text: `${label} ${status === 'done' ? 'done' : status === 'error' ? 'needs attention' : 'in progress'}`, at: event.created_at };
    }
    return null;
  }).filter(Boolean).slice(-30) as Array<{ id: string; text: string; at: string }>, [setupEvents]);

  // Auto-scroll the setup-log strip to bottom whenever a new line lands —
  // matches OnboardingLogStrip behavior so the dashboard terminal "moves".
  const setupLogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (setupLogRef.current) setupLogRef.current.scrollTop = setupLogRef.current.scrollHeight;
  }, [setupLines.length]);

  const liveSetupLabel = useMemo(() => {
    for (let i = setupEvents.length - 1; i >= 0; i--) {
      const payload = setupEvents[i].payload ?? {};
      if (setupEvents[i].event_type === 'onboarding_stage' && payload.status === 'running' && typeof payload.stage === 'string') {
        return ONBOARDING_STAGE_LABELS[payload.stage] ?? payload.stage.replace(/_/g, ' ');
      }
    }
    return 'Building your dashboard';
  }, [setupEvents]);

  const docsSorted = useMemo(() => [...docs].filter(d => !d.is_empty || (d.content && d.content.trim().length > 0)).sort((a, b) => new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime()), [docs]);
  const activeAdCount = useMemo(() => ads.filter(ad => ad.status === 'active').length, [ads]);
  const totalAdSpend = useMemo(() => ads.reduce((sum, ad) => sum + Number(ad.spend ?? 0), 0), [ads]);

  return (
    <div style={S.page}>
      {onboardingActive && (
        <div style={{ margin: '12px 16px 0', padding: '14px 18px', border: '1px solid rgba(225,177,44,0.35)', background: 'rgba(225,177,44,0.08)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' as const }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 15, display: 'block', marginBottom: 4, color: 'var(--ink)' }}>Setup is still running</strong>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>You can stay here while market research, landing, inbox, and infrastructure finish in the background.</span>
          </div>
          <span style={S.badge('running')}>Live setup: {liveSetupLabel}</span>
          {setupLines.length > 0 && (
            <div
              ref={setupLogRef}
              style={{ flexBasis: '100%', display: 'grid', gap: 6, paddingTop: 8, marginTop: 2, maxHeight: 180, overflowY: 'auto', scrollBehavior: 'smooth' }}
            >
              {setupLines.map((line) => (
                <div
                  key={line.id}
                  className="animate-fade-up"
                  style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 10, fontSize: 11, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}
                >
                  <span style={{ color: '#D97706' }}>{formatAge(line.at) || 'now'}</span>
                  <span>{line.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {onboardingFailed && (
        <div style={{ margin: '12px 16px 0', padding: '14px 18px', border: '1px solid #D97706', background: 'rgba(225,177,44,0.08)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' as const }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 15, display: 'block', marginBottom: 4, color: 'var(--ink)' }}>Setup didn&apos;t finish</strong>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Something went wrong building <strong>{company.name}</strong>. Your work is saved.</span>
          </div>
          <Link href={`/onboarding?resume=${company.id}`} style={{ ...S.btnPrimary, textDecoration: 'none', fontSize: 13 }}>Resume setup →</Link>
        </div>
      )}

      {/* Topbar */}
      <header style={{ ...S.topbar, animationDelay: '0ms' }} className="dashboard-reveal">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Image src="/mascot.png" alt="Baljia" width={36} height={36} style={S.mascotSm} />
          <div>
            <div style={S.topbarTitle}>{company.name}</div>
            {company.one_liner && <div style={S.topbarSubtitle}>{company.one_liner}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btnPrimary} onClick={() => setPromoVideoOpen(true)}><Film size={14} aria-hidden="true" /> Promo video</button>
          <Link href={`/dashboard/${company.slug ?? company.id}/settings/payments`} style={{ ...S.btn, textDecoration: 'none' }} title="Connect Stripe or Razorpay so your app can accept payments">Payments</Link>
          <Link href="/portfolio" style={{ ...S.btn, textDecoration: 'none' }}>Portfolio</Link>
          <Link href="/onboarding" style={{ ...S.btn, textDecoration: 'none' }}>+ New</Link>
          <button style={S.btn} onClick={() => setMenuOpen(v => !v)}>Menu</button>
        </div>
      </header>

      {/* Main grid */}
      <div style={S.grid} className="dashboard-grid">
        {/* ── Left column ── */}
        <div style={{ ...S.colLeft, animationDelay: '180ms' }} className="dashboard-col-left dashboard-reveal">
          <div style={S.panelHeading}><span style={{ fontFamily: "'Newsreader', Georgia, serif" }}>Baljia</span></div>
          <div style={{ marginBottom: 20 }}>
            <Image src="/mascot.png" alt="Baljia" width={64} height={64} style={S.mascotMd} className="animate-bob" />
          </div>

          {false && (
            <div style={S.trialCard}>
              <h3 style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 17, fontWeight: 600, marginBottom: 12 }}>Build your team</h3>
              <button style={{ ...S.btnPrimary, width: '100%' }} onClick={() => setUpgradeOpen(true)}>Start free trial</button>
              <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>3-day trial · $49/mo</p>
            </div>
          )}

          <div style={S.panelHeading}><span style={{ fontFamily: "'Newsreader', Georgia, serif" }}>Business</span></div>
          <div style={{ display: 'grid', gap: 8, fontSize: 13, marginBottom: 14 }}>
            {[['Revenue', '$0.00'], ['Lifetime', '$0.00']].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                <strong style={{ color: 'var(--ink)' }}>{v}</strong>
              </div>
            ))}
          </div>
          <button style={{ ...S.btn, width: '100%', fontSize: 11, color: '#D97706' }} onClick={() => setPurchaseOpen(true)}>
            Complete verification to accept payments
          </button>

        </div>

        {/* ── Main column ── */}
        <div style={S.colMain} className="dashboard-col-main">
          <div style={S.workboardRow} className="dashboard-workboard-row">
            {previewTasks.length > 0 && (
            <div style={{ ...S.section, ...S.workboardColumn }} className="dashboard-reveal">
              <div style={S.panelHeading}>
                <span style={{ fontFamily: "'Newsreader', Georgia, serif" }}>Workboard</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button style={{ ...S.btn, ...S.btnSm }} onClick={() => setRecurringOpen(true)}>↻ Recurring</button>
                  <button style={{ ...S.btnPrimary, ...S.btnSm }} onClick={() => setNewTaskOpen(true)}>+ New Task</button>
                </span>
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={previewTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                  <div style={S.workboardSurface}>
                    {previewTasks.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', padding: '10px 0' }}>
                        {onboardingActive ? 'Your first plan is being prepared. Tasks will appear here after Baljia scopes them.' : 'Message Baljia to set up your first company.'}
                      </p>
                    ) : previewTasks.map(task => {
                      const agentName = task.assigned_to_agent_id !== null ? FOUNDER_AGENT_LABELS[task.assigned_to_agent_id] ?? 'AI Team' : null;
                      const draggable = task.status === 'todo' && !task.authorized_by;
                      return (
                        <SortableTaskCard
                          key={task.id}
                          task={task}
                          agentName={agentName}
                          draggable={draggable}
                          onSelect={() => setSelectedTask(task)}
                          onApprove={handleApprove}
                          onReject={handleReject}
                          onRunNow={handleRunNow}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
              {tasks.length > previewTasks.length && (
                <Link href={`/dashboard/${company.id}/tasks`} style={{ display: 'inline-block', marginTop: 10, fontSize: 13, fontWeight: 700, color: '#D97706', textDecoration: 'none' }}>
                  Manage all {tasks.length} tasks →
                </Link>
              )}
            </div>
            )}

            <div style={S.inboxColumn}>
              {emails.length > 0 && (
                <div style={S.section} className="dashboard-reveal">
                  <div style={S.panelHeading}><span style={{ fontFamily: "'Newsreader', Georgia, serif" }}>Inbox</span></div>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>{inboxAddress || '—'}</p>
                  {emails.slice(0, 3).map(e => (
                    <button key={e.id} style={{ ...S.docRow, gridTemplateColumns: '1fr auto' }} onClick={() => setSelectedEmail(e)}>
                      <div><strong style={{ fontSize: 12, color: 'var(--ink)' }}>{e.subject ?? '(no subject)'}</strong><br /><span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{e.direction === 'outbound' ? `To: ${e.to_address}` : `From: ${e.from_address ?? e.to_address}`}</span></div>
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{formatAge(e.created_at)}</span>
                    </button>
                  ))}
                </div>
              )}

              <div style={S.section} className="dashboard-reveal">
                <div style={S.panelHeading}><span style={{ fontFamily: "'Newsreader', Georgia, serif" }}>Promo videos</span></div>
                <PromoVideoPanel
                  videos={promoVideos}
                  onCreate={() => setPromoVideoOpen(true)}
                  onApproved={(job) => {
                    setPromoVideos(prev => [job, ...prev.filter(item => item.id !== job.id)]);
                    void refreshDashboard();
                  }}
                />
              </div>

              <div style={S.section} className="dashboard-reveal">
                <div style={S.panelHeading}><span style={{ fontFamily: "'Newsreader', Georgia, serif" }}>Campaigns</span></div>
                <div style={S.softPanel}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 13, color: 'var(--ink)' }}>
                        {ads.length > 0 ? `${ads.length} campaign${ads.length === 1 ? '' : 's'}` : 'No campaigns'}
                      </strong>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45, marginTop: 4 }}>
                        {activeAdCount} active. Spend: ${totalAdSpend.toFixed(2)}
                      </p>
                    </div>
                    <button style={{ ...S.btnPrimary, ...S.btnSm, flexShrink: 0 }} onClick={() => setRunAdsOpen(true)}>Run Ads</button>
                  </div>
                </div>
              </div>

              <div style={S.section} className="dashboard-reveal">
                <div style={S.panelHeading}><span style={{ fontFamily: "'Newsreader', Georgia, serif" }}>Social</span></div>
                <div style={S.softPanel}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 13, color: 'var(--ink)', wordBreak: 'break-word' as const }}>@{company.slug ?? 'baljia'}</strong>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45, marginTop: 4 }}>No tweets yet. Run a Twitter task when you want to announce progress.</p>
                    </div>
                    <button style={{ ...S.btn, ...S.btnSm, opacity: 0.5, cursor: 'not-allowed', flexShrink: 0 }} disabled>Tweet</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DocumentSuggestionPanel companyId={company.id} />

          {docsSorted.length > 0 && (
          <div style={S.section} className="dashboard-reveal">
            <div style={S.panelHeading}><span style={{ fontFamily: "'Newsreader', Georgia, serif" }}>Files</span></div>
            {docsSorted.slice(0, 5).map(doc => (
              <button key={doc.id} style={{ ...S.docRow, gridTemplateColumns: '20px 1fr' }} onClick={() => setSelectedDoc(doc)}>
                <span style={{ color: '#D97706', fontSize: 14 }}>≡</span>
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block', fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title ?? doc.doc_type}</strong>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{formatAge(doc.updated_at ?? doc.created_at ?? null)}</span>
                </span>
              </button>
            ))}
          </div>
          )}

          {(sitePath || links.length > 0) && (
          <div style={S.section} className="dashboard-reveal">
            <div style={S.panelHeading}>
              <span style={{ fontFamily: "'Newsreader', Georgia, serif" }}>Quick links</span>
              <button style={{ ...S.btn, ...S.btnSm }} onClick={() => { setEditingLink(null); setAddLinkOpen(true); }}>+ Add</button>
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              {sitePath && <a href={sitePath} target="_blank" rel="noopener noreferrer" style={{ ...S.linkItem, textDecoration: 'none', color: 'var(--ink)' }}><strong>{company.name}</strong><span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{sitePath.replace(/^https?:\/\//, '')} ↗</span></a>}
              {links.map(link => (
                <button key={link.id} style={{ ...S.linkItem, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' as const }} onClick={() => { setEditingLink(link); setAddLinkOpen(true); }}>
                  <strong style={{ color: 'var(--ink)' }}>{link.label}</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{link.url.replace(/^https?:\/\//, '')}</span>
                </button>
              ))}
            </div>
          </div>
          )}
        </div>

        {/* ── Chat sidebar ── */}
        <FounderChatRail companyId={company.id} warnings={chatWarnings} onAction={handleChatAction} />
      </div>

      {/* ── Email viewer ── */}
      {selectedEmail && (
        <div style={S.emailModal} onClick={() => setSelectedEmail(null)}>
          <div style={{ width: '100%', maxWidth: 600, maxHeight: '80vh', overflow: 'hidden', borderRadius: 14, display: 'flex', flexDirection: 'column' as const, background: 'var(--bg-card)', border: '1px solid var(--line)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{selectedEmail.subject ?? '(no subject)'}</h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedEmail.direction === 'outbound' ? `To: ${selectedEmail.to_address}` : `From: ${selectedEmail.from_address ?? selectedEmail.to_address}`} · {formatAge(selectedEmail.created_at)}</p>
              </div>
              <button style={{ ...S.btn, ...S.btnSm }} onClick={() => setSelectedEmail(null)}>Close</button>
            </div>
            <div style={{ overflow: 'auto', padding: 20, flex: 1 }}>
              {selectedEmail.body ? <pre style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const, color: 'var(--ink)', margin: 0 }}>{selectedEmail.body}</pre>
                : <p style={{ fontSize: 13, color: 'var(--text-dim)', fontStyle: 'italic' }}>No message body stored.</p>}
            </div>
          </div>
        </div>
      )}

      {menuOpen && <DashboardMenu user={user} company={company} creditBalance={creditBalance} onClose={() => setMenuOpen(false)} onOpenUpgrade={() => { setMenuOpen(false); setUpgradeOpen(true); }} onOpenPurchase={() => { setMenuOpen(false); setPurchaseOpen(true); }} />}
      <TaskDetailDialog task={selectedTask} open={selectedTask !== null} onOpenChange={o => { if (!o) setSelectedTask(null); }} onApprove={handleApprove} onReject={handleReject} />
      <DocumentDialog doc={selectedDoc} onClose={() => setSelectedDoc(null)} companySlug={company.slug ?? undefined} />
      <PurchaseCreditsDialog open={purchaseOpen} onOpenChange={setPurchaseOpen} currentBalance={creditBalance} />
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} companyId={company.id} />
      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} companyId={company.id} onCreated={() => { void refreshDashboard(); }} />
      <RunAdsDialog open={runAdsOpen} onOpenChange={setRunAdsOpen} companyId={company.id} defaultPromotedItem={company.name} defaultLandingUrl={sitePath} companyOneLiner={company.one_liner} companyOriginalIdea={company.original_idea} onCreated={() => { void refreshDashboard(); }} />
      <PromoVideoDialog open={promoVideoOpen} onOpenChange={setPromoVideoOpen} companyId={company.id} defaultCta={`Try ${company.name}`} onCreated={(job) => { setPromoVideos(prev => [job, ...prev.filter(item => item.id !== job.id)]); void refreshDashboard(); }} />
      <RecurringTasksDialog open={recurringOpen} onOpenChange={setRecurringOpen} companyId={company.id} />
      <AddLinkDialog open={addLinkOpen} onOpenChange={o => { setAddLinkOpen(o); if (!o) setEditingLink(null); }} companyId={company.id} initialLabel={editingLink?.label} initialUrl={editingLink?.url} onSaved={() => { void refreshDashboard(); }} />
      {celebrateTask && <CelebrationOverlay taskTitle={celebrateTask.title} onDismiss={() => setCelebrateTask(null)} />}
    </div>
  );
}
