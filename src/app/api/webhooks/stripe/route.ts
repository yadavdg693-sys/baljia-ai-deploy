import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import * as creditService from '@/lib/services/credit.service';
import * as eventService from '@/lib/services/event.service';
import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
} from '@/lib/services/billing.service';
import { db, platformEvents, referrals, users, companies } from '@/lib/db';
import { eq, and, sql } from 'drizzle-orm';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Simple in-DB deduplication for Stripe event IDs
async function isEventProcessed(eventId: string): Promise<boolean> {
  const [existing] = await db.select({ id: platformEvents.id })
    .from(platformEvents)
    .where(sql`${platformEvents.payload}->>'stripe_event_id' = ${eventId}`)
    .limit(1);
  return !!existing;
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err instanceof Error ? err.message : 'Unknown');
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
  }

  // Deduplication: skip if we've already processed this event
  if (await isEventProcessed(event.id)) {
    return NextResponse.json({ received: true, deduplicated: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const companyId = session.metadata?.company_id;
        const credits = parseInt(session.metadata?.credits ?? '0', 10);

        // One-time credit purchase (mode: payment)
        if (companyId && credits > 0 && session.mode === 'payment') {
          await creditService.addCredit(
            companyId,
            credits,
            'addon_purchase',
            `Purchased ${credits} credits via Stripe`
          );
          await eventService.emit(companyId, 'credit_purchased', {
            amount: credits,
            stripe_session_id: session.id,
          });
        }
        break;
      }

      case 'customer.subscription.created': {
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription);

        // Referral claim flow: grant 25 credits to referrer on first subscription
        // Spec: "25 credits on subscription" (referrals table, Domain 8.4)
        const sub = event.data.object as Stripe.Subscription;
        const subscriberEmail = (sub.metadata?.user_email ?? '') as string;
        if (subscriberEmail) {
          const [referredUser] = await db
            .select({ id: users.id, referred_by: users.referred_by })
            .from(users)
            .where(eq(users.email, subscriberEmail))
            .limit(1);

          if (referredUser?.referred_by) {
            // Find the pending referral record
            const [referral] = await db
              .select({ id: referrals.id, referrer_id: referrals.referrer_id })
              .from(referrals)
              .where(and(
                eq(referrals.referred_id, referredUser.id),
                eq(referrals.status, 'trial'), // trial → subscribed
              ))
              .limit(1);

            if (referral) {
              // Get referrer's company to credit
              const [referrerCompany] = await db
                .select({ id: companies.id })
                .from(companies)
                .where(eq(companies.owner_id, referral.referrer_id))
                .orderBy(companies.created_at)
                .limit(1);

              if (referrerCompany) {
                await creditService.addCredit(
                  referrerCompany.id,
                  25,
                  'referral_bonus',
                  `Referral reward: your referred user subscribed`,
                );

                // Mark referral as credited
                await db.update(referrals)
                  .set({ status: 'credited', credits_awarded: 25, converted_at: new Date() })
                  .where(eq(referrals.id, referral.id));

                await eventService.emit(referrerCompany.id, 'referral_credited', {
                  referred_user_email: subscriberEmail,
                  credits: 25,
                });
              }
            }
          }
        }
        break;
      }

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        // Acknowledge unhandled events
        break;
    }

    // Record that we processed this event (for deduplication)
    await db.insert(platformEvents).values({
      event_type: 'stripe_webhook_processed',
      company_id: null,
      payload: { stripe_event_id: event.id, stripe_event_type: event.type },
      is_public_safe: false,
    });
  } catch (err) {
    console.error('[Stripe Webhook] Handler error:', err instanceof Error ? err.message : 'Unknown');
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
