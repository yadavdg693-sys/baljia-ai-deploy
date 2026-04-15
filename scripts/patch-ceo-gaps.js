const fs = require('fs');
const file = 'src/lib/agents/ceo/ceo.tool-handlers.ts';
let content = fs.readFileSync(file, 'utf8');

// ── 1. Add agent_factory dispatch cases before the default: ──
// Find the default case (using a unique surrounding anchor)
const anchor = "case 'get_credit_balance': return handleGetCreditBalance(companyId);";
const newCases = [
  "case 'get_credit_balance': return handleGetCreditBalance(companyId);",
  '',
  "    // ── agent_factory (KG spec §3.1) ──",
  "    case 'list_mcp_tools': return handleListMcpTools(toolInput);",
  "    case 'get_mcp_tool_details': return handleGetMcpToolDetails(toolInput);",
  "    case 'create_agent': return handleCreateAgent(toolInput);",
  "    case 'list_created_agents': return handleListCreatedAgents();",
  "    case 'get_agent_template': return handleGetAgentTemplate(toolInput);",
].join('\n    ');

if (content.includes(anchor)) {
  content = content.replace(anchor, newCases);
  console.log('agent_factory dispatch cases added');
} else {
  console.error('anchor not found');
  process.exit(1);
}

// ── 2. Add cycle_planning + score_task tool definitions to ceo.tool-defs.ts ──
const defsFile = 'src/lib/agents/ceo/ceo.tool-defs.ts';
let defs = fs.readFileSync(defsFile, 'utf8');

// Add cycle_planning and score_task tools to CEO_EXTRA_TOOLS (they're dispatched but missing from defs)
// They belong between the extra tools and agent_factory section
const insertBefore = '// ── Group 8: Agent Factory';
const cyclePlanningDefs = `// ── Group 7: Cycle Planning & Task Scoring (6 tools — KG spec) ──

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

`;

if (defs.includes(insertBefore)) {
  defs = defs.replace(insertBefore, cyclePlanningDefs + insertBefore);
  console.log('cycle_planning tool defs added');
} else {
  console.error('insertBefore anchor not found in tool-defs.ts');
  process.exit(1);
}

// Update ALL_CEO_TOOLS export to include cycle planning tools
defs = defs.replace(
  'export const ALL_CEO_TOOLS = [...CEO_TOOLS, ...CEO_EXTRA_TOOLS, ...AGENT_FACTORY_TOOLS];',
  'export const ALL_CEO_TOOLS = [...CEO_TOOLS, ...CEO_EXTRA_TOOLS, ...CYCLE_PLANNING_TOOLS, ...AGENT_FACTORY_TOOLS];'
);
console.log('ALL_CEO_TOOLS export updated');

fs.writeFileSync(file, content, 'utf8');
fs.writeFileSync(defsFile, defs, 'utf8');
console.log('\nAll done.');
