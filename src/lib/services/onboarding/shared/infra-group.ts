// Composite: infra provisioning + founder app kickoff + startup email
//
// name_company was moved OUT of this group in the 60-90s speedup:
// strategies now run name_company in parallel with generate_market_research
// so naming (~4s) is hidden behind the larger research cost (~15s).
// infra-group starts AFTER both finish — slug is guaranteed set.
//
// provision_founder_app_kickoff fires Neon DB + GitHub repo creation as
// near-instant (~100ms) fire-and-forget. Those promises resolve in the
// background while market research, mission, tasks, landing run — their
// combined wall time hides the ~20s Neon creation. await_founder_app in
// proof-group collects results before celebrate.

import { stage } from '../stage-runner';
import { provisionInfrastructure } from './infra';
import { sendStartupEmail } from './emails';
import { kickoffFounderAppProvisioning } from './provision-founder-app';
import type { PipelineContext } from '../types';

export async function infraGroup(ctx: PipelineContext): Promise<void> {
  await stage(ctx, 'provision_infrastructure', () => provisionInfrastructure(ctx));
  await stage(ctx, 'provision_founder_app_kickoff', () => kickoffFounderAppProvisioning(ctx), { optional: true });
  await stage(ctx, 'send_startup_email', () => sendStartupEmail(ctx), { optional: true });
}
