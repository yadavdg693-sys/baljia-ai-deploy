import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { eq } from 'drizzle-orm';
import { db, companies, promoVideoJobs } from '@/lib/db';
import { getPromoVideoDimensions, resolvePromoVideoLiveUrl } from '@/lib/services/promo-video-core.service';
import type {
  PromoVideoAspectRatio,
  PromoVideoCaptureAsset,
  PromoVideoStoryboard,
  PromoVideoStyle,
} from '@/types';

const jobId = process.argv[2];
const frameSeconds = (process.argv[3] ?? '2,7,13,20,27')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value >= 0);

if (!jobId) {
  console.error('Usage: npx tsx --env-file=.env.local src/scripts/render-promo-video-frames.ts <promoVideoJobId> [secondsCsv]');
  process.exit(1);
}

async function main() {
  const [job] = await db.select().from(promoVideoJobs).where(eq(promoVideoJobs.id, jobId)).limit(1);
  if (!job) throw new Error(`Promo video job not found: ${jobId}`);

  const [company] = await db.select().from(companies).where(eq(companies.id, job.company_id)).limit(1);
  if (!company) throw new Error(`Company not found: ${job.company_id}`);

  const storyboard = job.storyboard as PromoVideoStoryboard | null;
  if (!storyboard?.scenes?.length) throw new Error(`Promo video job has no storyboard: ${jobId}`);

  const assets = Array.isArray(job.capture_assets) ? job.capture_assets as PromoVideoCaptureAsset[] : [];
  const aspectRatio = job.aspect_ratio as PromoVideoAspectRatio;
  const { width, height } = getPromoVideoDimensions(aspectRatio);
  const fps = 30;
  const durationInFrames = job.duration_seconds * fps;
  const inputProps = {
    title: storyboard.title,
    companyName: company.name,
    liveUrl: resolvePromoVideoLiveUrl(company),
    cta: job.cta ?? `Try ${company.name}`,
    scenes: storyboard.scenes,
    assets,
    width,
    height,
    fps,
    durationInFrames,
    style: job.style as PromoVideoStyle,
    aspectRatio,
    audioUrl: null,
    phase: 'final' as const,
  };

  const outDir = path.join(os.tmpdir(), `baljia-promo-frames-${job.id}`);
  await mkdir(outDir, { recursive: true });
  const serveUrl = await bundle({
    entryPoint: path.join(process.cwd(), 'src', 'remotion', 'promo', 'Root.tsx'),
  });
  const composition = await selectComposition({
    serveUrl,
    id: 'PromoVideo',
    inputProps,
  });

  const frames: string[] = [];
  for (const second of frameSeconds) {
    const frame = Math.min(durationInFrames - 1, Math.round(second * fps));
    const output = path.join(outDir, `frame-${String(second).replace(/\./g, '_')}.png`);
    await renderStill({
      composition,
      serveUrl,
      inputProps,
      frame,
      output,
      chromiumOptions: {
        disableWebSecurity: true,
      },
    });
    frames.push(output);
  }

  console.log(JSON.stringify({
    jobId: job.id,
    outputDir: outDir,
    frames,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
