'use client';

import { useState } from 'react';
import type { Company } from '@/types';

interface CompanySettingsOverlayProps {
  company: Company;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function CompanySettingsOverlay({
  company,
  open,
  onOpenChange,
  onSaved,
}: CompanySettingsOverlayProps) {
  const [oneLiner, setOneLiner] = useState(company.one_liner ?? '');
  const [timezone, setTimezone] = useState(company.timezone ?? 'UTC');
  // C5-FIX: execution_state is read-only — only internal services can change it
  const isSuspended = company.execution_state === 'suspended';
  const isPaused = company.execution_state === 'paused';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!open) return null;

  async function handleSave() {
    // Bug #2: Block save when system-suspended to prevent bypass
    if (isSuspended) {
      setError('Your account is suspended by the platform. Contact support to restore access.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/companies/${company.id}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ one_liner: oneLiner, timezone }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Failed to save settings');
      }
      setSuccess(true);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-surface-card border border-border-default shadow-2xl p-6 mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-text-primary">Company Settings</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="text-text-muted hover:text-text-primary transition-colors"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Company name (read-only) */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
            Company Name
          </label>
          <div className="px-3 py-2.5 rounded-lg bg-surface-secondary border border-border-subtle text-text-muted text-sm">
            {company.name}
          </div>
          <p className="text-xs text-text-muted mt-1">Name is set during onboarding and cannot be changed.</p>
        </div>

        {/* One-liner */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
            One-liner
          </label>
          <input
            type="text"
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
            placeholder="What does your company do in one sentence?"
            maxLength={200}
            className="w-full px-3 py-2.5 rounded-lg bg-surface-secondary border border-border-default text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-baljia-gold transition-colors"
          />
          <p className="text-xs text-text-muted mt-1">{oneLiner.length}/200 · Used in agent briefings and public profile</p>
        </div>

        {/* Timezone */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
            Timezone
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-surface-secondary border border-border-default text-sm text-text-primary focus:outline-none focus:border-baljia-gold transition-colors"
          >
            <option value="UTC">UTC</option>
            <option value="America/New_York">America/New_York (ET)</option>
            <option value="America/Chicago">America/Chicago (CT)</option>
            <option value="America/Denver">America/Denver (MT)</option>
            <option value="America/Los_Angeles">America/Los_Angeles (PT)</option>
            <option value="Europe/London">Europe/London (GMT)</option>
            <option value="Europe/Paris">Europe/Paris (CET)</option>
            <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
            <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
            <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
            <option value="Australia/Sydney">Australia/Sydney (AEST)</option>
          </select>
          <p className="text-xs text-text-muted mt-1">Night shift schedule uses this timezone</p>
        </div>

        {/* Execution State */}
        <div className="mb-6">
          <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
            Agent Execution
          </label>

          {/* Execution State — C5-FIX: read-only status display */}
          {isSuspended ? (
            <div className="px-4 py-3 rounded-lg bg-status-error/10 border border-status-error/30 flex items-center gap-2">
              <span className="text-status-error text-lg">🔒</span>
              <div>
                <p className="text-sm font-semibold text-status-error">Account Suspended</p>
                <p className="text-xs text-status-error/80 mt-0.5">Agent execution is locked by the platform. Contact support to restore access.</p>
              </div>
            </div>
          ) : isPaused ? (
            <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
              <span className="text-amber-500 text-lg">⏸</span>
              <div>
                <p className="text-sm font-semibold text-amber-500">Agents Paused</p>
                <p className="text-xs text-amber-500/80 mt-0.5">Agents are temporarily paused. They will resume automatically.</p>
              </div>
            </div>
          ) : (
            <div className="px-4 py-3 rounded-lg bg-status-success/10 border border-status-success/30 flex items-center gap-2">
              <span className="text-status-success text-lg">▶</span>
              <div>
                <p className="text-sm font-semibold text-status-success">Agents Active</p>
                <p className="text-xs text-status-success/80 mt-0.5">Agents are running and processing tasks normally.</p>
              </div>
            </div>
          )}
        </div>

        {/* Error / Success */}
        {error && (
          <div className="mb-4 px-3 py-2.5 rounded-lg bg-status-error/10 border border-status-error/30 text-sm text-status-error">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 px-3 py-2.5 rounded-lg bg-status-success/10 border border-status-success/30 text-sm text-status-success">
            Settings saved ✓
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => onOpenChange(false)}
            className="flex-1 py-3 rounded-xl border border-border-default text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3 rounded-xl bg-baljia-gold text-surface-primary font-semibold text-sm hover:bg-baljia-gold-light transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
