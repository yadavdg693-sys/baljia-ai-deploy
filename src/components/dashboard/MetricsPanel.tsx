'use client';

interface MetricsPanelProps {
  revenue: number;
  balance: number;
  views: number;
  users: number;
}

export function MetricsPanel({ revenue, balance, views, users }: MetricsPanelProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-surface-secondary p-3">
        <p className="text-xs text-text-secondary mb-1">Revenue</p>
        <p className="text-lg font-semibold text-baljia-gold">${revenue.toLocaleString()}</p>
      </div>
      <div className="rounded-lg bg-surface-secondary p-3">
        <p className="text-xs text-text-secondary mb-1">Balance</p>
        <p className="text-lg font-semibold text-status-success">${balance.toLocaleString()}</p>
      </div>
      <div className="rounded-lg bg-surface-secondary p-3">
        <p className="text-xs text-text-secondary mb-1">Views</p>
        <p className="text-lg font-semibold">{views.toLocaleString()}</p>
      </div>
      <div className="rounded-lg bg-surface-secondary p-3">
        <p className="text-xs text-text-secondary mb-1">Users</p>
        <p className="text-lg font-semibold">{users.toLocaleString()}</p>
      </div>
    </div>
  );
}
