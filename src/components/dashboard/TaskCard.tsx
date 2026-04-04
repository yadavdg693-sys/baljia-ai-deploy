'use client';

import { useState } from 'react';
import type { Task } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatRelativeTime, formatRunningTime } from '@/lib/utils';

// Agent names by ID — matches DB seed (Domain 2.1)
const AGENT_NAMES: Record<number, string> = {
  0: 'CEO', 29: 'Research', 30: 'Engineering', 32: 'Support',
  33: 'Data', 40: 'Twitter', 41: 'MetaAds', 42: 'Browser', 54: 'ColdOutreach',
};

// Execution mode display
const MODE_LABELS: Record<string, { label: string; color: string }> = {
  deterministic: { label: 'Auto', color: 'text-status-success' },
  template_plus_params: { label: 'Template', color: 'text-status-planning' },
  full_agent: { label: 'Agent', color: 'text-status-running' },
};

const statusVariants: Record<string, 'default' | 'success' | 'error' | 'warning' | 'running' | 'blocked' | 'planning'> = {
  created: 'planning',
  todo: 'default',
  in_progress: 'running',
  completed_verified: 'success',
  completed_unverified: 'success',
  failed: 'error',
  rejected: 'error',
  blocked: 'blocked',
  partial: 'warning',
};

interface TaskCardProps {
  task: Task;
  onApprove?: (taskId: string) => void;
  onReject?: (taskId: string) => void;
  onClick?: () => void;
}

export function TaskCard({ task, onApprove, onReject, onClick }: TaskCardProps) {
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const agentName = task.assigned_to_agent_id !== null
    ? AGENT_NAMES[task.assigned_to_agent_id] ?? 'Unknown'
    : null;

  const modeInfo = task.execution_mode ? MODE_LABELS[task.execution_mode] : null;

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

  return (
    <div
      onClick={onClick}
      className="group p-4 rounded-xl bg-surface-secondary hover:bg-surface-hover border border-transparent hover:border-border-default transition-all duration-200 cursor-pointer"
    >
      {/* Top row: Title + Status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-text-primary truncate group-hover:text-baljia-gold transition-colors">
            {task.title}
          </h4>
          {task.description && (
            <p className="text-xs text-text-muted mt-1 line-clamp-2">{task.description}</p>
          )}
        </div>
        <Badge variant={statusVariants[task.status] ?? 'default'} size="sm">
          {task.status.replace(/_/g, ' ')}
        </Badge>
      </div>

      {/* Progress bar for in_progress tasks */}
      {task.status === 'in_progress' && task.started_at && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span>{formatRunningTime(task.started_at)}</span>
            <span>Turn {task.turn_count}/{task.max_turns}</span>
          </div>
          <div className="h-1.5 bg-surface-tertiary rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-baljia-gold to-baljia-gold-light rounded-full transition-all duration-500"
              style={{ width: `${Math.min((task.turn_count / task.max_turns) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Meta row: tag, agent, mode, credits, time */}
      <div className="flex items-center flex-wrap gap-2 mt-3">
        {/* Tag */}
        <span className="text-xs px-2 py-0.5 rounded-md bg-surface-tertiary text-text-secondary">
          {task.tag}
        </span>

        {/* Agent */}
        {agentName && (
          <span className="text-xs px-2 py-0.5 rounded-md bg-surface-tertiary text-text-secondary">
            🤖 {agentName}
          </span>
        )}

        {/* Execution mode */}
        {modeInfo && (
          <span className={`text-xs font-medium ${modeInfo.color}`}>
            {modeInfo.label}
          </span>
        )}

        {/* Credit cost */}
        <span className="text-xs text-baljia-gold font-medium">
          {task.estimated_credits} cr
        </span>

        {/* Spacer + time */}
        <span className="flex-1" />
        <span className="text-xs text-text-muted">
          {formatRelativeTime(task.created_at)}
        </span>
      </div>

      {/* Approve/Reject buttons for tasks awaiting founder decision */}
      {task.status === 'created' && (onApprove || onReject) && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border-subtle">
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
          {onApprove && (
            <Button
              variant="primary"
              size="sm"
              isLoading={approving}
              onClick={handleApprove}
              className="text-xs ml-auto"
            >
              ✓ Approve
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
