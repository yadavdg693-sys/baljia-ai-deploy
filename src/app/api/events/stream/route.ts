import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getRecentEvents, getLiveWallMetrics, getRunningTasks } from '@/lib/services/live-stream.service';
import { requireAuth, requireAuthAndCompany, isApiError } from '@/lib/api-utils';

// GET /api/events/stream — SSE endpoint for live wall + dashboard
// FIX: C-SEC-001 — now requires auth + company ownership
// Query params: companyId (required for private), publicOnly (optional for public wall)
export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get('companyId') ?? undefined;
  const publicOnly = request.nextUrl.searchParams.get('publicOnly') === 'true';

  // C-SEC-001: Require auth for company-specific streams
  if (companyId) {
    const auth = await requireAuthAndCompany(companyId);
    if (isApiError(auth)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (!publicOnly) {
    // Non-public, non-company streams require at least auth
    const auth = await requireAuth();
    if (isApiError(auth)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  // Public-only streams are open (for the /live wall)

  const encoder = new TextEncoder();
  let cancelled = false;

  // H-LOGIC-026: Track intervals for cleanup
  const intervals: ReturnType<typeof setInterval>[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial snapshot
      try {
        const [events, metrics, runningTasks] = await Promise.all([
          getRecentEvents({ companyId, publicOnly, limit: 20 }),
          getLiveWallMetrics(),
          getRunningTasks(),
        ]);

        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: 'snapshot', events, metrics, runningTasks })}\n\n`
        ));
      } catch {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: 'error', message: 'Failed to load initial data' })}\n\n`
        ));
      }

      // Poll for new events every 3 seconds
      let lastEventTime = new Date().toISOString();

      const pollInterval = setInterval(async () => {
        if (cancelled) {
          clearInterval(pollInterval);
          return;
        }

        try {
          const newEvents = await getRecentEvents({
            companyId,
            publicOnly,
            since: lastEventTime,
            limit: 10,
          });

          if (newEvents.length > 0) {
            lastEventTime = newEvents[0].created_at;
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: 'events', events: newEvents })}\n\n`
            ));
          }

          // Send heartbeat with running task timers
          const runningTasks = await getRunningTasks();
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'heartbeat', runningTasks, timestamp: new Date().toISOString() })}\n\n`
          ));

        } catch {
          // Silent fail on polling errors, will retry on next tick
        }
      }, 3000);
      intervals.push(pollInterval);

      // Send keepalive ping every 30s
      const pingInterval = setInterval(() => {
        if (cancelled) {
          clearInterval(pingInterval);
          return;
        }
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(pingInterval);
        }
      }, 30000);
      intervals.push(pingInterval);
    },

    cancel() {
      // H-LOGIC-026: Properly clean up all intervals on disconnect
      cancelled = true;
      for (const interval of intervals) {
        clearInterval(interval);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
