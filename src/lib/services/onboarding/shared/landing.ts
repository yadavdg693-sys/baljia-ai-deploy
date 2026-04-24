// Landing page generator — narrative-first HTML stored as document
// AND (per ADR-002 split hosting) deployed to Cloudflare so the founder's
// subdomain ({slug}.baljia.app) goes live during onboarding.

import { db, documents } from '@/lib/db';
import { createLogger } from '@/lib/logger';
import * as documentService from '@/lib/services/document.service';
import { sanitizeForFounder } from '@/lib/founder-safety/sanitize';
import {
  deployLandingPage,
  isLandingDeployConfigured,
  getLandingDeployTarget,
} from '@/lib/services/landing-deploy.service';
import { provisionWildcardSubdomain } from '@/lib/services/domain.service';
import { callSmallLLM } from '../llm/small-llm';
import type { PipelineContext } from '../types';

const log = createLogger('OnboardingLanding');

export async function generateLandingPage(ctx: PipelineContext): Promise<void> {
  const contextParts: string[] = [];
  if (ctx.companyName) contextParts.push(`Company: ${ctx.companyName}`);
  if (ctx.oneLiner) contextParts.push(`One-liner: ${ctx.oneLiner}`);
  if (ctx.mission) contextParts.push(`Mission: ${ctx.mission}`);
  if (ctx.founderAngle) contextParts.push(`Founder positioning: ${ctx.founderAngle.slice(0, 200)}`);
  if (ctx.marketResearch) contextParts.push(`Market context: ${ctx.marketResearch.slice(0, 300)}`);

  const prompt = `Generate a single-page landing page in HTML for a startup. Make it narrative-first and launch-ready.

${contextParts.join('\n')}

The page must include:
1. Brand name as wordmark at top
2. Category tag that accurately describes the product (2-4 word phrase, derived from the company's actual positioning — do NOT default to "AI-Powered X" unless that truthfully fits)
3. Hard-hitting headline (one sentence)
4. Short explanatory paragraph (2-3 sentences)
5. Problem framing section
6. 3 feature/capability blocks
7. "How it works" in 3 steps
8. Closing manifesto paragraph
9. Footer with "Built and operated by Baljia" attribution

Style: pick typography, color palette, and visual treatment that fit THIS company's positioning, industry, and audience. Do not default to a generic template — a wellness brand looks different from a dev tool which looks different from a consumer app. Clean, readable, mobile-responsive. Use inline CSS only. No external dependencies. Full valid HTML document. Keep it under 300 lines.`;

  try {
    const html = await callSmallLLM(prompt, 4000);

    // Founder-safety: landing HTML ships to the public internet at
    // {slug}.baljia.app — leaks are externally visible. Audit mode logs
    // infra-phrase violations to Sentry without mangling the page so we
    // catch regressions at source (the landing prompt) instead of in prod.
    sanitizeForFounder(html, {
      mode: 'audit',
      context: { callsite: 'landing.generateLandingPage', companyId: ctx.companyId, slug: ctx.slug ?? null },
    });

    const docs = await documentService.getDocuments(ctx.companyId);
    const landingDoc = docs.find((d) => d.doc_type === 'landing_page');
    if (landingDoc) {
      await documentService.updateDocument(landingDoc.id, html);
    } else {
      await db.insert(documents).values({
        company_id: ctx.companyId,
        doc_type: 'landing_page',
        title: `${ctx.companyName} Landing Page`,
        content: html,
        is_empty: false,
      });
    }
    log.info('Landing page generated', { companyId: ctx.companyId });

    // Publish to {slug}.baljia.app (ADR-002: Cloudflare primary, Render legacy)
    // Non-blocking: onboarding continues even if deploy fails; the agent's
    // cf_verify_founder_app tool or a later remediation task can retry.
    await publishLandingToSubdomain(ctx, html);
  } catch (err) {
    log.warn('Landing page generation failed — non-blocking', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ──────────────────────────────────────────────────────────────
// Publish — ADR-002 split-hosting path
// ──────────────────────────────────────────────────────────────
//
// Flow:
//  1. Ensure company.subdomain is set (provisionWildcardSubdomain is a
//     cheap DB-only update — no CF API call, since *.baljia.app is a single
//     wildcard CNAME on the zone).
//  2. Call deployLandingPage which dispatches to CF (R2 upload) when
//     CLOUDFLARE_API_TOKEN etc. are configured, else falls through to the
//     Render legacy path so dev/CI without CF creds still works.
//  3. Log the outcome. Failures are non-fatal — onboarding proceeds and the
//     verifier/remediation loop can fix it later.
async function publishLandingToSubdomain(ctx: PipelineContext, html: string): Promise<void> {
  if (!ctx.slug) {
    log.warn('No slug on pipeline context — skipping subdomain publish', { companyId: ctx.companyId });
    return;
  }
  if (!isLandingDeployConfigured()) {
    log.info('Landing deploy not configured (neither CF nor Render) — skipping publish', {
      companyId: ctx.companyId,
      slug: ctx.slug,
    });
    return;
  }

  const target = getLandingDeployTarget();
  log.info('Publishing landing', { companyId: ctx.companyId, slug: ctx.slug, target });

  // Always write the subdomain + placeholder custom_domain first. On CF this
  // is effectively the "deploy manifest" — no DNS call needed (wildcard).
  // On Render the explicit provisionSubdomain call inside deployLandingPage
  // handles per-founder DNS separately.
  try {
    await provisionWildcardSubdomain(ctx.companyId, ctx.slug);
  } catch (err) {
    log.warn('provisionWildcardSubdomain failed — continuing with deploy', {
      companyId: ctx.companyId,
      slug: ctx.slug,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const result = await deployLandingPage({
      companyId: ctx.companyId,
      slug: ctx.slug,
      companyName: ctx.companyName || ctx.slug,
      landingHtml: html,
    });
    if (!result) {
      log.warn('Landing deploy returned null — published-state unknown', {
        companyId: ctx.companyId,
        slug: ctx.slug,
      });
      return;
    }
    log.info('Landing published', {
      companyId: ctx.companyId,
      slug: ctx.slug,
      target: result.target,
      url: result.url,
    });
  } catch (err) {
    log.warn('Landing deploy threw — non-blocking', {
      companyId: ctx.companyId,
      slug: ctx.slug,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
