'use client';

import { useState, useEffect, useCallback, type ReactElement } from 'react';
import type { Task } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@/components/ui/Dialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatRelativeTime } from '@/lib/utils';
import { FOUNDER_AGENT_LABELS, FOUNDER_SOURCE_LABELS, FOUNDER_FAILURE_LABELS } from '@/lib/founder-labels';

interface TaskDetailDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove?: (taskId: string) => void;
  onReject?: (taskId: string) => void;
}

const statusVariants: Record<string, 'default' | 'success' | 'error' | 'running' | 'blocked' | 'planning' | 'warning'> = {
  todo: 'default',
  in_progress: 'running',
  verifying: 'planning',
  completed: 'success',
  failed: 'error',
  failed_permanent: 'error',
  rejected: 'error',
  blocked_pre_start: 'blocked',
  blocked_in_run: 'blocked',
  repair: 'warning',
};

// Agent labels imported from founder-labels.ts

// Execution timeline steps (SPEC-CTRL-102 lifecycle)
const TIMELINE_STEPS = [
  { status: 'todo', label: 'Queued', icon: '📝' },
  { status: 'in_progress', label: 'Running', icon: '⚡' },
  { status: 'verifying', label: 'Verifying', icon: '🔍' },
  { status: 'completed', label: 'Done', icon: '🎉' },
];

const STATUS_ORDER: Record<string, number> = {
  todo: 0, in_progress: 1, verifying: 2,
  completed: 3,
  failed: 3, failed_permanent: 3, rejected: -1,
  repair: 1, blocked_pre_start: 0, blocked_in_run: 1,
};

// ── Execution-log payload shape (matches /api/tasks/[taskId]/logs) ──
interface LogEvent {
  idx: number;
  event: string;
  timestamp: string | null;
  message: string | null;
}

interface LogsResponse {
  task_id: string;
  status: string;
  agent_name?: string | null;
  turn_count?: number;
  started_at?: string | null;
  completed_at?: string | null;
  events: LogEvent[];
  summary?: string;
}

// Reusable input class — mirrors ChatInput.tsx styling
const inputClass =
  'w-full bg-surface-secondary rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted border border-border-default focus:outline-none focus:border-border-active transition-colors disabled:opacity-50';

function TaskDescriptionBody({ description }: { description: string }) {
  const blocks: ReactElement[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-1.5 text-sm text-text-primary leading-relaxed">
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>,
    );
  };

  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushBullets();
      continue;
    }

    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      bullets.push(bulletMatch[1]);
      continue;
    }

    flushBullets();
    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm text-text-primary leading-relaxed">
        {line}
      </p>,
    );
  }

  flushBullets();

  if (blocks.length === 0) return null;
  return <div className="space-y-3">{blocks}</div>;
}

export function TaskDetailDialog({ task, open, onOpenChange, onApprove, onReject }: TaskDetailDialogProps) {
  const [loading, setLoading] = useState<'approve' | 'reject' | 'retry' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Edit mode state ──
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTag, setEditTag] = useState('');
  const [editPriority, setEditPriority] = useState<number>(50);

  // ── Execution log state ──
  const [logs, setLogs] = useState<LogsResponse | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsRequested, setLogsRequested] = useState(false);

  const fetchLogs = useCallback(async (taskId: string) => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/logs`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Could not load logs' }));
        setLogsError(body.error ?? 'Could not load logs');
        setLogs(null);
      } else {
        const data: LogsResponse = await res.json();
        setLogs(data);
      }
    } catch {
      setLogsError('Network error — could not load logs');
      setLogs(null);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  // Auto-load logs when dialog opens for a task that has executed; otherwise wait
  // for an explicit "Load logs" click. Resets edit mode + log state on task change.
  useEffect(() => {
    if (!task || !open) return;
    setIsEditing(false);
    setError(null);
    setLogs(null);
    setLogsError(null);
    setLogsRequested(false);
    if (task.started_at) {
      setLogsRequested(true);
      void fetchLogs(task.id);
    }
  }, [task, open, fetchLogs]);

  if (!task) return null;

  const currentStep = STATUS_ORDER[task.status] ?? 0;
  const isFailed = task.status === 'failed';
  const isRejected = task.status === 'rejected';
  const canEdit = task.status === 'todo';

  const enterEditMode = () => {
    setEditTitle(task.title);
    setEditDescription(task.description ?? '');
    setEditTag(task.tag);
    setEditPriority(task.priority);
    setError(null);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    setLoading('save');
    setError(null);
    // Build a diff payload of changed fields only
    const payload: Record<string, unknown> = {};
    if (editTitle.trim() && editTitle !== task.title) payload.title = editTitle.trim();
    if (editDescription !== (task.description ?? '')) payload.description = editDescription;
    if (editTag.trim() && editTag !== task.tag) payload.tag = editTag.trim();
    if (Number.isFinite(editPriority) && editPriority !== task.priority) {
      payload.priority = editPriority;
    }

    if (Object.keys(payload).length === 0) {
      setIsEditing(false);
      setLoading(null);
      return;
    }

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        onApprove?.(task.id); // reuses dashboard refresh hook
        setIsEditing(false);
      } else {
        const body = await res.json().catch(() => ({ error: 'Could not save changes' }));
        const errMsg =
          typeof body.error === 'string'
            ? body.error
            : body?.error?.formErrors?.[0] ?? 'Could not save changes';
        setError(errMsg);
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(null);
    }
  };

  const handleApprove = async () => {
    setLoading('approve');
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/approve`, { method: 'POST' });
      if (res.ok) {
        onApprove?.(task.id);
        onOpenChange(false);
      } else {
        const body = await res.json().catch(() => ({ error: 'Action failed' }));
        // 409 = approved but couldn't launch yet (slot busy, credits, etc.)
        if (res.status === 409 && body?.approved) {
          onApprove?.(task.id);
          onOpenChange(false);
        } else {
          setError(body.error ?? 'Could not approve task');
        }
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(null);
    }
  };

  const handleReject = async () => {
    setLoading('reject');
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/reject`, { method: 'POST' });
      if (res.ok) {
        onReject?.(task.id);
        onOpenChange(false);
      } else {
        const body = await res.json().catch(() => ({ error: 'Action failed' }));
        setError(body.error ?? 'Could not reject task');
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(null);
    }
  };

  const handleRetry = async () => {
    setLoading('retry');
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/retry`, { method: 'POST' });
      if (res.ok) {
        onApprove?.(task.id);
        onOpenChange(false);
      } else {
        const body = await res.json().catch(() => ({ error: 'Action failed' }));
        setError(body.error ?? 'Could not retry task');
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              {isEditing ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  maxLength={500}
                  className={inputClass}
                  aria-label="Edit task title"
                />
              ) : (
                <h2 className="text-lg font-semibold">{task.title}</h2>
              )}
              <p className="text-sm text-text-muted mt-1">{formatRelativeTime(task.created_at)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={statusVariants[task.status] ?? 'default'} size="sm">
                {task.status.replace(/_/g, ' ')}
              </Badge>
              {/* Edit toggle (only visible when status === 'todo') */}
              {canEdit && !isEditing && (
                <button
                  type="button"
                  onClick={enterEditMode}
                  className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-md hover:bg-surface-hover"
                  aria-label="Edit task"
                  title="Edit task"
                >
                  {/* Pencil icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              )}
              {!canEdit && task.status !== 'rejected' && (
                <span
                  className="text-text-muted/40 p-1 cursor-not-allowed"
                  title="Edit unavailable once a task is running"
                  aria-hidden="true"
                />
              )}
              <DialogClose className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none">
                ✕
              </DialogClose>
            </div>
          </div>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-5">
            {/* ── Execution Timeline ── */}
            {!isRejected && !isEditing && (
              <div className="flex items-center gap-0 py-2">
                {TIMELINE_STEPS.map((step, i) => {
                  const isCompleted = currentStep > i;
                  const isActive = currentStep === i;
                  const isFail = isFailed && i === 3;

                  return (
                    <div key={step.status} className="flex items-center flex-1">
                      {/* Step circle */}
                      <div className="flex flex-col items-center">
                        <div className={`
                          w-8 h-8 rounded-full flex items-center justify-center text-sm
                          transition-all duration-300
                          ${isCompleted
                            ? 'bg-status-success/20 text-status-success'
                            : isActive
                              ? 'bg-baljia-gold/20 text-baljia-gold ring-2 ring-baljia-gold/40'
                              : isFail
                                ? 'bg-status-error/20 text-status-error'
                                : 'bg-surface-tertiary text-text-muted'
                          }
                        `}>
                          {isFail ? '✕' : isCompleted ? '✓' : step.icon}
                        </div>
                        <span className={`text-xs mt-1.5 ${
                          isActive ? 'text-baljia-gold font-medium' : 'text-text-muted'
                        }`}>
                          {isFail ? 'Failed' : step.label}
                        </span>
                      </div>

                      {/* Connector line */}
                      {i < TIMELINE_STEPS.length - 1 && (
                        <div className={`
                          flex-1 h-0.5 mx-2 rounded-full
                          ${isCompleted ? 'bg-status-success/40' : 'bg-surface-tertiary'}
                        `} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Description ── */}
            {(isEditing || task.description) && (
              <div>
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Description</h3>
                {isEditing ? (
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    maxLength={5000}
                    rows={4}
                    className={`${inputClass} resize-y`}
                    aria-label="Edit task description"
                  />
                ) : (
                  <TaskDescriptionBody description={task.description ?? ''} />
                )}
              </div>
            )}

            {/* ── Metadata Grid ── */}
            <div className="grid grid-cols-2 gap-3">
              {/* Tag */}
              <div className="rounded-lg bg-surface-secondary p-3">
                <p className="text-xs text-text-muted mb-1">Tag</p>
                {isEditing ? (
                  <input
                    type="text"
                    value={editTag}
                    onChange={(e) => setEditTag(e.target.value)}
                    maxLength={100}
                    className={inputClass}
                    aria-label="Edit task tag"
                  />
                ) : (
                  <p className="text-sm font-medium capitalize">{task.tag}</p>
                )}
              </div>

              {/* Priority (editable) or Assigned To (view) */}
              {isEditing ? (
                <div className="rounded-lg bg-surface-secondary p-3">
                  <p className="text-xs text-text-muted mb-1">Priority (0-100)</p>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={editPriority}
                    onChange={(e) => setEditPriority(Number(e.target.value))}
                    className={inputClass}
                    aria-label="Edit task priority"
                  />
                </div>
              ) : (
                <div className="rounded-lg bg-surface-secondary p-3">
                  <p className="text-xs text-text-muted mb-1">Assigned To</p>
                  <p className="text-sm font-medium capitalize">
                    {task.assigned_to_agent_id !== null
                      ? FOUNDER_AGENT_LABELS[task.assigned_to_agent_id] ?? 'AI Team'
                      : '—'}
                  </p>
                </div>
              )}

              {/* Credits (read-only) */}
              <div className="rounded-lg bg-surface-secondary p-3">
                <p className="text-xs text-text-muted mb-1">Credits</p>
                <p className="text-sm font-medium capitalize">
                  {task.actual_credits_charged > 0
                    ? `${task.actual_credits_charged} used`
                    : `${task.estimated_credits} estimated`}
                </p>
              </div>

              {/* Source (read-only) */}
              <div className="rounded-lg bg-surface-secondary p-3">
                <p className="text-xs text-text-muted mb-1">Source</p>
                <p className="text-sm font-medium capitalize">
                  {FOUNDER_SOURCE_LABELS[task.source] ?? task.source.replace(/_/g, ' ')}
                </p>
              </div>
            </div>

            {/* ── Execution Log ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Execution Log
                </h3>
                {(logsRequested || task.started_at) && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogsRequested(true);
                      void fetchLogs(task.id);
                    }}
                    disabled={logsLoading}
                    className="text-xs text-baljia-gold hover:text-baljia-gold-light transition-colors disabled:opacity-50"
                  >
                    {logsLoading ? 'Loading…' : 'Reload'}
                  </button>
                )}
              </div>

              {!logsRequested && !task.started_at && (
                <button
                  type="button"
                  onClick={() => {
                    setLogsRequested(true);
                    void fetchLogs(task.id);
                  }}
                  className="text-xs text-baljia-gold hover:text-baljia-gold-light transition-colors"
                >
                  Load logs
                </button>
              )}

              {logsError && (
                <p className="text-xs text-status-error mt-1">{logsError}</p>
              )}

              {logsRequested && !logsError && (
                <>
                  {/* Header row with run metadata */}
                  {logs && (logs.agent_name || logs.turn_count || logs.started_at) && (
                    <div className="rounded-lg bg-surface-secondary p-3 mb-2 grid grid-cols-2 gap-3 text-xs">
                      {logs.agent_name && (
                        <div>
                          <p className="text-text-muted mb-0.5">Agent</p>
                          <p className="text-text-primary font-medium">{logs.agent_name}</p>
                        </div>
                      )}
                      {typeof logs.turn_count === 'number' && (
                        <div>
                          <p className="text-text-muted mb-0.5">Turns</p>
                          <p className="text-text-primary font-medium">{logs.turn_count}</p>
                        </div>
                      )}
                      {logs.started_at && (
                        <div>
                          <p className="text-text-muted mb-0.5">Started</p>
                          <p className="text-text-primary font-medium">{formatRelativeTime(logs.started_at)}</p>
                        </div>
                      )}
                      {logs.completed_at && (
                        <div>
                          <p className="text-text-muted mb-0.5">Completed</p>
                          <p className="text-text-primary font-medium">{formatRelativeTime(logs.completed_at)}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {logsLoading && !logs && (
                    <p className="text-xs text-text-muted italic">Loading logs…</p>
                  )}

                  {logs && logs.events.length === 0 && (
                    <p className="text-xs text-text-muted italic">
                      No execution logs yet — they&apos;ll appear after the task runs.
                    </p>
                  )}

                  {logs && logs.events.length > 0 && (
                    <ol className="space-y-1.5 text-xs">
                      {logs.events.map((evt) => (
                        <li
                          key={evt.idx}
                          className="rounded-md bg-surface-secondary px-3 py-2 flex gap-3"
                        >
                          <span className="text-text-muted font-mono shrink-0">{evt.idx + 1}.</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-text-primary font-medium capitalize">
                                {evt.event.replace(/_/g, ' ')}
                              </span>
                              {evt.timestamp && (
                                <span className="text-text-muted shrink-0">
                                  {formatRelativeTime(evt.timestamp)}
                                </span>
                              )}
                            </div>
                            {evt.message && (
                              <p className="text-text-secondary mt-0.5 break-words">{evt.message}</p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
            </div>

            {/* ── Refund / Failure info ── */}
            {task.failure_class && (
              <div className="rounded-lg bg-status-error/5 border border-status-error/20 p-3">
                <p className="text-xs text-status-error font-medium mb-1">Failure: {FOUNDER_FAILURE_LABELS[task.failure_class] ?? 'System error'}</p>
                <p className="text-xs text-text-muted">This task failed and consumed 1 credit. You can retry it below.</p>
              </div>
            )}

            {/* ── Suggestion reasoning ── */}
            {task.suggestion_reasoning && !isEditing && (
              <div>
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Why This Task</h3>
                <p className="text-sm text-text-primary">{task.suggestion_reasoning}</p>
              </div>
            )}

            {/* ── Timing ── */}
            {task.started_at && !isEditing && (
              <div className="rounded-lg bg-surface-secondary p-3">
                <p className="text-xs text-text-muted mb-1">Timing</p>
                <p className="text-sm">
                  Started: {formatRelativeTime(task.started_at)}
                  {task.completed_at && ` · Completed: ${formatRelativeTime(task.completed_at)}`}
                </p>
                {task.status === 'in_progress' && (
                  <p className="text-xs text-status-running mt-1">
                    In progress...
                  </p>
                )}
              </div>
            )}
          </div>
        </DialogBody>

        {/* ── Error feedback ── */}
        {error && (
          <div className="px-4 py-2 text-sm text-red-400 bg-red-500/10 rounded-lg">
            {error}
          </div>
        )}

        {/* ── Actions (footer states: todo+view, todo+edit, failed, all-other) ── */}
        <DialogFooter>
          {/* State 2: todo + edit mode → Cancel + Save */}
          {isEditing && task.status === 'todo' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelEdit}
                disabled={loading === 'save'}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                isLoading={loading === 'save'}
                onClick={handleSave}
              >
                Save
              </Button>
            </>
          )}

          {/* State 1: todo + view mode → Reject + Approve */}
          {!isEditing && task.status === 'todo' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                isLoading={loading === 'reject'}
                onClick={handleReject}
              >
                Reject
              </Button>
              <Button
                variant="primary"
                size="sm"
                isLoading={loading === 'approve'}
                onClick={handleApprove}
              >
                Approve Task
              </Button>
            </>
          )}

          {/* State 3: failed → Retry */}
          {!isEditing && task.status === 'failed' && (
            <Button
              variant="primary"
              size="sm"
              isLoading={loading === 'retry'}
              onClick={handleRetry}
            >
              ↻ Retry Task
            </Button>
          )}

          {/* State 4: in_progress / verifying / completed / rejected / etc. → no buttons */}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
