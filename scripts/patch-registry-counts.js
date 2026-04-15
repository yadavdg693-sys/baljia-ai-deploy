const fs = require('fs');
const file = 'src/lib/agents/ceo/ceo.tool-handlers.ts';
let content = fs.readFileSync(file, 'utf8');

// ── 1. Update AGENT_REGISTRY tool counts (use regex to handle CRLF) ──
content = content.replace(
  /\{ id: 30, name: 'Engineering'[^}]+tools: \d+ \}/,
  "{ id: 30, name: 'Engineering', role: 'Build, fix, deploy, integrate', maxTurns: 200, tools: 31 }"
);
content = content.replace(
  /\{ id: 42, name: 'Browser'[^}]+tools: \d+ \}/,
  "{ id: 42, name: 'Browser', role: 'Interactive web execution, account setup', maxTurns: 200, tools: 18 }"
);
content = content.replace(
  /\{ id: 29, name: 'Research'[^}]+tools: \d+ \}/,
  "{ id: 29, name: 'Research', role: 'Market research, competitor analysis, web search', maxTurns: 200, tools: 4 }"
);
content = content.replace(
  /\{ id: 33, name: 'Data'[^}]+tools: \d+ \}/,
  "{ id: 33, name: 'Data', role: 'SQL queries, metrics, analytics reports', maxTurns: 200, tools: 8 }"
);
content = content.replace(
  /\{ id: 32, name: 'Support'[^}]+tools: \d+ \}/,
  "{ id: 32, name: 'Support', role: 'Customer email replies, escalation', maxTurns: 200, tools: 8 }"
);
content = content.replace(
  /\{ id: 40, name: 'Twitter'[^}]+tools: \d+ \}/,
  "{ id: 40, name: 'Twitter', role: 'Compose and post tweets', maxTurns: 200, tools: 4 }"
);
content = content.replace(
  /\{ id: 41, name: 'Meta Ads'[^}]+tools: \d+ \}/,
  "{ id: 41, name: 'Meta Ads', role: 'Ad creation, optimization, campaign control', maxTurns: 100, tools: 16 }"
);
content = content.replace(
  /\{ id: 54, name: 'Cold Outreach'[^}]+tools: \d+ \}/,
  "{ id: 54, name: 'Cold Outreach', role: 'Outbound email, lead verification, follow-ups', maxTurns: 200, tools: 8 }"
);
console.log('AGENT_REGISTRY tool counts updated');

// ── 2. Update Engineering capability details ──
content = content.replace(
  /30: \{ can: \[.*?\], cant: \[.*?\], tools: \[.*?\] \},/,
  "30: { can: ['Build landing pages/dashboards', 'Fix bugs', 'Create APIs/webhooks', 'Set up payments', 'Deploy to Render', 'Database provisioning/migrations', 'Health checks post-deploy', 'Rollback failed deploys', 'Git commits and PRs', 'Stripe integration'], cant: ['Automated testing', 'Browser QA', 'Web search', 'Load testing'], tools: ['github_create_repo','github_push_file','github_read_file','github_list_files','github_delete_file','github_create_branch','github_create_pr','github_search_code','github_create_commit','render_create_service','render_deploy','render_get_service','render_get_deploy_status','render_get_logs','render_delete_service','render_list_services','render_get_metrics','render_list_databases','render_rollback','check_url_health','get_company_tech','attach_custom_domain','verify_custom_domain','provision_database','get_database_info','run_migration','query_company_db','stripe_create_product','stripe_create_price','stripe_create_payment_link','stripe_get_products'] },"
);
console.log('Engineering details updated');

// ── 3. Update Browser capability details ──
content = content.replace(
  /42: \{ can: \[.*?\], cant: \[.*?\], tools: \[.*?\] \},/,
  "42: { can: ['Navigate websites', 'Fill forms', 'Take screenshots', 'Extract data', 'Account signup', 'Password generation', 'Credential management', 'Verification email polling', 'Browser context reuse'], cant: ['2FA automation', 'Desktop apps', 'PDF workflows', 'Multi-tab research'], tools: ['browser_navigate','browser_screenshot','browser_click','browser_fill','browser_extract','browser_get_content','browser_evaluate','get_site_tier','save_credentials','get_credentials','generate_password','get_company_email','check_verification_inbox','verify_credentials','list_stored_credentials','list_browser_contexts','delete_browser_context'] },"
);
console.log('Browser details updated');

// ── 4. Update Meta Ads capability details ──
content = content.replace(
  /41: \{ can: \[.*?\], cant: \[.*?\], tools: \[.*?\] \},/,
  "41: { can: ['Create campaigns/adsets/ads', 'Activate/pause campaigns', 'Get performance insights', 'Auto-evaluate health', 'Upload video creatives', 'Add captions to videos', 'Save ad creatives'], cant: ['Customer audience import', 'Custom conversion tracking'], tools: ['create_campaign','create_adset','create_ad','activate_campaign','pause_campaign','list_campaigns','get_campaign_insights','evaluate_ad_performance','get_ad_account','update_ad_metrics','upload_ad_video','create_video_creative','save_ad','add_captions','create_image_creative','launch_ad'] },"
);
console.log('Meta Ads details updated');

// ── 5. Remove dead INTEGRATION_REGISTRY const and handleListMcpServers function ──
content = content.replace(
  /const INTEGRATION_REGISTRY[\s\S]*?(?=function handleListModules|function handleListAgents)/,
  '// INTEGRATION_REGISTRY removed — list_mcp_servers is guardrailed from founder access\n\n'
);
console.log('Dead INTEGRATION_REGISTRY removed');

fs.writeFileSync(file, content, 'utf8');
console.log('\nAll patches applied successfully.');
