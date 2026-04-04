'use client';

import { formatRelativeTime } from '@/lib/utils';

interface Tweet {
  id: string;
  content: string;
  created_at: string;
}

interface TwitterPreviewProps {
  handle: string | null;
  latestTweet: Tweet | null;
}

export function TwitterPreview({ handle, latestTweet }: TwitterPreviewProps) {
  return (
    <div className="rounded-xl bg-surface-card border border-border-default p-4">
      <h3 className="text-sm font-semibold text-text-primary mb-3">Twitter</h3>

      {handle && (
        <p className="text-xs text-text-muted mb-3">@{handle}</p>
      )}

      {latestTweet ? (
        <div className="rounded-lg bg-surface-secondary border border-border-subtle p-3 mb-3">
          <p className="text-sm text-text-secondary leading-relaxed line-clamp-4">
            {latestTweet.content}
          </p>
          <p className="text-xs text-text-muted mt-2">
            {formatRelativeTime(latestTweet.created_at)}
          </p>
        </div>
      ) : (
        <p className="text-xs text-text-muted mb-3">No tweets yet</p>
      )}

      <button className="px-4 py-2 text-sm font-medium rounded-lg border border-border-default bg-surface-secondary hover:bg-surface-hover text-text-primary transition-colors">
        Tweet
      </button>
    </div>
  );
}
