'use client';

import { useState, useEffect } from 'react';
import type { CreditLedgerEntry } from '@/types';
import { formatRelativeTime } from '@/lib/utils';

interface CreditLedgerProps {
  companyId: string;
  initialEntries?: CreditLedgerEntry[];
}

const TYPE_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  monthly_grant: { label: 'Monthly Grant', icon: '🎁', color: 'text-status-success' },
  welcome_bonus: { label: 'Welcome Bonus', icon: '🎉', color: 'text-status-success' },
  addon_purchase: { label: 'Purchase', icon: '💳', color: 'text-status-success' },
  task_deduction: { label: 'Task', icon: '⚡', color: 'text-status-error' },
  refund: { label: 'Refund', icon: '↩️', color: 'text-status-success' },
  night_shift_deduction: { label: 'Night Shift', icon: '🌙', color: 'text-status-error' },
  referral_bonus: { label: 'Referral', icon: '🤝', color: 'text-status-success' },
};

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'addon_purchase', label: 'Purchases' },
  { value: 'task_deduction', label: 'Tasks' },
  { value: 'refund', label: 'Refunds' },
  { value: 'monthly_grant', label: 'Grants' },
];

export function CreditLedger({ companyId, initialEntries = [] }: CreditLedgerProps) {
  const [entries, setEntries] = useState<CreditLedgerEntry[]>(initialEntries);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(initialEntries.length === 0);

  useEffect(() => {
    if (initialEntries.length > 0) return;
    
    async function fetchLedger() {
      try {
        const res = await fetch(`/api/credits/ledger?companyId=${companyId}`);
        if (res.ok) {
          const data = await res.json();
          setEntries(data.entries ?? []);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchLedger();
  }, [companyId, initialEntries.length]);

  const filtered = filter === 'all'
    ? entries
    : entries.filter((e) => e.entry_type === filter);

  if (loading) {
    return (
      <div className="rounded-xl bg-surface-card border border-border-default p-6">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-surface-secondary rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-surface-card border border-border-default overflow-hidden">
      {/* Header + Filter */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Credit History</h3>
        <div className="flex items-center gap-1">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                filter === opt.value
                  ? 'bg-baljia-gold/20 text-baljia-gold font-medium'
                  : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entries */}
      <div className="divide-y divide-border-subtle">
        {filtered.length === 0 ? (
          <div className="text-center py-10">
            <span className="text-2xl block mb-2">📊</span>
            <p className="text-sm text-text-muted">No transactions found.</p>
          </div>
        ) : (
          filtered.map((entry) => {
            const config = TYPE_CONFIG[entry.entry_type] ?? { label: entry.entry_type, icon: '•', color: 'text-text-primary' };
            const isPositive = entry.amount > 0;

            return (
              <div key={entry.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover/50 transition-colors">
                {/* Icon */}
                <span className="text-base">{config.icon}</span>

                {/* Description */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {entry.description ?? config.label}
                  </p>
                  <p className="text-xs text-text-muted">{formatRelativeTime(entry.created_at)}</p>
                </div>

                {/* Amount */}
                <div className="text-right">
                  <p className={`text-sm font-semibold ${isPositive ? 'text-status-success' : 'text-status-error'}`}>
                    {isPositive ? '+' : ''}{entry.amount}
                  </p>
                  {entry.balance_after !== null && (
                    <p className="text-xs text-text-muted">bal: {entry.balance_after}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
