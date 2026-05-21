import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, companies, promoVideoJobs } from '@/lib/db';
import * as eventService from '@/lib/services/event.service';
import * as taskService from '@/lib/services/task.service';
import { isApiError, requireAuthAndCompany } from '@/lib/api-utils';
import { checkCompanyRateLimitAsync } from '@/lib/rate-limiter';
import { isValidUUID } from '@/lib/uuid-validation';
import {
  getPromoVideoCreditCost,
  getDefaultPromoVideoCta,
  mapPromoVideoJob,
  PROMO_VIDEO_ASPECT_LABELS,
  PROMO_VIDEO_GOAL_LABELS,
  PROMO_VIDEO_STYLE_LABELS,
  PROMO_VIDEO_VISUAL_MODE_LABELS,
  PROMO_VIDEO_VOICE_LABELS,
  normalizePromoVideoVoiceMode,
} from '@/lib/services/promo-video-core.service';
import type { PromoVideoAspectRatio, PromoVideoGoal, PromoVideoStyle, PromoVideoVisualMode, PromoVideoVoiceMode } from '@/types';

function complexityForDuration(durationSeconds: number): number {
  if (durationSeconds === 90) return 9;
  if (durationSeconds === 60) return 7;
  return 5;
}

function finalCreditCost(durationSeconds: number): number {
  return Math.max(1, getPromoVideoCreditCost(durationSeconds) - 1);
}

function buildFinalTaskDescription(input: {
  companyName: string;
  goal: PromoVideoGoal;
  durationSeconds: number;
  aspectRatio: PromoVideoAspectRatio;
  style: PromoVideoStyle;
  visualMode: PromoVideoVisualMode;
  voiceMode: PromoVideoVoiceMode;
  cta: string | null;
}): string {
  const cta = getDefaultPromoVideoCta(input.goal, input.companyName, input.cta);
  return [
    `Create the approved final product promo for ${input.companyName}.`,
    '',
    'Founder-approved video inputs:',
    `- Goal: ${PROMO_VIDEO_GOAL_LABELS[input.goal]}`,
    `- Length: ${input.durationSeconds}s`,
    `- Format: ${PROMO_VIDEO_ASPECT_LABELS[input.aspectRatio]}`,
    `- Style: ${PROMO_VIDEO_STYLE_LABELS[input.style]}`,
    `- Visuals: ${PROMO_VIDEO_VISUAL_MODE_LABELS[input.visualMode]}`,
    `- Voice: ${PROMO_VIDEO_VOICE_LABELS[input.voiceMode]}`,
    `- CTA: ${cta}`,
    '',
    'Creative rules:',
    '- Reuse the approved preview story.',
    '- Add customer-facing voiceover when available.',
    '- Explain only the founder product, the customer problem, the visible product flow, the outcome, and the CTA.',
    '- Never mention how the video is made or any internal Baljia tooling.',
    ...(input.goal === 'product_hunt' ? [
      '- Product Hunt launch mode: keep the final video crisp, launch-ready, and focused on what makers/hunters can understand fast.',
      '- End with the Product Hunt-ready CTA.',
    ] : []),
  ].join('\n');
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  if (!isValidUUID(jobId)) {
    return NextResponse.json({ error: 'Invalid jobId format' }, { status: 400 });
  }

  const [job] = await db.select()
    .from(promoVideoJobs)
    .where(eq(promoVideoJobs.id, jobId))
    .limit(1);

  if (!job) return NextResponse.json({ error: 'Promo video not found' }, { status: 404 });

  const auth = await requireAuthAndCompany(job.company_id);
  if (isApiError(auth)) return auth;

  const rateLimited = await checkCompanyRateLimitAsync(job.company_id, {
    maxRequests: 6,
    windowMs: 60 * 60_000,
  });
  if (rateLimited) return rateLimited;

  if (job.status !== 'preview_ready') {
    return NextResponse.json({ error: 'Promo video preview is not ready for approval' }, { status: 409 });
  }

  const [company] = await db.select({
    name: companies.name,
  })
    .from(companies)
    .where(eq(companies.id, job.company_id))
    .limit(1);

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  const durationSeconds = Number(job.duration_seconds);
  const credits = finalCreditCost(durationSeconds);
  const task = await taskService.createTask({
    company_id: job.company_id,
    title: `Create final ${durationSeconds}s promo video for ${company.name}`,
    description: buildFinalTaskDescription({
      companyName: company.name,
      goal: job.goal as PromoVideoGoal,
      durationSeconds,
      aspectRatio: job.aspect_ratio as PromoVideoAspectRatio,
      style: job.style as PromoVideoStyle,
      visualMode: job.visual_mode as PromoVideoVisualMode,
      voiceMode: normalizePromoVideoVoiceMode(job.voice_mode),
      cta: job.cta,
    }),
    tag: 'promo-video',
    priority: 90,
    source: 'founder_requested',
    assigned_to_agent_id: 30,
    max_turns: 20,
    estimated_credits: credits,
    complexity: complexityForDuration(durationSeconds),
    estimated_hours: durationSeconds >= 60 ? 2 : 1,
    execution_mode: 'deterministic',
    verification_level: 'quality_review',
    authorized_by: 'founder',
    authorization_reason: `Founder approved promo video preview (user: ${auth.user.id})`,
  });

  const [updatedJob] = await db.update(promoVideoJobs)
    .set({
      task_id: task.id,
      status: 'finalizing',
      updated_at: new Date(),
      error_message: null,
    })
    .where(eq(promoVideoJobs.id, job.id))
    .returning();

  await eventService.emit(job.company_id, 'promo_video_progress', {
    job_id: updatedJob.id,
    task_id: task.id,
    status: 'finalizing',
    label: 'Approved',
  });

  await eventService.emit(job.company_id, 'task_created', {
    task_id: task.id,
    title: task.title,
    tag: task.tag,
    promo_video_job_id: updatedJob.id,
  });

  return NextResponse.json({
    job: mapPromoVideoJob(updatedJob),
    task,
    credits,
  });
}
