// Billing Service — migrated to Drizzle + Neon
import Stripe from 'stripe';
import { db, subscriptions, companies, users } from '@/lib/db';
import { eq } from 'drizzle-orm';
import * as creditService from '@/lib/services/credit.service';
import * as eventService from '@/lib/services/event.service';
import { createLogger } from '@/lib/logger';
import type { PlanTier } from '@/types';

const log = createLogger('Billing');

export const PLAN_CONFIG: Record<PlanTier, {
  name: string; monthlyCredits: number; nightShifts: number; stripePriceId: string | null; priceMonthly: number;
}> = {
  trial:   { name: 'Trial',   monthlyCredits: 10,  nightShifts: 3,  stripePriceId: null, priceMonthly: 0 },
  starter: { name: 'Starter', monthlyCredits: 50,  nightShifts: 10, stripePriceId: process.env.STRIPE_PRICE_STARTER ?? null, priceMonthly: 4900 },
  growth:  { name: 'Growth',  monthlyCredits: 150, nightShifts: 20, stripePriceId: process.env.STRIPE_PRICE_GROWTH ?? null,  priceMonthly: 9900 },
  scale:   { name: 'Scale',   monthlyCredits: 500, nightShifts: 30, stripePriceId: process.env.STRIPE_PRICE_SCALE ?? null,   priceMonthly: 29900 },
};

export const CREDIT_PACKAGES = [
  { credits: 10,  priceId: process.env.STRIPE_PRICE_CREDITS_10  ?? null, priceUsd: 990 },
  { credits: 50,  priceId: process.env.STRIPE_PRICE_CREDITS_50  ?? null, priceUsd: 3900 },
  { credits: 100, priceId: process.env.STRIPE_PRICE_CREDITS_100 ?? null, priceUsd: 6900 },
];

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  return new Stripe(key, { apiVersion: '2025-02-24.acacia' });
}

export async function createCheckoutSession(companyId: string, planTier: Exclude<PlanTier, 'trial'>, returnUrl: string): Promise<{ url: string }> {
  const stripe = getStripe();
  const plan = PLAN_CONFIG[planTier];
  if (!plan.stripePriceId) throw new Error(`No Stripe price configured for plan: ${planTier}`);

  const customerId = await getOrCreateCustomer(companyId, stripe);
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    mode: 'subscription',
    success_url: `${returnUrl}?success=1&plan=${planTier}`,
    cancel_url: `${returnUrl}?cancelled=1`,
    metadata: { company_id: companyId, plan_tier: planTier },
    subscription_data: { metadata: { company_id: companyId, plan_tier: planTier } },
  });

  log.info('Checkout session created', { companyId, planTier, sessionId: session.id });
  return { url: session.url! };
}

export async function createCreditPurchaseSession(companyId: string, credits: number, returnUrl: string): Promise<{ url: string }> {
  const stripe = getStripe();
  const pkg = CREDIT_PACKAGES.find((p) => p.credits === credits);
  const customerId = await getOrCreateCustomer(companyId, stripe);

  if (!pkg?.priceId) {
    const session = await stripe.checkout.sessions.create({
      customer: customerId, payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'usd', product_data: { name: `${credits} Baljia Credits` }, unit_amount: Math.round(pkg?.priceUsd ?? credits * 99) }, quantity: 1 }],
      mode: 'payment', success_url: `${returnUrl}?success=1&credits=${credits}`, cancel_url: `${returnUrl}?cancelled=1`,
      metadata: { company_id: companyId, credits: String(credits) },
    });
    return { url: session.url! };
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId, payment_method_types: ['card'],
    line_items: [{ price: pkg.priceId, quantity: 1 }],
    mode: 'payment', success_url: `${returnUrl}?success=1&credits=${credits}`, cancel_url: `${returnUrl}?cancelled=1`,
    metadata: { company_id: companyId, credits: String(credits) },
  });
  return { url: session.url! };
}

export async function createBillingPortalSession(companyId: string, returnUrl: string): Promise<{ url: string }> {
  const stripe = getStripe();
  const [sub] = await db.select({ stripe_customer_id: subscriptions.stripe_customer_id })
    .from(subscriptions).where(eq(subscriptions.company_id, companyId)).limit(1);

  if (!sub?.stripe_customer_id) throw new Error('No billing record found for this company');

  const session = await stripe.billingPortal.sessions.create({ customer: sub.stripe_customer_id, return_url: returnUrl });
  return { url: session.url };
}

export async function handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
  const companyId = subscription.metadata?.company_id;
  const planTier = (subscription.metadata?.plan_tier as PlanTier) ?? 'starter';
  if (!companyId) return;

  const plan = PLAN_CONFIG[planTier];

  // Resolve owner_id from company for the user_id FK
  const [companyRow] = await db.select({ owner_id: companies.owner_id })
    .from(companies).where(eq(companies.id, companyId)).limit(1);
  const ownerId = companyRow?.owner_id;
  if (!ownerId) { log.error('handleSubscriptionCreated: company not found', { companyId }); return; }

  // Upsert subscription. There's no DB-level unique constraint on company_id,
  // so we manually check-then-update or insert (instead of onConflictDoUpdate).
  // After company.service.createCompany provisions a trial row, the typical
  // path here is UPDATE: promote the trial row into a paid subscription.
  const [existing] = await db.select({ id: subscriptions.id })
    .from(subscriptions).where(eq(subscriptions.company_id, companyId)).limit(1);

  if (existing) {
    await db.update(subscriptions).set({
      stripe_customer_id: subscription.customer as string,
      stripe_subscription_id: subscription.id,
      plan_type: planTier,
      status: mapStripeStatus(subscription.status),
      night_shifts_total: plan.nightShifts,
      night_shifts_remaining: plan.nightShifts,
      current_period_start: new Date(subscription.current_period_start * 1000),
      current_period_end: new Date(subscription.current_period_end * 1000),
    }).where(eq(subscriptions.id, existing.id));
  } else {
    await db.insert(subscriptions).values({
      user_id: ownerId,
      company_id: companyId,
      stripe_customer_id: subscription.customer as string,
      stripe_subscription_id: subscription.id,
      plan_type: planTier,
      status: mapStripeStatus(subscription.status),
      night_shifts_total: plan.nightShifts,
      night_shifts_remaining: plan.nightShifts,
      current_period_start: new Date(subscription.current_period_start * 1000),
      current_period_end: new Date(subscription.current_period_end * 1000),
    });
  }

  await db.update(companies).set({ plan_tier: planTier, lifecycle: 'full_active', billing_state: 'active' }).where(eq(companies.id, companyId));
  await creditService.addCredit(companyId, plan.monthlyCredits, 'monthly_grant', `${plan.name} plan — monthly credit grant`);
  await eventService.emit(companyId, 'credit_purchased', { type: 'subscription_activated', plan: planTier, credits_granted: plan.monthlyCredits });
  log.info('Subscription created', { companyId, planTier, credits: plan.monthlyCredits });
}

export async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const companyId = subscription.metadata?.company_id;
  if (!companyId) return;

  const status = mapStripeStatus(subscription.status);
  await db.update(subscriptions).set({
    status,
    current_period_start: new Date(subscription.current_period_start * 1000),
    current_period_end: new Date(subscription.current_period_end * 1000),
  }).where(eq(subscriptions.company_id, companyId));

  if (status === 'past_due' || status === 'cancelled') {
    await db.update(companies).set({ execution_state: 'suspended' }).where(eq(companies.id, companyId));
    log.warn('Company execution suspended due to billing', { companyId, status });
  } else if (status === 'active') {
    await db.update(companies).set({ execution_state: 'active' }).where(eq(companies.id, companyId));
  }
}

export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const companyId = subscription.metadata?.company_id;
  if (!companyId) return;

  await db.update(subscriptions).set({ status: 'cancelled' }).where(eq(subscriptions.company_id, companyId));
  await db.update(companies).set({ plan_tier: 'trial', lifecycle: 'trial_expired', execution_state: 'suspended', billing_state: 'cancelled' }).where(eq(companies.id, companyId));
  log.info('Subscription cancelled', { companyId });
}

export async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  if (invoice.billing_reason !== 'subscription_cycle') return;
  const subscriptionId = invoice.subscription as string;
  if (!subscriptionId) return;

  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const companyId = sub.metadata?.company_id;
  const planTier = (sub.metadata?.plan_tier as PlanTier) ?? 'starter';
  if (!companyId) return;

  const plan = PLAN_CONFIG[planTier];
  await creditService.addCredit(companyId, plan.monthlyCredits, 'monthly_grant', `${plan.name} plan — monthly renewal`);
  await db.update(subscriptions).set({ night_shifts_remaining: plan.nightShifts }).where(eq(subscriptions.company_id, companyId));
  log.info('Monthly credits granted', { companyId, planTier, credits: plan.monthlyCredits });
}

export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoice.subscription as string;
  if (!subscriptionId) return;

  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const companyId = sub.metadata?.company_id;
  if (!companyId) return;

  await db.update(subscriptions).set({ status: 'past_due' }).where(eq(subscriptions.company_id, companyId));
  log.warn('Invoice payment failed', { companyId });
}

async function getOrCreateCustomer(companyId: string, stripe: Stripe): Promise<string> {
  // After company.service.createCompany provisions a trial row, this query
  // should always return an existing subscription. If no row exists (legacy
  // companies created before that change), we INSERT a fresh trial row.
  const [sub] = await db.select({
    id: subscriptions.id,
    stripe_customer_id: subscriptions.stripe_customer_id,
  })
    .from(subscriptions).where(eq(subscriptions.company_id, companyId)).limit(1);

  if (sub?.stripe_customer_id) return sub.stripe_customer_id;

  const [company] = await db.select({ name: companies.name, owner_id: companies.owner_id })
    .from(companies).where(eq(companies.id, companyId)).limit(1);

  let email: string | undefined;
  if (company?.owner_id) {
    const [user] = await db.select({ email: users.email })
      .from(users).where(eq(users.id, company.owner_id)).limit(1);
    email = user?.email ?? undefined;
  }

  const customer = await stripe.customers.create({ email, name: company?.name ?? undefined, metadata: { company_id: companyId } });

  if (sub) {
    // Trial row already exists — fill in the stripe_customer_id only.
    await db.update(subscriptions)
      .set({ stripe_customer_id: customer.id })
      .where(eq(subscriptions.id, sub.id));
  } else {
    // Legacy fallback: no trial row exists — create a full trial record.
    const ownerId = company?.owner_id ?? companyId;
    await db.insert(subscriptions).values({
      user_id: ownerId,
      company_id: companyId,
      stripe_customer_id: customer.id,
      plan_type: 'trial',
      status: 'active',
      night_shifts_total: 3,
      night_shifts_remaining: 3,
    });
  }

  return customer.id;
}

function mapStripeStatus(status: Stripe.Subscription.Status): 'active' | 'past_due' | 'cancelled' {
  switch (status) {
    case 'active': return 'active';
    case 'past_due': return 'past_due';
    case 'canceled': return 'cancelled';
    default: return 'past_due';
  }
}
