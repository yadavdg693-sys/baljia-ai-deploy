'use client';

import { cn } from '@/lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?:
    | 'default'
    | 'success'
    | 'error'
    | 'warning'
    | 'planning'
    | 'investigating'
    | 'running'
    | 'blocked';
  size?: 'sm' | 'md';
}

const variantStyles = {
  default: 'bg-surface-secondary text-text-secondary',
  success: 'bg-status-success/10 text-status-success',
  error: 'bg-status-error/10 text-status-error',
  warning: 'bg-status-blocked/10 text-status-blocked',
  planning: 'bg-status-planning/10 text-status-planning',
  investigating: 'bg-status-investigating/10 text-status-investigating',
  running: 'bg-status-running/10 text-status-running',
  blocked: 'bg-status-blocked/10 text-status-blocked',
};

const sizeStyles = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
};

export function Badge({
  variant = 'default',
  size = 'sm',
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    />
  );
}
