// First CEO chat message — makes the company "feel alive" at first dashboard load

import { createLogger } from '@/lib/logger';
import * as chatService from '@/lib/services/chat.service';
import * as taskService from '@/lib/services/task.service';
import { isLateDevConfigured } from '@/lib/services/latedev.service';
import type { PipelineContext } from '../types';

const log = createLogger('OnboardingCeoSummary');

export async function generateCeoSummary(ctx: PipelineContext): Promise<void> {
  const session = await chatService.getOrCreateSession(ctx.companyId, ctx.userId);

  const checklistItems: string[] = [];
  if (ctx.marketResearch) checklistItems.push('✅ Market research completed');
  if (ctx.founderAngle) checklistItems.push('✅ Founder background analyzed');
  if (ctx.slug) checklistItems.push(`✅ Startup email sent from ${ctx.slug}@baljia.app`);
  if (isLateDevConfigured()) checklistItems.push('✅ Launch tweet posted from @baljia_ai');
  if (ctx.slug) checklistItems.push(`✅ Landing page built at ${ctx.slug}.baljia.app`);
  checklistItems.push('✅ Mission created');
  if (ctx.marketResearch) checklistItems.push('✅ Market research saved');
  checklistItems.push('✅ 3 tasks queued for cycle 1');

  const companyTasks = await taskService.getTasks(ctx.companyId);
  const starterTasks = companyTasks
    .filter((t) => t.source === 'onboarding')
    .sort((a, b) => (a.queue_order ?? 0) - (b.queue_order ?? 0))
    .slice(0, 3);

  const taskList = starterTasks.length > 0
    ? starterTasks.map((t, i) => `${i + 1}. **${t.title}**`).join('\n')
    : '(starter tasks pending)';

  const ceoMessage = [
    `I've set up everything for ${ctx.companyName}:`,
    '',
    ...checklistItems,
    '',
    `Here are your first 3 tasks:`,
    '',
    taskList,
    '',
    `To continue building, subscribe to start your first operating cycle.`,
    '',
    `**Your free trial includes:** 3 days, 10 credits, and 3 night shifts.`,
    `I'll send you a daily progress report so you always know what's happening.`,
  ].join('\n');

  await chatService.appendMessage(session.id, {
    id: crypto.randomUUID(),
    session_id: session.id,
    role: 'assistant',
    content: ceoMessage,
    created_at: new Date().toISOString(),
  });

  log.info('CEO bootstrap summary posted', { companyId: ctx.companyId, sessionId: session.id });
}
