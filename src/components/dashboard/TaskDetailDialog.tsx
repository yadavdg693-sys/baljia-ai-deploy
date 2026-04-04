'use client';

import { useState } from 'react';
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

interface TaskDetailDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove?: (taskId: string) => void;
  onReject?: (taskId: string) => void;
}

const statusVariants: Record<string, 'default' | 'success' | 'error' | 'running' | 'blocked' | 'planning' | 'warning'> = {
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

const AGENT_NAMES: Record<number, string> = {
  0: 'CEO', 29: 'Research', 30: 'Engineering', 32: 'Support',
  33: 'Data', 40: 'Twitter', 41: 'MetaAds', 42: 'Browser', 54: 'ColdOutreach',
};

// Execution timeline steps
const TIMELINE_STEPS = [
  { status: 'created', label: 'Proposed', icon: '📝' },
  { status: 'todo', label: 'Approved', icon: '✓' },
  { status: 'in_progress', label: 'Running', icon: '⚡' },
  { status: 'completed_verified', label: 'Done', icon: '🎉' },
];

const STATUS_ORDER: Record<string, number> = {
  created: 0, todo: 1, in_progress: 2,
  completed_verified: 3, completed_unverified: 3,
  failed: 3, rejected: -1,
};

export function TaskDetailDialog({ task, open, onOpenChange, onApprove, onReject }: TaskDetailDialogProps) {
  const [loading, setLoading] = useState<'approve' | 'reject' | 'retry' | null>(null);

  if (!task) return null;

  const currentStep = STATUS_ORDER[task.status] ?? 0;
  const isFailed = task.status === 'failed';
  const isRejected = task.status === 'rejected';

  const handleApprove = async () => {
    setLoading('approve');
    try {
      const res = await fetch(`/api/tasks/${task.id}/approve`, { method: 'POST' });
      if (res.ok) {
        onApprove?.(task.id);
        onOpenChange(false);
      }
    } finally {
      setLoading(null);
    }
  };

  const handleReject = async () => {
    setLoading('reject');
    try {
      const res = await fetch(`/api/tasks/${task.id}/reject`, { method: 'POST' });
      if (res.ok) {
        onReject?.(task.id);
        onOpenChange(false);
      }
    } finally {
      setLoading(null);
    }
  };

  const handleRetry = async () => {
    setLoading('retry');
    try {
      // Reset to todo status — will be picked up by worker launcher
      const res = await fetch(`/api/tasks/${task.id}/approve`, { method: 'POST' });
      if (res.ok) {
        onOpenChange(false);
      }
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
              <h2 className="text-lg font-semibold">{task.title}</h2>
              <p className="text-sm text-text-muted mt-1">{formatRelativeTime(task.created_at)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={statusVariants[task.status] ?? 'default'} size="sm">
                {task.status.replace(/_/g, ' ')}
              </Badge>
              <DialogClose className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none">
                ✕
              </DialogClose>
            </div>
          </div>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-5">
            {/* ── Execution Timeline ── */}
            {!isRejected && (
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
            {task.description && (
              <div>
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Description</h3>
                <p className="text-sm text-text-primary leading-relaxed">{task.description}</p>
              </div>
            )}

            {/* ── Metadata Grid ── */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Tag', value: task.tag },
                { label: 'Agent', value: task.assigned_to_agent_id !== null ? AGENT_NAMES[task.assigned_to_agent_id] ?? 'Unknown' : '—' },
                { label: 'Credits', value: task.actual_credits_charged > 0 ? `${task.actual_credits_charged} used` : `${task.estimated_credits} estimated` },
                { label: 'Execution Mode', value: task.execution_mode?.replace(/_/g, ' ') ?? '—' },
                { label: 'Verification', value: task.verification_level?.replace(/_/g, ' ') ?? '—' },
                { label: 'Source', value: task.source.replace(/_/g, ' ') },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-surface-secondary p-3">
                  <p className="text-xs text-text-muted mb-1">{label}</p>
                  <p className="text-sm font-medium capitalize">{value}</p>
                </div>
              ))}
            </div>

            {/* ── Refund / Failure info ── */}
            {task.failure_class && (
              <div className="rounded-lg bg-status-error/5 border border-status-error/20 p-3">
                <p className="text-xs text-status-error font-medium mb-1">Failure: {task.failure_class.replace(/_/g, ' ')}</p>
                <p className="text-xs text-text-muted">This task failed and consumed 1 credit. You can retry it below.</p>
              </div>
            )}

            {/* ── Suggestion reasoning ── */}
            {task.suggestion_reasoning && (
              <div>
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Why This Task</h3>
                <p className="text-sm text-text-primary">{task.suggestion_reasoning}</p>
              </div>
            )}

            {/* ── Timing ── */}
            {task.started_at && (
              <div className="rounded-lg bg-surface-secondary p-3">
                <p className="text-xs text-text-muted mb-1">Timing</p>
                <p className="text-sm">
                  Started: {formatRelativeTime(task.started_at)}
                  {task.completed_at && ` · Completed: ${formatRelativeTime(task.completed_at)}`}
                </p>
                {task.status === 'in_progress' && (
                  <p className="text-xs text-status-running mt-1">
                    Turn {task.turn_count} / {task.max_turns}
                  </p>
                )}
              </div>
            )}
          </div>
        </DialogBody>

        {/* ── Actions ── */}
        <DialogFooter>
          {/* Approve/reject for created tasks */}
          {task.status === 'created' && (
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

          {/* Retry for failed tasks */}
          {task.status === 'failed' && (
            <Button
              variant="primary"
              size="sm"
              isLoading={loading === 'retry'}
              onClick={handleRetry}
            >
              ↻ Retry Task
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
