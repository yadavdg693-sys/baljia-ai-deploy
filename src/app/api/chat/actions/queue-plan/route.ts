import { NextRequest, NextResponse } from 'next/server';
import * as chatService from '@/lib/services/chat.service';
import {
  findPendingPlanMessage,
  queueConfirmedBuildPlan,
} from '@/lib/agents/ceo/ceo.confirmed-plan-queue';
import {
  requireAuthAndCompany,
  resolveBodyCompanyId,
  parseJsonBody,
  isApiError,
} from '@/lib/api-utils';
import type { ChatMessage } from '@/types';

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const companyId = await resolveBodyCompanyId(body as Record<string, unknown>);
  if (isApiError(companyId)) return companyId;

  const rawPlanId = (body as Record<string, unknown>).plan_id;
  const planId = typeof rawPlanId === 'string' ? rawPlanId.trim() : '';
  if (!planId) {
    return NextResponse.json({ error: 'plan_id required' }, { status: 400 });
  }

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const session = await chatService.getOrCreateSession(companyId, auth.user.id);
  const messages = await chatService.getMessages(session.id);
  const pendingPlan = findPendingPlanMessage(messages, planId);
  if (!pendingPlan) {
    return NextResponse.json({ error: 'Pending plan not found' }, { status: 404 });
  }

  const result = await queueConfirmedBuildPlan({
    companyId,
    planContent: pendingPlan.message.content,
  });
  if (!result) {
    return NextResponse.json({ error: 'Saved plan is no longer queueable' }, { status: 422 });
  }

  const createdAt = new Date().toISOString();
  const userMessage: ChatMessage = {
    id: `user-action-${Date.now()}`,
    session_id: session.id,
    role: 'user',
    content: `Queue plan: ${pendingPlan.action.data.product_name}`,
    created_at: createdAt,
  };
  const assistantMessage: ChatMessage = {
    id: `assistant-action-${Date.now()}`,
    session_id: session.id,
    role: 'assistant',
    content: result.text,
    actions: result.actions.length > 0 ? result.actions : undefined,
    created_at: createdAt,
  };

  await chatService.appendMessages(session.id, [userMessage, assistantMessage]);

  return NextResponse.json({
    ok: true,
    user_message: userMessage,
    message: assistantMessage,
    text: result.text,
    actions: result.actions,
  });
}
