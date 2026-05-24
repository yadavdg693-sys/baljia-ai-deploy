import { NextRequest, NextResponse } from 'next/server';
import {
  bearerTokenFromHeader,
  recordUsageEvent,
  verifyRuntimeToken,
} from '@/lib/runtime/runtime.service';

export async function POST(req: NextRequest) {
  const token = bearerTokenFromHeader(req.headers.get('authorization'));
  if (!token) {
    return NextResponse.json({ error: 'Missing runtime token' }, { status: 401 });
  }

  let runtime;
  try {
    runtime = await verifyRuntimeToken(token);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid runtime token' },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const usage = await recordUsageEvent({
    companyId: runtime.companyId,
    userId: typeof body.userId === 'string' ? body.userId : null,
    appSlug: runtime.appSlug,
    packageName: typeof body.packageName === 'string' ? body.packageName : '@baljia/runtime',
    feature: typeof body.feature === 'string' ? body.feature : 'runtime_event',
    units: typeof body.units === 'number' ? body.units : 1,
    costUsd: typeof body.costUsd === 'string' || typeof body.costUsd === 'number' ? body.costUsd : '0',
    status: typeof body.status === 'string' ? body.status : 'success',
    metadata: typeof body.metadata === 'object' && body.metadata !== null
      ? body.metadata as Record<string, unknown>
      : {},
  });

  return NextResponse.json({ ok: true, usageEventId: usage?.id ?? null });
}
