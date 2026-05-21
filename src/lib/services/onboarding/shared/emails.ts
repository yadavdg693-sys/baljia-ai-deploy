// Startup + completion email composers.

import { createLogger } from '@/lib/logger';
import { trackedSendEmail as sendEmail } from './tracked-calls';
import * as taskService from '@/lib/services/task.service';
import type { PipelineContext } from '../types';

const log = createLogger('OnboardingEmails');

function baljiaEmailSignature(state: 'Excited' | 'Celebrating'): string {
  return [
    'Baljia AI',
    'Your AI Angel',
    `Status: ${state}`,
  ].join('\n');
}

// Email #1 - startup / "I'm building it right now".
// Fires immediately after company name set, before longer stages run.
export async function sendStartupEmail(ctx: PipelineContext): Promise<void> {
  if (!ctx.founderEmail || !ctx.slug) return;

  const fromAddress = `${ctx.slug}@baljia.app`;
  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://baljia.ai';

  const productPhrase = ctx.oneLiner
    ? `I'm building ${ctx.oneLiner.toLowerCase()}`
    : `I'm setting up ${ctx.companyName} for you`;

  try {
    await sendEmail({
      to: ctx.founderEmail,
      from: `${ctx.companyName} <${fromAddress}>`,
      subject: `Your first email from ${ctx.companyName}`,
      textBody: [
        `Hi ${ctx.founderName ?? 'there'},`,
        '',
        `This is your first email from your new company: ${ctx.companyName}.`,
        '',
        `You now have a company email: ${fromAddress}`,
        '',
        `${productPhrase} right now. Check your dashboard to watch me work.`,
        '',
        baljiaEmailSignature('Excited'),
        '',
        `View Dashboard -> ${dashboardUrl}`,
      ].join('\n'),
      tag: 'startup',
      companyId: ctx.companyId,
    });
    log.info('Startup email sent', { from: fromAddress, to: ctx.founderEmail });
  } catch (err) {
    log.warn('Startup email failed - non-blocking', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Email #2 - completion summary.
// Fires at end of onboarding with what was researched, built, and prepared.
export async function sendCompletionEmail(ctx: PipelineContext, magicLinkUrl?: string): Promise<void> {
  if (!ctx.founderEmail) return;

  const fromAddress = process.env.BALJIA_AUTH_FROM_EMAIL || 'system@baljia.ai';
  const dashboardUrl = magicLinkUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://baljia.ai';
  const { isLateDevConfigured } = await import('@/lib/services/latedev.service');

  let starterTasks: Array<{ title: string; description: string | null }> = [];
  try {
    const allTasks = await taskService.getTasks(ctx.companyId);
    starterTasks = allTasks
      .filter((t) => t.source === 'onboarding')
      .sort((a, b) => (a.queue_order ?? 0) - (b.queue_order ?? 0))
      .slice(0, 3)
      .map((t) => ({ title: t.title, description: t.description ?? null }));
  } catch {
    // Non-blocking
  }

  const insightLine = ctx.marketResearch
    ? `I researched the market and found ${ctx.marketResearch.slice(0, 200).split('\n')[0].trim()}`
    : `I researched ${ctx.companyName}'s market and identified 3 priorities to start with`;

  const builtItems: string[] = [];
  if (ctx.slug) builtItems.push(`Landing page live at ${ctx.slug}.baljia.app`);
  if (ctx.slug) builtItems.push(`Company email active at ${ctx.slug}@baljia.app`);
  if (isLateDevConfigured()) builtItems.push('Tweeted your launch from @baljia_ai');
  if (ctx.marketResearch) builtItems.push('Market research report saved');
  if (ctx.mission) builtItems.push('Mission document written');

  const taskBullets = starterTasks.map((t, i) => {
    const desc = t.description ? ` - ${t.description.split('\n')[0].slice(0, 100)}` : '';
    return `  ${i + 1}. ${t.title}${desc}`;
  });

  try {
    await sendEmail({
      to: ctx.founderEmail,
      from: `Baljia <${fromAddress}>`,
      subject: `${ctx.companyName} is live`,
      textBody: [
        `${ctx.founderName ?? 'Hi'}, your ${ctx.oneLiner ?? ctx.companyName} is live.`,
        '',
        insightLine,
        '',
        "Here's what I built today:",
        '',
        ...builtItems.map((b) => `  ${b}`),
        '',
        taskBullets.length > 0 ? `${taskBullets.length} tasks ready for your first cycle:` : '',
        '',
        ...taskBullets,
        '',
        "Subscribe to start your first operating cycle and I'll begin working through these tasks with daily progress.",
        '',
        baljiaEmailSignature('Celebrating'),
        '',
        magicLinkUrl ? `Open your dashboard -> ${magicLinkUrl}` : `View Dashboard -> ${dashboardUrl}`,
      ].filter(Boolean).join('\n'),
      tag: 'completion',
      companyId: ctx.companyId,
    });
    log.info('Completion email sent', { from: fromAddress, to: ctx.founderEmail });
  } catch (err) {
    log.warn('Completion email failed - non-blocking', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
