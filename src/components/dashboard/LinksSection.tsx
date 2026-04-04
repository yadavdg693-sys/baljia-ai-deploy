'use client';

interface LinksSectionProps {
  companyName: string;
  subdomain: string | null;
  customDomain: string | null;
}

export function LinksSection({ companyName, subdomain, customDomain }: LinksSectionProps) {
  const url = customDomain
    ? `https://${customDomain}`
    : subdomain
      ? `https://${subdomain}`
      : null;

  if (!url) return null;

  return (
    <div className="rounded-xl bg-surface-card border border-border-default p-4">
      <h3 className="text-sm font-semibold text-text-primary mb-3">Links</h3>
      <div>
        <p className="text-sm font-medium text-text-primary">{companyName}</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-baljia-gold hover:underline"
        >
          {url}
        </a>
      </div>
    </div>
  );
}
