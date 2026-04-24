// Infrastructure provisioning — slug + company email routing.
// Memory section is founder-facing (CEO reads it each chat turn), so we keep
// the language neutral: no vendor names, no hosting provider, no DB engine.

import { db, companies } from '@/lib/db';
import { eq, and, ne } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import { provisionCompanyEmail } from '@/lib/services/company-email.service';
import { appendMemorySection } from './memory-sections';
import type { PipelineContext } from '../types';

const log = createLogger('OnboardingInfra');

export async function provisionInfrastructure(ctx: PipelineContext): Promise<void> {
  const { generateSlug } = await import('@/lib/slug');

  const slug = await generateSlug(ctx.companyName, async (candidate) => {
    const [existing] = await db.select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.slug, candidate), ne(companies.id, ctx.companyId)))
      .limit(1);
    return !!existing;
  });

  ctx.slug = slug;
  await db.update(companies)
    .set({ name: ctx.companyName, slug })
    .where(eq(companies.id, ctx.companyId));

  // Founder-facing memory section — CEO reads it each chat turn. Keep vendor-
  // agnostic: only facts the founder themselves would say.
  await appendMemorySection(ctx.companyId, '## Company setup', [
    `Slug: ${slug}`,
    `Subdomain: ${slug}.baljia.app`,
    `Company inbox: ${slug}@baljia.app`,
  ]);

  // Provision {slug}@baljia.app email (non-blocking) — Cloudflare routing rule
  try {
    await provisionCompanyEmail(ctx.companyId, slug, ctx.companyName, ctx.founderEmail);
    log.info('Company email provisioned', { email: `${slug}@baljia.app` });
  } catch (err) {
    log.warn('Email provisioning failed — can be retried later', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
