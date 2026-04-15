import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import * as companyService from '@/lib/services/company.service';
import * as creditService from '@/lib/services/credit.service';
import * as eventService from '@/lib/services/event.service';
import { runOnboardingPipeline } from '@/lib/services/onboarding.service';
import { onboardingSchema } from '@/lib/validations';
import { requireAuth, parseJsonBody, isApiError } from '@/lib/api-utils';

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isApiError(auth)) return auth;

  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const parsed = onboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Capture request IP for silent GeoIP enrichment (best-effort, never blocks)
  const requestIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null;
  const timezone = parsed.data.timezone ?? null;

  // Check if user already has a company
  const existing = await companyService.getCompaniesByOwner(auth.user.id);

  if (existing.length > 0) {
    const company = existing[0];

    // If company was created via quick-start (pending_auth), resume the pipeline now
    if (company.onboarding_status === 'pending_auth') {
      // Use stored journey from quick-start, falling back to POST body
      const resolvedJourney = company.onboarding_journey ?? parsed.data.journey;
      const input = parsed.data.idea ?? parsed.data.business_url ?? company.original_idea;
      runOnboardingPipeline(company.id, auth.user.id, resolvedJourney, input ?? undefined, requestIp, timezone).catch(() => {
        // Error is handled inside runOnboardingPipeline
      });
      return NextResponse.json({ company_id: company.id }, { status: 200 });
    }

    return NextResponse.json(
      { error: 'User already has a company', company_id: company.id },
      { status: 409 }
    );
  }

  // Create placeholder company record (pipeline will rename + enrich it)
  const company = await companyService.createCompany({
    owner_id: auth.user.id,
    name: 'My Company',
    original_idea: parsed.data.idea ?? parsed.data.business_url,
  });

  // Welcome credits + creation event (independent — run in parallel)
  await Promise.all([
    creditService.addCredit(company.id, 10, 'welcome_bonus', 'Welcome bonus — 10 trial credits'),
    eventService.emit(company.id, 'company_created', {
      journey: parsed.data.journey,
      owner_id: auth.user.id,
    }, true),
  ]);

  // Fire-and-forget the onboarding pipeline
  // Next.js runs this in the background; UI polls /api/onboarding/status for progress
  const input = parsed.data.idea ?? parsed.data.business_url;
  runOnboardingPipeline(company.id, auth.user.id, parsed.data.journey, input, requestIp, timezone).catch(() => {
    // Error is handled inside runOnboardingPipeline (sets status=failed, emits event)
  });

  return NextResponse.json({ company_id: company.id }, { status: 201 });
}
