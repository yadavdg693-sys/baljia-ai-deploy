// Per-journey headers — encapsulates enrichment scope divergence
// Build/Grow: geo-only (leanHeader)
// Surprise Me: full personal enrichment (fullHeader)

import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { stage } from '../stage-runner';
import {
  loadFounderIdentity,
  enrichGeoIP,
  enrichLinkedIn,
  extractFounderAngle,
  composeFounderEnrichment,
} from './enrichment';
import { persistContext } from './memory-sections';
import type { PipelineContext } from '../types';

async function heartbeat(ctx: PipelineContext): Promise<void> {
  await db.update(companies)
    .set({ onboarding_status: 'running' })
    .where(eq(companies.id, ctx.companyId));
}

// leanHeader — Build/Grow journeys
// Geo-only enrichment; founder already declared what they're building/growing
export async function leanHeader(ctx: PipelineContext): Promise<void> {
  await stage(ctx, 'heartbeat', () => heartbeat(ctx));
  await stage(ctx, 'enrich_geo', async () => {
    await loadFounderIdentity(ctx);
    const geo = await enrichGeoIP(ctx.requestIp);
    composeFounderEnrichment(ctx, geo, null, null);
  }, { optional: true });
  await stage(ctx, 'persist_context', () => persistContext(ctx));
}

// fullHeader — Surprise Me journey
// Full personal enrichment; idea will be invented from founder background
export async function fullHeader(ctx: PipelineContext): Promise<void> {
  await stage(ctx, 'heartbeat', () => heartbeat(ctx));

  await stage(ctx, 'enrich_geo', async () => {
    await loadFounderIdentity(ctx);
    const geo = await enrichGeoIP(ctx.requestIp);

    // LinkedIn only (best-effort) — Twitter enrichment removed 2026-04-24
    // (low-ROI: bio adds little signal once LinkedIn + idea invention are in play)
    const linkedinSummary = ctx.founderName ? await enrichLinkedIn(ctx.founderName) : null;

    composeFounderEnrichment(ctx, geo, linkedinSummary, null);
  }, { optional: true });

  await stage(ctx, 'extract_founder_angle', () => extractFounderAngle(ctx), { optional: true });

  await stage(ctx, 'persist_context', () => persistContext(ctx));
}
