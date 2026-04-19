// Roadmap generation + active milestone derivation

import { createLogger } from '@/lib/logger';
import * as roadmapService from '@/lib/services/roadmap.service';
import { appendMemorySection } from './memory-sections';
import type { PipelineContext } from '../types';

const log = createLogger('OnboardingRoadmap');

export async function generateRoadmap(ctx: PipelineContext): Promise<void> {
  const roadmap = await roadmapService.generateRoadmap(ctx.companyId);
  if (roadmap) {
    log.info('Roadmap generated', { companyId: ctx.companyId, archetype: roadmap.archetype });
  }
}

export async function deriveActiveMilestone(ctx: PipelineContext): Promise<void> {
  const result = await roadmapService.getCurrentMilestoneTags(ctx.companyId);
  ctx.activeMilestoneTitle = result.milestoneTitle;
  ctx.activeMilestoneTags = result.tags;

  if (result.milestoneTitle) {
    await appendMemorySection(ctx.companyId, '## Active Milestone', [
      `Title: ${result.milestoneTitle}`,
      `Tags: ${result.tags.join(', ')}`,
      result.hint ? `Hint: ${result.hint}` : '',
    ].filter(Boolean));
    log.info('Active milestone derived', { companyId: ctx.companyId, milestone: result.milestoneTitle });
  }
}
