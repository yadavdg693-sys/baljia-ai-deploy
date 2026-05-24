import { NextRequest, NextResponse } from 'next/server';
import * as chatService from '@/lib/services/chat.service';
import { chatMessageSchema } from '@/lib/validations';
import { requireAuthAndCompany, resolveBodyCompanyId, resolveCompanyIdentifier, parseJsonBody, isApiError } from '@/lib/api-utils';
import { streamCEOResponse } from '@/lib/agents/ceo/ceo.agent';
import { createPendingPlanConfirmationAction } from '@/lib/agents/ceo/ceo.confirmed-plan-queue';
import { checkRateLimitAsync } from '@/lib/rate-limiter';
import { createLogger } from '@/lib/logger';
import type { ChatMessage, CEOStreamEvent, ChatAction } from '@/types';

const log = createLogger('Chat');

// GET /api/chat?company_id=xxx — fetch active session history
export async function GET(request: NextRequest) {
  const rawId = request.nextUrl.searchParams.get('company_id');
  if (!rawId) return NextResponse.json({ error: 'company_id required' }, { status: 400 });

  const companyId = await resolveCompanyIdentifier(rawId);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const session = await chatService.getOrCreateSession(companyId, auth.user.id);
  const messages = await chatService.getMessages(session.id);

  return NextResponse.json({ session_id: session.id, messages });
}

// POST /api/chat — CEO conversation
// FIX: G-SEC-003 — rate limited to 20 req/min
export async function POST(request: NextRequest) {
  // G-SEC-003: Rate limit chat (20/min per IP, Redis-backed)
  const rateLimited = await checkRateLimitAsync(request, { maxRequests: 20, windowMs: 60000, keyPrefix: 'chat' });
  if (rateLimited) return rateLimited;

  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const { company_id: _rawId, ...rest } = body as Record<string, unknown>;
  const companyId = await resolveBodyCompanyId(body as Record<string, unknown>);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const parsed = chatMessageSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const session = await chatService.getOrCreateSession(companyId, auth.user.id);

  // Get history BEFORE appending the new message — avoids duplicate in Gemini
  const existingHistory: ChatMessage[] = await chatService.getMessages(session.id);

  // Build the user message (saved only on success)
  const userMessage: ChatMessage = {
    id: `user-${Date.now()}`,
    session_id: session.id,
    role: 'user',
    content: parsed.data.message,
    created_at: new Date().toISOString(),
  };

  // Pass existing history + current message for context
  const sessionHistory = [...existingHistory, userMessage];

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
          sessionHistory,
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

        // Persist founder intent even when a provider/tool guardrail stops the
        // assistant reply. Otherwise confirmations like "yes" vanish from the
        // next turn and the CEO asks the same question again.
        const isErrorFallback = fullText.includes('AI providers are temporarily unavailable')
          || fullText.includes('Response timed out')
          || fullText.includes('Reached processing limit');
        if (fullText.trim() && !isErrorFallback) {
          const hasTaskAction = actions.some((action) =>
            action.type === 'task_proposal' || action.type === 'task_approved'
          );
          const pendingPlanAction = hasTaskAction ? null : createPendingPlanConfirmationAction(fullText);
          const alreadyHasPlanAction = actions.some((action) =>
            action.type === 'pending_plan_confirmation'
            && pendingPlanAction
            && action.data.plan_id === pendingPlanAction.data.plan_id
          );
          if (pendingPlanAction && !alreadyHasPlanAction) {
            actions.push(pendingPlanAction);
            const event: CEOStreamEvent = { type: 'action', action: pendingPlanAction };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
        }
        if (fullText.trim() && isErrorFallback) {
          await chatService.appendMessages(session.id, [userMessage]);
        } else if (fullText.trim()) {
          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            session_id: session.id,
            role: 'assistant',
            content: fullText,
            actions: actions.length > 0 ? actions : undefined,
            created_at: new Date().toISOString(),
          };
          await chatService.appendMessages(session.id, [userMessage, assistantMessage]);
        }

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

