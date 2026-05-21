// Neon Service — per-company database provisioning
// Each founder company gets its own Neon Postgres database
// Used by Engineering agent to build/query the company's product DB

import { db, companies, memoryLayers } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('Neon');
const NEON_API = 'https://console.neon.tech/api/v2';

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

interface NeonProject {
  id: string;
  name: string;
  region_id: string;
  pg_version: number;
  connection_uris?: Array<{ connection_uri: string; role_name: string }>;
}

interface NeonBranch {
  id: string;
  name: string;
  primary?: boolean;
  default?: boolean;
}

interface NeonDatabaseRef {
  projectId: string;
  branchId?: string;
  databaseName: string;
  roleName: string;
}

export interface NeonDatabase {
  projectId: string;
  connectionUri: string;
  host: string;
  name: string;
}

const DEFAULT_DATABASE_NAME = 'neondb';
const DEFAULT_ROLE_NAME = 'neondb_owner';
const SHARED_REF_PREFIX = 'shared:';

// ══════════════════════════════════════════════
// PROVISION — create a new Neon project for a company
// ══════════════════════════════════════════════

async function resolveNeonOrgId(apiKey: string): Promise<string | undefined> {
  // Prefer explicit env override
  if (process.env.NEON_ORG_ID) return process.env.NEON_ORG_ID;

  // Otherwise auto-fetch the first org the API key has access to
  try {
    const res = await fetch(`${NEON_API}/users/me/organizations`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { organizations?: Array<{ id: string; name: string }> };
    const orgId = data.organizations?.[0]?.id;
    if (orgId) log.info('Neon org auto-resolved', { orgId, name: data.organizations?.[0]?.name });
    return orgId;
  } catch {
    return undefined;
  }
}

function parseNeonDatabaseRef(rawProjectId: string): NeonDatabaseRef {
  if (rawProjectId.startsWith(SHARED_REF_PREFIX)) {
    const [, projectId, branchId, databaseName, roleName] = rawProjectId.split(':');
    if (projectId && branchId && databaseName) {
      return {
        projectId,
        branchId,
        databaseName,
        roleName: roleName || DEFAULT_ROLE_NAME,
      };
    }
  }

  return {
    projectId: rawProjectId,
    databaseName: DEFAULT_DATABASE_NAME,
    roleName: DEFAULT_ROLE_NAME,
  };
}

function encodeSharedNeonDatabaseRef(ref: Required<Pick<NeonDatabaseRef, 'projectId' | 'branchId' | 'databaseName' | 'roleName'>>): string {
  return `${SHARED_REF_PREFIX}${ref.projectId}:${ref.branchId}:${ref.databaseName}:${ref.roleName}`;
}

function normalizeDatabaseName(companySlug: string, companyId: string): string {
  const base = `c_${companySlug}_${companyId.slice(0, 6)}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base.slice(0, 60) || `c_${companyId.replace(/-/g, '').slice(0, 16)}`;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.clone().json() as { message?: string; error?: string };
    return data.message ?? data.error ?? response.statusText;
  } catch {
    return (await response.text().catch(() => response.statusText)) || response.statusText;
  }
}

async function fetchConnectionUri(apiKey: string, ref: NeonDatabaseRef): Promise<string> {
  const connUrl = new URL(`${NEON_API}/projects/${ref.projectId}/connection_uri`);
  connUrl.searchParams.set('database_name', ref.databaseName);
  connUrl.searchParams.set('role_name', ref.roleName);
  connUrl.searchParams.set('pooled', 'true');
  if (ref.branchId) connUrl.searchParams.set('branch_id', ref.branchId);

  const connRes = await fetch(connUrl.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!connRes.ok) {
    throw new Error(`Neon connection_uri fetch failed: ${await readErrorMessage(connRes)}`);
  }
  const connData = await connRes.json() as { uri?: string };
  return connData.uri ?? '';
}

async function getPrimaryBranch(apiKey: string, projectId: string): Promise<NeonBranch> {
  const response = await fetch(`${NEON_API}/projects/${projectId}/branches`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Neon branch lookup failed: ${await readErrorMessage(response)}`);
  }
  const data = await response.json() as { branches?: NeonBranch[] };
  const branch = data.branches?.find((item) => item.primary || item.default) ?? data.branches?.[0];
  if (!branch) throw new Error(`Neon project ${projectId} has no branch to reuse`);
  return branch;
}

async function findReusableNeonProject(apiKey: string, orgId: string | undefined): Promise<NeonProject | null> {
  const explicitProjectId = process.env.NEON_SHARED_PROJECT_ID || process.env.NEON_REUSE_PROJECT_ID;
  if (explicitProjectId) {
    const response = await fetch(`${NEON_API}/projects/${explicitProjectId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Configured shared Neon project ${explicitProjectId} is unavailable: ${await readErrorMessage(response)}`);
    const data = await response.json() as { project: NeonProject };
    return data.project;
  }

  const url = new URL(`${NEON_API}/projects`);
  url.searchParams.set('limit', '100');
  if (orgId) url.searchParams.set('org_id', orgId);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Neon reusable project lookup failed: ${await readErrorMessage(response)}`);
  const data = await response.json() as { projects?: NeonProject[] };
  const projects = data.projects ?? [];
  return projects.find((project) => project.name === 'baljia-superai-testing')
    ?? projects.find((project) => project.name.startsWith('baljia-canary-'))
    ?? null;
}

async function persistCompanyDatabaseRef(
  companyId: string,
  persistedRef: string,
  infra: { projectId: string; branchId?: string; databaseName: string; host: string },
): Promise<void> {
  await db.update(companies).set({ neon_database_id: persistedRef }).where(eq(companies.id, companyId));

  const [memLayer] = await db.select({ content: memoryLayers.content })
    .from(memoryLayers)
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, 1)))
    .limit(1);

  const infraSection = [
    '## Infrastructure',
    `Neon DB Project: ${infra.projectId}`,
    infra.branchId ? `Neon Branch: ${infra.branchId}` : '',
    `Host: ${infra.host}`,
    `Database: ${infra.databaseName}`,
  ].filter(Boolean).join('\n');
  const existingContent = (memLayer?.content as string) ?? '';
  const infraRegex = /## Infrastructure[\s\S]*?(?=\n## |$)/g;
  const newContent = infraRegex.test(existingContent)
    ? existingContent.replace(infraRegex, infraSection)
    : existingContent ? `${existingContent}\n\n${infraSection}` : infraSection;

  await db.update(memoryLayers).set({ content: newContent, updated_at: new Date() })
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, 1)));
}

async function provisionCompanyDatabaseInSharedProject(
  apiKey: string,
  orgId: string | undefined,
  companyId: string,
  companySlug: string,
  cause: string,
): Promise<NeonDatabase> {
  const reusableProject = await findReusableNeonProject(apiKey, orgId);
  if (!reusableProject) {
    throw new Error(`${cause}; no reusable Neon project found for shared-database fallback`);
  }

  const branch = await getPrimaryBranch(apiKey, reusableProject.id);
  const databaseName = normalizeDatabaseName(companySlug, companyId);
  const createResponse = await fetch(`${NEON_API}/projects/${reusableProject.id}/branches/${branch.id}/databases`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      database: {
        name: databaseName,
        owner_name: DEFAULT_ROLE_NAME,
      },
    }),
  });

  if (!createResponse.ok) {
    const message = await readErrorMessage(createResponse);
    if (createResponse.status !== 409 && !/already exists/i.test(message)) {
      throw new Error(`${cause}; shared Neon database creation failed: ${message}`);
    }
  }

  const ref: Required<Pick<NeonDatabaseRef, 'projectId' | 'branchId' | 'databaseName' | 'roleName'>> = {
    projectId: reusableProject.id,
    branchId: branch.id,
    databaseName,
    roleName: DEFAULT_ROLE_NAME,
  };
  const connectionUri = await fetchConnectionUri(apiKey, ref);
  const host = new URL(connectionUri).hostname;
  const persistedRef = encodeSharedNeonDatabaseRef(ref);

  await persistCompanyDatabaseRef(companyId, persistedRef, {
    projectId: reusableProject.id,
    branchId: branch.id,
    databaseName,
    host,
  });

  log.warn('Neon project quota reached; provisioned shared-project database fallback', {
    companyId,
    projectId: reusableProject.id,
    branchId: branch.id,
    databaseName,
  });

  return {
    projectId: persistedRef,
    connectionUri,
    host,
    name: databaseName,
  };
}

export async function provisionCompanyDatabase(
  companyId: string,
  companySlug: string
): Promise<NeonDatabase> {
  const apiKey = process.env.NEON_API_KEY;
  if (!apiKey) {
    throw new Error('NEON_API_KEY not configured — per-company databases cannot be provisioned');
  }

  const orgId = await resolveNeonOrgId(apiKey);

  log.info('Provisioning Neon database', { companyId, companySlug, orgId: orgId ?? '(default)' });

  // Create project (1 project = 1 company database in Neon)
  const response = await fetch(`${NEON_API}/projects`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      project: {
        name: `baljia-${companySlug}`,
        region_id: 'aws-us-east-1',
        pg_version: 16,
        autoscaling_limit_min_cu: 0.25,   // Scale to zero when inactive
        autoscaling_limit_max_cu: 1,
        // Neon multi-org accounts require org_id. Auto-resolved from the API if
        // not explicitly set via NEON_ORG_ID env var.
        ...(orgId ? { org_id: orgId } : {}),
      },
    }),
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    if (/projects? limit|limit of \d+|exceeded/i.test(message)) {
      return provisionCompanyDatabaseInSharedProject(
        apiKey,
        orgId,
        companyId,
        companySlug,
        `Neon project creation failed: ${message}`,
      );
    }
    throw new Error(`Neon project creation failed: ${message}`);
  }

  const data = await response.json() as { project: NeonProject; connection_uris?: Array<{ connection_uri: string }> };
  const project = data.project;

  // Get connection URI
  let connectionUri = data.connection_uris?.[0]?.connection_uri ?? '';

  if (!connectionUri) {
    // Fetch connection URI separately
    const connRes = await fetch(`${NEON_API}/projects/${project.id}/connection_uri`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (connRes.ok) {
      const connData = await connRes.json() as { uri?: string };
      connectionUri = connData.uri ?? '';
    }
  }

  // Extract host from connection URI
  let host = '';
  try {
    const url = new URL(connectionUri);
    host = url.hostname;
  } catch { /* leave empty */ }

  await persistCompanyDatabaseRef(companyId, project.id, {
    projectId: project.id,
    databaseName: DEFAULT_DATABASE_NAME,
    host,
  });

  log.info('Neon database provisioned', { companyId, projectId: project.id, host });

  return {
    projectId: project.id,
    connectionUri,
    host,
    name: project.name,
  };
}

// ══════════════════════════════════════════════
// GET — retrieve project info for a company
// ══════════════════════════════════════════════

export async function getCompanyDatabase(companyId: string): Promise<NeonDatabase | null> {
  const apiKey = process.env.NEON_API_KEY;
  if (!apiKey) return null;

  const [company] = await db.select({ neon_database_id: companies.neon_database_id })
    .from(companies).where(eq(companies.id, companyId)).limit(1);

  if (!company?.neon_database_id) return null;

  const ref = parseNeonDatabaseRef(company.neon_database_id);

  const response = await fetch(`${NEON_API}/projects/${ref.projectId}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });

  if (!response.ok) return null;

  const data = await response.json() as { project: NeonProject };
  const project = data.project;

  // Neon API v2 requires `database_name` and `role_name` query params on this
  // endpoint. Without them it returns 400 "query parameter database_name not
  // set" and the previous version of this code silently swallowed that as an
  // empty connectionUri. The defaults (`neondb` / `neondb_owner`) are what
  // createProjectAndDatabase provisions, so they match every Baljia-created
  // project. If a project was provisioned with different names, we'll still
  // get 400 here and the caller can fall back to the createProjectAndDatabase
  // response (which includes the URI inline).
  const connUrl = new URL(`${NEON_API}/projects/${project.id}/connection_uri`);
  connUrl.searchParams.set('database_name', ref.databaseName);
  connUrl.searchParams.set('role_name', ref.roleName);
  // Pooled connection — what app code actually wants. Falls back to direct
  // if the project doesn't have a pooler.
  connUrl.searchParams.set('pooled', 'true');
  if (ref.branchId) connUrl.searchParams.set('branch_id', ref.branchId);

  const connRes = await fetch(connUrl.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });

  let connectionUri = '';
  if (connRes.ok) {
    const connData = await connRes.json() as { uri?: string };
    connectionUri = connData.uri ?? '';
  } else {
    log.warn('Neon connection_uri fetch failed', {
      projectId: project.id,
      status: connRes.status,
      body: (await connRes.text().catch(() => '')).slice(0, 200),
    });
  }

  let host = '';
  try {
    host = new URL(connectionUri).hostname;
  } catch { /* leave empty */ }

  return { projectId: company.neon_database_id, connectionUri, host, name: ref.databaseName };
}

// ══════════════════════════════════════════════
// BRANCH — create a branch for safe migrations
// (Neon's killer feature: branches are instant copies)
// ══════════════════════════════════════════════

export async function createBranch(
  projectId: string,
  branchName: string
): Promise<{ branchId: string; connectionUri: string }> {
  const apiKey = process.env.NEON_API_KEY;
  if (!apiKey) throw new Error('NEON_API_KEY not configured');

  const response = await fetch(`${NEON_API}/projects/${projectId}/branches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ branch: { name: branchName } }),
  });

  if (!response.ok) {
    const error = await response.json() as { message?: string };
    throw new Error(`Branch creation failed: ${error.message ?? response.statusText}`);
  }

  const data = await response.json() as {
    branch: { id: string };
    connection_uris?: Array<{ connection_uri: string }>;
  };

  return {
    branchId: data.branch.id,
    connectionUri: data.connection_uris?.[0]?.connection_uri ?? '',
  };
}

// ══════════════════════════════════════════════
// DELETE BRANCH — cleanup after migration test
// ══════════════════════════════════════════════

export async function deleteBranch(projectId: string, branchId: string): Promise<void> {
  const apiKey = process.env.NEON_API_KEY;
  if (!apiKey) return;

  await fetch(`${NEON_API}/projects/${projectId}/branches/${branchId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}
