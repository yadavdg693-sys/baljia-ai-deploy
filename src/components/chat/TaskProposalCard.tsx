'use client';

import { useState, useCallback } from 'react';
import type { TaskProposal } from '@/types';

interface TaskProposalCardProps {
  proposal: TaskProposal;
}

export function TaskProposalCard({ proposal }: TaskProposalCardProps) {
  const [status, setStatus] = useState<'pending' | 'approving' | 'rejecting' | 'approved' | 'rejected'>('pending');

  const handleApprove = useCallback(async () => {
    setStatus('approving');
    try {
      const res = await fetch(`/api/tasks/${proposal.task_id}/approve`, { method: 'POST' });
      if (res.ok) {
        setStatus('approved');
      } else {
        setStatus('pending');
      }
    } catch {
      setStatus('pending');
    }
  }, [proposal.task_id]);

  const handleReject = useCallback(async () => {
    setStatus('rejecting');
    try {
      const res = await fetch(`/api/tasks/${proposal.task_id}/reject`, { method: 'POST' });
      if (res.ok) {
        setStatus('rejected');
      } else {
        setStatus('pending');
      }
    } catch {
      setStatus('pending');
    }
  }, [proposal.task_id]);

  return (
    <div className="rounded-lg bg-surface-secondary border border-baljia-gold/30 p-3 my-2 animate-slide-up" id={`task-proposal-${proposal.task_id}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-baljia-gold text-xs">📋</span>
        <span className="text-xs font-semibold text-baljia-gold uppercase tracking-wider">Task Proposal</span>
      </div>

      {/* Task details */}
      <h4 className="font-semibold text-sm text-text-primary mb-1">{proposal.title}</h4>
      {proposal.description && (
        <p className="text-xs text-text-muted mb-2 line-clamp-3">{proposal.description}</p>
      )}

      {/* Meta tags */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-surface-primary text-text-secondary border border-border-default">
          {proposal.tag}
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-baljia-gold/20 text-baljia-gold border border-baljia-gold/30">
          {proposal.estimated_credits} credit{proposal.estimated_credits !== 1 ? 's' : ''}
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-surface-primary text-text-muted border border-border-default">
          🤖 {proposal.agent_name}
        </span>
      </div>

      {/* Explanation */}
      <p className="text-xs text-text-muted mb-3 italic">{proposal.explanation}</p>

      {/* Actions */}
      {status === 'pending' && (
        <div className="flex gap-2">
          <button
            onClick={handleApprove}
            className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-md text-xs font-semibold transition-colors"
            id={`approve-task-${proposal.task_id}`}
          >
            ✓ Approve
          </button>
          <button
            onClick={handleReject}
            className="flex-1 px-3 py-1.5 bg-surface-primary hover:bg-red-500/20 text-text-secondary hover:text-red-400 rounded-md text-xs font-semibold border border-border-default transition-colors"
            id={`reject-task-${proposal.task_id}`}
          >
            ✕ Reject
          </button>
        </div>
      )}

      {status === 'approving' && (
        <div className="text-center py-1.5 text-xs text-text-muted animate-pulse">Approving...</div>
      )}
      {status === 'rejecting' && (
        <div className="text-center py-1.5 text-xs text-text-muted animate-pulse">Rejecting...</div>
      )}
      {status === 'approved' && (
        <div className="text-center py-1.5 text-xs text-green-400 font-medium">✓ Task approved — added to your queue</div>
      )}
      {status === 'rejected' && (
        <div className="text-center py-1.5 text-xs text-text-muted">Task rejected</div>
      )}
    </div>
  );
}
