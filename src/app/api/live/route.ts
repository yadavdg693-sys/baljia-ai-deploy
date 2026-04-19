// GET /api/live — public live wall data (metrics + recent events)
// No auth required — this powers the public /live page.

import { NextResponse } from 'next/server';
import { getLiveWallMetrics, getRecentEvents, getRunningTasks } from '@/lib/services/live-stream.service';

export async function GET() {
  try {
    const [metrics, events, runningTasks] = await Promise.all([
      getLiveWallMetrics(),
      getRecentEvents({ publicOnly: true, limit: 20 }),
      getRunningTasks(true),
    ]);

    return NextResponse.json({ metrics, events, runningTasks });
  } catch {
    return NextResponse.json(
      { error: 'Failed to load live wall data' },
      { status: 500 },
    );
  }
}
