// CEO Tool Definitions — 36 tools in 6 groups
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
  // list_mcp_servers removed — exposes internal platform integration names/env vars to founder (guardrail)
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
    description: 'Create a new task. Runs governance checks for sizing, credit quoting, and agent routing. Task needs founder approval before execution.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Clear, action-oriented task title' },
        description: { type: 'string' as const, description: 'Detailed description of what should be done' },
        tag: { type: 'string' as const, description: 'Task category (e.g. landing-page, research, api, tweet, outreach)' },
      },
      required: ['title', 'description', 'tag'],
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
];

// ── Group 5: Research (1 tool) ──

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
        layer: { type: 'number' as const, enum: [1, 2, 3], description: 'Memory layer to read' },
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

// Also export extras CEO always had
export const CEO_EXTRA_TOOLS = [
  {
    name: 'write_memory',
    description: 'Write to a memory layer. Use to persist important context about the founder or business.',
    input_schema: {
      type: 'object' as const,
      properties: {
        layer: { type: 'number' as const, enum: [1, 2], description: 'Layer to write (1=domain, 2=preferences)' },
        content: { type: 'string' as const, description: 'Content to store' },
      },
      required: ['layer', 'content'],
    },
  },
  {
    name: 'get_credit_balance',
    description: 'Get current credit balance and recent ledger entries.',
    input_schema: { type: 'object' as const, properties: {} },
  },
];

// ── Group 7: Cycle Planning & Task Scoring (6 tools — KG spec) ──

const CYCLE_PLANNING_TOOLS = [
  {
    name: 'get_cycle_context',
    description: 'Get the current work cycle context: stage, active plan, and pending tasks.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'create_cycle_plan',
    description: 'Create a new cycle plan with tasks to execute tonight or this week.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Plan title' },
        tasks: { type: 'array' as const, items: { type: 'string' as const }, description: 'List of task titles to include' },
        notes: { type: 'string' as const, description: 'Optional planner notes' },
      },
      required: ['title', 'tasks'],
    },
  },
  {
    name: 'update_cycle_plan',
    description: 'Update an existing cycle plan — add tasks, change status, or add notes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        plan_id: { type: 'string' as const, description: 'Cycle plan ID to update' },
        tasks: { type: 'array' as const, items: { type: 'string' as const }, description: 'Updated task list' },
        notes: { type: 'string' as const, description: 'Updated notes' },
        status: { type: 'string' as const, enum: ['draft', 'active', 'completed'], description: 'Plan status' },
      },
      required: ['plan_id'],
    },
  },
  {
    name: 'submit_review',
    description: 'Submit a review or retrospective for a completed cycle.',
    input_schema: {
      type: 'object' as const,
      properties: {
        plan_id: { type: 'string' as const, description: 'Cycle plan being reviewed' },
        summary: { type: 'string' as const, description: 'Review summary' },
        wins: { type: 'string' as const, description: 'What went well' },
        blockers: { type: 'string' as const, description: 'What was blocked or failed' },
      },
      required: ['plan_id', 'summary'],
    },
  },
  {
    name: 'score_task',
    description: 'Rate a completed task by quality, speed, and accuracy (1-5 scale).',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'Task ID to score' },
        quality: { type: 'number' as const, description: 'Quality score 1-5' },
        speed: { type: 'number' as const, description: 'Speed score 1-5' },
        accuracy: { type: 'number' as const, description: 'Accuracy score 1-5' },
        notes: { type: 'string' as const, description: 'Optional scoring notes' },
      },
      required: ['task_id', 'quality', 'speed', 'accuracy'],
    },
  },
  {
    name: 'get_unscored_tasks',
    description: 'Get a list of recently completed tasks that have not yet been scored.',
    input_schema: { type: 'object' as const, properties: {} },
  },
];

// ── Group 8: Agent Factory (5 tools — KG spec §3.1) ──
// Platform-internal: used by CEO/onboarding for agent introspection and dynamic agent creation

const AGENT_FACTORY_TOOLS = [
  {
    name: 'list_mcp_tools',
    description: 'List all tools available across the platform by server — for capability introspection during onboarding or task routing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        server: { type: 'string' as const, description: 'Optional: filter by server name (e.g. "engineering", "browser")' },
      },
    },
  },
  {
    name: 'get_mcp_tool_details',
    description: 'Get detailed schema and description for a specific platform tool by name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tool_name: { type: 'string' as const, description: 'Tool name to look up' },
      },
      required: ['tool_name'],
    },
  },
  {
    name: 'create_agent',
    description: 'Create a new custom agent configuration for a company. Used during onboarding to specialise agents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Display name for the agent' },
        role: { type: 'string' as const, description: 'Agent role description' },
        base_prompt: { type: 'string' as const, description: 'System prompt for the agent' },
        max_turns: { type: 'number' as const, description: 'Max turns (default 200)' },
      },
      required: ['name', 'role'],
    },
  },
  {
    name: 'list_created_agents',
    description: 'List all active agents in the platform registry with their IDs, roles, and execution style.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_agent_template',
    description: 'Get a template/scaffold for a specific agent type to use as a base for customisation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_type: { type: 'string' as const, description: 'Agent type (e.g. "engineering", "browser", "content", "support")' },
      },
      required: ['agent_type'],
    },
  },
];

export const ALL_CEO_TOOLS = [...CEO_TOOLS, ...CEO_EXTRA_TOOLS, ...CYCLE_PLANNING_TOOLS, ...AGENT_FACTORY_TOOLS];

