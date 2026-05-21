import './load-env-local';
import { randomUUID } from 'node:crypto';
import { eq, or, ilike } from 'drizzle-orm';
import { db, companies } from '@/lib/db';
import { handleMetaAdsTool } from '@/lib/agents/tools/meta-ads.tools';
import type { Task } from '@/types';

const targetUrl = 'https://canary-adversarial-booking-marketplace.onrender.com/';
const host = new URL(targetUrl).host;

async function getCompanyId(): Promise<string> {
  const [existing] = await db.select({ id: companies.id })
    .from(companies)
    .where(or(
      eq(companies.custom_domain, host),
      ilike(companies.name, '%AITutor%'),
      ilike(companies.slug, '%aitutor%'),
      ilike(companies.slug, '%canary%'),
    ))
    .limit(1);

  if (existing?.id) return existing.id;

  const [created] = await db.insert(companies).values({
    name: 'AITutor Marketplace',
    slug: `aitutor-marketplace-ad-${Date.now()}`,
    custom_domain: host,
    one_liner: 'Book vetted AI tutors, consultants, and mentors instantly.',
    original_idea: 'A marketplace where learners and teams can browse AI experts, choose available time slots, book sessions, subscribe to ongoing mentorship, and vendors track listings, availability, and payouts.',
  }).returning({ id: companies.id });

  if (!created?.id) throw new Error('Could not create company record for ad draft');
  return created.id;
}

function extractUrl(text: string, label: 'Temporary URL' | 'URL'): string {
  const match = text.match(new RegExp(`${label}:\\s*(https://\\S+)`));
  if (!match?.[1]) throw new Error(`Could not extract ${label} from tool output: ${text}`);
  return match[1].trim();
}

async function main() {
  const companyId = await getCompanyId();
  const task = {
    id: randomUUID(),
    company_id: companyId,
    title: 'Create draft Meta ad video for AITutor Marketplace',
    description: 'Founder requested a Fal-generated draft ad video uploaded to R2. Keep this as a creative draft only; do not create or launch a campaign.',
    authorization_reason: 'Founder requested creative generation only.',
  } as Task;

  const prompt = [
    'Create a vertical paid social video ad for AITutor Marketplace.',
    'Product: an AI tutoring and consulting marketplace where users book vetted AI tutors, consultants, and mentors instantly.',
    `Landing page: ${targetUrl}`,
    '',
    'Style reference: native UGC/direct-to-camera spokesperson ad, like a selfie/social video, with a person or realistic AI avatar centered in frame and a simple professional background.',
    'Do not copy any competitor brand, face, or exact wording. Make it original.',
    '',
    'Creative structure:',
    '0-2s hook: Need AI help today?',
    '2-5s reveal: Book vetted AI tutors and consultants instantly.',
    '5-8s benefits: Pick a time slot, see pricing, avoid back-and-forth.',
    '8-10s CTA: Book your first AI session.',
    '',
    'Visual requirements:',
    '9:16 vertical, mobile-first, clear face/avatar, natural direct-to-camera delivery, clean office or study background.',
    'Large bold white caption fragments in lower-middle safe zone, 2-5 words per beat.',
    'Keep all claims modest and supported by the page.',
  ].join('\n');

  const generated = await handleMetaAdsTool('generate_ad_video', {
    prompt,
    duration_seconds: 15,
    aspect_ratio: '9:16',
  }, task);
  console.log(generated);

  const temporaryUrl = extractUrl(generated, 'Temporary URL');
  const uploaded = await handleMetaAdsTool('save_ad_creative_to_r2', {
    source_url: temporaryUrl,
    filename: `aitutor-marketplace-meta-ad-${Date.now()}.mp4`,
    content_type: 'video/mp4',
  }, task);
  console.log(uploaded);

  const r2Url = extractUrl(uploaded, 'URL');
  console.log(JSON.stringify({ r2Url, temporaryUrl, companyId }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
