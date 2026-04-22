// Platform Ops Tool Definitions — 11 tools in 2 groups
// These are platform-level capabilities, NOT CEO chat tools.
// Used by night shift, onboarding, and platform admin processes.

// ── Cycle Planning & Task Scoring (6 tools) ──

export const CYCLE_PLANNING_TOOLS = [
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
        objective: { type: 'string' as const, description: 'Plan objective — what this cycle aims to achieve' },
        tasks: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              title: { type: 'string' as const, description: 'Task title' },
              tag: { type: 'string' as const, description: 'Agent lane (e.g. "research", "engineering", "outreach")' },
              priority: { type: 'number' as const, description: 'Priority 1-100' },
              rationale: { type: 'string' as const, description: 'Why this task matters for the objective' },
            },
            required: ['title', 'tag', 'priority', 'rationale'],
          },
          description: 'Tasks to include in this cycle plan',
        },
        notes: { type: 'string' as const, description: 'Optional planner notes' },
      },
      required: ['objective', 'tasks'],
    },
  },
  {
    name: 'update_cycle_plan',
    description: 'Update an existing cycle plan — change objective, add tasks, or update notes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        plan_id: { type: 'string' as const, description: 'Cycle plan ID to update' },
        objective: { type: 'string' as const, description: 'Updated plan objective' },
        add_tasks: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              title: { type: 'string' as const, description: 'Task title' },
              tag: { type: 'string' as const, description: 'Agent lane' },
              priority: { type: 'number' as const, description: 'Priority 1-100' },
            },
            required: ['title', 'tag', 'priority'],
          },
          description: 'Additional tasks to add to the plan',
        },
        notes: { type: 'string' as const, description: 'Updated planner notes' },
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
        score: { type: 'number' as const, description: 'Overall cycle score 1-10' },
        feedback: { type: 'string' as const, description: 'Review feedback — what went well and what needs improvement' },
        cycle_number: { type: 'number' as const, description: 'Specific cycle number to review (defaults to latest)' },
        approved_tasks: { type: 'array' as const, items: { type: 'string' as const }, description: 'Task IDs approved as successful' },
        rejected_tasks: { type: 'array' as const, items: { type: 'string' as const }, description: 'Task IDs rejected / needing rework' },
      },
      required: ['score', 'feedback'],
    },
  },
  {
    name: 'score_task',
    description: 'Rate a completed task on a 1-10 scale.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'Task ID to score' },
        score: { type: 'number' as const, description: 'Score 1-10' },
        notes: { type: 'string' as const, description: 'Optional scoring notes' },
      },
      required: ['task_id', 'score'],
    },
  },
  {
    name: 'get_unscored_tasks',
    description: 'Get a list of recently completed tasks that have not yet been scored.',
    input_schema: { type: 'object' as const, properties: {} },
  },
];

// ── Agent Factory (5 tools) ──
// Platform-internal: used by onboarding and platform admin for agent introspection and dynamic agent creation

export const AGENT_FACTORY_TOOLS = [
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

export const PLATFORM_OPS_TOOLS = [...CYCLE_PLANNING_TOOLS, ...AGENT_FACTORY_TOOLS];
