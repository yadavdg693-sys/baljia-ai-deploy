// Postmark inbound email webhook
// Configure in Postmark: Settings → Inbound → Webhook URL → /api/webhooks/email
// Postmark routes inbound mail to this endpoint

import { NextRequest, NextResponse } from 'next/server';
import { handleInboundEmail } from '@/lib/services/email.service';
import { db, companies, contacts } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('WebhookEmail');

export async function POST(request: NextRequest) {
  // Verify webhook authenticity via Postmark's basic auth or shared secret
  const webhookSecret = process.env.POSTMARK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    log.error('POSTMARK_WEBHOOK_SECRET not set — refusing inbound email');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  const authHeader = request.headers.get('authorization');
  const expected = `Basic ${Buffer.from(webhookSecret).toString('base64')}`;
  if (authHeader !== expected) {
    log.warn('Email webhook: invalid auth header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const to = body.To as string;
  const from = body.From as string;
  const subject = (body.Subject as string) ?? '';
  const textBody = (body.TextBody as string) ?? '';
  const messageId = (body.MessageID as string) ?? '';

  if (!to || !from) {
    return NextResponse.json({ error: 'Missing To or From' }, { status: 400 });
  }

  // Route to correct company by To address
  // Convention: companyslug@baljia.app or reply-to includes company ID
  const companyId = await resolveCompanyFromEmail(to);
  if (!companyId) {
    log.warn('Inbound email — company not found', { to });
    return NextResponse.json({ ok: true, skipped: true });
  }

  await handleInboundEmail(
    { From: from, To: to, Subject: subject, TextBody: textBody, MessageID: messageId },
    companyId
  );

  // G-CONTENT-003: CAN-SPAM unsubscribe detection
  const combinedText = `${subject} ${textBody}`.toLowerCase();
  if (combinedText.includes('unsubscribe') || combinedText.includes('opt out') || combinedText.includes('stop emailing')) {
    try {
      await db.update(contacts).set({ lead_status: 'unsubscribed' })
        .where(and(eq(contacts.company_id, companyId), eq(contacts.email, from)));
      log.info('Contact unsubscribed via email reply', { from, companyId });
    } catch {
      log.warn('Failed to update unsubscribe status', { from, companyId });
    }
  }

  log.info('Inbound email processed', { from, to, subject: subject.substring(0, 50) });
  return NextResponse.json({ ok: true });
}

async function resolveCompanyFromEmail(toAddress: string): Promise<string | null> {
  // Expected format: slug@baljia.app
  const localPart = toAddress.split('@')[0];
  if (!localPart) return null;

  const [data] = await db.select({ id: companies.id })
    .from(companies).where(eq(companies.slug, localPart)).limit(1);

  return data?.id ?? null;
}
