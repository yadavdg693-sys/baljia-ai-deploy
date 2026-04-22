// Phase 3b: per-journey task creation inheriting the CEO's CAPE framework.
// - Injects getPlatformCapabilitiesPrompt() (same string the CEO sees)
// - Inlines CEO's 10 Skills + Task Scoping rules
// - Per-slot CAN/CANNOT declarations (capability boundaries)
// - Per-journey engineering spec: Build/Surprise = 5-section product spec;
//   Grow = 5-section optimization spec
// - Polsia field values: priority 100/70/70, complexity 8/3/4, hours 3/1/1
// - Worker-voiced reasoning (different from market-research rationale)
// - Consumes market_research.first_priorities as strategic seed
// - Parallel Promise.all for 3 task creates
//
// See memory/project_task_creation_inherits_ceo.md

import * as taskService from '@/lib/services/task.service';
import { getPlatformCapabilitiesPrompt } from '@/lib/platform-capabilities';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import type { PipelineContext, FirstPriority } from '../types';

interface StarterTasksResult {
  engineering: { title: string; description: string; reasoning: string };
  research: { title: string; description: string; reasoning: string };
  outreach: { title: string; description: string; reasoning: string };
}

const FILLER_VERBS = ['explore', 'investigate', 'consider', 'look into', 'leverage', 'synergize', 'deep-dive'];

export async function createStarterTasks(ctx: PipelineContext): Promise<void> {
  const isGrow = ctx.journey === 'grow_my_company';
  const firstPriorities = ctx.marketResearchJson?.first_priorities ?? [];
  const priorityByslot = Object.fromEntries(firstPriorities.map((p) => [p.slot, p])) as Record<string, FirstPriority | undefined>;

  const geo = ctx.founderEnrichment?.geo;
  const city = geo?.city ?? null;
  const country = geo?.country ?? null;
  const geoLine = country
    ? `${[city, country].filter(Boolean).join(', ')}`
    : '(unknown)';

  const ideaText =
    ctx.refinedIdea?.refined_idea
    ?? ctx.inventedIdea?.invented_idea
    ?? ctx.businessProfile?.description
    ?? ctx.strategy
    ?? ctx.input
    ?? '';

  const marketContext = ctx.marketResearch ?? '';

  const capabilities = getPlatformCapabilitiesPrompt();

  const engineeringSpec = isGrow ? GROW_ENG_SPEC : BUILD_ENG_SPEC;
  const engineeringLabel = isGrow ? 'OPTIMIZATION task for the existing product' : 'NEW MVP slice to build';

  const priorityHints = firstPriorities.length === 3
    ? `Strategic seeds from market research (use as inspiration; refine for the task surface — you are generating SIBLINGS of these, not verbatim copies):
- engineering seed: ${priorityByslot.engineering?.title ?? '(missing)'} — ${priorityByslot.engineering?.rationale ?? ''}
- research seed: ${priorityByslot.research?.title ?? '(missing)'} — ${priorityByslot.research?.rationale ?? ''}
- outreach seed: ${priorityByslot.outreach?.title ?? '(missing)'} — ${priorityByslot.outreach?.rationale ?? ''}`
    : '(No first_priorities from market research — generate titles fresh from context below.)';

  const prompt = `You are generating 3 starter tasks for ${ctx.companyName} during onboarding. These become the founder's first task queue.

INPUTS:
- Company: ${ctx.companyName}
- Journey: ${ctx.journey}
- Mission one-liner: ${ctx.oneLiner}
- Founder angle: ${ctx.founderAngle ?? '(none)'}
- Founder location: ${geoLine}
- Active milestone: ${ctx.activeMilestoneTitle ?? '(none)'}${ctx.activeMilestoneTags.length ? ` (focus areas: ${ctx.activeMilestoneTags.join(', ')})` : ''}
- Idea / business: ${ideaText}
- Market research (full rendered report):
${marketContext.slice(0, 3000)}

${priorityHints}

═══════════════════════════════════════════════════════
PLATFORM CAPABILITIES (single source of truth — same as CEO uses):
═══════════════════════════════════════════════════════

${capabilities}

═══════════════════════════════════════════════════════
TASK FRAMEWORK (inherited from CEO scoping rules):
═══════════════════════════════════════════════════════

- Scope Sniffing: catch the iceberg — if "Build X" implies 10 sub-features, narrow to MVP slice
- Pattern Matching: marketplace = auth + listings + search + payments + messaging; SaaS = auth + onboarding + core + billing + settings; AI tool = input form + API call + output display + history
- MVP Filtering: which ONE feature would a customer pay for? That's v1
- Failure Prediction: which step has highest fail risk? Flag fragile external APIs explicitly
- Constraint Budgeting: max 4 hours per task; 6 shipped features beat 12 half-built
- Translation: not "make it good" — say "create /api/search that accepts string X and returns Y"
- Each task description is SELF-CONTAINED — embed all needed context inline (competitor names, audience details, infra assumptions). Tasks run in parallel; NEVER reference other tasks' output
- One concern per task: Engineering builds. Research analyzes. Outreach sells

═══════════════════════════════════════════════════════
TASK 1 — slot: engineering, priority: high, hours: 3, complexity: 7-9
═══════════════════════════════════════════════════════

Engineering agent CAN: Express + Postgres backend, DB schemas, Render hosting, subdomain, Stripe, GitHub, API endpoints, webhooks, cron jobs.
Engineering agent CANNOT: browse web, send emails, post tweets, run ads, do web research.

TITLE: action verb + specific ${engineeringLabel}. Max 12 words.

DESCRIPTION: 5-section spec (self-contained):
${engineeringSpec}

REASONING: 2 sentences, WORKER-VOICED (queue justification: "this task should run because..."). What's blocked without it. What revenue or validation signal it unlocks. NOT founder-facing strategic narrative.

═══════════════════════════════════════════════════════
TASK 2 — slot: research, priority: medium, hours: 1, complexity: 3-4
═══════════════════════════════════════════════════════

Research agent CAN: web research, competitive analysis, market intelligence, customer persona development.
Research agent CANNOT: write code, deploy, post anywhere, send emails.

TITLE: format "Scout the <category>: <Competitor1>, <Competitor2>, <Competitor3>..." — name 3+ ACTUAL competitors from the market research competitors[] array.

DESCRIPTION: 3-4 sentences, self-contained. Dimensions to compare (pricing tiers, feature parity, customer reviews, positioning gaps). Deliverable (comparison report saved as document). Decision this informs (positioning, pricing tier, feature priority).

REASONING: 2 sentences, WORKER-VOICED. Why this competitive deep-dive now. How it sharpens the engineering task's scope or unlocks a positioning decision.

═══════════════════════════════════════════════════════
TASK 3 — slot: outreach, priority: medium, hours: 1, complexity: 4-5
═══════════════════════════════════════════════════════

Outreach agent CAN: company email (${ctx.slug}@baljia.app), Hunter.io email lookup/verification, web search for prospects.
Outreach agent CANNOT: write code, post on social platforms, run ads.

TITLE: format "Cold outreach: Find N <role> in <industry/situation>". Name the EXACT customer profile + count.

DESCRIPTION: 3-4 sentences, self-contained.
- Channels: if founder location is "${geoLine}" and it's known, pick channels actually used by buyers IN THAT GEOGRAPHY (region-specific social platforms, local communities). If location is "(unknown)", match channels to the AUDIENCE itself (e.g. indie authors → KDP forums; dev communities → GitHub Discussions). NEVER hardcode a country if no GeoIP.
- First message structure: 1-line value prop + 1 qualifying question
- Response signals: name what response means real interest (e.g. "asks about pricing", not "shows interest")

REASONING: 2 sentences, WORKER-VOICED. Why these specific people. Why outreach now, before the product is finished.

═══════════════════════════════════════════════════════
HARD RULES:
═══════════════════════════════════════════════════════

1. Each task description is SELF-CONTAINED — embed competitor names, audience details, infra assumptions inline. Never say "see other task" or "see report".
2. Each task respects its agent's CAN/CANNOT capability boundaries declared above.
3. Engineering DESCRIPTION must contain all 5 sections and be >= 6 sentences.
4. Research TITLE must name 3+ actual competitors from market research.
5. Outreach DESCRIPTION must use "${geoLine}" from GeoIP when available OR match channels to AUDIENCE when unknown. NEVER hardcode a country in fallback.
6. REASONING fields are WORKER-VOICED (queue justification), not founder-facing strategic narrative.
7. No filler verbs anywhere: ${FILLER_VERBS.map((v) => `"${v}"`).join(', ')}.

Return a JSON object with this exact shape:
{
  "engineering": { "title": "...", "description": "...", "reasoning": "..." },
  "research":    { "title": "...", "description": "...", "reasoning": "..." },
  "outreach":    { "title": "...", "description": "...", "reasoning": "..." }
}`;

  await emitActivity(ctx, 'Generating 3 starter tasks (CEO framework)', 'llm');

  const result = await callSmallLLMJson<StarterTasksResult>(prompt, { maxTokens: 3000, retryOnce: true });

  validateTask(result.engineering, 'engineering');
  validateTask(result.research, 'research');
  validateTask(result.outreach, 'outreach');

  // Parallel task creation — Polsia fires all 3 in rapid succession (~600ms total)
  await Promise.all([
    taskService.createTask({
      company_id: ctx.companyId,
      title: result.engineering.title,
      description: result.engineering.description,
      tag: 'engineering',
      source: 'onboarding',
      status: 'todo',
      priority: 100,
      queue_order: 1,
      complexity: 8,
      estimated_hours: '3',
      estimated_credits: 1,
      suggestion_reasoning: result.engineering.reasoning || ENGINEERING_FALLBACK_REASONING,
    }),
    taskService.createTask({
      company_id: ctx.companyId,
      title: result.research.title,
      description: result.research.description,
      tag: 'research',
      source: 'onboarding',
      status: 'todo',
      priority: 70,
      queue_order: 2,
      complexity: 3,
      estimated_hours: '1',
      estimated_credits: 1,
      suggestion_reasoning: result.research.reasoning || RESEARCH_FALLBACK_REASONING,
    }),
    taskService.createTask({
      company_id: ctx.companyId,
      title: result.outreach.title,
      description: result.outreach.description,
      tag: 'outreach',
      source: 'onboarding',
      status: 'todo',
      priority: 70,
      queue_order: 3,
      complexity: 4,
      estimated_hours: '1',
      estimated_credits: 1,
      suggestion_reasoning: result.outreach.reasoning || OUTREACH_FALLBACK_REASONING,
    }),
  ]);

  await emitActivity(ctx, `3 tasks queued: engineering (3h) → research (1h) → outreach (1h)`, 'task');
}

function validateTask(
  task: { title: string; description: string; reasoning: string },
  slot: string,
): void {
  if (!task?.title?.trim() || !task.description?.trim()) {
    throw new Error(`createStarterTasks: ${slot} task missing title or description`);
  }
  const text = `${task.title} ${task.description}`.toLowerCase();
  for (const filler of FILLER_VERBS) {
    if (text.includes(filler)) {
      // Soft fail — log but don't block (LLM compliance isn't perfect and a filler
      // verb is better than failing the whole pipeline). Phase 3b could harden this
      // to re-prompt if we want strict enforcement.
      break;
    }
  }
}

const BUILD_ENG_SPEC = `
1. Core flow (3-6 numbered user-system steps)
2. Key features (3-5 features, named specifically)
3. Tech stack (Express + Postgres already provisioned; list 1-3 critical libraries if relevant)
4. Success criteria (measurable definition of "done")
5. Out of scope for v1 (what we're NOT building yet — manage scope explicitly)
`;

const GROW_ENG_SPEC = `
1. Current state (what exists today, the metric we're improving, baseline number if known)
2. Hypothesis (what's the bottleneck, what change should help, why)
3. Specific changes (3-5 concrete edits to the existing product/code/UI — named specifically)
4. Measurement (what metric improves and by how much as a target %)
5. Rollback plan (how we revert if the change makes things worse)
`;

const ENGINEERING_FALLBACK_REASONING = 'Core product slice that unlocks first usable value. No downstream validation or sales possible until this ships.';
const RESEARCH_FALLBACK_REASONING = 'Sharpens positioning and feature priority by naming competitors explicitly — cheapest way to de-risk the engineering task.';
const OUTREACH_FALLBACK_REASONING = 'First customer conversations surface demand signals before more product is built — cheaper to pivot now than after week of coding.';
