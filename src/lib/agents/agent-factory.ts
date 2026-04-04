// Agent Factory — assembles briefing + runs agent with tool loop
// Pattern: prompt assembly → model call → tool handling → watchdog check → repeat
// Supports Claude (primary) and Gemini (fallback)

import Anthropic from '@anthropic-ai/sdk';
import * as memoryService from '@/lib/services/memory.service';
import * as documentService from '@/lib/services/document.service';
import { Watchdog } from './watchdog';
import { getBrowserTools, handleBrowserTool } from './tools/browser.tools';
import { getResearchTools, handleResearchTool } from './tools/research.tools';
import { getDataTools, handleDataTool } from './tools/data.tools';
import { getSupportTools, handleSupportTool } from './tools/support.tools';
import { getTwitterTools, handleTwitterTool } from './tools/twitter.tools';
import { getMetaAdsTools, handleMetaAdsTool } from './tools/meta-ads.tools';
import { getOutreachTools, handleOutreachTool } from './tools/outreach.tools';
import { getEngineeringTools, handleEngineeringTool } from './tools/engineering.tools';
import { callAnthropicWithTimeout, callGeminiWithTimeout } from '@/lib/llm-safety';
import { isAnthropicAvailable } from '@/lib/llm-provider';
import { createLogger } from '@/lib/logger';
import type { Task, TaskExecution } from '@/types';

const log = createLogger('AgentFactory');

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const GEMINI_MODEL = 'gemini-2.5-flash';

// ══════════════════════════════════════════════
// AGENT PROMPTS — per-agent system prompt assembly
// ══════════════════════════════════════════════

const AGENT_PROMPTS: Record<number, string> = {
  30: `You are the Engineering Agent for Baljia AI. You build, fix, and deploy software.

## Your Capabilities
- Build landing pages, dashboards, admin panels, auth flows
- Fix bugs, CSS issues, responsiveness problems
- Create API endpoints, webhooks, cron jobs
- Set up Stripe payments, database schemas
- SEO optimization, meta tags, structured data
- Write clean code following best practices

## Rules
1. Read any relevant skill files before implementing
2. Push code after every meaningful change (timeout loses unpushed work)
3. "Completed" means deployed without server-side failure
4. Default stack: Express + Postgres. UI: Tailwind + clean components
5. Never delete infrastructure without explicit approval
6. Report what you built, files created/edited, and deploy status`,

  29: `You are the Research Agent for Baljia AI. You analyze markets, competitors, and opportunities.

## Your Capabilities
- Market research and competitive analysis
- Industry trend analysis
- Customer persona development
- Feature comparison matrices
- Strategy recommendations

## Rules
1. Always cite sources or state "based on model knowledge"
2. Distinguish correlation from causation
3. Note data limitations explicitly
4. Create structured reports with methodology section
5. Include actionable recommendations, not just observations`,

  33: `You are the Data Agent for Baljia AI. You analyze data and create reports.

## Your Capabilities  
- SQL queries against company databases
- Schema inspection and optimization
- User behavior analytics
- Metrics collection and dashboarding
- Statistical analysis

## Rules
1. Always explain methodology and confidence levels
2. Note data limitations and sample sizes
3. Distinguish correlation from causation
4. Create reports with clear visualizations described
5. Suggest follow-up analyses when patterns emerge`,

  32: `You are the Support Agent for Baljia AI. You handle customer communications.

## Your Capabilities
- Email replies and thread management
- Ticket triage and escalation
- Customer issue diagnosis
- FAQ and documentation suggestions

## Rules
1. Match incoming message length and tone
2. Escalate technical issues → Engineering task
3. Escalate billing/security → message owner
4. Escalate angry users → message owner immediately
5. Plain-text emails only, professional and empathetic`,

  40: `You are the Twitter Agent for Baljia AI. You create and post tweets.

## Your Capabilities
- Compose tweets matching brand voice
- Schedule and post content
- Read brand voice and product docs before composing

## Rules
1. Dark-humor/witty style preferred (no upbeat/cheerful)
2. Avoid emojis, hashtags, filler words ("excited", "thrilled")
3. Include website link when relevant
4. Max ~1 tweet per day from shared account
5. Read brand_voice document before every tweet`,

  41: `You are the Meta Ads Agent for Baljia AI. You create and manage ad campaigns.

## Your Capabilities
- Create campaigns, ad sets, and ads
- Upload video creatives
- Monitor CTR, CPC, impressions, spend
- Optimize: pause underperformers, rotate creatives

## Rules
1. Healthy: CTR > 1%, CPC < $1. Underperforming: CTR < 0.5% or CPC > $2
2. If concept blocked by moderation, generate new angle — never retry same concept
3. Start with small variation set, let spend distribute to winners
4. Separate billing lane — track ad spend separately from credits
5. Max turns: 100`,

  42: `You are the Browser Agent for Baljia AI. You automate web browsing tasks.

## Your Capabilities
- Navigate websites, fill forms, take screenshots
- Extract data from web pages
- Account setup and verification
- Web scraping and content extraction

## Rules
1. Check site tier before any action (Tier 1 = browse-only for social media)
2. One task = one browser session
3. Save credentials after successful account creation
4. No 2FA support, no desktop apps, no PDF workflows
5. Take screenshots as verification evidence`,

  54: `You are the Cold Outreach Agent for Baljia AI. You send targeted outreach emails.

## Your Capabilities
- Find and verify email addresses
- Send personalized cold emails
- Manage follow-up sequences
- Track lead responses

## Rules
1. Verify every email before sending (Hunter.io)
2. Skip prospects without personalization hook
3. Plain-text emails, 50-125 words, founder-style voice
4. Max ~2 outbound cold emails per day
5. Check inbound replies first before new outreach
6. Follow up after ~5+ days, not sooner`,
};

// ══════════════════════════════════════════════
// AGENT TOOLS — per-agent tool surfaces
// IMPORTANT (GOTCHA #2): Only Twitter (40) and ColdOutreach (54) have document access.
// Engineering, Browser, Data, Research, Support must NOT get read_document.
// Documents for those agents are injected via compiled briefing in assembleBriefing().
// ══════════════════════════════════════════════

// Base tools — task progress + report creation only (NO document access)
const BASE_TOOLS = [
  {
    name: 'update_task_status',
    description: 'Update the current task with a progress note',
    input_schema: {
      type: 'object' as const,
      properties: {
        note: { type: 'string' as const, description: 'Progress note or status update' },
      },
      required: ['note'],
    },
  },
  {
    name: 'create_report',
    description: 'Create a report with findings or deliverables',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Report title' },
        content: { type: 'string' as const, description: 'Report content in markdown' },
        report_type: { type: 'string' as const, description: 'Type: research, analytics, execution, strategy' },
      },
      required: ['title', 'content'],
    },
  },
];

// Document tools — only Twitter (40) and ColdOutreach (54)
const DOCUMENT_TOOLS = [
  {
    name: 'read_document',
    description: 'Read a company document (mission, product_overview, brand_voice, tech_notes, user_research)',
    input_schema: {
      type: 'object' as const,
      properties: {
        doc_type: { type: 'string' as const, description: 'Document type to read' },
      },
      required: ['doc_type'],
    },
  },
  {
    name: 'suggest_document_update',
    description: 'Propose an update to a company document. The founder reviews and approves before changes are applied.',
    input_schema: {
      type: 'object' as const,
      properties: {
        doc_type: { type: 'string' as const, description: 'Document type to update (brand_voice, product_overview, user_research, tech_notes)' },
        suggested_content: { type: 'string' as const, description: 'The full proposed new content for the document' },
        reasoning: { type: 'string' as const, description: 'Why this update improves the document' },
      },
      required: ['doc_type', 'suggested_content', 'reasoning'],
    },
  },
  {
    name: 'list_documents',
    description: 'List all company documents and their status (populated or empty).',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// Company email tools — Browser (42) and Support (32)
// Browser needs email to confirm signups, read verification codes, etc.
const COMPANY_EMAIL_TOOLS = [
  {
    name: 'get_inbox',
    description: 'Get recent inbound emails for the company inbox.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' as const, description: 'Max emails to return (default: 10)' },
        unread_only: { type: 'boolean' as const, description: 'Only unread emails (default: false)' },
      },
    },
  },
  {
    name: 'get_email_thread',
    description: 'Get the full email thread by thread ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        thread_id: { type: 'string' as const, description: 'Thread ID to retrieve' },
      },
      required: ['thread_id'],
    },
  },
  {
    name: 'wait_for_email',
    description: 'Wait up to 60 seconds for an inbound email matching a pattern (e.g. verification code from a specific domain).',
    input_schema: {
      type: 'object' as const,
      properties: {
        from_domain: { type: 'string' as const, description: 'Expected sender domain (e.g. "twitter.com")' },
        subject_contains: { type: 'string' as const, description: 'Partial subject match (e.g. "verify", "confirm")' },
      },
    },
  },
];

function getAgentTools(agentId: number) {
  // Add domain-specific tools
  switch (agentId) {
    case 30: return [...BASE_TOOLS, ...getEngineeringTools()];                        // Engineering
    case 42: return [...BASE_TOOLS, ...getBrowserTools(), ...COMPANY_EMAIL_TOOLS];    // Browser + email read
    case 29: return [...BASE_TOOLS, ...getResearchTools()];                           // Research
    case 33: return [...BASE_TOOLS, ...getDataTools()];                               // Data
    case 32: return [...BASE_TOOLS, ...getSupportTools()];                            // Support (email tools are in getSupportTools)
    case 40: return [...BASE_TOOLS, ...getTwitterTools(), ...DOCUMENT_TOOLS];         // Twitter + docs
    case 41: return [...BASE_TOOLS, ...getMetaAdsTools()];                            // Meta Ads
    case 54: return [...BASE_TOOLS, ...getOutreachTools(), ...DOCUMENT_TOOLS];        // Cold Outreach + docs
    default: return BASE_TOOLS;
  }
}

// ══════════════════════════════════════════════
// BRIEFING ASSEMBLY — context packet for agent
// ══════════════════════════════════════════════

async function assembleBriefing(task: Task, agentId: number): Promise<string> {
  const sections: string[] = [];

  // Agent personality
  const prompt = AGENT_PROMPTS[agentId];
  if (prompt) sections.push(prompt);

  // Task briefing
  sections.push(`## Your Current Task
- **Title:** ${task.title}
- **Description:** ${task.description ?? 'No additional description'}
- **Tag:** ${task.tag}
- **Max turns:** ${task.max_turns}
- **Priority:** ${task.priority}`);

  // Memory packet — includes all 3 layers + task-relevant learnings
  try {
    const memoryPacket = await memoryService.assembleWorkerPacket(task.company_id, {
      title: task.title,
      tag: task.tag,
      description: task.description,
    });
    if (memoryPacket.trim()) {
      sections.push(`## Company Context\n${memoryPacket}`);
    }
  } catch { /* continue without */ }

  // Documents
  try {
    const docs = await documentService.getDocuments(task.company_id);
    const nonEmpty = docs.filter((d) => !d.is_empty && d.content);
    if (nonEmpty.length > 0) {
      const docSummary = nonEmpty
        .map((d) => `### ${d.title ?? d.doc_type}\n${d.content!.substring(0, 500)}${d.content!.length > 500 ? '...' : ''}`)
        .join('\n\n');
      sections.push(`## Company Documents\n${docSummary}`);
    }
  } catch { /* continue without */ }

  sections.push(`## Completion
When you've finished the task, provide a clear summary of:
1. What was done
2. Files created/modified (if applicable)
3. Any issues encountered
4. Recommendations for follow-up`);

  return sections.join('\n\n---\n\n');
}

// ══════════════════════════════════════════════
// TOOL HANDLER — execute tools called by the agent
// ══════════════════════════════════════════════

async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  task: Task,
): Promise<string> {
  switch (toolName) {
    case 'update_task_status': {
      const note = (toolInput.note as string) ?? '';
      log.debug('Agent progress', { note });
      return `Status updated: ${note}`;
    }

    case 'create_report': {
      const { db, reports } = await import('@/lib/db');
      try {
        await db.insert(reports).values({
          company_id: task.company_id,
          task_id: task.id,
          title: toolInput.title as string,
          content: toolInput.content as string,
          report_type: (toolInput.report_type as string) ?? 'execution',
        });
        return `Report created: "${toolInput.title}"`;
      } catch (err) {
        return `Error creating report: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    case 'read_document': {
      try {
        const doc = await documentService.getDocumentByType(task.company_id, toolInput.doc_type as string);
        if (!doc || doc.is_empty) return `Document "${toolInput.doc_type}" is empty or not found.`;
        return doc.content ?? 'No content';
      } catch {
        return `Could not read document "${toolInput.doc_type}"`;
      }
    }

    case 'suggest_document_update': {
      try {
        const docs = await documentService.getDocuments(task.company_id);
        const doc = docs.find((d) => d.doc_type === (toolInput.doc_type as string));
        if (!doc) return `Document "${toolInput.doc_type}" not found. Available: ${docs.map((d) => d.doc_type).join(', ')}`;
        await documentService.createSuggestion({
          document_id: doc.id,
          company_id: task.company_id,
          suggested_content: toolInput.suggested_content as string,
          reasoning: toolInput.reasoning as string,
          source_task_id: task.id,
        });
        return `Document suggestion submitted for "${toolInput.doc_type}". The founder will review and approve.`;
      } catch (err) {
        return `Failed to create document suggestion: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }

    case 'list_documents': {
      try {
        const docs = await documentService.getDocuments(task.company_id);
        return docs.map((d) =>
          `- ${d.doc_type}: ${d.is_empty ? '(empty)' : d.title ?? 'populated'}`
        ).join('\n') || 'No documents found.';
      } catch {
        return 'Could not list documents.';
      }
    }

    // Company email tools (Browser agent)
    case 'get_inbox': {
      const { db, emailThreads } = await import('@/lib/db');
      const { eq, and, desc } = await import('drizzle-orm');
      const limit = Math.min((toolInput.limit as number) ?? 10, 50);
      const data = await db.select({
        from_address: emailThreads.from_address, subject: emailThreads.subject,
        body: emailThreads.body, created_at: emailThreads.created_at, thread_id: emailThreads.thread_id,
      }).from(emailThreads)
        .where(and(eq(emailThreads.company_id, task.company_id), eq(emailThreads.direction, 'inbound')))
        .orderBy(desc(emailThreads.created_at)).limit(limit);
      if (!data.length) return 'No inbound emails.';
      return data.map((e) =>
        `- From: ${e.from_address} | Subject: ${e.subject ?? '(none)'} | Thread: ${e.thread_id} | ${e.created_at}`
      ).join('\n');
    }

    case 'get_email_thread': {
      const { db, emailThreads } = await import('@/lib/db');
      const { eq, and, asc } = await import('drizzle-orm');
      const data = await db.select().from(emailThreads)
        .where(and(eq(emailThreads.company_id, task.company_id), eq(emailThreads.thread_id, toolInput.thread_id as string)))
        .orderBy(asc(emailThreads.created_at));
      if (!data.length) return `No thread ${toolInput.thread_id}`;
      return data.map((e) => `[${e.direction}] ${e.from_address}\n${e.body ?? ''}`).join('\n---\n');
    }

    case 'wait_for_email': {
      const { db, emailThreads } = await import('@/lib/db');
      const { eq, and, gte, ilike, desc } = await import('drizzle-orm');
      const start = Date.now();
      const maxWait = 60_000;
      const pollInterval = 3_000;
      const fromDomain = toolInput.from_domain as string | undefined;
      const subjectContains = toolInput.subject_contains as string | undefined;

      while (Date.now() - start < maxWait) {
        const conditions = [
          eq(emailThreads.company_id, task.company_id),
          eq(emailThreads.direction, 'inbound'),
          gte(emailThreads.created_at, new Date(start)),
        ];
        if (fromDomain) conditions.push(ilike(emailThreads.from_address, `%@${fromDomain}`));
        if (subjectContains) conditions.push(ilike(emailThreads.subject, `%${subjectContains}%`));

        const data = await db.select({
          from_address: emailThreads.from_address, subject: emailThreads.subject,
          body: emailThreads.body, created_at: emailThreads.created_at,
        }).from(emailThreads).where(and(...conditions)).orderBy(desc(emailThreads.created_at)).limit(5);

        if (data.length) {
          const e = data[0];
          return `Email received!\nFrom: ${e.from_address}\nSubject: ${e.subject}\nBody: ${(e.body ?? '').substring(0, 500)}`;
        }

        await new Promise((r) => setTimeout(r, pollInterval));
      }

      return `No matching email received within 60 seconds. Pattern: from_domain=${fromDomain ?? 'any'}, subject_contains=${subjectContains ?? 'any'}`;
    }

    default:
      // Dispatch to domain-specific tool handlers
      return handleDomainTool(toolName, toolInput, task);
  }
}

// ══════════════════════════════════════════════
// DOMAIN TOOL DISPATCHER
// ══════════════════════════════════════════════

const ENGINEERING_TOOLS = new Set([
  'github_create_repo', 'github_push_file', 'github_read_file',
  'github_list_files', 'github_delete_file',
  'render_create_service', 'render_get_service', 'render_deploy',
  'render_get_deploy_status', 'get_company_tech',
  'attach_custom_domain', 'verify_custom_domain',
]);

const BROWSER_TOOLS = new Set([
  'browser_navigate', 'browser_screenshot', 'browser_click', 'browser_fill',
  'browser_extract', 'browser_get_content', 'browser_evaluate',
  'get_site_tier', 'save_credentials', 'get_credentials',
]);

const RESEARCH_TOOLS = new Set([
  'web_search', 'web_extract', 'competitor_analysis', 'industry_trends',
]);

const DATA_TOOLS = new Set([
  'query_database', 'inspect_schema', 'get_metrics', 'analyze_trends',
]);

const SUPPORT_TOOLS = new Set([
  'get_inbox', 'send_email', 'get_email_thread',
  'escalate_to_owner', 'escalate_to_engineering', 'get_contacts',
]);

const TWITTER_TOOLS = new Set([
  'post_tweet', 'get_twitter_account', 'get_recent_tweets', 'schedule_tweet',
  'read_document', 'suggest_document_update', 'list_documents',
]);

const META_ADS_TOOLS = new Set([
  'create_campaign', 'create_adset', 'create_ad', 'activate_campaign',
  'pause_campaign', 'list_campaigns', 'get_campaign_insights',
  'evaluate_ad_performance', 'get_ad_account', 'update_ad_metrics',
  'list_adsets', 'delete_ad',
]);

const OUTREACH_TOOLS = new Set([
  'find_email', 'verify_email', 'send_outreach_email', 'check_replies',
  'add_contact', 'update_contact_status', 'get_contacts', 'get_outreach_stats',
  'read_document', 'suggest_document_update', 'list_documents',
]);

async function handleDomainTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  task: Task,
): Promise<string> {
  if (ENGINEERING_TOOLS.has(toolName)) return handleEngineeringTool(toolName, toolInput, task);
  if (BROWSER_TOOLS.has(toolName)) return handleBrowserTool(toolName, toolInput, task);
  if (RESEARCH_TOOLS.has(toolName)) return handleResearchTool(toolName, toolInput, task);
  if (DATA_TOOLS.has(toolName)) return handleDataTool(toolName, toolInput, task);
  if (SUPPORT_TOOLS.has(toolName)) return handleSupportTool(toolName, toolInput, task);
  if (TWITTER_TOOLS.has(toolName)) return handleTwitterTool(toolName, toolInput, task);
  if (META_ADS_TOOLS.has(toolName)) return handleMetaAdsTool(toolName, toolInput, task);
  if (OUTREACH_TOOLS.has(toolName)) return handleOutreachTool(toolName, toolInput, task);
  return `Unknown tool: ${toolName}`;
}

// ══════════════════════════════════════════════
// MAIN EXECUTION — tool-use loop
// ══════════════════════════════════════════════

interface AgentInput {
  task: Task;
  agentId: number;
  agentName: string;
  watchdog: Watchdog;
  execution: TaskExecution;
}

interface AgentResult {
  turnCount: number;
  log: Record<string, unknown>[];
}

export async function executeAgent(input: AgentInput): Promise<AgentResult> {
  const { task, agentId, watchdog, execution } = input;

  const systemPrompt = await assembleBriefing(task, agentId);
  const tools = getAgentTools(agentId);
  const logEntries: Record<string, unknown>[] = [];

  // Use Anthropic if available, otherwise Gemini
  if (isAnthropicAvailable()) {
    try {
      return await runWithClaude(systemPrompt, tools, task, watchdog, logEntries);
    } catch (claudeError) {
      log.warn('Claude failed, trying Gemini', { taskId: task.id });
    }
  }

  try {
    return await runWithGemini(systemPrompt, tools, task, watchdog, logEntries);
  } catch (geminiError) {
    log.error('All providers failed', { taskId: task.id }, geminiError);
    throw geminiError;
  }
}

// ── Claude execution ──

async function runWithClaude(
  systemPrompt: string,
  tools: ReturnType<typeof getAgentTools>,
  task: Task,
  watchdog: Watchdog,
  log_entries: Record<string, unknown>[],
): Promise<AgentResult> {
  const anthropic = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `Execute the task described in your briefing. Begin.` },
  ];

  let turnCount = 0;

  while (true) {
    // G-LLM-001: Timeout + retry on Claude API calls
    const response = await callAnthropicWithTimeout(
      anthropic,
      {
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        messages,
      },
      { label: `agent_turn_${turnCount + 1}` }
    ) as Anthropic.Message;

    turnCount++;

    // Watchdog check
    const verdict = watchdog.recordTurn(null);
    if (verdict === 'kill') {
      log_entries.push({ turn: turnCount, event: 'watchdog_kill', reason: 'turn/time limit' });
      break;
    }

    // Process response
    const assistantContent = response.content;
    messages.push({ role: 'assistant', content: assistantContent });

    // Check for tool use
    const toolUseBlocks = assistantContent.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (toolUseBlocks.length === 0) {
      // No more tool calls — agent is done
      const textBlock = assistantContent.find(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      log_entries.push({ turn: turnCount, event: 'completed', summary: textBlock?.text?.substring(0, 500) });
      break;
    }

    // Execute tools and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolBlock of toolUseBlocks) {
      const result = await handleToolCall(
        toolBlock.name,
        toolBlock.input as Record<string, unknown>,
        task,
      );
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: result,
      });
      log_entries.push({ turn: turnCount, tool: toolBlock.name, input: toolBlock.input, result });
    }

    messages.push({ role: 'user', content: toolResults });

    // Check stop reason
    if (response.stop_reason === 'end_turn') {
      log_entries.push({ turn: turnCount, event: 'end_turn' });
      break;
    }
  }

  return { turnCount, log: log_entries };
}

// ── Gemini execution ──

async function runWithGemini(
  systemPrompt: string,
  tools: ReturnType<typeof getAgentTools>,
  task: Task,
  watchdog: Watchdog,
  log_entries: Record<string, unknown>[],
): Promise<AgentResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    })) as any }],
  });

  const chat = model.startChat({
    history: [],
  });

  let turnCount = 0;
  let currentMessage = 'Execute the task described in your briefing. Begin.';

  while (true) {
    // G-LLM-001: Timeout + retry on Gemini API calls
    const result = await callGeminiWithTimeout(
      () => chat.sendMessage(currentMessage),
      { label: `gemini_turn_${turnCount + 1}` }
    ) as { response: { candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>; text: () => string } };
    turnCount++;

    const verdict = watchdog.recordTurn(null);
    if (verdict === 'kill') {
      log_entries.push({ turn: turnCount, event: 'watchdog_kill', reason: 'turn/time limit' });
      break;
    }

    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts ?? [];

    // Check for function calls
    const functionCalls = parts.filter((p) => 'functionCall' in p);

    if (functionCalls.length === 0) {
      // Done
      const text = response.text();
      log_entries.push({ turn: turnCount, event: 'completed', summary: text.substring(0, 500) });
      break;
    }

    // Execute function calls
    const functionResponses: Array<{ functionResponse: { name: string; response: { result: string } } }> = [];

    for (const part of functionCalls) {
      if ('functionCall' in part && part.functionCall) {
        const fc = part.functionCall as { name?: string; args?: Record<string, unknown> };
        if (!fc.name) continue;
        const toolResult = await handleToolCall(
          fc.name,
          (fc.args ?? {}) as Record<string, unknown>,
          task,
        );
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: { result: toolResult },
          },
        });
        log_entries.push({ turn: turnCount, tool: fc.name, input: fc.args, result: toolResult });
      }
    }

    // Send function results back
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currentMessage = JSON.stringify(functionResponses) as any;
  }

  return { turnCount, log: log_entries };
}
