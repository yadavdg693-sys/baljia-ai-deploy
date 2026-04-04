// Engineering Agent Tools — GitHub + Render deployment (Agent #30)
// Enables the Engineering agent to push code, create repos, and deploy apps
// GitHub: platform-owned org, one repo per founder company
// Render: deploy as web service or static site

import type { Task } from '@/types';
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { provisionSubdomain, attachCustomDomain, verifyCustomDomain } from '@/lib/services/domain.service';
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
    {
      name: 'render_create_service',
      description: 'Create a new Render web service or static site from a GitHub repo.',
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
  ];
}

// ══════════════════════════════════════════════
// HANDLERS
// ══════════════════════════════════════════════

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

    case 'render_create_service':
      return renderCreateService(input, task.company_id);

    case 'render_get_service':
      return renderGetService(input);

    case 'render_deploy':
      return renderDeploy(input);

    case 'render_get_deploy_status':
      return renderGetDeployStatus(input);

    case 'attach_custom_domain':
      return handleAttachCustomDomain(input, task.company_id);

    case 'verify_custom_domain':
      return handleVerifyCustomDomain(task.company_id);

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

async function renderDeploy(input: Record<string, unknown>): Promise<string> {
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

    return `Deployment triggered! Deploy ID: ${data.id}\nStatus: ${data.status ?? 'building'}`;
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
