// Company naming — LLM-generated with 3-retry slug collision handling

import { db, companies } from '@/lib/db';
import { eq, and, ne } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import { callSmallLLM } from '../llm/small-llm';
import { emitActivity, recordOnboardingIssue } from '../stage-runner';
import type { PipelineContext } from '../types';

const log = createLogger('OnboardingNaming');
const MAX_NAME_RETRIES = 3;

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function deterministicFallbackName(ctx: PipelineContext, triedNames: string[] = []): string {
  const source = [
    ctx.businessProfile?.business_name,
    ctx.refinedIdea?.refined_idea,
    ctx.inventedIdea?.invented_idea,
    ctx.input,
    ctx.strategy,
  ].find((value) => value?.trim()) || 'New Venture';

  const stopwords = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'into', 'like',
    'build', 'create', 'make', 'company', 'business', 'platform', 'tool', 'app',
  ]);
  const words = source
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !stopwords.has(word.toLowerCase()))
    .slice(0, 2);

  const base = (words.length ? words.map(titleCase).join(' ') : 'New Venture').slice(0, 42).trim();
  if (!triedNames.includes(base)) return base;

  const suffix = ctx.companyId.replace(/-/g, '').slice(0, 4).toUpperCase() || '01';
  return `${base} ${suffix}`.slice(0, 50).trim();
}

export async function nameCompany(ctx: PipelineContext): Promise<void> {
  // Resume guard (Bug 1): if the orchestrator hydrated ctx from a DB row
  // that already had a non-placeholder name, do NOT regenerate. The
  // founder's company identity is locked the moment provision_infrastructure
  // committed it; a retry must preserve "Lichora", not roll a new name.
  if (ctx.companyName && ctx.companyName !== 'My Company') {
    log.info('Skipping name generation — company already named', {
      companyId: ctx.companyId,
      name: ctx.companyName,
    });
    await emitActivity(ctx, `Company name: ${ctx.companyName}`, 'naming');
    return;
  }

  if (ctx.journey === 'grow_my_company' && ctx.businessProfile?.business_name?.trim()) {
    const existingName = ctx.businessProfile.business_name.trim().replace(/\s+/g, ' ').slice(0, 80);
    ctx.companyName = existingName;
    log.info('Using existing business name for Grow journey', {
      companyId: ctx.companyId,
      name: existingName,
    });
    await emitActivity(ctx, `Company name: ${existingName}`, 'naming');
    return;
  }

  const contextLines: string[] = [];
  if (ctx.founderName) contextLines.push(`Founder name: ${ctx.founderName}`);
  if (ctx.input) contextLines.push(`Idea/URL: ${ctx.input}`);
  if (ctx.enrichedFounderSummary) contextLines.push(`Founder background: ${ctx.enrichedFounderSummary.slice(0, 300)}`);
  if (ctx.enrichedBusinessSummary) contextLines.push(`Business context: ${ctx.enrichedBusinessSummary.slice(0, 300)}`);

  const triedNames: string[] = [];

  for (let attempt = 0; attempt < MAX_NAME_RETRIES; attempt++) {
    const retryHint = triedNames.length > 0
      ? `\n\nIMPORTANT: The following names are already taken: ${triedNames.join(', ')}. Generate a completely different name.`
      : '';

    const prompt = `You are naming a startup company. Generate a short, memorable, unique company name (1-2 words, no punctuation).

Context:
${contextLines.join('\n')}
Journey type: ${ctx.journey}
Strategy: ${ctx.strategy}

Rules:
- 1-2 words only
- Easy to spell and remember
- No generic words like "Tech", "Digital", "Solutions"
- No existing famous brand names${retryHint}

Reply with ONLY the company name. Nothing else.`;

    let cleanName: string;
    try {
      const name = await callSmallLLM(prompt);
      cleanName = name.trim().replace(/[^a-zA-Z0-9\s]/g, '').slice(0, 50);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await recordOnboardingIssue(ctx, {
        stage: 'name_company',
        kind: 'company_name_llm_fallback',
        severity: 'medium',
        error,
        message: 'Company naming model failed, so onboarding used a deterministic fallback name.',
        fallbackUsed: true,
      });
      cleanName = deterministicFallbackName(ctx, triedNames);
    }

    if (!cleanName) {
      await recordOnboardingIssue(ctx, {
        stage: 'name_company',
        kind: 'company_name_empty_fallback',
        severity: 'medium',
        message: 'Company naming returned an empty name, so onboarding used a deterministic fallback name.',
        fallbackUsed: true,
      });
      cleanName = deterministicFallbackName(ctx, triedNames);
    }

    const { generateSlug } = await import('@/lib/slug');
    const slug = await generateSlug(cleanName, async () => false);
    const [existing] = await db.select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.slug, slug), ne(companies.id, ctx.companyId)))
      .limit(1);

    if (!existing) {
      ctx.companyName = cleanName;
      await emitActivity(ctx, `Company name: ${cleanName}`, 'naming');
      return;
    }

    triedNames.push(cleanName);
    await emitActivity(ctx, `Name "${cleanName}" taken — trying another`, 'naming');
    log.info(`Name collision on attempt ${attempt + 1}: "${cleanName}"`, { companyId: ctx.companyId });
  }

  const fallbackName = deterministicFallbackName(ctx, triedNames);
  ctx.companyName = fallbackName;
  await recordOnboardingIssue(ctx, {
    stage: 'name_company',
    kind: 'company_name_collision_fallback',
    severity: 'medium',
    message: 'All generated company names collided, so onboarding continued with a deterministic fallback name.',
    fallbackUsed: true,
    metadata: { tried_names: triedNames },
  });
  await emitActivity(ctx, `Company name: ${fallbackName}`, 'naming');
}
