// CEO Tool Handlers — execute tool calls from the CEO agent
// Split from definitions for maintainability

import type { ChatAction, Task } from '@/types';
import * as taskService from '@/lib/services/task.service';
import * as creditService from '@/lib/services/credit.service';
import * as memoryService from '@/lib/services/memory.service';
import * as documentService from '@/lib/services/document.service';
import * as governanceService from '@/lib/services/governance.service';
import { routeTask, getAgentName } from '@/lib/services/router.service';
import { db, tasks as tasksTable, taskExecutions, recurringTasks, companies, reports, emailThreads, tweets, dashboardLinks, adCampaigns, platformFeedback, platformEvents } from '@/lib/db';
import { eq, and, desc, ilike } from 'drizzle-orm';

export interface ToolResult {
  content: string;
  action?: ChatAction;
}

export async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  companyId: string
): Promise<ToolResult> {
  switch (toolName) {
    // ── Capabilities ──
    case 'list_available_modules': return handleListModules();
    case 'get_module_capabilities': return handleGetModuleCapabilities(toolInput);
    case 'list_mcp_servers': return handleListMcpServers();
    case 'list_available_agents': return handleListAgents();
    case 'get_agent_capabilities': return handleGetAgentCapabilities(toolInput);
    case 'find_agent_for_task': return handleFindAgentForTask(toolInput);

    // ── Tasks ──
    case 'get_tasks': return handleGetTasks(companyId);
    case 'create_task': return handleCreateTask(toolInput, companyId);
    case 'reject_task': return handleRejectTask(toolInput, companyId);
    case 'get_task_details': return handleGetTaskDetails(toolInput, companyId);
    case 'edit_task': return handleEditTask(toolInput, companyId);
    case 'get_task_run_link': return handleGetTaskRunLink(toolInput, companyId);
    case 'get_task_execution_status': return handleGetTaskExecutionStatus(toolInput, companyId);
    case 'approve_task': return handleApproveTask(toolInput, companyId);
    case 'get_task_execution_logs': return handleGetTaskExecutionLogs(toolInput, companyId);
    case 'get_active_executions': return handleGetActiveExecutions(companyId);
    case 'find_best_agent': return handleFindBestAgent(toolInput);
    case 'reorder_task': return handleReorderTask(toolInput, companyId);
    case 'move_task_to_top': return handleMoveTaskToTop(toolInput, companyId);

    // ── Recurring ──
    case 'get_recurring_tasks': return handleGetRecurringTasks(companyId);
    case 'create_recurring_task': return handleCreateRecurringTask(toolInput, companyId);
    case 'update_recurring_task': return handleUpdateRecurringTask(toolInput, companyId);
    case 'delete_recurring_task': return handleDeleteRecurringTask(toolInput, companyId);

    // ── Company ──
    case 'get_context': return handleGetContext(companyId);
    case 'query_reports': return handleQueryReports(toolInput, companyId);
    case 'get_document': return handleGetDocument(toolInput, companyId);
    case 'update_document': return handleUpdateDocument(toolInput, companyId);
    case 'get_emails': return handleGetEmails(toolInput, companyId);
    case 'get_tweets': return handleGetTweets(toolInput, companyId);
    case 'get_links': return handleGetLinks(companyId);
    case 'update_link': return handleUpdateLink(toolInput, companyId);
    case 'pause_ads': return handlePauseAds(companyId);
    case 'suggest_feature': return handleSuggestFeature(toolInput, companyId);

    // ── Research ──
    case 'web_search': return handleWebSearch(toolInput);

    // ── Platform ──
    case 'report_platform_bug': return handleReportBug(toolInput, companyId);

    // ── Memory ──
    case 'search_memory': return handleSearchMemory(toolInput, companyId);
    case 'read_memory': return handleReadMemory(toolInput, companyId);
    case 'write_memory': return handleWriteMemory(toolInput, companyId);
    case 'get_credit_balance': return handleGetCreditBalance(companyId);

    default:
      return { content: `Tool "${toolName}" is not available yet.` };
  }
}

// ══════════════════════════════════════════════
// GROUP 1: CAPABILITIES HANDLERS
// ══════════════════════════════════════════════

const AGENT_REGISTRY = [
  { id: 30, name: 'Engineering', role: 'Build, fix, deploy, integrate', maxTurns: 200, tools: 15 },
  { id: 42, name: 'Browser', role: 'Interactive web execution, account setup', maxTurns: 200, tools: 13 },
  { id: 29, name: 'Research', role: 'Market research, competitor analysis, web search', maxTurns: 200, tools: 7 },
  { id: 33, name: 'Data', role: 'SQL queries, metrics, analytics reports', maxTurns: 200, tools: 7 },
  { id: 32, name: 'Support', role: 'Customer email replies, escalation', maxTurns: 200, tools: 9 },
  { id: 40, name: 'Twitter', role: 'Compose and post tweets', maxTurns: 200, tools: 7 },
  { id: 41, name: 'Meta Ads', role: 'Ad creation, optimization, campaign control', maxTurns: 100, tools: 13 },
  { id: 54, name: 'Cold Outreach', role: 'Outbound email, lead verification, follow-ups', maxTurns: 200, tools: 11 },
];

const INTEGRATION_REGISTRY = [
  { name: 'GitHub', env: 'GITHUB_TOKEN', purpose: 'Code hosting & version control' },
  { name: 'Render', env: 'RENDER_API_KEY', purpose: 'App hosting & deployment' },
  { name: 'Cloudflare', env: 'CLOUDFLARE_API_TOKEN', purpose: 'DNS & email routing' },
  { name: 'Postmark', env: 'POSTMARK_SERVER_TOKEN', purpose: 'Transactional email' },
  { name: 'Twitter/X', env: 'TWITTER_API_KEY', purpose: 'Social media posting' },
  { name: 'Meta Ads', env: 'META_ADS_ACCESS_TOKEN', purpose: 'Facebook/Instagram ads' },
  { name: 'Hunter.io', env: 'HUNTER_API_KEY', purpose: 'Email finding & verification' },
  { name: 'Browserbase', env: 'BROWSERBASE_API_KEY', purpose: 'Cloud browser automation' },
  { name: 'Tavily', env: 'TAVILY_API_KEY', purpose: 'Web search for research' },
  { name: 'Neon', env: 'NEON_API_KEY', purpose: 'Postgres database provisioning' },
  { name: 'Anthropic', env: 'ANTHROPIC_API_KEY', purpose: 'AI (Claude) for agents' },
  { name: 'Google AI', env: 'GEMINI_API_KEY', purpose: 'AI (Gemini) fallback' },
  { name: 'Stripe', env: 'STRIPE_SECRET_KEY', purpose: 'Payment processing' },
];

function handleListModules(): ToolResult {
  const lines = AGENT_REGISTRY.map(a =>
    `- **${a.name}** (Agent #${a.id}) — ${a.role} | ${a.tools} tools, max ${a.maxTurns} turns`
  );
  return { content: `## Available Modules\n${lines.join('\n')}\n\nPlus: CEO/Chat (you), Onboarding Pipeline (automated)` };
}

function handleGetModuleCapabilities(input: Record<string, unknown>): ToolResult {
  const name = (input.module_name as string).toLowerCase();
  const agent = AGENT_REGISTRY.find(a => a.name.toLowerCase() === name || String(a.id) === name);
  if (!agent) return { content: `Module "${input.module_name}" not found. Use list_available_modules to see options.` };

  const details: Record<number, { can: string[]; cant: string[]; tools: string[] }> = {
    30: { can: ['Build landing pages/dashboards', 'Fix bugs', 'Create APIs/webhooks', 'Set up payments', 'Deploy to Render'], cant: ['Automated testing', 'Browser QA', 'Web search', 'Load testing'], tools: ['github_create_repo', 'github_push_file', 'github_read_file', 'github_list_files', 'github_delete_file', 'render_create_service', 'render_deploy', 'render_get_service', 'render_get_deploy_status', 'get_company_tech', 'attach_custom_domain', 'verify_custom_domain'] },
    42: { can: ['Navigate websites', 'Fill forms', 'Take screenshots', 'Extract data', 'Account signup'], cant: ['2FA automation', 'Desktop apps', 'PDF workflows', 'Multi-tab research'], tools: ['browser_navigate', 'browser_screenshot', 'browser_click', 'browser_fill', 'browser_extract', 'browser_get_content', 'browser_evaluate', 'get_site_tier', 'save_credentials', 'get_credentials'] },
    29: { can: ['Web search (Tavily)', 'Competitor analysis', 'Industry trends', 'Market research'], cant: ['Interactive browsing', 'Account creation', 'Real-time data'], tools: ['web_search', 'web_extract', 'competitor_analysis', 'industry_trends'] },
    33: { can: ['SQL queries', 'Schema inspection', 'Metrics collection', 'Trend analysis'], cant: ['Write/modify data', 'Infrastructure changes'], tools: ['query_database', 'inspect_schema', 'get_metrics', 'analyze_trends'] },
    32: { can: ['Read/reply emails', 'Escalate to owner', 'Create engineering tickets', 'Search contacts'], cant: ['Refund processing', 'Account modifications', 'Customer history search'], tools: ['get_inbox', 'send_email', 'get_email_thread', 'escalate_to_owner', 'escalate_to_engineering', 'get_contacts'] },
    40: { can: ['Post tweets', 'Schedule tweets', 'Read brand voice', 'Dedup against history'], cant: ['Instagram/LinkedIn posting', 'Engagement/reply monitoring', 'Trend search'], tools: ['post_tweet', 'get_twitter_account', 'get_recent_tweets', 'schedule_tweet'] },
    41: { can: ['Create campaigns/adsets/ads', 'Activate/pause campaigns', 'Get performance insights', 'Auto-evaluate health'], cant: ['Video generation (needs Sora)', 'Customer audience import', 'Custom conversion tracking'], tools: ['create_campaign', 'create_adset', 'create_ad', 'activate_campaign', 'pause_campaign', 'list_campaigns', 'get_campaign_insights', 'evaluate_ad_performance', 'get_ad_account', 'update_ad_metrics'] },
    54: { can: ['Find/verify emails (Hunter.io)', 'Send cold outreach', 'Track lead pipeline', 'Check replies'], cant: ['LinkedIn outreach', 'Phone calls', 'Meeting scheduling'], tools: ['find_email', 'verify_email', 'send_outreach_email', 'check_replies', 'add_contact', 'update_contact_status', 'get_contacts', 'get_outreach_stats'] },
  };

  const d = details[agent.id];
  if (!d) return { content: `Details not available for ${agent.name}.` };

  return { content: `## ${agent.name} Agent (#${agent.id})\n**Role:** ${agent.role}\n**Max Turns:** ${agent.maxTurns}\n\n**Can do:**\n${d.can.map(c => `- ✅ ${c}`).join('\n')}\n\n**Cannot do:**\n${d.cant.map(c => `- ❌ ${c}`).join('\n')}\n\n**Tools (${d.tools.length}):** ${d.tools.join(', ')}` };
}

function handleListMcpServers(): ToolResult {
  const lines = INTEGRATION_REGISTRY.map(i => {
    const configured = !!process.env[i.env];
    const status = configured ? '🟢 Connected' : '🔴 Not configured';
    return `- **${i.name}** — ${i.purpose} | ${status}`;
  });
  const configured = INTEGRATION_REGISTRY.filter(i => !!process.env[i.env]).length;
  return { content: `## Integrations (${configured}/${INTEGRATION_REGISTRY.length} connected)\n${lines.join('\n')}` };
}

function handleListAgents(): ToolResult {
  const lines = AGENT_REGISTRY.map(a =>
    `| ${a.id} | ${a.name} | ${a.role} | ${a.maxTurns} |`
  );
  return { content: `## Worker Agents\n| ID | Name | Role | Max Turns |\n|---|---|---|---|\n${lines.join('\n')}` };
}

function handleGetAgentCapabilities(input: Record<string, unknown>): ToolResult {
  return handleGetModuleCapabilities({ module_name: input.agent_id });
}

function handleFindAgentForTask(input: Record<string, unknown>): ToolResult {
  const tag = (input.tag as string) ?? '';
  const agentId = routeTask(tag || (input.task_description as string));
  const agentName = getAgentName(agentId);
  const agent = AGENT_REGISTRY.find(a => a.id === agentId);
  return { content: `**Recommended: ${agentName}** (Agent #${agentId})\nRole: ${agent?.role ?? 'Unknown'}\nTools: ${agent?.tools ?? 0}\nMax turns: ${agent?.maxTurns ?? 200}\n\nThis agent was selected based on the task tag "${tag || 'auto-detected'}".` };
}

// ══════════════════════════════════════════════
// GROUP 2: TASK HANDLERS
// ══════════════════════════════════════════════

async function handleGetTasks(companyId: string): Promise<ToolResult> {
  const tasks = await taskService.getTasks(companyId);
  if (tasks.length === 0) return { content: 'No tasks in the queue yet.' };

  const grouped: Record<string, typeof tasks> = {};
  for (const task of tasks) {
    const status = task.status.replace(/_/g, ' ');
    if (!grouped[status]) grouped[status] = [];
    grouped[status].push(task);
  }

  const lines = Object.entries(grouped).map(([status, statusTasks]) => {
    const taskList = statusTasks.map((t) => `  - ${t.title} (${t.tag})`).join('\n');
    return `**${status}** (${statusTasks.length}):\n${taskList}`;
  });

  return { content: lines.join('\n\n') };
}

async function handleCreateTask(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const title = input.title as string;
  const description = input.description as string;
  const tag = input.tag as string;

  const decision = await governanceService.evaluateTask({ title, description, tag, companyId });

  if (decision.verdict === 'blocked') {
    return { content: `⚠️ Task blocked: ${decision.founder_safe_explanation}` };
  }
  if (decision.verdict === 'split_required') {
    return { content: `📋 ${decision.founder_safe_explanation}` };
  }

  const agentId = routeTask(tag);
  const agentName = getAgentName(agentId);

  const task = await taskService.createTask({
    company_id: companyId, title, description, tag,
    source: 'ceo_suggested',
    suggestion_reasoning: decision.founder_safe_explanation,
    execution_mode: decision.execution_mode,
    verification_level: decision.verification_level,
    assigned_to_agent_id: agentId,
    estimated_credits: decision.estimated_credits,
  });

  return {
    content: `Task proposed for **${agentName}** agent.`,
    action: {
      type: 'task_proposal',
      data: {
        task_id: task.id, title: task.title, description: task.description, tag: task.tag,
        estimated_credits: decision.estimated_credits, execution_mode: decision.execution_mode,
        verification_level: decision.verification_level, agent_name: agentName,
        explanation: decision.founder_safe_explanation,
      },
    },
  };
}

async function handleRejectTask(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const taskId = input.task_id as string;
  try {
    const task = await taskService.getTask(taskId);
    if (!task || task.company_id !== companyId) return { content: 'Task not found.' };
    if (task.status === 'in_progress') return { content: 'Cannot reject a task that is currently running.' };

    await taskService.updateTask(taskId, { status: 'rejected' as Task['status'] });
    return { content: `Task "${task.title}" rejected.${input.reason ? ` Reason: ${input.reason}` : ''}` };
  } catch { return { content: 'Could not reject task.' }; }
}

async function handleGetTaskDetails(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const taskId = input.task_id as string;
  try {
    const task = await taskService.getTask(taskId);
    if (!task || task.company_id !== companyId) return { content: 'Task not found.' };

    const agentName = task.assigned_to_agent_id ? getAgentName(task.assigned_to_agent_id) : 'Unassigned';
    return {
      content: `**${task.title}**\n- Status: ${task.status.replace(/_/g, ' ')}\n- Tag: ${task.tag}\n- Agent: ${agentName}\n- Priority: ${task.priority}\n- Credits: ${task.actual_credits_charged}/${task.estimated_credits}\n- Source: ${task.source.replace(/_/g, ' ')}\n${task.started_at ? `- Started: ${new Date(task.started_at).toLocaleString()}` : ''}\n${task.completed_at ? `- Completed: ${new Date(task.completed_at).toLocaleString()}` : ''}`,
    };
  } catch { return { content: 'Task not found.' }; }
}

async function handleEditTask(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const taskId = input.task_id as string;
  try {
    const task = await taskService.getTask(taskId);
    if (!task || task.company_id !== companyId) return { content: 'Task not found.' };
    if (task.status === 'in_progress' || task.status === 'completed_verified' || task.status === 'completed_unverified') {
      return { content: `Cannot edit a task that is ${task.status.replace(/_/g, ' ')}.` };
    }

    const updates: Record<string, unknown> = {};
    if (input.title) updates.title = input.title;
    if (input.description) updates.description = input.description;
    if (input.priority) updates.priority = input.priority;
    if (input.tag) updates.tag = input.tag;

    if (Object.keys(updates).length === 0) return { content: 'No changes specified.' };

    await db.update(tasksTable).set(updates as Record<string, unknown>).where(eq(tasksTable.id, taskId));
    return { content: `Task "${task.title}" updated: ${Object.keys(updates).join(', ')} changed.` };
  } catch { return { content: 'Could not edit task.' }; }
}

async function handleGetTaskRunLink(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const taskId = input.task_id as string;
  try {
    const task = await taskService.getTask(taskId);
    if (!task || task.company_id !== companyId) return { content: 'Task not found.' };
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://baljia.ai';
    return { content: `🔗 Run link: ${baseUrl}/api/tasks/${taskId}/run\n\nClick to execute this task instantly (costs 1 credit).` };
  } catch { return { content: 'Task not found.' }; }
}

async function handleGetTaskExecutionStatus(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const taskId = input.task_id as string;
  try {
    const task = await taskService.getTask(taskId);
    if (!task || task.company_id !== companyId) return { content: 'Task not found.' };

    if (task.status !== 'in_progress') {
      return { content: `Task is not running. Current status: **${task.status.replace(/_/g, ' ')}**` };
    }

    const [execution] = await db.select().from(taskExecutions)
      .where(eq(taskExecutions.task_id, taskId)).orderBy(desc(taskExecutions.started_at)).limit(1);

    if (!execution) return { content: 'Task is in progress but no execution record found.' };

    const elapsed = execution.started_at ? Math.floor((Date.now() - new Date(execution.started_at).getTime()) / 1000) : 0;
    return { content: `⚡ Task is **running**\n- Agent: ${getAgentName(execution.agent_id)}\n- Running for: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s\n- Turns: ${execution.turn_count ?? 'unknown'}` };
  } catch { return { content: 'Could not check execution status.' }; }
}

async function handleApproveTask(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const taskId = input.task_id as string;
  try {
    const task = await taskService.getTask(taskId);
    if (!task || task.company_id !== companyId) return { content: 'Task not found.' };
    if (task.status !== 'created') {
      return { content: `Task is already ${task.status.replace(/_/g, ' ')}. Only "created" tasks can be approved.` };
    }

    await taskService.updateTask(taskId, { status: 'todo' as Task['status'] });
    return {
      content: `✅ Task "${task.title}" approved and added to queue.`,
      action: { type: 'task_approved', data: { task_id: taskId, title: task.title } },
    };
  } catch { return { content: 'Could not approve task.' }; }
}

async function handleGetTaskExecutionLogs(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const taskId = input.task_id as string;
  try {
    const task = await taskService.getTask(taskId);
    if (!task || task.company_id !== companyId) return { content: 'Task not found.' };

    const [execution] = await db.select({
      execution_log: taskExecutions.execution_log, turn_count: taskExecutions.turn_count, agent_id: taskExecutions.agent_id,
    }).from(taskExecutions)
      .where(eq(taskExecutions.task_id, taskId)).orderBy(desc(taskExecutions.started_at)).limit(1);

    if (!execution?.execution_log) return { content: 'No execution logs available for this task.' };

    const logs = execution.execution_log as Array<Record<string, unknown>>;
    const summary = logs.slice(-10).map((entry, i) => {
      const tool = entry.tool ? `[${entry.tool}]` : '';
      const event = entry.event ?? '';
      const result = entry.result ? String(entry.result).substring(0, 100) : '';
      return `${i + 1}. ${tool} ${event} ${result}`;
    }).join('\n');

    return { content: `## Execution Log (${getAgentName(execution.agent_id)}, ${execution.turn_count} turns)\n${summary}` };
  } catch { return { content: 'Could not retrieve execution logs.' }; }
}

async function handleGetActiveExecutions(companyId: string): Promise<ToolResult> {
  const tasks = await db.select({
    id: tasksTable.id, title: tasksTable.title, tag: tasksTable.tag,
    assigned_to_agent_id: tasksTable.assigned_to_agent_id, started_at: tasksTable.started_at,
  }).from(tasksTable)
    .where(and(eq(tasksTable.company_id, companyId), eq(tasksTable.status, 'in_progress')));

  if (!tasks.length) return { content: 'No tasks are currently running.' };

  const lines = tasks.map(t => {
    const elapsed = t.started_at ? Math.floor((Date.now() - new Date(t.started_at).getTime()) / 1000 / 60) : 0;
    return `- **${t.title}** (${t.tag}) — ${getAgentName(t.assigned_to_agent_id ?? 0)} — running ${elapsed}m`;
  });
  return { content: `## Active Executions\n${lines.join('\n')}` };
}

function handleFindBestAgent(input: Record<string, unknown>): ToolResult {
  const query = input.query as string;
  const agentId = routeTask(query);
  const agentName = getAgentName(agentId);
  const agent = AGENT_REGISTRY.find(a => a.id === agentId);
  return { content: `Best agent for "${query}": **${agentName}** (#${agentId})\n${agent?.role ?? ''}` };
}

async function handleReorderTask(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const taskId = input.task_id as string;
  const position = input.position as number;
  try {
    const task = await taskService.getTask(taskId);
    if (!task || task.company_id !== companyId) return { content: 'Task not found.' };

    await db.update(tasksTable).set({ queue_order: position }).where(eq(tasksTable.id, taskId));
    return { content: `Task "${task.title}" moved to position ${position} in queue.` };
  } catch { return { content: 'Could not reorder task.' }; }
}

async function handleMoveTaskToTop(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const taskId = input.task_id as string;
  try {
    const task = await taskService.getTask(taskId);
    if (!task || task.company_id !== companyId) return { content: 'Task not found.' };

    await db.update(tasksTable).set({ queue_order: 0 }).where(eq(tasksTable.id, taskId));
    return { content: `⬆️ Task "${task.title}" moved to the **top** of the queue. It will run next.` };
  } catch { return { content: 'Could not move task.' }; }
}

// ══════════════════════════════════════════════
// GROUP 3: RECURRING TASK HANDLERS
// ══════════════════════════════════════════════

async function handleGetRecurringTasks(companyId: string): Promise<ToolResult> {
  const data = await db.select().from(recurringTasks).where(eq(recurringTasks.company_id, companyId));

  if (!data.length) return { content: 'No recurring tasks set up yet.' };

  const lines = data.map(r => {
    const status = r.is_active === false ? '⏸️ Paused' : '🔄 Active';
    return `- **${r.title}** (${r.cadence}) — ${status} — ~${r.monthly_credits_estimate ?? '?'} credits/month`;
  });
  return { content: `## Recurring Tasks\n${lines.join('\n')}` };
}

async function handleCreateRecurringTask(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const cadence = input.cadence as string;
  const creditsPerMonth: Record<string, number> = { daily: 30, weekly: 4, biweekly: 2, monthly: 1 };

  try {
    const [data] = await db.insert(recurringTasks).values({
      company_id: companyId,
      title: input.title as string,
      description: input.description as string,
      tag: input.tag as string,
      cadence,
      monthly_credits_estimate: creditsPerMonth[cadence] ?? 1,
    }).returning();

    return { content: `✅ Recurring task "${data.title}" created (${cadence}). Estimated ~${creditsPerMonth[cadence] ?? 1} credits/month.` };
  } catch (err) {
    return { content: `Could not create recurring task: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

async function handleUpdateRecurringTask(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const updates: Record<string, unknown> = {};
  if (input.cadence !== undefined) updates.cadence = input.cadence;
  if (input.paused !== undefined) updates.paused = input.paused;
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;

  try {
    await db.update(recurringTasks).set(updates)
      .where(and(eq(recurringTasks.id, input.recurring_id as string), eq(recurringTasks.company_id, companyId)));
    return { content: `Recurring task updated: ${Object.keys(updates).join(', ')} changed.` };
  } catch (err) {
    return { content: `Could not update: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

async function handleDeleteRecurringTask(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  try {
    await db.delete(recurringTasks)
      .where(and(eq(recurringTasks.id, input.recurring_id as string), eq(recurringTasks.company_id, companyId)));
    return { content: `Recurring task permanently removed.` };
  } catch (err) {
    return { content: `Could not delete: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

// ══════════════════════════════════════════════
// GROUP 4: COMPANY HANDLERS
// ══════════════════════════════════════════════

async function handleGetContext(companyId: string): Promise<ToolResult> {
  const [company] = await db.select({
    name: companies.name, slug: companies.slug, one_liner: companies.one_liner,
    company_stage: companies.company_stage, lifecycle: companies.lifecycle,
    plan_tier: companies.plan_tier, custom_domain: companies.custom_domain,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);

  if (!company) return { content: 'Company not found.' };

  const balance = await creditService.getBalance(companyId);
  const docs = await documentService.getDocuments(companyId);
  const nonEmpty = docs.filter(d => !d.is_empty).map(d => d.doc_type).join(', ');
  const empty = docs.filter(d => d.is_empty).map(d => d.doc_type).join(', ');

  return {
    content: `## ${company.name}\n- **Slug:** ${company.slug}\n- **One-liner:** ${company.one_liner ?? 'Not set'}\n- **Stage:** ${company.company_stage}\n- **Lifecycle:** ${(company.lifecycle ?? 'trial_active').replace(/_/g, ' ')}\n- **Plan:** ${company.plan_tier}\n- **Credits:** ${balance}\n- **Domain:** ${company.custom_domain ?? `${company.slug}.baljia.app`}\n\n**Documents filled:** ${nonEmpty || 'none'}\n**Documents empty:** ${empty || 'none'}`,
  };
}

async function handleQueryReports(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const limit = Math.min((input.limit as number) ?? 10, 50);
  const conditions = [eq(reports.company_id, companyId)];
  if (input.report_type) conditions.push(eq(reports.report_type, input.report_type as string));

  let data = await db.select({
    id: reports.id, title: reports.title, report_type: reports.report_type, created_at: reports.created_at,
  }).from(reports).where(and(...conditions)).orderBy(desc(reports.created_at)).limit(limit);

  if (input.search) {
    data = data.filter(r => r.title?.toLowerCase().includes((input.search as string).toLowerCase()));
  }

  if (!data.length) return { content: 'No reports found.' };

  const lines = data.map(r => `- **${r.title}** (${r.report_type}) — ${r.created_at ? new Date(r.created_at).toLocaleDateString() : 'unknown'}`);
  return { content: `## Reports (${data.length})\n${lines.join('\n')}` };
}

async function handleGetDocument(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  try {
    const doc = await documentService.getDocumentByType(companyId, input.doc_type as string);
    if (!doc || doc.is_empty) return { content: `Document "${input.doc_type}" is empty. You can populate it using update_document.` };
    return { content: `## ${doc.title ?? doc.doc_type}\n\n${doc.content}` };
  } catch { return { content: `Document "${input.doc_type}" not found.` }; }
}

async function handleUpdateDocument(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  try {
    // updateDocument takes (documentId, content) — look up doc by type first
    const doc = await documentService.getDocumentByType(companyId, input.doc_type as string);
    if (!doc) return { content: `Document "${input.doc_type}" not found.` };

    await documentService.updateDocument(doc.id, input.content as string);
    return {
      content: `✅ Document "${input.doc_type}" updated successfully.`,
      action: { type: 'document_updated', data: { doc_type: input.doc_type } },
    };
  } catch { return { content: `Could not update document.` }; }
}

async function handleGetEmails(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const limit = Math.min((input.limit as number) ?? 10, 50);
  const conditions = [eq(emailThreads.company_id, companyId)];
  if (input.direction && input.direction !== 'all') {
    conditions.push(eq(emailThreads.direction, input.direction as string));
  }

  const data = await db.select({
    id: emailThreads.id, from_address: emailThreads.from_address, to_address: emailThreads.to_address,
    subject: emailThreads.subject, direction: emailThreads.direction, created_at: emailThreads.created_at,
  }).from(emailThreads).where(and(...conditions)).orderBy(desc(emailThreads.created_at)).limit(limit);

  if (!data.length) return { content: 'No emails found.' };

  const lines = data.map(e => {
    const dir = e.direction === 'inbound' ? '📥' : '📤';
    return `- ${dir} **${e.subject}** — ${e.direction === 'inbound' ? `from ${e.from_address}` : `to ${e.to_address}`} — ${e.created_at ? new Date(e.created_at).toLocaleDateString() : 'unknown'}`;
  });
  return { content: `## Recent Emails (${data.length})\n${lines.join('\n')}` };
}

async function handleGetTweets(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const limit = Math.min((input.limit as number) ?? 10, 20);
  const data = await db.select({
    id: tweets.id, text: tweets.text, posted_at: tweets.posted_at, tweet_id: tweets.tweet_id,
  }).from(tweets).where(eq(tweets.company_id, companyId)).orderBy(desc(tweets.posted_at)).limit(limit);

  if (!data.length) return { content: 'No tweets posted yet.' };

  const lines = data.map(t => `- "${t.text?.substring(0, 100)}${(t.text?.length ?? 0) > 100 ? '...' : ''}" — ${t.posted_at ? new Date(t.posted_at).toLocaleDateString() : 'unknown'}`);
  return { content: `## Recent Tweets (${data.length})\n${lines.join('\n')}` };
}

async function handleGetLinks(companyId: string): Promise<ToolResult> {
  const data = await db.select({ label: dashboardLinks.label, url: dashboardLinks.url })
    .from(dashboardLinks).where(eq(dashboardLinks.company_id, companyId));

  if (!data.length) return { content: 'No dashboard links set up yet.' };

  const lines = data.map(l => `- [${l.label}](${l.url})`);
  return { content: `## Dashboard Links\n${lines.join('\n')}` };
}

async function handleUpdateLink(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  try {
    await db.insert(dashboardLinks).values({
      company_id: companyId,
      label: input.label as string,
      url: input.url as string,
    }).onConflictDoUpdate({
      target: [dashboardLinks.company_id, dashboardLinks.label],
      set: { url: input.url as string },
    });
    return { content: `✅ Link "${input.label}" → ${input.url} saved.` };
  } catch (err) {
    return { content: `Could not update link: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

async function handlePauseAds(companyId: string): Promise<ToolResult> {
  if (!process.env.META_ADS_ACCESS_TOKEN) {
    return { content: 'Meta Ads is not connected. No active campaigns to pause.' };
  }

  const campaigns = await db.select({ id: adCampaigns.id, meta_campaign_id: adCampaigns.meta_campaign_id, name: adCampaigns.platform })
    .from(adCampaigns).where(and(eq(adCampaigns.company_id, companyId), eq(adCampaigns.status, 'active')));

  if (!campaigns.length) return { content: 'No active ad campaigns to pause.' };

  const token = process.env.META_ADS_ACCESS_TOKEN;
  let paused = 0;
  for (const c of campaigns) {
    try {
      await fetch(`https://graph.facebook.com/v21.0/${c.meta_campaign_id}?access_token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAUSED' }),
      });
      await db.update(adCampaigns).set({ status: 'paused' }).where(eq(adCampaigns.id, c.id));
      paused++;
    } catch { /* continue */ }
  }

  return { content: `🛑 **${paused}/${campaigns.length}** ad campaigns paused immediately. Ad spend is now $0.` };
}

async function handleSuggestFeature(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  await db.insert(platformFeedback).values({
    company_id: companyId, type: 'feature',
    title: input.title as string, description: input.description as string,
  });
  return { content: `✅ Feature request submitted: "${input.title}". The Baljia team will review it.` };
}

// ══════════════════════════════════════════════
// GROUP 5: PLATFORM HANDLER
// ══════════════════════════════════════════════

async function handleReportBug(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  await db.insert(platformFeedback).values({
    company_id: companyId, type: 'bug',
    title: input.title as string, description: input.description as string,
    severity: (input.severity as string) ?? 'medium',
  });
  return { content: `🐛 Bug report submitted: "${input.title}" (${(input.severity as string) ?? 'medium'} severity). The team will investigate.` };
}

// ══════════════════════════════════════════════
// GROUP 6: MEMORY HANDLERS
// ══════════════════════════════════════════════

async function handleSearchMemory(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const query = input.query as string;
  const learnings = await memoryService.searchLearnings(companyId, query, 5);

  if (learnings.length === 0) return { content: `No memory found for "${query}".` };

  const lines = learnings.map(l => `- [${l.category}] ${l.content}`);
  return { content: `Found ${learnings.length} related memories:\n${lines.join('\n')}` };
}

async function handleReadMemory(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const LAYER_NAMES = { 1: 'domain_knowledge', 2: 'user_preferences', 3: 'cross_company' } as const;
  const layerId = input.layer as 1 | 2 | 3;
  const layerName = LAYER_NAMES[layerId] ?? `layer_${layerId}`;
  const layer = await memoryService.getMemoryLayer(companyId, layerId);

  if (!layer?.content) return { content: `Memory layer "${layerName}" is empty.` };
  return { content: layer.content };
}

async function handleWriteMemory(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const LAYER_NAMES = { 1: 'domain_knowledge', 2: 'user_preferences' } as const;
  const layerId = input.layer as 1 | 2;
  const layerName = LAYER_NAMES[layerId] ?? `layer_${layerId}`;
  await memoryService.updateMemoryLayer(companyId, layerId, input.content as string);
  return { content: `Memory layer "${layerName}" updated.` };
}

// ══════════════════════════════════════════════
// GROUP 5: RESEARCH HANDLER
// ══════════════════════════════════════════════

async function handleWebSearch(input: Record<string, unknown>): Promise<ToolResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { content: 'Web search unavailable — TAVILY_API_KEY not configured. Proceeding with model knowledge only.' };
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: input.query as string,
        max_results: 5,
        search_depth: 'basic',
        include_answer: true,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { answer?: string; results?: Array<{ title: string; url: string; content: string }> };

    let content = '';
    if (data.answer) content += `**Summary:** ${data.answer}\n\n`;
    if (data.results?.length) {
      content += '**Sources:**\n';
      for (const r of data.results.slice(0, 5)) {
        content += `- [${r.title}](${r.url})\n  ${r.content.substring(0, 200)}\n\n`;
      }
    }
    return { content: content || 'No results found.' };
  } catch (err) {
    return { content: `Web search failed: ${err instanceof Error ? err.message : 'Unknown error'}. Falling back to model knowledge.` };
  }
}

async function handleGetCreditBalance(companyId: string): Promise<ToolResult> {
  const balance = await creditService.getBalance(companyId);
  const ledger = await creditService.getLedger(companyId, 5);

  let content = `Current balance: **${balance} credits**`;
  if (ledger.length > 0) {
    content += '\n\nRecent activity:';
    for (const entry of ledger) {
      const sign = entry.amount > 0 ? '+' : '';
      content += `\n- ${sign}${entry.amount}: ${entry.description ?? entry.entry_type}`;
    }
  }
  return {
    content,
    action: { type: 'credit_quote', data: { balance, recent: ledger.map(e => ({
      ...e,
      entry_type: e.entry_type as import('@/types').LedgerEntryType,
      created_at: e.created_at?.toISOString() ?? new Date().toISOString(),
    })) } },
  };
}
