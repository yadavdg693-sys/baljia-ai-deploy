// Infrastructure provisioning — slug + company email routing
// Light-touch: subdomain metadata + Cloudflare email rule. No GitHub/Render/Neon yet.

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

  // {slug}.baljia.app served by platform via wildcard DNS + middleware
  // (per-company Render service provisioned later by Engineering agent when building real product)
  await appendMemorySection(ctx.companyId, '## Infrastructure', [
    `Slug: ${slug}`,
    `Subdomain: ${slug}.baljia.app (served by platform — no Render service yet)`,
    `Database: platform shared Postgres (per-company Neon DB will be provisioned by Engineering agent on first need)`,
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
