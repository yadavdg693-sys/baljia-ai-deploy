// DashboardMenu — Polsia reference dropdown popover.
// Uses .menu-popover / .menu-popover__row classes from polsia-shell.css.

'use client';

import Link from 'next/link';
import type { Company, User } from '@/types';

interface DashboardMenuProps {
  user: User;
  company: Company;
  creditBalance: number;
  onClose: () => void;
  onOpenUpgrade: () => void;
  onOpenPurchase: () => void;
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

export function DashboardMenu({
  user: _user,
  company: _company,
  creditBalance,
  onClose,
  onOpenUpgrade,
  onOpenPurchase,
}: DashboardMenuProps) {
  return (
    <>
      <div className="menu-popover-backdrop" onClick={onClose} role="presentation" />
      <div className="menu-popover" role="menu">
        <Link
          className="menu-popover__row"
          href="/portfolio"
          onClick={onClose}
        >
          <span>My Portfolio</span>
        </Link>
        <Link
          className="menu-popover__row"
          href="/onboarding"
          onClick={onClose}
        >
          <span>New Company</span>
        </Link>
        <div className="menu-popover__row menu-popover__row--static">
          <span>Task Credits</span>
          <strong>{creditBalance}</strong>
        </div>
        <button
          className="menu-popover__row"
          onClick={onOpenPurchase}
          type="button"
        >
          <span>Buy credits</span>
        </button>
        <button
          className="menu-popover__row"
          onClick={onOpenUpgrade}
          type="button"
        >
          <span>Upgrade</span>
        </button>
        <Link className="menu-popover__row" href="/faq" onClick={onClose}>
          <span>FAQ</span>
        </Link>
        <button
          className="menu-popover__row"
          onClick={logout}
          type="button"
        >
          <span>Logout</span>
        </button>
      </div>
    </>
  );
}
