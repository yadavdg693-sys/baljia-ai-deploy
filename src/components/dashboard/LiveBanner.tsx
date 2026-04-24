// LiveBanner — thin banner above the dashboard header that links to /live.
// Mirrors Polsia's founder shell: "Watch Baljia work on N companies live".

import Link from 'next/link';

interface LiveBannerProps {
  liveCount: number;
}

export function LiveBanner({ liveCount }: LiveBannerProps) {
  if (liveCount <= 0) return null;

  const label = liveCount === 1 ? '1 company' : `${liveCount} companies`;

  return (
    <Link
      href="/live"
      className="group flex items-center justify-center gap-2 border-b border-border-default bg-gradient-to-r from-baljia-gold/10 via-baljia-gold/5 to-baljia-gold/10 px-4 py-2 text-xs font-medium text-text-primary transition-colors hover:bg-baljia-gold/15"
    >
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
      />
      <span>
        Watch Baljia work on <strong className="text-baljia-gold">{label}</strong> live
      </span>
      <span
        aria-hidden="true"
        className="text-text-muted transition-transform group-hover:translate-x-1"
      >
        →
      </span>
    </Link>
  );
}
