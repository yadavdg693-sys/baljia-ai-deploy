const fs = require('fs');
const file = 'src/lib/agents/ceo/ceo.tool-handlers.ts';
let content = fs.readFileSync(file, 'utf8');

// 1. Add dispatch cases before default:
const defaultCase = "    default:\n      return { content: `Tool \"${toolName}\" is not available yet.` };";
const newCases = [
  "    // ── agent_factory (KG spec §3.1) ──",
  "    case 'list_mcp_tools': return handleListMcpTools(toolInput);",
  "    case 'get_mcp_tool_details': return handleGetMcpToolDetails(toolInput);",
  "    case 'create_agent': return handleCreateAgent(toolInput);",
  "    case 'list_created_agents': return handleListCreatedAgents();",
  "    case 'get_agent_template': return handleGetAgentTemplate(toolInput);",
  "",
  "    default:",
  "      return { content: `Tool \"${toolName}\" is not available yet.` };",
].join('\n');

content = content.replace(defaultCase, newCases);

// 2. Append handler implementations at end
const handlers = `
// ══════════════════════════════════════════════
// GROUP Z: AGENT FACTORY HANDLERS (KG §3.1)
// Platform-internal — capability introspection & dynamic agent creation
// ══════════════════════════════════════════════

// Tool registry: maps server name → tool names (matches ENGINEERING_TOOLS, BROWSER_TOOLS etc in agent-factory.ts)
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
    return { content: \`No tools found for server "\${filterServer}". Available: \${Object.keys(PLATFORM_TOOL_REGISTRY).join(', ')}\` };
  }

  const lines = entries.map(([server, tools]) =>
    \`### \${server} (\${tools.length} tools)\n\${tools.map(t => \`  - \${t}\`).join('\n')}\`
  );

  const total = entries.reduce((sum, [, tools]) => sum + tools.length, 0);
  return { content: \`## Platform Tool Registry (\${total} tools across \${entries.length} servers)\n\n\${lines.join('\n\n')}\` };
}

async function handleGetMcpToolDetails(input: Record<string, unknown>): Promise<ToolResult> {
  const toolName = input.tool_name as string;
  if (!toolName) return { content: 'Error: tool_name is required.' };

  // Find which server owns this tool
  const ownerServer = Object.entries(PLATFORM_TOOL_REGISTRY).find(([, tools]) =>
    tools.includes(toolName)
  );

  if (!ownerServer) {
    return { content: \`Tool "\${toolName}" not found in platform registry. Use list_mcp_tools to see all available tools.\` };
  }

  return {
    content: \`## Tool: \${toolName}\n- **Server:** \${ownerServer[0]}\n- **Status:** Active\n\nUse list_mcp_tools with server="\${ownerServer[0]}" for all tools on this server.\`,
  };
}

async function handleCreateAgent(input: Record<string, unknown>): Promise<ToolResult> {
  try {
    const name = input.name as string;
    const role = input.role as string;
    const basePrompt = input.base_prompt as string | undefined;
    const maxTurns = (input.max_turns as number) ?? 200;

    if (!name || !role) return { content: 'Error: name and role are required.' };

    // Insert into agents table — platform agent registry
    const [agent] = await db.insert(agents).values({
      name,
      role,
      base_system_prompt: basePrompt ?? null,
      default_max_turns: maxTurns,
      execution_style: 'agentic',
      is_active: true,
    }).returning({ id: agents.id, name: agents.name });

    return { content: \`✅ Agent created\n- **Name:** \${agent.name}\n- **ID:** \${agent.id}\n- **Max turns:** \${maxTurns}\` };
  } catch (err) {
    return { content: \`Could not create agent: \${err instanceof Error ? err.message : 'Unknown'}\` };
  }
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

    const lines = allAgents.map(a =>
      \`- **[\${a.id}] \${a.name}** | \${a.role ?? 'No role'} | Style: \${a.execution_style ?? 'agentic'} | Max turns: \${a.default_max_turns} | \${a.is_active ? '✅ Active' : '⏸ Inactive'}\`
    );

    return { content: \`## Agent Registry (\${allAgents.length} agents)\n\${lines.join('\n')}\` };
  } catch (err) {
    return { content: \`Could not list agents: \${err instanceof Error ? err.message : 'Unknown'}\` };
  }
}

async function handleGetAgentTemplate(input: Record<string, unknown>): Promise<ToolResult> {
  const agentType = (input.agent_type as string)?.toLowerCase();

  const templates: Record<string, { role: string; base_prompt: string; max_turns: number }> = {
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
    return { content: \`Unknown agent type "\${agentType}". Available: \${Object.keys(templates).join(', ')}\` };
  }

  return {
    content: [
      \`## Agent Template: \${agentType}\`,
      \`**Role:** \${template.role}\`,
      \`**Max turns:** \${template.max_turns}\`,
      \`\n### Base Prompt\n\\\`\\\`\\\`\n\${template.base_prompt}\n\\\`\\\`\\\`\`,
      \`\nUse create_agent with these values to create this agent type.\`,
    ].join('\n'),
  };
}
`;

content += handlers;
fs.writeFileSync(file, content, 'utf8');
console.log('agent_factory handlers added successfully');
