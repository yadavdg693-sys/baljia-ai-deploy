// Mission document persistence.
//
// The active onboarding planning agents generate MissionDoc. This module only
// validates, renders, and saves that already-planned mission so there is no
// second mission prompt that can drift from the planning prompt.

import { db, companies, documents } from '@/lib/db';
import { eq } from 'drizzle-orm';
import * as documentService from '@/lib/services/document.service';
import { sanitizeForFounder } from '@/lib/founder-safety/sanitize';
import { MissionDocSchema } from './schemas';
import { compactLine, compactParagraphs, stripInlineMarkdown } from './founder-doc-style';
import { emitActivity, recordOnboardingIssue } from '../stage-runner';
import type { PipelineContext, MissionDoc } from '../types';

export async function persistMissionDoc(ctx: PipelineContext, result: MissionDoc): Promise<void> {
  const normalized = MissionDocSchema.parse(result) as MissionDoc;
  if (
    !result?.mission?.trim()
    || !result?.what_were_building?.trim()
    || !result?.where_were_headed?.trim()
  ) {
    await recordOnboardingIssue(ctx, {
      stage: 'save_mission',
      kind: 'mission_doc_schema_fallback',
      severity: 'medium',
      message: 'Mission document was missing one or more sections, so onboarding used schema-normalized fallback text.',
      fallbackUsed: true,
      metadata: { received: JSON.stringify(result ?? {}).slice(0, 500) },
    });
  }

  ctx.missionDoc = {
    one_liner: stripInlineMarkdown(compactLine(normalized.one_liner ?? '', 120, 1)),
    mission: stripInlineMarkdown(compactLine(normalized.mission, 220, 1)),
    what_were_building: stripInlineMarkdown(compactParagraphs(normalized.what_were_building, 1, 430, 2)),
    where_were_headed: stripInlineMarkdown(compactParagraphs(normalized.where_were_headed, 1, 620, 4)),
  };

  ctx.mission = ctx.missionDoc.mission;

  const llmOneLiner = ctx.missionDoc.one_liner ?? '';
  const missionFallback = ctx.missionDoc.mission ?? '';
  const buildingFallback = stripInlineMarkdown(
    (ctx.missionDoc.what_were_building ?? '').split(/[.!?]/)[0].trim(),
  );
  ctx.oneLiner = llmOneLiner || missionFallback || buildingFallback;

  await db.update(companies)
    .set({ one_liner: ctx.oneLiner })
    .where(eq(companies.id, ctx.companyId));

  const markdown = [
    `# ${ctx.companyName}`,
    '',
    '## Mission',
    '',
    ctx.missionDoc.mission,
    '',
    "## What we're building",
    '',
    ctx.missionDoc.what_were_building,
    '',
    "## Where we're headed",
    '',
    ctx.missionDoc.where_were_headed,
  ].join('\n');

  sanitizeForFounder(markdown, {
    mode: 'audit',
    context: { callsite: 'mission.persistMissionDoc', companyId: ctx.companyId },
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

  await emitActivity(ctx, `Mission saved - one-liner: "${ctx.oneLiner}"`, 'document');
}
