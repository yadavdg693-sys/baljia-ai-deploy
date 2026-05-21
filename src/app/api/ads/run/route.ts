import { NextRequest, NextResponse } from 'next/server';
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import { requireAuthAndCompany, resolveBodyCompanyId, parseJsonBody, isApiError } from '@/lib/api-utils';
import { runAdsSchema } from '@/lib/validations';
import type { z } from 'zod';
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';

const GOAL_LABELS = {
  traffic: 'Traffic',
  leads: 'Leads',
  awareness: 'Product awareness',
} as const;

function normalizeUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function goalToObjective(goal: keyof typeof GOAL_LABELS): 'TRAFFIC' | 'CONVERSIONS' | 'AWARENESS' {
  if (goal === 'awareness') return 'AWARENESS';
  if (goal === 'leads') return 'CONVERSIONS';
  return 'TRAFFIC';
}

function goalToOptimization(goal: keyof typeof GOAL_LABELS): 'LINK_CLICKS' | 'OFFSITE_CONVERSIONS' | 'REACH' {
  if (goal === 'awareness') return 'REACH';
  if (goal === 'leads') return 'OFFSITE_CONVERSIONS';
  return 'LINK_CLICKS';
}

function getMissingAdsCapabilities(): string[] {
  const missing: string[] = [];
  if (!process.env.META_ADS_ACCESS_TOKEN || !process.env.META_ADS_ACCOUNT_ID) {
    missing.push('meta_ads');
  }
  if (!process.env.META_PAGE_ID) missing.push('meta_page');
  if (!process.env.META_PIXEL_ID) missing.push('meta_pixel');
  if (
    !process.env.R2_ACCOUNT_ID ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY ||
    !process.env.R2_BUCKET_NAME
  ) {
    missing.push('creative_storage');
  }
  if (!process.env.HEYGEN_API_KEY && !process.env.FAL_KEY) missing.push('video_generation');
  return missing;
}

type RunAdsInput = z.infer<typeof runAdsSchema>;

type AdsCompanyContext = {
  name: string;
  slug: string;
  one_liner: string | null;
  original_idea: string | null;
  subdomain: string | null;
  custom_domain: string | null;
};

function compactText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function companyPositioning(company: AdsCompanyContext): string {
  return compactText(company.one_liner) ?? compactText(company.original_idea) ?? company.name;
}

function landingUrlFor(input: RunAdsInput, company: AdsCompanyContext): string {
  if (input.landing_url) return normalizeUrl(input.landing_url);
  if (company.custom_domain) return normalizeUrl(company.custom_domain);
  if (company.subdomain) return `https://${company.subdomain}.baljia.app`;
  return `https://${company.slug}.baljia.app`;
}

function audienceFor(input: RunAdsInput, company: AdsCompanyContext): string {
  return input.audience ?? `People likely to be interested in ${input.promoted_item} from ${companyPositioning(company)}`;
}

function creativeBriefFor(input: RunAdsInput, company: AdsCompanyContext): string {
  return input.creative_brief
    ?? `Promote ${input.promoted_item} for ${companyPositioning(company)}. Use company positioning, original idea, and landing page context to infer the strongest hook, proof points, and CTA.`;
}

function buildTaskDescription(input: RunAdsInput, company: AdsCompanyContext): string {
  const landingUrl = landingUrlFor(input, company);
  const approvalMode = input.approval_mode === 'autopilot'
    ? 'Autopilot within approved budget'
    : 'Review before launch';
  const audience = audienceFor(input, company);

  return [
    'Run a platform-managed Meta ads campaign for this company.',
    '',
    'Company/product context:',
    `- Company: ${company.name}`,
    `- One-liner: ${compactText(company.one_liner) ?? 'Not set'}`,
    `- Original idea: ${compactText(company.original_idea) ?? 'Not set'}`,
    `- Live URL: ${landingUrl}`,
    '',
    'Founder-approved campaign inputs:',
    `- Promoting: ${input.promoted_item}`,
    `- Goal: ${GOAL_LABELS[input.goal]}`,
    `- Meta objective: ${goalToObjective(input.goal)}`,
    `- Meta optimization goal: ${goalToOptimization(input.goal)}`,
    `- Daily ad budget: $${input.daily_budget.toFixed(2)}`,
    `- Landing URL: ${landingUrl}`,
    `- Audience: ${audience}`,
    `- Country: ${input.country.toUpperCase()}`,
    `- Age range: ${input.age_min}-${input.age_max}`,
    `- Approval mode: ${approvalMode}`,
    `- Launch gate: ${input.approval_mode === 'autopilot' ? 'autopilot_allowed' : 'review_required'}`,
    `- Creative brief: ${creativeBriefFor(input, company)}`,
    '',
    'Required execution sequence:',
    `1. Review company context and landing page before writing copy. Focus the campaign on: ${input.promoted_item}.`,
    '2. Generate a 15-second 9:16 UGC/direct-to-camera video ad with generate_ad_video: strong hook, product reveal, benefit, CTA, and bold caption fragments.',
    '3. Save the generated creative asset to R2 with save_ad_creative_to_r2 and keep the public HTTPS URL.',
    '4. Create the Meta campaign as PAUSED with the approved objective and budget.',
    '5. Upload the R2 video URL to Meta with upload_ad_video.',
    '6. Create the video creative with create_video_creative using META_PAGE_ID.',
    '7. Create the ad set as PAUSED with the approved daily budget, audience, country, and age range.',
    '8. Create the ad as PAUSED with create_ad using the creative ID from step 6, then save the R2 creative URL with save_ad.',
    input.approval_mode === 'autopilot'
      ? '9. If every created asset matches the approved inputs, activate the campaign within the approved daily budget. Do not exceed the daily budget.'
      : '9. Stop after the paused campaign/ad set/ad are ready. Do not activate_campaign until the founder approves the preview.',
    '',
    'Operational guardrails:',
    '- Use Baljia platform Meta assets, not the customer Meta login.',
    '- Keep spend separate from task credits.',
    '- Monitor CTR, CPC, spend, and leads after launch.',
    '- Pause underperformers and create a refreshed creative when CTR < 0.5% or CPC > $2.',
    '- Never create or activate anything above the approved budget.',
  ].join('\n');
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const companyId = await resolveBodyCompanyId(body as Record<string, unknown>);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const parsed = runAdsSchema.safeParse({ ...(body as Record<string, unknown>), company_id: companyId });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.age_min > parsed.data.age_max) {
    return NextResponse.json({ error: 'age_min cannot be greater than age_max' }, { status: 400 });
  }

  const missingConfig = getMissingAdsCapabilities();
  if (missingConfig.length > 0) {
    return NextResponse.json({
      error: 'Meta Ads is not fully configured.',
      missing_capabilities: missingConfig,
    }, { status: 503 });
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

  const task = await taskService.createTask({
    company_id: companyId,
    title: `Run Meta ads: ${parsed.data.promoted_item} at $${parsed.data.daily_budget.toFixed(0)}/day`,
    description: buildTaskDescription(parsed.data, company),
    tag: 'meta-ads',
    priority: 90,
    source: 'founder_requested',
    assigned_to_agent_id: 41,
    max_turns: 100,
    estimated_credits: 1,
    complexity: 7,
    estimated_hours: 2,
    execution_mode: 'full_agent',
    verification_level: 'hybrid',
    authorized_by: 'founder',
    authorization_reason: `Founder requested platform-managed Meta ads within the selected daily budget (user: ${auth.user.id})`,
  });

  await eventService.emit(companyId, 'task_created', {
    task_id: task.id,
    title: task.title,
    promoted_item: parsed.data.promoted_item,
    ad_goal: parsed.data.goal,
    daily_budget: parsed.data.daily_budget,
    approval_mode: parsed.data.approval_mode,
  });

  return NextResponse.json({
    task,
    budget: {
      daily_ad_budget: parsed.data.daily_budget,
      platform_fee_rate: 0.2,
    },
  }, { status: 201 });
}
