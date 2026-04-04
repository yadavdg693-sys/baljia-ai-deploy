'use client';

import { formatCredits } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

interface CreditDisplayProps {
  balance: number;
  planTier?: string;
  recentUsage?: number[]; // last 7 days credit usage
  onPurchase?: () => void;
}

export function CreditDisplay({ balance, planTier = 'trial', recentUsage = [], onPurchase }: CreditDisplayProps) {
  // Calculate burn rate
  const totalUsed = recentUsage.reduce((sum, n) => sum + n, 0);
  const avgPerDay = recentUsage.length > 0 ? totalUsed / recentUsage.length : 0;
  const daysRemaining = avgPerDay > 0 ? Math.floor(balance / avgPerDay) : null;

  // Sparkline — max height 24px
  const maxUsage = Math.max(...recentUsage, 1);

  return (
    <div className="rounded-xl bg-surface-card border border-border-default p-4 space-y-4">
      {/* Tier + Balance */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-text-secondary uppercase tracking-wider font-semibold">Credits</p>
          <span className="text-xs px-2 py-0.5 rounded-full bg-surface-tertiary text-text-muted capitalize">
            {planTier}
          </span>
        </div>
        <p className="text-3xl font-bold text-baljia-gold tracking-tight">{formatCredits(balance)}</p>
      </div>

      {/* Usage sparkline */}
      {recentUsage.length > 0 && (
        <div>
          <p className="text-xs text-text-muted mb-2">Last 7 days</p>
          <div className="flex items-end gap-1 h-6">
            {recentUsage.map((val, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm bg-baljia-gold/30 hover:bg-baljia-gold/60 transition-colors"
                style={{ height: `${Math.max((val / maxUsage) * 100, 8)}%` }}
                title={`${val} credits`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Burn rate */}
      {daysRemaining !== null && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">
            ~{avgPerDay.toFixed(1)} cr/day
          </span>
          <span className={daysRemaining < 5 ? 'text-status-error font-medium' : 'text-text-secondary'}>
            {daysRemaining}d remaining
          </span>
        </div>
      )}

      {/* Purchase button */}
      <Button variant="secondary" size="sm" className="w-full" onClick={onPurchase}>
        Purchase More
      </Button>
    </div>
  );
}
