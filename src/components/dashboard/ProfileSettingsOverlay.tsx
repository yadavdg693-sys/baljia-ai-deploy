'use client';

import { useState } from 'react';
import type { User } from '@/types';

interface ProfileSettingsOverlayProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function ProfileSettingsOverlay({
  user,
  open,
  onOpenChange,
  onSaved,
}: ProfileSettingsOverlayProps) {
  const [name, setName] = useState(user.name ?? '');
  const [twitterHandle, setTwitterHandle] = useState(
    user.twitter_handle ? user.twitter_handle.replace(/^@/, '') : ''
  );
  const [timezone, setTimezone] = useState(user.timezone ?? 'UTC');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch('/api/users/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || null,
          twitter_handle: twitterHandle.trim() ? `@${twitterHandle.trim().replace(/^@/, '')}` : null,
          timezone,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Failed to save profile');
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
          <h2 className="text-lg font-semibold text-text-primary">Profile Settings</h2>
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

        {/* Avatar / Email (read-only) */}
        <div className="flex items-center gap-3 p-4 rounded-xl bg-surface-secondary border border-border-subtle mb-5">
          <div className="w-10 h-10 rounded-full bg-baljia-gold/20 border border-baljia-gold/40 flex items-center justify-center text-baljia-gold font-bold text-sm shrink-0">
            {(user.name ?? user.email)[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{user.email}</p>
            <p className="text-xs text-text-muted capitalize">{user.auth_provider.replace('_', ' ')}</p>
          </div>
        </div>

        {/* Name */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
            Display Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            maxLength={100}
            className="w-full px-3 py-2.5 rounded-lg bg-surface-secondary border border-border-default text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-baljia-gold transition-colors"
          />
        </div>

        {/* Twitter handle */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
            Twitter / X Handle
          </label>
          <div className="flex items-center rounded-lg bg-surface-secondary border border-border-default focus-within:border-baljia-gold transition-colors overflow-hidden">
            <span className="px-3 text-text-muted text-sm select-none">@</span>
            <input
              type="text"
              value={twitterHandle}
              onChange={(e) => setTwitterHandle(e.target.value.replace(/^@/, ''))}
              placeholder="yourhandle"
              maxLength={50}
              className="flex-1 pr-3 py-2.5 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            />
          </div>
          <p className="text-xs text-text-muted mt-1">Used to personalize agent context and outreach</p>
        </div>

        {/* Timezone */}
        <div className="mb-6">
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
          <p className="text-xs text-text-muted mt-1">Affects dashboard time display and notification scheduling</p>
        </div>

        {/* Referral info */}
        <div className="mb-5 px-3 py-2.5 rounded-lg bg-surface-secondary border border-border-subtle flex items-center justify-between text-sm">
          <span className="text-text-secondary">Your referral code</span>
          <code className="text-baljia-gold font-mono font-semibold">{user.referral_code}</code>
        </div>

        {/* Error / Success */}
        {error && (
          <div className="mb-4 px-3 py-2.5 rounded-lg bg-status-error/10 border border-status-error/30 text-sm text-status-error">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 px-3 py-2.5 rounded-lg bg-status-success/10 border border-status-success/30 text-sm text-status-success">
            Profile saved ✓
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
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  );
}
