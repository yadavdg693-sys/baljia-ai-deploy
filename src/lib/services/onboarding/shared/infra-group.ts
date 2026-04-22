// Composite: naming + infra provisioning + founder app kickoff + startup email
//
// Phase 6 adds provision_founder_app_kickoff as a near-instant stage that fires
// Neon DB + GitHub repo creation promises and returns in ~100ms. Those promises
// continue resolving in the background while the rest of the pipeline (market
// research, mission, roadmap, tasks, landing) runs — their ~90s combined wall
// time hides the ~20s Neon creation. The await_founder_app stage in proof-group
// collects the results before celebrate.

import { stage } from '../stage-runner';
import { nameCompany } from './naming';
import { provisionInfrastructure } from './infra';
import { sendStartupEmail } from './emails';
import { kickoffFounderAppProvisioning } from './provision-founder-app';
import type { PipelineContext } from '../types';

export async function infraGroup(ctx: PipelineContext): Promise<void> {
  await stage(ctx, 'name_company', () => nameCompany(ctx));
  await stage(ctx, 'provision_infrastructure', () => provisionInfrastructure(ctx));
  await stage(ctx, 'provision_founder_app_kickoff', () => kickoffFounderAppProvisioning(ctx), { optional: true });
  await stage(ctx, 'send_startup_email', () => sendStartupEmail(ctx), { optional: true });
}
