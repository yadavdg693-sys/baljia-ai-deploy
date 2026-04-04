'use client';

import { useState } from 'react';

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}

const FEATURES = [
  '1 company',
  '30 night shifts (1 task/day)',
  '5 task credits/month',
  'Unlimited Strategy & Planning Chat',
  'Server, Database, Email, Browser included',
  '$5/mo AI credits for your company',
];

const CREDIT_OPTIONS = [
  { value: 5, label: '5 (included)' },
  { value: 10, label: '10 (+$10/mo)' },
  { value: 20, label: '20 (+$25/mo)' },
  { value: 50, label: '50 (+$55/mo)' },
];

export function UpgradeDialog({ open, onOpenChange, companyId }: UpgradeDialogProps) {
  const [extraCompanies, setExtraCompanies] = useState(0);
  const [extraCredits, setExtraCredits] = useState(5);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleStartTrial() {
    setLoading(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          type: 'subscription',
          extra_companies: extraCompanies,
          extra_credits: extraCredits,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      // Silently fail — user can retry
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-lg mx-4 bg-surface-card border border-border-default rounded-2xl shadow-2xl animate-fade-in max-h-[90vh] overflow-y-auto">
        {/* Close */}
        <button
          onClick={() => onOpenChange(false)}
          className="absolute top-4 right-4 text-sm text-text-muted hover:text-text-primary border border-border-default rounded-lg px-3 py-1 transition-colors"
        >
          Close
        </button>

        <div className="p-8">
          {/* Title */}
          <h2 className="text-3xl font-bold text-center font-[family-name:var(--font-display)] text-text-primary italic mb-1">
            3-Day Free Trial
          </h2>
          <p className="text-center text-text-muted text-sm mb-8">then $49/month</p>

          {/* Features */}
          <div className="border border-border-default rounded-xl p-6 mb-6">
            <p className="text-sm text-text-secondary mb-4">Includes:</p>
            <ul className="space-y-2.5">
              {FEATURES.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-status-success shrink-0 mt-0.5">&#10003;</span>
                  <span className="text-text-primary">
                    {f}
                    {i === 2 && (
                      <span className="text-status-success ml-1">(+10 first month)</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Extra companies */}
          <div className="flex items-center justify-between py-4 border-b border-border-subtle">
            <div>
              <p className="text-sm font-medium text-text-primary">Extra Companies</p>
              <p className="text-xs text-text-muted">Run your own fund</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">+$49/mo each</span>
              <button
                onClick={() => setExtraCompanies(Math.max(0, extraCompanies - 1))}
                className="w-8 h-8 rounded-lg border border-border-default text-text-secondary hover:bg-surface-hover flex items-center justify-center"
              >
                &minus;
              </button>
              <span className="w-6 text-center text-sm font-medium">{extraCompanies}</span>
              <button
                onClick={() => setExtraCompanies(extraCompanies + 1)}
                className="w-8 h-8 rounded-lg border border-border-default text-text-secondary hover:bg-surface-hover flex items-center justify-center"
              >
                +
              </button>
            </div>
          </div>

          {/* Extra credits */}
          <div className="flex items-center justify-between py-4 mb-6">
            <div>
              <p className="text-sm font-medium text-text-primary">Extra task credits</p>
              <p className="text-xs text-text-muted">Instant or recurring tasks</p>
            </div>
            <select
              value={extraCredits}
              onChange={(e) => setExtraCredits(Number(e.target.value))}
              className="rounded-lg border border-border-default bg-surface-secondary text-text-primary text-sm px-3 py-2"
            >
              {CREDIT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* CTA */}
          <button
            onClick={handleStartTrial}
            disabled={loading}
            className="w-full py-4 rounded-xl bg-baljia-gold text-surface-primary font-semibold text-lg hover:bg-baljia-gold-light transition-colors disabled:opacity-50"
          >
            {loading ? 'Redirecting...' : 'Start 3-Day Free Trial'}
          </button>
          <p className="text-center text-xs text-text-muted mt-3">
            Cancel anytime. No commitments.
          </p>
        </div>
      </div>
    </div>
  );
}
