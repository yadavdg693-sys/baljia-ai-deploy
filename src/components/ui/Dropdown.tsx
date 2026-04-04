'use client';

import { cn } from '@/lib/utils';
import React, { createContext, useContext, useRef, useEffect, useState } from 'react';

interface DropdownContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DropdownContext = createContext<DropdownContextType | undefined>(undefined);

interface DropdownProps {
  children: React.ReactNode;
}

export function Dropdown({ children }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <DropdownContext.Provider value={{ open, setOpen }}>
      <div ref={ref} className="relative inline-block">
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

interface DropdownTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export function DropdownTrigger({ className, ...props }: DropdownTriggerProps) {
  const context = useContext(DropdownContext);
  if (!context) throw new Error('DropdownTrigger must be used within Dropdown');

  return (
    <button
      onClick={() => context.setOpen(!context.open)}
      className={className}
      {...props}
    />
  );
}

interface DropdownContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function DropdownContent({ className, children, ...props }: DropdownContentProps) {
  const context = useContext(DropdownContext);
  if (!context) throw new Error('DropdownContent must be used within Dropdown');

  if (!context.open) return null;

  return (
    <div
      className={cn(
        'absolute right-0 mt-1 w-48 rounded-lg bg-surface-card border border-border-default shadow-lg z-50',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface DropdownItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export function DropdownItem({ className, ...props }: DropdownItemProps) {
  const context = useContext(DropdownContext);

  return (
    <button
      onClick={(e) => {
        context?.setOpen(false);
        props.onClick?.(e);
      }}
      className={cn(
        'w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-surface-hover transition-colors first:rounded-t-lg last:rounded-b-lg',
        className
      )}
      {...props}
    />
  );
}
