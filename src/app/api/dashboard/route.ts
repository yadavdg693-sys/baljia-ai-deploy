// GET /api/dashboard?company_id=X — aggregated dashboard data for the founder shell
// Returns tasks, documents, credits, emails, tweets, links, ads in one call.
// (Roadmap UI was removed from the dashboard 2026-04-24 pending launch decision;
// the /api/roadmap/[companyId] route is still callable directly if needed.)

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany, getRequiredCompanyId, isApiError } from '@/lib/api-utils';
import { db, tasks, companies, documents, dashboardLinks, emailThreads, tweets as tweetsTable, adCampaigns, subscriptions, platformEvents } from '@/lib/db';
import { eq, and, desc, inArray, notInArray } from 'drizzle-orm';
import * as creditService from '@/lib/services/credit.service';
import { FOUNDER_HIDDEN_DOC_TYPES } from '@/lib/founder-safety/hidden-doc-types';

export async function GET(request: NextRequest) {
  const companyId = await getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const [
    company,
    taskRows,
    docRows,
    linkRows,
    emailRows,
    tweetRows,
    adRows,
    creditBalance,
    sub,
    setupEventRows,
  ] = await Promise.all([
    db.select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      one_liner: companies.one_liner,
      onboarding_status: companies.onboarding_status,
      plan_tier: companies.plan_tier,
      lifecycle: companies.lifecycle,
      subdomain: companies.subdomain,
      email_identity: companies.email_identity,
      company_email: companies.company_email,
    }).from(companies).where(eq(companies.id, companyId)).limit(1).then(r => r[0]),

    db.select().from(tasks)
      .where(eq(tasks.company_id, companyId))
      .orderBy(desc(tasks.created_at))
      .limit(100),

    // Filter out internal-only doc types (codebase_map etc.) so they
    // never leak into the founder Files panel. See hidden-doc-types.ts.
    db.select().from(documents)
      .where(and(
        eq(documents.company_id, companyId),
        notInArray(documents.doc_type, FOUNDER_HIDDEN_DOC_TYPES as unknown as string[]),
      ))
      .orderBy(desc(documents.updated_at)),

    db.select().from(dashboardLinks)
      .where(eq(dashboardLinks.company_id, companyId)),

    db.select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      from_address: emailThreads.from_address,
      to_address: emailThreads.to_address,
      direction: emailThreads.direction,
      body: emailThreads.body,
      created_at: emailThreads.created_at,
    }).from(emailThreads)
      .where(eq(emailThreads.company_id, companyId))
      .orderBy(desc(emailThreads.created_at))
      .limit(20),

    db.select().from(tweetsTable)
      .where(eq(tweetsTable.company_id, companyId))
      .orderBy(desc(tweetsTable.created_at))
      .limit(10),

    db.select().from(adCampaigns)
      .where(and(eq(adCampaigns.company_id, companyId), eq(adCampaigns.platform, 'meta')))
      .orderBy(desc(adCampaigns.created_at))
      .limit(10),

    creditService.getBalance(companyId),

    db.select({ plan_type: subscriptions.plan_type, status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.company_id, companyId))
      .limit(1)
      .then(r => r[0]),

    db.select({
      id: platformEvents.id,
      event_type: platformEvents.event_type,
      payload: platformEvents.payload,
      created_at: platformEvents.created_at,
    }).from(platformEvents)
      .where(and(
        eq(platformEvents.company_id, companyId),
        inArray(platformEvents.event_type, ['onboarding_stage', 'onboarding_activity', 'onboarding_mood']),
      ))
      .orderBy(desc(platformEvents.created_at))
      .limit(30),
  ]);

  if (!company) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  }

  return NextResponse.json({
    company,
    tasks: taskRows,
    documents: docRows,
    links: linkRows,
    emails: emailRows,
    tweets: tweetRows,
    ads: adRows,
    setup_events: setupEventRows.reverse().map((event) => ({
      id: event.id,
      event_type: event.event_type,
      payload: event.payload ?? {},
      created_at: event.created_at instanceof Date ? event.created_at.toISOString() : String(event.created_at),
    })),
    credits: { balance: creditBalance },
    subscription: sub ?? null,
  });
}
