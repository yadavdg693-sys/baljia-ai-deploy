'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

type AdsGoal = 'traffic' | 'leads' | 'awareness';
type ApprovalMode = 'review_before_launch' | 'autopilot';

interface RunAdsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  defaultPromotedItem?: string;
  defaultLandingUrl?: string;
  companyOneLiner?: string | null;
  companyOriginalIdea?: string | null;
  onCreated?: (task: { id: string; title: string }) => void;
}

const goalLabels: Record<AdsGoal, string> = {
  traffic: 'Traffic',
  leads: 'Leads',
  awareness: 'Awareness',
};

export function RunAdsDialog({
  open,
  onOpenChange,
  companyId,
  defaultPromotedItem = '',
  defaultLandingUrl = '',
  companyOneLiner = null,
  companyOriginalIdea = null,
  onCreated,
}: RunAdsDialogProps) {
  const [promotedItem, setPromotedItem] = useState(defaultPromotedItem);
  const [goal, setGoal] = useState<AdsGoal>('traffic');
  const [dailyBudget, setDailyBudget] = useState(10);
  const [landingUrl, setLandingUrl] = useState(defaultLandingUrl);
  const [audience, setAudience] = useState('');
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(45);
  const [country, setCountry] = useState('US');
  const [creativeBrief, setCreativeBrief] = useState('');
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('review_before_launch');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && defaultLandingUrl && !landingUrl) setLandingUrl(defaultLandingUrl);
  }, [defaultLandingUrl, landingUrl, open]);

  useEffect(() => {
    if (open && defaultPromotedItem && !promotedItem) setPromotedItem(defaultPromotedItem);
  }, [defaultPromotedItem, open, promotedItem]);

  const canSubmit = promotedItem.trim().length >= 2
    && dailyBudget >= 10
    && dailyBudget <= 1000
    && ageMin <= ageMax
    && country.trim().length === 2
    && !submitting;

  const productContext = companyOneLiner?.trim() || companyOriginalIdea?.trim() || '';
  const promotedPlaceholder = defaultPromotedItem
    ? `${defaultPromotedItem}${productContext ? ` - ${productContext}` : ' product, service, or offer'}`
    : productContext || 'Main product, service, offer, or specific feature';

  const reset = () => {
    setPromotedItem(defaultPromotedItem);
    setGoal('traffic');
    setDailyBudget(10);
    setLandingUrl(defaultLandingUrl);
    setAudience('');
    setAgeMin(18);
    setAgeMax(45);
    setCountry('US');
    setCreativeBrief('');
    setApprovalMode('review_before_launch');
    setError(null);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/ads/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          promoted_item: promotedItem.trim(),
          goal,
          daily_budget: dailyBudget,
          landing_url: landingUrl.trim() || undefined,
          audience: audience.trim() || undefined,
          age_min: ageMin,
          age_max: ageMax,
          country: country.trim().toUpperCase(),
          creative_brief: creativeBrief.trim() || undefined,
          approval_mode: approvalMode,
        }),
      });

      if (response.status === 201) {
        const payload = await response.json().catch(() => null) as
          | { task?: { id: string; title: string } }
          | null;
        if (payload?.task?.id) onCreated?.({ id: payload.task.id, title: payload.task.title });
        reset();
        onOpenChange(false);
        return;
      }

      if (response.status === 400) {
        setError('Check what you are promoting, the goal, and the budget.');
      } else if (response.status === 401 || response.status === 403) {
        setError("You're not authorized to run ads for this company.");
      } else if (response.status === 503) {
        setError('Ads setup is not fully connected yet. Finish Meta, creative storage, and video generation setup before launching.');
      } else {
        setError('Could not create the ads task. Please try again.');
      }
    } catch {
      setError('Could not create the ads task. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">Run Ads</h2>
                <p className="mt-1 text-sm text-text-muted">
                  Create a Meta Ads task with a budget, creative brief, and launch approval mode.
                </p>
              </div>
              <DialogClose
                type="button"
                className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none"
                aria-label="Close"
              >
                x
              </DialogClose>
            </div>
          </DialogHeader>

          <DialogBody>
            <div className="space-y-5">
              {error && (
                <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">What are you promoting?</span>
                <input
                  type="text"
                  value={promotedItem}
                  onChange={(e) => setPromotedItem(e.target.value)}
                  placeholder={promotedPlaceholder}
                  className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Goal</span>
                  <select
                    value={goal}
                    onChange={(e) => setGoal(e.target.value as AdsGoal)}
                    className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                  >
                    {Object.entries(goalLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Daily Budget</span>
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    step={1}
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(Number(e.target.value))}
                    className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                  />
                </label>
              </div>

              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Landing URL</span>
                <input
                  type="text"
                  value={landingUrl}
                  onChange={(e) => setLandingUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                />
              </label>

              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Audience</span>
                <textarea
                  rows={2}
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder="Optional. Baljia can infer this from the promoted product."
                  className="resize-y rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Min Age</span>
                  <input
                    type="number"
                    min={13}
                    max={65}
                    value={ageMin}
                    onChange={(e) => setAgeMin(Number(e.target.value))}
                    className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Max Age</span>
                  <input
                    type="number"
                    min={13}
                    max={65}
                    value={ageMax}
                    onChange={(e) => setAgeMax(Number(e.target.value))}
                    className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Country</span>
                  <input
                    type="text"
                    maxLength={2}
                    value={country}
                    onChange={(e) => setCountry(e.target.value.toUpperCase())}
                    className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm uppercase text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                  />
                </label>
              </div>

              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Creative Brief</span>
                <textarea
                  rows={3}
                  value={creativeBrief}
                  onChange={(e) => setCreativeBrief(e.target.value)}
                  placeholder="Optional angle, offer, audience pain, or product detail."
                  className="resize-y rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                />
              </label>

              <fieldset className="grid gap-2">
                <legend className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Launch Mode</legend>
                <label className="flex items-start gap-3 rounded-lg border border-border-default bg-surface-secondary p-3 text-sm">
                  <input
                    type="radio"
                    name="approval_mode"
                    value="review_before_launch"
                    checked={approvalMode === 'review_before_launch'}
                    onChange={() => setApprovalMode('review_before_launch')}
                    className="mt-1"
                  />
                  <span>
                    <strong className="block text-text-primary">Review before launch</strong>
                    <span className="text-xs text-text-muted">Create the campaign paused and wait for approval.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-lg border border-border-default bg-surface-secondary p-3 text-sm">
                  <input
                    type="radio"
                    name="approval_mode"
                    value="autopilot"
                    checked={approvalMode === 'autopilot'}
                    onChange={() => setApprovalMode('autopilot')}
                    className="mt-1"
                  />
                  <span>
                    <strong className="block text-text-primary">Autopilot</strong>
                    <span className="text-xs text-text-muted">Launch within the approved budget after setup checks pass.</span>
                  </span>
                </label>
              </fieldset>

            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => handleClose(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={submitting} disabled={!canSubmit}>
              Create Ads Task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
