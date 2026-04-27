// Full task management view — 6 tabs, in-line description expansion.
// Polsia-light theme to match DashboardShell.tsx (white bg, Georgia serif headings,
// orange #ff7a16 accent). Mono-family timestamps via the .ts-mono helper below.

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Task } from '@/types';

interface RecurringRow {
  id: string;
  title: string;
  description: string | null;
  tag: string;
  cadence: string;
  priority: number;
  is_active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  monthly_credits_estimate: number | null;
  created_at: string;
}

interface TaskManagementBoardProps {
  companyId: string;
  companyName: string;
  tasks: Task[];
  recurring: RecurringRow[];
}

type TabKey = 'todo' | 'recurring' | 'in_progress' | 'completed' | 'rejected' | 'failed';

// 6 tabs in the order CLAUDE.md mandates.
const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'todo', label: 'To Do' },
  { key: 'recurring', label: 'Recurring' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'failed', label: 'Failed' },
] as const;

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  // Compact UTC-style output for the mono column, e.g. "2026-04-25 14:32".
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_LABEL: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  verifying: 'Verifying',
  completed: 'Completed',
  failed: 'Failed',
  failed_permanent: 'Failed (terminal)',
  rejected: 'Rejected',
  repair: 'Repair',
  blocked_pre_start: 'Blocked',
  blocked_in_run: 'Blocked',
};

function StatusPill({ status }: { status: string }) {
  // Color comes from background — we keep all pills the same shape and let
  // the bg distinguish them. Matches the .micro-pill pattern in polsia-shell.css.
  const tone =
    status === 'completed' ? { bg: '#e8f5e9', fg: '#1b5e20' } :
    status === 'in_progress' ? { bg: '#fff7ef', fg: '#ff7a16' } :
    status === 'failed' || status === 'failed_permanent' ? { bg: '#ffe5e5', fg: '#c62828' } :
    status === 'rejected' ? { bg: '#efefef', fg: '#6f6f6f' } :
    status === 'verifying' ? { bg: '#fff3cd', fg: '#7a5b00' } :
    { bg: '#f6f6f6', fg: '#333' };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        background: tone.bg,
        color: tone.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABEL[status] ?? status.replace(/_/g, ' ')}
    </span>
  );
}

export function TaskManagementBoard({ companyId, companyName, tasks, recurring }: TaskManagementBoardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('todo');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Group once per render. "Failed" rolls failed_permanent in per the CLAUDE.md spec.
  const grouped = useMemo(() => ({
    todo: tasks.filter((t) => t.status === 'todo'),
    in_progress: tasks.filter((t) => t.status === 'in_progress' || t.status === 'verifying'),
    completed: tasks.filter((t) => t.status === 'completed'),
    rejected: tasks.filter((t) => t.status === 'rejected'),
    failed: tasks.filter((t) => t.status === 'failed' || t.status === 'failed_permanent'),
  }), [tasks]);

  const counts: Record<TabKey, number> = {
    todo: grouped.todo.length,
    recurring: recurring.length,
    in_progress: grouped.in_progress.length,
    completed: grouped.completed.length,
    rejected: grouped.rejected.length,
    failed: grouped.failed.length,
  };

  const renderTaskList = (rows: Task[], emptyMsg: string) => {
    if (rows.length === 0) {
      return (
        <div className="tmb-empty">
          <p>{emptyMsg}</p>
        </div>
      );
    }
    return (
      <ul className="tmb-list">
        <li className="tmb-row tmb-row--head">
          <span className="tmb-col tmb-col--title">Title</span>
          <span className="tmb-col tmb-col--tag">Tag</span>
          <span className="tmb-col tmb-col--num">Cmplx</span>
          <span className="tmb-col tmb-col--num">Prio</span>
          <span className="tmb-col tmb-col--status">Status</span>
          <span className="tmb-col tmb-col--time">Created</span>
          <span className="tmb-col tmb-col--action" />
        </li>
        {rows.map((t) => {
          const isOpen = expandedIds.has(t.id);
          return (
            <li key={t.id} className={`tmb-row${isOpen ? ' is-open' : ''}`}>
              <button
                className="tmb-row__main"
                type="button"
                onClick={() => toggleExpanded(t.id)}
                aria-expanded={isOpen}
              >
                <span className="tmb-col tmb-col--title">
                  <strong>{t.title}</strong>
                </span>
                <span className="tmb-col tmb-col--tag">
                  <span className="tmb-pill">{t.tag}</span>
                </span>
                <span className="tmb-col tmb-col--num">{t.complexity ?? '—'}</span>
                <span className="tmb-col tmb-col--num">{t.priority}</span>
                <span className="tmb-col tmb-col--status">
                  <StatusPill status={t.status} />
                </span>
                <span className="tmb-col tmb-col--time ts-mono">{formatTs(t.created_at)}</span>
                <span className="tmb-col tmb-col--action">
                  <span className="text-link">{isOpen ? 'Hide' : 'View'}</span>
                </span>
              </button>
              {isOpen && (
                <div className="tmb-row__detail">
                  {t.description ? (
                    <p>{t.description}</p>
                  ) : (
                    <p className="tmb-row__detail--empty">No description provided.</p>
                  )}
                  <dl className="tmb-row__meta">
                    <div><dt>Source</dt><dd>{t.source ?? '—'}</dd></div>
                    <div><dt>Credits (est)</dt><dd>{t.estimated_credits ?? '—'}</dd></div>
                    <div><dt>Credits (actual)</dt><dd>{t.actual_credits_charged ?? 0}</dd></div>
                    <div><dt>Started</dt><dd className="ts-mono">{formatTs(t.started_at)}</dd></div>
                    <div><dt>Completed</dt><dd className="ts-mono">{formatTs(t.completed_at)}</dd></div>
                  </dl>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const renderRecurring = () => {
    if (recurring.length === 0) {
      return (
        <div className="tmb-empty">
          <p>No recurring tasks set up yet.</p>
        </div>
      );
    }
    return (
      <ul className="tmb-list">
        <li className="tmb-row tmb-row--head">
          <span className="tmb-col tmb-col--title">Title</span>
          <span className="tmb-col tmb-col--tag">Tag</span>
          <span className="tmb-col tmb-col--num">Cadence</span>
          <span className="tmb-col tmb-col--num">Prio</span>
          <span className="tmb-col tmb-col--status">Active</span>
          <span className="tmb-col tmb-col--time">Next run</span>
          <span className="tmb-col tmb-col--action" />
        </li>
        {recurring.map((r) => {
          const isOpen = expandedIds.has(r.id);
          return (
            <li key={r.id} className={`tmb-row${isOpen ? ' is-open' : ''}`}>
              <button
                className="tmb-row__main"
                type="button"
                onClick={() => toggleExpanded(r.id)}
                aria-expanded={isOpen}
              >
                <span className="tmb-col tmb-col--title"><strong>{r.title}</strong></span>
                <span className="tmb-col tmb-col--tag"><span className="tmb-pill">{r.tag}</span></span>
                <span className="tmb-col tmb-col--num">{r.cadence}</span>
                <span className="tmb-col tmb-col--num">{r.priority}</span>
                <span className="tmb-col tmb-col--status">
                  <StatusPill status={r.is_active ? 'completed' : 'rejected'} />
                </span>
                <span className="tmb-col tmb-col--time ts-mono">{formatTs(r.next_run_at)}</span>
                <span className="tmb-col tmb-col--action">
                  <span className="text-link">{isOpen ? 'Hide' : 'View'}</span>
                </span>
              </button>
              {isOpen && (
                <div className="tmb-row__detail">
                  {r.description ? <p>{r.description}</p> : <p className="tmb-row__detail--empty">No description provided.</p>}
                  <dl className="tmb-row__meta">
                    <div><dt>Last run</dt><dd className="ts-mono">{formatTs(r.last_run_at)}</dd></div>
                    <div><dt>Monthly est</dt><dd>{r.monthly_credits_estimate ?? '—'} cr</dd></div>
                    <div><dt>Created</dt><dd className="ts-mono">{formatTs(r.created_at)}</dd></div>
                  </dl>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  let body: React.ReactNode;
  switch (activeTab) {
    case 'todo':        body = renderTaskList(grouped.todo, 'Nothing queued. Message Baljia to add a task.'); break;
    case 'recurring':   body = renderRecurring(); break;
    case 'in_progress': body = renderTaskList(grouped.in_progress, 'Nothing running right now.'); break;
    case 'completed':   body = renderTaskList(grouped.completed, 'No completed tasks yet.'); break;
    case 'rejected':    body = renderTaskList(grouped.rejected, 'No rejected tasks.'); break;
    case 'failed':      body = renderTaskList(grouped.failed, 'No failures — everything ran cleanly.'); break;
  }

  return (
    <div className="dashboard-shell tmb-shell">
      <header className="dashboard-topbar">
        <div className="dashboard-topbar__title serif">Tasks — {companyName}</div>
        <div className="dashboard-topbar__actions">
          <Link className="chrome-button chrome-button--small" href={`/dashboard/${companyId}`}>
            ← Back to dashboard
          </Link>
        </div>
      </header>

      <div className="tmb-page">
        <nav className="tmb-tabs" role="tablist" aria-label="Task status">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                type="button"
                className={`tmb-tab${isActive ? ' is-active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <span>{tab.label}</span>
                <span className="tmb-tab__count">{counts[tab.key]}</span>
              </button>
            );
          })}
        </nav>

        <div className="tmb-body" role="tabpanel">
          {body}
        </div>
      </div>

      {/* Page-scoped styles so we don't bloat the global polsia-shell.css for a single view. */}
      <style jsx>{`
        .tmb-shell { background: #fff; min-height: 100vh; }
        .tmb-page {
          max-width: 1100px;
          margin: 0 auto;
          padding: 24px 20px 64px;
        }
        .tmb-tabs {
          display: flex;
          gap: 2px;
          border-bottom: 1px solid var(--line, #cfcfcf);
          margin-bottom: 18px;
          overflow-x: auto;
        }
        .tmb-tab {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 14px;
          border: 0;
          border-bottom: 2px solid transparent;
          background: transparent;
          color: #6f6f6f;
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
        }
        .tmb-tab:hover { color: #111; }
        .tmb-tab.is-active {
          color: #111;
          border-bottom-color: #ff7a16;
        }
        .tmb-tab__count {
          padding: 1px 7px;
          border-radius: 999px;
          background: #efefef;
          color: #555;
          font-size: 10px;
          font-weight: 700;
        }
        .tmb-tab.is-active .tmb-tab__count {
          background: #fff7ef;
          color: #ff7a16;
        }

        .tmb-list {
          list-style: none;
          margin: 0;
          padding: 0;
          border: 1px solid var(--line, #cfcfcf);
          border-radius: 4px;
          background: #fff;
          overflow: hidden;
        }
        .tmb-row { border-bottom: 1px solid #ececec; }
        .tmb-row:last-child { border-bottom: 0; }
        .tmb-row.is-open { background: #fafafa; }

        .tmb-row--head {
          background: #f6f6f6;
          font-size: 11px;
          font-weight: 700;
          color: #6f6f6f;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 8px 14px;
          display: grid;
          grid-template-columns: minmax(220px, 2fr) 110px 60px 60px 130px 140px 60px;
          gap: 10px;
          align-items: center;
        }

        .tmb-row__main {
          width: 100%;
          display: grid;
          grid-template-columns: minmax(220px, 2fr) 110px 60px 60px 130px 140px 60px;
          gap: 10px;
          align-items: center;
          padding: 12px 14px;
          background: transparent;
          border: 0;
          text-align: left;
          color: #111;
          font-size: 13px;
        }
        .tmb-row__main:hover { background: #fafafa; }

        .tmb-col { min-width: 0; }
        .tmb-col--title strong {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 600;
        }
        .tmb-col--num { font-size: 12px; color: #555; }
        .tmb-col--tag { overflow: hidden; }
        .tmb-col--time { font-size: 11px; color: #6f6f6f; }
        .tmb-col--action { text-align: right; }

        .tmb-pill {
          display: inline-block;
          max-width: 100%;
          padding: 2px 8px;
          border-radius: 4px;
          background: #f0f0f0;
          color: #555;
          font-size: 10px;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tmb-row__detail {
          padding: 4px 18px 16px 18px;
          color: #333;
          font-size: 13px;
          line-height: 1.55;
          border-top: 1px dashed #e0e0e0;
        }
        .tmb-row__detail p { margin: 12px 0 0; }
        .tmb-row__detail--empty { color: #999; font-style: italic; }

        .tmb-row__meta {
          margin: 14px 0 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 10px 18px;
        }
        .tmb-row__meta > div { display: flex; flex-direction: column; gap: 2px; }
        .tmb-row__meta dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #8b8b8b; }
        .tmb-row__meta dd { margin: 0; font-size: 12px; color: #222; }

        .ts-mono {
          font-family: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
          font-size: 11px;
        }

        .tmb-empty {
          padding: 48px 16px;
          text-align: center;
          color: #6f6f6f;
          border: 1px dashed var(--line, #cfcfcf);
          border-radius: 4px;
          background: #fafafa;
        }
        .tmb-empty p { font-size: 13px; }

        @media (max-width: 800px) {
          .tmb-row--head, .tmb-row__main {
            grid-template-columns: 1fr 100px 80px;
          }
          .tmb-col--num, .tmb-col--time, .tmb-col--action { display: none; }
        }
      `}</style>
    </div>
  );
}
