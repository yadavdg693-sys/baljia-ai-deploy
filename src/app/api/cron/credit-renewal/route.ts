// Cron: Credit Renewal Safety Net
// Runs daily at 4am UTC via Render cron.
// Purpose: catch companies whose Stripe 'invoice.payment_succeeded' webhook was missed
//          and who still have an active subscription but haven't received their monthly credits.
//
// Auth: x-cron-secret header (CRON_SECRET env var)

import { NextRequest, NextResponse } from 'next/server';
import { db, companies, creditLedger } from '@/lib/db';
import { eq, inArray, and, gte, sql } from 'drizzle-orm';
import * as creditService from '@/lib/services/credit.service';
import * as eventService from '@/lib/services/event.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('CronCreditRenewal');

// Credits granted per plan per billing cycle
const PLAN_CREDITS: Record<string, number> = {
  full_active: 50,
  keep_live_active: 5,
  trial_active: 10, // trial allocation (not a real renewal but used as safety net)
};

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Find all active-subscription companies
  let activeCompanies: Array<{ id: string; lifecycle: string | null }>;
  try {
    activeCompanies = await db
      .select({ id: companies.id, lifecycle: companies.lifecycle })
      .from(companies)
      .where(inArray(companies.lifecycle, ['full_active', 'keep_live_active']));
  } catch (err) {
    log.error('Failed to fetch active companies', {}, err);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  const results: Array<{ companyId: string; action: string; credits?: number }> = [];
  const renewalWindowDays = 26; // renew if no credit event in the last 26 days (catch missed webhooks)
  const since = new Date(Date.now() - renewalWindowDays * 24 * 60 * 60 * 1000);

  for (const company of activeCompanies) {
    try {
      // creditLedger uses entry_type with strict union type (LedgerEntryType)
      // 'monthly_grant' = subscription renewal; 'welcome_bonus' = trial start
      const [recentRenewal] = await db
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.company_id, company.id),
            inArray(creditLedger.entry_type, ['monthly_grant', 'welcome_bonus', 'addon_purchase']),
            gte(creditLedger.created_at, since),
          )
        )
        .limit(1);

      if (recentRenewal) {
        // Already renewed this cycle — skip
        results.push({ companyId: company.id, action: 'skipped_already_renewed' });
        continue;
      }

      // No recent renewal — check current balance
      const balance = await creditService.getBalance(company.id);
      if (balance > 0) {
        // Has credits, probably was renewed (just without a ledger entry) — skip
        results.push({ companyId: company.id, action: 'skipped_has_balance' });
        continue;
      }

      // Zero credits + no renewal event + active subscription = missed webhook
      const credits = PLAN_CREDITS[company.lifecycle ?? 'full_active'] ?? 10;
      await creditService.addCredit(
        company.id,
        credits,
        'monthly_grant',  // correct LedgerEntryType for monthly credit renewal
        `Safety-net renewal: ${credits} credits restored (missed Stripe webhook detected)`,
      );

      await eventService.emit(company.id, 'credit_purchased', {
        credits,
        source: 'safety_net_cron',
        lifecycle: company.lifecycle,
      });

      log.warn('Safety-net credit renewal applied', { companyId: company.id, credits, lifecycle: company.lifecycle });
      results.push({ companyId: company.id, action: 'renewed', credits });

    } catch (err) {
      log.error('Credit renewal check failed', { companyId: company.id }, err);
      results.push({ companyId: company.id, action: 'error' });
    }
  }

  const renewed = results.filter((r) => r.action === 'renewed').length;
  const skipped = results.filter((r) => r.action.startsWith('skipped')).length;
  const errors = results.filter((r) => r.action === 'error').length;

  log.info('Credit renewal cron complete', { total: activeCompanies.length, renewed, skipped, errors });

  return NextResponse.json({
    ok: true,
    companies_checked: activeCompanies.length,
    renewed,
    skipped,
    errors,
    results,
  });
}
