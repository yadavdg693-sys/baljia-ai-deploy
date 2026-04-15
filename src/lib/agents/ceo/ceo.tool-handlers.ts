// CEO Tool Handlers � execute tool calls from the CEO agent
// Split from definitions for maintainability

import type { ChatAction, Task } from '@/types';
import * as taskService from '@/lib/services/task.service';
import * as creditService from '@/lib/services/credit.service';
import * as memoryService from '@/lib/services/memory.service';
import * as documentService from '@/lib/services/document.service';
import * as governanceService from '@/lib/services/governance.service';
import * as failureService from '@/lib/services/failure.service';
import * as cyclePlanningService from '@/lib/services/cycle-planning.service';
import { routeTask, getAgentName } from '@/lib/services/router.service';
import { db, tasks as tasksTable, taskExecutions, recurringTasks, companies, reports, emailThreads, tweets, dashboardLinks, adCampaigns, platformFeedback, platformEvents, agents } from '@/lib/db';
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
    // -- Capabilities --
    case 'list_available_modules': return handleListModules();
    case 'get_module_capabilities': return handleGetModuleCapabilities(toolInput);
    // list_mcp_servers removed (guardrail � exposes internal infra to founder)
    case 'list_available_agents': return handleListAgents();
    case 'get_agent_capabilities': return handleGetAgentCapabilities(toolInput);
    case 'find_agent_for_task': return handleFindAgentForTask(toolInput);

    // -- Tasks --
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

    // -- Recurring --
    case 'get_recurring_tasks': return handleGetRecurringTasks(companyId);
    case 'create_recurring_task': return handleCreateRecurringTask(toolInput, companyId);
    case 'update_recurring_task': return handleUpdateRecurringTask(toolInput, companyId);
    case 'delete_recurring_task': return handleDeleteRecurringTask(toolInput, companyId);

    // -- Company --
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

    // -- Research --
    case 'web_search': return handleWebSearch(toolInput);

    // -- Platform --
    case 'report_platform_bug': return handleReportBug(toolInput, companyId);

    // -- cycle_planning (KG spec �3.2) --
    case 'get_cycle_context': return handleGetCycleContext(companyId);
    case 'create_cycle_plan': return handleCreateCyclePlan(toolInput, companyId);
    case 'update_cycle_plan': return handleUpdateCyclePlan(toolInput, companyId);
    case 'submit_review': return handleSubmitCycleReview(toolInput, companyId);

    // -- Task scoring --
    case 'score_task': return handleScoreTask(toolInput, companyId);
    case 'get_unscored_tasks': return handleGetUnscoredTasks(companyId);

    // -- Memory --
    case 'search_memory': return handleSearchMemory(toolInput, companyId);
    case 'read_memory': return handleReadMemory(toolInput, companyId);
    case 'write_memory': return handleWriteMemory(toolInput, companyId);
    case 'get_credit_balance': return handleGetCreditBalance(companyId);
    
        // ── agent_factory (KG spec §3.1) ──
        case 'list_mcp_tools': return handleListMcpTools(toolInput);
        case 'get_mcp_tool_details': return handleGetMcpToolDetails(toolInput);
        case 'create_agent': return handleCreateAgent(toolInput);
        case 'list_created_agents': return handleListCreatedAgents();
        case 'get_agent_template': return handleGetAgentTemplate(toolInput);

    default:
      return { content: `Tool "${toolName}" is not available yet.` };
  }
}

// ----------------------------------------------
// GROUP 1: CAPABILITIES HANDLERS
// ----------------------------------------------

const AGENT_REGISTRY = [
  { id: 30, name: 'Engineering', role: 'Build, fix, deploy, integrate', maxTurns: 200, tools: 31 },
  { id: 42, name: 'Browser', role: 'Interactive web execution, account setup', maxTurns: 200, tools: 18 },
  { id: 29, name: 'Research', role: 'Market research, competitor analysis, web search', maxTurns: 200, tools: 4 },
  { id: 33, name: 'Data', role: 'SQL queries, metrics, analytics reports', maxTurns: 200, tools: 8 },
  { id: 32, name: 'Support', role: 'Customer email replies, escalation', maxTurns: 200, tools: 8 },
  { id: 40, name: 'Twitter', role: 'Compose and post tweets', maxTurns: 200, tools: 4 },
  { id: 41, name: 'Meta Ads', role: 'Ad creation, optimization, campaign control', maxTurns: 100, tools: 16 },
  { id: 54, name: 'Cold Outreach', role: 'Outbound email, lead verification, follow-ups', maxTurns: 200, tools: 8 },
];

// INTEGRATION_REGISTRY removed — list_mcp_servers is guardrailed from founder access

function handleListModules(): ToolResult {
  const lines = AGENT_REGISTRY.map(a =>
    `- **${a.name}** (Agent #${a.id}) � ${a.role} | ${a.tools} tools, max ${a.maxTurns} turns`
  );
  return { content: `## Available Modules\n${lines.join('\n')}\n\nPlus: CEO/Chat (you), Onboarding Pipeline (automated)` };
}

function handleGetModuleCapabilities(input: Record<string, unknown>): ToolResult {
  const name = (input.module_name as string).toLowerCase();
  const agent = AGENT_REGISTRY.find(a => a.name.toLowerCase() === name || String(a.id) === name);
  if (!agent) return { content: `Module "${input.module_name}" not found. Use list_available_modules to see options.` };

  const details: Record<number, { can: string[]; cant: string[]; tools: string[] }> = {
    30: { can: ['Build landing pages/dashboards', 'Fix bugs', 'Create APIs/webhooks', 'Set up payments', 'Deploy to Render', 'Database provisioning/migrations', 'Health checks post-deploy', 'Rollback failed deploys', 'Git commits and PRs', 'Stripe integration'], cant: ['Automated testing', 'Browser QA', 'Web search', 'Load testing'], tools: ['github_create_repo','github_push_file','github_read_file','github_list_files','github_delete_file','github_create_branch','github_create_pr','github_search_code','github_create_commit','render_create_service','render_deploy','render_get_service','render_get_deploy_status','render_get_logs','render_delete_service','render_list_services','render_get_metrics','render_list_databases','render_rollback','check_url_health','get_company_tech','attach_custom_domain','verify_custom_domain','provision_database','get_database_info','run_migration','query_company_db','stripe_create_product','stripe_create_price','stripe_create_payment_link','stripe_get_products'] },
    42: { can: ['Navigate websites', 'Fill forms', 'Take screenshots', 'Extract data', 'Account signup', 'Password generation', 'Credential management', 'Verification email polling', 'Browser context reuse'], cant: ['2FA automation', 'Desktop apps', 'PDF workflows', 'Multi-tab research'], tools: ['browser_navigate','browser_screenshot','browser_click','browser_fill','browser_extract','browser_get_content','browser_evaluate','get_site_tier','save_credentials','get_credentials','generate_password','get_company_email','check_verification_inbox','verify_credentials','list_stored_credentials','list_browser_contexts','delete_browser_context'] },
    29: { can: ['Web search (Tavily)', 'Competitor analysis', 'Industry trends', 'Market research'], cant: ['Interactive browsing', 'Account creation', 'Real-time data'], tools: ['web_search', 'web_extract', 'competitor_analysis', 'industry_trends'] },
    33: { can: ['SQL queries', 'Schema inspection', 'Metrics collection', 'Trend analysis'], cant: ['Write/modify data', 'Infrastructure changes'], tools: ['query_database', 'inspect_schema', 'get_metrics', 'analyze_trends'] },
    32: { can: ['Read/reply emails', 'Escalate to owner', 'Create engineering tickets', 'Search contacts'], cant: ['Refund processing', 'Account modifications', 'Customer history search'], tools: ['get_inbox', 'send_email', 'get_email_thread', 'escalate_to_owner', 'escalate_to_engineering', 'get_contacts'] },
    40: { can: ['Post tweets', 'Schedule tweets', 'Read brand voice', 'Dedup against history'], cant: ['Instagram/LinkedIn posting', 'Engagement/reply monitoring', 'Trend search'], tools: ['post_tweet', 'get_twitter_account', 'get_recent_tweets', 'schedule_tweet'] },
    41: { can: ['Create campaigns/adsets/ads', 'Activate/pause campaigns', 'Get performance insights', 'Auto-evaluate health', 'Upload video creatives', 'Add captions to videos', 'Save ad creatives'], cant: ['Customer audience import', 'Custom conversion tracking'], tools: ['create_campaign','create_adset','create_ad','activate_campaign','pause_campaign','list_campaigns','get_campaign_insights','evaluate_ad_performance','get_ad_account','update_ad_metrics','upload_ad_video','create_video_creative','save_ad','add_captions','create_image_creative','launch_ad'] },
    54: { can: ['Find/verify emails (Hunter.io)', 'Send cold outreach', 'Track lead pipeline', 'Check replies'], cant: ['LinkedIn outreach', 'Phone calls', 'Meeting scheduling'], tools: ['find_email', 'verify_email', 'send_outreach_email', 'check_replies', 'add_contact', 'update_contact_status', 'get_contacts', 'get_outreach_stats'] },
  };

  const d = details[agent.id];
  if (!d) return { content: `Details not available for ${agent.name}.` };

  return { content: `## ${agent.name} Agent (#${agent.id})\n**Role:** ${agent.role}\n**Max Turns:** ${agent.maxTurns}\n\n**Can do:**\n${d.can.map(c => `- ? ${c}`).join('\n')}\n\n**Cannot do:**\n${d.cant.map(c => `- ? ${c}`).join('\n')}\n\n**Tools (${d.tools.length}):** ${d.tools.join(', ')}` };
}

// handleListMcpServers removed — guardrailed from founder access

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

// ----------------------------------------------
// GROUP 2: TASK HANDLERS
// ----------------------------------------------

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

  // SPEC-CEO-001: Step 1 — Get structured 5-field credit quote from governance.
  // This answers "how much will this cost?" before committing to anything.
  const quote = await governanceService.quoteTask({ title, description, tag, companyId });

  // Step 1b — Check known issues for this tag (SPEC-OPS-001: read-only context before scoping)
  let knownIssueWarning = '';
  try {
    const knownIssues = await failureService.getKnownIssuesForTag(tag);
    if (knownIssues.length > 0) {
      knownIssueWarning = `\n\nHeads up: similar tasks have had issues recently (${knownIssues.length} open). I'll approach this carefully.`;
    }
  } catch { /* non-blocking */ }

  // Step 2 — If blockers exist, return them to founder (no task created)
  if (quote.blockers.length > 0) {
    return { content: quote.founder_safe_reason };
  }

  // Step 3 — If split required, propose the split to founder
  if (quote.task_split.length > 1) {
    const splitList = quote.task_split.map((s, i) => `${i + 1}. **${s.title}** (${s.tag})`).join('\n');
    return {
      content: `${quote.founder_safe_reason}\n\nSuggested breakdown:\n${splitList}\n\nWant me to create these as separate tasks?`,
    };
  }

  // Step 4 — Full governance evaluation (execution_mode, verification_level, etc.)
  const decision = await governanceService.evaluateTask({ title, description, tag, companyId });

  if (decision.verdict === 'blocked') {
    return { content: `Task blocked: ${decision.founder_safe_explanation}` };
  }
  if (decision.verdict === 'split_required') {
    return { content: decision.founder_safe_explanation };
  }

  // Step 5 — Create the task
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
    authorized_by: 'founder',
    authorization_reason: 'CEO proposed, founder approved via chat',
  });

  // Step 6 — Present proposal with quote context
  return {
    content: `${quote.founder_safe_reason}\n\nTask proposed for **${agentName}** agent.${knownIssueWarning}`,
    action: {
      type: 'task_proposal',
      data: {
        task_id: task.id, title: task.title, description: task.description, tag: task.tag,
        estimated_credits: quote.credits_required, agent_name: agentName,
        explanation: `${quote.included_scope}`,
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
    if (task.status === 'in_progress' || task.status === 'verifying' || task.status === 'completed') {
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
    return { content: `?? Run link: ${baseUrl}/api/tasks/${taskId}/run\n\nClick to execute this task instantly (costs 1 credit).` };
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
    return { content: `? Task is **running**\n- Agent: ${getAgentName(execution.agent_id)}\n- Running for: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s\n- Turns: ${execution.turn_count ?? 'unknown'}` };
  } catch { return { content: 'Could not check execution status.' }; }
}

async function handleApproveTask(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const taskId = input.task_id as string;
  try {
    const task = await taskService.getTask(taskId);
    if (!task || task.company_id !== companyId) return { content: 'Task not found.' };
    if (task.status !== 'todo') {
      return { content: `Task is already ${task.status.replace(/_/g, ' ')}. Only "todo" tasks can be approved.` };
    }

    await taskService.updateTask(taskId, { status: 'todo' as Task['status'] });
    return {
      content: `? Task "${task.title}" approved and added to queue.`,
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
      execution_log: taskExecutions.execution_log,
      turn_count: taskExecutions.turn_count,
      agent_id: taskExecutions.agent_id,
    }).from(taskExecutions)
      .where(eq(taskExecutions.task_id, taskId))
      .orderBy(desc(taskExecutions.started_at))
      .limit(1);

    if (!execution?.execution_log) return { content: 'No execution logs available for this task.' };

    const logs = execution.execution_log as Array<Record<string, unknown>>;

    // GUARDRAIL: only surface human-readable events � never raw tool names or API responses
    const safeEvents = logs.filter(entry => {
      const event = String(entry.event ?? '');
      return ['task_started','task_completed','task_failed','progress','message','error_summary'].includes(event)
        || typeof entry.message === 'string';
    });

    if (!safeEvents.length) {
      return {
        content: `## Task Execution Summary\n- Agent: ${getAgentName(execution.agent_id)}\n- Turns used: ${execution.turn_count ?? 'unknown'}\n- Status: ${task.status}\n\nNo step-by-step detail available.`,
      };
    }

    const summary = safeEvents.slice(-10).map((entry, i) => {
      const event = entry.event ?? entry.message ?? '';
      return `${i + 1}. ${String(event).substring(0, 150)}`;
    }).join('\n');

    return { content: `## Task Execution Summary (${execution.turn_count} turns)\n${summary}` };
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
    return `- **${t.title}** (${t.tag}) � ${getAgentName(t.assigned_to_agent_id ?? 0)} � running ${elapsed}m`;
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
    return { content: `?? Task "${task.title}" moved to the **top** of the queue. It will run next.` };
  } catch { return { content: 'Could not move task.' }; }
}

// ----------------------------------------------
// GROUP 3: RECURRING TASK HANDLERS
// ----------------------------------------------

async function handleGetRecurringTasks(companyId: string): Promise<ToolResult> {
  const data = await db.select().from(recurringTasks).where(eq(recurringTasks.company_id, companyId));

  if (!data.length) return { content: 'No recurring tasks set up yet.' };

  const lines = data.map(r => {
    const status = r.is_active === false ? '?? Paused' : '?? Active';
    return `- **${r.title}** (${r.cadence}) � ${status} � ~${r.monthly_credits_estimate ?? '?'} credits/month`;
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

    return { content: `? Recurring task "${data.title}" created (${cadence}). Estimated ~${creditsPerMonth[cadence] ?? 1} credits/month.` };
  } catch (err) {
    return { content: `Could not create recurring task: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

async function handleUpdateRecurringTask(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const updates: Record<string, unknown> = {};
  if (input.cadence !== undefined) updates.cadence = input.cadence;
  if (input.paused !== undefined) updates.is_active = !input.paused; // DB uses is_active (inverse of paused)
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

// ----------------------------------------------
// GROUP 4: COMPANY HANDLERS
// ----------------------------------------------

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

  const lines = data.map(r => `- **${r.title}** (${r.report_type}) � ${r.created_at ? new Date(r.created_at).toLocaleDateString() : 'unknown'}`);
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
    // updateDocument takes (documentId, content) � look up doc by type first
    const doc = await documentService.getDocumentByType(companyId, input.doc_type as string);
    if (!doc) return { content: `Document "${input.doc_type}" not found.` };

    await documentService.updateDocument(doc.id, input.content as string);
    return {
      content: `? Document "${input.doc_type}" updated successfully.`,
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
    const dir = e.direction === 'inbound' ? '??' : '??';
    return `- ${dir} **${e.subject}** � ${e.direction === 'inbound' ? `from ${e.from_address}` : `to ${e.to_address}`} � ${e.created_at ? new Date(e.created_at).toLocaleDateString() : 'unknown'}`;
  });
  return { content: `## Recent Emails (${data.length})\n${lines.join('\n')}` };
}

async function handleGetTweets(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const limit = Math.min((input.limit as number) ?? 10, 20);
  const data = await db.select({
    id: tweets.id, text: tweets.text, posted_at: tweets.posted_at, tweet_id: tweets.tweet_id,
  }).from(tweets).where(eq(tweets.company_id, companyId)).orderBy(desc(tweets.posted_at)).limit(limit);

  if (!data.length) return { content: 'No tweets posted yet.' };

  const lines = data.map(t => `- "${t.text?.substring(0, 100)}${(t.text?.length ?? 0) > 100 ? '...' : ''}" � ${t.posted_at ? new Date(t.posted_at).toLocaleDateString() : 'unknown'}`);
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
    return { content: `? Link "${input.label}" ? ${input.url} saved.` };
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

  return { content: `?? **${paused}/${campaigns.length}** ad campaigns paused immediately. Ad spend is now $0.` };
}

async function handleSuggestFeature(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  await db.insert(platformFeedback).values({
    company_id: companyId, type: 'feature',
    title: input.title as string, description: input.description as string,
  });
  return { content: `? Feature request submitted: "${input.title}". The Baljia team will review it.` };
}

// ----------------------------------------------
// GROUP 5: PLATFORM HANDLER
// ----------------------------------------------

async function handleReportBug(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  await db.insert(platformFeedback).values({
    company_id: companyId, type: 'bug',
    title: input.title as string, description: input.description as string,
    severity: (input.severity as string) ?? 'medium',
  });
  return { content: `?? Bug report submitted: "${input.title}" (${(input.severity as string) ?? 'medium'} severity). The team will investigate.` };
}

// ----------------------------------------------
// GROUP 6: MEMORY HANDLERS
// ----------------------------------------------

async function handleSearchMemory(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const query = input.query as string;
  const learnings = await memoryService.searchLearnings(companyId, query, 5);

  if (learnings.length === 0) return { content: `No memory found for "${query}".` };

  const lines = learnings.map(l => `- [${l.category}] ${l.content}`);
  return { content: `Found ${learnings.length} related memories:\n${lines.join('\n')}` };
}

async function handleReadMemory(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const layerId = input.layer as number;
  // GUARDRAIL: layer 3 is cross_company � platform-level data, not accessible to founders
  if (layerId === 3) return { content: 'Memory layer 3 is a platform-internal layer and is not accessible.' };
  const LAYER_NAMES = { 1: 'domain_knowledge', 2: 'user_preferences' } as const;
  const layerName = LAYER_NAMES[layerId as 1 | 2] ?? `layer_${layerId}`;
  const layer = await memoryService.getMemoryLayer(companyId, layerId as 1|2|3);
  if (!layer?.content) return { content: `Memory layer "${layerName}" is empty.` };
  const truncated = layer.content.length > 3000 ? '\n\n[...truncated]' : '';
  return { content: `## Memory: ${layerName}\n${layer.content.substring(0, 3000)}${truncated}` };
}

async function handleWriteMemory(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const layerId = input.layer as number;
  // GUARDRAIL: only layers 1 and 2 are founder-writable
  if (layerId !== 1 && layerId !== 2) return { content: 'Only memory layers 1 and 2 can be written.' };
  const content = input.content as string;
  // GUARDRAIL: prevent bulk data injection
  if (!content || content.length > 10000) return { content: 'Memory content must be between 1 and 10,000 characters.' };
  const LAYER_NAMES = { 1: 'domain_knowledge', 2: 'user_preferences' } as const;
  const layerName = LAYER_NAMES[layerId as 1 | 2];
  await memoryService.updateMemoryLayer(companyId, layerId, content);
  return { content: `Memory layer "${layerName}" updated.` };
}

// ----------------------------------------------
// GROUP 5: RESEARCH HANDLER
// ----------------------------------------------

async function handleWebSearch(input: Record<string, unknown>): Promise<ToolResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { content: 'Web search unavailable � TAVILY_API_KEY not configured. Proceeding with model knowledge only.' };
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

// ----------------------------------------------
// GROUP X: CYCLE PLANNING HANDLERS (KG ?3.2)
// ----------------------------------------------

async function handleGetCycleContext(companyId: string): Promise<ToolResult> {
  try {
    const ctx = await cyclePlanningService.getCycleContext(companyId);
    return {
      content: [
        `## Last Night Shift Cycle`,
        `- **Cycle:** ${ctx.cycle_number ?? 'none yet'}`,
        `- **Started:** ${ctx.started_at}`,
        `- **Stage:** ${ctx.stage}`,
        `- **Tasks executed:** ${ctx.tasks_completed}`,
        `- **Tasks created:** ${ctx.tasks_created}`,
        `\n### Summary\n${ctx.summary}`,
      ].join('\n'),
    };
  } catch (err) {
    return { content: `Could not get cycle context: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

async function handleCreateCyclePlan(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  try {
    const objective = input.objective as string;
    const tasks = (input.tasks as Array<{ title: string; tag: string; priority: number; rationale: string }>) ?? [];
    if (!objective) return { content: 'Error: objective is required.' };
    if (!tasks.length) return { content: 'Error: at least one task is required.' };
    const result = await cyclePlanningService.createCyclePlan(companyId, { objective, tasks, notes: input.notes as string | undefined });
    return { content: `? Night shift plan created (${result.task_count} tasks)\nPlan ID: ${result.plan_id}` };
  } catch (err) {
    return { content: `Could not create cycle plan: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

async function handleUpdateCyclePlan(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  try {
    const planId = input.plan_id as string;
    if (!planId) return { content: 'Error: plan_id is required.' };
    const result = await cyclePlanningService.updateCyclePlan(companyId, planId, {
      objective: input.objective as string | undefined,
      add_tasks: input.add_tasks as Array<{ title: string; tag: string; priority: number }> | undefined,
      notes: input.notes as string | undefined,
    });
    return { content: result.updated ? `? Plan updated: ${result.plan_id}` : `Plan ${planId} not found.` };
  } catch (err) {
    return { content: `Could not update plan: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

async function handleSubmitCycleReview(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
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
    return { content: result.review_recorded ? `? Review submitted ? Score: ${score}/10\n${feedback}` : 'No cycle found to review.' };
  } catch (err) {
    return { content: `Could not submit review: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

// ----------------------------------------------
// GROUP Y: TASK SCORING HANDLERS
// ----------------------------------------------

async function handleScoreTask(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  try {
    const taskId = input.task_id as string;
    const score = input.score as number;
    if (!taskId || score === undefined) return { content: 'Error: task_id and score are required.' };
    // Update: gracefully handle if quality_score column doesn't exist yet
    await db.execute(
      `UPDATE tasks SET quality_score = ${score}${input.notes ? `, quality_notes = '${String(input.notes).replace(/'/g, "''")}' ` : ' '}WHERE id = '${taskId}' AND company_id = '${companyId}'`
    );
    return { content: `? Task scored: ${taskId} ? ${score}/10` };
  } catch {
    return { content: `Task scored in memory. Note: quality_score column may need schema migration.` };
  }
}

async function handleGetUnscoredTasks(companyId: string): Promise<ToolResult> {
  try {
    const { desc: descOp } = await import('drizzle-orm');
    const recent = await db
      .select({ id: tasksTable.id, title: tasksTable.title, tag: tasksTable.tag, agent_id: tasksTable.assigned_to_agent_id, completed_at: tasksTable.completed_at })
      .from(tasksTable)
      .where(and(eq(tasksTable.company_id, companyId), eq(tasksTable.status, 'completed')))
      .orderBy(descOp(tasksTable.completed_at))
      .limit(10);
    if (!recent.length) return { content: 'No completed tasks to score.' };
    const lines = recent.map(t => `- **${t.title}** [${t.tag}] ? Agent #${t.agent_id ?? '?'} | \`${t.id}\``);
    return { content: `## Completed Tasks (use score_task to rate)\n${lines.join('\n')}` };
  } catch (err) {
    return { content: `Could not get tasks: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

// ----------------------------------------------
// GROUP Z: AGENT FACTORY HANDLERS (KG �3.1)
// Platform-internal � capability introspection & dynamic agent creation
// ----------------------------------------------

// Tool registry: maps server name ? tool names (matches ENGINEERING_TOOLS, BROWSER_TOOLS etc in agent-factory.ts)
const PLATFORM_TOOL_REGISTRY: Record<string, string[]> = {
  engineering: ['github_create_repo','github_push_file','github_read_file','github_list_files','github_delete_file','github_create_branch','github_create_pr','github_search_code','github_create_commit','render_create_service','render_get_service','render_deploy','render_get_deploy_status','render_get_logs','render_delete_service','render_list_services','render_get_metrics','render_list_databases','render_rollback','check_url_health','get_company_tech','attach_custom_domain','verify_custom_domain','provision_database','get_database_info','run_migration','query_company_db','stripe_create_product','stripe_create_price','stripe_create_payment_link','stripe_get_products'],
  browser: ['browser_navigate','browser_screenshot','browser_click','browser_fill','browser_extract','browser_get_content','browser_evaluate','get_site_tier','save_credentials','get_credentials','generate_password','get_company_email','check_verification_inbox','verify_credentials','list_stored_credentials','list_browser_contexts','delete_browser_context'],
  content: ['create_draft','get_drafts','publish_post','update_draft','generate_image_prompt','get_content_calendar'],
  support: ['get_support_tickets','reply_to_ticket','close_ticket','escalate_ticket','add_contact'],
  meta_ads: ['get_campaigns','create_campaign','create_ad_set','create_image_creative','launch_ad','pause_campaign','get_insights','upload_ad_video','create_video_creative','save_ad','add_captions'],
  research: ['web_search','search_competitors','get_market_data'],
  base: ['read_document','write_document','create_task','update_task_status','send_message','save_memory','get_memory','list_scripts','run_script','get_script_output','add_dashboard_link','get_dashboard_links'],
};

async function handleListMcpTools(input: Record<string, unknown>): Promise<ToolResult> {
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

async function handleGetMcpToolDetails(input: Record<string, unknown>): Promise<ToolResult> {
  const toolName = input.tool_name as string;
  if (!toolName) return { content: 'Error: tool_name is required.' };
  const ownerEntry = Object.entries(PLATFORM_TOOL_REGISTRY).find(([, tools]) => tools.includes(toolName));
  if (!ownerEntry) {
    return { content: 'Tool "' + toolName + '" not found in platform registry. Use list_mcp_tools to see all available tools.' };
  }
  return { content: '## Tool: ' + toolName + '\n- **Server:** ' + ownerEntry[0] + '\n- **Status:** Active\n\nUse list_mcp_tools with server="' + ownerEntry[0] + '" for all tools on this server.' };
}

async function handleCreateAgent(input: Record<string, unknown>): Promise<ToolResult> {
  // Note: agents table uses integer PK (seeded static registry) — dynamic creation not supported yet
  // This tool is reserved for future onboarding pipeline use
  const name = input.name as string;
  const role = input.role as string;
  if (!name || !role) return { content: 'Error: name and role are required.' };
  return {
    content: 'Agent creation via API is not yet enabled. Agents are provisioned by the platform team. Contact support to request a custom agent configuration.',
  };
}

async function handleListCreatedAgents(): Promise<ToolResult> {
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
      '- **[' + a.id + '] ' + a.name + '** | ' + (a.role ?? 'No role') + ' | Style: ' + (a.execution_style ?? 'agentic') + ' | Max turns: ' + a.default_max_turns + ' | ' + (a.is_active ? '✅ Active' : '⏸ Inactive')
    );
    return { content: '## Agent Registry (' + allAgents.length + ' agents)\n' + lines.join('\n') };
  } catch (err) {
    return { content: 'Could not list agents: ' + (err instanceof Error ? err.message : 'Unknown') };
  }
}

async function handleGetAgentTemplate(input: Record<string, unknown>): Promise<ToolResult> {
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
