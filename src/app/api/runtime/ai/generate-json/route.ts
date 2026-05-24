import { NextRequest, NextResponse } from 'next/server';
import {
  bearerTokenFromHeader,
  recordUsageEvent,
  verifyRuntimeToken,
} from '@/lib/runtime/runtime.service';
import { chatCompletion } from '@/lib/services/openai.service';

function parseJsonResponse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('model returned empty content');

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match?.[1]) return JSON.parse(match[1].trim());
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('model response was not valid JSON');
  }
}

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
    : 'generate_json';
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const userId = typeof body.userId === 'string' ? body.userId : null;
  const schema = typeof body.schema === 'object' && body.schema !== null ? body.schema : null;

  if (!prompt.trim()) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }

  try {
    const systemPrompt = [
      'Return only strict JSON.',
      schema ? `The requested JSON schema or shape is: ${JSON.stringify(schema).slice(0, 4000)}` : '',
    ].filter(Boolean).join('\n');
    const raw = await chatCompletion([{ role: 'user', content: prompt }], {
      systemPrompt,
      temperature: 0.2,
      maxTokens: 4096,
    });
    const json = parseJsonResponse(raw);

    await recordUsageEvent({
      companyId: runtime.companyId,
      userId,
      appSlug: runtime.appSlug,
      packageName: '@baljia/ai',
      feature,
      units: raw.length,
      costUsd: '0',
      status: 'success',
      metadata: { endpoint: 'generate-json' },
    });

    return NextResponse.json({ ok: true, json });
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
        endpoint: 'generate-json',
        error: err instanceof Error ? err.message : String(err),
      },
    }).catch(() => undefined);

    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI generation failed' },
      { status: 502 },
    );
  }
}
