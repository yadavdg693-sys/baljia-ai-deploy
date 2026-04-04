// Meta Pixel / Conversions API (CAPI) — Server-side event tracking
// Sends conversion events to Meta for ad optimization and attribution
//
// Env: META_PIXEL_ID, META_CAPI_ACCESS_TOKEN

import { createLogger } from '@/lib/logger';
import crypto from 'crypto';

const log = createLogger('MetaPixel');

const CAPI_BASE = 'https://graph.facebook.com/v21.0';

export function isMetaPixelConfigured(): boolean {
  return !!(process.env.META_PIXEL_ID && process.env.META_CAPI_ACCESS_TOKEN);
}

// ══════════════════════════════════════════════
// HASHING — Meta requires SHA-256 for PII
// ══════════════════════════════════════════════

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

// ══════════════════════════════════════════════
// EVENT TYPES
// ══════════════════════════════════════════════

type MetaEventName =
  | 'PageView'
  | 'Lead'
  | 'CompleteRegistration'
  | 'Subscribe'
  | 'Purchase'
  | 'InitiateCheckout'
  | 'ViewContent'
  | 'StartTrial'
  | 'Contact';

interface UserData {
  email?: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  fbp?: string;   // _fbp cookie
  fbc?: string;   // _fbc cookie
}

interface EventOptions {
  eventName: MetaEventName;
  userData: UserData;
  customData?: Record<string, unknown>;
  eventSourceUrl?: string;
  testEventCode?: string;  // For testing in Meta Events Manager
}

// ══════════════════════════════════════════════
// SEND EVENT — POST to Conversions API
// ══════════════════════════════════════════════

export async function sendEvent(options: EventOptions): Promise<{ eventsReceived: number }> {
  if (!isMetaPixelConfigured()) {
    log.debug('Meta Pixel not configured, event skipped', { event: options.eventName });
    return { eventsReceived: 0 };
  }

  const pixelId = process.env.META_PIXEL_ID!;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN!;

  // Build user_data with hashed PII
  const userData: Record<string, string> = {};
  if (options.userData.email) userData.em = [sha256(options.userData.email)].toString();
  if (options.userData.userId) userData.external_id = [sha256(options.userData.userId)].toString();
  if (options.userData.ip) userData.client_ip_address = options.userData.ip;
  if (options.userData.userAgent) userData.client_user_agent = options.userData.userAgent;
  if (options.userData.fbp) userData.fbp = options.userData.fbp;
  if (options.userData.fbc) userData.fbc = options.userData.fbc;

  const eventPayload = {
    event_name: options.eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website' as const,
    event_source_url: options.eventSourceUrl,
    user_data: userData,
    custom_data: options.customData,
  };

  const body: Record<string, unknown> = {
    data: [eventPayload],
    access_token: accessToken,
  };

  if (options.testEventCode) {
    body.test_event_code = options.testEventCode;
  }

  try {
    const response = await fetch(`${CAPI_BASE}/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await response.json() as { events_received?: number; error?: { message: string } };

    if (!response.ok) {
      log.error('Meta CAPI error', { event: options.eventName, error: result.error?.message });
      return { eventsReceived: 0 };
    }

    log.info('Meta event sent', { event: options.eventName, received: result.events_received });
    return { eventsReceived: result.events_received ?? 0 };
  } catch (error) {
    log.error('Meta CAPI request failed', { event: options.eventName }, error);
    return { eventsReceived: 0 };
  }
}

// ══════════════════════════════════════════════
// CONVENIENCE — pre-built events
// ══════════════════════════════════════════════

export async function trackRegistration(userData: UserData, planName?: string) {
  return sendEvent({
    eventName: 'CompleteRegistration',
    userData,
    customData: planName ? { content_name: planName } : undefined,
  });
}

export async function trackSubscription(userData: UserData, value: number, currency = 'USD') {
  return sendEvent({
    eventName: 'Subscribe',
    userData,
    customData: { value, currency },
  });
}

export async function trackPurchase(userData: UserData, value: number, currency = 'USD') {
  return sendEvent({
    eventName: 'Purchase',
    userData,
    customData: { value, currency },
  });
}

export async function trackLead(userData: UserData, source?: string) {
  return sendEvent({
    eventName: 'Lead',
    userData,
    customData: source ? { content_name: source } : undefined,
  });
}

export async function trackTrial(userData: UserData) {
  return sendEvent({ eventName: 'StartTrial', userData });
}
