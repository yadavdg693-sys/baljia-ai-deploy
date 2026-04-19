// SSE stream for onboarding pipeline progress
// The UI polls this endpoint during the "creating" step to show live stage updates.
// Listens to platform_events for this company filtered to onboarding_stage events.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth, isApiError } from '@/lib/api-utils';
import { db, companies, platformEvents } from '@/lib/db';
import { eq, and, inArray, gt, asc } from 'drizzle-orm';

// Stage labels shown in the UI — kept in sync with OnboardingStage in
// src/lib/services/onboarding/types.ts
const STAGE_LABELS: Record<string, string> = {
  heartbeat: 'Starting up...',
  enrich_geo: 'Detecting your location...',
  enrich_linkedin: 'Reading your professional background...',
  enrich_twitter: 'Reading your public profile...',
  extract_founder_angle: 'Analyzing your positioning...',
  persist_context: 'Saving context...',
  select_strategy: 'Choosing strategy...',
  refine_idea: 'Refining your idea...',
  fetch_business_url: 'Reading your business site...',
  invent_idea: 'Inventing an idea from your background...',
  name_company: 'Naming your company...',
  provision_infrastructure: 'Provisioning infrastructure...',
  send_startup_email: 'Sending your first company email...',
  generate_market_research: 'Researching market opportunity...',
  save_mission: 'Writing mission statement...',
  generate_roadmap: 'Building your roadmap...',
  derive_active_milestone: 'Setting your first milestone...',
  create_starter_tasks: 'Creating your first tasks...',
  generate_landing_page: 'Generating your landing page...',
  post_launch_tweet: 'Posting launch announcement...',
  generate_ceo_summary: 'Preparing CEO briefing...',
  send_completion_email: 'Sending your summary email...',
  flush_diagnostics: 'Finalizing setup...',
  celebrate: 'Ready!',
};

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isApiError(auth)) return auth;

  const url = new URL(request.url);
  const companyId = url.searchParams.get('company_id');
  if (!companyId) {
    return NextResponse.json({ error: 'company_id required' }, { status: 400 });
  }

  // Verify ownership
  const [company] = await db.select({
    id: companies.id, owner_id: companies.owner_id, onboarding_status: companies.onboarding_status,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);

  if (!company || company.owner_id !== auth.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // If already completed, return immediately
  if (company.onboarding_status === 'completed') {
    const stream = new ReadableStream({
      start(controller) {
        const msg = `data: ${JSON.stringify({ type: 'completed' })}\n\n`;
        controller.enqueue(new TextEncoder().encode(msg));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  // Stream live events from the DB (poll every 1.5s for up to 3 minutes)
  const encoder = new TextEncoder();
  const MAX_DURATION_MS = 3 * 60 * 1000;
  const POLL_INTERVAL_MS = 1500;
  let lastEventCreatedAt: Date | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const startTime = Date.now();

      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Send initial ping
      send({ type: 'ping' });

      while (Date.now() - startTime < MAX_DURATION_MS) {
        if (request.signal.aborted) break;

        try {
          // Fetch new onboarding_stage events since last poll
          const conditions = [
            eq(platformEvents.company_id, companyId),
            inArray(platformEvents.event_type, ['onboarding_stage', 'onboarding_completed', 'onboarding_failed']),
          ];

          if (lastEventCreatedAt) {
            conditions.push(gt(platformEvents.created_at, lastEventCreatedAt));
          }

          const events = await db.select({
            id: platformEvents.id, event_type: platformEvents.event_type,
            payload: platformEvents.payload, created_at: platformEvents.created_at,
          }).from(platformEvents)
            .where(and(...conditions))
            .orderBy(asc(platformEvents.created_at))
            .limit(20);

          for (const event of events) {
            if (event.created_at) lastEventCreatedAt = event.created_at;
            const payload = (event.payload ?? {}) as Record<string, unknown>;

            if (event.event_type === 'onboarding_stage') {
              const stageName = String(payload.stage ?? '');
              send({
                type: 'stage',
                stage: stageName,
                status: payload.status,
                label: STAGE_LABELS[stageName] ?? stageName,
              });
            } else if (event.event_type === 'onboarding_completed') {
              send({ type: 'completed', ...payload });
              controller.close();
              return;
            } else if (event.event_type === 'onboarding_failed') {
              send({ type: 'failed', error: payload.error });
              controller.close();
              return;
            }
          }

          // Check company status as backup
          const [co] = await db.select({ onboarding_status: companies.onboarding_status })
            .from(companies).where(eq(companies.id, companyId)).limit(1);

          if (co?.onboarding_status === 'completed') {
            send({ type: 'completed' });
            controller.close();
            return;
          } else if (co?.onboarding_status === 'failed') {
            send({ type: 'failed', error: 'Pipeline failed' });
            controller.close();
            return;
          }
        } catch {
          // Non-fatal poll error — keep trying
        }

        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }

      // Timeout
      send({ type: 'timeout' });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
