import { eq } from 'drizzle-orm';
import { db, companies, promoVideoJobs } from '@/lib/db';
import * as taskService from '@/lib/services/task.service';
import { launchTask } from '@/lib/agents/worker-launcher';
import type { PromoVideoAspectRatio, PromoVideoGoal, PromoVideoStyle, PromoVideoVisualMode, PromoVideoVoiceMode } from '@/types';

const jobId = process.argv[2];

if (!jobId) {
  console.error('Usage: npx tsx --env-file=.env.local src/scripts/rerender-promo-video-final.ts <promoVideoJobId>');
  process.exit(1);
}

const goalLabels: Record<PromoVideoGoal, string> = {
  attention: 'Get attention',
  launch: 'Announce launch',
  product_hunt: 'Product Hunt launch',
  explain: 'Explain product',
  demo: 'Show product demo',
  pitch: 'Pitch customers/investors',
};

const aspectLabels: Record<PromoVideoAspectRatio, string> = {
  '9:16': '9:16 vertical',
  '16:9': '16:9 landscape',
  '1:1': '1:1 square',
};

const styleLabels: Record<PromoVideoStyle, string> = {
  product_demo: 'Product demo',
  clean_saas: 'Clean SaaS promo',
  cinematic_ui: 'Cinematic UI',
};

const visualModeLabels: Record<PromoVideoVisualMode, string> = {
  actual_site: 'Actual site demo',
  cinematic: 'Cinematic promo',
};

const voiceLabels: Record<PromoVideoVoiceMode, string> = {
  deepgram: 'Deepgram voice',
  founder_avatar: 'Founder avatar voice',
};

function complexityForDuration(value: number): number {
  if (value === 90) return 9;
  if (value === 60) return 7;
  return 5;
}

async function main() {
  const [job] = await db.select().from(promoVideoJobs).where(eq(promoVideoJobs.id, jobId)).limit(1);
  if (!job) throw new Error(`Promo video job not found: ${jobId}`);

  const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, job.company_id)).limit(1);
  if (!company) throw new Error(`Company not found: ${job.company_id}`);

  const durationSeconds = Number(job.duration_seconds);
  const goal = job.goal as PromoVideoGoal;
  const aspectRatio = job.aspect_ratio as PromoVideoAspectRatio;
  const style = job.style as PromoVideoStyle;
  const visualMode = job.visual_mode as PromoVideoVisualMode;
  const voiceMode = (process.env.PROMO_VOICE_MODE === 'founder_avatar' || job.voice_mode === 'founder_avatar'
    ? 'founder_avatar'
    : 'deepgram') as PromoVideoVoiceMode;
  const cta = job.cta ?? `Try ${company.name}`;

  const task = await taskService.createTask({
    company_id: job.company_id,
    title: `Create final ${durationSeconds}s promo video for ${company.name}`,
    description: [
      `Create the approved final product promo for ${company.name}.`,
      '',
      'Founder-approved video inputs:',
      `- Goal: ${goalLabels[goal]}`,
      `- Length: ${durationSeconds}s`,
      `- Format: ${aspectLabels[aspectRatio]}`,
      `- Style: ${styleLabels[style]}`,
      `- Visuals: ${visualModeLabels[visualMode]}`,
      `- Voice: ${voiceLabels[voiceMode]}`,
      `- CTA: ${cta}`,
      '',
      'Creative rules:',
      '- Reuse the approved preview story.',
      '- Add customer-facing voiceover when available.',
      '- Explain only the customer problem, visible product flow, outcome, and CTA.',
      '- Never mention how the video is made or any internal Baljia tooling.',
    ].join('\n'),
    tag: 'promo-video',
    priority: 90,
    source: 'founder_requested',
    assigned_to_agent_id: 30,
    max_turns: 20,
    estimated_credits: 1,
    complexity: complexityForDuration(durationSeconds),
    estimated_hours: durationSeconds >= 60 ? 2 : 1,
    execution_mode: 'deterministic',
    verification_level: 'quality_review',
    authorized_by: 'founder',
    authorization_reason: 'Founder/operator requested final promo video rerender from local Codex session.',
  });

  await db.update(promoVideoJobs)
    .set({
      task_id: task.id,
      status: 'finalizing',
      voice_mode: voiceMode,
      output_key: null,
      output_url: null,
      error_message: null,
      updated_at: new Date(),
    })
    .where(eq(promoVideoJobs.id, job.id));

  console.log(JSON.stringify({ stage: 'final_task_created', jobId: job.id, taskId: task.id }, null, 2));
  await launchTask(task.id, { subscriptionFunded: true });

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
