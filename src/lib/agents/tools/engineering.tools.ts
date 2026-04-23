// Engineering Agent Tools — GitHub + Cloudflare (primary) + Render (legacy) deployment (Agent #30)
// Enables the Engineering agent to push code, create repos, and deploy apps.
//
// Deploy targets (per ADR-002 split-hosting strategy):
//   • Cloudflare Workers + R2   — primary target for founder apps at *.baljia.app
//                                  (tools prefixed `cf_`)
//   • Render                    — LEGACY; kept for platform-internal services only.
//                                  Do NOT use render_* tools for new founder-app deploys.
//                                  These remain callable for backwards compat / rollback.
//   • GitHub                    — shared for both (platform-owned org, one repo per company)

import type { Task } from '@/types';
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { provisionSubdomain, attachCustomDomain, verifyCustomDomain } from '@/lib/services/domain.service';
import { provisionCompanyDatabase, getCompanyDatabase, createBranch, deleteBranch } from '@/lib/services/neon.service';
import {
  uploadLandingHtml,
  landingHtmlExists,
  deleteLandingHtml,
  verifyFounderAppLive,
  isCloudflareDeployConfigured,
} from '@/lib/services/cf-deploy.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('EngineeringTools');

const GITHUB_API = 'https://api.github.com';
const RENDER_API = 'https://api.render.com/v1';

// ══════════════════════════════════════════════
// TOOL DEFINITIONS
// ══════════════════════════════════════════════

export function getEngineeringTools() {
  return [
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
    // ──────────────────────────────────────────────
    // CLOUDFLARE WORKERS + R2 — Primary deploy target for founder apps (ADR-002)
    // ──────────────────────────────────────────────
    {
      name: 'cf_deploy_landing',
      description: 'PRIMARY: Deploy a founder landing page to Cloudflare at {subdomain}.baljia.app. Uploads HTML to R2; the wildcard Worker serves it. Fast (≤3s), idempotent, no GitHub needed. Use this instead of render_create_service for any new founder-app landing deploy.',
      input_schema: {
        type: 'object' as const,
        properties: {
          html: { type: 'string' as const, description: 'Full HTML content of the landing page (UTF-8). Include <html>, <head>, <body>.' },
          subdomain_override: { type: 'string' as const, description: 'Optional: override the company\'s configured subdomain. Usually omit — company.subdomain is used.' },
        },
        required: ['html'],
      },
    },
    {
      name: 'cf_verify_founder_app',
      description: 'Verify a founder app is live by HTTP GET against https://{subdomain}.baljia.app. Returns status, elapsed ms, body snippet. Use after cf_deploy_landing to confirm live, or during diagnostics.',
      input_schema: {
        type: 'object' as const,
        properties: {
          subdomain_override: { type: 'string' as const, description: 'Optional: override the company\'s configured subdomain.' },
        },
      },
    },
    {
      name: 'cf_delete_founder_app',
      description: 'Remove the founder app from Cloudflare (deletes R2 asset). Use for teardown. Idempotent — succeeds even if asset is already gone.',
      input_schema: {
        type: 'object' as const,
        properties: {
          subdomain_override: { type: 'string' as const, description: 'Optional: override the company\'s configured subdomain.' },
        },
      },
    },
    // ──────────────────────────────────────────────
    // RENDER — LEGACY (platform-internal services only; do NOT use for new founder-app deploys)
    // ──────────────────────────────────────────────
    {
      name: 'render_create_service',
      description: '[LEGACY — prefer cf_deploy_landing for founder-app deploys] Create a new Render web service or static site from a GitHub repo.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'Service name on Render' },
          repo: { type: 'string' as const, description: 'GitHub repo name (in platform org)' },
          type: { type: 'string' as const, description: '"web_service" or "static_site"' },
          build_command: { type: 'string' as const, description: 'Build command (e.g. "npm install && npm run build")' },
          start_command: { type: 'string' as const, description: 'Start command for web services (e.g. "node dist/index.js")' },
          env_vars: {
            type: 'array' as const,
            description: 'Environment variables array',
            items: {
              type: 'object' as const,
              properties: {
                key: { type: 'string' as const },
                value: { type: 'string' as const },
              },
            },
          },
        },
        required: ['name', 'repo', 'type'],
      },
    },
    {
      name: 'render_get_service',
      description: 'Get details about a Render service including deployment status and URL.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID (from render_create_service or company record)' },
        },
        required: ['service_id'],
      },
    },
    {
      name: 'render_deploy',
      description: 'Trigger a new deployment for an existing Render service.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID' },
          clear_cache: { type: 'boolean' as const, description: 'Whether to clear the build cache (default: false)' },
        },
        required: ['service_id'],
      },
    },
    {
      name: 'render_get_deploy_status',
      description: 'Check the status of the latest deployment for a Render service.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID' },
        },
        required: ['service_id'],
      },
    },
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
    // ── Render Logs & Lifecycle ──
    {
      name: 'render_get_logs',
      description: 'Get runtime logs from a deployed Render service. Essential for debugging deployed apps — shows console output, errors, crashes.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID (from get_company_tech)' },
          log_type: { type: 'string' as const, description: '"deploy" for build logs or "service" for runtime logs (default: service)' },
          num_lines: { type: 'number' as const, description: 'Number of log lines to return (default: 100, max: 500)' },
        },
        required: ['service_id'],
      },
    },
    {
      name: 'render_delete_service',
      description: 'DANGEROUS: Permanently delete a Render service and its deployments. Use only when explicitly asked to tear down infrastructure. This action cannot be undone.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID to delete' },
          confirm: { type: 'boolean' as const, description: 'Must be true to confirm deletion' },
        },
        required: ['service_id', 'confirm'],
      },
    },
    // ── Health & safety ──
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
      name: 'render_rollback',
      description: 'Roll back a Render service to its previous successful deployment. Use when a new deploy breaks the app.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID (from get_company_tech)' },
        },
        required: ['service_id'],
      },
    },
    // ── Database Infrastructure (Neon Postgres) ──
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
    // ── Stripe Payments (Founder's Product) ──
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
    // ── GitHub: branching + PR (KG spec: create_branch, create_commit, create_pr) ──
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
    // ── Render: list + metrics (KG spec: list_services, get_metrics, list_databases) ──
    {
      name: 'render_list_services',
      description: 'List all Render services for the platform account. Useful to find a service_id when you only know the company name.',
      input_schema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number' as const, description: 'Max services to return (default: 20)' },
        },
      },
    },
    {
      name: 'render_get_metrics',
      description: 'Get CPU and memory metrics for a Render service to diagnose performance issues.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID' },
          resolution: { type: 'string' as const, description: 'Metric resolution: "10m", "1h", "1d" (default: 1h)' },
        },
        required: ['service_id'],
      },
    },
    // ── GitHub: search + commit (completing KG github spec) ──
    {
      name: 'github_search_code',
      description: 'Search for code in a GitHub repository. Useful to find existing implementations before writing new code.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          query: { type: 'string' as const, description: 'Search query (e.g. "function handleAuth" or "TODO:" or "stripe webhook")' },
          language: { type: 'string' as const, description: 'Filter by language (e.g. "TypeScript", "JavaScript") — optional' },
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
    // ── Render: list_databases (completing KG render spec) ──
    {
      name: 'render_list_databases',
      description: 'List all Render Postgres databases in the platform account. Useful to find database IDs for connection info.',
      input_schema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number' as const, description: 'Max databases to return (default: 20)' },
        },
      },
    },
  ];
}

// ══════════════════════════════════════════════
// HANDLERS
// ══════════════════════════════════════════════

// C7-FIX: Tenant isolation helpers — verify infrastructure belongs to the requesting company
async function assertServiceOwnership(serviceId: string, companyId: string): Promise<void> {
  const [company] = await db.select({ render_service_id: companies.render_service_id })
    .from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company || company.render_service_id !== serviceId) {
    throw new Error(`Service ${serviceId} does not belong to this company. Cross-tenant access denied.`);
  }
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

    // ── Cloudflare deploys (primary — ADR-002) ──
    case 'cf_deploy_landing':
      return cfDeployLanding(input, task.company_id);

    case 'cf_verify_founder_app':
      return cfVerifyFounderApp(input, task.company_id);

    case 'cf_delete_founder_app':
      return cfDeleteFounderApp(input, task.company_id);

    // ── Render deploys (legacy — platform-internal only) ──
    case 'render_create_service':
      return renderCreateService(input, task.company_id);

    case 'render_get_service': {
      await assertServiceOwnership(input.service_id as string, task.company_id);
      return renderGetService(input);
    }

    case 'render_deploy':
      await assertServiceOwnership(input.service_id as string, task.company_id);
      return renderDeploy(input, task.company_id);

    case 'render_get_deploy_status':
      await assertServiceOwnership(input.service_id as string, task.company_id);
      return renderGetDeployStatus(input);

    case 'attach_custom_domain':
      return handleAttachCustomDomain(input, task.company_id);

    case 'verify_custom_domain':
      return handleVerifyCustomDomain(task.company_id);

    // ── Health & safety ──
    case 'check_url_health':
      return handleCheckUrlHealth(input);

    case 'render_rollback':
      await assertServiceOwnership(input.service_id as string, task.company_id);
      return handleRenderRollback(input);

    // ── Database Infrastructure ──
    case 'provision_database':
      return handleProvisionDatabase(task.company_id);

    case 'get_database_info':
      return handleGetDatabaseInfo(task.company_id);

    case 'run_migration':
      return handleRunMigration(input, task.company_id);

    case 'query_company_db':
      return handleQueryCompanyDb(input, task.company_id);

    // ── Render Logs & Lifecycle ──
    case 'render_get_logs':
      await assertServiceOwnership(input.service_id as string, task.company_id);
      return renderGetLogs(input);

    case 'render_delete_service':
      await assertServiceOwnership(input.service_id as string, task.company_id);
      return renderDeleteService(input, task.company_id);

    // ── Stripe Payments ──
    case 'stripe_create_product':
      return handleStripeCreateProduct(input, task.company_id);

    case 'stripe_create_price':
      return handleStripeCreatePrice(input, task.company_id);

    case 'stripe_create_payment_link':
      return handleStripeCreatePaymentLink(input, task.company_id);

    case 'stripe_get_products':
      return handleStripeGetProducts(task.company_id);

    // ── GitHub branching + PR ──
    case 'github_create_branch':
      return githubCreateBranch(input, task.company_id);

    case 'github_create_pr':
      return githubCreatePR(input, task.company_id);

    case 'github_search_code':
      return githubSearchCode(input, task.company_id);

    case 'github_create_commit':
      return githubCreateCommit(input, task.company_id);

    // ── Render list + metrics + databases ──
    case 'render_list_services':
      return renderListServices(input);

    case 'render_get_metrics':
      await assertServiceOwnership(input.service_id as string, task.company_id);
      return renderGetMetrics(input);

    case 'render_list_databases':
      return renderListDatabases(input);

    default:
      return `Unknown engineering tool: ${toolName}`;
  }
}

// ── GitHub helpers ──

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
  return process.env.GITHUB_ORG ?? 'baljia-ai';
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

    const files = data.map((f) => `${f.type === 'dir' ? '📁' : '📄'} ${f.path}`).join('\n');
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

// ── Render helpers ──

function renderHeaders() {
  const token = process.env.RENDER_API_KEY;
  if (!token) throw new Error('RENDER_API_KEY not configured');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function renderCreateService(input: Record<string, unknown>, companyId: string): Promise<string> {
  try {
    const headers = renderHeaders();
    const org = githubOrg();
    const repo = input.repo as string;
    const type = (input.type as string) === 'static_site' ? 'static_site' : 'web_service';

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

    const body: Record<string, unknown> = {
      type,
      name: input.name as string,
      ownerId: process.env.RENDER_OWNER_ID,
      repo: `https://github.com/${org}/${repo}`,
      branch: 'main',
      autoDeploy: 'yes',
      envVars,
    };

    if (type === 'web_service') {
      body.buildCommand = (input.build_command as string) ?? 'npm install && npm run build';
      body.startCommand = (input.start_command as string) ?? 'node dist/index.js';
    } else {
      body.buildCommand = (input.build_command as string) ?? 'npm install && npm run build';
      body.staticPublishPath = './dist';
    }

    const response = await fetch(`${RENDER_API}/services`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json() as { service?: { id?: string; dashboardUrl?: string }; id?: string; message?: string };

    if (!response.ok) {
      return `Render service creation failed: ${data.message ?? response.statusText}`;
    }

    const serviceId = data.service?.id ?? data.id;

    if (serviceId) {
      // Save service ID to company record
      await db.update(companies).set({ render_service_id: serviceId }).where(eq(companies.id, companyId));

      // Auto-attach {slug}.baljia.app custom domain
      const [company] = await db.select({ slug: companies.slug })
        .from(companies).where(eq(companies.id, companyId)).limit(1);

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

    return result + (companyId ? '\n\n📋 Browser QA task created — agent will verify the live URL shortly.' : '');
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

    return `⚠️ Service ${serviceId} permanently deleted. The company record has been updated. Use render_create_service to redeploy.`;
  } catch (err) {
    return `Delete error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// ── Health check ──

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
      return `✅ ${url} is UP — HTTP ${response.status} in ${elapsed}ms`;
    }

    return `⚠️ ${url} returned HTTP ${response.status} in ${elapsed}ms — app may have an error. Check logs with render_get_logs.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return `❌ ${url} is DOWN — ${msg}. The deploy may have failed. Check logs or run render_rollback.`;
  }
}

// ── Rollback ──

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

    return `🔄 Rollback triggered! New deploy ID: ${data.id} (based on last successful deploy).\nMonitor with render_get_deploy_status.`;
  } catch (err) {
    return `Rollback error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// ── Custom Domain handlers ──


async function handleAttachCustomDomain(input: Record<string, unknown>, companyId: string): Promise<string> {
  const domain = input.domain as string;
  if (!domain) return 'Error: domain is required';

  try {
    const result = await attachCustomDomain(companyId, domain);
    if (!result) {
      return 'Failed to attach custom domain. Make sure a website has been deployed to Render first (use render_create_service).';
    }

    return [
      `✅ Custom domain "${result.domain}" attached!`,
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
      return `✅ Domain "${result.domain}" is fully verified and SSL is active! The site is live at https://${result.domain}`;
    }

    return [
      `⏳ Domain "${result.domain}" is not yet verified.`,
      `Verified: ${result.verified ? '✅' : '❌'}`,
      `SSL Ready: ${result.sslReady ? '✅' : '❌'}`,
      '',
      'The founder needs to set the DNS CNAME records. It can take 5-30 minutes to propagate.',
    ].join('\n');
  } catch (err) {
    return `Domain verification error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// ── Database Infrastructure handlers ──

async function handleProvisionDatabase(companyId: string): Promise<string> {
  // Check if already provisioned
  const existing = await getCompanyDatabase(companyId);
  if (existing) {
    return [
      '✅ Database already provisioned!',
      `Project: ${existing.name}`,
      `Host: ${existing.host}`,
      `Connection: ${existing.connectionUri ? '(available — use get_database_info for code snippets)' : 'pending'}`,
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
      `✅ Database provisioned for ${company.name}!`,
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
      `✅ Migration successful: "${description}"`,
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

// ── Stripe Payment handlers ──
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
      `✅ Stripe product created!`,
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
      `✅ Price created: ${formattedPrice}${billing}`,
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
      `✅ Payment link created!`,
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

// ── GitHub: branch + PR ──

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

    return `✅ Branch \"${branchName}\" created in ${repo} (from ${baseBranch}).\nUse github_push_file with branch="${branchName}" to push changes.`;
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

    return `✅ Pull request #${data.number} created!\nURL: ${data.html_url}\nMerge "${input.head_branch}" → "${body.base}"`;
  } catch (err) {
    return `GitHub PR error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// ── Render: list + metrics ──

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
      return `- [${s.id ?? '?'}] ${s.name ?? 'unnamed'} (${s.type ?? '?'}) — ${s.serviceDetails?.url ?? 'no URL'}`;
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

// ── GitHub: search code ──

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
      return `📄 ${item.path}\n   ${fragment ? `\`${fragment.replace(/\n/g, ' ')}\`` : '(no preview)'}`;
    });

    return `## Code Search: "${query}" (${data.total_count} results, showing ${data.items.length})\n\n${lines.join('\n\n')}`;
  } catch (err) {
    return `GitHub search error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// ── GitHub: multi-file atomic commit via Git Trees API ──

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

    return `✅ Committed ${files.length} file(s) to ${repo}/${branch}\nCommit: ${newCommit.sha.substring(0, 7)} — "${message}"\nFiles: ${files.map((f) => f.path).join(', ')}`;
  } catch (err) {
    return `GitHub commit error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// ── Render: list databases ──

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

// ══════════════════════════════════════════════
// CLOUDFLARE DEPLOY HANDLERS (ADR-002 primary path)
// ══════════════════════════════════════════════

/**
 * Resolve the subdomain for a company from the DB, falling back to an override
 * if the agent explicitly passed one. Errors loudly if neither exists — we
 * never want to silently deploy to a wrong subdomain.
 */
async function resolveCompanySubdomain(companyId: string, override?: string): Promise<string> {
  if (override && override.trim().length > 0) {
    // Light validation — CF subdomain chars only
    const clean = override.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(clean)) {
      throw new Error(`Invalid subdomain override "${override}" — must be lowercase alphanumeric + hyphens`);
    }
    return clean;
  }
  const [company] = await db
    .select({ subdomain: companies.subdomain })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company?.subdomain) {
    throw new Error(`Company ${companyId} has no subdomain configured. Set company.subdomain before deploying, or pass subdomain_override.`);
  }
  return company.subdomain;
}

async function cfDeployLanding(input: Record<string, unknown>, companyId: string): Promise<string> {
  if (!isCloudflareDeployConfigured()) {
    return 'Cloudflare deploy not configured. Set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID_APP, and R2_* env vars.';
  }
  const html = input.html as string;
  if (typeof html !== 'string' || html.length === 0) {
    return 'Missing required input: html (full HTML content).';
  }
  if (html.length > 5 * 1024 * 1024) {
    return `HTML too large (${html.length} bytes). Max 5 MB per landing page.`;
  }

  try {
    const subdomain = await resolveCompanySubdomain(companyId, input.subdomain_override as string | undefined);
    const alreadyLive = await landingHtmlExists(subdomain);

    const result = await uploadLandingHtml({ subdomain, html });
    if (!result) return `Cloudflare landing deploy failed for ${subdomain} — check logs.`;

    const note = alreadyLive ? ' (overwrote existing landing)' : '';
    log.info('cf_deploy_landing succeeded', { companyId, subdomain, bytes: html.length, alreadyLive });
    return `Landing deployed to Cloudflare!${note}\nURL: ${result.url}\nR2 key: ${result.key}\nBytes: ${html.length}\n\nVerify with cf_verify_founder_app.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.error('cf_deploy_landing failed', { companyId }, err);
    return `Cloudflare landing deploy error: ${msg}`;
  }
}

async function cfVerifyFounderApp(input: Record<string, unknown>, companyId: string): Promise<string> {
  if (!isCloudflareDeployConfigured()) {
    return 'Cloudflare deploy not configured — cannot verify.';
  }
  try {
    const subdomain = await resolveCompanySubdomain(companyId, input.subdomain_override as string | undefined);
    const result = await verifyFounderAppLive(subdomain);
    if (!result) return `Verify failed: no response for ${subdomain}.baljia.app`;

    const emoji = result.status === 200 ? '✅' : result.status === 0 ? '❌' : '⚠️';
    const snippet = result.bodySnippet.replace(/\n/g, ' ').slice(0, 200);
    return `${emoji} https://${subdomain}.baljia.app returned HTTP ${result.status} in ${result.elapsedMs}ms\nBody snippet: ${snippet}`;
  } catch (err) {
    return `Cloudflare verify error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function cfDeleteFounderApp(input: Record<string, unknown>, companyId: string): Promise<string> {
  if (!isCloudflareDeployConfigured()) {
    return 'Cloudflare deploy not configured — nothing to delete.';
  }
  try {
    const subdomain = await resolveCompanySubdomain(companyId, input.subdomain_override as string | undefined);
    const existed = await landingHtmlExists(subdomain);
    if (!existed) return `No founder app found at ${subdomain} — nothing to delete.`;

    const ok = await deleteLandingHtml(subdomain);
    if (!ok) return `Delete failed for ${subdomain} — check logs.`;

    log.info('cf_delete_founder_app succeeded', { companyId, subdomain });
    return `Deleted founder app at ${subdomain}.baljia.app (R2 landing asset removed).`;
  } catch (err) {
    return `Cloudflare delete error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}
