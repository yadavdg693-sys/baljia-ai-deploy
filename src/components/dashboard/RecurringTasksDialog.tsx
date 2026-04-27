'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RecurringTask } from '@/types';
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

interface RecurringTasksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}

type Cadence = 'daily' | 'weekly' | 'biweekly' | 'monthly';
type Mode = 'list' | 'create' | 'edit';

interface BudgetSummary {
  monthly_total: number;
  active_count?: number;
}

interface ListResponse {
  tasks: RecurringTask[];
  budget: BudgetSummary;
}

interface FormState {
  title: string;
  description: string;
  tag: string;
  cadence: Cadence;
}

const CADENCE_MONTHLY: Record<Cadence, number> = {
  daily: 30,
  weekly: 4,
  biweekly: 2,
  monthly: 1,
};

const CADENCE_OPTIONS: Array<{ value: Cadence; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
];

const cadenceVariants: Record<Cadence, 'default' | 'success' | 'planning' | 'running' | 'investigating'> = {
  daily: 'running',
  weekly: 'planning',
  biweekly: 'investigating',
  monthly: 'default',
};

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  tag: '',
  cadence: 'weekly',
};

export function RecurringTasksDialog({ open, onOpenChange, companyId }: RecurringTasksDialogProps) {
  const [mode, setMode] = useState<Mode>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<RecurringTask[]>([]);
  const [budget, setBudget] = useState<BudgetSummary>({ monthly_total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [originalForm, setOriginalForm] = useState<FormState>(EMPTY_FORM);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/recurring?companyId=${encodeURIComponent(companyId)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed to load' }));
        setError(typeof body.error === 'string' ? body.error : 'Could not load recurring tasks');
        return;
      }
      const data = (await res.json()) as ListResponse;
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setBudget(data.budget ?? { monthly_total: 0 });
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // Refetch whenever the dialog opens, and reset to list mode.
  useEffect(() => {
    if (open) {
      setMode('list');
      setSelectedId(null);
      setError(null);
      setForm(EMPTY_FORM);
      setOriginalForm(EMPTY_FORM);
      void fetchList();
    }
  }, [open, fetchList]);

  const activeCount = useMemo(
    () => tasks.filter((t) => t.is_active).length,
    [tasks],
  );

  const handleOpenCreate = () => {
    setSelectedId(null);
    setForm(EMPTY_FORM);
    setOriginalForm(EMPTY_FORM);
    setError(null);
    setMode('create');
  };

  const handleOpenEdit = (task: RecurringTask) => {
    const next: FormState = {
      title: task.title,
      description: task.description ?? '',
      tag: task.tag,
      cadence: task.cadence,
    };
    setSelectedId(task.id);
    setForm(next);
    setOriginalForm(next);
    setError(null);
    setMode('edit');
  };

  const handleBackToList = () => {
    setMode('list');
    setSelectedId(null);
    setForm(EMPTY_FORM);
    setOriginalForm(EMPTY_FORM);
    setError(null);
  };

  const handleTogglePauseResume = async (task: RecurringTask) => {
    setRowBusyId(task.id);
    setError(null);
    try {
      const res = await fetch(`/api/recurring/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !task.is_active }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Action failed' }));
        setError(typeof body.error === 'string' ? body.error : 'Could not update task');
        return;
      }
      await fetchList();
    } catch {
      setError('Network error — please try again');
    } finally {
      setRowBusyId(null);
    }
  };

  const handleDelete = async (task: RecurringTask) => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Delete recurring task "${task.title}"? This cannot be undone.`);
      if (!ok) return;
    }
    setRowBusyId(task.id);
    setError(null);
    try {
      const res = await fetch(`/api/recurring/${task.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Delete failed' }));
        setError(typeof body.error === 'string' ? body.error : 'Could not delete task');
        return;
      }
      await fetchList();
    } catch {
      setError('Network error — please try again');
    } finally {
      setRowBusyId(null);
    }
  };

  const validateForm = (): string | null => {
    if (!form.title.trim()) return 'Title is required';
    if (!form.tag.trim()) return 'Tag is required';
    return null;
  };

  const handleCreateSubmit = async () => {
    const v = validateForm();
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/recurring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          title: form.title.trim(),
          description: form.description.trim() ? form.description.trim() : undefined,
          tag: form.tag.trim(),
          cadence: form.cadence,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Create failed' }));
        setError(typeof body.error === 'string' ? body.error : 'Could not create task');
        return;
      }
      await fetchList();
      handleBackToList();
    } catch {
      setError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async () => {
    if (!selectedId) return;
    const v = validateForm();
    if (v) {
      setError(v);
      return;
    }

    // Build minimal diff — only send changed fields.
    const updates: Record<string, unknown> = {};
    const trimmedTitle = form.title.trim();
    const trimmedTag = form.tag.trim();
    const trimmedDescription = form.description.trim();
    const originalDescription = originalForm.description.trim();

    if (trimmedTitle !== originalForm.title.trim()) updates.title = trimmedTitle;
    if (trimmedTag !== originalForm.tag.trim()) updates.tag = trimmedTag;
    if (trimmedDescription !== originalDescription) updates.description = trimmedDescription;
    if (form.cadence !== originalForm.cadence) updates.cadence = form.cadence;

    if (Object.keys(updates).length === 0) {
      handleBackToList();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/recurring/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Update failed' }));
        setError(typeof body.error === 'string' ? body.error : 'Could not save task');
        return;
      }
      await fetchList();
      handleBackToList();
    } catch {
      setError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  const previewMonthly = CADENCE_MONTHLY[form.cadence];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h2 className="text-lg font-semibold">
                {mode === 'create' ? 'New recurring task' : mode === 'edit' ? 'Edit recurring task' : 'Recurring tasks'}
              </h2>
              {mode === 'list' && (
                <p className="text-sm text-text-muted mt-1">
                  Estimated ~{budget.monthly_total} credits/month across {activeCount} active task{activeCount === 1 ? '' : 's'}
                </p>
              )}
              {mode !== 'list' && (
                <p className="text-sm text-text-muted mt-1">
                  Tasks repeat automatically on the cadence you choose
                </p>
              )}
            </div>
            <DialogClose className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none">
              ✕
            </DialogClose>
          </div>
        </DialogHeader>

        <DialogBody>
          {error && (
            <div className="mb-4 rounded-lg border border-status-error/20 bg-status-error/10 px-3 py-2 text-sm text-status-error">
              {error}
            </div>
          )}

          {mode === 'list' && (
            <>
              {loading ? (
                <div className="py-12 text-center text-sm text-text-muted">Loading recurring tasks...</div>
              ) : tasks.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-text-secondary mb-1">No recurring tasks yet.</p>
                  <p className="text-xs text-text-muted mb-6">
                    Set up tasks that repeat — like a daily standup or weekly competitor scan.
                  </p>
                  <Button variant="primary" size="sm" onClick={handleOpenCreate}>
                    + New recurring
                  </Button>
                </div>
              ) : (
                <ul className="divide-y divide-border-default">
                  {tasks.map((task) => {
                    const busy = rowBusyId === task.id;
                    return (
                      <li key={task.id} className="py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`text-sm font-medium truncate ${task.is_active ? 'text-text-primary' : 'text-text-muted'}`}>
                              {task.title}
                            </p>
                            <Badge variant={cadenceVariants[task.cadence]} size="sm">
                              {task.cadence}
                            </Badge>
                            {!task.is_active && (
                              <Badge variant="default" size="sm">paused</Badge>
                            )}
                          </div>
                          <p className="text-xs text-text-muted mt-1">
                            ~{task.monthly_credits_estimate} credits/month · tag: {task.tag}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            isLoading={busy}
                            onClick={() => handleTogglePauseResume(task)}
                          >
                            {task.is_active ? 'Pause' : 'Resume'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => handleOpenEdit(task)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => handleDelete(task)}
                            className="text-status-error hover:bg-status-error/10"
                          >
                            Delete
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

          {(mode === 'create' || mode === 'edit') && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Weekly competitor scan"
                  maxLength={500}
                  className="w-full rounded-lg bg-surface-secondary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-baljia-gold focus:border-baljia-gold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                  Description (optional)
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What should the agent do each time?"
                  rows={3}
                  maxLength={5000}
                  className="w-full rounded-lg bg-surface-secondary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-baljia-gold focus:border-baljia-gold resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                    Tag
                  </label>
                  <input
                    type="text"
                    value={form.tag}
                    onChange={(e) => setForm({ ...form, tag: e.target.value })}
                    placeholder="research, twitter, ..."
                    maxLength={100}
                    className="w-full rounded-lg bg-surface-secondary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-baljia-gold focus:border-baljia-gold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                    Cadence
                  </label>
                  <select
                    value={form.cadence}
                    onChange={(e) => setForm({ ...form, cadence: e.target.value as Cadence })}
                    className="w-full rounded-lg bg-surface-secondary border border-border-default px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-baljia-gold focus:border-baljia-gold"
                  >
                    {CADENCE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-lg bg-surface-secondary p-3">
                <p className="text-xs text-text-muted mb-0.5">Estimated credits/month</p>
                <p className="text-sm font-medium text-text-primary">
                  ~{previewMonthly} credit{previewMonthly === 1 ? '' : 's'}/month
                </p>
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          {mode === 'list' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {tasks.length > 0 && (
                <Button variant="primary" size="sm" onClick={handleOpenCreate}>
                  + New recurring
                </Button>
              )}
            </>
          )}

          {mode === 'create' && (
            <>
              <Button variant="ghost" size="sm" disabled={submitting} onClick={handleBackToList}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" isLoading={submitting} onClick={handleCreateSubmit}>
                Create
              </Button>
            </>
          )}

          {mode === 'edit' && (
            <>
              <Button variant="ghost" size="sm" disabled={submitting} onClick={handleBackToList}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" isLoading={submitting} onClick={handleEditSubmit}>
                Save
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
