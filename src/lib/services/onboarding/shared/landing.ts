// Landing page generator — narrative-first HTML stored as document

import { db, documents } from '@/lib/db';
import { createLogger } from '@/lib/logger';
import * as documentService from '@/lib/services/document.service';
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
2. Category tag (e.g. "AI-Powered Analytics")
3. Hard-hitting headline (one sentence)
4. Short explanatory paragraph (2-3 sentences)
5. Problem framing section
6. 3 feature/capability blocks
7. "How it works" in 3 steps
8. Closing manifesto paragraph
9. Footer with "Built and operated by Baljia" attribution

Style: dark background (#0a0a0a), clean sans-serif, gold accent (#F5A623), mobile-responsive.
Use inline CSS only. No external dependencies. Full valid HTML document.
Keep it under 300 lines.`;

  try {
    const html = await callSmallLLM(prompt, 4000);
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
  } catch (err) {
    log.warn('Landing page generation failed — non-blocking', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
