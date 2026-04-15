'use client';

// DocumentSuggestionPanel — founder-facing Accept / Edit / Skip review UI
// Per spec: "core documents update via user-reviewed suggestions ONLY (no silent auto-update)"
// G-DOC-001: All doc updates flow through this review surface

import { useState, useEffect, useCallback } from 'react';
import type { DocumentSuggestion } from '@/types';

interface DocumentSuggestionPanelProps {
  companyId: string;
  /** Called after any review action so parent can refresh doc state */
  onReviewed?: () => void;
}

export function DocumentSuggestionPanel({ companyId, onReviewed }: DocumentSuggestionPanelProps) {
  const [suggestions, setSuggestions] = useState<DocumentSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await fetch(`/api/document-suggestions?company_id=${companyId}`);
      if (!res.ok) return;
      const data = await res.json() as { suggestions: DocumentSuggestion[] };
      setSuggestions(data.suggestions ?? []);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void fetchSuggestions();
  }, [fetchSuggestions]);

  async function handleAction(
    id: string,
    action: 'accept' | 'edit' | 'skip',
    edited?: string,
  ) {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/document-suggestions/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'edit' ? JSON.stringify({ content: edited }) : '{}',
      });
      if (!res.ok) throw new Error('Failed');
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
      setEditingId(null);
      onReviewed?.();
    } catch { /* silent */ } finally {
      setActionLoading(null);
    }
  }

  if (loading) return null;
  if (suggestions.length === 0) return null;

  return (
    <div className="rounded-2xl border border-baljia-gold/30 bg-baljia-gold/5 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-baljia-gold text-base">✦</span>
        <h3 className="text-sm font-semibold text-baljia-gold">
          Document Updates Ready to Review
        </h3>
        <span className="ml-auto text-xs text-text-muted">
          {suggestions.length} pending
        </span>
      </div>

      {suggestions.map((s) => {
        const isEditing = editingId === s.id;
        const isBusy = actionLoading === s.id;

        return (
          <div
            key={s.id}
            className="rounded-xl bg-surface-card border border-border-default p-4 space-y-3"
          >
            {/* Doc type badge + reason */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="inline-block px-2 py-0.5 rounded-md bg-surface-secondary text-xs font-mono text-text-secondary border border-border-subtle capitalize">
                  {(s as unknown as { doc_type?: string }).doc_type ?? 'document'}
                </span>
                {s.reason && (
                  <p className="text-xs text-text-muted mt-1">{s.reason}</p>
                )}
              </div>
            </div>

            {/* Content preview / edit area */}
            {isEditing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={6}
                className="w-full px-3 py-2.5 rounded-lg bg-surface-secondary border border-baljia-gold/40 text-sm text-text-primary font-mono focus:outline-none resize-y"
              />
            ) : (
              <pre className="text-xs text-text-secondary bg-surface-secondary rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono border border-border-subtle">
                {s.suggested_content}
              </pre>
            )}

            {/* Actions */}
            <div className="flex gap-2 flex-wrap">
              {isEditing ? (
                <>
                  <button
                    onClick={() => handleAction(s.id, 'edit', editContent)}
                    disabled={isBusy}
                    className="px-4 py-2 rounded-lg bg-baljia-gold text-surface-primary text-xs font-semibold hover:bg-baljia-gold-light transition-colors disabled:opacity-50"
                  >
                    {isBusy ? 'Saving…' : 'Save Edit'}
                  </button>
                  <button
                    onClick={() => { setEditingId(null); setEditContent(''); }}
                    className="px-4 py-2 rounded-lg border border-border-default text-xs text-text-muted hover:text-text-primary transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleAction(s.id, 'accept')}
                    disabled={isBusy}
                    className="px-4 py-2 rounded-lg bg-status-success/10 border border-status-success/30 text-xs font-semibold text-status-success hover:bg-status-success/20 transition-colors disabled:opacity-50"
                  >
                    {isBusy ? '…' : '✓ Accept'}
                  </button>
                  <button
                    onClick={() => { setEditingId(s.id); setEditContent(s.suggested_content); }}
                    disabled={isBusy}
                    className="px-4 py-2 rounded-lg bg-baljia-gold/10 border border-baljia-gold/30 text-xs font-semibold text-baljia-gold hover:bg-baljia-gold/20 transition-colors disabled:opacity-50"
                  >
                    ✎ Edit
                  </button>
                  <button
                    onClick={() => handleAction(s.id, 'skip')}
                    disabled={isBusy}
                    className="px-4 py-2 rounded-lg border border-border-default text-xs text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
                  >
                    Skip
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
