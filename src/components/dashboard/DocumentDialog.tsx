// Simple doc viewer — opens on click in DocumentList. Renders content as
// markdown (mission + market_research + landing_page are all markdown/HTML).
// Landing page has its own live URL, so we show "Open live site" for it.

'use client';

import type { Document } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { MarkdownBody } from '@/components/ui/MarkdownBody';

interface DocumentDialogProps {
  doc: Document | null;
  onClose: () => void;
  companySlug?: string;
}

export function DocumentDialog({ doc, onClose, companySlug }: DocumentDialogProps) {
  if (!doc) return null;

  const isLanding = doc.doc_type === 'landing_page';
  const liveUrl = isLanding && companySlug ? `https://${companySlug}.baljia.app` : null;

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
          {isLanding ? (
            // Landing page content is HTML — render inside an iframe-like sandbox
            // (the live site is linked above; here we just show the source)
            <details className="mb-2">
              <summary className="cursor-pointer text-sm text-text-secondary">
                View HTML source ({doc.content?.length ?? 0} bytes)
              </summary>
              <pre className="mt-2 text-xs font-mono bg-surface-secondary rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
                {doc.content ?? '(empty)'}
              </pre>
            </details>
          ) : doc.content && doc.content.trim().length > 0 ? (
            <MarkdownBody>{doc.content}</MarkdownBody>
          ) : (
            <p className="text-sm text-text-secondary italic">(empty)</p>
          )}
        </div>
      </div>
    </div>
  );
}
