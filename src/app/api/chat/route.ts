import { NextRequest, NextResponse } from 'next/server';
import * as chatService from '@/lib/services/chat.service';
import { chatMessageSchema } from '@/lib/validations';
import { requireAuthAndCompany, parseJsonBody, isApiError } from '@/lib/api-utils';
import { streamCEOResponse } from '@/lib/agents/ceo/ceo.agent';
import { checkRateLimitAsync } from '@/lib/rate-limiter';
import { createLogger } from '@/lib/logger';
import type { ChatMessage, CEOStreamEvent, ChatAction } from '@/types';

const log = createLogger('Chat');

// POST /api/chat — CEO conversation
// FIX: G-SEC-003 — rate limited to 20 req/min
export async function POST(request: NextRequest) {
  // G-SEC-003: Rate limit chat (20/min per IP, Redis-backed)
  const rateLimited = await checkRateLimitAsync(request, { maxRequests: 20, windowMs: 60000, keyPrefix: 'chat' });
  if (rateLimited) return rateLimited;

  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const { company_id: companyId, ...rest } = body as Record<string, unknown>;
  if (!companyId || typeof companyId !== 'string') {
    return NextResponse.json({ error: 'company_id required' }, { status: 400 });
  }

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const parsed = chatMessageSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const session = await chatService.getOrCreateSession(companyId, auth.user.id);

  // Append user message
  const userMessage: ChatMessage = {
    id: `user-${Date.now()}`,
    session_id: session.id,
    role: 'user',
    content: parsed.data.message,
    created_at: new Date().toISOString(),
  };
  await chatService.appendMessages(session.id, [userMessage]);

  // Get session history for context
  const history: ChatMessage[] = await chatService.getMessages(session.id);

  // Stream CEO response via SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let fullText = '';
      const actions: ChatAction[] = [];

      try {
        const generator = streamCEOResponse({
          companyId,
          message: parsed.data.message,
          sessionHistory: history,
        });

        for await (const event of generator) {
          const sseData = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(sseData));

          if (event.type === 'text') {
            fullText += event.content;
          } else if (event.type === 'action') {
            actions.push(event.action);
          }
        }

        // Append assistant message to session
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          session_id: session.id,
          role: 'assistant',
          content: fullText,
          actions: actions.length > 0 ? actions : undefined,
          created_at: new Date().toISOString(),
        };
        await chatService.appendMessages(session.id, [assistantMessage]);

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        log.error('CEO stream error', { companyId, sessionId: session.id }, error);
        const errorEvent: CEOStreamEvent = {
          type: 'text',
          content: 'Sorry, I had trouble processing that. Please try again.',
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } finally {
        controller.close();
      }
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

