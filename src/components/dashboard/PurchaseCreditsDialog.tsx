'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

interface PurchaseCreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentBalance: number;
}

const CREDIT_PACKS = [
  {
    credits: 30,
    price: 49,
    label: 'Starter',
    perCredit: '1.63',
    popular: false,
    description: 'Perfect for a focused sprint',
  },
  {
    credits: 100,
    price: 99,
    label: 'Growth',
    perCredit: '0.99',
    popular: true,
    description: 'Best value for active builders',
  },
  {
    credits: 300,
    price: 249,
    label: 'Scale',
    perCredit: '0.83',
    popular: false,
    description: 'For teams shipping fast',
  },
];

export function PurchaseCreditsDialog({ open, onOpenChange, currentBalance }: PurchaseCreditsDialogProps) {
  const [selectedPack, setSelectedPack] = useState(1); // Default to Growth
  const [purchasing, setPurchasing] = useState(false);

  const handlePurchase = async () => {
    setPurchasing(true);
    try {
      // C2 FIX: Wire to real Stripe checkout
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'credits',
          credits: CREDIT_PACKS[selectedPack].credits,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Payment service unavailable' }));
        alert(data.error ?? 'Failed to create checkout session');
        return;
      }

      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      } else {
        alert('Failed to create checkout session');
      }
    } catch {
      alert('Network error — please try again');
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Purchase Credits</h2>
              <p className="text-sm text-text-muted mt-1">Current balance: <span className="text-baljia-gold font-medium">{currentBalance} credits</span></p>
            </div>
            <DialogClose className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none">
              ✕
            </DialogClose>
          </div>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-3">
            {CREDIT_PACKS.map((pack, index) => (
              <button
                key={pack.label}
                onClick={() => setSelectedPack(index)}
                className={`
                  w-full text-left p-4 rounded-xl border-2 transition-all duration-200 relative
                  ${selectedPack === index
                    ? 'border-baljia-gold bg-baljia-gold/5'
                    : 'border-border-default hover:border-border-active/50 bg-surface-secondary'
                  }
                `}
              >
                {/* Popular badge */}
                {pack.popular && (
                  <span className="absolute -top-2.5 right-3 text-xs px-2 py-0.5 rounded-full bg-baljia-gold text-surface-primary font-semibold">
                    Best Value
                  </span>
                )}

                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-text-primary">{pack.label}</span>
                      <span className="text-xs text-text-muted">· ${pack.perCredit}/credit</span>
                    </div>
                    <p className="text-xs text-text-muted mt-1">{pack.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-text-primary">{pack.credits}</p>
                    <p className="text-xs text-text-muted">credits</p>
                  </div>
                </div>

                {/* Price */}
                <div className="mt-3 pt-3 border-t border-border-subtle flex items-center justify-between">
                  <span className="text-sm text-text-secondary">
                    New balance: <span className="text-baljia-gold font-medium">{currentBalance + pack.credits}</span>
                  </span>
                  <span className="text-lg font-bold text-text-primary">${pack.price}</span>
                </div>
              </button>
            ))}
          </div>

          {/* How credits work */}
          <div className="mt-4 p-3 rounded-lg bg-surface-tertiary">
            <p className="text-xs text-text-muted">
              <strong className="text-text-secondary">How credits work:</strong> 1 credit = 1 task (up to 4 hours of AI work).
              Credits don&apos;t expire. Unused credits carry over monthly.
            </p>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            isLoading={purchasing}
            onClick={handlePurchase}
          >
            Buy {CREDIT_PACKS[selectedPack].credits} credits · ${CREDIT_PACKS[selectedPack].price}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
