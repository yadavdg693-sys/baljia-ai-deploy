'use client';

import { cn } from '@/lib/utils';
import React from 'react';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full px-4 py-2 rounded-lg bg-surface-card border border-border-default text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-active focus:ring-1 focus:ring-baljia-gold/30 transition-colors duration-200 resize-none',
        className
      )}
      {...props}
    />
  )
);

Textarea.displayName = 'Textarea';
