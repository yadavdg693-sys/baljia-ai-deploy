// BaljiaMascot — uses real mascot.png image instead of emojis (FIXED).
// Place mascot.png in /public/mascot.png

'use client';

import { cn } from '@/lib/utils';
import type { BaljiaState, BaljiaStatus } from '@/types';

const STATE_CONFIG: Record<BaljiaState, { label: string; glowColor: string; pulseClass: string }> = {
  listening:     { label: 'Listening',      glowColor: 'rgba(225,177,44,0.3)',  pulseClass: '' },
  planning:      { label: 'Planning',       glowColor: 'rgba(139,92,246,0.3)',  pulseClass: '' },
  running:       { label: 'Running',        glowColor: 'rgba(225,177,44,0.4)',  pulseClass: 'animate-pulse' },
  investigating: { label: 'Investigating',  glowColor: 'rgba(236,72,153,0.3)',  pulseClass: '' },
  blocked:       { label: 'Blocked',        glowColor: 'rgba(245,158,11,0.3)',  pulseClass: '' },
  resolved:      { label: 'Resolved',       glowColor: 'rgba(34,197,94,0.3)',   pulseClass: '' },
  growth_mode:   { label: 'Growth Mode',    glowColor: 'rgba(225,177,44,0.4)',  pulseClass: '' },
};

const STATE_COLORS: Record<BaljiaState, string> = {
  listening:     'text-baljia-gold',
  planning:      'text-status-planning',
  running:       'text-status-running',
  investigating: 'text-status-investigating',
  blocked:       'text-status-blocked',
  resolved:      'text-status-success',
  growth_mode:   'text-baljia-gold',
};

type BaljiaSize = 'chat' | 'header' | 'dashboard' | 'live-wall' | 'hero';

const SIZE_MAP: Record<BaljiaSize, string> = {
  'chat':      'w-10 h-10',
  'header':    'w-12 h-12',
  'dashboard': 'w-28 h-28',
  'live-wall': 'w-[152px] h-[152px]',
  'hero':      'w-[220px] h-[220px]',
};

interface BaljiaMascotProps {
  status: BaljiaStatus;
  size?: BaljiaSize;
  showLabel?: boolean;
  showDetail?: boolean;
  className?: string;
}

export function BaljiaMascot({
  status,
  size = 'dashboard',
  showLabel = true,
  showDetail = true,
  className,
}: BaljiaMascotProps) {
  const config = STATE_CONFIG[status.state];
  const colorClass = STATE_COLORS[status.state];

  return (
    <div className={cn('flex items-center gap-4', className)}>
      {/* Mascot avatar — real image with state-driven glow */}
      <div className={cn(
        SIZE_MAP[size],
        'relative rounded-2xl flex items-center justify-center',
        'transition-all duration-500',
      )}>
        <img
          src="/mascot.png"
          alt={`Baljia — ${config.label}`}
          className={cn('w-full h-full object-contain', config.pulseClass)}
          style={{
            filter: `drop-shadow(0 4px 16px ${config.glowColor}) brightness(1.08) saturate(1.2)`,
          }}
        />

        {/* Subtle pulse ring when running */}
        {status.state === 'running' && (
          <div
            className="absolute inset-0 rounded-2xl animate-ping"
            style={{
              border: '2px solid rgba(225,177,44,0.25)',
              animationDuration: '2s',
            }}
          />
        )}
      </div>

      {/* Text — meaning layer */}
      {(showLabel || showDetail) && (
        <div className="flex flex-col gap-0.5">
          {showLabel && (
            <span className={cn('font-semibold text-sm', colorClass)}>
              {status.label}
            </span>
          )}
          {showDetail && (
            <span className="text-xs text-text-muted">
              {status.detail}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
