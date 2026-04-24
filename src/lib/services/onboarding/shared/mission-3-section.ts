// Mission generator — 3-section Polsia structure
// Mission / What we're building / Where we're headed (with GeoIP-anchored narrative)
// Replaces the TEMP 1-line mission in Phase 3a.
// See memory/project_mission_format_locked.md

import { db, companies, documents } from '@/lib/db';
import { eq } from 'drizzle-orm';
import * as documentService from '@/lib/services/document.service';
import { sanitizeForFounder } from '@/lib/founder-safety/sanitize';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import type { PipelineContext, MissionDoc } from '../types';

export async function saveMission3Section(ctx: PipelineContext): Promise<void> {
  const ideaText =
    ctx.refinedIdea?.refined_idea
    ?? ctx.inventedIdea?.invented_idea
    ?? ctx.businessProfile?.description
    ?? ctx.strategy
    ?? ctx.input
    ?? '';

  const geo = ctx.founderEnrichment?.geo;
  const city = geo?.city ?? null;
  const country = geo?.country ?? null;

  const isGrow = ctx.journey === 'grow_my_company';
  const framing = isGrow
    ? 'REFINE existing identity. The founder already runs this business. Articulate the mission that sharpens what they ALREADY do — do not reinvent them.'
    : 'ARTICULATE a future that does not exist yet. The founder is building new — speak to what the world becomes once this ships.';

  const regionLine = (city && country)
    ? `Founder location: ${city}, ${country}. MANDATORY: In "where_were_headed" use this specific city/country verbatim when naming places — pair the product's actual audience with "${city}" or "${country}". Do NOT guess other countries. Do NOT use placeholder phrases like "your city".`
    : country
      ? `Founder location country: ${country}. Use this country verbatim in "where_were_headed" when naming places.`
      : `Founder location is unknown. In "where_were_headed", skip place-specific naming — do NOT invent a city or country. Refer to the audience generically (derived from the idea) rather than any geography.`;

  const marketContext = ctx.marketResearch ?? '';
  const mrJson = ctx.marketResearchJson;

  // Structured research handoff — give the LLM named fields (target audience
  // hints, data_gaps, competitor names) instead of making it re-parse the
  // rendered markdown. Keeps the rendered markdown available for narrative
  // texture, but the grounding data is now explicit.
  const structuredResearchBlock = mrJson
    ? `STRUCTURED MARKET RESEARCH (use these fields to ground the mission):
${JSON.stringify({
  competitors: (mrJson as unknown as { competitors?: Array<{ name: string }> }).competitors?.map((c) => c.name) ?? [],
  data_gaps: (mrJson as unknown as { data_gaps?: string[] }).data_gaps ?? [],
  has_strong_demand_signals: ((mrJson as unknown as { demand_signals?: string[]; market_validation?: { demand_signals?: string[] } }).demand_signals?.length
    ?? (mrJson as unknown as { market_validation?: { demand_signals?: string[] } }).market_validation?.demand_signals?.length
    ?? 0) > 0,
}, null, 2)}`
    : '(No structured research available.)';

  const hasDataGaps = mrJson
    && ((mrJson as unknown as { data_gaps?: string[] }).data_gaps?.length ?? 0) > 0;
  const confidenceGuidance = hasDataGaps
    ? `CONFIDENCE NOTE: the market research has data_gaps (see structured block above). Keep the mission GROUNDED in what's verifiable — do not overreach claims about market size, category redefinition, or transformational impact when the underlying data is thin. A humble mission with honest specifics beats a grandiose one built on air.`
    : '';

  const prompt = `You are writing the mission document for ${ctx.companyName}. This replaces the founder's 1-line mission with a 3-section narrative.

Journey: ${ctx.journey}
Framing: ${framing}

Idea / Business:
${ideaText}

${ctx.founderAngle ? `Founder positioning: ${ctx.founderAngle}\n` : ''}${regionLine}

${structuredResearchBlock}

${marketContext ? `Market research report (full rendered narrative for texture):\n${marketContext.slice(0, 2500)}\n` : ''}

${confidenceGuidance}

Write a JSON object with these three sections:
{
  "mission": "<1 sentence. Aspirational. Two valid patterns: 'Make X [property] for [audience]' (positive) OR 'No [audience] should [bad thing]' (negative). No filler. No platitudes.>",
  "what_were_building": "<2-3 sentences. Concrete product description that ADDS SPECIFICS to the mission — features, mechanism, scale, concrete user action. Must NOT paraphrase the mission sentence. If the mission says 'Make outlining effortless for indie authors', this section describes how (topic input → AI generates structured chapter outline in X minutes), not what (which is already covered by the mission). No vision-language — pure product mechanics.>",
  "where_were_headed": "<4-6 sentences. Vivid future-state narrative. Name specific people from THIS product's actual audience — derive the roles and situations from the idea and market research, do not default to generic personas. ${city ? `Name "${city}" or "${country}" where place matters.` : 'Avoid place names since GeoIP is missing.'} End with EITHER (a) a category-defining reframe that makes the founder's work feel inevitable, OR (b) a concrete promise to one specific person ('you can write your next book without dreading the blank page'). Pick whichever fits the idea's scale — do NOT force grandiose 'becomes the default answer' language on modest products.>"
}

Rules:
- Mission: 1 sentence ONLY. No periods except at the end.
- What we're building MUST NOT restate the mission. It adds product mechanism/specifics that the mission sentence didn't cover.
- Concrete nouns and verbs. Avoid 'leverage', 'synergize', 'empower', 'revolutionize', 'transform'.
- No corporate jargon: no 'world-class', 'best-in-class', 'cutting-edge', 'next-generation'.
- End of "where_were_headed" should match the idea's scale. Modest products get modest endings. A calendar tool doesn't "reshape how professional time operates" — it "lets you stop double-booking clients on Fridays."
- Total length ~200 words.`;

  await emitActivity(ctx, 'Writing mission (3-section: Mission / What we\'re building / Where we\'re headed)', 'llm');

  const result = await callSmallLLMJson<MissionDoc>(prompt, {
    maxTokens: 900,
    retryOnce: true,
    sanitizeFields: ['mission', 'what_were_building', 'where_were_headed'],
  });

  if (!result.mission?.trim() || !result.what_were_building?.trim() || !result.where_were_headed?.trim()) {
    throw new Error(`Mission generation failed: missing required sections. Got: ${JSON.stringify(result).slice(0, 200)}`);
  }

  ctx.missionDoc = {
    mission: result.mission.trim(),
    what_were_building: result.what_were_building.trim(),
    where_were_headed: result.where_were_headed.trim(),
  };

  // Back-compat fields for stages that still read ctx.mission + ctx.oneLiner
  ctx.mission = ctx.missionDoc.mission;

  // Derive one_liner from "What we're building" first sentence (10-15 word range).
  const firstSentence = ctx.missionDoc.what_were_building.split(/[.!?]/)[0].trim();
  const words = firstSentence.split(/\s+/);
  ctx.oneLiner = words.slice(0, Math.min(words.length, 18)).join(' ');

  await db.update(companies)
    .set({ one_liner: ctx.oneLiner })
    .where(eq(companies.id, ctx.companyId));

  // Render 3-section markdown
  const markdown = [
    `# ${ctx.companyName}`,
    '',
    '## Mission',
    '',
    ctx.missionDoc.mission,
    '',
    '## What we\'re building',
    '',
    ctx.missionDoc.what_were_building,
    '',
    '## Where we\'re headed',
    '',
    ctx.missionDoc.where_were_headed,
  ].join('\n');

  // Founder-safety: mission may legitimately reference the space the
  // founder operates in (including vendor names in competitor phrasing).
  // Audit mode logs infra-phrase violations without mangling the copy.
  sanitizeForFounder(markdown, {
    mode: 'audit',
    context: { callsite: 'mission.saveMission3Section', companyId: ctx.companyId },
  });

  const docs = await documentService.getDocuments(ctx.companyId);
  const missionDoc = docs.find((d) => d.doc_type === 'mission');
  if (missionDoc) {
    await documentService.updateDocument(missionDoc.id, markdown);
  } else {
    await db.insert(documents).values({
      company_id: ctx.companyId,
      doc_type: 'mission',
      title: 'Company Mission',
      content: markdown,
      is_empty: false,
    });
  }

  await emitActivity(ctx, `Mission saved — one-liner: "${ctx.oneLiner}"`, 'document');
}
