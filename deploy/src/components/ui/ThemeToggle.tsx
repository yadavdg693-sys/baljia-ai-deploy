// ThemeToggle — client component for dark/light switching.
// Persists preference to localStorage, respects system preference on first visit.
// Drop this into src/components/ui/ThemeToggle.tsx

'use client';

import { useEffect, useState, useCallback } from 'react';

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Check saved preference, then system preference
    const saved = localStorage.getItem('baljia-theme');
    if (saved === 'dark') {
      document.body.classList.add('dark');
      setDark(true);
    } else if (saved === 'light') {
      document.body.classList.remove('dark');
      setDark(false);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.body.classList.add('dark');
      setDark(true);
    }
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    if (next) {
      document.body.classList.add('dark');
      localStorage.setItem('baljia-theme', 'dark');
    } else {
      document.body.classList.remove('dark');
      localStorage.setItem('baljia-theme', 'light');
    }
  }, [dark]);

  // Avoid hydration mismatch — render nothing until mounted
  if (!mounted) {
    return (
      <button className={`theme-toggle ${className ?? ''}`} aria-label="Toggle theme" title="Toggle theme">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>
    );
  }

  return (
    <button
      className={`theme-toggle ${className ?? ''}`}
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? (
        // Sun icon
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        // Moon icon
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
