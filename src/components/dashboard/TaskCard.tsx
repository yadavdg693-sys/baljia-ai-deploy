'use client';

import { useState } from 'react';
import type { Task } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatRelativeTime, formatRunningTime } from '@/lib/utils';
import { FOUNDER_AGENT_LABELS } from '@/lib/founder-labels';


// Map priority integer → founder-facing label.
// Mirrors the create_task tool's enum: low(25), medium(50), high(75), critical(100).
// Medium returns null so we don't paint a pill on every default-priority task.
function priorityLabel(p: number | null | undefined): string | null {
  if (p === null || p === undefined) return null;
  if (p >= 90) return '🔥 critical';
  if (p >= 70) return '↑ high';
  if (p <= 30) return '↓ low';
  return null; // medium / unset → no badge
}

function priorityPillClass(p: number | null | undefined): string {
  if (p === null || p === undefined) return 'bg-surface-tertiary text-text-secondary';
  if (p >= 90) return 'bg-status-error/20 text-status-error';
  if (p >= 70) return 'bg-baljia-gold/20 text-baljia-gold';
  return 'bg-surface-tertiary text-text-muted';
}

// Drizzle returns numeric columns as strings on serialization. Accept both.
function formatHours(h: number | string): string {
  const n = typeof h === 'number' ? h : Number(h);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n % 1 === 0 ? `${n.toFixed(0)}h` : `${n.toFixed(1)}h`;
}

const statusVariants: Record<string, 'default' | 'success' | 'error' | 'warning' | 'running' | 'blocked' | 'planning'> = {
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

interface TaskCardProps {
  task: Task;
  onApprove?: (taskId: string) => void;
  onReject?: (taskId: string) => void;
  onReorder?: (taskId: string, queue_order: number) => void;
  onClick?: () => void;
}

export function TaskCard({ task, onApprove, onReject, onReorder, onClick }: TaskCardProps) {
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [movingTop, setMovingTop] = useState(false);
  const [movingUp, setMovingUp] = useState(false);
  const [movingDown, setMovingDown] = useState(false);

  const agentName = task.assigned_to_agent_id !== null
    ? FOUNDER_AGENT_LABELS[task.assigned_to_agent_id] ?? 'AI Team'
    : null;

  const currentOrder = task.queue_order ?? 0;
  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onApprove) return;
    setApproving(true);
    try { onApprove(task.id); } finally { setApproving(false); }
  };

  const handleReject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onReject) return;
    setRejecting(true);
    try { onReject(task.id); } finally { setRejecting(false); }
  };

  const handleRunNow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onApprove) return;
    setRunningNow(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/approve`, { method: 'POST' });
      if (res.ok) {
        onApprove(task.id);
      }
    } finally {
      setRunningNow(false);
    }
  };

  const patchQueueOrder = async (nextOrder: number) => {
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queue_order: nextOrder }),
    });
    if (res.ok && onReorder) {
      onReorder(task.id, nextOrder);
    }
  };

  const handleMoveToTop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMovingTop(true);
    try { await patchQueueOrder(0); } finally { setMovingTop(false); }
  };

  const handleMoveUp = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMovingUp(true);
    try { await patchQueueOrder(Math.max(0, currentOrder - 1)); } finally { setMovingUp(false); }
  };

  const handleMoveDown = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMovingDown(true);
    try { await patchQueueOrder(currentOrder + 1); } finally { setMovingDown(false); }
  };

  return (
    <div
      onClick={onClick}
      className="group min-h-[92px] p-3.5 rounded-[15px] bg-surface-secondary hover:bg-surface-hover border border-transparent transition-all duration-200 cursor-pointer flex flex-col overflow-hidden shadow-[0_8px_24px_rgba(24,18,10,0.07)]"
    >
      {/* Top row: Title + Status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm leading-tight font-semibold text-text-primary truncate group-hover:text-baljia-gold transition-colors">
            {task.title}
          </h4>
          {task.description && (
            <p className="text-xs leading-snug text-text-muted mt-0.5 line-clamp-2">{task.description}</p>
          )}
        </div>
        <Badge variant={statusVariants[task.status] ?? 'default'} size="sm">
          {task.status === 'todo' && task.authorized_by ? 'queued' : task.status.replace(/_/g, ' ')}
        </Badge>
      </div>

      {/* Progress bar for in_progress tasks */}
      {task.status === 'in_progress' && task.started_at && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span>{formatRunningTime(task.started_at)}</span>
            <span>Working...</span>
          </div>
          <div className="h-1 bg-surface-tertiary rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-baljia-gold to-baljia-gold-light rounded-full transition-all duration-500"
              style={{ width: `${Math.min((task.turn_count / task.max_turns) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Meta row: tag, agent, hours, priority, time */}
      <div className="flex items-center flex-wrap gap-1.5 mt-2">
        {/* Tag */}
        <span className="text-xs px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary">
          {task.tag}
        </span>

        {/* Agent */}
        {agentName && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary">
            🤖 {agentName}
          </span>
        )}

        {/* Estimated hours — surfaces splitting effort to the founder
            (per Polsia parity: "I'll split this 12h job into 3 ≤4h pieces").
            Drizzle returns numeric columns as strings; coerce + skip if missing. */}
        {task.estimated_hours !== null && task.estimated_hours !== undefined && (
          <span
            className="text-xs px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary"
            title="Estimated agent runtime"
          >
            ⏱ ~{formatHours(task.estimated_hours)}
          </span>
        )}

        {/* Priority — show explicit pill only for non-medium so the default
            doesn't visually clutter every card. */}
        {priorityLabel(task.priority) && (
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${priorityPillClass(task.priority)}`}
            title={`Priority ${task.priority}`}
          >
            {priorityLabel(task.priority)}
          </span>
        )}

        {/* Spacer + time */}
        <span className="flex-1" />
        <span className="text-xs text-text-muted">
          {formatRelativeTime(task.created_at)}
        </span>
      </div>

      {/* Approve/Reject/Reorder/RunNow buttons for tasks awaiting founder decision.
           Hidden once authorized_by is set — the task is launching, buttons would
           race the worker claim. */}
      {task.status === 'todo' && !task.authorized_by && (onApprove || onReject || onReorder) && (
        <div className="flex items-center gap-1 mt-2 pt-0">
          {onReject && (
            <Button
              variant="ghost"
              size="sm"
              isLoading={rejecting}
              onClick={handleReject}
              className="text-xs text-text-muted hover:text-status-error"
            >
              ✕ Reject
            </Button>
          )}

          {/* Reorder controls — pushed to the right edge */}
          {onReorder && (
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                isLoading={movingTop}
                onClick={handleMoveToTop}
                title="Move to top of queue"
                aria-label="Move to top of queue"
                className="!px-2 text-xs text-text-muted hover:text-baljia-gold"
              >
                ▲
              </Button>
              <Button
                variant="ghost"
                size="sm"
                isLoading={movingUp}
                onClick={handleMoveUp}
                title="Move up in queue"
                aria-label="Move up in queue"
                className="!px-2 text-xs text-text-muted hover:text-baljia-gold"
              >
                ↑
              </Button>
              <Button
                variant="ghost"
                size="sm"
                isLoading={movingDown}
                onClick={handleMoveDown}
                title="Move down in queue"
                aria-label="Move down in queue"
                className="!px-2 text-xs text-text-muted hover:text-baljia-gold"
              >
                ↓
              </Button>
            </div>
          )}

          {onApprove && (
            <Button
              variant="primary"
              size="sm"
              isLoading={runningNow}
              onClick={handleRunNow}
              title="Run this task immediately"
              className={`text-xs ${onReorder ? '' : 'ml-auto'}`}
            >
              ▶ Run Now
            </Button>
          )}
          {onApprove && (
            <Button
              variant="secondary"
              size="sm"
              isLoading={approving}
              onClick={handleApprove}
              className="text-xs"
            >
              ✓ Approve
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
