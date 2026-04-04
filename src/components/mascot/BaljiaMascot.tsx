'use client';

import { cn } from '@/lib/utils';
import type { BaljiaState, BaljiaStatus } from '@/types';

const STATE_CONFIG: Record<BaljiaState, { emoji: string; color: string; glow: string }> = {
  listening:     { emoji: '👁️',  color: 'text-baljia-gold',      glow: 'shadow-baljia-gold/20' },
  planning:      { emoji: '🧠',  color: 'text-status-planning',   glow: 'shadow-status-planning/20' },
  running:       { emoji: '⚡',  color: 'text-status-running',    glow: 'shadow-status-running/20' },
  investigating: { emoji: '🔍',  color: 'text-status-investigating', glow: 'shadow-status-investigating/20' },
  blocked:       { emoji: '⏸️',  color: 'text-status-blocked',    glow: 'shadow-status-blocked/20' },
  resolved:      { emoji: '✅',  color: 'text-status-success',    glow: 'shadow-status-success/20' },
  growth_mode:   { emoji: '📈',  color: 'text-baljia-gold',      glow: 'shadow-baljia-gold/20' },
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
  className 
}: BaljiaMascotProps) {
  const config = STATE_CONFIG[status.state];
  
  return (
    <div className={cn('flex items-center gap-4', className)}>
      {/* Mascot avatar — state-driven */}
      <div className={cn(
        SIZE_MAP[size],
        'relative rounded-2xl bg-surface-card border border-border-default flex items-center justify-center',
        'transition-all duration-500',
        config.glow,
        'shadow-lg'
      )}>
        <span className={cn(
          'transition-transform duration-300',
          size === 'chat' ? 'text-lg' : size === 'header' ? 'text-xl' : size === 'dashboard' ? 'text-5xl' : 'text-6xl'
        )}>
          {config.emoji}
        </span>
        
        {/* Subtle pulse animation when running */}
        {status.state === 'running' && (
          <div className="absolute inset-0 rounded-2xl border-2 border-status-running/30 animate-ping" />
        )}
      </div>
      
      {/* Text — meaning layer (separate from image) */}
      {(showLabel || showDetail) && (
        <div className="flex flex-col gap-0.5">
          {showLabel && (
            <span className={cn('font-semibold text-sm', config.color)}>
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
