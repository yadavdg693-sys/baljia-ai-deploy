// GitHub Service — per-company repository provisioning
// Creates an empty private repo under the platform-owned org for each founder company.
// Used by the Engineering agent to push product code during the first build task.

import { createLogger } from '@/lib/logger';

const log = createLogger('GitHub');
const GITHUB_API = 'https://api.github.com';

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;        // e.g. "baljia-apps/penora"
  html_url: string;         // e.g. "https://github.com/baljia-apps/penora"
  clone_url: string;        // HTTPS clone URL
  ssh_url: string;          // SSH clone URL
  default_branch: string;
}

interface GitHubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
}

/**
 * Create a private repo for a founder company.
 * Name pattern: `<companySlug>` under `GITHUB_ORG` (e.g. `baljia-apps/penora`).
 * Idempotent: if a repo with that name already exists, returns the existing one.
 */
export async function provisionCompanyRepo(
  companyId: string,
  companySlug: string,
): Promise<GitHubRepo> {
  const token = process.env.GITHUB_TOKEN;
  const org = process.env.GITHUB_ORG;

  if (!token) {
    throw new Error('GITHUB_TOKEN not configured — per-company repos cannot be provisioned');
  }
  if (!org) {
    throw new Error('GITHUB_ORG not configured — set either a GitHub org slug or the token owner username');
  }

  // Auto-detect: is GITHUB_ORG an actual org, or the authenticated user's personal account?
  // GitHub's API for creating repos differs: POST /orgs/{org}/repos vs POST /user/repos.
  const authenticatedUser = await getAuthenticatedUser(token);
  const isPersonalAccount = authenticatedUser.login.toLowerCase() === org.toLowerCase();
  const endpoint = isPersonalAccount
    ? `${GITHUB_API}/user/repos`
    : `${GITHUB_API}/orgs/${org}/repos`;

  log.info('Provisioning GitHub repo', { companyId, companySlug, org, personalAccount: isPersonalAccount });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: companySlug,
      description: `Founder app for ${companySlug} (platform-managed by Baljia)`,
      private: true,
      auto_init: true,            // creates main branch with an initial commit so the repo is cloneable immediately
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  // 422 = name already exists. Look it up and return the existing one.
  if (res.status === 422) {
    log.warn('Repo name already exists — fetching existing', { companySlug });
    return await getRepo(org, companySlug, token);
  }

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`GitHub repo creation failed: ${res.status} ${res.statusText} — ${errorBody.slice(0, 300)}`);
  }

  const data = (await res.json()) as GitHubRepoResponse;
  log.info('GitHub repo created', { companyId, full_name: data.full_name, url: data.html_url });

  return {
    id: data.id,
    name: data.name,
    full_name: data.full_name,
    html_url: data.html_url,
    clone_url: data.clone_url,
    ssh_url: data.ssh_url,
    default_branch: data.default_branch,
  };
}

async function getAuthenticatedUser(token: string): Promise<{ login: string }> {
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    throw new Error(`GitHub auth check failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { login: string };
}

async function getRepo(org: string, repo: string, token: string): Promise<GitHubRepo> {
  const res = await fetch(`${GITHUB_API}/repos/${org}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch existing repo ${org}/${repo}: ${res.status}`);
  }
  const data = (await res.json()) as GitHubRepoResponse;
  return {
    id: data.id,
    name: data.name,
    full_name: data.full_name,
    html_url: data.html_url,
    clone_url: data.clone_url,
    ssh_url: data.ssh_url,
    default_branch: data.default_branch,
  };
}

/**
 * Delete a company's repo (used by billing lifecycle when a trial expires
 * without subscription, or when a company is fully deleted).
 */
export async function deleteCompanyRepo(
  companySlug: string,
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const org = process.env.GITHUB_ORG;
  if (!token || !org) return;

  const res = await fetch(`${GITHUB_API}/repos/${org}/${companySlug}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok && res.status !== 404) {
    log.warn('Failed to delete repo', { companySlug, status: res.status });
  } else {
    log.info('Repo deleted', { companySlug });
  }
}
