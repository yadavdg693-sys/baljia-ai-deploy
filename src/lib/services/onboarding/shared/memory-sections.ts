// Memory Layer 1 helpers — section-aware upsert that preserves other sections.
//
// IMPORTANT: these functions UPSERT (insert if row doesn't exist, update if it does).
// Before the Phase 0 refactor this was plain UPDATE, which silently no-oped when
// the memoryLayers row hadn't been created yet (e.g. onboarding runs before any
// CEO chat). Smoke test surfaced this — now we always ensure the row exists.
//
// Founder-safety: memory_layers.content is read by the CEO every chat turn,
// so any leak here contaminates every subsequent conversation. We sanitize
// in SOFT mode on every write — infra/internal terms get replaced with
// [redacted] and the violation is logged. Strict-mode would throw and break
// onboarding for a single bad phrase, which is worse than a redaction.

import { db, memoryLayers } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { sanitizeForFounder } from '@/lib/founder-safety/sanitize';
import type { PipelineContext } from '../types';

const LAYER_1_MAX_TOKENS = 15_000;

async function upsertLayer1(companyId: string, content: string): Promise<void> {
  // Last-chance sanitize — catches any write that skipped appendMemorySection.
  // Soft mode: redacts banned terms and logs so we find the leak without
  // breaking onboarding. Idempotent with appendMemorySection's pre-sanitize.
  const safe = sanitizeForFounder(content, {
    mode: 'soft',
    context: { callsite: 'upsertLayer1', companyId },
  }).clean;

  const [existing] = await db.select({ id: memoryLayers.id })
    .from(memoryLayers)
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, 1)))
    .limit(1);

  if (existing) {
    await db.update(memoryLayers)
      .set({ content: safe, updated_at: new Date() })
      .where(eq(memoryLayers.id, existing.id));
  } else {
    await db.insert(memoryLayers).values({
      company_id: companyId,
      layer: 1,
      content: safe,
      max_tokens: LAYER_1_MAX_TOKENS,
      token_count: Math.ceil(safe.length / 4), // rough estimate
    });
  }
}

// Reads current Layer 1 content, replaces the named section if it exists,
// or appends it if new. Prevents any write from destroying other sections.
// Inserts the row if it doesn't exist yet.
export async function appendMemorySection(
  companyId: string,
  sectionHeader: string,
  lines: string[],
): Promise<void> {
  const [data] = await db.select({ content: memoryLayers.content })
    .from(memoryLayers)
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, 1)))
    .limit(1);

  // Founder-safety: sanitize header + each line before composing the section.
  const safeHeader = sanitizeForFounder(sectionHeader, {
    mode: 'soft',
    context: { callsite: 'appendMemorySection.header', companyId },
  }).clean;
  const safeLines = lines.map((line) =>
    sanitizeForFounder(line, {
      mode: 'soft',
      context: { callsite: 'appendMemorySection.line', companyId },
    }).clean,
  );

  const newSection = `${safeHeader}\n${safeLines.join('\n')}`;
  let updated: string;

  if (data?.content) {
    const existing = data.content as string;
    const sectionRegex = new RegExp(
      `${sectionHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n## |$)`,
      'g',
    );
    if (sectionRegex.test(existing)) {
      updated = existing.replace(sectionRegex, newSection);
    } else {
      updated = `${existing}\n\n${newSection}`;
    }
  } else {
    updated = newSection;
  }

  await upsertLayer1(companyId, updated);
}

// Persist structured context sections to Layer 1 (founder profile, business,
// journey, browser hints). Upserts the row if it doesn't exist.
export async function persistContext(ctx: PipelineContext): Promise<void> {
  const sections: string[] = [];

  const founderLines: string[] = [];
  if (ctx.founderName) founderLines.push(`Name: ${ctx.founderName}`);
  if (ctx.founderEmail) founderLines.push(`Email: ${ctx.founderEmail}`);

  const geo = ctx.founderEnrichment?.geo;
  if (geo?.country) {
    founderLines.push(`Location: ${[geo.city, geo.region, geo.country].filter(Boolean).join(', ')}`);
  }
  const resolvedTimezone = ctx.browserTimezone ?? geo?.timezone ?? null;
  if (resolvedTimezone) founderLines.push(`Timezone: ${resolvedTimezone}`);
  if (ctx.browserLocale) founderLines.push(`Locale: ${ctx.browserLocale}`);

  const enrichConf = ctx.founderEnrichment?.confidence ?? 'low';
  founderLines.push(`Enrichment confidence: ${enrichConf}`);

  if (ctx.founderEnrichment?.linkedinSummary) {
    founderLines.push(`\nLinkedIn:\n${ctx.founderEnrichment.linkedinSummary}`);
  }
  if (ctx.founderEnrichment?.twitterBio) {
    founderLines.push(`\nTwitter:\n${ctx.founderEnrichment.twitterBio}`);
  }
  if (ctx.enrichedFounderSummary && !ctx.founderEnrichment?.linkedinSummary) {
    founderLines.push(`\nWeb research:\n${ctx.enrichedFounderSummary}`);
  }

  if (founderLines.length > 0) {
    sections.push(`## Founder Profile\n${founderLines.join('\n')}`);
  }

  if (ctx.enrichedBusinessSummary) {
    sections.push(`## Business Research\n${ctx.enrichedBusinessSummary}`);
  }

  const journeyLines = [`Journey: ${ctx.journey}`];
  if (ctx.input) journeyLines.push(`Input: ${ctx.input}`);
  sections.push(`## Journey Context\n${journeyLines.join('\n')}`);

  if (sections.length === 0) return;

  await upsertLayer1(ctx.companyId, sections.join('\n\n'));
}
