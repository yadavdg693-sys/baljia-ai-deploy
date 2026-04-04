'use client';

import { cn } from '@/lib/utils';
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'w-full px-4 py-2 rounded-lg bg-surface-card border border-border-default text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-active focus:ring-1 focus:ring-baljia-gold/30 transition-colors duration-200',
        className
      )}
      {...props}
    />
  )
);

Input.displayName = 'Input';
