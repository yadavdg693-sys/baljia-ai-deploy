// CEO Tool Definitions — 40 tools (39 base + 1 extra)
// Anthropic-compatible tool schemas

// ── Group 1: Capabilities (6 tools) ──

const CAPABILITIES_TOOLS = [
  {
    name: 'list_available_modules',
    description: 'List all platform modules/agents and their current status.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_module_capabilities',
    description: 'Get detailed info about a specific module: what it does, its tools, and limits.',
    input_schema: {
      type: 'object' as const,
      properties: {
        module_name: { type: 'string' as const, description: 'Module name (e.g. "engineering", "browser", "meta_ads")' },
      },
      required: ['module_name'],
    },
  },
  {
    name: 'list_mcp_servers',
    description: 'List all connected platform servers/integrations and their current status.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'list_available_agents',
    description: 'List all task-driven worker agents with their IDs, roles, and max turns.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_agent_capabilities',
    description: 'Get detailed info about a specific agent: tools, rules, what it can/cannot do.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string' as const, description: 'Agent name or ID (e.g. "engineering", "30", "browser")' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'find_agent_for_task',
    description: 'Match a task description to the best agent. Returns recommended agent, confidence, and reasoning.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_description: { type: 'string' as const, description: 'Description of the work to be done' },
        tag: { type: 'string' as const, description: 'Optional task tag for routing hints' },
      },
      required: ['task_description'],
    },
  },
];

// ── Group 2: Tasks (13 tools) ──

const TASK_TOOLS = [
  {
    name: 'get_tasks',
    description: 'Get the task backlog grouped by status. Shows pending, in progress, and completed work.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'create_task',
    description: 'Create ONE task — max 4 hours of work per call. If the scope is bigger, do NOT bundle: call create_task once per piece in dependency order, linking sequential pieces via related_task_ids. The server rejects estimated_hours > 4. Routes to the right agent based on tag. Credits deducted when execution starts. Most tasks cost 1 credit; heavy Browser-agent tasks (complexity ≥ 7 with browser tag) cost 2 credits. Task needs founder approval before execution.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Clear, action-oriented task title' },
        description: { type: 'string' as const, description: 'Detailed description of what should be done. Worker reads ONLY this — include core flow, features, success criteria, out-of-scope.' },
        tag: { type: 'string' as const, description: 'Task category (e.g. landing-page, research, api, tweet, outreach, scrape, account-setup)' },
        complexity: { type: 'number' as const, description: 'Task complexity 1-10. 1-3 = trivial (single API call, status check). 4-6 = typical (login + form fill, single-page scrape). 7-10 = heavy (full SaaS signup with verification, multi-step flows, anti-bot-heavy sites). Drives credit cost for Browser-routed tasks.' },
        estimated_hours: { type: 'number' as const, description: 'Honest one-shot agent work estimate in decimal hours. Range 0.5–4. The server REJECTS values > 4 — for bigger scope you MUST split into multiple create_task calls. Guide: trivial API check = 0.5; single-page scrape or short content = 1; typical CRUD page = 2–3; full feature slice with API + UI + persistence = 4 (and nothing more in one task).' },
        priority: { type: 'string' as const, enum: ['low', 'medium', 'high', 'critical'], description: 'Queue priority. Defaults to medium. Use critical only for fixes that block other work or live-site outages.' },
        related_task_ids: { type: 'array' as const, items: { type: 'string' as const }, description: 'IDs of related tasks. Use for: (a) retries — link the failed task so the agent knows what was already tried; (b) sequential pieces of a split — link the upstream task this one depends on.' },
      },
      required: ['title', 'description', 'tag', 'complexity', 'estimated_hours'],
    },
  },
  {
    name: 'reject_task',
    description: 'Reject or archive a task the founder no longer wants.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'Task UUID' },
        reason: { type: 'string' as const, description: 'Why the task is being rejected' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'get_task_details',
    description: 'Get full details on a specific task: status, credits, agent, timestamps, logs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'Task UUID' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'edit_task',
    description: 'Update a task\'s title, description, priority, or tag. Only works on tasks not yet in progress.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'Task UUID' },
        title: { type: 'string' as const, description: 'New title (optional)' },
        description: { type: 'string' as const, description: 'New description (optional)' },
        priority: { type: 'number' as const, description: 'New priority 1-100 (optional)' },
        tag: { type: 'string' as const, description: 'New tag (optional)' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'get_task_run_link',
    description: 'Generate a magic one-click link to run a specific task instantly.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'Task UUID' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'get_task_execution_status',
    description: 'Check if a specific task is currently running and its progress.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'Task UUID' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'approve_task',
    description: 'Approve a proposed task for execution. This assigns an agent and moves it to the queue.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'Task UUID to approve' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'get_task_execution_logs',
    description: 'View the step-by-step execution log of a completed or running task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'Task UUID' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'get_active_executions',
    description: 'List all currently running agent executions across the company.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'find_best_agent',
    description: 'Search historical outcomes to find the best agent for a type of work. Returns confidence, success rates, and warnings.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Description of the work type' },
      },
      required: ['query'],
    },
  },
  {
    name: 'reorder_task',
    description: 'Change a task\'s position in the queue.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'Task UUID' },
        position: { type: 'number' as const, description: 'New queue position (1 = first)' },
      },
      required: ['task_id', 'position'],
    },
  },
  {
    name: 'move_task_to_top',
    description: 'Move a task to the front of the queue so it runs next.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'Task UUID' },
      },
      required: ['task_id'],
    },
  },
];

// ── Group 3: Recurring Tasks (4 tools) ──

const RECURRING_TOOLS = [
  {
    name: 'get_recurring_tasks',
    description: 'List all scheduled recurring task automations with cadence and credit estimates.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'create_recurring_task',
    description: 'Set up a new recurring task (daily, weekly, biweekly, monthly). Each run costs 1 credit.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Task title' },
        description: { type: 'string' as const, description: 'Task description' },
        tag: { type: 'string' as const, description: 'Task category tag' },
        cadence: { type: 'string' as const, description: 'Schedule: daily, weekly, biweekly, monthly' },
      },
      required: ['title', 'description', 'tag', 'cadence'],
    },
  },
  {
    name: 'update_recurring_task',
    description: 'Update a recurring task: change cadence, pause, or resume.',
    input_schema: {
      type: 'object' as const,
      properties: {
        recurring_id: { type: 'string' as const, description: 'Recurring task UUID' },
        cadence: { type: 'string' as const, description: 'New cadence (optional)' },
        paused: { type: 'boolean' as const, description: 'Pause (true) or resume (false)' },
        title: { type: 'string' as const, description: 'New title (optional)' },
        description: { type: 'string' as const, description: 'New description (optional)' },
      },
      required: ['recurring_id'],
    },
  },
  {
    name: 'delete_recurring_task',
    description: 'Permanently remove a recurring task schedule.',
    input_schema: {
      type: 'object' as const,
      properties: {
        recurring_id: { type: 'string' as const, description: 'Recurring task UUID' },
      },
      required: ['recurring_id'],
    },
  },
];

// ── Group 4: Company (10 tools) ──

const COMPANY_TOOLS = [
  {
    name: 'get_context',
    description: 'Get full company context: info, subscription, infrastructure, documents summary, ad status.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'query_reports',
    description: 'Search saved analytics and execution reports by type or keyword.',
    input_schema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string' as const, description: 'Search keyword (optional)' },
        report_type: { type: 'string' as const, description: 'Filter: research, analytics, execution, strategy (optional)' },
        limit: { type: 'number' as const, description: 'Max results (default: 10)' },
      },
    },
  },
  {
    name: 'get_document',
    description: 'Read the full content of a company document (mission, product_overview, brand_voice, tech_notes, market_research).',
    input_schema: {
      type: 'object' as const,
      properties: {
        doc_type: { type: 'string' as const, description: 'Document type to read' },
      },
      required: ['doc_type'],
    },
  },
  {
    name: 'update_document',
    description: 'Edit a company document. Founder will see the update for review.',
    input_schema: {
      type: 'object' as const,
      properties: {
        doc_type: { type: 'string' as const, description: 'Document type to update' },
        content: { type: 'string' as const, description: 'New content (markdown)' },
      },
      required: ['doc_type', 'content'],
    },
  },
  {
    name: 'get_emails',
    description: 'Get recent inbound and outbound emails for the company inbox.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' as const, description: 'Max emails (default: 10)' },
        direction: { type: 'string' as const, description: 'Filter: inbound, outbound, all (default: all)' },
      },
    },
  },
  {
    name: 'get_tweets',
    description: 'Get recent tweets posted by or about this company.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' as const, description: 'Max tweets (default: 10)' },
      },
    },
  },
  {
    name: 'get_links',
    description: 'Get dashboard quick links (website, landing page, social profiles, etc.).',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'update_link',
    description: 'Add or update a dashboard quick link.',
    input_schema: {
      type: 'object' as const,
      properties: {
        label: { type: 'string' as const, description: 'Link label (e.g. "Landing Page", "Twitter")' },
        url: { type: 'string' as const, description: 'URL' },
      },
      required: ['label', 'url'],
    },
  },
  {
    name: 'pause_ads',
    description: 'Immediately pause ALL active Meta Ad campaigns. Emergency kill switch for ad spend.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'suggest_feature',
    description: 'Submit a feature request to the Baljia platform team.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Feature title' },
        description: { type: 'string' as const, description: 'What you want and why' },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'read_context_graph',
    description: 'Read context nodes across the company: revenue, active work, support activity, and user context. Returns a structured graph of the company\'s operational state.',
    input_schema: {
      type: 'object' as const,
      properties: {
        nodes: { type: 'array' as const, items: { type: 'string' as const }, description: 'Which nodes to read: revenue, active_work, support, user. Omit to read all.' },
      },
    },
  },
];

// ── Group 5: Research (2 tools) ──

const RESEARCH_TOOLS = [
  {
    name: 'web_search',
    description: 'Search the public web for information. Useful for market research, competitor intel, or fact-checking before giving advice. Always cite source URLs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Search query' },
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
];

// ── Group 6: Platform (1 tool) ──

const PLATFORM_TOOLS = [
  {
    name: 'report_platform_bug',
    description: 'Report a bug or issue with the Baljia platform to the internal team.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Bug title' },
        description: { type: 'string' as const, description: 'Steps to reproduce, expected vs actual' },
        severity: { type: 'string' as const, description: 'low, medium, high, critical' },
      },
      required: ['title', 'description'],
    },
  },
];

// ── Group 7: Memory (2 tools) ──

const MEMORY_TOOLS = [
  {
    name: 'search_memory',
    description: 'Search across all memory layers and learnings for relevant context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_memory',
    description: 'Read the full content of a memory layer. Layers: 1=domain knowledge, 2=user preferences, 3=cross-company patterns.',
    input_schema: {
      type: 'object' as const,
      properties: {
        layer: { type: 'string' as const, enum: ['1', '2', '3'], description: 'Memory layer to read (1=domain, 2=preferences, 3=cross-company)' },
      },
      required: ['layer'],
    },
  },
];

// ── Combined export (37 tools) ──

export const CEO_TOOLS = [
  ...CAPABILITIES_TOOLS,
  ...TASK_TOOLS,
  ...RECURRING_TOOLS,
  ...COMPANY_TOOLS,
  ...RESEARCH_TOOLS,
  ...PLATFORM_TOOLS,
  ...MEMORY_TOOLS,
];

// Extra tools beyond the base 39 — kept separate for clean grouping
export const CEO_EXTRA_TOOLS = [
  {
    name: 'get_credit_balance',
    description: 'Get current credit balance and recent ledger entries.',
    input_schema: { type: 'object' as const, properties: {} },
  },
];


