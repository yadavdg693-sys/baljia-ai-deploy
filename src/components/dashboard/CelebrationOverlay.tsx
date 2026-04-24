// CelebrationOverlay — brief full-screen confetti moment when a task just
// completed. Mirrors Polsia's milestone celebration but tied to task events
// since we removed the onboarding roadmap. Auto-dismisses after 3.5s.

'use client';

import { useEffect, useState } from 'react';

interface CelebrationOverlayProps {
  taskTitle: string;
  onDismiss: () => void;
}

export function CelebrationOverlay({ taskTitle, onDismiss }: CelebrationOverlayProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300); // wait for fade-out
    }, 3500);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={() => {
        setVisible(false);
        setTimeout(onDismiss, 300);
      }}
      role="dialog"
      aria-live="polite"
    >
      {/* fireworks */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[18%] top-[22%] h-40 w-40 rounded-full bg-baljia-gold/30 blur-3xl animate-pulse" />
        <div className="absolute right-[20%] bottom-[24%] h-48 w-48 rounded-full bg-emerald-400/25 blur-3xl animate-pulse" />
      </div>

      <div className="relative mx-4 max-w-sm rounded-2xl border border-baljia-gold/30 bg-surface-card p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-baljia-gold/15 text-2xl">
          ✓
        </div>
        <p className="text-xs uppercase tracking-wider text-baljia-gold mb-1">Task complete</p>
        <h3 className="text-lg font-semibold text-text-primary leading-snug line-clamp-2">
          {taskTitle}
        </h3>
        <p className="mt-3 text-sm text-text-secondary">
          CEO: Great work. Let&apos;s keep compounding this momentum.
        </p>
      </div>
    </div>
  );
}
