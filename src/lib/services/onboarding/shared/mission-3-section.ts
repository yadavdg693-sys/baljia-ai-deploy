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
    ? `Founder location: ${city}, ${country}. MANDATORY: In "where_were_headed" use this specific city/country verbatim when naming places (e.g. "a two-person startup in ${city}" or "a founder in ${country}"). Do NOT guess other countries. Do NOT use placeholder phrases like "your city".`
    : country
      ? `Founder location country: ${country}. Use this country verbatim in "where_were_headed" when naming places.`
      : `Founder location is unknown. In "where_were_headed", skip place-specific naming — do NOT invent a city or country. Use generic phrases like "every founder", "every growing team" instead.`;

  const marketContext = ctx.marketResearch ?? '';

  const prompt = `You are writing the mission document for ${ctx.companyName}. This replaces the founder's 1-line mission with a 3-section narrative matching Polsia's format.

Journey: ${ctx.journey}
Framing: ${framing}

Idea / Business:
${ideaText}

${ctx.founderAngle ? `Founder positioning: ${ctx.founderAngle}\n` : ''}${regionLine}

${marketContext ? `Market context (full research report):\n${marketContext.slice(0, 3000)}\n` : ''}

Write a JSON object with these three sections:
{
  "mission": "<1 sentence. Aspirational. Two valid patterns: 'Make X [property] for [audience]' (positive) OR 'No [audience] should [bad thing]' (negative). No filler. No platitudes.>",
  "what_were_building": "<2-3 sentences. Concrete product description. What it does. Who it's for. No vision-language — pure product.>",
  "where_were_headed": "<4-6 sentences. Vivid future-state narrative. Name specific people (teacher, two-person startup, growing team). ${city ? `Name "${city}" or "${country}" where place matters.` : 'Avoid place names since GeoIP is missing.'} End with a category-defining reframe (e.g. 'X becomes the default answer to <question>', 'Y becomes a solved problem', 'Z makes <industry> accessible to anyone').>"
}

Rules:
- Mission: 1 sentence ONLY. No periods except at the end.
- What we're building: 2-3 sentences. Concrete nouns and verbs. Avoid 'leverage', 'synergize', 'empower'.
- Where we're headed: 4-6 sentences, anchored in ${country ?? 'founder region (if known, else generic)'}.
- No corporate jargon. No 'world-class', 'best-in-class', 'cutting-edge'.
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
