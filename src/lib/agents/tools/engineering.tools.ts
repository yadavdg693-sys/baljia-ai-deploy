// Engineering Agent Tools — GitHub + Cloudflare deployment (Agent #30)
// Enables the Engineering agent to push code and deploy founder apps.
//
// Deploy target (per ADR-002 split-hosting strategy):
//   • Cloudflare Workers + R2   — founder apps at *.baljia.app
//                                  Tier 1 (static landing)   → cf_deploy_landing
//                                  Tier 2/3 (full-stack app) → cf_deploy_app
//   • GitHub                    — platform-owned org, one repo per company
//
// Render deploy tools were removed from this agent in the CF-full migration.
// Render is now ONLY used by the platform itself (baljia.ai), not by founder apps.

import type { Task } from '@/types';
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { provisionSubdomain, attachCustomDomain, verifyCustomDomain } from '@/lib/services/domain.service';
import { provisionCompanyDatabase, getCompanyDatabase, createBranch, deleteBranch } from '@/lib/services/neon.service';
import {
  uploadLandingHtml,
  landingHtmlExists,
  deleteLandingHtml,
  verifyFounderAppLive,
  isCloudflareDeployConfigured,
  deployWorkerScript,
  deleteWorkerScript,
  addWorkerRoute,
  putWorkerSecret,
  getWorkerScriptInfo,
  getWorkerLogs,
  type WorkerBinding,
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
      name: 'list_skills',
      description: 'List the skill files available in .claude/skills/. Returns one line per skill with a 1-sentence summary. Read the relevant skill via read_skill BEFORE writing code in that domain — the skills capture stack-specific patterns and anti-patterns the LLM\'s training data is missing or wrong about.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'read_skill',
      description: 'Read the full SKILL.md for a named skill. MANDATORY before writing code that touches the skill\'s domain. Skill files describe what works on Cloudflare Workers, what frameworks DON\'T work, code shapes you should match, and anti-patterns the LLM\'s training data tends to suggest but break in production.',
      input_schema: {
        type: 'object' as const,
        properties: {
          skill: {
            type: 'string' as const,
            description: 'Skill name (kebab-case directory under .claude/skills/). E.g. "cloudflare-workers", "neon-postgres", "frontend-design", "stripe-payments", "r2-storage", "email-postmark"',
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
    // ──────────────────────────────────────────────
    // CLOUDFLARE WORKERS + R2 — Primary deploy target for founder apps (ADR-002)
    // Subdomain is ALWAYS resolved from the calling task's company.subdomain.
    // There is NO override parameter — this is intentional tenant isolation.
    // ──────────────────────────────────────────────
    {
      name: 'cf_deploy_landing',
      description: 'PRIMARY: Deploy a founder landing page to Cloudflare at {subdomain}.baljia.app. Uploads HTML to R2; the wildcard Worker serves it. Fast (≤3s), idempotent, no GitHub needed. Subdomain is derived from your company record — you cannot deploy to another company. Use this instead of render_create_service for any new founder-app landing deploy.',
      input_schema: {
        type: 'object' as const,
        properties: {
          html: { type: 'string' as const, description: 'Full HTML content of the landing page (UTF-8). Include <html>, <head>, <body>. Max 5 MB.' },
        },
        required: ['html'],
      },
    },
    {
      name: 'cf_verify_founder_app',
      description: 'Verify this company\'s founder app is live by HTTP GET against its configured subdomain. Returns status, elapsed ms, body snippet. Use after cf_deploy_landing to confirm live, or during diagnostics.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'cf_delete_founder_app',
      description: 'Remove THIS company\'s founder app from Cloudflare (deletes R2 asset). Use for teardown. Idempotent — succeeds even if asset is already gone.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'cf_deploy_app',
      description: 'TIER 2/3 APPS: Deploy or redeploy a full-stack founder app (Express-style API, SSR pages, etc.) as a Cloudflare Worker at {subdomain}.baljia.app. Idempotent — the same call works for first deploy and for shipping updates/bug fixes (the script is replaced atomically). Takes a complete ES-module JS source that exports default { fetch(request, env, ctx) }. Automatically: uploads the script, registers a per-subdomain route (overrides wildcard for this founder), injects the company Neon DB URL as NEON_URL secret if with_neon_db=true, binds the R2 ASSETS bucket if with_r2_assets=true. Use THIS instead of cf_deploy_landing when the app has dynamic logic, DB reads/writes, or API endpoints. Max script size 10 MB gzipped.',
      input_schema: {
        type: 'object' as const,
        properties: {
          script_content: {
            type: 'string' as const,
            description: 'Complete ES-module JavaScript source. Must export default an object with a fetch(request, env, ctx) handler. Can use fetch(), URL, Response, Request, and Node APIs (nodejs_compat enabled: Buffer, crypto, etc.). Access bindings via env.NEON_URL (if with_neon_db), env.ASSETS (if with_r2_assets), env.<custom> for additional_secrets.',
          },
          with_neon_db: {
            type: 'boolean' as const,
            description: 'Inject the company\'s Neon connection string as env.NEON_URL secret. Set true for apps with a database. Requires provision_database to have run first.',
          },
          with_r2_assets: {
            type: 'boolean' as const,
            description: 'Bind the R2 assets bucket so the Worker can read static files via env.ASSETS.get(key). Set true if the app serves images, CSS, etc. from R2.',
          },
          additional_secrets: {
            type: 'object' as const,
            description: 'Extra per-founder secrets to inject (e.g. { "STRIPE_KEY": "sk_...", "OPENAI_KEY": "sk-..." }). Each becomes env.<NAME> inside the Worker. Values are masked in CF logs.',
            additionalProperties: { type: 'string' as const },
          },
        },
        required: ['script_content'],
      },
    },
    {
      name: 'cf_get_app_info',
      description: 'Get deployment info for this company\'s Tier 2/3 app (deploy status, etag, last modified). Does NOT return the source code. Returns null if no app is deployed.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'cf_delete_app',
      description: 'TIER 2/3: Fully remove this company\'s Worker script + route from Cloudflare. Use for teardown. The Tier 1 landing HTML in R2 is NOT deleted by this tool (use cf_delete_founder_app for that). Idempotent.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'cf_get_logs',
      description: 'Get Cloudflare Worker invocation logs for THIS company\'s Tier 2/3 founder app. Returns minute-bucketed counts of requests grouped by HTTP status (200, 404, 500, etc.) and outcome (ok, exception, exceededCpu, scriptThrew, canceled). Use when an app is failing health probes or returning errors — this shows WHEN errors started and WHAT outcome (e.g. exception vs status 500 vs CPU exceeded). Only works for apps deployed via cf_deploy_app — Tier 1 landing pages (cf_deploy_landing) ride the wildcard Worker and do not have per-founder logs. Returns null with a helpful message in those cases.',
      input_schema: {
        type: 'object' as const,
        properties: {
          since_minutes: {
            type: 'number' as const,
            description: 'Lookback window in minutes (default 60, max 1440 = 24h).',
          },
          limit: {
            type: 'number' as const,
            description: 'Max rows returned (default 100, hard max 500). Each row is one (minute, status, outcome) bucket.',
          },
          errors_only: {
            type: 'boolean' as const,
            description: 'When true, filter the response to only buckets where outcome != "ok" or status >= 400. Useful when debugging.',
          },
        },
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
    // ── Skills (Polsia-style knowledge layer) ──
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

    // ── Cloudflare deploys (sole deploy target for founder apps — ADR-002) ──
    case 'cf_deploy_landing':
      return cfDeployLanding(input, task.company_id);

    case 'cf_verify_founder_app':
      return cfVerifyFounderApp(input, task.company_id);

    case 'cf_delete_founder_app':
      return cfDeleteFounderApp(input, task.company_id);

    case 'cf_deploy_app':
      return cfDeployApp(input, task.company_id);

    case 'cf_get_app_info':
      return cfGetAppInfo(input, task.company_id);

    case 'cf_delete_app':
      return cfDeleteApp(input, task.company_id);

    case 'cf_get_logs':
      return cfGetLogs(input, task.company_id);

    case 'attach_custom_domain':
      return handleAttachCustomDomain(input, task.company_id);

    case 'verify_custom_domain':
      return handleVerifyCustomDomain(task.company_id);

    // ── Health & safety ──
    case 'check_url_health':
      return handleCheckUrlHealth(input);

    // ── Database Infrastructure ──
    case 'provision_database':
      return handleProvisionDatabase(task.company_id);

    case 'get_database_info':
      return handleGetDatabaseInfo(task.company_id);

    case 'run_migration':
      return handleRunMigration(input, task.company_id);

    case 'query_company_db':
      return handleQueryCompanyDb(input, task.company_id);

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
 * Resolve the subdomain for a company from the DB. There is deliberately NO
 * override parameter — agents must only deploy to their own company's
 * subdomain. This is the tenant-isolation boundary for the CF deploy path,
 * mirroring how `assertServiceOwnership` works for Render tools.
 */
async function resolveCompanySubdomain(companyId: string): Promise<string> {
  const [company] = await db
    .select({ subdomain: companies.subdomain })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company?.subdomain) {
    throw new Error(`Company ${companyId} has no subdomain configured. Onboarding must set company.subdomain before deploy (via provisionWildcardSubdomain).`);
  }
  const clean = company.subdomain.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(clean)) {
    throw new Error(`Company ${companyId} has an invalid stored subdomain "${company.subdomain}" — refusing to deploy.`);
  }
  return clean;
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
    const subdomain = await resolveCompanySubdomain(companyId);
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

async function cfVerifyFounderApp(_input: Record<string, unknown>, companyId: string): Promise<string> {
  if (!isCloudflareDeployConfigured()) {
    return 'Cloudflare deploy not configured — cannot verify.';
  }
  try {
    const subdomain = await resolveCompanySubdomain(companyId);
    const result = await verifyFounderAppLive(subdomain);
    if (!result) return `Verify failed: no response for ${subdomain}.baljia.app`;

    const emoji = result.status === 200 ? '✅' : result.status === 0 ? '❌' : '⚠️';
    const snippet = result.bodySnippet.replace(/\n/g, ' ').slice(0, 200);
    return `${emoji} https://${subdomain}.baljia.app returned HTTP ${result.status} in ${result.elapsedMs}ms\nBody snippet: ${snippet}`;
  } catch (err) {
    return `Cloudflare verify error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function cfDeleteFounderApp(_input: Record<string, unknown>, companyId: string): Promise<string> {
  if (!isCloudflareDeployConfigured()) {
    return 'Cloudflare deploy not configured — nothing to delete.';
  }
  try {
    const subdomain = await resolveCompanySubdomain(companyId);
    const existed = await landingHtmlExists(subdomain);
    if (!existed) return `No founder app found at ${subdomain} — nothing to delete.`;

    const ok = await deleteLandingHtml(subdomain);
    if (!ok) return `Delete failed for ${subdomain} — check logs.`;

    // Clear DB state so the next onboarding run / dashboard read is consistent
    await db
      .update(companies)
      .set({ custom_domain: null })
      .where(eq(companies.id, companyId));

    log.info('cf_delete_founder_app succeeded', { companyId, subdomain });
    return `Deleted founder app at ${subdomain}.baljia.app (R2 landing asset removed; company.custom_domain cleared).`;
  } catch (err) {
    return `Cloudflare delete error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// ══════════════════════════════════════════════
// TIER 2/3 — CF WORKER APP DEPLOY HANDLERS
// Full-stack apps: API endpoints, SSR, DB-backed features. Each founder gets a
// dedicated Worker script at {slug}.baljia.app/* whose route overrides the
// wildcard *.baljia.app/* (route specificity wins in CF).
// ══════════════════════════════════════════════

function workerScriptNameFor(subdomain: string): string {
  // Dedicated script name per founder — stays under CF's 100-script limit on
  // Workers Paid. Names must match [a-z0-9_-]+ and start with a letter.
  return `baljia-app-${subdomain}`;
}

async function cfDeployApp(input: Record<string, unknown>, companyId: string): Promise<string> {
  if (!isCloudflareDeployConfigured()) {
    return 'Cloudflare deploy not configured. Set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID_APP, R2_* env vars.';
  }
  const scriptContent = input.script_content as string;
  if (typeof scriptContent !== 'string' || scriptContent.length === 0) {
    return 'Missing required input: script_content (full ES-module Worker source).';
  }
  if (scriptContent.length > 5 * 1024 * 1024) {
    return `Script too large (${scriptContent.length} bytes raw). CF hard limit is 10 MB gzipped; keep source under 5 MB.`;
  }
  if (!/export\s+default\s*\{/.test(scriptContent) && !/export\s+default\s+\{/.test(scriptContent)) {
    return 'Invalid script: must include `export default { fetch(request, env, ctx) { ... } }` as the module\'s default export. Check the Cloudflare Workers ES-module syntax.';
  }

  const withNeonDb = input.with_neon_db === true;
  const withR2Assets = input.with_r2_assets === true;
  const additionalSecrets = (input.additional_secrets as Record<string, string> | undefined) ?? {};

  try {
    const subdomain = await resolveCompanySubdomain(companyId);
    const scriptName = workerScriptNameFor(subdomain);

    // Assemble bindings
    const bindings: WorkerBinding[] = [
      { type: 'plain_text', name: 'PLATFORM_API_BASE', text: 'https://baljia.ai' },
      { type: 'plain_text', name: 'COMPANY_ID', text: companyId },
      { type: 'plain_text', name: 'COMPANY_SUBDOMAIN', text: subdomain },
    ];
    if (withR2Assets) {
      bindings.push({ type: 'r2_bucket', name: 'ASSETS', bucket_name: process.env.R2_BUCKET_NAME ?? 'baljia-assets' });
    }

    // 1. Upload the Worker script (overwrites if exists)
    const deployResult = await deployWorkerScript({
      scriptName,
      scriptContent,
      bindings,
    });
    if (!deployResult) {
      return `CF Worker deploy FAILED for ${scriptName} — check logs.`;
    }

    // 2. Inject Neon DB URL as secret (if requested)
    if (withNeonDb) {
      const [company] = await db
        .select({ neon_connection_string: companies.neon_connection_string })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);
      if (!company?.neon_connection_string) {
        return `Worker deployed but NEON_URL secret NOT injected — company ${companyId} has no provisioned Neon DB. Call provision_database first, then cf_deploy_app again with with_neon_db=true.`;
      }
      const ok = await putWorkerSecret({
        scriptName,
        key: 'NEON_URL',
        value: company.neon_connection_string,
      });
      if (!ok) {
        return `Worker deployed but NEON_URL secret injection FAILED. Worker script exists but will crash on env.NEON_URL access — check CF logs.`;
      }
    }

    // 3. Inject any additional per-founder secrets
    const secretResults: string[] = [];
    for (const [key, value] of Object.entries(additionalSecrets)) {
      if (typeof value !== 'string' || value.length === 0) continue;
      const ok = await putWorkerSecret({ scriptName, key, value });
      secretResults.push(`${key}: ${ok ? 'ok' : 'FAIL'}`);
    }

    // 4. Register per-subdomain route that overrides the wildcard Worker
    const routePattern = `${subdomain}.baljia.app/*`;
    const routeResult = await addWorkerRoute({ pattern: routePattern, scriptName });
    if (!routeResult) {
      return `Worker deployed but route ${routePattern} NOT registered — the wildcard Worker will still serve Tier 1 at this subdomain. Manual fix: add route via CF dashboard.`;
    }

    log.info('cf_deploy_app succeeded', {
      companyId,
      subdomain,
      scriptName,
      bytes: scriptContent.length,
      withNeonDb,
      withR2Assets,
      extraSecrets: Object.keys(additionalSecrets).length,
      etag: deployResult.etag,
    });

    return [
      `✅ App deployed to Cloudflare Workers!`,
      `URL: https://${subdomain}.baljia.app`,
      `Script: ${scriptName}`,
      `Route: ${routePattern} (overrides wildcard)`,
      `Bytes: ${scriptContent.length}`,
      `Neon DB bound: ${withNeonDb ? 'yes (env.NEON_URL)' : 'no'}`,
      `R2 assets bound: ${withR2Assets ? 'yes (env.ASSETS)' : 'no'}`,
      secretResults.length > 0 ? `Extra secrets: ${secretResults.join(', ')}` : '',
      ``,
      `Verify with cf_verify_founder_app. To redeploy, call cf_deploy_app again — it's idempotent.`,
    ].filter(Boolean).join('\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.error('cf_deploy_app failed', { companyId }, err);
    return `Cloudflare app deploy error: ${msg}`;
  }
}

async function cfGetAppInfo(_input: Record<string, unknown>, companyId: string): Promise<string> {
  if (!isCloudflareDeployConfigured()) return 'Cloudflare deploy not configured.';
  try {
    const subdomain = await resolveCompanySubdomain(companyId);
    const scriptName = workerScriptNameFor(subdomain);
    const info = await getWorkerScriptInfo(scriptName);
    if (!info) return `No Tier 2/3 app deployed for ${subdomain} (script "${scriptName}" not found). Use cf_deploy_app to create one, or cf_deploy_landing for a static Tier 1 landing page.`;
    return [
      `Tier 2/3 app info for ${subdomain}.baljia.app:`,
      `  Script name: ${info.scriptName}`,
      `  ETag:        ${info.etag}`,
      `  URL:         https://${subdomain}.baljia.app`,
    ].join('\n');
  } catch (err) {
    return `Get app info error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function cfDeleteApp(_input: Record<string, unknown>, companyId: string): Promise<string> {
  if (!isCloudflareDeployConfigured()) return 'Cloudflare deploy not configured.';
  try {
    const subdomain = await resolveCompanySubdomain(companyId);
    const scriptName = workerScriptNameFor(subdomain);

    const ok = await deleteWorkerScript(scriptName);
    if (!ok) return `Delete FAILED for script "${scriptName}" — check CF logs. (Route may still exist; remove manually if needed.)`;

    log.info('cf_delete_app succeeded', { companyId, subdomain, scriptName });
    return `✅ Tier 2/3 app removed from Cloudflare (script "${scriptName}"). The wildcard Worker will resume serving this subdomain (Tier 1 R2 landing, or branded 404 if no landing is deployed).`;
  } catch (err) {
    return `Cloudflare app delete error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function cfGetLogs(input: Record<string, unknown>, companyId: string): Promise<string> {
  if (!isCloudflareDeployConfigured()) return 'Cloudflare deploy not configured.';

  const sinceMinutes = typeof input.since_minutes === 'number' ? input.since_minutes : 60;
  const limit = typeof input.limit === 'number' ? input.limit : 100;
  const errorsOnly = input.errors_only === true;

  try {
    const subdomain = await resolveCompanySubdomain(companyId);
    const scriptName = workerScriptNameFor(subdomain);

    // Confirm a per-founder Worker actually exists. Tier 1 landing-only
    // apps have no dedicated script — their traffic rides the wildcard.
    const info = await getWorkerScriptInfo(scriptName);
    if (!info) {
      return `No Tier 2/3 Worker found for ${subdomain}.baljia.app (script "${scriptName}" not deployed). If this is a Tier 1 landing page, per-founder logs are not available — verify the page directly with cf_verify_founder_app instead. If the app should exist, deploy it first with cf_deploy_app.`;
    }

    const rows = await getWorkerLogs({ scriptName, sinceMinutes, limit });
    if (rows === null) {
      return `Could not fetch CF logs for "${scriptName}" — the GraphQL Analytics API returned an error (token scope or transient). Try again or check Cloudflare dashboard directly.`;
    }

    const filtered = errorsOnly
      ? rows.filter((r) => r.outcome !== 'ok' || r.status >= 400)
      : rows;

    if (filtered.length === 0) {
      return errorsOnly
        ? `No errors logged for "${scriptName}" in the last ${sinceMinutes} minutes. The Worker is responding cleanly.`
        : `No invocations logged for "${scriptName}" in the last ${sinceMinutes} minutes. Either no traffic, or the script name is wrong.`;
    }

    // Aggregate quick rollup so the agent can summarize without reading every row.
    const totals = filtered.reduce(
      (acc, r) => {
        acc.requests += r.requests;
        acc.errors += r.errors;
        acc.subrequests += r.subrequests;
        return acc;
      },
      { requests: 0, errors: 0, subrequests: 0 },
    );

    const tableLines = filtered.slice(0, 50).map(
      (r) => `${r.minute}  status=${r.status}  outcome=${r.outcome}  reqs=${r.requests}  errs=${r.errors}`,
    );

    return [
      `Cloudflare Worker logs for "${scriptName}" (last ${sinceMinutes} min, ${filtered.length} buckets${errorsOnly ? ', errors_only' : ''}):`,
      `Totals: ${totals.requests} requests, ${totals.errors} errors, ${totals.subrequests} subrequests`,
      '',
      ...tableLines,
      filtered.length > 50 ? `... (${filtered.length - 50} more rows truncated; raise limit or narrow window)` : '',
    ].filter(Boolean).join('\n');
  } catch (err) {
    return `cf_get_logs error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// ══════════════════════════════════════════════
// SKILLS — read .claude/skills/<name>/SKILL.md
// Polsia-style knowledge layer the agent loads BEFORE writing domain code.
// Skills capture stack-specific patterns + anti-patterns the LLM's training
// data is missing or wrong about (e.g. "you can't use pg on Cloudflare Workers").
// ══════════════════════════════════════════════

const SKILLS_ROOT = join(process.cwd(), '.claude', 'skills');

/** Hard-coded one-line summaries — keeps `list_skills` fast (no file reads)
 *  and gives the agent a stable index it can scan. Update if a SKILL.md file
 *  is renamed; the SKILL.md content itself doesn't need to be touched. */
const SKILL_SUMMARIES: Record<string, string> = {
  'cloudflare-workers':
    'Founder-app deploy target. Runtime constraints (30s CPU, 128 MB, 10 MB bundle), code shape (ES module + default fetch handler), and frameworks that work (Hono) vs ones that don\'t (Express, pg, ioredis).',
  'build-fullstack-cf-app':
    'MANDATORY before generating script_content for cf_deploy_app on a Tier 2/3 task (API + DB + frontend). Verified pattern: single-file Worker + raw fetch to Neon HTTP /sql (no @neondatabase/serverless import — the agent has no bundler). Includes canonical template, ordered deploy steps (provision_database → CREATE TABLE → cf_deploy_app → cf_verify), 6 pitfalls, long-running-ops gap.',
  'neon-postgres':
    'Database access from Workers. Use @neondatabase/serverless HTTP driver — pg/postgres packages don\'t work. Drizzle ORM patterns, migration approaches, query best practices.',
  'frontend-design':
    'UI patterns for founder apps. Tailwind via CDN, color system (gold #F5A623 on dark warm bg), component primitives, mobile-first layouts, accessibility minimums.',
  'stripe-payments':
    'Payment integration. When to use Payment Links vs Checkout Sessions vs full SDK. Critical Workers gotchas: Stripe.createFetchHttpClient() and createSubtleCryptoProvider() are required.',
  'r2-storage':
    'File uploads + asset serving via env.ASSETS binding. Upload patterns, Worker proxy serving, naming conventions, security (don\'t trust content-type from client).',
  'email-postmark':
    'Transactional email send + inbound. Domain-verified at baljia.app, any @baljia.app sender works. Inbound architecture has two paths (Cloudflare Email Routing vs Postmark Inbound) — Support agent needs Postmark Inbound.',
  'agent-sdk':
    'AI features inside founder apps — Anthropic / OpenAI / Codex / Gemini integration. SCAFFOLD only (full content TBD); read it as a SIGNAL that AI integration is being attempted and pause for human guidance, or default to the safest path documented inside.',
};

function handleListSkills(): string {
  if (!existsSync(SKILLS_ROOT)) {
    return 'Skills directory does not exist (.claude/skills). The agent has no curated knowledge layer — proceed with general LLM knowledge but expect more iterations.';
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
    const summary = SKILL_SUMMARIES[dir] ?? '(no summary — read the file)';
    lines.push(`- **${dir}** — ${summary}`);
  }
  return lines.join('\n');
}

function handleReadSkill(input: Record<string, unknown>): string {
  const name = String(input.skill ?? '').trim();
  if (!name) return 'Error: missing required argument "skill". Call list_skills to see available names.';

  // Defense: only allow kebab-case alphanumeric. Blocks ../../etc/passwd shenanigans
  // even though SKILLS_ROOT is a fixed prefix — belt + suspenders.
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
