// Company Email Service — provisions companyname@baljia.app for each founder
//
// COST: $0 per address!
//   - Receiving: Cloudflare Email Routing (FREE, unlimited addresses)
//   - Sending: Postmark domain-level verification (verify baljia.app ONCE,
//     then send from ANY @baljia.app address). Pay only per email sent (~$1.25/1000).
//
// Architecture:
//   Outbound: Postmark (domain verified, no per-address signature needed)
//   Inbound:  Cloudflare Email Routing → forwards to founder's personal email
//
// Env: POSTMARK_SERVER_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID_APP

import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('CompanyEmail');

const POSTMARK_API = 'https://api.postmarkapp.com';
const CF_API = 'https://api.cloudflare.com/client/v4';

export function isEmailProvisioningConfigured(): boolean {
  return !!(
    process.env.CLOUDFLARE_API_TOKEN &&
    process.env.CLOUDFLARE_ZONE_ID_APP
  );
}

// ══════════════════════════════════════════════
// CLOUDFLARE — create email routing rule (FREE)
// ══════════════════════════════════════════════

async function cloudflareCreateEmailRoute(
  slug: string,
  forwardTo: string
): Promise<boolean> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP;
  if (!token || !zoneId) return false;

  try {
    const response = await fetch(`${CF_API}/zones/${zoneId}/email/routing/rules`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Route ${slug}@baljia.app`,
        enabled: true,
        matchers: [
          {
            type: 'literal',
            field: 'to',
            value: `${slug}@baljia.app`,
          },
        ],
        actions: [
          {
            type: 'forward',
            value: [forwardTo],
          },
        ],
      }),
    });

    const result = await response.json() as { success: boolean; errors?: Array<{ message: string }> };

    if (!result.success) {
      const errMsg = result.errors?.[0]?.message ?? 'Unknown';
      if (errMsg.includes('already exists')) {
        log.info('Email route already exists', { slug });
        return true;
      }
      log.error('CF email route creation failed', { slug, error: errMsg });
      return false;
    }

    log.info('CF email route created', { slug, forwardTo });
    return true;
  } catch (error) {
    log.error('CF email route error', { slug }, error);
    return false;
  }
}

// ══════════════════════════════════════════════
// PROVISION EMAIL — full flow ($0 per address)
// ══════════════════════════════════════════════

/**
 * Provision a company email address: {slug}@baljia.app
 *
 * 1. Creates Cloudflare email routing rule (inbound → founder's email)
 * 2. Updates company record with the email address
 *
 * Sending works automatically via domain-level Postmark verification.
 * Verify baljia.app domain ONCE in Postmark dashboard (DKIM + Return-Path).
 * After that, you can send from ANY @baljia.app address — no per-address setup.
 *
 * Call during onboarding pipeline (provision_infrastructure stage).
 */
export async function provisionCompanyEmail(
  companyId: string,
  slug: string,
  companyName: string,
  founderEmail: string
): Promise<{ email: string; status: string } | null> {
  if (!isEmailProvisioningConfigured()) {
    log.warn('Email provisioning not configured, skipped', { slug });
    return null;
  }

  const emailAddress = `${slug}@baljia.app`;

  // 1. Create Cloudflare email routing rule (FREE — unlimited addresses)
  // Inbound mail to {slug}@baljia.app → forwards to founder's personal email
  const routeOk = await cloudflareCreateEmailRoute(slug, founderEmail);
  if (!routeOk) {
    log.warn('Email route creation failed — founder can still send, just can\'t receive yet', { slug });
  }

  // 2. Update company record
  await db.update(companies).set({ company_email: emailAddress }).where(eq(companies.id, companyId));

  log.info('Company email provisioned', { companyId, emailAddress, forwardsTo: founderEmail });

  return {
    email: emailAddress,
    status: 'active', // Domain-level Postmark verification handles sending
  };
}

// ══════════════════════════════════════════════
// SEND — send email FROM a company address
// ══════════════════════════════════════════════

/**
 * Send an email from {company}@baljia.app
 *
 * Prerequisites (one-time setup in Postmark dashboard):
 *   1. Add baljia.app as a verified domain
 *   2. Set DKIM and Return-Path DNS records on Cloudflare
 *   3. After verification, ANY @baljia.app address can send
 *
 * Cost: ~$1.25 per 1,000 emails sent
 */
export async function sendAsCompany(
  companyEmail: string,
  to: string,
  subject: string,
  htmlBody: string,
  options?: {
    textBody?: string;
    replyTo?: string;
    tag?: string;
  }
): Promise<boolean> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) {
    log.warn('Postmark not configured, email skipped');
    return false;
  }

  try {
    const response = await fetch(`${POSTMARK_API}/email`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': token,
      },
      body: JSON.stringify({
        From: companyEmail,
        To: to,
        Subject: subject,
        HtmlBody: htmlBody,
        TextBody: options?.textBody ?? subject,
        ReplyTo: options?.replyTo ?? companyEmail,
        Tag: options?.tag ?? 'company-outbound',
        MessageStream: 'outbound',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      log.error('Company email send failed', { from: companyEmail, to, error: err });
      return false;
    }

    log.info('Company email sent', { from: companyEmail, to });
    return true;
  } catch (error) {
    log.error('Company email send error', { from: companyEmail, to }, error);
    return false;
  }
}

// ══════════════════════════════════════════════
// UPDATE FORWARDING — change where inbound emails go
// ══════════════════════════════════════════════

/**
 * Update the forwarding destination for a company email.
 * Useful when founder changes their personal email or
 * wants inbound routed to a team inbox.
 */
export async function updateEmailForwarding(
  slug: string,
  newForwardTo: string
): Promise<boolean> {
  // Cloudflare Email Routing doesn't have a PATCH — delete + recreate
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP;
  if (!token || !zoneId) return false;

  try {
    // List existing rules to find the one to replace
    const listResponse = await fetch(`${CF_API}/zones/${zoneId}/email/routing/rules`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const listResult = await listResponse.json() as {
      success: boolean;
      result?: Array<{ id: string; name: string }>;
    };

    if (!listResult.success || !listResult.result) return false;

    const existingRule = listResult.result.find(r => r.name === `Route ${slug}@baljia.app`);

    // Delete existing rule if found
    if (existingRule) {
      await fetch(`${CF_API}/zones/${zoneId}/email/routing/rules/${existingRule.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    // Create new rule with updated forwarding
    return cloudflareCreateEmailRoute(slug, newForwardTo);
  } catch (error) {
    log.error('Email forwarding update failed', { slug }, error);
    return false;
  }
}
