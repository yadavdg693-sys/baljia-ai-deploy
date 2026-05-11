// Shared utilities for market research persistence and markdown rendering.

import { db, documents } from '@/lib/db';
import * as documentService from '@/lib/services/document.service';
import { sanitizeForFounder } from '@/lib/founder-safety/sanitize';
import {
  compactLine,
  compactList,
  compactMarkdown,
  compactParagraphs,
  compactTableCell,
  stripInlineMarkdown,
} from './founder-doc-style';

// Helpers to clean LLM artifacts before the renderer outputs them.
//
// Market research is rendered as MARKDOWN (the dashboard's MarkdownBody
// turns `**bold**` into <strong> etc). So we preserve markdown structure
// (bold, italic, headings, bullets) and only strip em/en-dashes — the AI
// tell that always reads as machine-written prose.
const stripPlain = (s: string | undefined | null): string =>
  stripInlineMarkdown(s, { preserveMarkdown: true });
const stripStructured = (s: string | undefined | null): string =>
  stripInlineMarkdown(s, { keepLineStructure: true, preserveMarkdown: true });
import type {
  BuildMarketResearch,
  GrowMarketResearch,
  MarketResearchResult,
  PipelineContext,
  TaggedStat,
} from '../types';

function renderTaggedStat(t: TaggedStat): string {
  if (t.confidence === 'low') return `${t.stat} *(estimated - verify manually)*`;
  if (t.confidence === 'medium') return `${t.stat} *(inferred from related data)*`;
  return t.stat;
}

function renderPriority(item: string): string {
  // Detect the "lead — detail" / "lead: detail" structural pattern BEFORE
  // stripping em-dashes (otherwise the strip turns the em-dash into a comma
  // and the bold-lead formatting is lost). Then strip artifacts from each
  // part so the comma-replacement still catches em-dashes inside lead/detail.
  const cleaned = item.trim().replace(/\*\*/g, '');
  const match = cleaned.match(/^(.{2,80}?)(?:\s+[-–—]\s+|:\s+)(.+)$/);
  if (!match) return compactLine(stripPlain(cleaned), 190, 2);
  return `**${compactLine(stripPlain(match[1]), 72, 1)}** - ${compactLine(stripPlain(match[2]), 170, 2)}`;
}

function pushNumberedList(lines: string[], items: string[]): void {
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${renderPriority(item)}`);
  });
}

export async function persistMarketResearch(
  ctx: PipelineContext,
  jsonResult: MarketResearchResult,
  markdown: string,
): Promise<void> {
  ctx.marketResearchJson = jsonResult;
  ctx.marketResearch = markdown;

  sanitizeForFounder(markdown, {
    mode: 'audit',
    context: { callsite: 'persistMarketResearch', companyId: ctx.companyId },
  });

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
  lines.push('## Idea Overview');
  lines.push('');
  lines.push(compactParagraphs(stripPlain(data.overview), 2, 420, 2));
  lines.push('');
  lines.push('## Market Validation');
  lines.push('');
  // keepLineStructure preserves bullet markers so compactMarkdown can render
  // them as proper bullets, while inline ** / * / leftover "Lead. - " gets stripped.
  lines.push(compactMarkdown(stripStructured(data.market_validation), {
    maxBullets: 5,
    maxParagraphs: 2,
    maxLines: 8,
    maxCharsPerLine: 210,
  }));
  lines.push('');
  lines.push('## Competitive Landscape');
  lines.push('');
  lines.push('| Competitor | Focus | Entry Price | Weakness |');
  lines.push('|---|---|---|---|');
  for (const c of data.competitors) {
    lines.push(`| ${escapeCell(stripPlain(c.name), 80)} | ${escapeCell(stripPlain(c.what_they_do))} | ${escapeCell(stripPlain(c.pricing), 110)} | ${escapeCell(stripPlain(c.gap))} |`);
  }
  lines.push('');
  lines.push(`**The gap ${companyName} fills:** ${compactLine(stripPlain(data.opportunity), 320, 2)}`);
  lines.push('');
  lines.push('## Market Positioning');
  lines.push('');
  lines.push(compactMarkdown(stripStructured(data.market_positioning), {
    maxBullets: 5,
    maxParagraphs: 2,
    maxLines: 7,
    maxCharsPerLine: 210,
  }));
  lines.push('');
  lines.push('## Why This Fits You');
  lines.push('');
  lines.push(compactParagraphs(stripPlain(data.why_this_fits_you), 1, 420, 2));
  lines.push('');
  lines.push('## First Priorities');
  lines.push('');
  pushNumberedList(lines, data.first_priorities);
  return lines.join('\n');
}

export function renderGrowMarkdown(data: GrowMarketResearch, companyName: string): string {
  const lines: string[] = [];
  lines.push(`# Market Research Report: ${companyName}`);
  lines.push('');
  lines.push('## Business Overview');
  lines.push('');
  lines.push(compactParagraphs(stripPlain(data.business_overview), 3, 360, 2));
  lines.push('');
  lines.push(`**Revenue model:** ${compactLine(stripPlain(data.revenue_model), 280, 2)}`);
  if (data.notable_validation) {
    lines.push('');
    lines.push(`**Notable validation:** ${compactLine(stripPlain(data.notable_validation), 280, 2)}`);
  }
  lines.push('');
  lines.push('## Strategy Spine');
  lines.push('');
  lines.push(`**Business type:** ${compactLine(stripPlain(data.business_type), 140, 1)}`);
  lines.push('');
  lines.push(`**Main bottleneck:** ${compactLine(stripPlain(data.main_growth_bottleneck), 220, 1)}`);
  lines.push('');
  lines.push(`**Customer wedge:** ${compactLine(stripPlain(data.customer_wedge), 220, 1)}`);
  lines.push('');
  lines.push(`**Offer / packaging direction:** ${compactLine(stripPlain(data.offer_packaging_direction), 240, 1)}`);
  lines.push('');
  lines.push(`**Market tension:** ${compactLine(stripPlain(data.market_tension), 220, 1)}`);
  lines.push('');
  lines.push('## Market Analysis');
  lines.push('');
  lines.push(compactParagraphs(stripPlain(data.market_analysis.industry_landscape), 1, 420, 3));
  lines.push('');
  if (data.market_size && data.market_size.length > 0) {
    lines.push('**Market signals:**');
    for (const s of data.market_size.slice(0, 3)) lines.push(`- ${compactLine(stripPlain(renderTaggedStat(s)), 210, 1)}`);
    lines.push('');
  }
  lines.push('**Key trends shaping the market:**');
  for (const t of compactList(data.market_analysis.key_trends, 5, 190)) lines.push(`- ${stripPlain(t)}`);
  lines.push('');
  lines.push(`**Market timing:** ${compactLine(stripPlain(data.market_analysis.market_timing), 220, 1)}`);
  lines.push('');
  lines.push(`**Opportunity:** ${compactLine(stripPlain(data.growth_opportunity), 320, 2)}`);
  lines.push('');
  lines.push('## Competitive Landscape');
  lines.push('');
  lines.push('| Competitor | Focus | Strength / Positioning | Weakness / Gap |');
  lines.push('|---|---|---|---|');
  for (const c of data.competitors.slice(0, 5)) {
    lines.push(`| ${escapeCell(stripPlain(c.name), 80)} | ${escapeCell(stripPlain(c.focus_area))} | ${escapeCell(stripPlain(c.positioning_or_size))} | ${escapeCell(stripPlain(c.gap))} |`);
  }
  lines.push('');
  lines.push(`**${companyName}'s edge:** ${compactLine(stripPlain(data.business_edge), 260, 1)}`);
  lines.push('');
  lines.push(`**${companyName}'s gap:** ${compactLine(stripPlain(data.business_gap), 260, 1)}`);
  lines.push('');
  if (data.competitive_advantages.length > 0) {
    lines.push('**Competitive advantages:**');
    for (const a of compactList(data.competitive_advantages, 5, 190)) lines.push(`- ${stripPlain(a)}`);
    lines.push('');
  }
  if (data.gaps_to_exploit.length > 0) {
    lines.push('**Gaps to exploit:**');
    for (const g of compactList(data.gaps_to_exploit, 5, 190)) lines.push(`- ${stripPlain(g)}`);
    lines.push('');
  }
  if (data.threats.length > 0) {
    lines.push('**Threats:**');
    for (const t of compactList(data.threats, 3, 190)) lines.push(`- ${stripPlain(t)}`);
    lines.push('');
  }
  lines.push(`**What not to do yet:** ${compactLine(stripPlain(data.what_not_to_do_yet), 240, 1)}`);
  lines.push('');
  lines.push('## Why This Fits You');
  lines.push('');
  lines.push(compactParagraphs(stripPlain(data.why_this_fits_you), 1, 420, 2));
  lines.push('');
  lines.push('## AI Leverage Points');
  lines.push('');
  if (data.ai_leverage_points.length > 0) {
    pushNumberedList(lines, data.ai_leverage_points.slice(0, 3));
  } else {
    lines.push('1. No clear AI leverage point surfaced from the website or research.');
  }
  lines.push('');
  lines.push('## First Priorities');
  lines.push('');
  pushNumberedList(lines, data.first_priorities);
  return lines.join('\n');
}

function escapeCell(value: string | undefined, maxChars = 130): string {
  if (!value) return '';
  return compactTableCell(value, maxChars).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
