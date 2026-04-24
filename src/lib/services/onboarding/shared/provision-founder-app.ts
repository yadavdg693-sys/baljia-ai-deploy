// Founder app provisioning — Phase 6
// Two new stages:
//   1. provision_founder_app_kickoff  — fires Neon DB + GitHub repo creation
//      promises in parallel, stores them on ctx, marks stage done in ~100ms.
//      Promises continue running in the background.
//   2. await_founder_app              — runs right before flush_diagnostics,
//      awaits both promises, persists the results to companies.{neon_database_id,
//      neon_connection_string, github_repo}, emits activity lines.
// Net onboarding wall-clock impact: ~0s (Neon's ~20s provisioning overlaps with
// market research + mission + tasks + landing stages, which take ~90s combined).
//
// Failure policy: BEST-EFFORT (both stages use { optional: true } at the call site).
// If Neon or GitHub API is down, the founder still sees a completed onboarding;
// the engineering agent's first task will retry provisioning as a fallback.

import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import { provisionCompanyDatabase, type NeonDatabase } from '@/lib/services/neon.service';
import { provisionCompanyRepo, type GitHubRepo } from '@/lib/services/github.service';
import { emitActivity } from '../stage-runner';
import type { PipelineContext } from '../types';

const log = createLogger('OnboardingFounderApp');

// In-flight promises live here (attached to ctx via the extension type).
// Both promises resolve to null on failure (best-effort), to a populated object on success.
export interface FounderAppExtension {
  neonPromise?: Promise<NeonDatabase | null>;
  githubPromise?: Promise<GitHubRepo | null>;
}

/**
 * Fires Neon DB + GitHub repo creation in parallel. Returns immediately
 * (stage marks done in <100ms). Actual provisioning continues in the background
 * and completes during later pipeline stages.
 */
export async function kickoffFounderAppProvisioning(ctx: PipelineContext): Promise<void> {
  if (!ctx.slug) {
    throw new Error('kickoffFounderAppProvisioning requires ctx.slug to be set (name_company + provision_infrastructure must run first)');
  }

  const ext = ctx as PipelineContext & FounderAppExtension;

  ext.neonPromise = provisionCompanyDatabase(ctx.companyId, ctx.slug)
    .then((result) => {
      log.info('Neon DB provisioned (background)', { companyId: ctx.companyId, projectId: result.projectId });
      return result;
    })
    .catch((err: unknown) => {
      log.warn('Neon DB provisioning failed (best-effort)', {
        companyId: ctx.companyId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });

  ext.githubPromise = provisionCompanyRepo(ctx.companyId, ctx.slug)
    .then((result) => {
      log.info('GitHub repo provisioned (background)', { companyId: ctx.companyId, full_name: result.full_name });
      return result;
    })
    .catch((err: unknown) => {
      log.warn('GitHub repo provisioning failed (best-effort)', {
        companyId: ctx.companyId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });

  await emitActivity(ctx, 'Setting up your backend infrastructure (in background)', 'infra');
}

/**
 * Awaits the kicked-off promises and persists results to the company record.
 * Called late in the pipeline so background work has maximum time to finish.
 */
export async function awaitFounderAppProvisioning(ctx: PipelineContext): Promise<void> {
  const ext = ctx as PipelineContext & FounderAppExtension;

  if (!ext.neonPromise && !ext.githubPromise) {
    // Kickoff never ran (e.g. stage skipped or threw before starting promises)
    return;
  }

  const [neonResult, githubResult] = await Promise.all([
    ext.neonPromise ?? Promise.resolve(null),
    ext.githubPromise ?? Promise.resolve(null),
  ]);

  const updates: Partial<typeof companies.$inferInsert> = {};
  const activityLines: string[] = [];

  if (neonResult) {
    updates.neon_database_id = neonResult.projectId;
    updates.neon_connection_string = neonResult.connectionUri;
    activityLines.push(`Database ready: ${neonResult.name}`);
  } else {
    activityLines.push('Database setup deferred — will be completed in your first build cycle');
  }

  if (githubResult) {
    updates.github_repo = githubResult.full_name;
    activityLines.push(`Code repository ready: ${githubResult.html_url}`);
  } else {
    activityLines.push('Code repository setup deferred — will be completed in your first build cycle');
  }

  if (Object.keys(updates).length > 0) {
    await db.update(companies).set(updates).where(eq(companies.id, ctx.companyId));
  }

  for (const line of activityLines) {
    await emitActivity(ctx, line, 'infra');
  }
}
