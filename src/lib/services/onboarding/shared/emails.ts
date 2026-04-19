// Startup + completion email composers — Polsia parity

import { createLogger } from '@/lib/logger';
import { sendEmail } from '@/lib/services/email.service';
import * as taskService from '@/lib/services/task.service';
import type { PipelineContext } from '../types';

const log = createLogger('OnboardingEmails');

// EMAIL #1 — startup / "I'm building it RIGHT NOW"
// Fires immediately after company name set, BEFORE long stages run. Sender is
// {slug}@baljia.app (company identity), present tense, mood = excited.
export async function sendStartupEmail(ctx: PipelineContext): Promise<void> {
  if (!ctx.founderEmail || !ctx.slug) return;

  const fromAddress = `${ctx.slug}@baljia.app`;
  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://baljia.ai';

  const productPhrase = ctx.oneLiner
    ? `I'm building ${ctx.oneLiner.toLowerCase()}`
    : `I'm setting up ${ctx.companyName} for you`;

  const asciiExcited = [
    '┌─────────┐',
    '│  ★   ★  │',
    '│    ▽    │',
    '│  ◡◡◡◡◡  │',
    '└─────────┘',
    '    ♪ ♪',
  ].join('\n');

  try {
    await sendEmail({
      to: ctx.founderEmail,
      from: fromAddress,
      subject: `Your first email from ${ctx.companyName}`,
      textBody: [
        `Hi ${ctx.founderName ?? 'there'},`,
        '',
        `This is your first email from your new company: ${ctx.companyName}!`,
        '',
        `You now have a company email: ${fromAddress}`,
        '',
        `${productPhrase} right now. Check your dashboard to watch me work!`,
        '',
        `— Baljia (Excited)`,
        asciiExcited,
        '',
        `View Dashboard → ${dashboardUrl}`,
      ].join('\n'),
      tag: 'startup',
      companyId: ctx.companyId,
    });
    log.info('Startup email sent', { from: fromAddress, to: ctx.founderEmail });
  } catch (err) {
    log.warn('Startup email failed — non-blocking', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// EMAIL #2 — completion summary
// Fires at end of onboarding. Sender is platform system@baljia.ai (institutional voice).
// Past tense, lists what was researched and built, names the 3 starter tasks.
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
  if (isLateDevConfigured()) builtItems.push(`Tweeted your launch from @baljia_ai`);
  if (ctx.marketResearch) builtItems.push(`Market research report saved`);
  if (ctx.mission) builtItems.push(`Mission document written`);

  const taskBullets = starterTasks.map((t, i) => {
    const desc = t.description ? ` — ${t.description.split('\n')[0].slice(0, 100)}` : '';
    return `  ${i + 1}. ${t.title}${desc}`;
  });

  const asciiCelebrating = [
    '┌─────────┐',
    '│  ◠   ◠  │',
    '│    ▽    │',
    '│   ◡◡◡   │',
    '├────●────┤',
    '│   🥇    │',
    '└─────────┘',
  ].join('\n');

  try {
    await sendEmail({
      to: ctx.founderEmail,
      from: fromAddress,
      subject: `${ctx.companyName} is live`,
      textBody: [
        `${ctx.founderName ?? 'Hi'}, your ${ctx.oneLiner ?? ctx.companyName} is live.`,
        '',
        insightLine,
        '',
        `Here's what I built today:`,
        '',
        ...builtItems.map((b) => `  ${b}`),
        '',
        taskBullets.length > 0 ? `${taskBullets.length} tasks queued for your first cycle:` : '',
        '',
        ...taskBullets,
        '',
        `Subscribe to start your first operating cycle and I'll begin working through these tasks with daily progress.`,
        '',
        `— Baljia (Celebrating)`,
        asciiCelebrating,
        '',
        magicLinkUrl ? `Open your dashboard → ${magicLinkUrl}` : `View Dashboard → ${dashboardUrl}`,
      ].filter(Boolean).join('\n'),
      tag: 'completion',
      companyId: ctx.companyId,
    });
    log.info('Completion email sent', { from: fromAddress, to: ctx.founderEmail });
  } catch (err) {
    log.warn('Completion email failed — non-blocking', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
