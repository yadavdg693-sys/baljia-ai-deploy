// Test-only shim: re-export the module-private assertRepoOwnership by
// re-importing engineering.tools and pulling it via dynamic eval is too
// hacky. Instead we duplicate the logic here against the same companies
// table — the smoke test only validates the contract, not the impl.
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';

const SHARED_SKELETON_REPOS = new Set([
  'BALAJIapps/Balaji',
  'BALAJIapps/baljia-express-skeleton',
]);

function githubOrg() {
  return process.env.GITHUB_ORG ?? 'BALAJIapps';
}
function resolveRepo(repoInput: string): string {
  return repoInput.includes('/') ? repoInput : `${githubOrg()}/${repoInput}`;
}

export async function assertRepoOwnershipForTest(
  repoInput: string,
  companyId: string,
  op: 'read' | 'write',
): Promise<string> {
  const normalized = resolveRepo(repoInput);
  if (op === 'read' && SHARED_SKELETON_REPOS.has(normalized)) {
    return normalized;
  }
  const [company] = await db
    .select({ github_repo: companies.github_repo })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company?.github_repo) {
    throw new Error(`No github_repo stored for this company yet. Call github_fork_skeleton first.`);
  }
  const owned = resolveRepo(company.github_repo);
  if (normalized !== owned) {
    throw new Error(
      `github_${op}: this task's company owns "${owned}" but you passed "${normalized}". Cross-tenant access blocked.`,
    );
  }
  return normalized;
}
