// DocumentDialog — renders document content as markdown or structured JSON.
// Landing page content links to live site. Market research JSON is auto-formatted.

'use client';

import type { Document } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { MarkdownBody } from '@/components/ui/MarkdownBody';

interface DocumentDialogProps {
  doc: Document | null;
  onClose: () => void;
  companySlug?: string;
}

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

    if (Array.isArray(data.data_gaps)) {
      sections.push(`## Known Gaps\n${(data.data_gaps as string[]).map((g) => `- ${g}`).join('\n')}`);
    }

    if (data.positioning) sections.push(`## Positioning\n${data.positioning}`);
    if (data.recommendation) sections.push(`## Recommendation\n${data.recommendation}`);

    // Handle any remaining top-level keys we haven't covered
    const handled = new Set(['summary', 'overview', 'market_size', 'competitors', 'demand_signals', 'market_stats', 'data_gaps', 'positioning', 'recommendation']);
    for (const [key, value] of Object.entries(data)) {
      if (handled.has(key)) continue;
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
  if (!doc) return null;

  const isLanding = doc.doc_type === 'landing_page';
  const liveUrl = isLanding && companySlug ? `https://${companySlug}.baljia.app` : null;

  // FIX: Detect JSON content and format it properly
  function renderContent() {
    if (isLanding) {
      return (
        <details className="mb-2">
          <summary className="cursor-pointer text-sm text-text-secondary">
            View HTML source ({doc.content?.length ?? 0} bytes)
          </summary>
          <pre className="mt-2 text-xs font-mono bg-surface-secondary rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
            {doc.content ?? '(empty)'}
          </pre>
        </details>
      );
    }

    if (!doc.content || doc.content.trim().length === 0) {
      return <p className="text-sm text-text-secondary italic">(empty)</p>;
    }

    // Try to parse as JSON — market research and mission docs are often stored as JSON
    try {
      const parsed = JSON.parse(doc.content);
      if (typeof parsed === 'object' && parsed !== null) {
        const formatted = formatStructuredContent(doc.doc_type, parsed);
        return <MarkdownBody>{formatted}</MarkdownBody>;
      }
    } catch {
      // Not JSON — render as markdown
    }

    return <MarkdownBody>{doc.content}</MarkdownBody>;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-xl bg-surface-card border border-border-default flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border-default">
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate">{doc.title || doc.doc_type}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="default" size="sm">{doc.doc_type}</Badge>
              <span className="text-xs text-text-muted">v{doc.version}</span>
              {doc.updated_at && (
                <span className="text-xs text-text-muted">
                  updated {new Date(doc.updated_at).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {liveUrl && (
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-2.5 py-1.5 rounded-md bg-baljia-gold/15 border border-baljia-gold/20 text-text-primary hover:bg-baljia-gold/25 transition-colors whitespace-nowrap"
              >
                Open live site ↗
              </a>
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
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
