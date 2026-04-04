'use client';

interface AdsPreviewProps {
  activeCampaigns: number;
}

export function AdsPreview({ activeCampaigns }: AdsPreviewProps) {
  return (
    <div className="rounded-xl bg-surface-card border border-border-default p-4">
      <h3 className="text-sm font-semibold text-text-primary mb-3">Ads</h3>

      {activeCampaigns > 0 ? (
        <p className="text-xs text-text-muted mb-3">
          {activeCampaigns} active campaign{activeCampaigns !== 1 ? 's' : ''}
        </p>
      ) : null}

      <button className="px-4 py-2 text-sm font-medium rounded-lg border border-border-default bg-surface-secondary hover:bg-surface-hover text-text-primary transition-colors">
        Run Ads
      </button>
    </div>
  );
}
