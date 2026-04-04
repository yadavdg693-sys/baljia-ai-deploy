'use client';

import { useState, useRef, useEffect } from 'react';
import type { Company, User } from '@/types';

interface DashboardHeaderProps {
  company: Company;
  user: User;
  creditBalance: number;
}

export function DashboardHeader({ company, user, creditBalance }: DashboardHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  function handleLogout() {
    fetch('/api/auth/logout', { method: 'POST' }).then(() => {
      window.location.href = '/login';
    });
  }

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-surface-primary sticky top-0 z-20">
      {/* Company name */}
      <h1 className="text-xl font-bold font-[family-name:var(--font-display)] text-text-primary truncate">
        {company.name}
      </h1>

      {/* Right side: + New, Menu */}
      <div className="flex items-center gap-3">
        <button
          className="px-4 py-2 text-sm font-medium rounded-lg border border-border-default bg-surface-card hover:bg-surface-hover text-text-primary transition-colors"
        >
          + New
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-baljia-gold text-surface-primary hover:bg-baljia-gold-light transition-colors"
          >
            Menu ▾
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-surface-card border border-border-default shadow-2xl py-2 animate-fade-in">
              <MenuLink href={`/dashboard/${company.id}`}>My Portfolio</MenuLink>
              <MenuLink href="/onboarding">New Company</MenuLink>

              <div className="my-1 border-t border-border-subtle" />

              <div className="px-4 py-2 flex items-center justify-between text-sm">
                <span className="text-text-secondary">Task Credits</span>
                <span className="text-baljia-gold font-semibold">{creditBalance}</span>
              </div>
              <MenuLink href="#">Upgrade</MenuLink>

              <div className="my-1 border-t border-border-subtle" />

              <MenuLink href="#">Company Settings</MenuLink>
              <MenuLink href="#">Profile Settings</MenuLink>
              <MenuLink href="#">About</MenuLink>
              <MenuLink href="#">FAQ</MenuLink>
              <MenuLink href="#">Refer &amp; Earn</MenuLink>

              <div className="my-1 border-t border-border-subtle" />

              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm text-text-muted hover:text-status-error hover:bg-surface-hover transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="block px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
    >
      {children}
    </a>
  );
}
