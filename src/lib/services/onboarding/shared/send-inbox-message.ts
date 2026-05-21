// Inbox message stage — separate from the CEO chat summary.
// Uses chat_sessions.messages JSONB array with a custom kind:'inbox' property.
// NO schema migration (property is additive on the JSONB value).
// Frontend chat filters by kind to render inbox messages differently (or
// ignores them if the filter isn't wired yet — graceful degradation).

import * as chatService from '@/lib/services/chat.service';
import { emitActivity } from '../stage-runner';
import type { PipelineContext } from '../types';
import type { MagicLinkExtension } from './generate-magic-link';

export async function sendInboxMessage(ctx: PipelineContext): Promise<void> {
  const session = await chatService.getOrCreateSession(ctx.companyId, ctx.userId);

  const magicLinkUrl = (ctx as PipelineContext & MagicLinkExtension).magicLinkUrl;
  const dashboardLink = magicLinkUrl ?? `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://baljia.ai'}/dashboard/${ctx.slug}`;

  const body = [
    `**${ctx.companyName} is live.**`,
    '',
    ctx.oneLiner ? `_${ctx.oneLiner}_` : '',
    '',
    `I built your landing page, tweeted your launch, and prepared your first operating plan.`,
    '',
    `👉 [Open your dashboard](${dashboardLink})`,
    '',
    `_This is a system message. Replies go to me (your AI angel)._`,
  ].filter(Boolean).join('\n');

  // Append with kind:'inbox' as an additive JSONB property. The ChatMessage
  // type today doesn't declare `kind`, but JSONB accepts extra properties.
  // We use a type assertion rather than changing the canonical type.
  await chatService.appendMessage(session.id, {
    id: crypto.randomUUID(),
    session_id: session.id,
    role: 'assistant',
    content: body,
    created_at: new Date().toISOString(),
    kind: 'inbox',
  } as Parameters<typeof chatService.appendMessage>[1]);

  await emitActivity(ctx, 'Inbox message sent with magic-link CTA', 'inbox');
}
