import { provisionCompanyRepo, type GitHubRepo } from '@/lib/services/github.service';

const GITHUB_API = 'https://api.github.com';
const DEFAULT_GITHUB_ORG = 'BALAJIapps';

type FetchLike = typeof fetch;

export interface EngineeringGithubRepoReadyInput {
  companyId: string;
  githubRepo?: string | null;
  slug?: string | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  provisionRepo?: (companyId: string, companySlug: string) => Promise<GitHubRepo>;
  persistRepo?: (fullName: string) => Promise<void>;
}

export interface EngineeringGithubRepoReadyResult {
  ok: boolean;
  repo?: string;
  repaired?: boolean;
  reason?: string;
}

interface GitHubRepoProbe {
  full_name?: string;
  archived?: boolean;
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
  };
  message?: string;
}

function entryText(entry: Record<string, unknown>): string {
  const result = entry.result ?? entry.content ?? entry.error ?? entry;
  return typeof result === 'string' ? result : JSON.stringify(result);
}

function isGithubTool(tool: unknown): boolean {
  return typeof tool === 'string' && tool.startsWith('github_');
}

/**
 * Detects hard Engineering infra loops from execution_log evidence.
 * This is intentionally conservative: one flaky GitHub 404 can happen during
 * repo propagation, but repeated 404/admin/cross-tenant evidence means the
 * agent cannot solve the task by spending more LLM turns.
 */
export function detectHardEngineeringInfraBlocker(logEntries: Record<string, unknown>[]): string | null {
  let githubNotFound = 0;
  let crossTenantWrongRepo = 0;
  let adminRequired = 0;
  let skeletonTokenBlocked = 0;
  let renderWrongRepo = 0;

  for (const entry of logEntries) {
    const tool = entry.tool;
    const text = entryText(entry);
    if (isGithubTool(tool) && /not found/i.test(text)) githubNotFound += 1;
    if (/company owns .* but you passed|cross-tenant access is blocked/i.test(text)) crossTenantWrongRepo += 1;
    if (/admin access|administrator permission|permission to create repositories/i.test(text)) adminRequired += 1;
    if (/resource not accessible by personal access token/i.test(text)) skeletonTokenBlocked += 1;
    if ((tool === 'render_create_service' || tool === 'create_instance') &&
      /github_(?:read|write): this task's company owns|company owns .* but you passed/i.test(text)) {
      renderWrongRepo += 1;
    }
  }

  if (adminRequired >= 1 && githubNotFound >= 1) {
    return 'Hard infrastructure blocker: GitHub repo is not reachable and automatic repo creation requires admin access. Stop Engineering and ask platform/admin to create or grant access to the company repo.';
  }
  if (githubNotFound >= 3) {
    return 'Hard infrastructure blocker: GitHub repo is not reachable after repeated GitHub Not Found responses. Stop Engineering instead of retrying GitHub/Render tools.';
  }
  if (crossTenantWrongRepo >= 2 || renderWrongRepo >= 2) {
    return 'Hard infrastructure blocker: Engineering is operating on the wrong GitHub repo and cross-tenant protection is blocking it. Stop and repair the company github_repo mapping.';
  }
  if (skeletonTokenBlocked >= 2 && githubNotFound >= 1) {
    return 'Hard infrastructure blocker: GitHub token cannot fork the skeleton and the company repo is not reachable. Stop and repair GitHub access before running Engineering.';
  }

  return null;
}

function githubOrg(env: NodeJS.ProcessEnv): string {
  return env.GITHUB_ORG || DEFAULT_GITHUB_ORG;
}

function resolveRepo(repo: string, env: NodeJS.ProcessEnv): string {
  const trimmed = repo.trim();
  return trimmed.includes('/') ? trimmed : `${githubOrg(env)}/${trimmed}`;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function readRepo(
  repo: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true; data: GitHubRepoProbe } | { ok: false; status: number; message: string }> {
  const response = await fetchImpl(`${GITHUB_API}/repos/${repo}`, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(5_000),
  });
  const data = await response.json().catch(() => ({})) as GitHubRepoProbe;
  if (!response.ok) {
    return { ok: false, status: response.status, message: data.message ?? response.statusText };
  }
  return { ok: true, data };
}

function hasWritePermission(data: GitHubRepoProbe): boolean {
  const permissions = data.permissions;
  if (!permissions) return true;
  return permissions.push === true || permissions.maintain === true || permissions.admin === true;
}

function missingRepoReason(repo: string, status: number, message: string): string {
  return `GitHub repo ${repo} is not reachable before launching Engineering (HTTP ${status}: ${message}).`;
}

export async function ensureEngineeringGithubRepoReady(
  input: EngineeringGithubRepoReadyInput,
): Promise<EngineeringGithubRepoReadyResult> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = env.GITHUB_TOKEN;

  if (!token) {
    return { ok: false, reason: 'GitHub repo preflight failed before launching Engineering: GITHUB_TOKEN is not configured.' };
  }

  const repo = input.githubRepo
    ? resolveRepo(input.githubRepo, env)
    : input.slug
      ? `${githubOrg(env)}/${input.slug}`
      : null;

  if (repo) {
    try {
      const probe = await readRepo(repo, token, fetchImpl);
      if (probe.ok) {
        if (probe.data.archived) {
          return { ok: false, repo, reason: `GitHub repo preflight failed before launching Engineering: ${repo} is archived.` };
        }
        if (!hasWritePermission(probe.data)) {
          return { ok: false, repo, reason: `GitHub repo preflight failed before launching Engineering: token can read ${repo} but cannot push to it.` };
        }
        return { ok: true, repo: probe.data.full_name ?? repo };
      }
    } catch (error) {
      return {
        ok: false,
        repo,
        reason: `GitHub repo preflight failed before launching Engineering: ${repo} probe threw ${error instanceof Error ? error.message : String(error)}.`,
      };
    }
  }

  if (!input.slug) {
    return {
      ok: false,
      repo: repo ?? undefined,
      reason: repo
        ? `GitHub repo preflight failed before launching Engineering: ${repo} is missing and company slug is unavailable for auto-provisioning.`
        : 'GitHub repo preflight failed before launching Engineering: company has no github_repo or slug.',
    };
  }

  try {
    const provision = input.provisionRepo ?? provisionCompanyRepo;
    const provisioned = await provision(input.companyId, input.slug);
    await input.persistRepo?.(provisioned.full_name);
    return { ok: true, repo: provisioned.full_name, repaired: true };
  } catch (error) {
    const base = repo
      ? missingRepoReason(repo, 404, 'not found or inaccessible')
      : 'GitHub repo is not configured before launching Engineering.';
    return {
      ok: false,
      repo: repo ?? undefined,
      reason: `${base} Auto-provision failed before launching Engineering: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
