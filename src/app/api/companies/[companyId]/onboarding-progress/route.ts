// GET /api/companies/[companyId]/onboarding-progress
// Returns completed onboarding stages from platform_events
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany } from '@/lib/api-utils';
import { db, platformEvents } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { isValidUUID } from '@/lib/uuid-validation';

// Maps event payload 'stage' values to the step keys used in OnboardingProgress UI
const STAGE_KEYS = [
  'heartbeat', 'enrich_founder', 'extract_angle', 'enrich_business',
  'persist_context', 'strategy_selected', 'company_named', 'market_researched',
  'infrastructure', 'mission_saved', 'starter_tasks', 'completed',
];

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
    if (stage && STAGE_KEYS.includes(stage)) {
      if (payload.status === 'completed' || payload.status === 'done') {
        completedStages.add(stage);
      } else if (payload.status === 'running' || payload.status === 'started') {
        currentStage = stage;
      }
    }
  }

  return NextResponse.json({
    completed_stages: Array.from(completedStages),
    current_stage: currentStage,
  });
}
