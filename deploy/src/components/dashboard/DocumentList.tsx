'use client';

import type { Document } from '@/types';
import { Badge } from '@/components/ui/Badge';

interface DocumentListProps {
  documents: Document[];
  onDocumentClick?: (doc: Document) => void;
}

export function DocumentList({ documents, onDocumentClick }: DocumentListProps) {
  // FIX: Also show docs that have content even if is_empty flag is stale
  const populated = documents.filter((d) => !d.is_empty || (d.content && d.content.trim().length > 0));

  return (
    <div className="space-y-2">
      {populated.length === 0 ? (
        <p className="text-sm text-text-secondary py-4 text-center">No documents yet</p>
      ) : (
        populated.map((doc) => (
          <div
            key={doc.id}
            onClick={() => onDocumentClick?.(doc)}
            className="p-3 rounded-lg bg-surface-secondary hover:bg-surface-hover cursor-pointer transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{doc.title || doc.doc_type}</p>
                <p className="text-xs text-text-muted">v{doc.version}</p>
              </div>
              <Badge variant="default" size="sm">
                {doc.doc_type}
              </Badge>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
