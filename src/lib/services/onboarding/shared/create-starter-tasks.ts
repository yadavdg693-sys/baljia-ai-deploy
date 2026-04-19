// TEMP: pre-Phase-3b task generator.
// Replaced by CEO-framework-inheriting task creation in Phase 3b.
// Keeps pipeline functional during Phase 0 refactor.

import * as taskService from '@/lib/services/task.service';
import { callSmallLLM } from '../llm/small-llm';
import type { PipelineContext } from '../types';

interface StarterTask {
  title: string;
  description: string;
  tag: string;
  estimated_credits: number;
  reasoning: string;
}

export async function createStarterTasks(ctx: PipelineContext): Promise<void> {
  if (!ctx.marketResearch && !ctx.founderAngle) {
    throw new Error('Starter task generation failed: no market research or founder angle available');
  }

  const tasks = await generatePersonalizedTasks(ctx);
  if (!tasks || tasks.length === 0) {
    throw new Error('Starter task generation failed: LLM could not produce parseable tasks');
  }

  for (let i = 0; i < tasks.length; i++) {
    await taskService.createTask({
      company_id: ctx.companyId,
      title: tasks[i].title,
      description: tasks[i].description,
      tag: tasks[i].tag,
      source: 'onboarding',
      status: 'todo',
      priority: 80 - i * 10,
      queue_order: i + 1,
      estimated_credits: tasks[i].estimated_credits,
      suggestion_reasoning: tasks[i].reasoning,
    });
  }
}

async function generatePersonalizedTasks(ctx: PipelineContext): Promise<StarterTask[] | null> {
  const parts: string[] = [`Company: ${ctx.companyName}`, `Journey: ${ctx.journey}`];
  if (ctx.founderAngle) parts.push(`Founder positioning: ${ctx.founderAngle}`);
  if (ctx.input) parts.push(`Idea/Business: ${ctx.input}`);

  if (ctx.activeMilestoneTitle) {
    parts.push(`Current milestone: ${ctx.activeMilestoneTitle}`);
    if (ctx.activeMilestoneTags.length > 0) {
      parts.push(`Milestone focus areas: ${ctx.activeMilestoneTags.join(', ')}`);
    }
  }

  const geo = ctx.founderEnrichment?.geo;
  if (geo?.country) {
    parts.push(`Founder location: ${[geo.city, geo.country].filter(Boolean).join(', ')} — outreach targets and market framing should reflect this geography`);
  }
  if (ctx.marketResearch) parts.push(`Market research:\n${ctx.marketResearch.slice(0, 800)}`);

  const prompt = `Create 3 startup tasks for ${ctx.companyName}. Use the context to make them specific.
Name real competitors. Name the exact type of customer to reach (role, industry, situation).

${parts.join('\n\n')}

Output EXACTLY this format (nothing else, no extra lines):
TASK_1_TITLE: [Research task — name specific competitors to study]
TASK_1_DESC: [2-3 sentences with specific details from market research]
TASK_2_TITLE: [Build task — name the core thing to build]
TASK_2_DESC: [2-3 sentences, what exactly to build and why]
TASK_3_TITLE: [Outreach task — name the exact type of person to reach]
TASK_3_DESC: [2-3 sentences naming the specific audience and what to say]`;

  try {
    const response = await callSmallLLM(prompt, 600);

    const extract = (key: string) => {
      const match = response.match(new RegExp(`${key}:\\s*(.+?)(?=\\nTASK_\\d|$)`, 's'));
      return match?.[1]?.trim() ?? null;
    };

    const t1Title = extract('TASK_1_TITLE');
    const t2Title = extract('TASK_2_TITLE');
    const t3Title = extract('TASK_3_TITLE');

    if (!t1Title || !t2Title || !t3Title) return null;

    return [
      {
        title: t1Title,
        description: extract('TASK_1_DESC') ?? t1Title,
        tag: 'research',
        estimated_credits: 1,
        reasoning: 'Market research grounded in founder domain knowledge.',
      },
      {
        title: t2Title,
        description: extract('TASK_2_DESC') ?? t2Title,
        tag: 'engineering',
        estimated_credits: 1,
        reasoning: 'Core build — depends on research output.',
      },
      {
        title: t3Title,
        description: extract('TASK_3_DESC') ?? t3Title,
        tag: 'outreach',
        estimated_credits: 1,
        reasoning: 'First customer outreach — specific to founder credibility and domain.',
      },
    ];
  } catch {
    return null;
  }
}
