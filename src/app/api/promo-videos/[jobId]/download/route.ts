import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, promoVideoJobs } from '@/lib/db';
import { isApiError, requireAuthAndCompany } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/uuid-validation';
import { downloadFile } from '@/lib/services/storage.service';

export const runtime = 'nodejs';

function inferFileName(jobId: string, outputKey: string): string {
  const ext = outputKey.split('.').pop()?.toLowerCase() || 'mp4';
  return `promo-video-${jobId}.${ext}`;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  if (!isValidUUID(jobId)) {
    return NextResponse.json({ error: 'Invalid jobId format' }, { status: 400 });
  }

  const [job] = await db.select({
    id: promoVideoJobs.id,
    company_id: promoVideoJobs.company_id,
    output_key: promoVideoJobs.output_key,
    output_url: promoVideoJobs.output_url,
  })
    .from(promoVideoJobs)
    .where(eq(promoVideoJobs.id, jobId))
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: 'Promo video not found' }, { status: 404 });
  }

  const auth = await requireAuthAndCompany(job.company_id);
  if (isApiError(auth)) return auth;

  if (!job.output_key) {
    if (job.output_url) {
      return NextResponse.redirect(job.output_url, { status: 307 });
    }
    return NextResponse.json({ error: 'Final video is not ready yet' }, { status: 409 });
  }

  const file = await downloadFile(job.output_key);
  if (!file) {
    if (job.output_url) {
      return NextResponse.redirect(job.output_url, { status: 307 });
    }
    return NextResponse.json({ error: 'Final video could not be downloaded' }, { status: 502 });
  }

  return new NextResponse(file.content as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': file.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${inferFileName(job.id, job.output_key)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
