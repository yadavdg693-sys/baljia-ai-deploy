'use client';

interface CreditQuoteCardProps {
  balance: number;
  estimatedCost?: number;
}

export function CreditQuoteCard({ balance, estimatedCost = 1 }: CreditQuoteCardProps) {
  const sufficient = balance >= estimatedCost;

  return (
    <div className="rounded-lg bg-surface-secondary border border-border-default p-3 my-2" id="credit-quote-card">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Credit Quote</span>
        {!sufficient && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium animate-pulse">
            Insufficient
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-3">
        <div>
          <p className="text-xs text-text-muted">Balance</p>
          <p className={`text-lg font-bold ${sufficient ? 'text-baljia-gold' : 'text-red-400'}`}>
            {balance}
          </p>
        </div>
        <div className="text-text-muted">→</div>
        <div>
          <p className="text-xs text-text-muted">Cost</p>
          <p className="text-lg font-bold text-text-primary">{estimatedCost}</p>
        </div>
        <div className="text-text-muted">→</div>
        <div>
          <p className="text-xs text-text-muted">After</p>
          <p className={`text-lg font-bold ${sufficient ? 'text-green-400' : 'text-red-400'}`}>
            {balance - estimatedCost}
          </p>
        </div>
      </div>
      {!sufficient && (
        <p className="text-xs text-red-400 mt-2">
          Purchase more credits to continue.
        </p>
      )}
    </div>
  );
}
