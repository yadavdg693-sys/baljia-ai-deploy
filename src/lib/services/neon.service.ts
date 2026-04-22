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

export interface NeonDatabase {
  projectId: string;
  connectionUri: string;
  host: string;
  name: string;
}

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
    const error = await response.json() as { message?: string };
    throw new Error(`Neon project creation failed: ${error.message ?? response.statusText}`);
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

  // Persist to company record
  await db.update(companies).set({ neon_database_id: project.id }).where(eq(companies.id, companyId));

  // Append infra info to Layer 1
  const [memLayer] = await db.select({ content: memoryLayers.content })
    .from(memoryLayers)
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, 1)))
    .limit(1);

  const infraSection = `## Infrastructure\nNeon DB Project: ${project.id}\nHost: ${host}\nDatabase: provisioned`;
  const existingContent = (memLayer?.content as string) ?? '';
  const infraRegex = /## Infrastructure[\s\S]*?(?=\n## |$)/g;
  const newContent = infraRegex.test(existingContent)
    ? existingContent.replace(infraRegex, infraSection)
    : existingContent ? `${existingContent}\n\n${infraSection}` : infraSection;

  await db.update(memoryLayers).set({ content: newContent, updated_at: new Date() })
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, 1)));

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

  const response = await fetch(`${NEON_API}/projects/${company.neon_database_id}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });

  if (!response.ok) return null;

  const data = await response.json() as { project: NeonProject };
  const project = data.project;

  const connRes = await fetch(`${NEON_API}/projects/${project.id}/connection_uri`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });

  let connectionUri = '';
  if (connRes.ok) {
    const connData = await connRes.json() as { uri?: string };
    connectionUri = connData.uri ?? '';
  }

  let host = '';
  try {
    host = new URL(connectionUri).hostname;
  } catch { /* leave empty */ }

  return { projectId: project.id, connectionUri, host, name: project.name };
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
