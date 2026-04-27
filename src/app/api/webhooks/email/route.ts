// Postmark inbound email webhook
//
// Setup (one-time, operator-side):
//   1. In Postmark dashboard: create an Inbound Stream
//   2. Set webhook URL → https://baljia.ai/api/webhooks/email
//   3. Set Basic Auth: username = anything, password = POSTMARK_WEBHOOK_SECRET
//   4. Configure DNS: MX records on baljia.app pointing at inbound.postmarkapp.com
//      (or use a per-mailbox Postmark Inbound Email address)
//   5. Set EMAIL_INBOUND_MODE=postmark in .env.local
//
// What this webhook does:
//   1. Authenticate via Basic auth against POSTMARK_WEBHOOK_SECRET
//   2. Resolve recipient → company by slug
//   3. Idempotent insert into email_threads (skip if Postmark retries)
//   4. Mark contacts as unsubscribed on opt-out language (CAN-SPAM compliance)
//   5. Forward inbound to founder's personal email so they keep their UX
//      (the dashboard's email panel + Support agent's get_inbox both read
//      from email_threads, but humans still get a copy in their normal inbox)

import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/services/email.service';
import { db, companies, contacts, emailThreads, users } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('WebhookEmail');

export async function POST(request: NextRequest) {
  // Verify webhook authenticity via Postmark's basic auth.
  // Generate a secret with: `openssl rand -hex 32` and paste into both
  // Postmark's Inbound webhook config AND .env.local.
  const webhookSecret = process.env.POSTMARK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    log.error('POSTMARK_WEBHOOK_SECRET not set — refusing inbound email');
    return NextResponse.json({
      error: 'Webhook not configured',
      hint: 'Set POSTMARK_WEBHOOK_SECRET in .env.local AND in Postmark Inbound webhook Basic Auth',
    }, { status: 503 });
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

  // Route to correct company by To address (slug@baljia.app)
  const company = await resolveCompanyFromEmail(to);
  if (!company) {
    log.warn('Inbound email — company not found', { to });
    return NextResponse.json({ ok: true, skipped: true, reason: 'company-not-found' });
  }

  // ── Idempotent insert ──
  // Postmark retries on transient failures with the same MessageID. Without
  // this guard we'd accumulate duplicate rows and the Support agent would
  // process the same email multiple times.
  if (messageId) {
    const [existing] = await db.select({ id: emailThreads.id })
      .from(emailThreads)
      .where(and(
        eq(emailThreads.company_id, company.id),
        eq(emailThreads.external_id, messageId),
      ))
      .limit(1);
    if (existing) {
      log.info('Inbound email already stored (Postmark retry)', { messageId, companyId: company.id });
      return NextResponse.json({ ok: true, deduped: true });
    }
  }

  await db.insert(emailThreads).values({
    company_id: company.id,
    direction: 'inbound',
    from_address: from,
    to_address: to,
    subject,
    body: textBody,
    external_id: messageId || null,
    thread_id: messageId || null,
    is_read: false,
  });

  // CAN-SPAM unsubscribe detection
  const combinedText = `${subject} ${textBody}`.toLowerCase();
  if (
    combinedText.includes('unsubscribe') ||
    combinedText.includes('opt out') ||
    combinedText.includes('stop emailing')
  ) {
    try {
      await db.update(contacts).set({ lead_status: 'unsubscribed' })
        .where(and(eq(contacts.company_id, company.id), eq(contacts.email, from)));
      log.info('Contact unsubscribed via email reply', { from, companyId: company.id });
    } catch {
      log.warn('Failed to update unsubscribe status', { from, companyId: company.id });
    }
  }

  // ── Forward to founder's personal email ──
  // Preserves the founder's existing UX: they still see customer mail in
  // their normal inbox. Best-effort — the inbound is already persisted to
  // email_threads (the Support agent's source of truth), so a failed forward
  // just means the founder doesn't get a courtesy copy.
  if (company.owner_email) {
    sendEmail({
      to: company.owner_email,
      from: `${company.name ?? 'Baljia'} <${to}>`,
      subject: `[${company.name ?? 'Baljia'}] ${subject || '(no subject)'}`,
      textBody: `From: ${from}\nTo: ${to}\nSubject: ${subject}\n\n${textBody}\n\n— Forwarded by Baljia. Reply via the dashboard or wait for the Support agent to respond.`,
      replyTo: from,
      tag: 'inbound-forward',
      companyId: company.id,
    }).catch((err) => {
      log.warn('Failed to forward inbound to founder', {
        owner: company.owner_email,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  log.info('Inbound email processed', {
    from,
    to,
    subject: subject.substring(0, 50),
    forwardedTo: company.owner_email ?? null,
  });
  return NextResponse.json({ ok: true });
}

async function resolveCompanyFromEmail(toAddress: string): Promise<{
  id: string;
  name: string | null;
  owner_email: string | null;
} | null> {
  // Expected format: slug@baljia.app
  const localPart = toAddress.split('@')[0];
  if (!localPart) return null;

  const [row] = await db.select({
    id: companies.id,
    name: companies.name,
    owner_email: users.email,
  })
    .from(companies)
    .leftJoin(users, eq(companies.owner_id, users.id))
    .where(eq(companies.slug, localPart))
    .limit(1);

  return row ?? null;
}
