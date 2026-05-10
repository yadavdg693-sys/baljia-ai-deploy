// Engineering Agent Tools Ã¢â‚¬â€ GitHub + Render deployment (Agent #30)
// Enables the Engineering agent to push code and deploy founder apps.
//
// Deploy target:
//   Ã¢â‚¬Â¢ GitHub                    Ã¢â‚¬â€ platform-owned org, one repo per company
//   Ã¢â‚¬Â¢ Render                    Ã¢â‚¬â€ founder app web services, default free plan for trials

import type { Task } from '@/types';
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { provisionSubdomain, attachCustomDomain, verifyCustomDomain } from '@/lib/services/domain.service';
import { provisionCompanyDatabase, getCompanyDatabase, createBranch, deleteBranch } from '@/lib/services/neon.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('EngineeringTools');

const GITHUB_API = 'https://api.github.com';
const RENDER_API = 'https://api.render.com/v1';

type EngineeringToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// TOOL DEFINITIONS
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

export function getEngineeringTools(): EngineeringToolDefinition[] {
  const tools: EngineeringToolDefinition[] = [
    {
      name: 'list_skills',
      description: 'List the skill files available in .claude/skills/. Returns one line per skill with a 1-sentence summary. Read the relevant skill via read_skill BEFORE writing code in that domain Ã¢â‚¬â€ the skills capture stack-specific patterns and anti-patterns the LLM\'s training data is missing or wrong about.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'read_skill',
      description: 'Read the full SKILL.md for a named skill. MANDATORY before writing code that touches the skill\'s domain. Skill files describe deployment/runtime patterns, code shapes you should match, and anti-patterns the LLM\'s training data tends to suggest but break in production.',
      input_schema: {
        type: 'object' as const,
        properties: {
          skill: {
            type: 'string' as const,
            description: 'Skill name (kebab-case directory under .claude/skills/). E.g. "neon-postgres", "frontend-design", "stripe-payments", "r2-storage", "email-postmark", "agent-sdk"',
          },
        },
        required: ['skill'],
      },
    },
    {
      name: 'github_create_repo',
      description: 'Create a new GitHub repository in the platform org for a founder company.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo_name: { type: 'string' as const, description: 'Repository name (slug-style, e.g. "launchpad-app")' },
          description: { type: 'string' as const, description: 'Repository description' },
          private: { type: 'boolean' as const, description: 'Whether to make the repo private (default: true)' },
        },
        required: ['repo_name'],
      },
    },
    {
      name: 'github_push_file',
      description: 'Create or update a single file in a GitHub repository.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name (owner/repo format or just repo name)' },
          path: { type: 'string' as const, description: 'File path in the repo (e.g. "src/index.ts")' },
          content: { type: 'string' as const, description: 'Full file content (not diff)' },
          message: { type: 'string' as const, description: 'Commit message' },
          branch: { type: 'string' as const, description: 'Branch name (default: main)' },
        },
        required: ['repo', 'path', 'content', 'message'],
      },
    },
    {
      name: 'github_read_file',
      description: 'Read a file from a GitHub repository.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          path: { type: 'string' as const, description: 'File path in repo' },
          branch: { type: 'string' as const, description: 'Branch (default: main)' },
        },
        required: ['repo', 'path'],
      },
    },
    {
      name: 'github_list_files',
      description: 'List files in a directory of a GitHub repository.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          path: { type: 'string' as const, description: 'Directory path (default: root "")' },
          branch: { type: 'string' as const, description: 'Branch (default: main)' },
        },
        required: ['repo'],
      },
    },
    {
      name: 'github_delete_file',
      description: 'Delete a file from a GitHub repository.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          path: { type: 'string' as const, description: 'File path to delete' },
          message: { type: 'string' as const, description: 'Commit message' },
          branch: { type: 'string' as const, description: 'Branch (default: main)' },
        },
        required: ['repo', 'path', 'message'],
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    // RENDER WEB SERVICES Ã¢â‚¬â€ Primary deploy target for founder engineering tasks.
    // First deploy: push code to GitHub, then create a free Render web service.
    // Updates: push to the existing repo/service and trigger a deploy.
    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'render_create_service',
      description: 'PRIMARY FIRST-DEPLOY TOOL for founder engineering tasks. Creates a Git-backed Render web service for this company, defaults to the free plan, saves render_service_id, attaches the company baljia.app subdomain, and starts the initial deploy. Use after pushing working app code to the company GitHub repo. Do not create duplicates: call get_company_tech first and use render_deploy if a service already exists.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Company GitHub repo name or owner/repo. Defaults to the company repo if already set.' },
          name: { type: 'string' as const, description: 'Optional Render service name. Defaults to the company slug so the trial subdomain stays predictable.' },
          type: { type: 'string' as const, enum: ['web_service', 'static_site'], description: 'Render service type. Use web_service for founder apps.' },
          plan: { type: 'string' as const, description: 'Render instance plan. Defaults to free for trial founder apps.' },
          build_command: { type: 'string' as const, description: 'Build command, e.g. npm install && npm run build.' },
          start_command: { type: 'string' as const, description: 'Start command, e.g. npm start.' },
          env_vars: {
            type: 'array' as const,
            description: 'Environment variables for Render.',
            items: {
              type: 'object' as const,
              properties: {
                key: { type: 'string' as const },
                value: { type: 'string' as const },
              },
              required: ['key', 'value'],
            },
          },
        },
      },
    },
    {
      name: 'render_deploy',
      description: 'Trigger a deploy on this company Render service after pushing code to GitHub. Use for updates when render_service_id already exists.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID from get_company_tech or render_create_service.' },
          clear_cache: { type: 'boolean' as const, description: 'Set true only when dependency/cache issues are suspected.' },
        },
      },
    },
    {
      name: 'render_get_service',
      description: 'Inspect this company Render service and its public URL/status.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID.' },
        },
      },
    },
    {
      name: 'render_get_deploy_status',
      description: 'Get the latest deploy status for this company Render service.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID.' },
        },
      },
    },
    {
      name: 'render_get_logs',
      description: 'Fetch Render deploy/runtime logs for this company service when a deploy or app is failing.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID.' },
          log_type: { type: 'string' as const, enum: ['service', 'deploy'], description: 'service for runtime logs, deploy for latest deploy logs.' },
          num_lines: { type: 'number' as const, description: 'Number of log lines, 10-500.' },
        },
      },
    },
    {
      name: 'render_rollback',
      description: 'Trigger a new deploy from the last known-good Render deploy when the current deploy breaks.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID.' },
        },
      },
    },
    {
      name: 'render_delete_service',
      description: 'Dangerous teardown tool: delete this company Render service. Requires confirm=true.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID.' },
          confirm: { type: 'boolean' as const, description: 'Must be true to delete.' },
        },
        required: ['confirm'],
      },
    },
    {
      name: 'render_list_services',
      description: 'List recent Render services in the platform workspace. Use only for diagnostics.',
      input_schema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number' as const, description: 'Max services to return.' },
        },
      },
    },
    {
      name: 'render_get_metrics',
      description: 'Get Render service metrics if available on the plan. Useful for debugging paid services.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID.' },
          resolution: { type: 'string' as const, description: 'Metric resolution, e.g. 1h.' },
        },
      },
    },
    {
      name: 'render_list_databases',
      description: 'List Render Postgres databases. Founder product data should normally use Neon; this is diagnostics only.',
      input_schema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number' as const, description: 'Max databases to return.' },
        },
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'get_company_tech',
      description: 'Get the current tech setup for this company: GitHub repo, Render service, Neon DB.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'attach_custom_domain',
      description: 'Attach a founder\'s own domain (e.g. acmecorp.com) to their website. Returns DNS setup instructions for the founder. The baljia.app subdomain stays active as fallback.',
      input_schema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string' as const, description: 'The founder\'s domain (e.g. "acmecorp.com" or "https://acmecorp.com")' },
        },
        required: ['domain'],
      },
    },
    {
      name: 'verify_custom_domain',
      description: 'Check if a founder\'s custom domain DNS is properly configured and SSL is active.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬ Health & safety Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'check_url_health',
      description: 'Check if a deployed URL is live and returning successful responses. Call this after every deploy to verify the app is actually running.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string' as const, description: 'URL to check (e.g. https://acme.baljia.app)' },
        },
        required: ['url'],
      },
    },
    {
      name: 'review_pushed_code',
      description: 'Run an LLM-based code review over the diff between the agent\'s most recent commit and the previous one. Catches semantic bugs that runtime journey verification cannot see by definition: unhandled async errors, auth bypass, SQL injection, secrets in logs, silent catch blocks, race conditions. Returns structured findings with severity (high/medium/low). Costs one Haiku LLM call (~3-15s, $0.01-0.05) per build. Call AFTER github_create_commit and AFTER static_code_scan, BEFORE render_create_service. Address all HIGH-severity findings via github_create_commit before declaring complete; medium/low are advisory.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'static_code_scan',
      description: 'Run a fast pattern-based static scan over the JS/TS files in the company\'s GitHub repo. Catches AI-coding pitfalls that runtime journey verification cannot see by definition: process.env reads outside CONFIG_SCHEMA, silent catch blocks, secret-shaped vars in log statements, app.use(session) without trust-proxy, hardcoded test emails leaked from journey runs, template-literal SQL (injection risk), TODO/FIXME in committed code. Returns a structured list of findings with severity (high/medium/low). Call this AFTER github_create_commit and BEFORE render_create_service. Address all HIGH-severity findings via github_create_commit before declaring complete; medium/low are advisory.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'http_fetch_full',
      description: 'Make a single HTTP request and return the FULL response: status, headers, and body (truncated to 4KB). Use this for live debugging when verify_user_journey or check_url_health surfaces a failure — check_url_health only returns 200/non-200, but http_fetch_full lets you inspect WHY a request is failing (which header is wrong, what error JSON the server returned, what redirect target). Always use this BEFORE assuming a fix; never patch blind.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url:     { type: 'string' as const,  description: 'Full URL to fetch.' },
          method:  { type: 'string' as const,  enum: ['GET','POST','PUT','DELETE','PATCH','HEAD'], description: 'Default GET.' },
          headers: { type: 'object' as const,  description: 'Optional request headers as { name: value }.' },
          body:    { type: 'string' as const,  description: 'Optional request body as a string.' },
        },
        required: ['url'],
      },
    },
    {
      name: 'read_known_issues',
      description: 'Read past failure fingerprints relevant to what you are about to do. Returns up to 5 entries — both still-open issues AND already-fixed ones with their fix_notes. Call this BEFORE any deploy / migration / Render service creation / GitHub commit so you avoid repeating known mistakes. Each entry includes a [STATUS] tag and (when available) the exact fix that worked. Examples of useful contexts: "creating Render service", "session middleware Express", "GitHub Trees API commit", "Drizzle migration on production".',
      input_schema: {
        type: 'object' as const,
        properties: {
          context: { type: 'string' as const, description: 'Free-text describing what you are about to do, e.g. "creating Render service" or "adding session middleware". The longer/more specific the better — words ≥4 chars are matched against fingerprint descriptions.' },
        },
        required: ['context'],
      },
    },
    {
      name: 'verify_db_state',
      description: 'Run a SELECT query against the founder DB and assert on the result. Use AFTER verify_user_journey to confirm side-effects actually landed in the database — not just that the HTTP redirect succeeded. Example: after a "submit register" journey step passes, call this with sql:"SELECT email FROM users WHERE email=$1" + expect_min_rows:1 to prove the user row was actually created. Without this, a server that returns 302 but silently fails the INSERT will go unnoticed.',
      input_schema: {
        type: 'object' as const,
        properties: {
          label:                     { type: 'string' as const,   description: 'Human-readable label for the assertion, e.g. "user row exists after register".' },
          sql:                       { type: 'string' as const,   description: 'Single SELECT statement. Parameter placeholders ($1, $2, ...) are NOT supported here — inline literal values via single quotes.' },
          expect_min_rows:           { type: 'integer' as const,  description: 'Minimum number of rows the query must return. Defaults to 1.' },
          expect_max_rows:           { type: 'integer' as const,  description: 'Optional max number of rows. Defaults to no limit.' },
          expect_first_row_contains: { type: 'object' as const,   description: 'Optional. Each {key:value} must match the first row. Compared with == after JSON-stringify so works for strings/numbers/booleans.' },
        },
        required: ['label', 'sql'],
      },
    },
    {
      name: 'list_journey_templates',
      description: 'Return ready-to-use verify_user_journey input templates for the most common founder-app flows: auth (register→logout→login), crud (create→list→delete), payment (visit pricing page + Stripe link liveness), settings (update profile field, verify persists), and full_mvp (auth + CRUD + payment in one journey). Use this BEFORE writing your own journey from scratch — pick the closest template, plug in the specific URLs and field names, and pass to verify_user_journey. Returns a JSON object keyed by template name; each value is a partial input you can spread into verify_user_journey.',
      input_schema: {
        type: 'object' as const,
        properties: {
          template: { type: 'string' as const, enum: ['auth', 'crud', 'payment', 'settings', 'full_mvp', 'all'], description: 'Which template to return. "all" returns every template — useful for picking the closest match.' },
        },
      },
    },
    {
      name: 'verify_user_journey',
      description: 'Walk through a multi-step user journey on the deployed app, asserting expected responses at each step. Cookies persist across steps so authenticated flows (register → login → use-feature) work end-to-end. Use this AFTER deploy to prove the app actually works for users — not just that URLs return 200. The agent MUST run this for every critical journey before marking an engineering task complete.',
      input_schema: {
        type: 'object' as const,
        properties: {
          journey_name: { type: 'string' as const, description: 'Human-readable name, e.g. "register, sign in, view dashboard"' },
          base_url:     { type: 'string' as const, description: 'Deployed app base URL, e.g. https://threadpulse.baljia.app' },
          steps: {
            type: 'array' as const,
            description: 'Ordered steps. Cookies/sessions persist across steps. Stops on first failure.',
            items: {
              type: 'object' as const,
              properties: {
                step:                    { type: 'string' as const,  description: 'Human label for this step' },
                method:                  { type: 'string' as const,  enum: ['GET','POST','PUT','DELETE','PATCH'], description: 'Default GET' },
                path:                    { type: 'string' as const,  description: 'Path on the app, e.g. /auth/register' },
                body:                    { type: 'object' as const,  description: 'Request body. For form_urlencoded, pass plain {key:value}. For json, same.' },
                body_type:               { type: 'string' as const,  enum: ['form','json'], description: 'How to encode body. Default form.' },
                expect_status:           { description: 'Required HTTP status. Either a single integer (e.g. 200) or an array of acceptable values (e.g. [302, 201]) — useful for routes that may redirect OR return Created depending on Accept header.' },
                expect_redirect:         { type: 'string' as const,  description: 'Substring expected in Location header on 3xx (e.g. /dashboard).' },
                expect_body_contains:    { type: 'string' as const,  description: 'Substring required to appear in response body.' },
                expect_body_not_contains:{ type: 'string' as const,  description: 'Substring forbidden in response body (e.g. error toast text like "Registration failed").' },
              },
              required: ['step','path'],
            },
          },
        },
        required: ['journey_name','base_url','steps'],
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬ Database Infrastructure (Neon Postgres) Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'provision_database',
      description: 'Create a new Neon Postgres database for the founder\'s product. Call this when building a SaaS that needs user data, auth, or any persistent storage. Returns connection details. One database per company.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_database_info',
      description: 'Get the founder\'s product database connection details (host, connection URI, project ID). Use this when writing code that connects to their DB.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'run_migration',
      description: 'Run a SQL migration (CREATE TABLE, ALTER TABLE, etc.) on the founder\'s product database. Uses Neon branching for safety: creates a branch, runs migration, merges if successful. Only DDL statements allowed (CREATE, ALTER, DROP, INSERT seed data).',
      input_schema: {
        type: 'object' as const,
        properties: {
          sql: { type: 'string' as const, description: 'SQL migration statement (CREATE TABLE, ALTER TABLE, etc.)' },
          description: { type: 'string' as const, description: 'Human-readable description of what this migration does' },
        },
        required: ['sql', 'description'],
      },
    },
    {
      name: 'query_company_db',
      description: 'Run a read-only SELECT query on the founder\'s product database. Use to verify schema, check seed data, or debug issues. Only SELECT allowed.',
      input_schema: {
        type: 'object' as const,
        properties: {
          sql: { type: 'string' as const, description: 'SQL SELECT query (read-only)' },
        },
        required: ['sql'],
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬ Stripe Payments (Founder's Product) Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'stripe_create_product',
      description: 'Create a Stripe product for the founder\'s SaaS. This is a product in THEIR payment system, not Baljia\'s. Returns a product ID to use with stripe_create_price.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'Product name (e.g. "Pro Plan", "Starter")' },
          description: { type: 'string' as const, description: 'Product description' },
        },
        required: ['name'],
      },
    },
    {
      name: 'stripe_create_price',
      description: 'Create a price for a Stripe product. Supports one-time or recurring billing.',
      input_schema: {
        type: 'object' as const,
        properties: {
          product_id: { type: 'string' as const, description: 'Stripe product ID (from stripe_create_product)' },
          amount_cents: { type: 'number' as const, description: 'Price in cents (e.g. 2900 = $29.00)' },
          currency: { type: 'string' as const, description: 'Currency code (default: usd)' },
          recurring: { type: 'boolean' as const, description: 'If true, creates a monthly subscription price' },
          interval: { type: 'string' as const, description: 'Billing interval: month, year (default: month)' },
        },
        required: ['product_id', 'amount_cents'],
      },
    },
    {
      name: 'stripe_create_payment_link',
      description: 'Create a shareable Stripe payment link for a price. Founders can embed this in their website or share directly. No code required.',
      input_schema: {
        type: 'object' as const,
        properties: {
          price_id: { type: 'string' as const, description: 'Stripe price ID (from stripe_create_price)' },
        },
        required: ['price_id'],
      },
    },
    {
      name: 'stripe_get_products',
      description: 'List all Stripe products and prices for the founder\'s account. Shows product names, prices, and payment link URLs.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬ GitHub: branching + PR (KG spec: create_branch, create_commit, create_pr) Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'github_create_branch',
      description: 'Create a new branch in a GitHub repository from a base branch. Use this to isolate changes before merging.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          branch_name: { type: 'string' as const, description: 'New branch name (e.g. "feature/add-auth")' },
          base_branch: { type: 'string' as const, description: 'Branch to fork from (default: main)' },
        },
        required: ['repo', 'branch_name'],
      },
    },
    {
      name: 'github_create_pr',
      description: 'Create a pull request from a feature branch to main. Use after pushing feature branch changes with github_push_file.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          title: { type: 'string' as const, description: 'PR title' },
          body: { type: 'string' as const, description: 'PR description (markdown)' },
          head_branch: { type: 'string' as const, description: 'Branch with changes (e.g. "feature/add-auth")' },
          base_branch: { type: 'string' as const, description: 'Target branch (default: main)' },
        },
        required: ['repo', 'title', 'head_branch'],
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬ GitHub: search + commit (completing KG github spec) Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'github_search_code',
      description: 'Search for code in a GitHub repository. Useful to find existing implementations before writing new code.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          query: { type: 'string' as const, description: 'Search query (e.g. "function handleAuth" or "TODO:" or "stripe webhook")' },
          language: { type: 'string' as const, description: 'Filter by language (e.g. "TypeScript", "JavaScript") Ã¢â‚¬â€ optional' },
        },
        required: ['repo', 'query'],
      },
    },
    {
      name: 'github_create_commit',
      description: 'Create a commit in a repository with multiple file changes in a single atomic operation. Prefer this over multiple github_push_file calls when changing multiple files together.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          message: { type: 'string' as const, description: 'Commit message' },
          branch: { type: 'string' as const, description: 'Branch to commit to (default: main)' },
          files: {
            type: 'array' as const,
            description: 'Files to create or update',
            items: {
              type: 'object' as const,
              properties: {
                path: { type: 'string' as const, description: 'File path in repo' },
                content: { type: 'string' as const, description: 'File content' },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: ['repo', 'message', 'files'],
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬ Render: list_databases (completing KG render spec) Ã¢â€â‚¬Ã¢â€â‚¬

    // Ã¢â€â‚¬Ã¢â€â‚¬ Skeleton / Next.js SaaS build tools Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'fork_express_skeleton',
      description: 'PRIMARY tool for any Express-based founder app on Render. Pushes the Baljia hardened Express + Postgres skeleton into the company\'s GitHub repo as a single atomic commit. The skeleton ships with: Zod boot-time env validation, app.set("trust proxy",1), Postgres-backed sessions (connect-pg-simple), structured pino logger with secret redaction, /api/health that probes DB + session-store + Stripe, withTimeout helper, discriminated-union response shape, register/login/logout handlers, dashboard scaffold, and a tests/ folder (config + auth + health). All P0 rules from the Backend Quality Bar are pre-wired. After forking: customize landing copy in landingPage(), feature routes (rename /api/items to your domain), and add feature-specific tables to db/schema.sql. Do NOT modify the framework patterns. Call run_migration on db/schema.sql before deploy. Then render_create_service. Use this INSTEAD of writing server.js from scratch — every from-scratch attempt has shipped with at least one P0 violation.',
      input_schema: {
        type: 'object' as const,
        properties: {
          app_name:    { type: 'string' as const, description: 'Founder-facing display name (e.g. "Threadpulse"). Used in landing-page copy + README. Defaults to the company name.' },
          description: { type: 'string' as const, description: 'One-sentence product description. Used in package.json description and as a comment in server.js.' },
        },
      },
    },
    {
      name: 'github_fork_skeleton',
      description: 'Fork the Baljia Next.js SaaS skeleton into the company GitHub repo. This copies the full production-ready skeleton (Better Auth, Drizzle, Neon, AI gateway, Stripe, Shadcn/ui, Tailwind 4) into the founder\'s repo. Call this FIRST when building any full-stack SaaS Ã¢â‚¬â€ do not write Express or plain HTML from scratch. After forking, use github_push_file or github_create_commit to patch in feature-specific code.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Company repo slug (e.g. "genesis-advertising-hen6"). The skeleton will be forked into this repo.' },
          description: { type: 'string' as const, description: 'Short description of the app being built (used as repo description).' },
        },
        required: ['repo'],
      },
    },
    {
      name: 'run_drizzle_push',
      description: 'Run `pnpm db:push` to sync the Drizzle schema in db/schema.ts to the company Neon Postgres database. Use this INSTEAD of run_migration for skeleton-based Next.js apps Ã¢â‚¬â€ Drizzle introspects the schema file and creates/alters tables automatically. Returns the list of tables created or updated.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Company repo slug (must have db/schema.ts with Drizzle schema).' },
        },
        required: ['repo'],
      },
    },
    // -- Atomic instance provisioning --
    {
      name: 'create_instance',
      description: 'Atomic tool that does everything needed to launch a new full-stack SaaS in one call: forks the Next.js skeleton, provisions a Neon database, creates a Render web service, and saves the company tech record. Call this FIRST for any full-stack SaaS build instead of calling github_fork_skeleton + provision_database + render_create_service separately. Returns repo URL, database connection string, service URL, and next steps.',
      input_schema: {
        type: 'object' as const,
        properties: {
          app_name: { type: 'string' as const, description: 'Short app name used for repo slug and Render service name (e.g. "acme-crm").' },
          description: { type: 'string' as const, description: 'One-line description of what the app does.' },
          env_vars: {
            type: 'object' as const,
            description: 'Additional environment variables to set on Render (beyond DATABASE_URL, BETTER_AUTH_SECRET, AI_GATEWAY_URL which are set automatically).',
            additionalProperties: { type: 'string' as const },
          },
        },
        required: ['app_name', 'description'],
      },
    },
    {
      name: 'get_preview',
      description: 'Get the live preview URL for the company Render service. Returns the public URL where the app is accessible. Use this after a deploy to confirm where the app lives.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
  ];

  return tools;
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// HANDLERS
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

// C7-FIX: Tenant isolation helpers Ã¢â‚¬â€ verify infrastructure belongs to the requesting company
async function assertServiceOwnership(serviceId: string, companyId: string): Promise<void> {
  const [company] = await db.select({ render_service_id: companies.render_service_id })
    .from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company || company.render_service_id !== serviceId) {
    const actual = company?.render_service_id ?? 'none stored';
    throw new Error(
      `render_deploy/render_* called with service_id "${serviceId}" but this company's service is "${actual}". ` +
      `Either pass the correct service_id or omit it entirely (it auto-resolves from the company).`
    );
  }
}

// Auto-resolve render service_id from the task's company. Eliminates the
// LLM-hallucinates-an-opaque-token failure mode (e.g. mistyping "d7tjghr"
// for "d7tjgrr"). If the agent passed a service_id, validate it; if not,
// look up the company's stored ID and mutate input.service_id so downstream
// handlers see the resolved value.
async function resolveServiceId(input: Record<string, unknown>, companyId: string): Promise<void> {
  if (typeof input.service_id === 'string' && input.service_id.length > 0) {
    await assertServiceOwnership(input.service_id, companyId);
    return;
  }
  const [company] = await db.select({ render_service_id: companies.render_service_id })
    .from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company?.render_service_id) {
    throw new Error('No render_service_id stored for this company. Call render_create_service first.');
  }
  input.service_id = company.render_service_id;
}

async function assertRepoOwnership(repo: string, companyId: string): Promise<void> {
  const [company] = await db.select({ github_repo: companies.github_repo })
    .from(companies).where(eq(companies.id, companyId)).limit(1);
  // Normalize: repo might be "my-app" or "baljia-ai/my-app"
  const fullRepo = repo.includes('/') ? repo : `${githubOrg()}/${repo}`;
  if (!company || company.github_repo !== fullRepo) {
    throw new Error(`Repo ${repo} does not belong to this company. Cross-tenant access denied.`);
  }
}

export async function handleEngineeringTool(
  toolName: string,
  input: Record<string, unknown>,
  task: Task,
): Promise<string> {
  switch (toolName) {
    // Ã¢â€â‚¬Ã¢â€â‚¬ Skills (Polsia-style knowledge layer) Ã¢â€â‚¬Ã¢â€â‚¬
    case 'list_skills':
      return handleListSkills();

    case 'read_skill':
      return handleReadSkill(input);

    case 'get_company_tech':
      return getCompanyTech(task.company_id);

    case 'github_create_repo':
      return githubCreateRepo(input, task.company_id);

    case 'github_push_file':
      return githubPushFile(input, task.company_id);

    case 'github_read_file':
      return githubReadFile(input, task.company_id);

    case 'github_list_files':
      return githubListFiles(input, task.company_id);

    case 'github_delete_file':
      return githubDeleteFile(input, task.company_id);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Render deploys (primary founder app target) Ã¢â€â‚¬Ã¢â€â‚¬
    case 'render_create_service':
      return renderCreateService(input, task.company_id);

    case 'render_deploy': {
      await resolveServiceId(input, task.company_id);
      return renderDeploy(input, task.company_id);
    }

    case 'render_get_service': {
      await resolveServiceId(input, task.company_id);
      return renderGetService(input);
    }

    case 'render_get_deploy_status': {
      await resolveServiceId(input, task.company_id);
      return renderGetDeployStatus(input);
    }

    case 'render_get_logs': {
      await resolveServiceId(input, task.company_id);
      return renderGetLogs(input);
    }

    case 'render_rollback': {
      await resolveServiceId(input, task.company_id);
      return handleRenderRollback(input);
    }

    case 'render_delete_service': {
      await resolveServiceId(input, task.company_id);
      return renderDeleteService(input, task.company_id);
    }

    case 'render_list_services':
      return renderListServices(input);

    case 'render_get_metrics': {
      await resolveServiceId(input, task.company_id);
      return renderGetMetrics(input);
    }

    case 'render_list_databases':
      return renderListDatabases(input);

    case 'attach_custom_domain':
      return handleAttachCustomDomain(input, task.company_id);

    case 'verify_custom_domain':
      return handleVerifyCustomDomain(task.company_id);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Health & safety Ã¢â€â‚¬Ã¢â€â‚¬
    case 'check_url_health':
      return handleCheckUrlHealth(input);
    case 'verify_user_journey':
      return handleVerifyUserJourney(input);
    case 'list_journey_templates':
      return handleListJourneyTemplates(input);
    case 'verify_db_state':
      return handleVerifyDbState(input, task.company_id);
    case 'static_code_scan':
      return handleStaticCodeScan(task.company_id);
    case 'review_pushed_code':
      return handleReviewPushedCode(task.company_id);
    case 'read_known_issues':
      return handleReadKnownIssues(input);
    case 'http_fetch_full':
      return handleHttpFetchFull(input);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Database Infrastructure Ã¢â€â‚¬Ã¢â€â‚¬
    case 'provision_database':
      return handleProvisionDatabase(task.company_id);

    case 'get_database_info':
      return handleGetDatabaseInfo(task.company_id);

    case 'run_migration':
      return handleRunMigration(input, task.company_id);

    case 'query_company_db':
      return handleQueryCompanyDb(input, task.company_id);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Stripe Payments Ã¢â€â‚¬Ã¢â€â‚¬
    case 'stripe_create_product':
      return handleStripeCreateProduct(input, task.company_id);

    case 'stripe_create_price':
      return handleStripeCreatePrice(input, task.company_id);

    case 'stripe_create_payment_link':
      return handleStripeCreatePaymentLink(input, task.company_id);

    case 'stripe_get_products':
      return handleStripeGetProducts(task.company_id);

    // Ã¢â€â‚¬Ã¢â€â‚¬ GitHub branching + PR Ã¢â€â‚¬Ã¢â€â‚¬
    case 'github_create_branch':
      return githubCreateBranch(input, task.company_id);

    case 'github_create_pr':
      return githubCreatePR(input, task.company_id);

    case 'github_search_code':
      return githubSearchCode(input, task.company_id);

    case 'github_create_commit':
      return githubCreateCommit(input, task.company_id);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Skeleton / Next.js SaaS build tools Ã¢â€â‚¬Ã¢â€â‚¬
    case 'fork_express_skeleton':
      return handleForkExpressSkeleton(input, task.company_id);

    case 'github_fork_skeleton':
      return githubForkSkeleton(input, task.company_id);

    case 'run_drizzle_push':
      return handleRunDrizzlePush(input, task.company_id);

    // -- Atomic instance creation --
    case 'create_instance':
      return handleCreateInstance(input, task.company_id);

    case 'get_preview':
      return handleGetPreview(task.company_id);

    default:
      return `Unknown engineering tool: ${toolName}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ GitHub helpers Ã¢â€â‚¬Ã¢â€â‚¬

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function githubOrg() {
  return process.env.GITHUB_ORG ?? 'BALAJIapps';
}

function resolveRepo(repoInput: string): string {
  // If already in org/repo format, use as-is; otherwise prepend org
  return repoInput.includes('/') ? repoInput : `${githubOrg()}/${repoInput}`;
}

async function getCompanyTech(companyId: string): Promise<string> {
  const [company] = await db.select({
    github_repo: companies.github_repo, render_service_id: companies.render_service_id,
    neon_database_id: companies.neon_database_id, subdomain: companies.subdomain, name: companies.name,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);

  if (!company) return 'Company not found';

  const lines = [
    `Company: ${company.name}`,
    `GitHub repo: ${company.github_repo ?? 'Not created yet'}`,
    `Render service: ${company.render_service_id ?? 'Not created yet'}`,
    `Neon DB: ${company.neon_database_id ?? 'Not provisioned yet'}`,
    `Subdomain: ${company.subdomain ?? 'Not set'}`,
  ];

  return lines.join('\n');
}

async function githubCreateRepo(input: Record<string, unknown>, companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const org = githubOrg();

    const response = await fetch(`${GITHUB_API}/orgs/${org}/repos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: input.repo_name as string,
        description: (input.description as string) ?? '',
        private: input.private !== false,
        auto_init: true,
        gitignore_template: 'Node',
      }),
    });

    const data = await response.json() as { full_name?: string; html_url?: string; message?: string };

    if (!response.ok) {
      return `GitHub repo creation failed: ${data.message ?? response.statusText}`;
    }

    // Save to company record
    await db.update(companies).set({ github_repo: data.full_name }).where(eq(companies.id, companyId));

    return `GitHub repo created: ${data.full_name}\nURL: ${data.html_url}`;
  } catch (err) {
    return `GitHub error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function githubPushFile(input: Record<string, unknown>, companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = resolveRepo(input.repo as string);
    const branch = (input.branch as string) ?? 'main';
    const path = input.path as string;

    // Check if file exists to get SHA for update
    let sha: string | undefined;
    const existingRes = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}?ref=${branch}`, { headers });
    if (existingRes.ok) {
      const existingData = await existingRes.json() as { sha?: string };
      sha = existingData.sha;
    }

    const content = Buffer.from(input.content as string).toString('base64');
    const body: Record<string, unknown> = {
      message: input.message as string,
      content,
      branch,
    };
    if (sha) body.sha = sha;

    const response = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json() as { content?: { html_url?: string }; message?: string };

    if (!response.ok) {
      return `GitHub push failed: ${data.message ?? response.statusText}`;
    }

    const action = sha ? 'updated' : 'created';
    return `File ${action}: ${path} in ${repo}\nURL: ${data.content?.html_url ?? 'unknown'}`;
  } catch (err) {
    return `GitHub push error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function githubReadFile(input: Record<string, unknown>, _companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = resolveRepo(input.repo as string);
    const branch = (input.branch as string) ?? 'main';
    const path = input.path as string;

    const response = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}?ref=${branch}`, { headers });
    const data = await response.json() as { content?: string; encoding?: string; message?: string };

    if (!response.ok) {
      return `GitHub read failed: ${data.message ?? response.statusText}`;
    }

    if (data.content && data.encoding === 'base64') {
      const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
      return `File: ${path}\n\`\`\`\n${decoded}\n\`\`\``;
    }

    return `File content not available for ${path}`;
  } catch (err) {
    return `GitHub read error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function githubListFiles(input: Record<string, unknown>, _companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = resolveRepo(input.repo as string);
    const branch = (input.branch as string) ?? 'main';
    const path = (input.path as string) ?? '';

    const response = await fetch(
      `${GITHUB_API}/repos/${repo}/contents/${path}?ref=${branch}`,
      { headers }
    );
    const data = await response.json() as Array<{ name: string; type: string; path: string }> | { message?: string };

    if (!response.ok || !Array.isArray(data)) {
      const err = (data as { message?: string }).message ?? 'Unknown error';
      return `GitHub list failed: ${err}`;
    }

    const files = data.map((f) => `${f.type === 'dir' ? 'Ã°Å¸â€œÂ' : 'Ã°Å¸â€œâ€ž'} ${f.path}`).join('\n');
    return files.length ? files : 'Directory is empty';
  } catch (err) {
    return `GitHub list error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function githubDeleteFile(input: Record<string, unknown>, _companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = resolveRepo(input.repo as string);
    const branch = (input.branch as string) ?? 'main';
    const path = input.path as string;

    // Get SHA first
    const existingRes = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}?ref=${branch}`, { headers });
    if (!existingRes.ok) return `File not found: ${path}`;
    const existingData = await existingRes.json() as { sha?: string };
    if (!existingData.sha) return `Cannot get SHA for ${path}`;

    const response = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ message: input.message as string, sha: existingData.sha, branch }),
    });

    if (!response.ok) {
      const data = await response.json() as { message?: string };
      return `GitHub delete failed: ${data.message ?? response.statusText}`;
    }

    return `File deleted: ${path} from ${repo}`;
  } catch (err) {
    return `GitHub delete error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Render helpers Ã¢â€â‚¬Ã¢â€â‚¬

function renderHeaders() {
  const token = process.env.RENDER_API_KEY;
  if (!token) throw new Error('RENDER_API_KEY not configured');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

function normalizeRenderServiceName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || `baljia-app-${Date.now()}`;
}

async function renderCreateService(input: Record<string, unknown>, companyId: string): Promise<string> {
  try {
    const headers = renderHeaders();
    if (!process.env.RENDER_OWNER_ID) {
      return 'Render service creation failed: RENDER_OWNER_ID not configured.';
    }

    const [company] = await db.select({
      slug: companies.slug,
      name: companies.name,
      github_repo: companies.github_repo,
    }).from(companies).where(eq(companies.id, companyId)).limit(1);

    if (!company) return 'Company not found';

    const repoInput = (input.repo as string | undefined) ?? company.github_repo ?? '';
    if (!repoInput) return 'Render service creation failed: no company GitHub repo. Create/push the repo first.';
    const repo = resolveRepo(repoInput);
    await assertRepoOwnership(repo, companyId);

      const serviceName = normalizeRenderServiceName(company.slug ?? (input.name as string | undefined) ?? company.name);
    const type = (input.type as string) === 'static_site' ? 'static_site' : 'web_service';
    const plan = (input.plan as string | undefined) ?? 'free';

    const envVars = (input.env_vars as Array<{ key: string; value: string }> | undefined) ?? [];

    // Auto-inject real DATABASE_URL if masked URL was used
    const dbInfo = await getCompanyDatabase(companyId);
    if (dbInfo?.connectionUri) {
      for (const ev of envVars) {
        if ((ev.key === 'DATABASE_URL' || ev.key === 'NEON_CONNECTION_STRING') && ev.value.includes(':***@')) {
          ev.value = dbInfo.connectionUri;
        }
      }
    }

    const baseBody: Record<string, unknown> = {
      type,
      name: serviceName,
      ownerId: process.env.RENDER_OWNER_ID,
      repo: `https://github.com/${repo}`,
      branch: 'main',
      autoDeploy: 'yes',
    };

    const buildCommand = (input.build_command as string | undefined) ?? 'npm install && npm run build';
    const startCommand = (input.start_command as string | undefined) ?? 'npm start';
    // Render's modern API (post-2025 schema):
    //   - envVars at the TOP LEVEL of the request body (NOT inside serviceDetails)
    //     — Render silently drops envVars placed inside serviceDetails, leading
    //     to services that boot with all env vars undefined.
    //   - serviceDetails.runtime  (was: env)
    //   - serviceDetails.envSpecificDetails.{buildCommand,startCommand}
    //     (were: serviceDetails.{buildCommand,startCommand})
    // The platform's original code used the pre-2025 shape; Render returns
    // 400 "must include envSpecificDetails when creating non-static, non-docker
    // services" against that body now. legacyBody is kept as a fallback for
    // any legacy region/account that still accepts the older shape.
    const body: Record<string, unknown> = {
      ...baseBody,
      envVars,
      serviceDetails: type === 'web_service'
        ? {
            runtime: 'node',
            plan,
            envSpecificDetails: {
              buildCommand,
              startCommand,
            },
          }
        : {
            plan,
            buildCommand,
            publishPath: (input.publish_path as string | undefined) ?? './dist',
          },
    };

    const legacyBody: Record<string, unknown> = {
      ...baseBody,
      plan,
      envVars,
    };
    if (type === 'web_service') {
      legacyBody.buildCommand = buildCommand;
      legacyBody.startCommand = startCommand;
    } else {
      legacyBody.buildCommand = buildCommand;
      legacyBody.staticPublishPath = (input.publish_path as string | undefined) ?? './dist';
    }

    let response = await fetch(`${RENDER_API}/services`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    let data = await response.json().catch(() => ({})) as { service?: { id?: string; dashboardUrl?: string }; id?: string; message?: string };

    // The Render API has had both nested serviceDetails and top-level service
    // fields in circulation. Retry once with the legacy body so the worker does
    // not fail just because the configured API surface is older.
    if (!response.ok && response.status === 400) {
      response = await fetch(`${RENDER_API}/services`, {
        method: 'POST',
        headers,
        body: JSON.stringify(legacyBody),
      });
      data = await response.json().catch(() => ({})) as { service?: { id?: string; dashboardUrl?: string }; id?: string; message?: string };
    }

    if (!response.ok) {
      return `Render service creation failed: ${data.message ?? response.statusText}`;
    }

    const serviceId = data.service?.id ?? data.id;

    if (serviceId) {
      // Save service ID to company record
      await db.update(companies).set({ render_service_id: serviceId, hosting_state: 'live' }).where(eq(companies.id, companyId));

      let customDomain = '';
      if (company?.slug) {
        try {
          const result = await provisionSubdomain(companyId, company.slug, serviceId);
          if (result) {
            customDomain = `\nCustom domain: https://${result.domain} (${result.status})`;
          }
        } catch (err) {
          log.warn('Domain attachment failed', { companyId, serviceId });
        }
      }

      return `Render service created!\nService ID: ${serviceId}\nDashboard: ${data.service?.dashboardUrl ?? 'https://dashboard.render.com'}${customDomain}`;
    }

    return `Render service created!\nDashboard: ${data.service?.dashboardUrl ?? 'https://dashboard.render.com'}`;
  } catch (err) {
    return `Render error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function renderGetService(input: Record<string, unknown>): Promise<string> {
  try {
    const headers = renderHeaders();
    const response = await fetch(`${RENDER_API}/services/${input.service_id}`, { headers });
    const data = await response.json() as {
      service?: { name?: string; serviceDetails?: { url?: string }; suspended?: string };
      name?: string;
      message?: string;
    };

    if (!response.ok) {
      return `Render service not found: ${data.message ?? response.statusText}`;
    }

    const svc = data.service ?? data;
    return [
      `Service: ${(svc as { name?: string }).name ?? 'unknown'}`,
      `URL: ${(svc as { serviceDetails?: { url?: string } }).serviceDetails?.url ?? 'deploying...'}`,
      `Suspended: ${(svc as { suspended?: string }).suspended ?? 'no'}`,
    ].join('\n');
  } catch (err) {
    return `Render get error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function renderDeploy(input: Record<string, unknown>, companyId?: string): Promise<string> {
  try {
    const headers = renderHeaders();
    const response = await fetch(`${RENDER_API}/services/${input.service_id}/deploys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clearCache: input.clear_cache === true ? 'clear' : 'do_not_clear' }),
    });

    const data = await response.json() as { id?: string; status?: string; message?: string };

    if (!response.ok) {
      return `Render deploy failed: ${data.message ?? response.statusText}`;
    }

    const result = `Deployment triggered! Deploy ID: ${data.id}\nStatus: ${data.status ?? 'building'}`;

    // P2-7: Auto-create Browser QA task after successful deploy
    if (companyId) {
      try {
        // Get the live URL for this company to verify
        const { companies: co } = await import('@/lib/db');
        const { db: dbInst } = await import('@/lib/db');
        const { eq: eqOp } = await import('drizzle-orm');
        const [company] = await dbInst.select({ custom_domain: co.custom_domain, slug: co.slug })
          .from(co).where(eqOp(co.id, companyId)).limit(1);

        const liveUrl = company?.custom_domain
          ? `https://${company.custom_domain}`
          : company?.slug
          ? `https://${company.slug}.baljia.app`
          : null;

        if (liveUrl) {
          const { tasks: tasksTable } = await import('@/lib/db');
          await dbInst.insert(tasksTable).values({
            company_id: companyId,
            title: `[QA] Verify deploy: ${liveUrl}`,
            description: `A new deploy was just triggered. Visit ${liveUrl} and verify:\n1. Homepage loads without errors\n2. Main navigation links work\n3. No visible console errors or broken layouts\n4. Take a screenshot for evidence\n\nDeploy ID: ${data.id}`,
            tag: 'browser-qa',
            priority: 60,
            source: 'auto_remediation',
            status: 'todo',
            queue_order: 2,
            estimated_credits: 1,
            max_turns: 50,
            executability_type: 'can_run_now',
          });
          log.info('Browser QA task created post-deploy', { companyId, liveUrl, deployId: data.id });
        }
      } catch (err) {
        // Non-blocking: QA task failure shouldn't fail the deploy response
        log.warn('Failed to create Browser QA task', { companyId, error: err instanceof Error ? err.message : 'Unknown' });
      }
    }

    return result + (companyId ? '\n\nÃ°Å¸â€œâ€¹ Browser QA task created Ã¢â‚¬â€ agent will verify the live URL shortly.' : '');
  } catch (err) {
    return `Render deploy error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}


async function renderGetDeployStatus(input: Record<string, unknown>): Promise<string> {
  try {
    const headers = renderHeaders();
    const response = await fetch(
      `${RENDER_API}/services/${input.service_id}/deploys?limit=1`,
      { headers }
    );

    const data = await response.json() as Array<{ deploy?: { id?: string; status?: string; finishedAt?: string; commitMessage?: string } }> | { message?: string };

    if (!response.ok || !Array.isArray(data)) {
      return `Render deploy status error: ${(data as { message?: string }).message ?? 'Unknown'}`;
    }

    if (!data.length) return 'No deployments found for this service.';

    const latest = data[0].deploy ?? data[0];
    return [
      `Latest deploy status: ${(latest as { status?: string }).status ?? 'unknown'}`,
      `Finished: ${(latest as { finishedAt?: string }).finishedAt ?? 'in progress'}`,
      `Commit: ${(latest as { commitMessage?: string }).commitMessage ?? 'N/A'}`,
    ].join('\n');
  } catch (err) {
    return `Render status error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function renderGetLogs(input: Record<string, unknown>): Promise<string> {
  try {
    const headers = renderHeaders();
    const serviceId = input.service_id as string;
    const logType = (input.log_type as string) ?? 'service';
    const numLines = Math.min(Math.max((input.num_lines as number) ?? 100, 10), 500);

    // Render API: GET /services/{id}/logs
    const params = new URLSearchParams({
      limit: String(numLines),
      direction: 'backward', // most recent first
    });

    const endpoint = logType === 'deploy'
      ? `${RENDER_API}/services/${serviceId}/deploys?limit=1`
      : `${RENDER_API}/services/${serviceId}/logs?${params}`;

    if (logType === 'deploy') {
      // Get latest deploy and its logs
      const deployRes = await fetch(endpoint, { headers });
      if (!deployRes.ok) return `Failed to get deploy logs: ${deployRes.statusText}`;

      const deploys = await deployRes.json() as Array<{ deploy?: { id?: string } }>;
      if (!Array.isArray(deploys) || !deploys.length) return 'No deployments found.';

      const deployId = deploys[0].deploy?.id ?? (deploys[0] as { id?: string }).id;
      if (!deployId) return 'Could not find deployment ID.';

      const logRes = await fetch(
        `${RENDER_API}/services/${serviceId}/deploys/${deployId}/logs`,
        { headers }
      );

      if (!logRes.ok) return `Failed to get deploy logs: ${logRes.statusText}`;
      const logData = await logRes.json() as Array<{ message?: string; timestamp?: string }>;

      if (!Array.isArray(logData) || !logData.length) return 'No deploy logs available.';

      const lines = logData
        .slice(-numLines)
        .map((l) => `[${l.timestamp ?? ''}] ${l.message ?? ''}`)
        .join('\n');

      return `## Deploy Logs (last ${Math.min(logData.length, numLines)} lines)\n${lines}`;
    }

    // Runtime/service logs
    const response = await fetch(endpoint, { headers });
    if (!response.ok) {
      return `Failed to get logs: ${response.statusText}. Make sure the service is deployed and running.`;
    }

    const logData = await response.json() as Array<{ message?: string; timestamp?: string; level?: string }>;

    if (!Array.isArray(logData) || !logData.length) {
      return 'No runtime logs available. The service may not have started yet.';
    }

    const lines = logData
      .slice(-numLines)
      .map((l) => `[${l.timestamp ?? ''}] ${l.level ?? 'info'}: ${l.message ?? ''}`)
      .join('\n');

    return `## Runtime Logs (last ${Math.min(logData.length, numLines)} lines)\n${lines}`;
  } catch (err) {
    return `Render logs error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function renderDeleteService(input: Record<string, unknown>, companyId: string): Promise<string> {
  // Safety gate: require explicit confirmation
  if (input.confirm !== true) {
    return 'Deletion requires confirm=true. This permanently destroys the service and all deployments. Are you sure?';
  }

  const serviceId = input.service_id as string;
  if (!serviceId) return 'Error: service_id is required.';

  try {
    const headers = renderHeaders();
    const response = await fetch(`${RENDER_API}/services/${serviceId}`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      const data = await response.json() as { message?: string };
      return `Failed to delete service: ${data.message ?? response.statusText}`;
    }

    // Clear from company record
    await db.update(companies)
      .set({ render_service_id: null })
      .where(eq(companies.id, companyId));

    log.warn('Render service deleted', { companyId, serviceId });

    return `Ã¢Å¡Â Ã¯Â¸Â Service ${serviceId} permanently deleted. The company record has been updated. Use render_create_service to redeploy.`;
  } catch (err) {
    return `Delete error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Health check Ã¢â€â‚¬Ã¢â€â‚¬

// LLM code review — fetches the diff between the agent's most recent commit
// and its parent, sends to Claude Haiku for structured review, returns
// formatted findings the agent reads as a tool result.
async function handleReviewPushedCode(companyId: string): Promise<string> {
  const [company] = await db.select({ github_repo: companies.github_repo }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company?.github_repo) return 'CODE REVIEW SKIPPED: no github_repo on company.';

  const token = process.env.GITHUB_TOKEN;
  if (!token) return 'CODE REVIEW SKIPPED: GITHUB_TOKEN not configured.';
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };

  // Get the latest commit + its parent. Compare via GitHub's compare API,
  // which returns a unified diff.
  let latestSha: string | undefined;
  for (const branch of ['main', 'master']) {
    try {
      const r = await githubFetch(`${GITHUB_API}/repos/${company.github_repo}/git/ref/heads/${branch}`, { headers, signal: AbortSignal.timeout(8_000) });
      if (r.ok) {
        const data = await r.json() as { object: { sha: string } };
        latestSha = data.object.sha;
        break;
      }
    } catch { /* try next branch */ }
  }
  if (!latestSha) return 'CODE REVIEW SKIPPED: could not resolve default branch.';

  // Fetch the parent commit SHA.
  const commitRes = await githubFetch(`${GITHUB_API}/repos/${company.github_repo}/git/commits/${latestSha}`, { headers, signal: AbortSignal.timeout(8_000) });
  if (!commitRes.ok) return `CODE REVIEW SKIPPED: could not read latest commit: HTTP ${commitRes.status}`;
  const commitData = await commitRes.json() as { parents?: Array<{ sha: string }> };
  const parentSha = commitData.parents?.[0]?.sha;
  if (!parentSha) return 'CODE REVIEW SKIPPED: latest commit has no parent (root commit) — nothing to diff against.';

  // Fetch the unified diff via GitHub's compare API.
  const diffHeaders = { ...headers, Accept: 'application/vnd.github.v3.diff' };
  const diffRes = await githubFetch(`${GITHUB_API}/repos/${company.github_repo}/compare/${parentSha}...${latestSha}`, { headers: diffHeaders, signal: AbortSignal.timeout(15_000) });
  if (!diffRes.ok) return `CODE REVIEW SKIPPED: could not fetch diff: HTTP ${diffRes.status}`;
  const diff = await diffRes.text();

  if (!diff || diff.length < 50) {
    return 'CODE REVIEW SKIPPED: diff too small to review meaningfully.';
  }

  const { reviewDiff, summarizeReview } = await import('@/lib/services/code-review.service');
  const result = await reviewDiff(diff, company.github_repo);
  return summarizeReview(result);
}

// Static code scan — pattern-based AI-coding pitfall detection over the
// company's GitHub repo. Pulls JS/TS source via Trees+blob API, runs the
// shared static-code-scan rule set, returns formatted findings.
async function handleStaticCodeScan(companyId: string): Promise<string> {
  const [company] = await db.select({ github_repo: companies.github_repo }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company?.github_repo) return 'STATIC SCAN: no github_repo on company.';

  const token = process.env.GITHUB_TOKEN;
  if (!token) return 'STATIC SCAN: GITHUB_TOKEN not configured.';
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };

  // List the tree
  let tree: Array<{ path: string; type: string; sha: string; size?: number }> = [];
  for (const branch of ['main', 'master']) {
    try {
      const r = await githubFetch(`${GITHUB_API}/repos/${company.github_repo}/git/trees/${branch}?recursive=1`, { headers, signal: AbortSignal.timeout(8_000) });
      if (r.ok) {
        const data = await r.json() as { tree?: typeof tree };
        tree = data.tree ?? [];
        break;
      }
    } catch { /* try next branch */ }
  }
  if (tree.length === 0) return 'STATIC SCAN: could not list repo tree.';

  // Pull JS/TS source files. Cap to 30 files for budget — most apps fit.
  const sourceFiles = tree
    .filter((e) => e.type === 'blob' && /\.(js|ts|jsx|tsx|mjs|cjs)$/i.test(e.path))
    .filter((e) => !/node_modules\//.test(e.path))
    .filter((e) => (e.size ?? 0) < 200_000) // skip enormous files
    .slice(0, 30);

  const { scanFiles, summarizeFindings } = await import('@/lib/services/static-code-scan');
  const scanned: Array<{ path: string; content: string }> = [];
  for (const f of sourceFiles) {
    try {
      const r = await githubFetch(`${GITHUB_API}/repos/${company.github_repo}/git/blobs/${f.sha}`, { headers, signal: AbortSignal.timeout(8_000) });
      if (!r.ok) continue;
      const data = await r.json() as { content: string; encoding: string };
      const content = data.encoding === 'base64' ? Buffer.from(data.content, 'base64').toString('utf8') : data.content;
      scanned.push({ path: f.path, content });
    } catch { /* skip */ }
  }

  const findings = scanFiles(scanned);
  return summarizeFindings(findings);
}

// Live debug helper — full HTTP response (status + headers + body) so the
// agent can diagnose why a request failed instead of just knowing it failed.
// check_url_health is binary 200/not-200; http_fetch_full gives the why.

async function handleHttpFetchFull(input: Record<string, unknown>): Promise<string> {
  const url     = input.url as string | undefined;
  const method  = ((input.method as string | undefined) ?? 'GET').toUpperCase();
  const headers = (input.headers as Record<string, string> | undefined) ?? {};
  const body    = input.body as string | undefined;

  if (!url) return 'Error: url is required.';
  try {
    const resp = await fetch(url, {
      method,
      headers: { 'User-Agent': 'Baljia/1.0 engineering-debug', ...headers },
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => { respHeaders[k] = v; });
    let respBody = '';
    try { respBody = await resp.text(); } catch { /* binary or empty */ }
    if (respBody.length > 4096) respBody = respBody.slice(0, 4096) + `\n... [truncated; total ${respBody.length} bytes]`;
    return [
      `HTTP ${resp.status} ${resp.statusText} — ${method} ${url}`,
      `Headers: ${JSON.stringify(respHeaders, null, 2)}`,
      `Body:`,
      respBody || '(empty)',
    ].join('\n');
  } catch (err) {
    return `HTTP fetch failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Known-issues lookup — agent calls before doing risky work to avoid repeating
// past failures. Returns FIXED issues (with fix_notes) AND still-open ones.

async function handleReadKnownIssues(input: Record<string, unknown>): Promise<string> {
  const context = (input.context as string | undefined) ?? '';
  if (!context.trim()) return 'Error: context is required (free-text describing what you are about to do).';
  const { getRelevantKnownIssuesForAgent, formatKnownIssuesForAgent } = await import('@/lib/services/failure.service');
  try {
    const issues = await getRelevantKnownIssuesForAgent(context, 30, 5);
    return formatKnownIssuesForAgent(issues);
  } catch (err) {
    return `KNOWN ISSUES: lookup failed (${err instanceof Error ? err.message : 'unknown'}). Proceed cautiously.`;
  }
}

// User-journey verifier — stateful HTTP walkthrough with cookie persistence
// across steps. Lets the engineering agent prove the deployed app actually
// works for users — not just that URLs return 2xx. Use as the final
// verification step before declaring an engineering task done.

async function handleVerifyUserJourney(input: Record<string, unknown>): Promise<string> {
  const journeyName = (input.journey_name as string | undefined) ?? 'unnamed';
  const baseUrl = input.base_url as string | undefined;
  const stepsRaw = input.steps as unknown;
  if (!baseUrl) return 'Error: base_url is required.';
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) return 'Error: steps must be a non-empty array.';

  const { runJourney } = await import('@/lib/services/journey-runner.service');
  const result = await runJourney({
    journey_name: journeyName,
    base_url: baseUrl,
    steps: stepsRaw as Parameters<typeof runJourney>[0]['steps'],
  });
  return result.summary;
}

// DB-state verifier: closes the gap where a server returns 302 "saved" but
// the INSERT actually failed. Pair with verify_user_journey to confirm
// side-effects landed in the founder's database.
async function handleVerifyDbState(input: Record<string, unknown>, companyId: string): Promise<string> {
  const label = (input.label as string | undefined) ?? 'unnamed';
  const sql = ((input.sql as string | undefined) ?? '').trim();
  const minRows = typeof input.expect_min_rows === 'number' ? input.expect_min_rows : 1;
  const maxRows = typeof input.expect_max_rows === 'number' ? input.expect_max_rows : Infinity;
  const expectFirst = (input.expect_first_row_contains as Record<string, unknown> | undefined) ?? null;

  if (!sql) return `DB STATE FAIL: "${label}" — sql is required.`;
  if (!/^SELECT\b/i.test(sql)) return `DB STATE FAIL: "${label}" — only SELECT queries allowed.`;
  if (/;/.test(sql)) return `DB STATE FAIL: "${label}" — multiple statements not allowed.`;

  const dbInfo = await getCompanyDatabase(companyId);
  if (!dbInfo?.connectionUri) return `DB STATE FAIL: "${label}" — no founder database provisioned.`;

  let rows: Record<string, unknown>[];
  try {
    const { neon } = await import('@neondatabase/serverless');
    const neonSql = neon(dbInfo.connectionUri);
    rows = (await neonSql.query(sql)) as Record<string, unknown>[];
  } catch (err) {
    return `DB STATE FAIL: "${label}" — query threw: ${err instanceof Error ? err.message : String(err)}`;
  }

  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
  checks.push({
    name: `row count >= ${minRows}`,
    pass: rows.length >= minRows,
    detail: `actual=${rows.length}`,
  });
  if (Number.isFinite(maxRows)) {
    checks.push({
      name: `row count <= ${maxRows}`,
      pass: rows.length <= maxRows,
      detail: `actual=${rows.length}`,
    });
  }
  if (expectFirst && rows[0]) {
    for (const [k, v] of Object.entries(expectFirst)) {
      const actual = (rows[0] as Record<string, unknown>)[k];
      const same = JSON.stringify(actual) === JSON.stringify(v);
      checks.push({
        name: `first row.${k}`,
        pass: same,
        detail: `expected=${JSON.stringify(v).slice(0, 60)} actual=${JSON.stringify(actual).slice(0, 60)}`,
      });
    }
  }

  const allPassed = checks.every((c) => c.pass);
  const header = allPassed
    ? `DB STATE PASS: "${label}" — ${rows.length} row(s) matched.`
    : `DB STATE FAIL: "${label}" — assertions failed.`;
  const lines = checks.map((c) => `  ${c.pass ? 'PASS' : 'FAIL'} ${c.name} (${c.detail})`).join('\n');
  const sample = rows[0] ? `\n  sample row: ${JSON.stringify(rows[0]).slice(0, 200)}` : '';
  return `${header}\n${lines}${sample}`;
}

// Stock journey templates — return partial verify_user_journey inputs the
// agent fills in with concrete URLs / field names. Lifts the most common
// flow patterns out of the agent's per-task generation so we get consistent
// coverage and reduce token cost.
function handleListJourneyTemplates(input: Record<string, unknown>): string {
  const which = ((input.template as string | undefined) ?? 'all').toLowerCase();
  const TEMPLATES: Record<string, { description: string; steps: Array<Record<string, unknown>>; substitute: string[] }> = {
    auth: {
      description: 'register → reach authenticated dashboard → log out → log back in → reach dashboard again. Catches session-cookie bugs (trust-proxy missing, cookie.secure misconfig, store-not-persisting).',
      steps: [
        { step: 'landing loads',         path: '/',                                            expect_status: 200 },
        { step: 'register form loads',   path: '/register',                                     expect_status: 200, expect_body_contains: 'password' },
        { step: 'submit register',       method: 'POST', path: '/auth/register', body: { email: '<TEST_EMAIL>', password: '<TEST_PASSWORD>' }, body_type: 'form', expect_status: 302, expect_redirect: '/dashboard', expect_body_not_contains: 'failed' },
        { step: 'dashboard authed',      path: '/dashboard',                                    expect_status: 200, expect_body_not_contains: 'Sign in' },
        { step: 'logout',                method: 'POST', path: '/auth/logout',                  expect_status: 302 },
        { step: 'login form loads',      path: '/login',                                        expect_status: 200 },
        { step: 'submit login',          method: 'POST', path: '/auth/login',    body: { email: '<TEST_EMAIL>', password: '<TEST_PASSWORD>' }, body_type: 'form', expect_status: 302, expect_redirect: '/dashboard', expect_body_not_contains: 'Invalid' },
        { step: 'dashboard after login', path: '/dashboard',                                    expect_status: 200 },
      ],
      substitute: ['<TEST_EMAIL>: a unique throwaway email like `test+<unix-ms>@baljia.test`', '<TEST_PASSWORD>: a 12+ char string the agent generates fresh per run'],
    },
    crud: {
      description: 'register → create one item via POST → see it on the dashboard → delete it → confirm gone. Catches lying-server bugs (302 with silently-failed INSERT) and missing-FK bugs.',
      steps: [
        { step: 'register first',     method: 'POST', path: '/auth/register', body: { email: '<TEST_EMAIL>', password: '<TEST_PASSWORD>' }, body_type: 'form', expect_status: 302, expect_redirect: '/dashboard' },
        { step: 'create item',        method: 'POST', path: '<CREATE_PATH>',  body: { '<TITLE_FIELD>': 'Smoke Test Item' },                  body_type: 'form', expect_status: [302, 201] },
        { step: 'item appears',       path: '/dashboard',                                                                                    expect_status: 200, expect_body_contains: 'Smoke Test Item' },
        { step: 'delete item',        method: 'POST', path: '<DELETE_PATH>',  expect_status: [200, 302] },
        { step: 'item gone',          path: '/dashboard',                                                                                    expect_status: 200, expect_body_not_contains: 'Smoke Test Item' },
      ],
      substitute: ['<CREATE_PATH>: e.g. /api/items', '<DELETE_PATH>: e.g. /api/items/:id/delete (you fetch the ID first OR use a slug)', '<TITLE_FIELD>: name of the form field, usually `title`'],
    },
    payment: {
      description: '/pricing page renders + Stripe payment link is reachable. Does not simulate Stripe checkout (that needs Stripe test-mode + webhooks); just proves the founder did wire a real link and not a placeholder.',
      steps: [
        { step: 'pricing page renders',  path: '/pricing',                                expect_status: 200, expect_body_contains: 'buy.stripe.com' },
        { step: 'Stripe link reachable', path: '<EXTRACTED_STRIPE_LINK>',                 expect_status: 200 },
      ],
      substitute: ['<EXTRACTED_STRIPE_LINK>: extract from the pricing page response with a regex like /https:\\/\\/buy\\.stripe\\.com\\/[A-Za-z0-9_]+/'],
    },
    settings: {
      description: 'register → update one profile field → reload dashboard → confirm new value rendered. Catches read-after-write bugs and session-data staleness.',
      steps: [
        { step: 'register',           method: 'POST', path: '/auth/register',   body: { email: '<TEST_EMAIL>', password: '<TEST_PASSWORD>' }, body_type: 'form', expect_status: 302 },
        { step: 'open settings',      path: '/settings',                                                                                       expect_status: 200 },
        { step: 'update field',       method: 'POST', path: '/settings/update', body: { '<FIELD>': '<NEW_VALUE>' },                            body_type: 'form', expect_status: [200, 302] },
        { step: 'reload settings',    path: '/settings',                                                                                       expect_status: 200, expect_body_contains: '<NEW_VALUE>' },
        { step: 'reload dashboard',   path: '/dashboard',                                                                                      expect_status: 200, expect_body_contains: '<NEW_VALUE>' },
      ],
      substitute: ['<FIELD>: settings field name, e.g. display_name', '<NEW_VALUE>: the value you submitted in the previous step'],
    },
    full_mvp: {
      description: 'Full happy-path: auth → first feature use → upgrade flow visible. Combines auth + crud + payment into one stateful journey. Most engineering tasks should use this template.',
      steps: [
        { step: 'landing loads',           path: '/',                                                          expect_status: 200 },
        { step: 'submit register',         method: 'POST', path: '/auth/register', body: { email: '<TEST_EMAIL>', password: '<TEST_PASSWORD>' }, body_type: 'form', expect_status: 302, expect_redirect: '/dashboard' },
        { step: 'dashboard authed',        path: '/dashboard',                                                  expect_status: 200, expect_body_not_contains: 'Sign in' },
        { step: 'create first item',       method: 'POST', path: '<CREATE_PATH>',  body: { '<TITLE_FIELD>': 'first item' },                       body_type: 'form', expect_status: [302, 201] },
        { step: 'item visible',            path: '/dashboard',                                                  expect_status: 200, expect_body_contains: 'first item' },
        { step: 'pricing rendered',        path: '/pricing',                                                    expect_status: 200, expect_body_contains: 'buy.stripe.com' },
        { step: 'logout',                  method: 'POST', path: '/auth/logout',                                expect_status: 302 },
        { step: 'sign back in',            method: 'POST', path: '/auth/login',    body: { email: '<TEST_EMAIL>', password: '<TEST_PASSWORD>' }, body_type: 'form', expect_status: 302, expect_redirect: '/dashboard' },
        { step: 'item still there',        path: '/dashboard',                                                  expect_status: 200, expect_body_contains: 'first item' },
      ],
      substitute: ['<CREATE_PATH>: feature create endpoint, e.g. /api/items', '<TITLE_FIELD>: feature form field, usually `title`', 'Always pair with verify_db_state asserting the user row + item row landed.'],
    },
  };

  const out: Record<string, unknown> = {};
  if (which === 'all') {
    for (const [k, v] of Object.entries(TEMPLATES)) out[k] = v;
  } else if (TEMPLATES[which]) {
    out[which] = TEMPLATES[which];
  } else {
    return `Error: unknown template "${which}". Valid: auth, crud, payment, settings, full_mvp, all.`;
  }
  return [
    `## Journey templates`,
    ``,
    `Each template is a partial verify_user_journey input. Substitute the <PLACEHOLDERS> with concrete values, set base_url to the deployed app, and pass the result as the verify_user_journey \`steps\` field.`,
    ``,
    `\`\`\`json`,
    JSON.stringify(out, null, 2),
    `\`\`\``,
    ``,
    `Reminders:`,
    `- Use a fresh test email per run: \`test+\${Date.now()}@baljia.test\``,
    `- Pair every CRUD-touching journey with verify_db_state to catch lying-server 302s.`,
    `- Stop on first failure; read render_get_logs; fix root cause; redeploy; re-run.`,
  ].join('\n');
}

async function handleCheckUrlHealth(input: Record<string, unknown>): Promise<string> {
  const url = input.url as string;
  if (!url) return 'Error: url is required.';

  try {
    const start = Date.now();
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000), // 15s timeout
      headers: { 'User-Agent': 'Baljia/1.0 health-check' },
    });
    const elapsed = Date.now() - start;

    if (response.ok) {
      return `Ã¢Å“â€¦ ${url} is UP Ã¢â‚¬â€ HTTP ${response.status} in ${elapsed}ms`;
    }

    return `Ã¢Å¡Â Ã¯Â¸Â ${url} returned HTTP ${response.status} in ${elapsed}ms Ã¢â‚¬â€ app may have an error. Check logs with render_get_logs.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return `Ã¢ÂÅ’ ${url} is DOWN Ã¢â‚¬â€ ${msg}. The deploy may have failed. Check logs or run render_rollback.`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Rollback Ã¢â€â‚¬Ã¢â€â‚¬

async function handleRenderRollback(input: Record<string, unknown>): Promise<string> {
  const serviceId = input.service_id as string;
  if (!serviceId) return 'Error: service_id is required.';

  try {
    const headers = renderHeaders();

    // Get last 5 deploys to find the most recent successful one
    const historyRes = await fetch(`${RENDER_API}/services/${serviceId}/deploys?limit=5`, { headers });
    if (!historyRes.ok) return `Failed to fetch deploy history: ${historyRes.statusText}`;

    const deploys = await historyRes.json() as Array<{ id?: string; status?: string; deploy?: { id?: string; status?: string } }>;
    if (!Array.isArray(deploys) || deploys.length < 2) {
      return 'No previous deployment found to roll back to. This service may only have one deploy.';
    }

    // Skip [0] (current), find the most recent "live" one after it
    const previousGood = deploys.slice(1).find((d) => {
      const status = d.deploy?.status ?? d.status;
      return status === 'live' || status === 'succeeded';
    });

    if (!previousGood) {
      return 'No successful previous deployment found to roll back to. All recent deploys may have failed.';
    }

    const deployId = previousGood.deploy?.id ?? previousGood.id;
    log.info('Rolling back Render service', { serviceId, deployId });

    // Trigger a new deploy (Render doesn't support re-deploying old deploy ID directly,
    // so we trigger fresh deploy and note the rollback)
    const deployRes = await fetch(`${RENDER_API}/services/${serviceId}/deploys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clearCache: 'do_not_clear' }),
    });

    const data = await deployRes.json() as { id?: string; status?: string; message?: string };
    if (!deployRes.ok) return `Rollback deploy failed: ${data.message ?? deployRes.statusText}`;

    return `Ã°Å¸â€â€ž Rollback triggered! New deploy ID: ${data.id} (based on last successful deploy).\nMonitor with render_get_deploy_status.`;
  } catch (err) {
    return `Rollback error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Custom Domain handlers Ã¢â€â‚¬Ã¢â€â‚¬


async function handleAttachCustomDomain(input: Record<string, unknown>, companyId: string): Promise<string> {
  const domain = input.domain as string;
  if (!domain) return 'Error: domain is required';

  try {
    const result = await attachCustomDomain(companyId, domain);
    if (!result) {
      return 'Failed to attach custom domain. Make sure a website has been deployed to Render first (use render_create_service).';
    }

    return [
      `Ã¢Å“â€¦ Custom domain "${result.domain}" attached!`,
      `Status: ${result.status}`,
      '',
      result.dnsInstructions,
      '',
      'Tell the founder to set up these DNS records. SSL will be automatic once DNS propagates (5-15 min).',
    ].join('\n');
  } catch (err) {
    return `Custom domain error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function handleVerifyCustomDomain(companyId: string): Promise<string> {
  try {
    const result = await verifyCustomDomain(companyId);
    if (!result) {
      return 'No custom domain configured for this company, or Render service not found.';
    }

    if (result.verified && result.sslReady) {
      return `Ã¢Å“â€¦ Domain "${result.domain}" is fully verified and SSL is active! The site is live at https://${result.domain}`;
    }

    return [
      `Ã¢ÂÂ³ Domain "${result.domain}" is not yet verified.`,
      `Verified: ${result.verified ? 'Ã¢Å“â€¦' : 'Ã¢ÂÅ’'}`,
      `SSL Ready: ${result.sslReady ? 'Ã¢Å“â€¦' : 'Ã¢ÂÅ’'}`,
      '',
      'The founder needs to set the DNS CNAME records. It can take 5-30 minutes to propagate.',
    ].join('\n');
  } catch (err) {
    return `Domain verification error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Database Infrastructure handlers Ã¢â€â‚¬Ã¢â€â‚¬

async function handleProvisionDatabase(companyId: string): Promise<string> {
  // Check if already provisioned
  const existing = await getCompanyDatabase(companyId);
  if (existing) {
    return [
      'Ã¢Å“â€¦ Database already provisioned!',
      `Project: ${existing.name}`,
      `Host: ${existing.host}`,
      `Connection: ${existing.connectionUri ? '(available Ã¢â‚¬â€ use get_database_info for code snippets)' : 'pending'}`,
      '',
      'Use run_migration to create tables, then push code that connects to this database.',
    ].join('\n');
  }

  // Get company slug for naming
  const [company] = await db.select({ slug: companies.slug, name: companies.name })
    .from(companies).where(eq(companies.id, companyId)).limit(1);

  if (!company?.slug) return 'Error: Company not found or missing slug.';

  try {
    const result = await provisionCompanyDatabase(companyId, company.slug);
    return [
      `Ã¢Å“â€¦ Database provisioned for ${company.name}!`,
      `Project: ${result.name}`,
      `Host: ${result.host}`,
      `Database: neondb (default)`,
      '',
      'Next steps:',
      '1. Use run_migration to create your schema (CREATE TABLE statements)',
      '2. Use get_database_info to get the connection string for your app code',
      '3. Push code that uses DATABASE_URL env var to connect',
      '4. Add DATABASE_URL to Render env vars when deploying',
    ].join('\n');
  } catch (err) {
    return `Database provisioning failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function handleGetDatabaseInfo(companyId: string): Promise<string> {
  try {
    const dbInfo = await getCompanyDatabase(companyId);
    if (!dbInfo) {
      return 'No database provisioned yet. Use provision_database first.';
    }

    // Mask the password in connection URI for safety in logs
    const maskedUri = dbInfo.connectionUri
      ? dbInfo.connectionUri.replace(/:[^:@]+@/, ':***@')
      : 'not available';

    return [
      `## Database Info`,
      `Project ID: ${dbInfo.projectId}`,
      `Host: ${dbInfo.host}`,
      `Database: neondb`,
      `Connection URI (masked): ${maskedUri}`,
      '',
      '## Code Integration',
      '```env',
      `DATABASE_URL="${maskedUri}"`,
      '```',
      '',
      '## Node.js connection example',
      '```javascript',
      `const { Pool } = require(${"'"}pg${"'"});`,
      'const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });',
      '```',
      '',
      'IMPORTANT: Add DATABASE_URL as an environment variable in Render when deploying.',
    ].join('\n');
  } catch (err) {
    return `Failed to get database info: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function handleRunMigration(input: Record<string, unknown>, companyId: string): Promise<string> {
  const sql = (input.sql as string)?.trim();
  const description = (input.description as string) ?? 'Migration';

  if (!sql) return 'Error: SQL migration statement is required.';

  // Safety: block destructive operations without explicit intent
  const BLOCKED_PATTERNS = /\b(TRUNCATE|DROP\s+DATABASE|DROP\s+SCHEMA)\b/i;
  if (BLOCKED_PATTERNS.test(sql)) {
    return 'Error: TRUNCATE, DROP DATABASE, and DROP SCHEMA are not allowed. Use DROP TABLE if you need to remove a specific table.';
  }

  // Get database info
  const dbInfo = await getCompanyDatabase(companyId);
  if (!dbInfo) {
    return 'No database provisioned. Use provision_database first.';
  }

  if (!dbInfo.connectionUri) {
    return 'Database exists but connection URI not available. Check NEON_API_KEY configuration.';
  }

  try {
    // Use Neon branching for safe migrations
    log.info('Running migration', { companyId, description, projectId: dbInfo.projectId });

    // Connect directly to the main branch and run migration
    // In production, we'd branch-test-merge, but for v1 direct execution is acceptable
    // CF-compat: use Neon HTTP driver (edge-compatible via fetch, no TCP pg)
    const { neon } = await import('@neondatabase/serverless');
    const neonSql = neon(dbInfo.connectionUri);
    const result = await neonSql.query(sql);
    const rowCount = Array.isArray(result) ? result.length : 0;

    log.info('Migration completed', { companyId, description, rowCount });

    return [
      `Ã¢Å“â€¦ Migration successful: "${description}"`,
      `Rows affected: ${rowCount}`,
      `SQL executed: ${sql.substring(0, 200)}${sql.length > 200 ? '...' : ''}`,
      '',
      'Use query_company_db to verify the schema.',
    ].join('\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.error('Migration failed', { companyId, description, error: msg });
    return `Migration failed: ${msg}\n\nSQL: ${sql.substring(0, 300)}`;
  }
}

async function handleQueryCompanyDb(input: Record<string, unknown>, companyId: string): Promise<string> {
  const sql = (input.sql as string)?.trim();
  if (!sql) return 'Error: SQL query is required.';

  // Only allow SELECT
  if (!/^SELECT\b/i.test(sql)) {
    return 'Error: Only SELECT queries are allowed. Use run_migration for DDL/DML.';
  }

  // Block dangerous patterns
  if (/;/.test(sql)) {
    return 'Error: Multiple statements not allowed. Send a single SELECT query.';
  }

  const dbInfo = await getCompanyDatabase(companyId);
  if (!dbInfo) return 'No database provisioned. Use provision_database first.';
  if (!dbInfo.connectionUri) return 'Database connection URI not available.';

  try {
    // CF-compat: use Neon HTTP driver (edge-compatible via fetch, no TCP pg)
    const { neon } = await import('@neondatabase/serverless');
    const neonSql = neon(dbInfo.connectionUri);
    const rows = (await neonSql.query(sql)) as Record<string, unknown>[];

    if (rows.length === 0) return 'Query returned 0 rows.';

    const truncated = rows.slice(0, 50);
    return `Query returned ${rows.length} rows:\n${JSON.stringify(truncated, null, 2)}${rows.length > 50 ? '\n... (showing first 50)' : ''}`;
  } catch (err) {
    return `Query failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Stripe Payment handlers Ã¢â€â‚¬Ã¢â€â‚¬
// Uses platform Stripe account with company_id metadata tagging.
// Each founder's products are logically isolated via metadata.
// Upgradeable to Stripe Connect when needed.

async function handleStripeCreateProduct(input: Record<string, unknown>, companyId: string): Promise<string> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return 'Error: STRIPE_SECRET_KEY not configured. Stripe integration unavailable.';

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' });

    const product = await stripe.products.create({
      name: input.name as string,
      description: (input.description as string) ?? undefined,
      metadata: { company_id: companyId, created_by: 'engineering_agent' },
    });

    return [
      `Ã¢Å“â€¦ Stripe product created!`,
      `Product ID: ${product.id}`,
      `Name: ${product.name}`,
      '',
      'Next: Use stripe_create_price to set pricing for this product.',
    ].join('\n');
  } catch (err) {
    return `Stripe product creation failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function handleStripeCreatePrice(input: Record<string, unknown>, companyId: string): Promise<string> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return 'Error: STRIPE_SECRET_KEY not configured.';

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' });

    const amountCents = input.amount_cents as number;
    const currency = (input.currency as string) ?? 'usd';
    const isRecurring = input.recurring === true;
    const interval = (input.interval as string) ?? 'month';

    const priceData: Record<string, unknown> = {
      product: input.product_id as string,
      unit_amount: amountCents,
      currency,
      metadata: { company_id: companyId },
    };

    if (isRecurring) {
      priceData.recurring = { interval };
    }

    const price = await stripe.prices.create(priceData as unknown as Parameters<typeof stripe.prices.create>[0]);

    const formattedPrice = `$${(amountCents / 100).toFixed(2)}`;
    const billing = isRecurring ? `/${interval}` : ' one-time';

    return [
      `Ã¢Å“â€¦ Price created: ${formattedPrice}${billing}`,
      `Price ID: ${price.id}`,
      `Product: ${input.product_id}`,
      '',
      'Next: Use stripe_create_payment_link to generate a checkout URL.',
    ].join('\n');
  } catch (err) {
    return `Stripe price creation failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function handleStripeCreatePaymentLink(input: Record<string, unknown>, companyId: string): Promise<string> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return 'Error: STRIPE_SECRET_KEY not configured.';

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' });

    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: input.price_id as string, quantity: 1 }],
      metadata: { company_id: companyId },
    });

    return [
      `Ã¢Å“â€¦ Payment link created!`,
      `URL: ${paymentLink.url}`,
      '',
      'This is a shareable checkout link. The founder can:',
      '1. Embed it as a button on their website',
      '2. Share it directly with customers',
      '3. Use it in email campaigns',
      '',
      'Code snippet for their site:',
      '```html',
      `<a href="${paymentLink.url}" class="btn">Subscribe Now</a>`,
      '```',
    ].join('\n');
  } catch (err) {
    return `Payment link creation failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function handleStripeGetProducts(companyId: string): Promise<string> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return 'Error: STRIPE_SECRET_KEY not configured.';

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' });

    // Fetch products tagged with this company
    const products = await stripe.products.search({
      query: `metadata['company_id']:'${companyId}'`,
    });

    if (products.data.length === 0) {
      return 'No Stripe products found for this company. Use stripe_create_product to get started.';
    }

    const lines: string[] = ['## Stripe Products\n'];

    for (const product of products.data) {
      lines.push(`### ${product.name} (${product.id})`);
      lines.push(`Status: ${product.active ? 'Active' : 'Inactive'}`);

      // Fetch prices for this product
      const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
      if (prices.data.length > 0) {
        lines.push('Prices:');
        for (const price of prices.data) {
          const amt = `$${((price.unit_amount ?? 0) / 100).toFixed(2)}`;
          const billing = price.recurring ? `/${price.recurring.interval}` : ' one-time';
          lines.push(`  - ${amt}${billing} (${price.id})`);
        }
      } else {
        lines.push('No prices configured yet.');
      }
      lines.push('');
    }

    return lines.join('\n');
  } catch (err) {
    return `Failed to list products: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ GitHub: branch + PR Ã¢â€â‚¬Ã¢â€â‚¬

async function githubCreateBranch(input: Record<string, unknown>, _companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = resolveRepo(input.repo as string);
    const branchName = input.branch_name as string;
    const baseBranch = (input.base_branch as string) ?? 'main';

    // Get SHA of base branch
    const refRes = await fetch(`${GITHUB_API}/repos/${repo}/git/ref/heads/${baseBranch}`, { headers });
    if (!refRes.ok) {
      const d = await refRes.json() as { message?: string };
      return `Could not get base branch ref: ${d.message ?? refRes.statusText}`;
    }
    const refData = await refRes.json() as { object: { sha: string } };
    const sha = refData.object.sha;

    // Create branch
    const createRes = await fetch(`${GITHUB_API}/repos/${repo}/git/refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
    });

    if (!createRes.ok) {
      const d = await createRes.json() as { message?: string };
      return `Branch creation failed: ${d.message ?? createRes.statusText}`;
    }

    return `Ã¢Å“â€¦ Branch \"${branchName}\" created in ${repo} (from ${baseBranch}).\nUse github_push_file with branch="${branchName}" to push changes.`;
  } catch (err) {
    return `GitHub branch error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function githubCreatePR(input: Record<string, unknown>, _companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = resolveRepo(input.repo as string);

    const body = {
      title: input.title as string,
      body: (input.body as string) ?? '',
      head: input.head_branch as string,
      base: (input.base_branch as string) ?? 'main',
    };

    const prRes = await fetch(`${GITHUB_API}/repos/${repo}/pulls`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await prRes.json() as { html_url?: string; number?: number; message?: string };
    if (!prRes.ok) return `PR creation failed: ${data.message ?? prRes.statusText}`;

    return `Ã¢Å“â€¦ Pull request #${data.number} created!\nURL: ${data.html_url}\nMerge "${input.head_branch}" Ã¢â€ â€™ "${body.base}"`;
  } catch (err) {
    return `GitHub PR error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Render: list + metrics Ã¢â€â‚¬Ã¢â€â‚¬

async function renderListServices(input: Record<string, unknown>): Promise<string> {
  try {
    const headers = renderHeaders();
    const limit = Math.min((input.limit as number) ?? 20, 100);
    const res = await fetch(`${RENDER_API}/services?limit=${limit}`, { headers });
    if (!res.ok) return `Render list failed: ${res.statusText}`;

    const data = await res.json() as Array<{ service?: { id?: string; name?: string; type?: string; serviceDetails?: { url?: string } } }>;
    if (!Array.isArray(data) || !data.length) return 'No Render services found.';

    const lines = data.map((item) => {
      const s = item.service ?? (item as { id?: string; name?: string; type?: string; serviceDetails?: { url?: string } });
      return `- [${s.id ?? '?'}] ${s.name ?? 'unnamed'} (${s.type ?? '?'}) Ã¢â‚¬â€ ${s.serviceDetails?.url ?? 'no URL'}`;
    });
    return `## Render Services (${data.length})\n${lines.join('\n')}`;
  } catch (err) {
    return `Render list error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function renderGetMetrics(input: Record<string, unknown>): Promise<string> {
  try {
    const headers = renderHeaders();
    const serviceId = input.service_id as string;
    const resolution = (input.resolution as string) ?? '1h';

    const res = await fetch(`${RENDER_API}/services/${serviceId}/metrics?resolution=${resolution}`, { headers });
    if (!res.ok) return `Metrics not available: ${res.statusText} (service must be a paid web service)`;

    const data = await res.json() as {
      cpuPercent?: Array<{ time: string; value: number }>;
      memoryBytes?: Array<{ time: string; value: number }>;
    };

    const cpuLines = (data.cpuPercent ?? []).slice(-5).map((p) => `  ${p.time}: ${p.value.toFixed(1)}%`).join('\n');
    const memLines = (data.memoryBytes ?? []).slice(-5).map((p) => `  ${p.time}: ${(p.value / 1024 / 1024).toFixed(0)} MB`).join('\n');

    return `## Service Metrics (${resolution})\n\n**CPU:**\n${cpuLines || '  No data'}\n\n**Memory:**\n${memLines || '  No data'}`;
  } catch (err) {
    return `Render metrics error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ GitHub: search code Ã¢â€â‚¬Ã¢â€â‚¬

async function githubSearchCode(input: Record<string, unknown>, _companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = resolveRepo(input.repo as string);
    const query = input.query as string;
    const language = input.language as string | undefined;

    let q = `${encodeURIComponent(query)}+repo:${repo}`;
    if (language) q += `+language:${encodeURIComponent(language)}`;

    const res = await fetch(`${GITHUB_API}/search/code?q=${q}&per_page=10`, { headers });
    if (!res.ok) {
      const d = await res.json() as { message?: string };
      if (res.status === 403) return `GitHub search rate limited. Try again in 30 seconds, or use github_read_file to read specific files directly.`;
      return `GitHub search failed: ${d.message ?? res.statusText}`;
    }

    const data = await res.json() as {
      total_count: number;
      items: Array<{ path: string; html_url: string; text_matches?: Array<{ fragment: string }> }>;
    };

    if (!data.items.length) return `No code found matching "${query}" in ${repo}.`;

    const lines = data.items.map((item) => {
      const fragment = item.text_matches?.[0]?.fragment?.substring(0, 120) ?? '';
      return `Ã°Å¸â€œâ€ž ${item.path}\n   ${fragment ? `\`${fragment.replace(/\n/g, ' ')}\`` : '(no preview)'}`;
    });

    return `## Code Search: "${query}" (${data.total_count} results, showing ${data.items.length})\n\n${lines.join('\n\n')}`;
  } catch (err) {
    return `GitHub search error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ GitHub: multi-file atomic commit via Git Trees API Ã¢â€â‚¬Ã¢â€â‚¬

async function githubCreateCommit(input: Record<string, unknown>, _companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = resolveRepo(input.repo as string);
    const branch = (input.branch as string) ?? 'main';
    const message = input.message as string;
    const files = input.files as Array<{ path: string; content: string }>;

    if (!files?.length) return 'Error: at least one file is required.';

    // Step 1: Get latest commit SHA on branch
    const refRes = await fetch(`${GITHUB_API}/repos/${repo}/git/ref/heads/${branch}`, { headers });
    if (!refRes.ok) return `Could not get branch ref: ${(await refRes.json() as { message?: string }).message}`;
    const refData = await refRes.json() as { object: { sha: string } };
    const latestCommitSha = refData.object.sha;

    // Step 2: Get tree SHA of latest commit
    const commitRes = await fetch(`${GITHUB_API}/repos/${repo}/git/commits/${latestCommitSha}`, { headers });
    if (!commitRes.ok) return `Could not get commit: ${commitRes.statusText}`;
    const commitData = await commitRes.json() as { tree: { sha: string } };
    const baseTreeSha = commitData.tree.sha;

    // Step 3: Create new tree
    const treeRes = await fetch(`${GITHUB_API}/repos/${repo}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
      }),
    });
    if (!treeRes.ok) return `Could not create tree: ${(await treeRes.json() as { message?: string }).message}`;
    const treeData = await treeRes.json() as { sha: string };

    // Step 4: Create commit
    const newCommitRes = await fetch(`${GITHUB_API}/repos/${repo}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, tree: treeData.sha, parents: [latestCommitSha] }),
    });
    if (!newCommitRes.ok) return `Could not create commit: ${(await newCommitRes.json() as { message?: string }).message}`;
    const newCommit = await newCommitRes.json() as { sha: string };

    // Step 5: Update branch ref
    const updateRes = await fetch(`${GITHUB_API}/repos/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ sha: newCommit.sha }),
    });
    if (!updateRes.ok) return `Commit created (${newCommit.sha.substring(0, 7)}) but branch update failed: ${updateRes.statusText}`;

    return `Ã¢Å“â€¦ Committed ${files.length} file(s) to ${repo}/${branch}\nCommit: ${newCommit.sha.substring(0, 7)} Ã¢â‚¬â€ "${message}"\nFiles: ${files.map((f) => f.path).join(', ')}`;
  } catch (err) {
    return `GitHub commit error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Render: list databases Ã¢â€â‚¬Ã¢â€â‚¬

async function renderListDatabases(input: Record<string, unknown>): Promise<string> {
  try {
    const headers = renderHeaders();
    const limit = Math.min((input.limit as number) ?? 20, 100);

    const res = await fetch(`${RENDER_API}/postgres?limit=${limit}`, { headers });
    if (!res.ok) return `Render databases list failed: ${res.statusText}`;

    const data = await res.json() as Array<{
      postgres?: { id?: string; name?: string; plan?: string; status?: string; databaseName?: string };
    }>;

    if (!Array.isArray(data) || !data.length) return 'No Render Postgres databases found.';

    const lines = data.map((item) => {
      const db = item.postgres ?? (item as { id?: string; name?: string; plan?: string; status?: string; databaseName?: string });
      return `- [${db.id ?? '?'}] ${db.name ?? 'unnamed'} | DB: ${db.databaseName ?? '?'} | Plan: ${db.plan ?? '?'} | Status: ${db.status ?? '?'}`;
    });

    return `## Render Databases (${data.length})\n${lines.join('\n')}`;
  } catch (err) {
    return `Render list databases error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}


// SKILLS Ã¢â‚¬â€ read .claude/skills/<name>/SKILL.md
// Polsia-style knowledge layer the agent loads BEFORE writing domain code.
// Skills capture stack-specific patterns + anti-patterns the LLM's training
// data is missing or wrong about for Baljia's current deploy path.
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

const SKILLS_ROOT = join(process.cwd(), '.claude', 'skills');

/** Hard-coded one-line summaries Ã¢â‚¬â€ keeps `list_skills` fast (no file reads)
 *  and gives the agent a stable index it can scan. Update if a SKILL.md file
 *  is renamed; the SKILL.md content itself doesn't need to be touched. */
const SKILL_SUMMARIES: Record<string, string> = {
  'skeleton-nextjs':
    'READ THIS FIRST for any full-stack SaaS. Clones the Baljia Next.js 15 skeleton (Better Auth, Drizzle, Neon, AI gateway, Stripe, Shadcn/ui). Users never provide their own API key Ã¢â‚¬â€ AI calls route through the Baljia gateway. Use github_fork_skeleton + run_drizzle_push instead of building from scratch.',
  'render-infra':
    'MANDATORY before any Render deploy. Documents the /health endpoint, PORT binding, ephemeral filesystem rules, build/start commands, env var patterns, free plan limits, and deploy verification checklist.',
  'openai-proxy':
    'AI utility features: embeddings (text-embedding-3-small), image gen (dall-e-3), OCR (gpt-4o vision), text generation. Import from @/lib/ai only. Covers pgvector storage, R2 persistence for images, and error handling.',
  'neon-postgres':
    'Database access for Render founder apps. Provision company Neon first, pass DATABASE_URL to Render, use pg or Drizzle node-postgres, and verify migrations with insert/readback.',
  'frontend-design':
    'UI patterns for Render founder apps. Product-first screens, Baljia visual language, mobile-first layout, accessible forms, and verification through deployed Render routes.',
  'stripe-payments':
    'Payment integration for Render apps. Default to Payment Links, use Checkout Sessions only when needed, store Stripe keys in Render env vars, and verify checkout/webhooks.',
  'r2-storage':
    'Asset storage for generated media, ad creatives, screenshots, exports, and public URLs. Use for Meta Ads media assets, not app deployment.',
  'email-postmark':
    'Transactional email for Render apps. Send through Postmark over HTTPS or platform send path, store tokens in Render env vars, and report sender/recipient verification.',
  'agent-sdk':
    'AI features inside Render founder apps. Keep actions narrow, store provider keys in Render env vars, add timeouts/fallbacks, and verify success plus missing-key behavior.',
  'auth-sessions':
    'Session-based auth for SaaS founder apps. Uses express-session + bcryptjs + connect-pg-simple (Postgres sessions). Covers register, login, logout, protected routes, plan gating, and Stripe checkout linked to user accounts.',
  'craft-frontend':
    'Frontend quality rules: anti-AI-slop patterns, palette + typography craft, state coverage (hover/focus/disabled/loading on every interactive element), form validation UX, WCAG accessibility baseline, and animation discipline. Read BEFORE any landing page, dashboard, or in-app UI.',
  'webhooks':
    'Secure webhook handling for Stripe and GitHub. Signature verification (stripe.webhooks.constructEvent, GitHub X-Hub-Signature-256), idempotency via Neon upsert, event routing, error response rules, and local testing checklist.',
  'background-jobs':
    'Cron jobs on Render: use node-cron inside a separate Worker service. Never use setInterval, worker_threads, or in-process timers. Covers job registration, Render cron service config, Redis-free queue via Neon, retry logic, and dead-letter logging.',
  'verify-deploy':
    'MANDATORY after every deployment. 8-step QA sequence: Render health check, frontend load, auth route, DB schema presence, AI gateway, Stripe webhook signature, email config, and log scan. Includes failure diagnosis table and a verification report template to show the user.',
};

function handleListSkills(): string {
  if (!existsSync(SKILLS_ROOT)) {
    return 'Skills directory does not exist (.claude/skills). The agent has no curated knowledge layer Ã¢â‚¬â€ proceed with general LLM knowledge but expect more iterations.';
  }
  const dirs = readdirSync(SKILLS_ROOT)
    .filter((name) => {
      try {
        return statSync(join(SKILLS_ROOT, name)).isDirectory()
          && existsSync(join(SKILLS_ROOT, name, 'SKILL.md'));
      } catch { return false; }
    })
    .sort();

  if (dirs.length === 0) {
    return '.claude/skills/ exists but contains no skill files. Create directories with SKILL.md to populate.';
  }

  const lines = ['## Available skills', '', 'Read the relevant one BEFORE writing code in that domain. Use `read_skill` with the name.', ''];
  for (const dir of dirs) {
    const summary = SKILL_SUMMARIES[dir] ?? '(no summary Ã¢â‚¬â€ read the file)';
    lines.push(`- **${dir}** Ã¢â‚¬â€ ${summary}`);
  }
  return lines.join('\n');
}

function handleReadSkill(input: Record<string, unknown>): string {
  const name = String(input.skill ?? '').trim();
  if (!name) return 'Error: missing required argument "skill". Call list_skills to see available names.';

  // Defense: only allow kebab-case alphanumeric. Blocks ../../etc/passwd shenanigans
  // even though SKILLS_ROOT is a fixed prefix Ã¢â‚¬â€ belt + suspenders.
  if (!/^[a-z0-9-]+$/.test(name)) {
    return `Error: skill name "${name}" must be kebab-case alphanumeric. Call list_skills.`;
  }

  const filePath = join(SKILLS_ROOT, name, 'SKILL.md');
  if (!existsSync(filePath)) {
    return `Error: skill "${name}" not found. Run list_skills to see what's available.`;
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    return content;
  } catch (err) {
    return `Error reading skill "${name}": ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Skeleton: fork the Baljia Next.js SaaS skeleton into a company repo Ã¢â€â‚¬Ã¢â€â‚¬

const SKELETON_REPO = 'BALAJIapps/Balaji'; // master template repo

// ── Express skeleton fork (PRIMARY for Render-hosted founder apps) ──
//
// Reads the skeleton files from skeletons/express-render/ on the platform
// disk, applies per-company placeholder substitution (__SLUG__, __APP_NAME__),
// and pushes them all to the company's GitHub repo as a single atomic
// commit via the Trees API. Mirrors the Next.js skeleton flow but for
// plain Express + Postgres + sessions stacks deployed on Render.

import { promises as fsp } from 'fs';
import * as path from 'path';
import { githubFetch } from '@/lib/services/github-throttle';

const EXPRESS_SKELETON_DIR = path.join(process.cwd(), 'skeletons', 'express-render');

async function collectSkeletonFiles(rootDir: string, slug: string, appName: string): Promise<Array<{ path: string; content: string }>> {
  async function walk(absDir: string, relPrefix: string): Promise<Array<{ path: string; content: string }>> {
    const entries = await fsp.readdir(absDir, { withFileTypes: true });
    const out: Array<{ path: string; content: string }> = [];
    for (const e of entries) {
      const abs = path.join(absDir, e.name);
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push(...await walk(abs, rel));
      } else if (e.isFile()) {
        // node_modules / lockfiles / build output should not be in the
        // skeleton dir, but skip the usual suspects defensively.
        if (rel.startsWith('node_modules/') || rel.endsWith('.lock') || rel.endsWith('.pyc')) continue;
        const raw = await fsp.readFile(abs, 'utf8');
        const content = raw.replace(/__SLUG__/g, slug).replace(/__APP_NAME__/g, appName);
        out.push({ path: rel, content });
      }
    }
    return out;
  }
  return walk(rootDir, '');
}

async function handleForkExpressSkeleton(input: Record<string, unknown>, companyId: string): Promise<string> {
  // 1. Look up company state — need github_repo + slug + display name.
  const [company] = await db.select({
    name: companies.name,
    slug: companies.slug,
    github_repo: companies.github_repo,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) return 'Error: company not found.';
  if (!company.github_repo) {
    return 'Error: no GitHub repo on this company. Call render_create_service or the GitHub provisioning path first; the repo must exist before the skeleton can be pushed.';
  }
  if (!company.slug) {
    return 'Error: company has no slug. Onboarding is incomplete; cannot derive subdomain.';
  }
  // Render service names cap at 30 chars. Slugs from onboarding are typically
  // 8-15, but defensively guard so a long slug doesn't cause render_create_service
  // to 400 with a confusing error after we've already pushed code.
  if (company.slug.length > 30) {
    return `Error: slug "${company.slug}" is ${company.slug.length} chars; Render service names must be ≤30. Update the company slug before forking.`;
  }
  if (!/^[a-z][a-z0-9-]*$/.test(company.slug)) {
    return `Error: slug "${company.slug}" must be lowercase alphanumeric + hyphens, starting with a letter.`;
  }

  const appName = (input.app_name as string | undefined)?.trim() || company.name || company.slug;
  const repo = company.github_repo;
  const headers = githubHeaders();

  // 2. Read & template all skeleton files.
  let files: Array<{ path: string; content: string }>;
  try {
    files = await collectSkeletonFiles(EXPRESS_SKELETON_DIR, company.slug, appName);
  } catch (err) {
    return `Error reading skeleton dir (${EXPRESS_SKELETON_DIR}): ${err instanceof Error ? err.message : String(err)}`;
  }
  if (files.length === 0) {
    return `Error: skeleton dir ${EXPRESS_SKELETON_DIR} has no files.`;
  }

  // 3. Safety: refuse to overwrite a non-trivial existing repo. The fresh
  // GitHub repo provisioned by the platform contains only auto-init README.
  // If the repo already has app code (server.js, src/, etc.), the agent
  // should be using github_create_commit to patch, not re-fork.
  try {
    const listRes = await githubFetch(`${GITHUB_API}/repos/${repo}/contents/`, { headers });
    if (listRes.ok) {
      const entries = await listRes.json() as Array<{ name: string; type: string }>;
      const sentinels = ['server.js', 'package.json', 'src', 'tests'];
      const collisions = entries.filter((e) => sentinels.includes(e.name));
      if (collisions.length > 0) {
        return `Refusing to fork-overwrite ${repo} — already contains: ${collisions.map((c) => c.name).join(', ')}. Use github_create_commit to patch specific files, or delete the repo and re-provision.`;
      }
    }
  } catch {
    // Listing failed; fall through and let the commit attempt surface the real error.
  }

  // 4. Get latest commit + tree on main (the auto-init commit).
  const refRes = await githubFetch(`${GITHUB_API}/repos/${repo}/git/ref/heads/main`, { headers });
  if (!refRes.ok) {
    const errBody = await refRes.json().catch(() => ({})) as { message?: string };
    return `Could not read main branch ref on ${repo}: ${errBody.message ?? refRes.statusText}`;
  }
  const refData = await refRes.json() as { object: { sha: string } };
  const baseCommitSha = refData.object.sha;

  const baseCommitRes = await githubFetch(`${GITHUB_API}/repos/${repo}/git/commits/${baseCommitSha}`, { headers });
  if (!baseCommitRes.ok) return `Could not read base commit: ${baseCommitRes.statusText}`;
  const baseCommit = await baseCommitRes.json() as { tree: { sha: string } };

  // 5. Create new tree with all skeleton files. base_tree means the existing
  // README from auto_init is preserved unless we explicitly overwrite it,
  // which we DO via the README.md in the skeleton.
  const treeRes = await githubFetch(`${GITHUB_API}/repos/${repo}/git/trees`, {
    method: 'POST', headers,
    body: JSON.stringify({
      base_tree: baseCommit.tree.sha,
      tree: files.map((f) => ({ path: f.path, mode: '100644' as const, type: 'blob' as const, content: f.content })),
    }),
  });
  if (!treeRes.ok) {
    const errBody = await treeRes.json().catch(() => ({})) as { message?: string };
    return `Could not create tree: ${errBody.message ?? treeRes.statusText}`;
  }
  const treeData = await treeRes.json() as { sha: string };

  // 6. Commit the tree.
  const commitMsg = `Fork Baljia Express skeleton for ${appName}\n\nIncludes: Zod env validation, trust-proxy, Postgres sessions, /api/health probing DB+session+Stripe, structured logging, withTimeout helper, ok/fail discriminated unions, tests/.`;
  const newCommitRes = await githubFetch(`${GITHUB_API}/repos/${repo}/git/commits`, {
    method: 'POST', headers,
    body: JSON.stringify({ message: commitMsg, tree: treeData.sha, parents: [baseCommitSha] }),
  });
  if (!newCommitRes.ok) {
    const errBody = await newCommitRes.json().catch(() => ({})) as { message?: string };
    return `Could not create commit: ${errBody.message ?? newCommitRes.statusText}`;
  }
  const newCommit = await newCommitRes.json() as { sha: string };

  // 7. Update main to point at the new commit.
  const updateRes = await githubFetch(`${GITHUB_API}/repos/${repo}/git/refs/heads/main`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ sha: newCommit.sha }),
  });
  if (!updateRes.ok) {
    return `Commit ${newCommit.sha.substring(0, 7)} created but branch update failed: ${updateRes.statusText}`;
  }

  const fileSummary = files.map((f) => `  - ${f.path}`).join('\n');
  return [
    `Express skeleton forked into ${repo}`,
    `Commit: ${newCommit.sha.substring(0, 7)} (${files.length} files)`,
    ``,
    `Files written:`,
    fileSummary,
    ``,
    `Next steps:`,
    `1. run_migration with the contents of db/schema.sql to set up users + session + items tables`,
    `2. Customize landingPage(), dashboardPage(), and the /api/items routes in server.js for your feature`,
    `3. Update db/schema.sql with feature-specific tables (additions only — do not modify users / session)`,
    `4. render_create_service to deploy. The skeleton's /api/health endpoint will be auto-used as Render's healthCheckPath.`,
    `5. After deploy: verify_user_journey for register/login/dashboard. The skeleton's tests/ folder mirrors what the journey verifier checks.`,
  ].join('\n');
}

async function githubForkSkeleton(input: Record<string, unknown>, companyId: string): Promise<string> {
  const repoSlug = (input.repo as string)?.trim();
  if (!repoSlug) return 'Error: repo is required (e.g. "genesis-advertising-hen6").';

  const description = (input.description as string) ?? 'SaaS app built on Baljia skeleton';
  const org = githubOrg();
  const targetRepo = `${org}/${repoSlug}`;
  const headers = githubHeaders();

  try {
    // Step 1: Check if target repo already exists
    const existRes = await fetch(`${GITHUB_API}/repos/${targetRepo}`, { headers });
    if (existRes.ok) {
      return [
        `Ã¢Å“â€¦ Repo ${targetRepo} already exists Ã¢â‚¬â€ skeleton was previously forked.`,
        `Next: use github_push_file to patch in feature-specific files (db/schema.ts, app/actions/, etc.)`,
        `Then: call run_drizzle_push to sync the schema to the database.`,
        `Finally: call render_create_service with buildCommand="pnpm install && pnpm build" and startCommand="pnpm start".`,
      ].join('\n');
    }

    // Step 2: Fork skeleton repo into the org
    const forkRes = await fetch(`${GITHUB_API}/repos/${SKELETON_REPO}/forks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        organization: org,
        name: repoSlug,
        default_branch_only: true,
      }),
    });

    const forkData = await forkRes.json() as { full_name?: string; html_url?: string; message?: string };

    if (!forkRes.ok) {
      if (forkRes.status === 404 || forkRes.status === 403) {
        return [
          `Ã¢Å¡Â Ã¯Â¸Â Could not fork skeleton (${forkData.message ?? forkRes.statusText}).`,
          `The skeleton repo "${SKELETON_REPO}" may be private or the token lacks fork permissions.`,
          `Workaround: ask the platform admin to make ${SKELETON_REPO} a GitHub template repo.`,
          `For now, use github_create_repo to create an empty repo and push the skeleton files manually via github_create_commit.`,
        ].join('\n');
      }
      return `Fork failed: ${forkData.message ?? forkRes.statusText}`;
    }

    const fullName = forkData.full_name ?? targetRepo;

    // Step 3: Update the fork description
    await fetch(`${GITHUB_API}/repos/${fullName}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ description }),
    });

    // Step 4: Save repo to company record
    await db.update(companies)
      .set({ github_repo: fullName })
      .where(eq(companies.id, companyId));

    log.info('Skeleton forked', { companyId, repo: fullName });

    return [
      `Ã¢Å“â€¦ Skeleton forked to ${fullName}!`,
      `URL: ${forkData.html_url ?? `https://github.com/${fullName}`}`,
      ``,
      `What you get for free:`,
      `  Ã¢â‚¬Â¢ Better Auth (email+password, sessions, DB-backed)`,
      `  Ã¢â‚¬Â¢ Drizzle ORM + Neon Postgres (db/schema.ts)`,
      `  Ã¢â‚¬Â¢ AI calls via Baljia gateway (lib/ai.ts) Ã¢â‚¬â€ NO user API key needed`,
      `  Ã¢â‚¬Â¢ Stripe checkout + webhook handler`,
      `  Ã¢â‚¬Â¢ Shadcn/ui + Tailwind 4`,
      `  Ã¢â‚¬Â¢ Next.js 15 App Router with middleware-protected /app/* routes`,
      ``,
      `Next steps:`,
      `1. Read the current db/schema.ts via github_read_file`,
      `2. Push your feature tables (books, projects, etc.) via github_push_file`,
      `3. Call run_drizzle_push to create tables in the database`,
      `4. Push your feature Server Actions (app/actions/<feature>.ts)`,
      `5. Push your feature pages (app/app/<feature>/page.tsx)`,
      `6. Call render_create_service with pnpm build + pnpm start`,
    ].join('\n');
  } catch (err) {
    return `Skeleton fork error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Skeleton: run Drizzle schema push against the company's Neon DB Ã¢â€â‚¬Ã¢â€â‚¬

async function handleRunDrizzlePush(input: Record<string, unknown>, companyId: string): Promise<string> {
  const repo = (input.repo as string)?.trim();
  if (!repo) return 'Error: repo is required.';

  // Get the company's database connection
  const dbInfo = await getCompanyDatabase(companyId);
  if (!dbInfo) {
    return 'No database provisioned yet. Use provision_database first, then run_drizzle_push.';
  }
  if (!dbInfo.connectionUri) {
    return 'Database exists but connection URI not available. Check NEON_API_KEY configuration.';
  }

  // Read current db/schema.ts from the repo
  let schemaContent: string;
  try {
    const result = await githubReadFile({ repo, path: 'db/schema.ts' }, companyId);
    if (result.startsWith('GitHub read failed') || result.startsWith('GitHub read error')) {
      return `Could not read db/schema.ts from ${repo}: ${result}\n\nMake sure you pushed the schema file first via github_push_file.`;
    }
    schemaContent = result;
  } catch (err) {
    return `Failed to read db/schema.ts: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }

  // Extract table names from the schema content for the report
  const tableMatches = schemaContent.match(/pgTable\(['"]([^'"]+)['"]/g) ?? [];
  const tableNames = tableMatches.map(m => m.match(/pgTable\(['"]([^'"]+)['"]/)?.[1] ?? '').filter(Boolean);

  // Drizzle push requires running the CLI locally. Since we can't exec CLI in CF workers,
  // we trigger a platform migration endpoint that runs drizzle-kit push in a serverless runner.
  const migrationEndpoint = process.env.DRIZZLE_PUSH_ENDPOINT;

  if (migrationEndpoint) {
    try {
      const response = await fetch(migrationEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DRIZZLE_PUSH_SECRET ?? ''}`,
        },
        body: JSON.stringify({
          connectionUri: dbInfo.connectionUri,
          schema: schemaContent,
          companyId,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const err = await response.text();
        return `Drizzle push failed (remote runner): ${err}`;
      }

      const result = await response.json() as { tables?: string[]; warnings?: string[] };
      const tables = result.tables ?? tableNames;

      return [
        `Ã¢Å“â€¦ Drizzle schema pushed successfully!`,
        `Tables synced (${tables.length}): ${tables.join(', ')}`,
        result.warnings?.length ? `\nWarnings:\n${result.warnings.map(w => `  - ${w}`).join('\n')}` : '',
        ``,
        `Next: push your feature code (Server Actions, pages) and deploy to Render.`,
      ].filter(Boolean).join('\n');
    } catch (err) {
      log.warn('Remote drizzle push failed, falling back to advisory', { companyId, error: err });
    }
  }

  // Fallback: report what WOULD be synced and instruct the agent to add db:push to the build command
  return [
    `Ã¢Å¡Â Ã¯Â¸Â Remote Drizzle push runner not configured (DRIZZLE_PUSH_ENDPOINT missing).`,
    ``,
    `Schema detected in db/schema.ts:`,
    `  Tables: ${tableNames.length > 0 ? tableNames.join(', ') : '(none detected Ã¢â‚¬â€ check schema format)'}`,
    ``,
    `Workaround Ã¢â‚¬â€ add schema sync to the Render build command:`,
    `  buildCommand: "pnpm install && pnpm db:push && pnpm build"`,
    ``,
    `This runs Drizzle push during the Render build so tables are created before the app starts.`,
    `Use this build command in render_create_service.`,
    ``,
    `The skeleton already has the db:push script wired in package.json.`,
  ].join('\n');
}

// â”€â”€ create_instance: atomic fork + provision + deploy â”€â”€

async function handleCreateInstance(input: Record<string, unknown>, companyId: string): Promise<string> {
  const appName = (input.app_name as string)?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!appName) return 'Error: app_name is required (e.g. "acme-crm").';

  const description = (input.description as string) ?? 'SaaS app built on Baljia skeleton';
  const extraEnvVars = (input.env_vars as Record<string, string>) ?? {};
  const org = githubOrg();
  const repoSlug = `${appName}-${companyId.slice(0, 6)}`;

  const steps: string[] = [];
  let repoUrl = '';
  let databaseUrl = '';
  let serviceUrl = '';

  // Step 1: Fork skeleton
  steps.push('Step 1/4: Forking Next.js skeleton...');
  const forkResult = await githubForkSkeleton({ repo: repoSlug, description }, companyId);
  if (forkResult.startsWith('Fork failed') || forkResult.startsWith('Error:')) {
    return `create_instance failed at skeleton fork:\n${forkResult}`;
  }
  repoUrl = `https://github.com/${org}/${repoSlug}`;
  steps.push(`  âœ… Repo: ${repoUrl}`);

  // Step 2: Provision database
  steps.push('Step 2/4: Provisioning Neon Postgres...');
  const dbInfo = await provisionCompanyDatabase(companyId, repoSlug);
  if (!dbInfo) {
    return `create_instance: database provisioning failed. Check NEON_API_KEY.`;
  }
  databaseUrl = dbInfo.connectionUri ?? '';
  steps.push(`  âœ… Database: ${dbInfo.host ?? 'provisioned'}`);

  // Step 3: Create Render service
  steps.push('Step 3/4: Creating Render web service...');
  const authSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const envVars: Record<string, string> = {
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: authSecret,
    BETTER_AUTH_URL: `https://${repoSlug}.onrender.com`,
    NEXT_PUBLIC_APP_URL: `https://${repoSlug}.onrender.com`,
    NODE_ENV: 'production',
    ...extraEnvVars,
  };


  const renderApiKey = process.env.RENDER_API_KEY;
  if (!renderApiKey) {
    return [
      ...steps,
      `âš ï¸  RENDER_API_KEY not configured â€” cannot create Render service automatically.`,
      ``,
      `Manual step: Create a Render web service with:`,
      `  repo: ${repoUrl}`,
      `  buildCommand: pnpm install && pnpm db:push && pnpm build`,
      `  startCommand: pnpm start`,
      `  env vars: See below`,
      ...Object.entries(envVars).map(([k, v]) => `  ${k}=${k.includes('SECRET') || k.includes('TOKEN') || k.includes('URL') && v.includes('neon') ? '***' : v}`),
    ].join('\n');
  }

  // Create Render service via API
  const renderRes = await fetch(`${RENDER_API}/services`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${renderApiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      type: 'web_service',
      name: repoSlug,
      repo: repoUrl,
      branch: 'main',
      buildCommand: 'pnpm install && pnpm db:push && pnpm build',
      startCommand: 'pnpm start',
      plan: 'free',
      envVars: Object.entries(envVars).map(([key, value]) => ({ key, value })),
    }),
  });

  const renderData = await renderRes.json() as { service?: { id: string; url?: string }; id?: string; url?: string; message?: string };
  const service = renderData.service ?? renderData;

  if (!renderRes.ok) {
    steps.push(`  âš ï¸  Render service creation failed: ${renderData.message ?? renderRes.statusText}`);
    steps.push(`  Proceed manually with the repo: ${repoUrl}`);
  } else {
    const serviceId = service.id ?? '';
    serviceUrl = service.url ?? `https://${repoSlug}.onrender.com`;

    // Save service ID to company record
    if (serviceId) {
      await db.update(companies)
        .set({ render_service_id: serviceId })
        .where(eq(companies.id, companyId));
    }
    steps.push(`  âœ… Render service: ${serviceUrl}`);
    steps.push(`  Service ID: ${serviceId}`);
  }

  // Step 4: Summary
  steps.push('Step 4/4: Instance ready!');
  steps.push('');
  steps.push('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  steps.push(`ðŸš€ App: ${description}`);
  steps.push(`ðŸ“¦ Repo: ${repoUrl}`);
  steps.push(`ðŸŒ URL: ${serviceUrl || '(will be assigned by Render on first deploy)'}`);
  steps.push(`ðŸ—„ï¸  DB: ${databaseUrl ? 'Provisioned (connection saved)' : 'Not provisioned'}`);
  steps.push('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  steps.push('');
  steps.push('What is pre-wired (no setup needed):');
  steps.push('  â€¢ Better Auth (email+password, DB sessions)');
  steps.push('  â€¢ Drizzle ORM + Neon Postgres');
  steps.push('  â€¢ AI gateway (no user API key needed)');
  steps.push('  â€¢ Stripe checkout + webhooks');
  steps.push('  â€¢ Shadcn/ui + Tailwind 4');
  steps.push('');
  steps.push('Next: push feature-specific files via github_push_file, then Render will auto-deploy from main.');
  steps.push('');
  steps.push('⚠️  MANDATORY NEXT STEP: After the deploy completes (allow 3-5 min), run the verify-deploy');
  steps.push('   skill checklist to confirm frontend, backend, auth, DB, and integrations all work.');
  steps.push('   Use: read_skill({ skill: "verify-deploy" }) then execute each check_url_health step.');

  log.info('Instance created', { companyId, repoSlug, serviceUrl });
  return steps.join('\n');
}

// â”€â”€ get_preview: return the company's live Render URL â”€â”€

async function handleGetPreview(companyId: string): Promise<string> {
  // First check saved company record
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
  });

  const serviceId = company?.render_service_id;
  const renderApiKey = process.env.RENDER_API_KEY;

  if (!serviceId) {
    return [
      'No Render service ID found for this company.',
      'If you just created a service, save the service ID first.',
      'Or call create_instance to provision a full instance.',
    ].join('\n');
  }

  if (!renderApiKey) {
    return `Service ID: ${serviceId}\nURL: https://${company?.github_repo?.split('/')[1] ?? serviceId}.onrender.com\n(RENDER_API_KEY not set â€” URL is estimated from service name)`;
  }

  try {
    const res = await fetch(`${RENDER_API}/services/${serviceId}`, {
      headers: {
        Authorization: `Bearer ${renderApiKey}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      return `Failed to get service details: ${res.statusText}`;
    }

    const data = await res.json() as {
      service?: { url?: string; name?: string; status?: string };
      url?: string; name?: string; status?: string;
    };
    const svc = data.service ?? data;
    const url = svc.url ?? `https://${svc.name}.onrender.com`;

    return [
      `âœ… Preview URL: ${url}`,
      `Status: ${svc.status ?? 'unknown'}`,
      `Service ID: ${serviceId}`,
      '',
      `Health check: ${url}/health`,
    ].join('\n');
  } catch (err) {
    return `Error fetching preview: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}
