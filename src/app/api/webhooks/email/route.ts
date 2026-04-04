// Postmark inbound email webhook
// Configure in Postmark: Settings → Inbound → Webhook URL → /api/webhooks/email
// Postmark routes inbound mail to this endpoint

import { NextRequest, NextResponse } from 'next/server';
import { handleInboundEmail } from '@/lib/services/email.service';
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('WebhookEmail');

export async function POST(request: NextRequest) {
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
