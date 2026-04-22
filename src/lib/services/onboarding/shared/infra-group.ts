// Composite: naming + infra provisioning + startup email

import { stage } from '../stage-runner';
import { nameCompany } from './naming';
import { provisionInfrastructure } from './infra';
import { sendStartupEmail } from './emails';
import type { PipelineContext } from '../types';

export async function infraGroup(ctx: PipelineContext): Promise<void> {
  await stage(ctx, 'name_company', () => nameCompany(ctx));
  await stage(ctx, 'provision_infrastructure', () => provisionInfrastructure(ctx));
  await stage(ctx, 'send_startup_email', () => sendStartupEmail(ctx), { optional: true });
}
