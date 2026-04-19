// Company naming — LLM-generated with 3-retry slug collision handling

import { db, companies } from '@/lib/db';
import { eq, and, ne } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import { callSmallLLM } from '../llm/small-llm';
import type { PipelineContext } from '../types';

const log = createLogger('OnboardingNaming');
const MAX_NAME_RETRIES = 3;

export async function nameCompany(ctx: PipelineContext): Promise<void> {
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

    const name = await callSmallLLM(prompt);
    const cleanName = name.trim().replace(/[^a-zA-Z0-9\s]/g, '').slice(0, 50);
    if (!cleanName) {
      throw new Error(`Company naming failed: LLM returned empty name on attempt ${attempt + 1}`);
    }

    const { generateSlug } = await import('@/lib/slug');
    const slug = await generateSlug(cleanName, async () => false);
    const [existing] = await db.select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.slug, slug), ne(companies.id, ctx.companyId)))
      .limit(1);

    if (!existing) {
      ctx.companyName = cleanName;
      return;
    }

    triedNames.push(cleanName);
    log.info(`Name collision on attempt ${attempt + 1}: "${cleanName}"`, { companyId: ctx.companyId });
  }

  throw new Error(
    `Company naming failed: ${MAX_NAME_RETRIES} attempts all had slug collisions (tried: ${triedNames.join(', ')})`,
  );
}
