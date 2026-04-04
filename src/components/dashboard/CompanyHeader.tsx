'use client';

import type { Company } from '@/types';
import { Badge } from '@/components/ui/Badge';

interface CompanyHeaderProps {
  company: Company;
}

export function CompanyHeader({ company }: CompanyHeaderProps) {
  const stageVariants: Record<string, 'default' | 'planning' | 'running' | 'success'> = {
    early: 'planning',
    validation: 'planning',
    monetization: 'running',
    retention: 'running',
    scale: 'success',
    compounding: 'success',
  };

  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{company.name}</h1>
        {company.one_liner && (
          <p className="text-text-secondary mt-1 text-sm">{company.one_liner}</p>
        )}
      </div>
      <Badge variant={stageVariants[company.company_stage] ?? 'default'} size="md" className="capitalize shrink-0">
        {company.company_stage}
      </Badge>
    </div>
  );
}
