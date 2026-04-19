// GET /api/dashboard?company_id=X — aggregated dashboard data for the founder shell
// Returns tasks, documents, credits, emails, tweets, links, ads, roadmap in one call.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany, getRequiredCompanyId, isApiError } from '@/lib/api-utils';
import { db, tasks, companies, documents, dashboardLinks, emailThreads, tweets as tweetsTable, adCampaigns, subscriptions } from '@/lib/db';
import { eq, and, desc, sql } from 'drizzle-orm';
import * as creditService from '@/lib/services/credit.service';

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
  ] = await Promise.all([
    db.select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      one_liner: companies.one_liner,
      plan_tier: companies.plan_tier,
      lifecycle: companies.lifecycle,
      company_stage: companies.company_stage,
      email_identity: companies.email_identity,
    }).from(companies).where(eq(companies.id, companyId)).limit(1).then(r => r[0]),

    db.select().from(tasks)
      .where(eq(tasks.company_id, companyId))
      .orderBy(desc(tasks.created_at))
      .limit(100),

    db.select().from(documents)
      .where(eq(documents.company_id, companyId))
      .orderBy(desc(documents.updated_at)),

    db.select().from(dashboardLinks)
      .where(eq(dashboardLinks.company_id, companyId)),

    db.select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      from_address: emailThreads.from_address,
      direction: emailThreads.direction,
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
    credits: { balance: creditBalance },
    subscription: sub ?? null,
  });
}
