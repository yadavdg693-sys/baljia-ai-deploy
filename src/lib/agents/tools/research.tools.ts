// Research Agent Tools — Tavily web search (Agent #29)
// Baljia improvement: Read-only public web; require citations or "insufficient evidence"

import type { Task } from '@/types';

// ══════════════════════════════════════════════
// TAVILY SEARCH — read-only public web
// Requires TAVILY_API_KEY environment variable
// ══════════════════════════════════════════════

const TAVILY_API_URL = 'https://api.tavily.com/search';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results: TavilyResult[];
  answer?: string;
  query: string;
}

async function tavilySearch(query: string, maxResults = 5): Promise<TavilyResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY not configured');
  }

  const response = await fetch(TAVILY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: 'basic',
      include_answer: true,
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<TavilyResponse>;
}

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
  const hasTavily = !!process.env.TAVILY_API_KEY;

  switch (toolName) {
    case 'web_search': {
      if (!hasTavily) {
        return 'Web search unavailable: TAVILY_API_KEY not configured. Proceeding with model knowledge only. State "based on model knowledge" in your analysis.';
      }

      try {
        const maxResults = Math.min(Math.max((input.max_results as number) ?? 5, 1), 10);
        const results = await tavilySearch(input.query as string, maxResults);

        let output = '';
        if (results.answer) {
          output += `**Summary:** ${results.answer}\n\n`;
        }

        output += `**Sources (${results.results.length} results):**\n`;
        for (const r of results.results) {
          output += `- [${r.title}](${r.url}) (relevance: ${(r.score * 100).toFixed(0)}%)\n`;
          output += `  ${r.content.substring(0, 200)}${r.content.length > 200 ? '...' : ''}\n\n`;
        }

        return output;
      } catch (error) {
        return `Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}. Fall back to model knowledge and state "insufficient evidence" where applicable.`;
      }
    }

    case 'web_extract': {
      if (!hasTavily) {
        return 'Content extraction unavailable: TAVILY_API_KEY not configured.';
      }

      try {
        // Use Tavily extract endpoint
        const response = await fetch('https://api.tavily.com/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            urls: [input.url as string],
          }),
        });

        if (!response.ok) throw new Error(`Extract failed: ${response.status}`);
        const data = await response.json() as { results: Array<{ raw_content: string }> };
        const content = data.results?.[0]?.raw_content ?? 'No content extracted';
        return content.substring(0, 3000); // Cap at 3k chars to save context
      } catch (error) {
        return `Failed to extract from ${input.url}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    case 'competitor_analysis': {
      const company = input.company_name as string;
      const aspects = (input.aspects as string) ?? 'pricing,features,reviews';

      if (!hasTavily) {
        return `Competitor analysis for "${company}" (aspects: ${aspects}). Note: No live web search available. Analysis based on model knowledge only. State "based on model knowledge" in findings.`;
      }

      try {
        const queries = aspects.split(',').map((a) => `${company} ${a.trim()}`);
        const results: string[] = [];

        for (const query of queries.slice(0, 3)) { // Max 3 aspect searches
          const searchResult = await tavilySearch(query, 3);
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

      if (!hasTavily) {
        return `Industry trends for "${industry}" (${timeframe}). Note: No live web search available. Analysis based on model knowledge.`;
      }

      try {
        const result = await tavilySearch(`${industry} trends ${timeframe} 2025 2026`, 5);
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
