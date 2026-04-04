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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

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
    // I3 FIX: Log detail internally, return generic error to prevent info leakage
    console.error('[Stripe Webhook] Signature verification failed:', err instanceof Error ? err.message : 'Unknown');
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
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
  } catch (err) {
    // I3 FIX: Log detail internally, return generic error
    console.error('[Stripe Webhook] Handler error:', err instanceof Error ? err.message : 'Unknown');
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
