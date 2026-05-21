// Cron: Ad Spend Billing
// Charges unbilled Meta ad spend ledger rows to the company's Stripe customer.
// Auth: x-cron-secret header required.

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, adSpendLedger, platformEvents, subscriptions } from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('Cron:AdSpendBilling');

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  return new Stripe(key, { apiVersion: '2025-02-24.acacia' });
}

function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const cronSecret = request.headers.get('x-cron-secret');
  if (!expected || cronSecret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe is not configured' }, { status: 503 });
  }

  const rows = await db.select({
    id: adSpendLedger.id,
    company_id: adSpendLedger.company_id,
    actual_spend: adSpendLedger.actual_spend,
    platform_fee: adSpendLedger.platform_fee,
    charge_date: adSpendLedger.charge_date,
  })
    .from(adSpendLedger)
    .where(isNull(adSpendLedger.stripe_charge_id))
    .limit(200);

  const byCompany = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCompany.get(row.company_id) ?? [];
    list.push(row);
    byCompany.set(row.company_id, list);
  }

  const stripe = getStripe();
  const results: Array<{ company_id: string; status: string; amount_cents?: number; rows?: number; reason?: string }> = [];

  for (const [companyId, companyRows] of byCompany) {
    const amount = companyRows.reduce((sum, row) => {
      return sum + Number(row.actual_spend ?? 0) + Number(row.platform_fee ?? 0);
    }, 0);
    const amountCents = dollarsToCents(amount);

    if (amountCents < 50) {
      results.push({ company_id: companyId, status: 'skipped', amount_cents: amountCents, rows: companyRows.length, reason: 'below_stripe_minimum' });
      continue;
    }

    const [sub] = await db.select({ stripe_customer_id: subscriptions.stripe_customer_id })
      .from(subscriptions)
      .where(and(eq(subscriptions.company_id, companyId), eq(subscriptions.status, 'active')))
      .limit(1);

    if (!sub?.stripe_customer_id) {
      results.push({ company_id: companyId, status: 'skipped', amount_cents: amountCents, rows: companyRows.length, reason: 'missing_stripe_customer' });
      continue;
    }

    const ledgerIds = companyRows.map((row) => row.id).sort();
    const idempotencyKey = `ad-spend-${companyId}-${ledgerIds.join('-')}`.slice(0, 255);

    try {
      await stripe.invoiceItems.create({
        customer: sub.stripe_customer_id,
        amount: amountCents,
        currency: 'usd',
        description: 'Baljia Meta ads spend and platform fee',
        metadata: {
          company_id: companyId,
          ledger_row_count: String(ledgerIds.length),
          ledger_ids: ledgerIds.join(',').slice(0, 500),
        },
      }, { idempotencyKey: `${idempotencyKey}-item` });

      const invoice = await stripe.invoices.create({
        customer: sub.stripe_customer_id,
        collection_method: 'charge_automatically',
        auto_advance: false,
        metadata: {
          company_id: companyId,
          type: 'meta_ad_spend',
          ledger_row_count: String(ledgerIds.length),
        },
      }, { idempotencyKey: `${idempotencyKey}-invoice` });

      const finalized = await stripe.invoices.finalizeInvoice(invoice.id, {}, { idempotencyKey: `${idempotencyKey}-finalize` });
      const paid = await stripe.invoices.pay(finalized.id, {}, { idempotencyKey: `${idempotencyKey}-pay` });
      const chargeId = (paid as unknown as { charge?: string }).charge ?? paid.id;

      await db.update(adSpendLedger)
        .set({ stripe_charge_id: chargeId })
        .where(inArray(adSpendLedger.id, ledgerIds));

      await db.insert(platformEvents).values({
        company_id: companyId,
        event_type: 'ad_spend_charged',
        payload: {
          stripe_charge_id: chargeId,
          stripe_invoice_id: paid.id,
          amount_cents: amountCents,
          ledger_ids: ledgerIds,
        },
        is_public_safe: false,
      });

      results.push({ company_id: companyId, status: 'charged', amount_cents: amountCents, rows: ledgerIds.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      log.error('Ad spend charge failed', { companyId, amountCents, rows: ledgerIds.length, error: message });
      results.push({ company_id: companyId, status: 'failed', amount_cents: amountCents, rows: ledgerIds.length, reason: message });
    }
  }

  return NextResponse.json({
    ok: true,
    scanned_rows: rows.length,
    charged: results.filter((result) => result.status === 'charged').length,
    results,
  });
}
