'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** Called after successful creation so the parent can refetch tasks. */
  onCreated?: (task: { id: string; title: string }) => void;
}

const TITLE_MAX = 500;
const DESCRIPTION_MAX = 5000;
const TAG_MAX = 100;

export function NewTaskDialog({ open, onOpenChange, companyId, onCreated }: NewTaskDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tag, setTag] = useState('');
  const [priority, setPriority] = useState<number>(50);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const trimmedTag = tag.trim();
  const canSubmit = trimmedTitle.length > 0 && trimmedTag.length > 0 && !submitting;

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setTag('');
    setPriority(50);
    setError(null);
  };

  const handleClose = (next: boolean) => {
    if (!next) {
      resetForm();
    }
    onOpenChange(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        company_id: companyId,
        title: trimmedTitle,
        tag: trimmedTag,
        priority,
        source: 'founder_requested',
      };
      const trimmedDescription = description.trim();
      if (trimmedDescription.length > 0) {
        body.description = trimmedDescription;
      }

      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 201) {
        const created = (await res.json().catch(() => null)) as
          | { id: string; title: string }
          | null;
        if (created && typeof created.id === 'string') {
          onCreated?.({ id: created.id, title: created.title ?? trimmedTitle });
        }
        resetForm();
        onOpenChange(false);
        return;
      }

      if (res.status === 400) {
        setError('Could not create — check your inputs');
      } else if (res.status === 401 || res.status === 403) {
        setError("You're not authorized to create a task");
      } else {
        setError('Could not create task — please try again');
      }
    } catch {
      setError('Could not create task — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <h2 className="text-lg font-semibold">New Task</h2>
                <p className="text-sm text-text-muted mt-1">
                  Create a task for your AI team to pick up.
                </p>
              </div>
              <DialogClose
                type="button"
                className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none"
                aria-label="Close"
              >
                ✕
              </DialogClose>
            </div>
          </DialogHeader>

          <DialogBody>
            <div className="space-y-5">
              {error && (
                <div className="px-3 py-2 text-sm text-red-400 bg-red-500/10 rounded-lg">
                  {error}
                </div>
              )}

              {/* Title */}
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <label htmlFor="new-task-title" className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                    Title
                  </label>
                  <span className="text-xs text-text-muted">
                    {title.length}/{TITLE_MAX}
                  </span>
                </div>
                <input
                  id="new-task-title"
                  type="text"
                  autoFocus
                  required
                  maxLength={TITLE_MAX}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ship the v1 landing page"
                  className="w-full rounded-lg bg-surface-secondary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-baljia-gold/40 focus:border-baljia-gold/60"
                />
              </div>

              {/* Description */}
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <label htmlFor="new-task-description" className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                    Description <span className="text-text-muted normal-case font-normal">(optional)</span>
                  </label>
                  <span className="text-xs text-text-muted">
                    {description.length}/{DESCRIPTION_MAX}
                  </span>
                </div>
                <textarea
                  id="new-task-description"
                  rows={4}
                  maxLength={DESCRIPTION_MAX}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does success look like? Any context the AI team should know?"
                  className="w-full rounded-lg bg-surface-secondary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-baljia-gold/40 focus:border-baljia-gold/60 resize-y"
                />
              </div>

              {/* Tag */}
              <div>
                <label htmlFor="new-task-tag" className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 block">
                  Tag
                </label>
                <input
                  id="new-task-tag"
                  type="text"
                  required
                  maxLength={TAG_MAX}
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder="landing-page"
                  className="w-full rounded-lg bg-surface-secondary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-baljia-gold/40 focus:border-baljia-gold/60"
                />
                <p className="text-xs text-text-muted mt-1.5">
                  e.g. landing-page, research, email, tweet, bug
                </p>
              </div>

              {/* Priority */}
              <div>
                <label htmlFor="new-task-priority" className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 block">
                  Priority <span className="text-text-muted normal-case font-normal">(optional)</span>
                </label>
                <input
                  id="new-task-priority"
                  type="number"
                  min={0}
                  max={100}
                  value={priority}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isNaN(next)) {
                      setPriority(50);
                    } else {
                      setPriority(Math.max(0, Math.min(100, Math.round(next))));
                    }
                  }}
                  className="w-32 rounded-lg bg-surface-secondary border border-border-default px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40 focus:border-baljia-gold/60"
                />
                <p className="text-xs text-text-muted mt-1.5">
                  0 = low, 100 = highest
                </p>
              </div>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleClose(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={submitting}
              disabled={!canSubmit}
            >
              Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
