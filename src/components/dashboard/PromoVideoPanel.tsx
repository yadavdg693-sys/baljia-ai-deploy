'use client';

import { CheckCircle2, ExternalLink, Film, Loader2, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import type { PromoVideoJob, PromoVideoStatus } from '@/types';

interface PromoVideoPanelProps {
  videos: PromoVideoJob[];
  onCreate: () => void;
  onApproved?: (job: PromoVideoJob) => void;
}

const statusLabels: Record<PromoVideoStatus, string> = {
  queued: 'Queued',
  capturing: 'Studying product',
  writing_script: 'Writing story',
  preview_rendering: 'Creating preview',
  preview_ready: 'Preview ready',
  finalizing: 'Approved',
  rendering: 'Creating video',
  uploading: 'Finishing up',
  ready: 'Ready',
  failed: 'Failed',
};

const visualModeLabels: Record<PromoVideoJob['visual_mode'], string> = {
  actual_site: 'Actual site',
  cinematic: 'Cinematic',
};

function statusClass(status: PromoVideoStatus): string {
  if (status === 'ready') return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
  if (status === 'preview_ready') return 'bg-sky-500/10 text-sky-600 border-sky-500/20';
  if (status === 'failed') return 'bg-red-500/10 text-red-500 border-red-500/20';
  return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
}

function formatAge(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatTokens(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  return `${value}`;
}

export function PromoVideoPanel({ videos, onCreate, onApproved }: PromoVideoPanelProps) {
  const latest = videos.slice(0, 3);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const approve = async (video: PromoVideoJob) => {
    if (approvingId) return;
    setApprovingId(video.id);
    setErrorById((prev) => ({ ...prev, [video.id]: '' }));
    try {
      const response = await fetch(`/api/promo-videos/${video.id}/approve`, { method: 'POST' });
      const payload = await response.json().catch(() => null) as { job?: PromoVideoJob; error?: string } | null;
      if (!response.ok || !payload?.job) {
        throw new Error(payload?.error ?? 'Could not approve this preview.');
      }
      onApproved?.(payload.job);
    } catch (error) {
      setErrorById((prev) => ({
        ...prev,
        [video.id]: error instanceof Error ? error.message : 'Could not approve this preview.',
      }));
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3 rounded-[10px] border border-border-default bg-surface-secondary p-3 shadow-sm">
        <div className="min-w-0">
          <strong className="flex items-center gap-2 text-sm text-text-primary">
            <Film size={15} aria-hidden="true" />
            Promo videos
          </strong>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            {videos.length > 0 ? `${videos.length} generated or queued` : 'No videos yet'}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-baljia-gold px-3 py-1.5 text-xs font-bold text-surface-primary transition-colors hover:bg-baljia-gold-light"
        >
          <PlayCircle size={14} aria-hidden="true" />
          Generate
        </button>
      </div>

      {latest.map((video) => (
        <div key={video.id} className="overflow-hidden rounded-[10px] border border-border-default bg-surface-secondary shadow-sm">
          {(video.status === 'ready' && video.output_url) || (video.status === 'preview_ready' && video.preview_url) ? (
            <video
              src={video.status === 'preview_ready' ? video.preview_url ?? undefined : video.output_url ?? undefined}
              poster={video.thumbnail_url ?? undefined}
              controls
              preload="metadata"
              className="aspect-video w-full bg-black object-cover"
            />
          ) : video.thumbnail_url ? (
            <div
              className="aspect-video w-full bg-black bg-cover bg-center"
              style={{ backgroundImage: `url(${video.thumbnail_url})` }}
              aria-hidden="true"
            />
          ) : null}
          <div className="grid gap-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <strong className="block truncate text-sm text-text-primary">
                  {video.duration_seconds}s {video.aspect_ratio} promo
                </strong>
                <span className="text-xs text-text-muted">
                  {visualModeLabels[video.visual_mode]} - {formatAge(video.created_at)}
                </span>
              </div>
              <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusClass(video.status)}`}>
                {statusLabels[video.status] ?? video.status}
              </span>
            </div>
            {video.ai_usage && video.ai_usage.total_tokens > 0 && (
              <p className="text-xs leading-relaxed text-text-muted">
                AI used: ~{formatTokens(video.ai_usage.total_tokens)} tokens
              </p>
            )}
            {video.status === 'failed' && video.error_message && (
              <p className="text-xs leading-relaxed text-red-400">{video.error_message}</p>
            )}
            {errorById[video.id] && (
              <p className="text-xs leading-relaxed text-red-400">{errorById[video.id]}</p>
            )}
            {video.status === 'preview_ready' && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void approve(video)}
                  disabled={approvingId === video.id}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-baljia-gold px-3 py-1.5 text-xs font-bold text-surface-primary transition-colors hover:bg-baljia-gold-light disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {approvingId === video.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
                  Approve final
                </button>
              </div>
            )}
            {video.status === 'ready' && video.output_url && (
              <a
                href={video.output_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-baljia-gold hover:text-baljia-gold-light"
              >
                <ExternalLink size={13} aria-hidden="true" />
                Open final video
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
