'use client';

import { useMemo, useState } from 'react';
import { Film, Loader2, Wand2 } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import type {
  PromoVideoAspectRatio,
  PromoVideoDuration,
  PromoVideoGoal,
  PromoVideoJob,
  PromoVideoStyle,
  PromoVideoVisualMode,
  PromoVideoVoiceMode,
} from '@/types';

interface PromoVideoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  defaultCta?: string;
  onCreated?: (job: PromoVideoJob) => void;
}

const goals: Array<{ value: PromoVideoGoal; label: string }> = [
  { value: 'attention', label: 'Get attention' },
  { value: 'launch', label: 'Announce launch' },
  { value: 'product_hunt', label: 'Product Hunt launch' },
  { value: 'explain', label: 'Explain product' },
  { value: 'demo', label: 'Show product demo' },
  { value: 'pitch', label: 'Pitch customers/investors' },
];

const durations: PromoVideoDuration[] = [15, 30, 60, 90];

const aspects: Array<{ value: PromoVideoAspectRatio; label: string }> = [
  { value: '9:16', label: '9:16 vertical' },
  { value: '16:9', label: '16:9 landscape' },
  { value: '1:1', label: '1:1 square' },
];

const styles: Array<{ value: PromoVideoStyle; label: string }> = [
  { value: 'product_demo', label: 'Product demo' },
  { value: 'clean_saas', label: 'Clean SaaS promo' },
  { value: 'cinematic_ui', label: 'Cinematic UI' },
];

const visualModes: Array<{ value: PromoVideoVisualMode; label: string }> = [
  { value: 'cinematic', label: 'Cinematic promo' },
  { value: 'actual_site', label: 'Actual site demo' },
];

const voiceModes: Array<{ value: PromoVideoVoiceMode; label: string }> = [
  { value: 'deepgram', label: 'Deepgram voice' },
  { value: 'founder_avatar', label: 'Founder avatar voice' },
];

function creditsForDuration(duration: PromoVideoDuration): number {
  if (duration === 60) return 3;
  if (duration === 90) return 4;
  return 2;
}

export function PromoVideoDialog({
  open,
  onOpenChange,
  companyId,
  defaultCta = '',
  onCreated,
}: PromoVideoDialogProps) {
  const [goal, setGoal] = useState<PromoVideoGoal>('demo');
  const [duration, setDuration] = useState<PromoVideoDuration>(30);
  const [aspectRatio, setAspectRatio] = useState<PromoVideoAspectRatio>('9:16');
  const [style, setStyle] = useState<PromoVideoStyle>('product_demo');
  const [visualMode, setVisualMode] = useState<PromoVideoVisualMode>('cinematic');
  const [voiceMode, setVoiceMode] = useState<PromoVideoVoiceMode>('deepgram');
  const [cta, setCta] = useState(defaultCta);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const credits = useMemo(() => creditsForDuration(duration), [duration]);

  const reset = () => {
    setGoal('demo');
    setDuration(30);
    setAspectRatio('9:16');
    setStyle('product_demo');
    setVisualMode('cinematic');
    setVoiceMode('deepgram');
    setCta(defaultCta);
    setError(null);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleGoalChange = (nextGoal: PromoVideoGoal) => {
    setGoal(nextGoal);
    if (nextGoal === 'product_hunt') {
      setDuration(60);
      setAspectRatio('16:9');
      setStyle('product_demo');
      setVisualMode('actual_site');
      setVoiceMode('deepgram');
      setCta(defaultCta || 'Try it on Product Hunt');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/promo-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          goal,
          duration_seconds: duration,
          aspect_ratio: aspectRatio,
          style,
          visual_mode: visualMode,
          voice_mode: voiceMode,
          cta: cta.trim() || undefined,
        }),
      });

      if (response.status === 201) {
        const payload = await response.json().catch(() => null) as { job?: PromoVideoJob } | null;
        if (payload?.job) onCreated?.(payload.job);
        reset();
        onOpenChange(false);
        return;
      }

      if (response.status === 400) setError('Check the video options and CTA.');
      else if (response.status === 401 || response.status === 403) setError("You're not authorized to create videos for this company.");
      else if (response.status === 404) setError('Company not found.');
      else setError('Could not queue the promo video. Please try again.');
    } catch {
      setError('Could not queue the promo video. Please try again.');
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
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Film size={18} aria-hidden="true" />
                  Generate Promo Video
                </h2>
                <p className="mt-1 text-sm text-text-muted">
                  Queue a product demo video from the live product and founder-approved options.
                </p>
              </div>
              <DialogClose
                type="button"
                className="text-text-muted hover:text-text-primary text-lg leading-none transition-colors"
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

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Goal</span>
                  <select
                    value={goal}
                    onChange={(event) => handleGoalChange(event.target.value as PromoVideoGoal)}
                    className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                  >
                    {goals.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Length</span>
                  <select
                    value={duration}
                    onChange={(event) => setDuration(Number(event.target.value) as PromoVideoDuration)}
                    className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                  >
                    {durations.map((item) => <option key={item} value={item}>{item}s</option>)}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Format</span>
                  <select
                    value={aspectRatio}
                    onChange={(event) => setAspectRatio(event.target.value as PromoVideoAspectRatio)}
                    className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                  >
                    {aspects.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Style</span>
                  <select
                    value={style}
                    onChange={(event) => setStyle(event.target.value as PromoVideoStyle)}
                    className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                  >
                    {styles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Voice</span>
                  <select
                    value={voiceMode}
                    onChange={(event) => setVoiceMode(event.target.value as PromoVideoVoiceMode)}
                    className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                  >
                    {voiceModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Visuals</span>
                  <select
                    value={visualMode}
                    onChange={(event) => setVisualMode(event.target.value as PromoVideoVisualMode)}
                    className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                  >
                    {visualModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">CTA</span>
                  <input
                    type="text"
                    value={cta}
                    onChange={(event) => setCta(event.target.value)}
                    placeholder={defaultCta || 'Try the product'}
                    className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-baljia-gold/40"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm">
                <span className="text-text-secondary">Estimated credits</span>
                <strong className="text-text-primary">{credits}</strong>
              </div>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleClose(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Wand2 size={16} aria-hidden="true" />}
              Generate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
