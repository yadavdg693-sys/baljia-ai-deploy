// GET /api/companies/[companyId]/onboarding-progress
// Returns completed onboarding stages from platform_events
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany } from '@/lib/api-utils';
import { db, platformEvents } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { isValidUUID } from '@/lib/uuid-validation';

// Maps current pipeline stage names to the step keys used in OnboardingProgress UI.
const STAGE_TO_STEP: Record<string, string> = {
  heartbeat: 'heartbeat',
  enrich_geo: 'enrich_founder',
  enrich_linkedin: 'enrich_founder',
  extract_founder_angle: 'extract_angle',
  fetch_business_url: 'enrich_business',
  persist_context: 'persist_context',
  refine_idea: 'strategy_selected',
  invent_idea: 'strategy_selected',
  name_company: 'company_named',
  generate_market_research: 'market_researched',
  provision_infrastructure: 'infrastructure',
  provision_founder_app_kickoff: 'infrastructure',
  await_founder_app: 'infrastructure',
  generate_landing_page: 'mission_saved',
  save_mission: 'mission_saved',
  create_starter_tasks: 'starter_tasks',
  post_launch_tweet: 'completed',
  generate_ceo_summary: 'completed',
  generate_magic_link: 'completed',
  send_inbox_message: 'completed',
  send_completion_email: 'completed',
  flush_diagnostics: 'completed',
  celebrate: 'completed',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  if (!isValidUUID(companyId)) {
    return NextResponse.json({ error: 'Invalid companyId' }, { status: 400 });
  }

  const authResult = await requireAuthAndCompany(companyId);
  if (authResult instanceof NextResponse) return authResult;

  // Fetch onboarding_stage events for this company.
  // Limit to 100 — there are only 12 stages; this prevents full-partition scans
  // on deployments where platform_events accumulates millions of rows.
  const events = await db.select({ payload: platformEvents.payload })
    .from(platformEvents)
    .where(and(
      eq(platformEvents.company_id, companyId),
      eq(platformEvents.event_type, 'onboarding_stage'),
    ))
    .limit(100);

  // Extract completed stages from payloads
  const completedStages = new Set<string>();
  let currentStage: string | null = null;

  for (const e of events) {
    const payload = e.payload as Record<string, unknown>;
    const stage = payload.stage as string | undefined;
    const step = stage ? STAGE_TO_STEP[stage] : undefined;
    if (step) {
      if (payload.status === 'completed' || payload.status === 'done') {
        completedStages.add(step);
      } else if (payload.status === 'running' || payload.status === 'started') {
        currentStage = step;
      }
    }
  }

  return NextResponse.json({
    completed_stages: Array.from(completedStages),
    current_stage: currentStage,
  });
}
