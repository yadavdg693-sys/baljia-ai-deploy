'use client';

import { useState } from 'react';
import type { Task } from '@/types';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { TaskCard } from './TaskCard';

interface TaskBoardProps {
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  onApprove?: (taskId: string) => void;
  onReject?: (taskId: string) => void;
}

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'created', label: 'Pending' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'Running' },
  { value: 'completed_verified', label: 'Done' },
  { value: 'failed', label: 'Failed' },
] as const;

const EMPTY_STATES: Record<string, { icon: string; message: string }> = {
  all: { icon: '📋', message: 'No tasks yet. Chat with the CEO to get started!' },
  created: { icon: '⏳', message: 'No tasks waiting for approval.' },
  todo: { icon: '📝', message: 'No tasks queued. Approve pending tasks to add them.' },
  in_progress: { icon: '⚡', message: 'Nothing running right now.' },
  completed_verified: { icon: '🎉', message: 'No completed tasks yet. They\'ll show up here.' },
  failed: { icon: '✅', message: 'No failed tasks. Everything\'s running smoothly!' },
};

export function TaskBoard({ tasks, onTaskClick, onApprove, onReject }: TaskBoardProps) {
  const [activeTab, setActiveTab] = useState('all');

  const filterTasks = (status: string) =>
    tasks.filter((t) => (status === 'all' ? true : t.status === status));

  // Count pending tasks that need attention
  const pendingCount = filterTasks('created').length;
  const runningCount = filterTasks('in_progress').length;
  const totalCreditsUsed = tasks.reduce((sum, t) => sum + t.actual_credits_charged, 0);

  return (
    <div className="rounded-xl bg-surface-card border border-border-default overflow-hidden">
      {/* Summary bar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-border-subtle bg-surface-secondary/50">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Total</span>
          <span className="text-sm font-semibold text-text-primary">{tasks.length}</span>
        </div>
        {pendingCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-status-planning animate-pulse" />
            <span className="text-xs text-status-planning font-medium">{pendingCount} pending</span>
          </div>
        )}
        {runningCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-status-running animate-pulse" />
            <span className="text-xs text-status-running font-medium">{runningCount} running</span>
          </div>
        )}
        <span className="flex-1" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Credits used</span>
          <span className="text-sm font-semibold text-baljia-gold">{totalCreditsUsed}</span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="rounded-none">
          {STATUS_TABS.map((tab) => {
            const count = filterTasks(tab.value).length;
            return (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
                {count > 0 && (
                  <span className="ml-1.5 text-xs opacity-70">({count})</span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {STATUS_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="p-4">
            <div className="space-y-2">
              {filterTasks(tab.value).length === 0 ? (
                <div className="text-center py-12">
                  <span className="text-3xl block mb-3">
                    {EMPTY_STATES[tab.value]?.icon ?? '📋'}
                  </span>
                  <p className="text-sm text-text-muted">
                    {EMPTY_STATES[tab.value]?.message ?? 'No tasks here.'}
                  </p>
                </div>
              ) : (
                filterTasks(tab.value).map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() => onTaskClick?.(task)}
                    onApprove={task.status === 'created' ? onApprove : undefined}
                    onReject={task.status === 'created' ? onReject : undefined}
                  />
                ))
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
