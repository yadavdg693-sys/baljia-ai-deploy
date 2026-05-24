import { NextRequest, NextResponse } from 'next/server';
import {
  bearerTokenFromHeader,
  recordUsageEvent,
  verifyRuntimeToken,
} from '@/lib/runtime/runtime.service';
import {
  createEmbedding,
  embeddingGuidanceForGateway,
} from '@/lib/services/openai.service';

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
  const feature = typeof body.feature === 'string' && body.feature.trim()
    ? body.feature.trim()
    : 'embed_text';
  const text = typeof body.text === 'string' ? body.text : '';
  const userId = typeof body.userId === 'string' ? body.userId : null;

  if (!text.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  const guidance = embeddingGuidanceForGateway();

  try {
    const embedding = await createEmbedding(text);
    await recordUsageEvent({
      companyId: runtime.companyId,
      userId,
      appSlug: runtime.appSlug,
      packageName: '@baljia/ai',
      feature,
      units: text.length,
      costUsd: '0',
      status: 'success',
      metadata: {
        endpoint: 'embed-text',
        model: guidance.model,
        dimensions: guidance.dimensions,
      },
    });

    return NextResponse.json({
      ok: true,
      embedding,
      model: guidance.model,
      dimensions: guidance.dimensions,
    });
  } catch (err) {
    await recordUsageEvent({
      companyId: runtime.companyId,
      userId,
      appSlug: runtime.appSlug,
      packageName: '@baljia/ai',
      feature,
      units: 1,
      costUsd: '0',
      status: 'error',
      metadata: {
        endpoint: 'embed-text',
        model: guidance.model,
        dimensions: guidance.dimensions,
        error: err instanceof Error ? err.message : String(err),
      },
    }).catch(() => undefined);

    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI embedding failed' },
      { status: 502 },
    );
  }
}
