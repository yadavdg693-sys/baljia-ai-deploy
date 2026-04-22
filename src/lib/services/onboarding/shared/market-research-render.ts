// Shared utilities for market research: Tavily search + persistence + markdown rendering

import { db, documents } from '@/lib/db';
import * as documentService from '@/lib/services/document.service';
import type {
  BuildMarketResearch,
  GrowMarketResearch,
  SurpriseMarketResearch,
  MarketResearchResult,
  PipelineContext,
} from '../types';

export async function persistMarketResearch(
  ctx: PipelineContext,
  jsonResult: MarketResearchResult,
  markdown: string,
): Promise<void> {
  ctx.marketResearchJson = jsonResult;
  ctx.marketResearch = markdown;

  const docs = await documentService.getDocuments(ctx.companyId);
  const mrDoc = docs.find((d) => d.doc_type === 'market_research');
  if (mrDoc) {
    await documentService.updateDocument(mrDoc.id, markdown);
  } else {
    await db.insert(documents).values({
      company_id: ctx.companyId,
      doc_type: 'market_research',
      title: 'Market Research Report',
      content: markdown,
      is_empty: false,
    });
  }
}

export function renderBuildMarkdown(data: BuildMarketResearch, companyName: string): string {
  const lines: string[] = [];
  lines.push(`# Market Research Report: ${companyName}`);
  lines.push('');
  lines.push('## Market Overview');
  lines.push('');
  lines.push(data.overview);
  lines.push('');
  lines.push('## Competitive Landscape');
  lines.push('');
  lines.push('| Competitor | What They Do | Pricing | Gap |');
  lines.push('|---|---|---|---|');
  for (const c of data.competitors) {
    lines.push(`| ${escapeCell(c.name)} | ${escapeCell(c.what_they_do)} | ${escapeCell(c.pricing)} | ${escapeCell(c.gap)} |`);
  }
  lines.push('');
  lines.push('## The Opportunity');
  lines.push('');
  lines.push(data.opportunity);
  lines.push('');
  lines.push('## Why This Fits You');
  lines.push('');
  lines.push(data.why_this_fits_you);
  lines.push('');
  lines.push('## First Priorities');
  lines.push('');
  data.first_priorities.forEach((p, i) => {
    lines.push(`${i + 1}. **${p.title}** — ${p.rationale}`);
  });
  return lines.join('\n');
}

export function renderGrowMarkdown(data: GrowMarketResearch, companyName: string): string {
  const lines: string[] = [];
  lines.push(`# Market Research Report: ${companyName}`);
  lines.push('');
  lines.push('## Business Overview');
  lines.push('');
  lines.push(data.business_overview);
  lines.push('');
  lines.push(`**Revenue model:** ${data.revenue_model}`);
  if (data.notable_validation) {
    lines.push('');
    lines.push(`**Notable validation:** ${data.notable_validation}`);
  }
  lines.push('');
  lines.push('## Market Analysis');
  lines.push('');
  lines.push(`*Industry Landscape:* ${data.market_analysis.industry_landscape}`);
  lines.push('');
  lines.push('*Key Trends:*');
  for (const t of data.market_analysis.key_trends) lines.push(`- ${t}`);
  lines.push('');
  lines.push(`*Market Timing:* ${data.market_analysis.market_timing}`);
  lines.push('');
  lines.push('## Competitive Landscape');
  lines.push('');
  lines.push('| Competitor | Focus | Positioning / Size | Gap |');
  lines.push('|---|---|---|---|');
  for (const c of data.competitors) {
    lines.push(`| ${escapeCell(c.name)} | ${escapeCell(c.focus_area)} | ${escapeCell(c.positioning_or_size)} | ${escapeCell(c.gap)} |`);
  }
  lines.push('');
  lines.push('## Competitive Advantages');
  lines.push('');
  for (const a of data.competitive_advantages) lines.push(`- ${a}`);
  lines.push('');
  lines.push('## Gaps to Exploit');
  lines.push('');
  for (const g of data.gaps_to_exploit) lines.push(`- ${g}`);
  lines.push('');
  lines.push('## Why This Fits You');
  lines.push('');
  lines.push(data.why_this_fits_you);
  lines.push('');
  lines.push('## AI Leverage Points');
  lines.push('');
  for (const p of data.ai_leverage_points) lines.push(`- ${p}`);
  lines.push('');
  lines.push('## First Priorities');
  lines.push('');
  data.first_priorities.forEach((p, i) => {
    lines.push(`${i + 1}. **${p.title}** — ${p.rationale}`);
  });
  return lines.join('\n');
}

export function renderSurpriseMarkdown(data: SurpriseMarketResearch, companyName: string): string {
  const lines: string[] = [];
  lines.push(`# Market Research Report: ${companyName}`);
  lines.push('');
  lines.push('## Idea Overview');
  lines.push('');
  lines.push(data.idea_overview);
  lines.push('');
  lines.push('## Market Validation');
  lines.push('');
  lines.push('*Size and growth:*');
  for (const s of data.market_validation.size_and_growth) lines.push(`- ${s}`);
  lines.push('');
  lines.push('*Why now:*');
  for (const w of data.market_validation.why_now) lines.push(`- ${w}`);
  lines.push('');
  lines.push('## Competitive Landscape');
  lines.push('');
  lines.push('| Competitor | What They Do | Pricing | Gap |');
  lines.push('|---|---|---|---|');
  for (const c of data.competitors) {
    lines.push(`| ${escapeCell(c.name)} | ${escapeCell(c.what_they_do)} | ${escapeCell(c.pricing)} | ${escapeCell(c.gap)} |`);
  }
  lines.push('');
  lines.push('## Why This Fits You');
  lines.push('');
  lines.push(data.why_this_fits_you);
  lines.push('');
  lines.push('## Idea Refinements');
  lines.push('');
  data.idea_refinements.forEach((r, i) => {
    lines.push(`${i + 1}. **${r.title}** — ${r.rationale}`);
  });
  lines.push('');
  lines.push('## First Priorities');
  lines.push('');
  data.first_priorities.forEach((p, i) => {
    lines.push(`${i + 1}. **${p.title}** — ${p.rationale}`);
  });
  return lines.join('\n');
}

function escapeCell(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
