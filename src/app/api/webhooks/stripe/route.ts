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
import { db, platformEvents } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';

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

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

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
