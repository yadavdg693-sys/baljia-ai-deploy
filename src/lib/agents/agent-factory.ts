// Agent Factory — assembles briefing + runs agent with tool loop
// Pattern: prompt assembly → model call → tool handling → watchdog check → repeat
// Supports Claude (primary) and Gemini (fallback)
//
// Phase 2A wiring:
// - 2A-1: agents table for prompts (DB-first, hardcoded fallback)
// - 2A-2: failure fingerprint injection into briefing
// - 2A-3: watchdog.checkHealth() between turns
// - 2A-5: prior reports injection into briefing

import Anthropic from '@anthropic-ai/sdk';
import * as memoryService from '@/lib/services/memory.service';
import * as documentService from '@/lib/services/document.service';
import * as failureService from '@/lib/services/failure.service';
import { Watchdog } from './watchdog';
import { getBrowserTools, handleBrowserTool } from './tools/browser.tools';
import { getResearchTools, handleResearchTool } from './tools/research.tools';
import { getDataTools, handleDataTool } from './tools/data.tools';
import { getSupportTools, handleSupportTool } from './tools/support.tools';
import { getTwitterTools, handleTwitterTool } from './tools/twitter.tools';
import { getMetaAdsTools, handleMetaAdsTool } from './tools/meta-ads.tools';
import { getOutreachTools, handleOutreachTool } from './tools/outreach.tools';
import { getEngineeringTools, handleEngineeringTool } from './tools/engineering.tools';
import { callAnthropicWithTimeout, callOpenRouterWithTimeout, callGeminiWithTimeout } from '@/lib/llm-safety';
import { isAnthropicAvailable, isBedrockAvailable, isDirectAnthropicAvailable, isAnthropicOAuthAvailable, isOpenAIAvailable, getOpenAIApiKey, isOpenRouterAvailable, isGeminiAvailable, OPENROUTER_MODELS, OPENAI_MODELS, getPreferredProvider } from '@/lib/llm-provider';
import { createAnthropicWithOAuthAsync, withClaudeCodeIdentity } from '@/lib/anthropic-oauth';
import { sanitizeForPrompt, moderateOutput } from '@/lib/content-safety';
import { db, agents as agentsTable, reports, companies, tasks as tasksTable, taskExecutions } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import type { Task, TaskExecution } from '@/types';

const log = createLogger('AgentFactory');

// Worker agents (engineering / research / data / browser / etc.) use Sonnet
// 4.6 — strong on code generation + tool use, cheaper than Opus, and the
// adaptive-thinking model rated best for agent loops. Haiku 4.5 stays as
// the fast/cheap option for verification + small classifications.
// Override via WORKER_CLAUDE_MODEL / WORKER_HAIKU_MODEL env vars.
const CLAUDE_MODEL_SONNET = process.env.WORKER_CLAUDE_MODEL || 'claude-sonnet-4-6';
const CLAUDE_MODEL_HAIKU = process.env.WORKER_HAIKU_MODEL || 'claude-haiku-4-5-20251001';
const GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_AGENT_MAX_TOKENS = 4096;
const ENGINEERING_AGENT_MAX_TOKENS = 12000;
const DEFAULT_AGENT_CALL_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS ?? '60000', 10);
const ENGINEERING_AGENT_CALL_TIMEOUT_MS = parseInt(process.env.ENGINEERING_LLM_TIMEOUT_MS ?? '180000', 10);

function getAgentMaxTokens(agentId: number): number {
  return agentId === 30 ? ENGINEERING_AGENT_MAX_TOKENS : DEFAULT_AGENT_MAX_TOKENS;
}

function getAgentCallTimeoutMs(agentId: number): number {
  return agentId === 30 ? ENGINEERING_AGENT_CALL_TIMEOUT_MS : DEFAULT_AGENT_CALL_TIMEOUT_MS;
}

// ══════════════════════════════════════════════
// AGENT PROMPTS — per-agent system prompt assembly
// ══════════════════════════════════════════════

const AGENT_PROMPTS: Record<number, string> = {
  30: `You are the Engineering Agent for Baljia AI. You build, fix, and deploy software for founder apps as Git-backed Render web services with Neon Postgres.

## Skills — READ BEFORE CODING (this is mandatory, not optional)

You have a curated knowledge library at .claude/skills/. Each skill is a SKILL.md
that captures stack-specific patterns, frameworks that DO and DON'T work, and
gotchas your training data is missing or wrong about.

The first thing you do on any non-trivial task:
  1. Call list_skills — see what's available
  2. Call read_skill('<name>') for each skill that's relevant to the task

Skill matrix — read the listed skill BEFORE writing code in that domain:

| Touching... | Read skill |
|---|---|
| Building a full-stack founder app for Render | frontend-design + neon-postgres |
| Database / SQL / migrations / schema | neon-postgres |
| HTML / pages / dashboards / Tailwind / UI | frontend-design |
| Payments / Stripe / pricing / subscriptions | stripe-payments |
| Static assets / images included in the app | frontend-design |
| Generated media / ad creative files / public asset URLs | r2-storage |
| Email send / notifications / inbound mail | email-postmark |
| AI features (LLM calls, agent loops, prompt-template logic) | agent-sdk |

If you write code in a domain WITHOUT reading its skill first, you will likely
ship a pattern that doesn't work in Baljia's deployment path. The skills exist
because the LLM's general training data often suggests patterns that do not
match the current hosting/runtime.

## Rules

1. **Skills first.** Call list_skills + read the relevant ones BEFORE coding. This is the single most important rule.
2. **Know the company state.** Call get_company_tech to know slug + DB status before infra work.
3. **Default deploy path for engineering tasks is Render.**
   - **First deploy** (no Render service yet): create a company GitHub repo if missing, push a complete minimal app, call render_create_service with plan "free", then check deploy status and health.
   - **Update** (render_service_id exists): read/list the GitHub repo, edit only what the task requires, push/commit, call render_deploy, then check deploy status and health.
   - Do not create duplicate Render services. One company gets one trial Render service.
4. **Provision before deploy.** If the app needs a DB, call provision_database FIRST, then pass DATABASE_URL/NEON_CONNECTION_STRING as a Render env var. The tool will replace masked DB URLs with the real company DB URL.
5. **Always verify.** After Render deploy, call render_get_deploy_status and check_url_health for the company live URL. If a route was requested, health-check that route too.
6. **"Completed" = feature actually works.** A successful deploy alone is not enough. Verify the feature behavior the founder asked for.
7. **Report honestly.** Tool calls you made, URLs/endpoints you exposed, env vars needed, AND any verification gaps you couldn't close.`,

  29: `You are the Research Agent for Baljia AI. You analyze markets, competitors, and opportunities.

## Your Capabilities
- Market research and competitive analysis
- Industry trend analysis
- Customer persona development
- Feature comparison matrices
- Strategy recommendations

## Citation Rules (MANDATORY)
1. Every factual claim MUST be backed by a URL citation from web_search results
2. If web search is unavailable, prefix findings with "Based on model knowledge (unverified):"
3. If insufficient evidence exists for a claim, explicitly state: "INSUFFICIENT EVIDENCE: [what's missing]"
4. Include a "Sources" section at the end of every report with numbered URL references
5. Rate confidence level for each finding: HIGH (multiple sources), MEDIUM (single source), LOW (model knowledge only)

## Quality Rules
1. Distinguish correlation from causation
2. Note data limitations and recency explicitly
3. Create structured reports with methodology section
4. Include actionable recommendations, not just observations
5. Never fabricate statistics or attribute fake quotes`,

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
- Persistent site memory across tasks

## Browser cost — choose the cheapest tool first
Browserbase (cloud Chromium) is billed per minute (~$0.10/min). A real browser session costs the platform money. **Before \`browser_navigate\`, ask: do I actually need a browser?**

| The task is… | Use this | Why |
|---|---|---|
| Read a public REST API (returns JSON) | \`http_fetch\` | No browser needed, free |
| Read a static HTML page (no JS, no auth) | \`http_fetch\` | No browser needed, free |
| Read robots.txt / sitemap.xml / RSS | \`http_fetch\` | Free |
| OCR an image you already have a URL for | \`ocr_image\` | Direct fetch, no browser |
| Login flow / signup / form fill / SPA / auth-walled content | \`browser_navigate\` | Real browser required |
| Anti-bot challenge / CAPTCHA-likely site | \`browser_navigate\` | Browserbase has stealth fingerprint |

When in doubt, try \`http_fetch\` first. The response will tell you if it's a JS-required SPA or anti-bot block — if so, fall back to \`browser_navigate\`.

## Site Memory — read BEFORE you navigate
Baljia accumulates per-site knowledge over time: working selectors, URL patterns, gotchas (CAPTCHAs, redirects, slow loads), notes on multi-step flows. Use this memory to avoid re-discovering the same site every task.

1. Before \`browser_navigate\` to any site you have not interacted with in this task, call \`read_domain_skills(domain=...)\`. Treat returned skills as hints, not gospel — sites change.
2. After a successful interaction, record what you learned with \`record_domain_skill\`. Examples:
   - kind="selector", key="login_button", value="button[data-test=login-submit]"
   - kind="url_pattern", key="dashboard_url", value="https://app.example.com/d/{user_id}"
   - kind="trap", key="captcha_on_signup", value="hCaptcha appears AFTER email submit, not before"
   - kind="wait", key="after_login", value="page reloads twice; wait for [data-loaded=true]"
   - kind="note", key="signup_blocked_for_gmail", value="hunter.io rejects @gmail.com — use @baljia.app instead"
3. Never record secrets in domain skills. Use \`save_credentials\` for usernames/passwords.

## Provider Bootstrap Packs — pre-built signup recipes
For tasks like "provision an OpenAI / Stripe / GitHub / Render / Postmark / Sentry / Cloudflare R2 / Anthropic API key", do NOT improvise. Use the pre-built recipes:

1. Call \`list_provider_packs()\` first to see what's available.
2. If the provider is in the list, call \`start_provider_pack(provider_id=...)\` to get an ordered list of steps.
3. Follow the steps. Each step has a kind: navigate / fill / click / verify_email / capture / save / manual.
4. \`manual\` steps mean STOP — surface to the founder; do not proceed.
5. After capturing the API key, save it via \`save_credentials\` (with the email used as username and the API key as password). Do NOT log the key in plain text in your status updates.
6. Record any new gotchas via \`record_domain_skill\` so future tasks finish faster.

If the provider is NOT in the list, fall back to standard browser interaction + record_domain_skill for everything you learn.

## OCR — when CSS selectors fail
Some content cannot be reached via DOM selectors: canvas-rendered dashboards, image-rendered API keys, PDFs, content inside cross-origin iframes. For these cases use the OCR tools (powered by Tesseract.js, in-process, free):

1. \`ocr_current_page\` — read all visible text on the current page.
2. \`ocr_click_text("Continue with Google")\` — find a piece of visible text and click its on-screen position. Use ONLY when CSS-based clicks have failed.
3. \`ocr_image(image_url)\` — OCR a specific image (logos, embedded screenshots, downloaded receipts).

OCR is slower than CSS-based interaction (~2-5 seconds per page) — prefer selectors when they work. OCR shines for:
- Stripe-style "API key shown once" reveal screens that are sometimes canvas-rendered
- Captcha images you ROUTED to manual intervention (read what they say)
- PDF invoices or downloaded receipts

If OCR finds the text but at low confidence (<60), the screenshot is probably blurry or the language pack is wrong — try a fresh screenshot or a different lang code.

## Email — read AND send from the company inbox
You have full two-way mail on the company's verified address (e.g. {slug}@baljia.app):

- \`get_inbox\` — list recent inbound emails for this company.
- \`get_email_thread(thread_id)\` — read the full thread when you need context.
- \`wait_for_email(from_domain, subject_contains)\` — block up to 60s for an inbound email matching a pattern (use this immediately after triggering a verification email).
- \`send_company_email(to, subject, body, reply_to_thread_id?)\` — send a plain-text reply or new message FROM the company's address. Pass \`reply_to_thread_id\` to keep the thread.

Send is for WEB-AUTOMATION-ADJACENT mail only — replying to a vendor mid-task, confirming an account, asking a service to whitelist the company email. Do NOT use it for bulk outreach (that's the Cold Outreach agent's job) or customer support replies (that's the Support agent's job). Body should be 50-200 words, plain-text, founder-style voice.

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

// Base tools — task progress + report creation + runtime memory (all agents)
// Covers: tasks(2), reports(3), learnings(5), polsia_support(2), send_reply(1), documents(read)
const BASE_TOOLS = [
  // ── tasks: lifecycle ──
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
    name: 'get_task_status',
    description: 'Get the current state of this task (status, priority, assigned agent, turn count). Useful to verify state before completing.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  // ── reports: all 3 KG tools ──
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
  {
    name: 'query_reports',
    description: 'List previously created reports for this company. Returns a compact list with report IDs, titles, types, dates, and a short preview. To read the FULL content of a specific report, follow up with read_report(report_id). Use this to discover what was previously built; use read_report to actually consume one.',
    input_schema: {
      type: 'object' as const,
      properties: {
        report_type: { type: 'string' as const, description: 'Filter by type: research, analytics, execution, strategy (optional)' },
        limit: { type: 'number' as const, description: 'Max reports to return (default: 5, max 20)' },
      },
    },
  },
  {
    name: 'read_report',
    description: 'Read the FULL content of a specific report by ID. Use after query_reports identifies a report that looks relevant to the current task. Returns title + type + date + complete content with no truncation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        report_id: { type: 'string' as const, description: 'The UUID of the report to read (from query_reports output)' },
      },
      required: ['report_id'],
    },
  },
  {
    name: 'get_reports_by_date',
    description: 'Get reports created within a date range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        days_ago: { type: 'number' as const, description: 'How many days back to look (default: 7)' },
        report_type: { type: 'string' as const, description: 'Filter by type (optional)' },
      },
    },
  },
  // ── learnings: all 5 KG tools ──
  // H-AGENT-021: Runtime memory write-back — workers can persist discoveries during execution
  {
    name: 'save_learning',
    description: 'Save a discovery or learning from this task. Use when you find something reusable — a pattern, a gotcha, an efficient approach, or a failure to avoid. This persists to company memory for future tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string' as const, description: 'What you learned (factual, concise, actionable)' },
        category: { type: 'string' as const, description: 'Category: efficiency, failure_pattern, integration_detail, domain_knowledge, cost_efficiency' },
        confidence: { type: 'string' as const, description: 'Confidence level: high, medium, low' },
      },
      required: ['content', 'category'],
    },
  },
  {
    name: 'query_learnings',
    description: 'Search company memory for past learnings relevant to what you are working on. Use before attempting unfamiliar tasks or when you need context about previous work.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Search query — keywords about the topic you need context on' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_learnings',
    description: 'Advanced search across all company learnings by category and keyword.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keyword: { type: 'string' as const, description: 'Keyword to search in learning content' },
        category: { type: 'string' as const, description: 'Filter by category (optional)' },
        limit: { type: 'number' as const, description: 'Max results (default: 10)' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'get_recent_learnings',
    description: 'Get the most recent learnings saved for this company, regardless of category.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' as const, description: 'How many recent learnings to fetch (default: 10)' },
      },
    },
  },
  {
    name: 'get_learnings_by_tags',
    description: 'Get learnings tagged with specific tags (e.g. "render", "stripe", "bug-fix").',
    input_schema: {
      type: 'object' as const,
      properties: {
        tags: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Tags to filter by (e.g. ["stripe", "webhook"])',
        },
      },
      required: ['tags'],
    },
  },
  // ── polsia_support: 2 KG tools ──
  {
    name: 'report_bug',
    description: 'Report a platform bug discovered during task execution. Use when you encounter a broken tool, missing capability, or platform-level issue that prevents task completion.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Short bug title' },
        description: { type: 'string' as const, description: 'What happened, what you expected, what tool/endpoint failed' },
        severity: { type: 'string' as const, description: 'Severity: low, medium, high, critical' },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'suggest_feature',
    description: 'Suggest a platform capability that would help complete tasks better. Use when you identify a missing tool or workflow that would improve agent effectiveness.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Feature title' },
        description: { type: 'string' as const, description: 'What capability is needed and why it would help' },
      },
      required: ['title', 'description'],
    },
  },
  // ── send_reply: async founder messaging ──
  {
    name: 'send_founder_message',
    description: 'Send an async message to the founder. Use when you need input, want to flag a decision, or need to report something that requires founder awareness. Non-blocking — execution continues.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string' as const, description: 'Message to send to the founder' },
        urgency: { type: 'string' as const, description: 'Urgency: info, action_required, urgent (default: info)' },
      },
      required: ['message'],
    },
  },
  // ── scripts: run platform scripts (KG spec §3.2) ──
  {
    name: 'list_scripts',
    description: 'List available platform scripts that can be run for common operations (migrations, data exports, health checks, etc.).',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string' as const, description: 'Filter by category: db, deploy, analytics, maintenance (optional)' },
      },
    },
  },
  {
    name: 'run_script',
    description: 'Execute a named platform script. Scripts are pre-approved operations — do not use for arbitrary code execution.',
    input_schema: {
      type: 'object' as const,
      properties: {
        script_name: { type: 'string' as const, description: 'Script name (from list_scripts)' },
        args: { type: 'object' as const, description: 'Arguments to pass to the script (optional)' },
      },
      required: ['script_name'],
    },
  },
  {
    name: 'get_script_output',
    description: 'Get the output/result of a previously run script by run ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        run_id: { type: 'string' as const, description: 'Script run ID returned by run_script' },
      },
      required: ['run_id'],
    },
  },
  // ── dashboard: founder-visible links (KG spec §3.2) ──
  {
    name: 'add_dashboard_link',
    description: 'Add a useful link to the founder\'s dashboard (e.g. the new app URL, admin panel, GitHub repo, staging URL). Founders see this prominently.',
    input_schema: {
      type: 'object' as const,
      properties: {
        label: { type: 'string' as const, description: 'Link label shown to founder (e.g. "Live App", "Admin Panel", "GitHub Repo")' },
        url: { type: 'string' as const, description: 'Full URL' },
        link_type: { type: 'string' as const, description: 'Type: app, admin, repo, staging, docs, other (default: other)' },
        description: { type: 'string' as const, description: 'Short description of what this link is' },
      },
      required: ['label', 'url'],
    },
  },
  {
    name: 'get_dashboard_links',
    description: 'Get all links currently shown on the founder\'s dashboard. Useful to avoid adding duplicates.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
];


// Document tools — only Twitter (40) and ColdOutreach (54)
const DOCUMENT_TOOLS = [
  {
    name: 'read_document',
    description: 'Read a company document (mission, product_overview, brand_voice, tech_notes, market_research)',
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
        doc_type: { type: 'string' as const, description: 'Document type to update (brand_voice, product_overview, market_research, tech_notes)' },
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
  {
    name: 'send_company_email',
    description: 'Send a plain-text email FROM the company inbox (e.g. founder@company.baljia.app). Use this to reply to a verification/onboarding request, contact a vendor mid-task, or send a confirmation back to a service. Replies thread automatically when you pass reply_to_thread_id. Plain-text only, ~50-200 words.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string' as const, description: 'Recipient email address' },
        subject: { type: 'string' as const, description: 'Email subject' },
        body: { type: 'string' as const, description: 'Plain-text email body (50-200 words)' },
        reply_to_thread_id: { type: 'string' as const, description: 'Optional thread ID if replying to an existing thread' },
      },
      required: ['to', 'subject', 'body'],
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

async function assembleBriefing(task: Task, agentId: number, contextPacket?: import('@/types').ContextPacket): Promise<string> {
  const sections: string[] = [];

  // 2A-1: Agent personality — DB-first, hardcoded fallback
  // H-AGENT-008: Fetch ALL agent fields from DB
  let agentPrompt = AGENT_PROMPTS[agentId];
  try {
    const [dbAgent] = await db.select({
      base_system_prompt: agentsTable.base_system_prompt,
      name: agentsTable.name,
      default_max_turns: agentsTable.default_max_turns,
      default_model: agentsTable.default_model,
      execution_style: agentsTable.execution_style,
      is_active: agentsTable.is_active,
    }).from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);

    // H-AGENT-008: Check is_active before executing
    if (dbAgent && dbAgent.is_active === false) {
      log.warn('Agent is deactivated in DB', { agentId, name: dbAgent.name });
      sections.push(`⚠️ IMPORTANT: This agent (${dbAgent.name}) is currently deactivated. Complete the task but flag for review.`);
    }

    if (dbAgent?.base_system_prompt?.trim()) {
      agentPrompt = dbAgent.base_system_prompt;
      log.debug('Using DB agent prompt', { agentId, name: dbAgent.name, maxTurns: dbAgent.default_max_turns });
    }
  } catch { /* fallback to hardcoded */ }

  // H-AGENT-001: Template variable injection into prompt
  if (agentPrompt) {
    let companyName = 'the company';
    try {
      const [company] = await db.select({ name: companies.name, one_liner: companies.one_liner })
        .from(companies).where(eq(companies.id, task.company_id)).limit(1);
      if (company?.name) companyName = company.name;
      // Replace template variables in the base prompt
      agentPrompt = agentPrompt
        .replace(/\{\{company_name\}\}/g, companyName)
        .replace(/\{\{company_one_liner\}\}/g, company?.one_liner ?? '')
        .replace(/\{\{task_tag\}\}/g, task.tag)
        .replace(/\{\{agent_id\}\}/g, String(agentId));
    } catch { /* continue with un-templated prompt */ }
    sections.push(agentPrompt);
  }

  // Task briefing — G-CONTENT-001: Sanitize user-provided fields before prompt injection
  const safeTitle = sanitizeForPrompt(task.title);
  const safeDescription = sanitizeForPrompt(task.description ?? 'No additional description');
  sections.push(`## Your Current Task
- **Title:** ${safeTitle}
- **Description:** ${safeDescription}
- **Tag:** ${task.tag}
- **Max turns:** ${task.max_turns}
- **Priority:** ${task.priority}
- **Execution mode:** ${task.execution_mode ?? 'full_agent'}`);

  // H-AGENT-007: Mode-specific behavioral instructions
  const mode = task.execution_mode ?? 'full_agent';
  if (mode === 'deterministic') {
    sections.push(`## Execution Mode: DETERMINISTIC
You are in deterministic mode. This task is a straightforward, mechanical change.
- Do NOT make creative decisions or add features beyond what's specified
- Apply the change directly — no design deliberation needed
- Aim to complete in under 10 turns
- If the task is ambiguous, report it as blocked rather than guessing`);
  } else if (mode === 'template_plus_params') {
    sections.push(`## Execution Mode: TEMPLATE + PARAMS
This task follows a known pattern. Customize a standard approach with project-specific details.
- Use established patterns (standard auth flows, CRUD layouts, form templates, etc.)
- Customize with company branding, naming, and specific requirements
- Don't over-engineer — follow the well-known solution path
- Aim to complete in under 30 turns`);
  }
  // full_agent: no additional constraints

  // 2A-2: Known failure fingerprints — inject context to avoid repeating mistakes.
  // Filter is intentionally tight: only show failures that
  //   (a) affected THIS agent, AND
  //   (b) fall in this task's category, AND
  //   (c) are still unresolved.
  // Loose OR-filters surfaced unrelated past failures (e.g. Twitter rate limits
  // showing up in Engineering deploy briefings) — high token cost, low signal.
  try {
    const recentFailures = await failureService.getRecentFailures(
      new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
    );
    const relevant = recentFailures.filter((f) => {
      const affectedAgents = (f.affected_agents as number[] | null) ?? [];
      const agentMatches = affectedAgents.includes(agentId);
      const categoryMatches = f.category === task.tag;
      const stillOpen = f.fix_status !== 'fixed';
      return agentMatches && categoryMatches && stillOpen;
    }).slice(0, 5);
    if (relevant.length > 0) {
      const lines = relevant.map((f) =>
        `- [${f.category}] ${f.description} (seen ${f.occurrence_count}x, status: ${f.fix_status})`
      );
      sections.push(`## Known Issues (avoid these patterns)\n${lines.join('\n')}`);
    }
  } catch { /* continue without failure context */ }

  // Prior reports are NOT injected here. The previous 300-char truncation
  // produced teasers that looked informative but lacked actionable content
  // (schema, routes, env vars all got cut). Agents now fetch what they
  // actually need via the read_recent_reports BASE tool — full content,
  // optionally filtered by tag. See agent-factory BASE_TOOLS.

  // 2A-6: Related task context — inject logs from prior attempts so agent doesn't repeat mistakes
  try {
    const relatedIds = (task.related_task_ids as string[] | null) ?? [];
    if (relatedIds.length > 0) {
      const priorAttempts: string[] = [];
      for (const relatedId of relatedIds.slice(0, 3)) {
        const [relatedTask] = await db.select({
          title: tasksTable.title, status: tasksTable.status, tag: tasksTable.tag,
        }).from(tasksTable).where(eq(tasksTable.id, relatedId)).limit(1);

        const [execution] = await db.select({
          error_summary: taskExecutions.error_summary,
          status: taskExecutions.status,
          turn_count: taskExecutions.turn_count,
        }).from(taskExecutions).where(eq(taskExecutions.task_id, relatedId))
          .orderBy(desc(taskExecutions.completed_at)).limit(1);

        if (relatedTask) {
          let attempt = `### Prior: "${relatedTask.title}" (${relatedTask.status})`;
          if (execution?.error_summary) {
            attempt += `\n**Failed because:** ${execution.error_summary}`;
          }
          if (execution?.turn_count) {
            attempt += `\n**Turns used:** ${execution.turn_count}`;
          }
          priorAttempts.push(attempt);
        }
      }
      if (priorAttempts.length > 0) {
        sections.push(`## Prior Attempts (DO NOT repeat these mistakes)\n${priorAttempts.join('\n\n')}`);
      }
    }
  } catch { /* continue without related task context */ }

  // Memory packet — use pre-built ContextPacket if available, otherwise assemble fresh
  if (contextPacket?.compiled_briefing?.trim()) {
    sections.push(`## Company Context\n${contextPacket.compiled_briefing}`);
  } else {
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
  }

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
  agentId: number,
): Promise<string> {
  switch (toolName) {
    case 'update_task_status': {
      const note = (toolInput.note as string) ?? '';
      log.debug('Agent progress', { note, agentId });
      return `Status updated: ${note}`;
    }

    case 'get_task_status': {
      try {
        const { db, tasks: tasksTable } = await import('@/lib/db');
        const { eq } = await import('drizzle-orm');
        const [t] = await db.select({
          status: tasksTable.status,
          priority: tasksTable.priority,
          turn_count: tasksTable.turn_count,
          max_turns: tasksTable.max_turns,
          execution_mode: tasksTable.execution_mode,
        }).from(tasksTable).where(eq(tasksTable.id, task.id)).limit(1);
        if (!t) return 'Task not found.';
        return `Task status: ${t.status} | Priority: ${t.priority} | Turns: ${t.turn_count}/${t.max_turns} | Mode: ${t.execution_mode ?? 'full_agent'}`;
      } catch (err) {
        return `Could not get task status: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
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

    case 'query_reports': {
      try {
        const { db, reports } = await import('@/lib/db');
        const { eq, and, desc } = await import('drizzle-orm');
        const limit = Math.min((toolInput.limit as number) ?? 5, 20);
        const conditions = [eq(reports.company_id, task.company_id)];
        if (toolInput.report_type) conditions.push(eq(reports.report_type, toolInput.report_type as string));
        const data = await db.select({ id: reports.id, title: reports.title, report_type: reports.report_type, created_at: reports.created_at, content: reports.content })
          .from(reports).where(and(...conditions)).orderBy(desc(reports.created_at)).limit(limit);
        if (!data.length) return 'No reports found.';
        // Returns a list view with IDs. Use read_report(report_id) to fetch full content of a relevant report.
        return data.map((r) => `- ${r.id} | [${r.report_type}] ${r.title} (${r.created_at?.toISOString().split('T')[0]}) — ${(r.content ?? '').substring(0, 120)}...`).join('\n');
      } catch (err) {
        return `Could not query reports: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    case 'read_report': {
      try {
        const reportId = toolInput.report_id as string;
        if (!reportId || typeof reportId !== 'string') return 'Missing required input: report_id';
        const { db, reports } = await import('@/lib/db');
        const { eq, and } = await import('drizzle-orm');
        const [r] = await db.select({
          id: reports.id, title: reports.title, report_type: reports.report_type,
          created_at: reports.created_at, content: reports.content,
        })
          .from(reports)
          // Tenant isolation: only this company's reports
          .where(and(eq(reports.id, reportId), eq(reports.company_id, task.company_id)))
          .limit(1);
        if (!r) return `Report ${reportId} not found (or belongs to a different company).`;
        const date = r.created_at?.toISOString().split('T')[0] ?? 'unknown';
        return `# ${r.title ?? 'Untitled'}\n**Type:** ${r.report_type ?? 'execution'}  **Date:** ${date}  **ID:** ${r.id}\n\n${r.content ?? '(empty)'}`;
      } catch (err) {
        return `Could not read report: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    case 'get_reports_by_date': {
      try {
        const { db, reports } = await import('@/lib/db');
        const { eq, and, gte, desc } = await import('drizzle-orm');
        const daysAgo = (toolInput.days_ago as number) ?? 7;
        const since = new Date(Date.now() - daysAgo * 86400_000);
        const conditions = [eq(reports.company_id, task.company_id), gte(reports.created_at, since)];
        if (toolInput.report_type) conditions.push(eq(reports.report_type, toolInput.report_type as string));
        const data = await db.select({ title: reports.title, report_type: reports.report_type, created_at: reports.created_at })
          .from(reports).where(and(...conditions)).orderBy(desc(reports.created_at)).limit(20);
        if (!data.length) return `No reports in last ${daysAgo} days.`;
        return data.map((r) => `- [${r.report_type}] ${r.title} (${r.created_at?.toISOString().split('T')[0]})`).join('\n');
      } catch (err) {
        return `Could not get reports by date: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    // H-AGENT-021: Runtime memory write-back
    case 'save_learning': {
      try {
        const category = (toolInput.category as string) ?? 'domain_knowledge';
        const confidence = (toolInput.confidence as string) ?? 'medium';
        const content = toolInput.content as string;
        await memoryService.storeLearnings(task.company_id, task.id, {
          learnings: [{
            category,
            content,
            confidence: confidence as 'high' | 'medium' | 'low',
            tags: [task.tag, category],
          }],
        });
        return `Learning saved: [${category}] ${content.substring(0, 100)}...`;
      } catch (err) {
        return `Could not save learning: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    case 'query_learnings': {
      try {
        const query = toolInput.query as string;
        const results = await memoryService.searchLearnings(task.company_id, query, 5);
        if (results.length === 0) return `No past learnings found for "${query}".`;
        const lines = results.map((l) => `- [${l.category}] ${l.content}`);
        return `Found ${results.length} relevant learnings:\n${lines.join('\n')}`;
      } catch {
        return 'Could not query learnings.';
      }
    }

    case 'search_learnings': {
      try {
        const keyword = toolInput.keyword as string;
        const category = toolInput.category as string | undefined;
        const limit = Math.min((toolInput.limit as number) ?? 10, 30);
        const results = await memoryService.searchLearnings(task.company_id, keyword, limit);
        const filtered = category ? results.filter((l) => l.category === category) : results;
        if (!filtered.length) return `No learnings found for "${keyword}"${category ? ` in category "${category}"` : ''}.`;
        return filtered.map((l) => `- [${l.category}] ${l.content}`).join('\n');
      } catch {
        return 'Could not search learnings.';
      }
    }

    case 'get_recent_learnings': {
      try {
        const limit = Math.min((toolInput.limit as number) ?? 10, 30);
        const { db, learnings } = await import('@/lib/db');
        const { eq, desc } = await import('drizzle-orm');
        const results = await db.select({ category: learnings.category, content: learnings.content, created_at: learnings.created_at })
          .from(learnings).where(eq(learnings.company_id, task.company_id)).orderBy(desc(learnings.created_at)).limit(limit);
        if (!results.length) return 'No learnings stored yet.';
        return results.map((l) => `- [${l.category}] ${l.content}`).join('\n');
      } catch {
        return 'Could not get recent learnings.';
      }
    }

    case 'get_learnings_by_tags': {
      try {
        const tags = toolInput.tags as string[];
        const { db, learnings } = await import('@/lib/db');
        const { eq } = await import('drizzle-orm');
        const results = await db.select({ category: learnings.category, content: learnings.content, tags: learnings.tags })
          .from(learnings)
          .where(eq(learnings.company_id, task.company_id))
          .limit(30);
        // Client-side filter since tags is a jsonb array
        const filtered = results.filter((l) => {
          const lTags = (l.tags as string[] | null) ?? [];
          return tags.some((t) => lTags.includes(t));
        });
        if (!filtered.length) return `No learnings tagged with [${tags.join(', ')}].`;
        return filtered.map((l) => `- [${l.category}] ${l.content}`).join('\n');
      } catch {
        return 'Could not query learnings by tags.';
      }
    }

    // ── polsia_support tools ──
    case 'report_bug': {
      try {
        const { db, platformFeedback } = await import('@/lib/db');
        await db.insert(platformFeedback).values({
          company_id: task.company_id,
          type: 'bug',
          title: toolInput.title as string,
          description: `[Agent #${agentId} task:${task.id}] ${toolInput.description as string}`,
          severity: (toolInput.severity as string) ?? 'medium',
          status: 'open',
          source: 'agent',
          area: 'task_execution',
          metadata: { agent_id: agentId, task_id: task.id },
        });
        return `Bug reported: "${toolInput.title}". Platform team will investigate.`;
      } catch (err) {
        return `Could not report bug: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    case 'suggest_feature': {
      try {
        const { db, platformFeedback } = await import('@/lib/db');
        await db.insert(platformFeedback).values({
          company_id: task.company_id,
          type: 'feature_request',
          title: toolInput.title as string,
          description: `[Agent #${agentId} task:${task.id}] ${toolInput.description as string}`,
          severity: 'low',
          status: 'open',
          source: 'agent',
          area: 'task_execution',
          metadata: { agent_id: agentId, task_id: task.id },
        });
        return `Feature suggestion submitted: "${toolInput.title}".`;
      } catch (err) {
        return `Could not submit suggestion: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    // ── send_reply: async founder messaging ──
    case 'send_founder_message': {
      try {
        const { db, platformEvents } = await import('@/lib/db');
        const urgency = (toolInput.urgency as string) ?? 'info';
        await db.insert(platformEvents).values({
          company_id: task.company_id,
          event_type: 'agent_message',
          payload: {
            agent_id: agentId,
            task_id: task.id,
            message: toolInput.message as string,
            urgency,
          },
          is_public_safe: false,
        });
        return `Message sent to founder (urgency: ${urgency}): "${(toolInput.message as string).substring(0, 100)}...`;
      } catch (err) {
        return `Could not send message: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    // ── scripts: platform script registry ──
    case 'list_scripts': {
      const category = (toolInput.category as string) ?? null;
      const SCRIPT_REGISTRY = [
        { name: 'db:health', category: 'db', description: 'Check database connectivity and table counts' },
        { name: 'db:backup', category: 'db', description: 'Export company database schema as SQL' },
        { name: 'db:run-migration', category: 'db', description: 'Run a SQL migration on the company database', args: ['sql'] },
        { name: 'deploy:trigger', category: 'deploy', description: 'Trigger a new Render deploy for this company', args: ['service_id'] },
        { name: 'deploy:health', category: 'deploy', description: 'Check live URL health for the company app' },
        { name: 'deploy:rollback', category: 'deploy', description: 'Rollback to the last successful deploy', args: ['service_id'] },
        { name: 'analytics:credits', category: 'analytics', description: 'Show credit usage breakdown for this company' },
        { name: 'analytics:tasks', category: 'analytics', description: 'Show task completion rates and failure patterns' },
        { name: 'maintenance:clear-queue', category: 'maintenance', description: 'Clear stale todo tasks older than 30 days' },
        { name: 'maintenance:cleanup-logs', category: 'maintenance', description: 'Trim task execution logs to last 100 per task' },
      ];
      const filtered = category ? SCRIPT_REGISTRY.filter(s => s.category === category) : SCRIPT_REGISTRY;
      if (!filtered.length) return `No scripts found for category "${category}".`;
      return `## Available Scripts\n${filtered.map(s => `- **${s.name}** [${s.category}] — ${s.description}${s.args ? ` | Args: ${s.args.join(', ')}` : ''}`).join('\n')}`;
    }

    case 'run_script': {
      const scriptName = toolInput.script_name as string;
      const args = (toolInput.args as Record<string, unknown>) ?? {};
      const runId = `${scriptName}-${Date.now()}`;
      try {
        // Route to real implementation or delegating to domain tools
        switch (scriptName) {
          case 'deploy:health': {
            const { db: dbInst, companies: co } = await import('@/lib/db');
            const { eq: eqOp } = await import('drizzle-orm');
            const [company] = await dbInst.select({ custom_domain: co.custom_domain, slug: co.slug })
              .from(co).where(eqOp(co.id, task.company_id)).limit(1);
            const url = company?.custom_domain
              ? `https://${company.custom_domain}`
              : company?.slug ? `https://${company.slug}.baljia.app` : null;
            if (!url) return `${runId}: No live URL found for this company. Deploy the app first.`;
            const start = Date.now();
            const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
            return `${runId}: ${res.ok ? '✅' : '⚠️'} ${url} — HTTP ${res.status} in ${Date.now()-start}ms`;
          }
          case 'analytics:credits': {
            const { db: dbInst, creditLedger } = await import('@/lib/db');
            const { eq: eqOp, sum } = await import('drizzle-orm');
            const [result] = await dbInst.select({ total: sum(creditLedger.amount) })
              .from(creditLedger).where(eqOp(creditLedger.company_id, task.company_id));
            return `${runId}: Credit balance — total granted/consumed: ${result?.total ?? 0} credits`;
          }
          case 'analytics:tasks': {
            const { db: dbInst, tasks: tasksTable } = await import('@/lib/db');
            const { eq: eqOp } = await import('drizzle-orm');
            const allTasks = await dbInst.select({ status: tasksTable.status })
              .from(tasksTable).where(eqOp(tasksTable.company_id, task.company_id));
            const counts = allTasks.reduce((acc, t) => {
              const key = t.status ?? 'unknown';
              acc[key] = (acc[key] ?? 0) + 1;
              return acc;
            }, {} as Record<string, number>);
            return `${runId}: Task stats — ${Object.entries(counts).map(([s, n]) => `${s}: ${n}`).join(', ')}`;
          }
          default:
            return `${runId}: Script "${scriptName}" queued. Run get_script_output("${runId}") in a moment to check results.`;
        }
      } catch (err) {
        return `Script "${scriptName}" failed: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    case 'get_script_output': {
      const runId = toolInput.run_id as string;
      // Scripts that execute inline return their result immediately; async scripts would be polled here
      return `Script run "${runId}" — inline scripts return output immediately from run_script. If you see this, the script is asynchronous and not yet implemented as a polling job.`;
    }

    // ── dashboard: founder-visible links ──
    case 'add_dashboard_link': {
      try {
        const { db: dbInst, dashboardLinks } = await import('@/lib/db');
        const { eq: eqOp, and: andOp } = await import('drizzle-orm');
        const linkType = (toolInput.link_type as string) ?? 'other';
        // Check for existing link with same label (unique constraint)
        const existing = await dbInst.select({ id: dashboardLinks.id })
          .from(dashboardLinks)
          .where(andOp(
            eqOp(dashboardLinks.company_id, task.company_id),
            eqOp(dashboardLinks.label, toolInput.label as string)
          ))
          .limit(1);
        if (existing.length > 0) {
          // Update URL and icon for matching label
          await dbInst.update(dashboardLinks)
            .set({ url: toolInput.url as string, icon: linkType })
            .where(eqOp(dashboardLinks.id, existing[0].id));
          return `✅ Dashboard link updated: "${toolInput.label}" → ${toolInput.url}`;
        }
        await dbInst.insert(dashboardLinks).values({
          company_id: task.company_id,
          label: toolInput.label as string,
          url: toolInput.url as string,
          icon: linkType,   // store link_type in icon field
          sort_order: 0,
        });
        return `✅ Dashboard link added: "${toolInput.label}" → ${toolInput.url}\nFounders will see this in their dashboard immediately.`;
      } catch (err) {
        return `Could not add dashboard link: ${err instanceof Error ? err.message : 'Unknown'}`;
      }
    }

    case 'get_dashboard_links': {
      try {
        const { db: dbInst, dashboardLinks } = await import('@/lib/db');
        const { eq: eqOp } = await import('drizzle-orm');
        const links = await dbInst.select({
          label: dashboardLinks.label,
          url: dashboardLinks.url,
          icon: dashboardLinks.icon,
          sort_order: dashboardLinks.sort_order,
        }).from(dashboardLinks).where(eqOp(dashboardLinks.company_id, task.company_id));
        if (!links.length) return 'No dashboard links yet. Use add_dashboard_link to add the first one.';
        return `## Dashboard Links (${links.length})\n${links.map(l => `- **${l.label}** [${l.icon ?? 'other'}] — ${l.url}`).join('\n')}`;
      } catch (err) {
        return `Could not get dashboard links: ${err instanceof Error ? err.message : 'Unknown'}`;
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

    case 'send_company_email': {
      const { db, companies } = await import('@/lib/db');
      const { eq } = await import('drizzle-orm');
      const { sendEmail } = await import('@/lib/services/email.service');
      try {
        // Fetch the company's verified outbound address (set during onboarding,
        // e.g. {slug}@baljia.app). Fall back to support@baljia.app if missing.
        const [row] = await db
          .select({ company_email: companies.company_email })
          .from(companies)
          .where(eq(companies.id, task.company_id))
          .limit(1);
        const fromAddress = row?.company_email || 'support@baljia.app';

        const { messageId } = await sendEmail({
          to: toolInput.to as string,
          from: fromAddress,
          subject: toolInput.subject as string,
          textBody: toolInput.body as string,
          companyId: task.company_id,
          threadId: (toolInput.reply_to_thread_id as string) ?? undefined,
        });
        return `Email sent from ${fromAddress} to ${toolInput.to}: "${toolInput.subject}" (messageId: ${messageId})`;
      } catch (err) {
        return `Failed to send email: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
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
  // Skills layer — MANDATORY first calls per agent prompt rule 1
  // (Bug: these were missing from the dispatch set, causing "Unknown tool"
  // responses even though the tool DEFINITIONS were registered. The agent
  // saw the tools in its tool list, called them, and our dispatcher didn't
  // route them to handleEngineeringTool. Production failure on
  // task 9a36e013-...-cd26 was the symptom.)
  'list_skills', 'read_skill',
  // GitHub (source control)
  'github_create_repo', 'github_push_file', 'github_read_file',
  'github_list_files', 'github_delete_file',
  'github_create_branch', 'github_create_pr',
  'github_search_code', 'github_create_commit',
  // Render — primary founder app deploy target
  'render_create_service', 'render_deploy', 'render_get_service',
  'render_get_deploy_status', 'render_get_logs', 'render_rollback',
  'render_delete_service', 'render_list_services', 'render_get_metrics',
  'render_list_databases',
  // Company + domain
  'get_company_tech',
  'attach_custom_domain', 'verify_custom_domain',
  // Health & safety
  'check_url_health',
  // Database infrastructure (Neon)
  'provision_database', 'get_database_info', 'run_migration', 'query_company_db',
  // Stripe payments (founder's product)
  'stripe_create_product', 'stripe_create_price', 'stripe_create_payment_link', 'stripe_get_products',
]);

const BROWSER_TOOLS = new Set([
  'browser_navigate', 'browser_screenshot', 'browser_click', 'browser_fill',
  'browser_extract', 'browser_get_content', 'browser_evaluate',
  'get_site_tier', 'save_credentials', 'get_credentials',
  // Browser auth tools
  'generate_password', 'get_company_email', 'check_verification_inbox',
  'verify_credentials', 'list_stored_credentials',
  'get_or_create_browser_context', 'list_browser_contexts', 'delete_browser_context',
  // Domain skills memory
  'record_domain_skill', 'read_domain_skills',
  // Provider bootstrap packs
  'list_provider_packs', 'start_provider_pack',
  // OCR (Tesseract.js)
  'ocr_current_page', 'ocr_click_text', 'ocr_image',
  // Cheap HTTP fetch (skip Browserbase)
  'http_fetch',
]);

const RESEARCH_TOOLS = new Set([
  'web_search', 'web_extract', 'competitor_analysis', 'industry_trends',
]);

const DATA_TOOLS = new Set([
  'query_database', 'inspect_schema', 'get_metrics', 'analyze_trends',
  // Founder's product DB (shared with Engineering)
  'query_company_db', 'get_database_info', 'get_company_tech', 'render_get_logs',
]);

const SUPPORT_TOOLS = new Set([
  'get_inbox', 'send_email', 'get_email_thread', 'wait_for_email',
  'escalate_to_owner', 'escalate_to_engineering', 'get_contacts', 'add_contact',
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
  // Video creative tools
  'upload_ad_video', 'create_video_creative', 'save_ad', 'add_captions',
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

export interface AgentInput {
  task: Task;
  agentId: number;
  agentName: string;
  watchdog: Watchdog;
  execution: TaskExecution;
  /** Typed context packet assembled by worker-launcher (SPEC-CTRL-105) */
  contextPacket?: import('@/types').ContextPacket;
  /** Permission envelope locked at dispatch (SPEC-CTRL-105) */
  permissionSnapshot?: import('@/types').PermissionSnapshot;
}

export interface AgentResult {
  turnCount: number;
  log: Record<string, unknown>[];
}

// ══════════════════════════════════════════════
// AGENT LOOP CONFIG — parameterizes model + turn cap
// Used by all 3 execution modes (deterministic, template, full_agent)
// ══════════════════════════════════════════════

export interface AgentLoopConfig {
  /** Claude model ID to use (e.g. Sonnet for full_agent, Haiku for deterministic/template) */
  claudeModel: string;
  /** OpenAI model ID for second fallback (defaults to gpt-4o) */
  openAIModel?: string;
  /** OpenRouter model ID for third fallback (defaults to qwen-plus) */
  openRouterModel?: string;
  /** Gemini model ID for fourth fallback (defaults to gemini-2.5-flash) */
  geminiModel?: string;
  /** Max turns for this execution (overrides task.max_turns) */
  maxTurns: number;
  /** Optional system prompt override (prepended to briefing) */
  systemPromptOverride?: string;
}

/**
 * Core agent loop — shared by all execution modes.
 * executeAgent, executeTemplate, and executeDeterministic are thin wrappers around this.
 */
export async function runAgentLoop(input: AgentInput, config: AgentLoopConfig): Promise<AgentResult> {
  const { task, agentId, watchdog, contextPacket } = input;
  const { claudeModel, maxTurns } = config;

  // Override watchdog max turns to match config
  watchdog.setMaxTurns(maxTurns);

  const baseBriefing = await assembleBriefing(task, agentId, contextPacket);
  const systemPrompt = config.systemPromptOverride
    ? `${config.systemPromptOverride}\n\n---\n\n${baseBriefing}`
    : baseBriefing;
  const tools = getAgentTools(agentId);
  const logEntries: Record<string, unknown>[] = [];

  // Provider-ordered fallback: respects PRIMARY_LLM_PROVIDER env var
  // Default: OpenAI → Claude → OpenRouter → Gemini
  const oaiModel = config.openAIModel ?? OPENAI_MODELS.GPT_4O;
  const orModel = config.openRouterModel ?? OPENROUTER_MODELS.FULL_AGENT;
  const gemModel = config.geminiModel ?? GEMINI_MODEL;

  type RunFn = () => Promise<AgentResult>;
  const providers: { name: string; available: () => boolean; run: RunFn }[] = [
    { name: 'openai',     available: isOpenAIAvailable,     run: () => runWithOpenAI(systemPrompt, tools, task, agentId, watchdog, logEntries, oaiModel) },
    { name: 'anthropic',  available: isAnthropicAvailable,  run: () => runWithClaude(systemPrompt, tools, task, agentId, watchdog, logEntries, claudeModel) },
    { name: 'openrouter', available: isOpenRouterAvailable, run: () => runWithOpenRouter(systemPrompt, tools, task, agentId, watchdog, logEntries, orModel) },
    { name: 'gemini',     available: isGeminiAvailable,     run: () => runWithGemini(systemPrompt, tools, task, agentId, watchdog, logEntries, gemModel) },
  ];

  // Sort by preferred provider order
  const preferred = getPreferredProvider();
  const preferredProvider = providers.find(p => p.name === preferred);
  const sorted = preferredProvider
    ? [preferredProvider, ...providers.filter(p => p.name !== preferred)]
    : providers;

  let lastError: unknown;
  const providerFailures: string[] = [];
  for (const p of sorted) {
    if (!p.available()) continue;
    const logCountBeforeProvider = logEntries.length;
    try {
      return await p.run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      providerFailures.push(`${p.name}: ${message}`);
      if (logEntries.length > logCountBeforeProvider) {
        pushLog(logEntries, {
          event: 'provider_failed_after_progress',
          provider: p.name,
          error: message,
        });
        throw err;
      }
      log.warn(`${p.name} failed, trying next provider`, { taskId: task.id, error: message.slice(0, 300) });
      lastError = err;
    }
  }

  if (providerFailures.length > 0) {
    throw new Error(`All available LLM providers failed: ${providerFailures.join(' | ')}`);
  }
  throw lastError ?? new Error('No LLM provider available');
}

/**
 * Full agent execution — Sonnet model, full turn budget.
 * This is the default execution mode for complex tasks.
 * All agents use GPT-5.4 when falling back to OpenAI.
 */
export async function executeAgent(input: AgentInput): Promise<AgentResult> {
  return runAgentLoop(input, {
    claudeModel: CLAUDE_MODEL_SONNET,
    maxTurns: input.task.max_turns,
    openAIModel: OPENAI_MODELS.GPT_5_4,
  });
}

// ── Helper to redact Postgres URIs in logs ──
function pushLog(logs: Record<string, unknown>[], entry: Record<string, unknown>) {
  const redacted = JSON.parse(JSON.stringify(entry, (key, value) => {
    if (typeof value === 'string') {
      return value.replace(/postgres(?:ql)?:\/\/[^:]+:[^@]+@/gi, 'postgres://***:***@');
    }
    return value;
  }));
  logs.push(redacted);
}

// ── Claude execution ──

async function runWithClaude(
  systemPrompt: string,
  tools: ReturnType<typeof getAgentTools>,
  task: Task,
  agentId: number,
  watchdog: Watchdog,
  log_entries: Record<string, unknown>[],
  modelId: string = CLAUDE_MODEL_SONNET,
): Promise<AgentResult> {
  let anthropic: Anthropic | null = null;
  let isOAuth = false;
  // Order: Claude Code OAuth → direct API key → Bedrock API key → Bedrock IAM.
  // OAuth piggybacks on the operator's Pro/Max subscription; preferred in
  // dev (no extra creds) and in prod (no per-call billing surprise).
  if (isAnthropicOAuthAvailable()) {
    const oauthClient = await createAnthropicWithOAuthAsync();
    if (oauthClient.isOAuth) {
      anthropic = oauthClient.client;
      isOAuth = true;
    }
  }
  if (!anthropic && isDirectAnthropicAvailable()) {
    anthropic = new Anthropic();
  } else if (!anthropic && isBedrockAvailable()) {
    const AnthropicBedrock = require('@anthropic-ai/bedrock-sdk').default;
    const region = process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1';
    const apiKey = process.env.AWS_BEDROCK_API_KEY;
    // Use Bearer-auth long-term API key (ABSK... format) instead of AWS SigV4.
    if (apiKey && apiKey.startsWith('ABSK')) {
      anthropic = new AnthropicBedrock({
        awsRegion: region,
        baseURL: `https://bedrock-runtime.${region}.amazonaws.com`,
        defaultHeaders: { Authorization: `Bearer ${apiKey}` },
        skipAuth: true,
      }) as unknown as Anthropic;
    } else {
      anthropic = new AnthropicBedrock({ awsRegion: region }) as unknown as Anthropic;
    }
    if (modelId === CLAUDE_MODEL_SONNET) modelId = process.env.AWS_BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-20250514-v1:0';
    if (modelId === CLAUDE_MODEL_HAIKU) modelId = process.env.AWS_BEDROCK_HAIKU_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
  } else if (!anthropic) {
    anthropic = new Anthropic();
  }
  if (!anthropic) throw new Error('Anthropic client unavailable');

  // For full_agent engineering tasks: force immediate tool use in the first turn.
  // A text-only "planning" response on turn 1 causes the loop to break on turn 2
  // (toolUseBlocks.length === 0 → break). This message explicitly demands the
  // first tool call so the agent cannot coast with a written plan.
  const isEngineeringFullAgent = agentId === 30 && (task.execution_mode === 'full_agent' || !task.execution_mode);
  const firstUserMessage = isEngineeringFullAgent
    ? `Execute your task now. Your FIRST action must be a tool call — call list_skills immediately. Do NOT write a plan or summary first. Call list_skills now.`
    : `Execute the task described in your briefing. Begin.`;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: firstUserMessage },
  ];

  let turnCount = 0;

  while (true) {
    // 2A-3: Pre-turn watchdog health check (idle/stuck detection)
    const healthVerdict = watchdog.checkHealth();
    if (healthVerdict === 'kill') {
      pushLog(log_entries, { turn: turnCount + 1, event: 'watchdog_health_kill', reason: 'idle/stuck detected' });
      break;
    }

    // G-LLM-001: Timeout + retry on Claude API calls
    const response = await callAnthropicWithTimeout(
      anthropic,
      {
        model: modelId,
        max_tokens: getAgentMaxTokens(agentId),
        // OAuth path requires the Claude Code identity prefix as the first
        // system text block; non-OAuth path passes the prompt as-is.
        system: withClaudeCodeIdentity(systemPrompt, isOAuth) as Anthropic.MessageCreateParams['system'],
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        messages,
      },
      { label: `agent_turn_${turnCount + 1}`, timeoutMs: getAgentCallTimeoutMs(agentId) }
    ) as Anthropic.Message;

    turnCount++;

    // Watchdog turn check (turn count + absolute time)
    const verdict = watchdog.recordTurn(null);
    if (verdict === 'kill') {
      pushLog(log_entries, { turn: turnCount, event: 'watchdog_kill', reason: 'turn/time limit' });
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
      // G-CONTENT-002: Moderate agent output
      const outputText = textBlock?.text ?? '';
      const modResult = moderateOutput(outputText);
      if (modResult.blocked) {
        log.warn('Agent output contained blocked content', { taskId: task.id, warnings: modResult.warnings });
      }
      pushLog(log_entries, { turn: turnCount, event: 'completed', summary: modResult.sanitized.substring(0, 500) });
      break;
    }

    // Execute tools and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let loopKill = false;
    for (const toolBlock of toolUseBlocks) {
      // H-AGENT-020: Loop detection — track each tool call
      const loopVerdict = watchdog.recordToolCall(toolBlock.name);
      if (loopVerdict === 'kill') {
        pushLog(log_entries, { turn: turnCount, event: 'loop_kill', tool: toolBlock.name, reason: 'Repeated tool-call loop detected' });
        loopKill = true;
        break;
      }

      const result = await handleToolCall(
        toolBlock.name,
        toolBlock.input as Record<string, unknown>,
        task,
        agentId,
      );
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: result,
      });
      pushLog(log_entries, { turn: turnCount, tool: toolBlock.name, input: toolBlock.input, result });
    }

    if (loopKill) break;

    messages.push({ role: 'user', content: toolResults });

    // Check stop reason
    if (response.stop_reason === 'end_turn') {
      pushLog(log_entries, { turn: turnCount, event: 'end_turn' });
      break;
    }
  }

  return { turnCount, log: log_entries };
}

// ── OpenAI execution (Codex OAuth or OPENAI_API_KEY) ──

async function runWithOpenAI(
  systemPrompt: string,
  tools: ReturnType<typeof getAgentTools>,
  task: Task,
  agentId: number,
  watchdog: Watchdog,
  log_entries: Record<string, unknown>[],
  modelId: string = OPENAI_MODELS.GPT_4O,
): Promise<AgentResult> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error('No OpenAI API key available');

  // Codex OAuth JWTs cannot hit api.openai.com — they go through chatgpt.com/backend-api.
  // Branch to the pi-ai-based Codex tool loop. Detect 3-part JWT starting with `eyJ`.
  const isCodexJwt = apiKey.startsWith('eyJ') && apiKey.split('.').length === 3;
  if (isCodexJwt) {
    return runWithCodex(systemPrompt, tools, task, agentId, watchdog, log_entries, apiKey);
  }

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });

  const openaiTools = tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Execute the task described in your briefing. Begin.' },
  ];

  let turnCount = 0;

  while (true) {
    const healthVerdict = watchdog.checkHealth();
    if (healthVerdict === 'kill') {
      pushLog(log_entries, { turn: turnCount + 1, event: 'watchdog_health_kill', reason: 'idle/stuck detected' });
      break;
    }

    const response = await client.chat.completions.create(
      {
        model: modelId,
        messages: messages as Parameters<typeof client.chat.completions.create>[0]['messages'],
        tools: openaiTools,
        max_tokens: getAgentMaxTokens(agentId),
      },
      { timeout: getAgentCallTimeoutMs(agentId) }
    );

    turnCount++;

    const verdict = watchdog.recordTurn(null);
    if (verdict === 'kill') {
      pushLog(log_entries, { turn: turnCount, event: 'watchdog_kill', reason: 'turn/time limit' });
      break;
    }

    const choice = response.choices[0];
    if (!choice) break;

    const assistantMessage = choice.message;
    const toolCalls = assistantMessage.tool_calls;

    messages.push(assistantMessage as any);

    if (!toolCalls || toolCalls.length === 0) {
      pushLog(log_entries, { turn: turnCount, event: 'completed', summary: (assistantMessage.content ?? '').substring(0, 500) });
      break;
    }

    let loopKill = false;
    for (const tc of toolCalls) {
      if (!('function' in tc)) continue; // skip non-standard tool call types
      const fnName = tc.function.name;
      const loopVerdict = watchdog.recordToolCall(fnName);
      if (loopVerdict === 'kill') {
        pushLog(log_entries, { turn: turnCount, event: 'loop_kill', tool: fnName, reason: 'Repeated tool-call loop detected' });
        loopKill = true;
        break;
      }

      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }

      const toolResult = await handleToolCall(fnName, args, task, agentId);
      pushLog(log_entries, { turn: turnCount, tool: fnName, input: args, result: toolResult });

      messages.push({ role: 'tool', content: toolResult, tool_call_id: tc.id });
    }

    if (loopKill) break;
  }

  return { turnCount, log: log_entries };
}

// ── Codex execution (via pi-ai → chatgpt.com/backend-api) ──
//
// Used when getOpenAIApiKey() returns a Codex OAuth JWT. The OpenAI SDK can't
// talk to ChatGPT's backend, so we use pi-ai's Codex Responses provider. Same
// agent loop semantics as runWithClaude/runWithOpenAI: turn budget, watchdog,
// per-tool loop detection, multi-turn with tool results.

async function runWithCodex(
  systemPrompt: string,
  tools: ReturnType<typeof getAgentTools>,
  task: Task,
  agentId: number,
  watchdog: Watchdog,
  log_entries: Record<string, unknown>[],
  apiKey: string,
): Promise<AgentResult> {
  const { runCodexAgentTurn } = await import('@/lib/llm-provider');

  const codexTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Record<string, unknown>,
  }));

  const messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_name?: string; raw?: unknown }> = [
    { role: 'user', content: 'Execute the task described in your briefing. Begin.' },
  ];

  let turnCount = 0;
  while (true) {
    const healthVerdict = watchdog.checkHealth();
    if (healthVerdict === 'kill') {
      pushLog(log_entries, { turn: turnCount + 1, event: 'watchdog_health_kill', reason: 'idle/stuck detected' });
      break;
    }

    const turn = await runCodexAgentTurn({
      apiKey,
      systemPrompt,
      messages,
      tools: codexTools,
      maxTokens: getAgentMaxTokens(agentId),
      reasoning: 'medium',
      signal: AbortSignal.timeout(getAgentCallTimeoutMs(agentId)),
    });

    turnCount++;

    const turnVerdict = watchdog.recordTurn(null);
    if (turnVerdict === 'kill') {
      pushLog(log_entries, { turn: turnCount, event: 'watchdog_kill', reason: 'turn/time limit' });
      break;
    }

    // CRITICAL: push the raw pi-ai AssistantMessage (which embeds toolCalls with
    // their call_ids) back into history. Otherwise next turn's tool-result
    // messages can't be paired with the originating call → 400 error.
    if (turn.rawAssistantMessage) {
      messages.push({ role: 'assistant', content: turn.text, raw: turn.rawAssistantMessage });
    } else if (turn.text) {
      messages.push({ role: 'assistant', content: turn.text });
    }

    if (turn.toolCalls.length === 0) {
      pushLog(log_entries, { turn: turnCount, event: 'completed', summary: turn.text.substring(0, 500) });
      break;
    }

    let loopKill = false;
    for (const tc of turn.toolCalls) {
      const loopVerdict = watchdog.recordToolCall(tc.name);
      if (loopVerdict === 'kill') {
        pushLog(log_entries, { turn: turnCount, event: 'loop_kill', tool: tc.name, reason: 'Repeated tool-call loop detected' });
        loopKill = true;
        break;
      }

      const toolResult = await handleToolCall(tc.name, tc.arguments, task, agentId);
      pushLog(log_entries, { turn: turnCount, tool: tc.name, input: tc.arguments, result: toolResult });

      messages.push({ role: 'tool', content: toolResult, tool_call_id: tc.id, tool_name: tc.name });
    }

    if (loopKill) break;
  }

  return { turnCount, log: log_entries };
}

// ── Gemini execution ──

async function runWithGemini(
  systemPrompt: string,
  tools: ReturnType<typeof getAgentTools>,
  task: Task,
  agentId: number,
  watchdog: Watchdog,
  log_entries: Record<string, unknown>[],
  modelId: string = GEMINI_MODEL,
): Promise<AgentResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);

  // Gemini's function_declarations format rejects `additionalProperties`
  // anywhere in the schema (it's valid JSON Schema and works for OpenAI/Anthropic
  // but not Gemini). Strip it recursively before sending. Properties whose
  // schema had additionalProperties become free-form objects in Gemini's view —
  // the agent can still populate them, just without structural hints.
  function sanitizeForGemini(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object') return schema;
    if (Array.isArray(schema)) return schema.map(sanitizeForGemini);
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (key === 'additionalProperties') continue;
      cleaned[key] = sanitizeForGemini(value);
    }
    return cleaned;
  }

  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: sanitizeForGemini(t.input_schema),
    })) as any }],
  });

  const chat = model.startChat({
    history: [],
  });

  let turnCount = 0;
  let currentMessage = 'Execute the task described in your briefing. Begin.';

  while (true) {
    // 2A-3: Pre-turn watchdog health check (idle/stuck detection)
    const healthVerdict = watchdog.checkHealth();
    if (healthVerdict === 'kill') {
      pushLog(log_entries, { turn: turnCount + 1, event: 'watchdog_health_kill', reason: 'idle/stuck detected' });
      break;
    }

    // G-LLM-001: Timeout + retry on Gemini API calls
    const result = await callGeminiWithTimeout(
      () => chat.sendMessage(currentMessage),
      { label: `gemini_turn_${turnCount + 1}`, timeoutMs: getAgentCallTimeoutMs(agentId) }
    ) as { response: { candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>; text: () => string } };
    turnCount++;

    const verdict = watchdog.recordTurn(null);
    if (verdict === 'kill') {
      pushLog(log_entries, { turn: turnCount, event: 'watchdog_kill', reason: 'turn/time limit' });
      break;
    }

    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts ?? [];

    // Check for function calls
    const functionCalls = parts.filter((p) => 'functionCall' in p);

    if (functionCalls.length === 0) {
      // Done
      const text = response.text();
      pushLog(log_entries, { turn: turnCount, event: 'completed', summary: text.substring(0, 500) });
      break;
    }

    // Execute function calls
    const functionResponses: Array<{ functionResponse: { name: string; response: { result: string } } }> = [];
    let geminiLoopKill = false;

    for (const part of functionCalls) {
      if ('functionCall' in part && part.functionCall) {
        const fc = part.functionCall as { name?: string; args?: Record<string, unknown> };
        if (!fc.name) continue;

        // H-AGENT-020: Loop detection — track each tool call
        const loopVerdict = watchdog.recordToolCall(fc.name);
        if (loopVerdict === 'kill') {
          pushLog(log_entries, { turn: turnCount, event: 'loop_kill', tool: fc.name, reason: 'Repeated tool-call loop detected' });
          geminiLoopKill = true;
          break;
        }

        const toolResult = await handleToolCall(
          fc.name,
          (fc.args ?? {}) as Record<string, unknown>,
          task,
          agentId,
        );
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: { result: toolResult },
          },
        });
        pushLog(log_entries, { turn: turnCount, tool: fc.name, input: fc.args, result: toolResult });
      }
    }

    if (geminiLoopKill) break;

    // H-AGENT-009/010: Send proper function response parts (not JSON string)
    // Gemini SDK expects an array of FunctionResponsePart objects
    currentMessage = functionResponses as any;
  }

  return { turnCount, log: log_entries };
}

// ── OpenRouter execution (GLM-4, Qwen, etc.) ──

async function runWithOpenRouter(
  systemPrompt: string,
  tools: ReturnType<typeof getAgentTools>,
  task: Task,
  agentId: number,
  watchdog: Watchdog,
  log_entries: Record<string, unknown>[],
  modelId: string = OPENROUTER_MODELS.FULL_AGENT,
): Promise<AgentResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    defaultHeaders: {
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://baljia.ai',
      'X-Title': 'Baljia AI',
    },
  });

  // Convert Anthropic-style tool defs to OpenAI function format
  const openaiTools = tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Execute the task described in your briefing. Begin.' },
  ];

  let turnCount = 0;

  while (true) {
    // Pre-turn watchdog health check
    const healthVerdict = watchdog.checkHealth();
    if (healthVerdict === 'kill') {
      pushLog(log_entries, { turn: turnCount + 1, event: 'watchdog_health_kill', reason: 'idle/stuck detected' });
      break;
    }

    const response = await callOpenRouterWithTimeout(
      async (signal) => {
        return client.chat.completions.create(
          {
            model: modelId,
            messages: messages as Parameters<typeof client.chat.completions.create>[0]['messages'],
            tools: openaiTools,
            max_tokens: getAgentMaxTokens(agentId),
          },
          { signal }
        );
      },
      { label: `openrouter_${modelId}_turn_${turnCount + 1}`, timeoutMs: getAgentCallTimeoutMs(agentId) }
    ) as { choices: Array<{ message: { role: string; content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };

    turnCount++;

    const verdict = watchdog.recordTurn(null);
    if (verdict === 'kill') {
      pushLog(log_entries, { turn: turnCount, event: 'watchdog_kill', reason: 'turn/time limit' });
      break;
    }

    const choice = response.choices[0];
    if (!choice) break;

    const assistantMessage = choice.message;
    const toolCalls = assistantMessage.tool_calls;

    // Add assistant message to conversation
    messages.push(assistantMessage as any);

    if (!toolCalls || toolCalls.length === 0) {
      // No tool calls — agent is done
      pushLog(log_entries, { turn: turnCount, event: 'completed', summary: (assistantMessage.content ?? '').substring(0, 500) });
      break;
    }

    // Execute tool calls
    let loopKill = false;
    for (const tc of toolCalls) {
      const fnName = tc.function.name;

      // Loop detection
      const loopVerdict = watchdog.recordToolCall(fnName);
      if (loopVerdict === 'kill') {
        pushLog(log_entries, { turn: turnCount, event: 'loop_kill', tool: fnName, reason: 'Repeated tool-call loop detected' });
        loopKill = true;
        break;
      }

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }

      const toolResult = await handleToolCall(fnName, args, task, agentId);
      pushLog(log_entries, { turn: turnCount, tool: fnName, input: args, result: toolResult });

      // Add tool response to conversation
      messages.push({
        role: 'tool',
        content: toolResult,
        tool_call_id: tc.id,
      });
    }

    if (loopKill) break;
  }

  return { turnCount, log: log_entries };
}
