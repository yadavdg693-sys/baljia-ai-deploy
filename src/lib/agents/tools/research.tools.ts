// Research Agent Tools — Tavily web search (Agent #29)
// Baljia improvement: Read-only public web; require citations or "insufficient evidence"
// Uses shared @/lib/tavily with round-robin key rotation.

import type { Task } from '@/types';
import { isTavilyAvailable, tavilySearch, getNextTavilyKey } from '@/lib/tavily';

// ══════════════════════════════════════════════
// RESEARCH TOOLS — web search + source verification
// ══════════════════════════════════════════════

export function getResearchTools() {
  return [
    {
      name: 'web_search',
      description: 'Search the public web for information. Returns top results with titles, URLs, and content snippets. Always cite the source URL when using this data.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string' as const, description: 'Search query' },
          max_results: { type: 'number' as const, description: 'Max results to return (1-10, default 5)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'web_extract',
      description: 'Extract the main content from a specific URL. Use this for deeper reading of a page found via web_search.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string' as const, description: 'URL to extract content from' },
        },
        required: ['url'],
      },
    },
    {
      name: 'competitor_analysis',
      description: 'Search for information about a specific competitor. Returns company info, features, pricing, and reviews.',
      input_schema: {
        type: 'object' as const,
        properties: {
          company_name: { type: 'string' as const, description: 'Name of the competitor company' },
          aspects: { type: 'string' as const, description: 'What to analyze: pricing, features, reviews, funding, team (comma-separated)' },
        },
        required: ['company_name'],
      },
    },
    {
      name: 'industry_trends',
      description: 'Search for recent trends and news in an industry or market segment.',
      input_schema: {
        type: 'object' as const,
        properties: {
          industry: { type: 'string' as const, description: 'Industry or market (e.g., "AI SaaS", "e-commerce")' },
          timeframe: { type: 'string' as const, description: 'Time period: "week", "month", "quarter" (default: month)' },
        },
        required: ['industry'],
      },
    },
  ];
}

// ══════════════════════════════════════════════
// RESEARCH TOOL HANDLER
// ══════════════════════════════════════════════

export async function handleResearchTool(
  toolName: string,
  input: Record<string, unknown>,
  _task: Task,
): Promise<string> {
  switch (toolName) {
    case 'web_search': {
      if (!isTavilyAvailable()) {
        return 'Web search unavailable: no Tavily API keys configured. Proceeding with model knowledge only. State "based on model knowledge" in your analysis.';
      }

      try {
        const maxResults = Math.min(Math.max((input.max_results as number) ?? 5, 1), 10);
        const results = await tavilySearch({
          query: input.query as string,
          maxResults,
          searchDepth: 'advanced',
        });

        let output = '';
        if (results.answer) {
          output += `**Summary:** ${results.answer}\n\n`;
        }

        output += `**Sources (${results.results.length} results):**\n`;
        for (const r of results.results) {
          output += `- [${r.title}](${r.url}) (relevance: ${((r.score ?? 0) * 100).toFixed(0)}%)\n`;
          output += `  ${r.content.substring(0, 200)}${r.content.length > 200 ? '...' : ''}\n\n`;
        }

        return output;
      } catch (error) {
        return `Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}. Fall back to model knowledge and state "insufficient evidence" where applicable.`;
      }
    }

    case 'web_extract': {
      if (!isTavilyAvailable()) {
        return 'Content extraction unavailable: no Tavily API keys configured.';
      }

      try {
        const key = getNextTavilyKey();
        const response = await fetch('https://api.tavily.com/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: key,
            urls: [input.url as string],
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) throw new Error(`Extract failed: ${response.status}`);
        const data = await response.json() as { results: Array<{ raw_content: string }> };
        const content = data.results?.[0]?.raw_content ?? 'No content extracted';
        return content.substring(0, 3000);
      } catch (error) {
        return `Failed to extract from ${input.url}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    case 'competitor_analysis': {
      const company = input.company_name as string;
      const aspects = (input.aspects as string) ?? 'pricing,features,reviews';

      if (!isTavilyAvailable()) {
        return `Competitor analysis for "${company}" (aspects: ${aspects}). Note: No live web search available. Analysis based on model knowledge only.`;
      }

      try {
        const queries = aspects.split(',').map((a) => `${company} ${a.trim()}`);
        const results: string[] = [];

        for (const query of queries.slice(0, 3)) {
          const searchResult = await tavilySearch({
            query,
            maxResults: 3,
            searchDepth: 'advanced',
          });
          if (searchResult.answer) {
            results.push(`### ${query}\n${searchResult.answer}`);
          }
          for (const r of searchResult.results.slice(0, 2)) {
            results.push(`- [${r.title}](${r.url}): ${r.content.substring(0, 150)}`);
          }
        }

        return results.join('\n\n') || `No results found for "${company}"`;
      } catch (error) {
        return `Competitor analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    case 'industry_trends': {
      const industry = input.industry as string;
      const timeframe = (input.timeframe as string) ?? 'month';

      if (!isTavilyAvailable()) {
        return `Industry trends for "${industry}" (${timeframe}). Note: No live web search available. Analysis based on model knowledge.`;
      }

      try {
        const result = await tavilySearch({
          query: `${industry} trends ${timeframe} 2025 2026`,
          maxResults: 5,
          searchDepth: 'advanced',
        });
        let output = result.answer ? `**Summary:** ${result.answer}\n\n` : '';
        output += result.results
          .map((r) => `- [${r.title}](${r.url})\n  ${r.content.substring(0, 200)}`)
          .join('\n\n');
        return output;
      } catch (error) {
        return `Trend search failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    default:
      return `Unknown research tool: ${toolName}`;
  }
}
