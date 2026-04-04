'use client';

import { formatRelativeTime } from '@/lib/utils';

interface EmailThread {
  id: string;
  subject: string | null;
  to_address: string;
  created_at: string;
}

interface EmailPreviewProps {
  companyEmail: string | null;
  latestEmail: EmailThread | null;
  sentCount: number;
  receivedCount: number;
}

export function EmailPreview({ companyEmail, latestEmail, sentCount, receivedCount }: EmailPreviewProps) {
  return (
    <div className="rounded-xl bg-surface-card border border-border-default p-4">
      <h3 className="text-sm font-semibold text-text-primary mb-3">Email</h3>

      {companyEmail && (
        <p className="text-xs text-text-muted mb-3 font-mono">{companyEmail}</p>
      )}

      {latestEmail ? (
        <div className="rounded-lg bg-surface-secondary border border-border-subtle p-3 mb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-secondary truncate">
                &rarr; {latestEmail.subject ?? 'No subject'}
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                To: {latestEmail.to_address}
              </p>
            </div>
            <span className="text-xs text-text-muted shrink-0">
              {formatRelativeTime(latestEmail.created_at)}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-text-muted mb-3">No emails yet</p>
      )}

      <p className="text-xs text-text-muted mb-3">
        {sentCount} sent &middot; {receivedCount} received
      </p>

      <button className="px-4 py-2 text-sm font-medium rounded-lg border border-border-default bg-surface-secondary hover:bg-surface-hover text-text-primary transition-colors">
        Cold Outreach
      </button>
    </div>
  );
}
