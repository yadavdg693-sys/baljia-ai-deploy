// TEMP: pre-Phase-3a mission generator.
// Replaced by 3-section structure (Mission / What we're building / Where we're headed) in Phase 3a.
// Keeps pipeline functional during Phase 0 refactor.

import { db, companies, documents } from '@/lib/db';
import { eq } from 'drizzle-orm';
import * as documentService from '@/lib/services/document.service';
import { callSmallLLM } from '../llm/small-llm';
import type { PipelineContext } from '../types';

export async function saveMission(ctx: PipelineContext): Promise<void> {
  const contextLines: string[] = [
    `Company name: ${ctx.companyName}`,
    `Journey: ${ctx.journey}`,
  ];
  if (ctx.input) contextLines.push(`Idea/Business: ${ctx.input}`);
  if (ctx.founderAngle) contextLines.push(`Founder positioning: ${ctx.founderAngle}`);
  if (ctx.marketResearch) contextLines.push(`Market context: ${ctx.marketResearch.slice(0, 400)}`);

  const prompt = `Write a company mission statement and one-liner for a startup.
The mission should reflect the founder's specific background and credibility — not generic.

Context:
${contextLines.join('\n')}

Respond in this exact format (2 lines, nothing else):
ONE_LINER: <compelling 10-15 word description of what the company does and for whom>
MISSION: <inspiring 1-2 sentence mission that references the founder's specific angle or domain expertise>`;

  const response = await callSmallLLM(prompt);

  const oneLinerMatch = response.match(/ONE_LINER:\s*(.+)/i);
  const missionMatch = response.match(/MISSION:\s*(.+)/i);

  const oneLiner = oneLinerMatch?.[1]?.trim();
  const mission = missionMatch?.[1]?.trim();

  if (!oneLiner || !mission) {
    throw new Error(`Mission generation failed: LLM response could not be parsed. Got: "${response.slice(0, 200)}"`);
  }

  ctx.oneLiner = oneLiner;
  ctx.mission = mission;

  await db.update(companies).set({ one_liner: ctx.oneLiner }).where(eq(companies.id, ctx.companyId));

  const docs = await documentService.getDocuments(ctx.companyId);
  const missionDoc = docs.find((d) => d.doc_type === 'mission');
  if (missionDoc) {
    await documentService.updateDocument(missionDoc.id, ctx.mission);
  } else {
    await db.insert(documents).values({
      company_id: ctx.companyId,
      doc_type: 'mission',
      title: 'Company Mission',
      content: ctx.mission,
      is_empty: false,
    });
  }

  // Market research persistence — moved from save_mission to market-research.ts in Phase 3a
  // For Phase 0 keep existing behavior (save here if set)
  if (ctx.marketResearch) {
    const mrDoc = docs.find((d) => d.doc_type === 'market_research');
    if (mrDoc) {
      await documentService.updateDocument(mrDoc.id, ctx.marketResearch);
    } else {
      await db.insert(documents).values({
        company_id: ctx.companyId,
        doc_type: 'market_research',
        title: 'Market & Competitor Research',
        content: ctx.marketResearch,
        is_empty: false,
      });
    }
  }
}
