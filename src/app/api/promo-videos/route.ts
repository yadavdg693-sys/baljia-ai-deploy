import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, companies, promoVideoJobs } from '@/lib/db';
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import {
  getPromoVideoCreditCost,
  getDefaultPromoVideoCta,
  listPromoVideoJobs,
  mapPromoVideoJob,
  resolvePromoVideoLiveUrl,
  PROMO_VIDEO_ASPECT_LABELS,
  PROMO_VIDEO_GOAL_LABELS,
  PROMO_VIDEO_STYLE_LABELS,
  PROMO_VIDEO_VISUAL_MODE_LABELS,
  PROMO_VIDEO_VOICE_LABELS,
} from '@/lib/services/promo-video-core.service';
import { getRequiredCompanyId, isApiError, parseJsonBody, requireAuthAndCompany, resolveBodyCompanyId } from '@/lib/api-utils';
import { checkCompanyRateLimitAsync } from '@/lib/rate-limiter';
import { promoVideoRequestSchema } from '@/lib/validations';
import type { z } from 'zod';

type PromoVideoInput = z.infer<typeof promoVideoRequestSchema>;

function complexityForDuration(durationSeconds: number): number {
  if (durationSeconds === 90) return 9;
  if (durationSeconds === 60) return 7;
  return 5;
}

function productHuntCreativeRules(input: PromoVideoInput): string[] {
  if (input.goal !== 'product_hunt') return [];
  return [
    '- Product Hunt launch mode: make the product understandable in the first five seconds.',
    '- Show the live product early, focus on the launch promise, one crisp differentiator, and one memorable outcome.',
    '- Avoid implementation details, feature dumps, and generic startup hype.',
    '- End with a Product Hunt-ready CTA.',
  ];
}

function buildTaskDescription(input: PromoVideoInput, company: {
  name: string;
  slug: string;
  one_liner: string | null;
  original_idea: string | null;
  subdomain: string | null;
  custom_domain: string | null;
}): string {
  const liveUrl = resolvePromoVideoLiveUrl(company);
  const cta = getDefaultPromoVideoCta(input.goal, company.name, input.cta);

  return [
    `Create the final customer-facing product demo promo for ${company.name}.`,
    '',
    'Company/product context:',
    `- Company: ${company.name}`,
    `- One-liner: ${company.one_liner ?? 'Not set'}`,
    `- Original idea: ${company.original_idea ?? 'Not set'}`,
    `- Live URL: ${liveUrl}`,
    '',
    'Founder-approved video inputs:',
    `- Goal: ${PROMO_VIDEO_GOAL_LABELS[input.goal]}`,
    `- Length: ${input.duration_seconds}s`,
    `- Format: ${PROMO_VIDEO_ASPECT_LABELS[input.aspect_ratio]}`,
    `- Style: ${PROMO_VIDEO_STYLE_LABELS[input.style]}`,
    `- Visuals: ${PROMO_VIDEO_VISUAL_MODE_LABELS[input.visual_mode]}`,
    `- Voice: ${PROMO_VIDEO_VOICE_LABELS[input.voice_mode]}`,
    `- CTA: ${cta}`,
    '',
    'Creative rules:',
    '- Explain only the founder product, the customer problem, the visible product flow, the outcome, and the CTA.',
    '- Never mention how the video is made or any internal Baljia tooling.',
    '- Keep narration, captions, and headlines customer-facing.',
    '- Do not log in, create accounts, submit payments, or interact with unrelated third-party sites.',
    ...productHuntCreativeRules(input),
  ].join('\n');
}

export async function GET(request: NextRequest) {
  const companyId = await getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const jobs = await listPromoVideoJobs(companyId);
  return NextResponse.json({ promo_videos: jobs });
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const companyId = await resolveBodyCompanyId(body as Record<string, unknown>);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const rateLimited = await checkCompanyRateLimitAsync(companyId, {
    maxRequests: 6,
    windowMs: 60 * 60_000,
  });
  if (rateLimited) return rateLimited;

  const parsed = promoVideoRequestSchema.safeParse({ ...(body as Record<string, unknown>), company_id: companyId });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [company] = await db.select({
    name: companies.name,
    slug: companies.slug,
    one_liner: companies.one_liner,
    original_idea: companies.original_idea,
    subdomain: companies.subdomain,
    custom_domain: companies.custom_domain,
  })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  }

  const input = parsed.data;
  const credits = getPromoVideoCreditCost(input.duration_seconds);
  const cta = getDefaultPromoVideoCta(input.goal, company.name, input.cta);
  const [job] = await db.insert(promoVideoJobs).values({
    company_id: companyId,
    status: 'finalizing',
    goal: input.goal,
    duration_seconds: input.duration_seconds,
    aspect_ratio: input.aspect_ratio,
    style: input.style,
    visual_mode: input.visual_mode,
    voice_mode: input.voice_mode,
    cta,
  }).returning();

  const task = await taskService.createTask({
    company_id: companyId,
    title: `Create final ${input.duration_seconds}s promo video for ${company.name}`,
    description: buildTaskDescription(input, company),
    tag: 'promo-video',
    priority: 90,
    source: 'founder_requested',
    assigned_to_agent_id: 30,
    max_turns: 20,
    estimated_credits: credits,
    complexity: complexityForDuration(input.duration_seconds),
    estimated_hours: input.duration_seconds >= 60 ? 2 : 1,
    execution_mode: 'deterministic',
    verification_level: 'quality_review',
    authorized_by: 'founder',
    authorization_reason: `Founder requested a direct final ${input.duration_seconds}s promo video render (user: ${auth.user.id}); preview step skipped.`,
  });

  const [updatedJob] = await db.update(promoVideoJobs)
    .set({ task_id: task.id, updated_at: new Date() })
    .where(eq(promoVideoJobs.id, job.id))
    .returning();

  await eventService.emit(companyId, 'promo_video_created', {
    job_id: updatedJob.id,
    task_id: task.id,
    goal: input.goal,
    duration_seconds: input.duration_seconds,
    aspect_ratio: input.aspect_ratio,
    style: input.style,
    visual_mode: input.visual_mode,
    voice_mode: input.voice_mode,
    credits,
  });

  await eventService.emit(companyId, 'task_created', {
    task_id: task.id,
    title: task.title,
    tag: task.tag,
    promo_video_job_id: updatedJob.id,
  });

  return NextResponse.json({
    job: mapPromoVideoJob(updatedJob),
    task,
    credits,
  }, { status: 201 });
}
