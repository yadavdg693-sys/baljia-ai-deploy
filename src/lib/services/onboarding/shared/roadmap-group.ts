// Composite: roadmap generation + active milestone derivation

import { stage } from '../stage-runner';
import { generateRoadmap, deriveActiveMilestone } from './roadmap';
import type { PipelineContext } from '../types';

export async function roadmapGroup(ctx: PipelineContext): Promise<void> {
  await stage(ctx, 'generate_roadmap', () => generateRoadmap(ctx));
  await stage(ctx, 'derive_active_milestone', () => deriveActiveMilestone(ctx));
}
