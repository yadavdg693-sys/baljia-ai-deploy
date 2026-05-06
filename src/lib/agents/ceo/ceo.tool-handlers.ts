// CEO Tool Handlers � execute tool calls from the CEO agent
// Split from definitions for maintainability

import type { ChatAction, Task } from '@/types';
import * as taskService from '@/lib/services/task.service';
import * as creditService from '@/lib/services/credit.service';
import * as memoryService from '@/lib/services/memory.service';
import * as documentService from '@/lib/services/document.service';
import * as governanceService from '@/lib/services/governance.service';
import * as failureService from '@/lib/services/failure.service';
import * as eventService from '@/lib/services/event.service';
import { routeTask, getAgentName, getCreditCostForTask } from '@/lib/services/router.service';
import { db, tasks as tasksTable, taskExecutions, recurringTasks, companies, reports, emailThreads, tweets, dashboardLinks, adCampaigns, platformFeedback, platformEvents, users, subscriptions } from '@/lib/db';
import { eq, and, desc, ilike, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('CEO.Tools');

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
    case 'list_mcp_servers': return handleListMcpServers();
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
    case 'read_context_graph': return handleReadContextGraph(toolInput, companyId);

    // -- Research --
    case 'web_search': return handleWebSearch(toolInput);
    case 'web_extract': return handleWebExtract(toolInput);

    // -- Platform --
    case 'report_platform_bug': return handleReportBug(toolInput, companyId);

    // -- Memory --
    case 'search_memory': return handleSearchMemory(toolInput, companyId);
    case 'read_memory': return handleReadMemory(toolInput, companyId);
    case 'get_credit_balance': return handleGetCreditBalance(companyId);

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

const INTEGRATION_REGISTRY = [
  { name: 'engineering', status: 'active', description: 'GitHub, Render, Stripe, database provisioning' },
  { name: 'browser', status: 'active', description: 'Browserbase — cloud browser automation, form filling, scraping' },
  { name: 'research', status: 'active', description: 'Tavily — web search, content extraction' },
  { name: 'support', status: 'active', description: 'Postmark — transactional email, company inbox' },
  { name: 'twitter', status: 'active', description: 'Twitter API — tweet posting, scheduling' },
  { name: 'meta_ads', status: 'active', description: 'Meta Marketing API — ad campaigns, creatives, audiences' },
  { name: 'outreach', status: 'active', description: 'Hunter.io — email finding, verification, cold outreach' },
  { name: 'data', status: 'active', description: 'Company database — SQL queries, schema inspection, analytics' },
  { name: 'storage', status: 'active', description: 'R2 object storage — asset storage for generated content' },
];

function handleListMcpServers(): ToolResult {
  const lines = INTEGRATION_REGISTRY.map(s =>
    `- **${s.name}** (${s.status}): ${s.description}`
  );
  return { content: `## Connected Integrations (${INTEGRATION_REGISTRY.length} servers)\n\n${lines.join('\n')}` };
}

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
    42: { can: ['Navigate websites', 'Fill forms', 'Take screenshots', 'Extract data', 'Account signup', 'Password generation', 'Credential management', 'Verification email polling', 'Browser context reuse', 'Site memory across tasks', 'Provider bootstrap packs (OpenAI/Stripe/etc signup recipes)', 'OCR for canvas/image/PDF text', 'Send mail from company inbox', 'Cheap HTTP fetch (skip Browserbase for APIs)', 'Save + search contacts'], cant: ['2FA automation', 'Desktop apps', 'Multi-tab research'], tools: ['browser_navigate','browser_screenshot','browser_click','browser_fill','browser_extract','browser_get_content','browser_evaluate','get_site_tier','save_credentials','get_credentials','generate_password','get_company_email','check_verification_inbox','verify_credentials','list_stored_credentials','list_browser_contexts','delete_browser_context','record_domain_skill','read_domain_skills','list_provider_packs','start_provider_pack','ocr_current_page','ocr_click_text','ocr_image','get_inbox','get_email_thread','wait_for_email','send_company_email','http_fetch','add_contact','get_contacts'] },
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
    const taskList = statusTasks.map((t) => `  - [${t.id}] ${t.title} (${t.tag})`).join('\n');
    return `**${status}** (${statusTasks.length}):\n${taskList}`;
  });

  return { content: lines.join('\n\n') };
}

async function handleCreateTask(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const title = input.title as string;
  const description = input.description as string;
  const tag = input.tag as string;
  const relatedTaskIds = (input.related_task_ids as string[] | undefined) ?? [];
  // Complexity 1-10. CEO must pass this; clamp into range and default to 5 if missing.
  const rawComplexity = typeof input.complexity === 'number' ? input.complexity : 5;
  const complexity = Math.max(1, Math.min(10, Math.round(rawComplexity)));

  // Step 1 — Classify execution mode + check prerequisites (NOT credits)
  const decision = await governanceService.evaluateTask({ title, description, tag, companyId });

  // Block only on real prerequisites (OAuth, etc.) — NOT on zero credits
  if (!decision.can_execute && decision.blocker !== 'no_credits') {
    return { content: `Can't run this yet: ${decision.blocker}` };
  }

  // Step 2 — Check known issues (non-blocking context)
  let knownIssueWarning = '';
  try {
    const knownIssues = await failureService.getKnownIssuesForTag(tag);
    if (knownIssues.length > 0) {
      knownIssueWarning = `\n\nHeads up: similar tasks have had issues recently (${knownIssues.length} open). I'll approach this carefully.`;
    }
  } catch { /* non-blocking */ }

  // Step 3 — Route to agent + compute credit cost (Browser+heavy = 2, else 1)
  const agentId = routeTask(tag);
  const agentName = getAgentName(agentId);
  const creditCost = getCreditCostForTask(tag, complexity);

  const task = await taskService.createTask({
    company_id: companyId, title, description, tag,
    source: 'ceo_suggested',
    execution_mode: decision.execution_mode,
    verification_level: decision.verification_level,
    assigned_to_agent_id: agentId,
    estimated_credits: creditCost,
    related_task_ids: relatedTaskIds.length > 0 ? relatedTaskIds : undefined,
    authorized_by: 'founder',
    authorization_reason: 'CEO proposed, founder approved via chat',
  });

  // Step 4 — Emit event for real-time dashboard update
  await eventService.emit(companyId, 'task_created', {
    task_id: task.id, title: task.title, tag: task.tag, source: 'ceo_suggested',
  });

  // Step 5 — Return clean confirmation with run link
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://baljia.ai';
  const runLink = `${baseUrl}/api/tasks/${task.id}/run`;
  const failureNote = decision.failure_warning ? `\n\n${decision.failure_warning}` : '';
  const creditNote = decision.credit_warning
    ? '\n\nYou\'re at 0 credits right now. The task is queued — add credits when you\'re ready to run it.'
    : '';
  const creditLabel = creditCost === 1 ? '1 credit' : `${creditCost} credits`;
  return {
    content: `Task created: "${task.title}" [${task.id}] — ${creditLabel}. ${agentName} agent will handle this.\n\nRun link: ${runLink}${knownIssueWarning}${failureNote}${creditNote}`,
    action: {
      type: 'task_proposal',
      data: {
        task_id: task.id, title: task.title, description: task.description, tag: task.tag,
        estimated_credits: creditCost, agent_name: agentName, run_link: runLink,
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

    // Quick pre-checks before launch
    const balance = await creditService.getBalance(companyId);
    if (balance < 1) {
      return { content: `Not enough credits to run "${task.title}". You need at least 1 credit.` };
    }

    // Record authorization
    await taskService.updateTask(taskId, {
      authorized_by: 'founder',
      authorization_reason: 'Founder approved via CEO chat',
    });

    // Launch in background — don't block the CEO conversation
    const { launchTask } = await import('@/lib/agents/worker-launcher');
    void launchTask(taskId).catch((err) => {
      const error = err instanceof Error ? err.message : String(err);
      log.error('launchTask after CEO approve failed', { taskId, companyId, error });
      void eventService.emit(companyId, 'task_launch_failed', {
        task_id: taskId,
        title: task.title,
        error,
      }).catch((emitError) => {
        log.error('Failed to emit task_launch_failed', {
          taskId,
          companyId,
          error: emitError instanceof Error ? emitError.message : String(emitError),
        });
      });
    });

    return {
      content: `Task "${task.title}" approved and queued for execution. I'll check the worker status next.`,
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
    lifecycle: companies.lifecycle,
    plan_tier: companies.plan_tier, custom_domain: companies.custom_domain,
    owner_id: companies.owner_id,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);

  if (!company) return { content: 'Company not found.' };

  const balance = await creditService.getBalance(companyId);
  const docs = await documentService.getDocuments(companyId);
  const nonEmpty = docs.filter(d => !d.is_empty).map(d => d.doc_type).join(', ');
  const empty = docs.filter(d => d.is_empty).map(d => d.doc_type).join(', ');

  // Subscription details — night shifts, status, trial
  let subLine = 'No active subscription';
  try {
    const [sub] = await db.select({
      status: subscriptions.status,
      plan_type: subscriptions.plan_type,
      night_shifts_remaining: subscriptions.night_shifts_remaining,
      trial_ends_at: subscriptions.trial_ends_at,
    }).from(subscriptions).where(eq(subscriptions.company_id, companyId)).limit(1);
    if (sub) {
      subLine = `${sub.plan_type} (${sub.status})`;
      if (sub.night_shifts_remaining !== null) subLine += ` — ${sub.night_shifts_remaining} autopilot runs remaining`;
      if (sub.trial_ends_at) subLine += ` — trial ends ${new Date(sub.trial_ends_at).toLocaleDateString()}`;
    }
  } catch { /* continue without subscription data */ }

  // Referral link
  let referralLine = '';
  try {
    if (company.owner_id) {
      const [owner] = await db.select({ referral_code: users.referral_code })
        .from(users).where(eq(users.id, company.owner_id)).limit(1);
      if (owner?.referral_code) {
        referralLine = `\n- **Referral link:** https://baljia.ai/?ref=${owner.referral_code}`;
      }
    }
  } catch { /* continue without referral data */ }

  return {
    content: `## ${company.name}\n- **Slug:** ${company.slug}\n- **One-liner:** ${company.one_liner ?? 'Not set'}\n- **Lifecycle:** ${(company.lifecycle ?? 'trial_active').replace(/_/g, ' ')}\n- **Plan:** ${company.plan_tier}\n- **Subscription:** ${subLine}\n- **Credits:** ${balance}\n- **Domain:** ${company.custom_domain ?? `${company.slug}.baljia.app`}${referralLine}\n\n**Documents filled:** ${nonEmpty || 'none'}\n**Documents empty:** ${empty || 'none'}`,
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
    source: 'user',
    area: 'platform',
  });
  return { content: `Feature request submitted: "${input.title}". The Baljia team will review it.` };
}

async function handleReadContextGraph(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  const requestedNodes = (input.nodes as string[] | undefined) ?? ['revenue', 'active_work', 'support', 'user'];
  const sections: string[] = [];

  if (requestedNodes.includes('revenue')) {
    try {
      const balance = await creditService.getBalance(companyId);
      const ledger = await creditService.getLedger(companyId, 5);
      const [sub] = await db.select({ status: subscriptions.status, plan_type: subscriptions.plan_type })
        .from(subscriptions).where(eq(subscriptions.company_id, companyId)).limit(1);
      const recentSpend = ledger.filter(e => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0);
      sections.push(`## Revenue\n- Credits: ${balance}\n- Plan: ${sub?.plan_type ?? 'none'} (${sub?.status ?? 'inactive'})\n- Recent spend: ${recentSpend} credits (last ${ledger.length} entries)`);
    } catch { sections.push('## Revenue\nUnavailable'); }
  }

  if (requestedNodes.includes('active_work')) {
    try {
      const activeTasks = await db.select({ id: tasksTable.id, title: tasksTable.title, status: tasksTable.status, tag: tasksTable.tag })
        .from(tasksTable).where(and(eq(tasksTable.company_id, companyId), sql`${tasksTable.status} IN ('todo', 'in_progress')`))
        .orderBy(desc(tasksTable.created_at)).limit(10);
      const recentDone = await db.select({ id: tasksTable.id, title: tasksTable.title, completed_at: tasksTable.completed_at })
        .from(tasksTable).where(and(eq(tasksTable.company_id, companyId), eq(tasksTable.status, 'completed' as never)))
        .orderBy(desc(tasksTable.completed_at)).limit(5);
      const activeLines = activeTasks.map(t => `  - [${t.status}] ${t.title} (${t.tag})`).join('\n') || '  None';
      const doneLines = recentDone.map(t => `  - ${t.title}`).join('\n') || '  None';
      sections.push(`## Active Work\n**Queue (${activeTasks.length}):**\n${activeLines}\n\n**Recently completed:**\n${doneLines}`);
    } catch { sections.push('## Active Work\nUnavailable'); }
  }

  if (requestedNodes.includes('support')) {
    try {
      const recentEmails = await db.select({ id: emailThreads.id, subject: emailThreads.subject, direction: emailThreads.direction })
        .from(emailThreads).where(eq(emailThreads.company_id, companyId))
        .orderBy(desc(emailThreads.created_at)).limit(5);
      const emailLines = recentEmails.map(e => `  - [${e.direction}] ${e.subject ?? 'No subject'}`).join('\n') || '  No emails';
      sections.push(`## Support\n**Recent emails (${recentEmails.length}):**\n${emailLines}`);
    } catch { sections.push('## Support\nUnavailable'); }
  }

  if (requestedNodes.includes('user')) {
    try {
      const memoryLayer = await memoryService.getMemoryLayer(companyId, 2);
      const memoryContent = memoryLayer?.content ?? '';
      const memoryPreview = memoryContent ? memoryContent.substring(0, 300) + (memoryContent.length > 300 ? '...' : '') : 'Empty';
      sections.push(`## User Context\n**Preferences (Layer 2):**\n${memoryPreview}`);
    } catch { sections.push('## User Context\nUnavailable'); }
  }

  return { content: sections.join('\n\n') || 'No context nodes requested.' };
}

// ----------------------------------------------
// GROUP 5: PLATFORM HANDLER
// ----------------------------------------------

async function handleReportBug(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {
  await db.insert(platformFeedback).values({
    company_id: companyId, type: 'bug',
    title: input.title as string, description: input.description as string,
    severity: (input.severity as string) ?? 'medium',
    source: 'user',
    area: 'platform',
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
  const layerId = Number(input.layer);
  // GUARDRAIL: layer 3 is cross_company � platform-level data, not accessible to founders
  if (layerId === 3) return { content: 'Memory layer 3 is a platform-internal layer and is not accessible.' };
  const LAYER_NAMES = { 1: 'domain_knowledge', 2: 'user_preferences' } as const;
  const layerName = LAYER_NAMES[layerId as 1 | 2] ?? `layer_${layerId}`;
  const layer = await memoryService.getMemoryLayer(companyId, layerId as 1|2|3);
  if (!layer?.content) return { content: `Memory layer "${layerName}" is empty.` };
  const truncated = layer.content.length > 3000 ? '\n\n[...truncated]' : '';
  return { content: `## Memory: ${layerName}\n${layer.content.substring(0, 3000)}${truncated}` };
}

// ----------------------------------------------
// GROUP 5: RESEARCH HANDLER
// ----------------------------------------------

async function handleWebSearch(input: Record<string, unknown>): Promise<ToolResult> {
  const { isTavilyAvailable, tavilySearch } = await import('@/lib/tavily');
  if (!isTavilyAvailable()) {
    return { content: 'Web search unavailable — no Tavily API keys configured. Proceeding with model knowledge only.' };
  }

  try {
    const data = await tavilySearch({
      query: input.query as string,
      maxResults: 5,
      searchDepth: 'advanced',
    });

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

async function handleWebExtract(input: Record<string, unknown>): Promise<ToolResult> {
  const { isTavilyAvailable, getNextTavilyKey } = await import('@/lib/tavily');
  if (!isTavilyAvailable()) {
    return { content: 'Content extraction unavailable — no Tavily API keys configured.' };
  }

  const url = input.url as string;
  try {
    const key = getNextTavilyKey();
    const response = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, urls: [url] }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`Extract failed: ${response.status}`);
    const data = await response.json() as { results: Array<{ raw_content: string }> };
    const content = data.results?.[0]?.raw_content ?? 'No content extracted';
    return { content: content.substring(0, 3000) };
  } catch (err) {
    return { content: `Failed to extract from ${url}: ${err instanceof Error ? err.message : 'Unknown error'}` };
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

