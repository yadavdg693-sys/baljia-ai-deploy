// Email Service — migrated to Drizzle + Neon
import { db, emailThreads } from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('Email');
const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

interface SendEmailParams {
  to: string; from: string; subject: string; textBody: string;
  replyTo?: string; tag?: string; threadId?: string; companyId: string;
}

interface PostmarkResponse { MessageID: string; ErrorCode: number; Message: string; }

export async function sendEmail(params: SendEmailParams): Promise<{ messageId: string }> {
  const apiToken = process.env.POSTMARK_SERVER_TOKEN;

  if (!apiToken) {
    log.warn('POSTMARK_SERVER_TOKEN not set — email logged but not sent', { to: params.to });
    await logEmailThread(params, null);
    return { messageId: 'not-sent-no-token' };
  }

  const response = await fetch(POSTMARK_API_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': apiToken },
    body: JSON.stringify({ From: params.from, To: params.to, Subject: params.subject, TextBody: params.textBody, ReplyTo: params.replyTo ?? params.from, Tag: params.tag ?? 'transactional', TrackOpens: false, TrackLinks: 'None' }),
  });

  const result = await response.json() as PostmarkResponse;
  if (!response.ok || result.ErrorCode !== 0) {
    log.error('Postmark send failed', { to: params.to, error: result.Message, code: result.ErrorCode });
    throw new Error(`Email send failed: ${result.Message} (code: ${result.ErrorCode})`);
  }

  log.info('Email sent via Postmark', { to: params.to, messageId: result.MessageID });
  await logEmailThread(params, result.MessageID);
  return { messageId: result.MessageID };
}

// UUID v4 shape — guards email_threads.company_id (notNull uuid + FK to companies.id).
// Platform-level emails (magic links, welcome) carry companyId='platform' and are intentionally not logged here.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function logEmailThread(params: SendEmailParams, messageId: string | null): Promise<void> {
  if (!UUID_RE.test(params.companyId)) return; // platform-scoped email, skip per-company log
  try {
    await db.insert(emailThreads).values({
      company_id: params.companyId,
      direction: 'outbound',
      to_address: params.to,
      from_address: params.from,
      subject: params.subject,
      body: params.textBody,
      external_id: messageId,
      thread_id: params.threadId ?? messageId,
    });
  } catch (err) { log.error('Failed to log email thread', {}, err); }
}

export async function sendWelcomeEmail(to: string, founderName: string | null, companyName: string): Promise<void> {
  if (!process.env.POSTMARK_SERVER_TOKEN) return;
  await sendEmail({
    to, from: 'Baljia <hello@baljia.app>', subject: `Welcome to Baljia — your AI Angel is ready`,
    textBody: `Hi ${founderName ?? 'there'},\n\nYour company "${companyName}" is ready. Your AI Angel has set up the team and created your first tasks.\n\nHead to your dashboard to see what's been built and approve your first task.\n\n— Baljia AI`,
    tag: 'welcome', companyId: 'platform',
  });
}

export async function sendNightShiftSummaryEmail(to: string, companyName: string, summary: string, companyId: string): Promise<void> {
  if (!process.env.POSTMARK_SERVER_TOKEN) return;
  await sendEmail({ to, from: `Baljia Night Shift <updates@baljia.app>`, subject: `${companyName} — overnight update`, textBody: `${summary}\n\n—\nBaljia AI`, tag: 'night-shift-summary', companyId });
}

export async function sendEscalationEmail(to: string, subject: string, body: string, companyId: string): Promise<void> {
  if (!process.env.POSTMARK_SERVER_TOKEN) return;
  await sendEmail({ to, from: 'Baljia Alerts <alerts@baljia.app>', subject, textBody: body, tag: 'escalation', companyId });
}

export interface PostmarkInboundMessage { From: string; To: string; Subject: string; TextBody: string; MessageID: string; ReplyTo?: string; }

export async function handleInboundEmail(message: PostmarkInboundMessage, companyId: string): Promise<void> {
  await db.insert(emailThreads).values({
    company_id: companyId, direction: 'inbound', from_address: message.From, to_address: message.To,
    subject: message.Subject, body: message.TextBody, external_id: message.MessageID,
    thread_id: message.ReplyTo ?? message.MessageID, // link to thread
  });
  log.info('Inbound email stored', { from: message.From, subject: message.Subject });
}
