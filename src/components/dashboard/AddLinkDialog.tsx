'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

interface AddLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** Optional initial values for editing an existing link by label. */
  initialLabel?: string;
  initialUrl?: string;
  /** Fired after a successful upsert so the parent re-fetches the link list. */
  onSaved?: () => void;
}

export function AddLinkDialog({
  open,
  onOpenChange,
  companyId,
  initialLabel,
  initialUrl,
  onSaved,
}: AddLinkDialogProps) {
  const isEditing = Boolean(initialLabel);

  const [label, setLabel] = useState<string>(initialLabel ?? '');
  const [url, setUrl] = useState<string>(initialUrl ?? '');
  const [loading, setLoading] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset form state when dialog opens (false → true), so reopening with
  // different initial values shows the right values.
  useEffect(() => {
    if (open) {
      setLabel(initialLabel ?? '');
      setUrl(initialUrl ?? '');
      setError(null);
      setLoading(null);
    }
  }, [open, initialLabel, initialUrl]);

  const validate = (): string | null => {
    const trimmedLabel = label.trim();
    const trimmedUrl = url.trim();
    if (!trimmedLabel) return 'Label is required';
    if (trimmedLabel.length > 100) return 'Label must be 100 characters or fewer';
    if (!trimmedUrl) return 'URL is required';
    if (trimmedUrl.length > 500) return 'URL must be 500 characters or fewer';
    try {
      new URL(trimmedUrl);
    } catch {
      return 'Invalid URL';
    }
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading('save');
    setError(null);
    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          label: label.trim(),
          url: url.trim(),
        }),
      });

      if (res.ok) {
        onSaved?.();
        onOpenChange(false);
      } else {
        const body = await res.json().catch(() => ({ error: 'Could not save link' }));
        const message =
          typeof body?.error === 'string'
            ? body.error
            : 'Could not save link — please try again';
        setError(message);
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!initialLabel) return;
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Delete link "${initialLabel}"?`);
      if (!ok) return;
    }

    setLoading('delete');
    setError(null);
    try {
      const params = new URLSearchParams({
        company_id: companyId,
        label: initialLabel,
      });
      const res = await fetch(`/api/links?${params.toString()}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        onSaved?.();
        onOpenChange(false);
      } else {
        const body = await res.json().catch(() => ({ error: 'Could not delete link' }));
        const message =
          typeof body?.error === 'string'
            ? body.error
            : 'Could not delete link — please try again';
        setError(message);
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold">
              {isEditing ? 'Edit link' : 'Add link'}
            </h2>
            <DialogClose className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none">
              ✕
            </DialogClose>
          </div>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="link-label"
                className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5"
              >
                Label
              </label>
              <input
                id="link-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={100}
                required
                placeholder="Marketing site"
                className="w-full rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-baljia-gold/40 focus:border-baljia-gold/40"
              />
              <p className="text-xs text-text-muted mt-1.5">
                Short name shown in the dashboard (e.g. Marketing site, Help docs)
              </p>
            </div>

            <div>
              <label
                htmlFor="link-url"
                className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5"
              >
                URL
              </label>
              <input
                id="link-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                maxLength={500}
                required
                placeholder="https://example.com"
                className="w-full rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-baljia-gold/40 focus:border-baljia-gold/40"
              />
              <p className="text-xs text-text-muted mt-1.5">
                Full URL starting with https://
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="px-3 py-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg"
              >
                {error}
              </div>
            )}
          </div>
        </DialogBody>

        <DialogFooter
          className={isEditing ? 'justify-between' : undefined}
        >
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                isLoading={loading === 'delete'}
                disabled={loading === 'save'}
                onClick={handleDelete}
                className="text-status-error hover:bg-status-error/10"
              >
                Delete
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loading !== null}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  isLoading={loading === 'save'}
                  disabled={loading === 'delete'}
                  onClick={handleSave}
                >
                  Save
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={loading !== null}
                onClick={() => onOpenChange(false)}
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
