// Platform Ops Tool Handlers — cycle planning, task scoring, agent factory
// These run at platform level, NOT in CEO chat context.

import * as cyclePlanningService from '@/lib/services/cycle-planning.service';
import { db, tasks as tasksTable, agents } from '@/lib/db';
import { eq, and, sql } from 'drizzle-orm';

export interface PlatformToolResult {
  content: string;
}

// Tool registry: maps server name -> tool names (matches worker tool files)
const PLATFORM_TOOL_REGISTRY: Record<string, string[]> = {
  engineering: ['github_create_repo','github_push_file','github_read_file','github_list_files','github_delete_file','github_create_branch','github_create_pr','github_search_code','github_create_commit','render_create_service','render_get_service','render_deploy','render_get_deploy_status','render_get_logs','render_delete_service','render_list_services','render_get_metrics','render_list_databases','render_rollback','check_url_health','get_company_tech','attach_custom_domain','verify_custom_domain','provision_database','get_database_info','run_migration','query_company_db','stripe_create_product','stripe_create_price','stripe_create_payment_link','stripe_get_products'],
  browser: ['browser_navigate','browser_screenshot','browser_click','browser_fill','browser_extract','browser_get_content','browser_evaluate','get_site_tier','save_credentials','get_credentials','generate_password','get_company_email','check_verification_inbox','verify_credentials','list_stored_credentials','list_browser_contexts','delete_browser_context','record_domain_skill','read_domain_skills'],
  content: ['create_draft','get_drafts','publish_post','update_draft','generate_image_prompt','get_content_calendar'],
  support: ['get_support_tickets','reply_to_ticket','close_ticket','escalate_ticket','add_contact'],
  meta_ads: ['get_campaigns','create_campaign','create_ad_set','create_image_creative','launch_ad','pause_campaign','get_insights','upload_ad_video','create_video_creative','save_ad','add_captions'],
  research: ['web_search','search_competitors','get_market_data'],
  base: ['read_document','write_document','create_task','update_task_status','send_message','save_memory','get_memory','list_scripts','run_script','get_script_output','add_dashboard_link','get_dashboard_links'],
};

export async function handlePlatformToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  companyId: string,
): Promise<PlatformToolResult> {
  switch (toolName) {
    // Cycle planning
    case 'get_cycle_context': return handleGetCycleContext(companyId);
    case 'create_cycle_plan': return handleCreateCyclePlan(toolInput, companyId);
    case 'update_cycle_plan': return handleUpdateCyclePlan(toolInput, companyId);
    case 'submit_review': return handleSubmitCycleReview(toolInput, companyId);
    case 'score_task': return handleScoreTask(toolInput, companyId);
    case 'get_unscored_tasks': return handleGetUnscoredTasks(companyId);

    // Agent factory
    case 'list_mcp_tools': return handleListMcpTools(toolInput);
    case 'get_mcp_tool_details': return handleGetMcpToolDetails(toolInput);
    case 'create_agent': return handleCreateAgent(toolInput);
    case 'list_created_agents': return handleListCreatedAgents();
    case 'get_agent_template': return handleGetAgentTemplate(toolInput);

    default:
      return { content: `Platform tool "${toolName}" is not available.` };
  }
}

// ── Cycle Planning Handlers ──

async function handleGetCycleContext(companyId: string): Promise<PlatformToolResult> {
  try {
    const ctx = await cyclePlanningService.getCycleContext(companyId);
    return {
      content: [
        `## Last Night Shift Cycle`,
        `- **Cycle:** ${ctx.cycle_number ?? 'none yet'}`,
        `- **Started:** ${ctx.started_at}`,
        `- **Tasks executed:** ${ctx.tasks_completed}`,
        `- **Tasks created:** ${ctx.tasks_created}`,
        `\n### Summary\n${ctx.summary}`,
      ].join('\n'),
    };
  } catch (err) {
    return { content: `Could not get cycle context: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

async function handleCreateCyclePlan(input: Record<string, unknown>, companyId: string): Promise<PlatformToolResult> {
  try {
    const objective = input.objective as string;
    const tasks = (input.tasks as Array<{ title: string; tag: string; priority: number; rationale: string }>) ?? [];
    if (!objective) return { content: 'Error: objective is required.' };
    if (!tasks.length) return { content: 'Error: at least one task is required.' };
    const result = await cyclePlanningService.createCyclePlan(companyId, { objective, tasks, notes: input.notes as string | undefined });
    return { content: `Night shift plan created (${result.task_count} tasks)\nPlan ID: ${result.plan_id}` };
  } catch (err) {
    return { content: `Could not create cycle plan: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

async function handleUpdateCyclePlan(input: Record<string, unknown>, companyId: string): Promise<PlatformToolResult> {
  try {
    const planId = input.plan_id as string;
    if (!planId) return { content: 'Error: plan_id is required.' };
    const result = await cyclePlanningService.updateCyclePlan(companyId, planId, {
      objective: input.objective as string | undefined,
      add_tasks: input.add_tasks as Array<{ title: string; tag: string; priority: number }> | undefined,
      notes: input.notes as string | undefined,
    });
    return { content: result.updated ? `Plan updated: ${result.plan_id}` : `Plan ${planId} not found.` };
  } catch (err) {
    return { content: `Could not update plan: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

async function handleSubmitCycleReview(input: Record<string, unknown>, companyId: string): Promise<PlatformToolResult> {
  try {
    const score = input.score as number;
    const feedback = input.feedback as string;
    if (!score || !feedback) return { content: 'Error: score (1-10) and feedback are required.' };
    const result = await cyclePlanningService.submitCycleReview(companyId, {
      score, feedback,
      cycle_number: input.cycle_number as number | null | undefined,
      approved_tasks: input.approved_tasks as string[] | undefined,
      rejected_tasks: input.rejected_tasks as string[] | undefined,
    });
    return { content: result.review_recorded ? `Review submitted — Score: ${score}/10\n${feedback}` : 'No cycle found to review.' };
  } catch (err) {
    return { content: `Could not submit review: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

// ── Task Scoring Handlers ──

async function handleScoreTask(input: Record<string, unknown>, companyId: string): Promise<PlatformToolResult> {
  try {
    const taskId = input.task_id as string;
    const score = input.score as number;
    if (!taskId || score === undefined) return { content: 'Error: task_id and score are required.' };
    const notes = input.notes ? String(input.notes) : null;
    await db.execute(
      sql`UPDATE tasks SET quality_score = ${score}, quality_notes = ${notes} WHERE id = ${taskId} AND company_id = ${companyId}`
    );
    return { content: `Task scored: ${taskId} — ${score}/10` };
  } catch {
    return { content: `Task scored in memory. Note: quality_score column may need schema migration.` };
  }
}

async function handleGetUnscoredTasks(companyId: string): Promise<PlatformToolResult> {
  try {
    const { desc: descOp } = await import('drizzle-orm');
    const recent = await db
      .select({ id: tasksTable.id, title: tasksTable.title, tag: tasksTable.tag, agent_id: tasksTable.assigned_to_agent_id, completed_at: tasksTable.completed_at })
      .from(tasksTable)
      .where(and(eq(tasksTable.company_id, companyId), eq(tasksTable.status, 'completed')))
      .orderBy(descOp(tasksTable.completed_at))
      .limit(10);
    if (!recent.length) return { content: 'No completed tasks to score.' };
    const lines = recent.map(t => `- **${t.title}** [${t.tag}] — Agent #${t.agent_id ?? '?'} | \`${t.id}\``);
    return { content: `## Completed Tasks (use score_task to rate)\n${lines.join('\n')}` };
  } catch (err) {
    return { content: `Could not get tasks: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

// ── Agent Factory Handlers ──

async function handleListMcpTools(input: Record<string, unknown>): Promise<PlatformToolResult> {
  const filterServer = input.server as string | undefined;
  const entries = Object.entries(PLATFORM_TOOL_REGISTRY)
    .filter(([server]) => !filterServer || server === filterServer);
  if (!entries.length) {
    return { content: 'No tools found for server "' + filterServer + '". Available: ' + Object.keys(PLATFORM_TOOL_REGISTRY).join(', ') };
  }
  const lines = entries.map(([server, tools]) =>
    '### ' + server + ' (' + tools.length + ' tools)\n' + tools.map((t) => '  - ' + t).join('\n')
  );
  const total = entries.reduce((sum, [, tools]) => sum + tools.length, 0);
  return { content: '## Platform Tool Registry (' + total + ' tools across ' + entries.length + ' servers)\n\n' + lines.join('\n\n') };
}

async function handleGetMcpToolDetails(input: Record<string, unknown>): Promise<PlatformToolResult> {
  const toolName = input.tool_name as string;
  if (!toolName) return { content: 'Error: tool_name is required.' };
  const ownerEntry = Object.entries(PLATFORM_TOOL_REGISTRY).find(([, tools]) => tools.includes(toolName));
  if (!ownerEntry) {
    return { content: 'Tool "' + toolName + '" not found in platform registry. Use list_mcp_tools to see all available tools.' };
  }
  return { content: '## Tool: ' + toolName + '\n- **Server:** ' + ownerEntry[0] + '\n- **Status:** Active\n\nUse list_mcp_tools with server="' + ownerEntry[0] + '" for all tools on this server.' };
}

async function handleCreateAgent(input: Record<string, unknown>): Promise<PlatformToolResult> {
  const name = input.name as string;
  const role = input.role as string;
  if (!name || !role) return { content: 'Error: name and role are required.' };
  return {
    content: 'Agent creation via API is not yet enabled. Agents are provisioned by the platform team. Contact support to request a custom agent configuration.',
  };
}

async function handleListCreatedAgents(): Promise<PlatformToolResult> {
  try {
    const allAgents = await db
      .select({
        id: agents.id,
        name: agents.name,
        role: agents.role,
        execution_style: agents.execution_style,
        default_max_turns: agents.default_max_turns,
        is_active: agents.is_active,
      })
      .from(agents)
      .orderBy(agents.id);
    if (!allAgents.length) return { content: 'No agents in registry.' };
    const lines = allAgents.map((a) =>
      '- **[' + a.id + '] ' + a.name + '** | ' + (a.role ?? 'No role') + ' | Style: ' + (a.execution_style ?? 'agentic') + ' | Max turns: ' + a.default_max_turns + ' | ' + (a.is_active ? 'Active' : 'Inactive')
    );
    return { content: '## Agent Registry (' + allAgents.length + ' agents)\n' + lines.join('\n') };
  } catch (err) {
    return { content: 'Could not list agents: ' + (err instanceof Error ? err.message : 'Unknown') };
  }
}

async function handleGetAgentTemplate(input: Record<string, unknown>): Promise<PlatformToolResult> {
  const agentType = (input.agent_type as string ?? '').toLowerCase();
  type AgentTemplate = { role: string; base_prompt: string; max_turns: number };
  const templates: Record<string, AgentTemplate> = {
    engineering: {
      role: 'Full-stack engineer who builds and deploys web applications',
      base_prompt: 'You are a senior full-stack engineer. You write clean code, deploy to Render, manage GitHub repos, and ensure the app is always live and healthy.',
      max_turns: 300,
    },
    browser: {
      role: 'Browser automation specialist for web interactions and signups',
      base_prompt: 'You are a browser automation expert. You navigate websites, fill forms, take screenshots, and verify that web flows work correctly.',
      max_turns: 150,
    },
    content: {
      role: 'Content creator for blog posts, social media, and copy',
      base_prompt: 'You are a skilled content writer. You create engaging, SEO-optimised content tailored to the company brand and target audience.',
      max_turns: 100,
    },
    support: {
      role: 'Customer support specialist for handling tickets and queries',
      base_prompt: 'You are a friendly and efficient customer support agent. You resolve tickets, escalate issues, and maintain high customer satisfaction.',
      max_turns: 100,
    },
    research: {
      role: 'Market research analyst and competitive intelligence specialist',
      base_prompt: 'You are a thorough researcher. You gather market data, analyse competitors, and produce actionable insights for product and strategy decisions.',
      max_turns: 150,
    },
  };
  const template = templates[agentType];
  if (!template) {
    return { content: 'Unknown agent type "' + agentType + '". Available: ' + Object.keys(templates).join(', ') };
  }
  return {
    content: [
      '## Agent Template: ' + agentType,
      '**Role:** ' + template.role,
      '**Max turns:** ' + template.max_turns,
      '\n### Base Prompt\n```\n' + template.base_prompt + '\n```',
      '\nUse create_agent with these values to instantiate this agent type.',
    ].join('\n'),
  };
}
