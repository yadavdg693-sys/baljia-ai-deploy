import { eq } from 'drizzle-orm';
import { db, companies, promoVideoJobs } from '@/lib/db';
import * as taskService from '@/lib/services/task.service';
import { launchTask } from '@/lib/agents/worker-launcher';

const companyId = process.argv[2];
const targetUrl = process.argv[3];

if (!companyId || !targetUrl) {
  console.error('Usage: npx tsx --env-file=.env.local src/scripts/generate-promo-video-for-url.ts <companyId> <url>');
  process.exit(1);
}

const parsedUrl = new URL(targetUrl);
const productName = process.env.PROMO_PRODUCT_NAME || 'AITutor Marketplace';
const durationSeconds = Number(process.env.PROMO_DURATION_SECONDS || 30);
const cta = process.env.PROMO_CTA || 'Book a session';
const oneLiner = process.env.PROMO_ONE_LINER ||
  'A marketplace where learners and teams can book vetted AI tutors, consultants, and mentors instantly.';
const originalIdea = process.env.PROMO_ORIGINAL_IDEA ||
  'Customers browse AI experts, choose available time slots, book sessions, subscribe to ongoing mentorship, and vendors track listings, availability, and payouts.';
const visualMode = process.env.PROMO_VISUAL_MODE === 'actual_site' ? 'actual_site' : 'cinematic';
const visualModeLabel = visualMode === 'actual_site' ? 'Actual site demo' : 'Cinematic promo';
const voiceMode = process.env.PROMO_VOICE_MODE === 'founder_avatar' ? 'founder_avatar' : 'deepgram';
const voiceModeLabel = voiceMode === 'founder_avatar' ? 'Founder avatar voice' : 'Deepgram voice';
const goal = process.env.PROMO_GOAL === 'product_hunt' ? 'product_hunt' : 'demo';
const goalLabel = goal === 'product_hunt' ? 'Product Hunt launch' : 'Show product demo';

function complexityForDuration(value: number): number {
  if (value === 90) return 9;
  if (value === 60) return 7;
  return 5;
}

async function createPromoTask(title: string, description: string, estimatedCredits: number) {
  return taskService.createTask({
    company_id: companyId,
    title,
    description,
    tag: 'promo-video',
    priority: 90,
    source: 'founder_requested',
    assigned_to_agent_id: 30,
    max_turns: 20,
    estimated_credits: estimatedCredits,
    complexity: complexityForDuration(durationSeconds),
    estimated_hours: durationSeconds >= 60 ? 2 : 1,
    execution_mode: 'deterministic',
    verification_level: 'quality_review',
    authorized_by: 'founder',
    authorization_reason: 'Founder/operator requested promo video generation from local Codex session.',
  });
}

function previewDescription(): string {
  return [
    `Create a customer-facing product demo promo for ${productName}.`,
    '',
    'Company/product context:',
    `- Company: ${productName}`,
    `- One-liner: ${oneLiner}`,
    `- Original idea: ${originalIdea}`,
    `- Live URL: ${targetUrl}`,
    '',
    'Founder-approved video inputs:',
    `- Goal: ${goalLabel}`,
    `- Length: ${durationSeconds}s`,
    '- Format: 16:9 landscape',
    '- Style: Product demo',
    `- Visuals: ${visualModeLabel}`,
    `- Voice: ${voiceModeLabel}`,
    `- CTA: ${cta}`,
    '',
    'Creative rules:',
    '- First create a preview for founder approval.',
    '- Explain only the customer problem, visible product flow, outcome, and CTA.',
    '- Never mention how the video is made or any internal Baljia tooling.',
  ].join('\n');
}

function finalDescription(): string {
  return [
    `Create the approved final product promo for ${productName}.`,
    '',
    'Founder-approved video inputs:',
    `- Goal: ${goalLabel}`,
    `- Length: ${durationSeconds}s`,
    '- Format: 16:9 landscape',
    '- Style: Product demo',
    `- Visuals: ${visualModeLabel}`,
    `- Voice: ${voiceModeLabel}`,
    `- CTA: ${cta}`,
    '',
    'Creative rules:',
    '- Reuse the approved preview story.',
    '- Add customer-facing voiceover when available.',
    '- Explain only the customer problem, visible product flow, outcome, and CTA.',
    '- Never mention how the video is made or any internal Baljia tooling.',
  ].join('\n');
}

async function main() {
  await db.update(companies)
    .set({
      name: productName,
      custom_domain: parsedUrl.host,
      one_liner: oneLiner,
      original_idea: originalIdea,
      updated_at: new Date(),
    })
    .where(eq(companies.id, companyId));

  const [job] = await db.insert(promoVideoJobs).values({
    company_id: companyId,
    status: 'queued',
    goal,
    duration_seconds: durationSeconds,
    aspect_ratio: '16:9',
    style: 'product_demo',
    visual_mode: visualMode,
    voice_mode: voiceMode,
    cta,
  }).returning();

  const previewTask = await createPromoTask(`Create ${durationSeconds}s promo video preview for ${productName}`, previewDescription(), 1);
  await db.update(promoVideoJobs)
    .set({ task_id: previewTask.id, updated_at: new Date() })
    .where(eq(promoVideoJobs.id, job.id));

  console.log(JSON.stringify({ stage: 'preview_task_created', jobId: job.id, taskId: previewTask.id }, null, 2));
  await launchTask(previewTask.id, { subscriptionFunded: true });

  const [afterPreview] = await db.select().from(promoVideoJobs).where(eq(promoVideoJobs.id, job.id)).limit(1);
  if (!afterPreview || afterPreview.status !== 'preview_ready') {
    throw new Error(`Preview did not finish cleanly. Status: ${afterPreview?.status ?? 'missing'} Error: ${afterPreview?.error_message ?? ''}`);
  }
  console.log(JSON.stringify({ stage: 'preview_ready', jobId: job.id, previewUrl: afterPreview.preview_url }, null, 2));

  const finalTask = await createPromoTask(`Create final ${durationSeconds}s promo video for ${productName}`, finalDescription(), 1);
  await db.update(promoVideoJobs)
    .set({ task_id: finalTask.id, status: 'finalizing', updated_at: new Date(), error_message: null })
    .where(eq(promoVideoJobs.id, job.id));

  console.log(JSON.stringify({ stage: 'final_task_created', jobId: job.id, taskId: finalTask.id }, null, 2));
  await launchTask(finalTask.id, { subscriptionFunded: true });

  const [finalJob] = await db.select().from(promoVideoJobs).where(eq(promoVideoJobs.id, job.id)).limit(1);
  console.log(JSON.stringify({
    stage: 'done',
    jobId: finalJob?.id,
    status: finalJob?.status,
    outputUrl: finalJob?.output_url,
    audioUrl: finalJob?.audio_url,
    thumbnailUrl: finalJob?.thumbnail_url,
    error: finalJob?.error_message,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
