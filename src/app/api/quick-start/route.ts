// Quick-Start API — unauthenticated draft company creation
// Per Polsia spec: quick-start submission creates draft account/company shell
// before full login. Unauthenticated founders are redirected to login with
// a dashboard redirect target.
//
// Flow: onboarding form → POST /api/quick-start → create user + draft company → redirect to login

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { db, users, waitlist, companies } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import * as companyService from '@/lib/services/company.service';
import * as creditService from '@/lib/services/credit.service';
import * as eventService from '@/lib/services/event.service';
import { parseJsonBody, isApiError } from '@/lib/api-utils';
import { quickStartSchema } from '@/lib/validations';
import { checkCustomRateLimitAsync, checkRateLimitAsync } from '@/lib/rate-limiter';

export async function POST(request: NextRequest) {
  const ipLimit = await checkRateLimitAsync(request, {
    maxRequests: 5,
    windowMs: 10 * 60_000,
    keyPrefix: 'quick-start:ip',
  });
  if (ipLimit) return ipLimit;

  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const parsed = quickStartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const emailLimit = await checkCustomRateLimitAsync(`quick-start:email:${email}`, {
    maxRequests: 2,
    windowMs: 60 * 60_000,
  });
  if (emailLimit) return emailLimit;

  // Find or create user record (unverified — they'll verify via magic link)
  let [user] = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    const [newUser] = await db.insert(users).values({
      email,
      auth_provider: 'magic_link',
      email_verified: false,
      timezone: parsed.data.timezone ?? null,
    }).returning({ id: users.id });
    user = newUser;
  }

  // Check if user already has a company
  const existing = await companyService.getCompaniesByOwner(user.id);
  if (existing.length > 0) {
    return NextResponse.json({
      success: true,
      account_created: false,
      company_id: existing[0].id,
      slug: existing[0].slug,
      redirect: `/login?redirect=/dashboard/${existing[0].id}`,
      message: 'Company already exists — sign in to continue.',
    });
  }

  // Create draft company shell (pipeline will rename + enrich after login)
  const company = await companyService.createCompany({
    owner_id: user.id,
    name: 'My Company',
    original_idea: parsed.data.idea ?? parsed.data.business_url,
  });

  // Welcome credits + creation event
  await Promise.all([
    creditService.addCredit(company.id, 10, 'welcome_bonus', 'Welcome bonus — 10 trial credits'),
    eventService.emit(company.id, 'company_created', {
      journey: parsed.data.journey,
      owner_id: user.id,
      pre_auth: true,
    }, true),
  ]);

  // Update waitlist record if one exists
  await db.update(waitlist).set({
    onboarding_intent: parsed.data.journey,
    idea_text: parsed.data.idea ?? null,
    business_website: parsed.data.business_url ?? null,
    timezone: parsed.data.timezone ?? null,
    converted_user_id: user.id,
    converted_company_id: company.id,
    status: 'converted',
  }).where(and(eq(waitlist.email, email), eq(waitlist.status, 'pending')));

  // Store onboarding intent on company so the pipeline can resume after login
  // The pipeline will be triggered when the user authenticates and lands on the dashboard
  await db.update(companies).set({
    onboarding_status: 'pending_auth',
    onboarding_journey: parsed.data.journey,
  }).where(eq(companies.id, company.id));

  // Return redirect to login with dashboard target
  const slug = company.slug ?? company.id;
  return NextResponse.json({
    success: true,
    account_created: true,
    company_id: company.id,
    slug,
    redirect: `/login?redirect=/dashboard/${company.id}`,
    message: 'Account created — redirecting to dashboard.',
  }, { status: 201 });
}
