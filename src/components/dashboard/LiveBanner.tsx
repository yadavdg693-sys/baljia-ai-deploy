// LiveBanner — Polsia reference 19px-tall orange strip above the topbar.
// Uses .live-banner class from src/styles/polsia-shell.css.

import Link from 'next/link';

interface LiveBannerProps {
  liveCount: number;
}

export function LiveBanner({ liveCount }: LiveBannerProps) {
  if (liveCount <= 0) return null;
  const label = liveCount === 1 ? '1 companies' : `${liveCount} companies`;

  return (
    <Link className="live-banner" href="/live">
      <span className="live-banner__dot" />
      <span>Watch Baljia work on {label} live</span>
      <span aria-hidden="true">{'->'}</span>
    </Link>
  );
}
