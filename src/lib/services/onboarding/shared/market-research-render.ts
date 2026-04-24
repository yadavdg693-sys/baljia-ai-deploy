// Shared utilities for market research: Tavily search + persistence + markdown rendering

import { db, documents } from '@/lib/db';
import * as documentService from '@/lib/services/document.service';
import { sanitizeForFounder } from '@/lib/founder-safety/sanitize';
import type {
  BuildMarketResearch,
  GrowMarketResearch,
  SurpriseMarketResearch,
  MarketResearchResult,
  PipelineContext,
  TaggedStat,
} from '../types';

/** Render a confidence-tagged stat. High-confidence items render clean;
 *  medium/low tag visibly so founders know when to take things with a grain
 *  of salt. Keeps the tag OUT of sanitizer-scanned prose — it's a narrow
 *  rendering concern, not founder-facing copywriting. */
function renderTaggedStat(t: TaggedStat): string {
  if (t.confidence === 'low') return `${t.stat} *(estimated — verify manually)*`;
  if (t.confidence === 'medium') return `${t.stat} *(inferred from related data)*`;
  return t.stat;
}

function renderDataGapsSection(gaps: string[] | undefined): string[] {
  if (!gaps || gaps.length === 0) return [];
  const out: string[] = [];
  out.push('');
  out.push('## Data Gaps');
  out.push('');
  out.push('*Items the search data did not cover — flag these for manual follow-up.*');
  out.push('');
  for (const g of gaps) out.push(`- ${g}`);
  return out;
}

export async function persistMarketResearch(
  ctx: PipelineContext,
  jsonResult: MarketResearchResult,
  markdown: string,
): Promise<void> {
  ctx.marketResearchJson = jsonResult;
  ctx.marketResearch = markdown;

  // Founder-safety: market research legitimately names competitors like
  // Cloudflare/Neon/Postgres — audit mode logs infra-phrase violations
  // without mutating the markdown. If a real leak shows up, we investigate
  // at the source (the JSON-mode screen should have caught it upstream).
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
  lines.push('## Market Overview');
  lines.push('');
  lines.push(data.overview);
  lines.push('');
  if (data.market_size && data.market_size.length > 0) {
    lines.push('### Key Market Stats');
    lines.push('');
    for (const s of data.market_size) lines.push(`- ${renderTaggedStat(s)}`);
    lines.push('');
  }
  lines.push('## Competitive Landscape');
  lines.push('');
  lines.push('| Competitor | What They Do | Pricing | Gap |');
  lines.push('|---|---|---|---|');
  for (const c of data.competitors) {
    lines.push(`| ${escapeCell(c.name)} | ${escapeCell(c.what_they_do)} | ${escapeCell(c.pricing)} | ${escapeCell(c.gap)} |`);
  }
  lines.push('');
  if (data.demand_signals && data.demand_signals.length > 0) {
    lines.push('## Demand Signals');
    lines.push('');
    for (const d of data.demand_signals) lines.push(`- ${d}`);
    lines.push('');
  }
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
  lines.push(...renderDataGapsSection(data.data_gaps));
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
  if (data.market_size && data.market_size.length > 0) {
    lines.push('### Key Market Stats');
    lines.push('');
    for (const s of data.market_size) lines.push(`- ${renderTaggedStat(s)}`);
    lines.push('');
  }
  if (data.retention_check && data.retention_check.signal !== 'unknown') {
    const label = data.retention_check.signal === 'warning' ? '⚠ Warning' : '✓ Healthy';
    lines.push(`## Retention Check — ${label}`);
    lines.push('');
    lines.push(data.retention_check.rationale);
    lines.push('');
    lines.push(`**Recommendation:** ${data.retention_check.priority.replace(/_/g, ' ')}`);
    lines.push('');
  }
  if (data.funnel_diagnosis) {
    lines.push('## Funnel Diagnosis');
    lines.push('');
    lines.push(`**Likely bottleneck:** ${data.funnel_diagnosis.likely_bottleneck}`);
    lines.push('');
    lines.push(data.funnel_diagnosis.rationale);
    lines.push('');
  }
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
  lines.push(...renderDataGapsSection(data.data_gaps));
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
  if (data.market_validation.size_and_growth.length > 0) {
    lines.push('*Size and growth:*');
    for (const s of data.market_validation.size_and_growth) lines.push(`- ${renderTaggedStat(s)}`);
    lines.push('');
  }
  if (data.market_validation.why_now.length > 0) {
    lines.push('*Why now:*');
    for (const w of data.market_validation.why_now) lines.push(`- ${w}`);
    lines.push('');
  }
  if (data.market_validation.demand_signals && data.market_validation.demand_signals.length > 0) {
    lines.push('*Demand signals:*');
    for (const d of data.market_validation.demand_signals) lines.push(`- ${d}`);
    lines.push('');
  }
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
  lines.push(...renderDataGapsSection(data.data_gaps));
  return lines.join('\n');
}

function escapeCell(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
