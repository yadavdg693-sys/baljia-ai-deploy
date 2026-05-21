'use client';

import Link from 'next/link';
import type { Company } from '@/types';

interface CompanyHeaderProps {
  company: Company;
}

export function CompanyHeader({ company }: CompanyHeaderProps) {
  const settingsHref = `/dashboard/${company.slug ?? company.id}/settings/payments`;
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{company.name}</h1>
        {company.one_liner && (
          <p className="text-text-secondary mt-1 text-sm">{company.one_liner}</p>
        )}
      </div>
      <Link
        href={settingsHref}
        className="text-xs text-text-muted hover:text-text-primary border border-border-default rounded-md px-2.5 py-1.5"
        title="Connect Stripe / Razorpay to accept payments in your app"
      >
        Payments →
      </Link>
    </div>
  );
}
