// DocumentDialog — renders document content as markdown or structured JSON.
// Landing page content links to live site. Market research JSON is auto-formatted.
// Edit mode supports full content editing with parity to the chat update_document tool.

'use client';

import { useEffect, useState } from 'react';
import type { Document } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { MarkdownBody } from '@/components/ui/MarkdownBody';

interface DocumentDialogProps {
  doc: Document | null;
  onClose: () => void;
  companySlug?: string;
}

const MAX_CONTENT_LENGTH = 100000;

// FIX: Format structured JSON content (market research, etc.) into readable markdown
function formatStructuredContent(docType: string, data: Record<string, unknown>): string {
  if (docType === 'market_research' || docType === 'research') {
    const sections: string[] = [];
    if (data.summary) sections.push(`## Summary\n${data.summary}`);
    if (data.overview) sections.push(`## Overview\n${data.overview}`);
    if (data.market_size) sections.push(`## Market Size\n${data.market_size}`);

    if (Array.isArray(data.competitors)) {
      sections.push(`## Competitors\n${(data.competitors as Array<Record<string, unknown>>).map((c) =>
        `- **${c.name || c.company || 'Unknown'}**${c.url ? ` ([${c.url}](${c.url}))` : ''}: ${c.gap || c.description || c.weakness || ''}`
      ).join('\n')}`);
    }

    if (Array.isArray(data.demand_signals)) {
      sections.push(`## Demand Signals\n${(data.demand_signals as string[]).map((s) => `- ${s}`).join('\n')}`);
    }

    if (Array.isArray(data.market_stats)) {
      sections.push(`## Market Stats\n${(data.market_stats as string[]).map((s) => `- ${s}`).join('\n')}`);
    }

    if (data.positioning) sections.push(`## Positioning\n${data.positioning}`);
    if (data.recommendation) sections.push(`## Recommendation\n${data.recommendation}`);

    // Handle any remaining top-level keys we haven't covered
    const hiddenLegacyKeys = new Set([['data', 'gaps'].join('_')]);
    const handled = new Set(['summary', 'overview', 'market_size', 'competitors', 'demand_signals', 'market_stats', 'positioning', 'recommendation']);
    for (const [key, value] of Object.entries(data)) {
      if (handled.has(key) || hiddenLegacyKeys.has(key)) continue;
      if (typeof value === 'string' && value.trim()) {
        sections.push(`## ${key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n${value}`);
      } else if (Array.isArray(value) && value.length > 0) {
        sections.push(`## ${key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n${value.map((v) =>
          typeof v === 'string' ? `- ${v}` : `- ${JSON.stringify(v)}`
        ).join('\n')}`);
      }
    }

    if (sections.length > 0) return sections.join('\n\n');
  }

  // Mission docs may also be JSON
  if (docType === 'mission') {
    const sections: string[] = [];
    if (data.mission) sections.push(`## Mission\n${data.mission}`);
    if (data.what_were_building) sections.push(`## What We're Building\n${data.what_were_building}`);
    if (data.where_were_headed) sections.push(`## Where We're Headed\n${data.where_were_headed}`);
    if (sections.length > 0) return sections.join('\n\n');
  }

  // Fallback: pretty-print JSON
  return '```json\n' + JSON.stringify(data, null, 2) + '\n```';
}

export function DocumentDialog({ doc, onClose, companySlug }: DocumentDialogProps) {
  // Local mirror of the doc prop. After a successful save we update this so the
  // dialog reflects new content without requiring the parent to refetch.
  const [currentDoc, setCurrentDoc] = useState<Document | null>(doc);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSavedToast, setShowSavedToast] = useState(false);

  // Sync local state when the parent passes a different doc (or closes the dialog).
  useEffect(() => {
    setCurrentDoc(doc);
    setIsEditing(false);
    setDraft('');
    setSaveError(null);
    setShowSavedToast(false);
  }, [doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss the success toast after 2s.
  useEffect(() => {
    if (!showSavedToast) return;
    const t = setTimeout(() => setShowSavedToast(false), 2000);
    return () => clearTimeout(t);
  }, [showSavedToast]);

  if (!currentDoc) return null;

  const activeDoc = currentDoc;
  const isLanding = activeDoc.doc_type === 'landing_page';
  const liveUrl = isLanding && companySlug ? `https://${companySlug}.baljia.app` : null;

  function enterEditMode() {
    setDraft(activeDoc.content ?? '');
    setSaveError(null);
    setIsEditing(true);
  }

  function cancelEdit() {
    setDraft('');
    setSaveError(null);
    setIsEditing(false);
  }

  async function handleSave() {
    if (draft.length > MAX_CONTENT_LENGTH) {
      setSaveError(`Content exceeds ${MAX_CONTENT_LENGTH} character limit.`);
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/documents/${activeDoc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) {
        let message = `Save failed (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) {
            message = typeof body.error === 'string'
              ? body.error
              : `Save failed: ${JSON.stringify(body.error)}`;
          }
        } catch {
          // ignore parse failure, keep status-based message
        }
        setSaveError(message);
        return;
      }
      const updated = (await res.json()) as Document;
      // Patch local copy so read-mode shows the new content immediately.
      setCurrentDoc({
        ...activeDoc,
        content: updated.content ?? draft,
        version: updated.version ?? activeDoc.version,
        updated_at: updated.updated_at ?? new Date().toISOString(),
        is_empty: (updated.content ?? draft).trim().length === 0,
      });
      setIsEditing(false);
      setDraft('');
      setShowSavedToast(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Network error during save.');
    } finally {
      setIsSaving(false);
    }
  }

  // FIX: Detect JSON content and format it properly
  function renderContent() {
    if (isLanding) {
      return (
        <details className="mb-2">
          <summary className="cursor-pointer text-sm text-text-secondary">
            View HTML source ({activeDoc.content?.length ?? 0} bytes)
          </summary>
          <pre className="mt-2 text-xs font-mono bg-surface-secondary rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
            {activeDoc.content ?? '(empty)'}
          </pre>
        </details>
      );
    }

    if (!activeDoc.content || activeDoc.content.trim().length === 0) {
      return <p className="text-sm text-text-secondary italic">(empty)</p>;
    }

    // Try to parse as JSON — market research and mission docs are often stored as JSON
    try {
      const parsed = JSON.parse(activeDoc.content);
      if (typeof parsed === 'object' && parsed !== null) {
        const formatted = formatStructuredContent(activeDoc.doc_type, parsed);
        return <MarkdownBody>{formatted}</MarkdownBody>;
      }
    } catch {
      // Not JSON — render as markdown
    }

    return <MarkdownBody>{activeDoc.content}</MarkdownBody>;
  }

  const overLimit = draft.length > MAX_CONTENT_LENGTH;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-xl bg-surface-card border border-border-default flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border-default">
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate">{activeDoc.title || activeDoc.doc_type}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="default" size="sm">{activeDoc.doc_type}</Badge>
              <span className="text-xs text-text-muted">v{activeDoc.version}</span>
              {activeDoc.updated_at && (
                <span className="text-xs text-text-muted">
                  updated {new Date(activeDoc.updated_at).toLocaleDateString()}
                </span>
              )}
              {isEditing && (
                <Badge variant="warning" size="sm">editing</Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {liveUrl && !isEditing && (
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-2.5 py-1.5 rounded-md bg-baljia-gold/15 border border-baljia-gold/20 text-text-primary hover:bg-baljia-gold/25 transition-colors whitespace-nowrap"
              >
                Open live site ↗
              </a>
            )}
            {!isEditing && (
              <button
                type="button"
                onClick={enterEditMode}
                className="text-xs px-2.5 py-1.5 rounded-md bg-baljia-gold/15 border border-baljia-gold/30 text-text-primary hover:bg-baljia-gold/25 transition-colors"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-2.5 py-1.5 rounded-md bg-surface-secondary hover:bg-surface-hover border border-border-default text-text-primary transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto px-5 py-4 flex-1 min-h-0">
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="w-full h-[60vh] resize-none font-mono text-sm bg-surface-secondary border border-border-default rounded-md p-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                placeholder="Document content (markdown or JSON)…"
              />
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">
                  Edits save as a new document version.
                </span>
                <span className={overLimit ? 'text-status-error font-medium' : 'text-text-muted'}>
                  {draft.length}/{MAX_CONTENT_LENGTH}
                </span>
              </div>
            </div>
          ) : (
            renderContent()
          )}
        </div>

        {/* Footer — only in edit mode */}
        {isEditing && (
          <div className="border-t border-border-default flex flex-col">
            {saveError && (
              <div className="px-5 py-2 bg-status-error/10 border-b border-status-error/30 text-xs text-status-error">
                {saveError}
              </div>
            )}
            <div className="flex justify-end gap-2 px-5 py-3 bg-surface-secondary">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={isSaving}
                className="text-xs px-3 py-1.5 rounded-md bg-surface-card hover:bg-surface-hover border border-border-default text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || overLimit}
                className="text-xs px-3 py-1.5 rounded-md bg-baljia-gold text-surface-primary hover:bg-baljia-gold-light font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Saved toast (transient) */}
        {showSavedToast && (
          <div
            role="status"
            aria-live="polite"
            className="absolute bottom-4 right-4 px-3 py-1.5 rounded-md bg-status-success/15 border border-status-success/40 text-xs text-status-success font-medium shadow-lg"
          >
            Saved
          </div>
        )}
      </div>
    </div>
  );
}
