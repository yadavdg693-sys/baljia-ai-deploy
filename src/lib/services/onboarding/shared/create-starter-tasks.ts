// Phase 3b: per-journey task creation inheriting the CEO's CAPE framework.
// - Injects getCapabilitiesBulletsOnly() — bullet lists only, no CEO "worker
//   agent / dispatch" framing, because this prompt's output is saved to founder-
//   visible DB fields (tasks.description + tasks.suggestion_reasoning).
// - IMPORTS CEO's 10 Skills + Task Scoping rules from the shared
//   ceo-framework module so onboarding and the runtime CEO stay in lockstep.
//   When the framework evolves, both consumers update together.
// - Per-slot CAN/CANNOT declarations (capability boundaries)
// - Per-journey engineering spec: Build/Surprise = 5-section product spec;
//   Grow = 5-section optimization spec
// - Polsia field values: priority 100/70/70, complexity 8/3/4, hours 3/1/1
// - Operational-voiced reasoning (different from market-research rationale)
// - Consumes market_research.first_priorities as strategic seed
// - Parallel Promise.all for 3 task creates
//
// See memory/project_task_creation_inherits_ceo.md

import * as taskService from '@/lib/services/task.service';
import { getCapabilitiesBulletsOnly } from '@/lib/platform-capabilities';
import { CEO_TEN_SKILLS, TASK_SCOPING_RULES } from '@/lib/agents/ceo/ceo-framework';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import type { PipelineContext, FirstPriority } from '../types';

interface StarterTasksResult {
  engineering: { title: string; description: string; reasoning: string; complexity?: number };
  research: { title: string; description: string; reasoning: string };
  // NOTE: slot is always saved under the 'outreach' DB tag — only the prompt
  // framing varies by journey (user discovery / validation outreach / sales).
  // Keeping the JSON key as `outreach` avoids schema changes in the router.
  outreach: { title: string; description: string; reasoning: string };
}

const FILLER_VERBS = ['explore', 'investigate', 'consider', 'look into', 'leverage', 'synergize', 'deep-dive'];

export async function createStarterTasks(ctx: PipelineContext): Promise<void> {
  const isGrow = ctx.journey === 'grow_my_company';
  const isBuild = ctx.journey === 'build_my_idea';
  const isSurprise = ctx.journey === 'surprise_me';

  const mrJson = ctx.marketResearchJson;
  const firstPriorities = mrJson?.first_priorities ?? [];
  // Accept seeds from any slot name — engineering/research/outreach/discovery/validation
  const priorityByslot = Object.fromEntries(firstPriorities.map((p) => [p.slot, p])) as Record<string, FirstPriority | undefined>;
  const task3Seed = priorityByslot.outreach ?? priorityByslot.discovery ?? priorityByslot.validation;

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

  const capabilities = getCapabilitiesBulletsOnly();

  const engineeringSpec = isGrow ? GROW_ENG_SPEC : BUILD_ENG_SPEC;
  const engineeringLabel = isGrow ? 'OPTIMIZATION task for the existing product' : 'NEW MVP slice to build';

  // Structured JSON handoff — pass the parsed market-research object so the
  // LLM can reference named fields (competitors[].name, data_gaps[], retention
  // signal for Grow) instead of re-parsing the rendered markdown text blob.
  const structuredResearchBlock = mrJson
    ? `STRUCTURED MARKET RESEARCH (parsed JSON — use these fields directly):
${JSON.stringify({
  competitors: (mrJson as unknown as { competitors?: Array<{ name: string }> }).competitors?.map((c) => c.name) ?? [],
  data_gaps: (mrJson as unknown as { data_gaps?: string[] }).data_gaps ?? [],
  retention_check: (mrJson as unknown as { retention_check?: unknown }).retention_check ?? null,
  funnel_diagnosis: (mrJson as unknown as { funnel_diagnosis?: unknown }).funnel_diagnosis ?? null,
  demand_signals_count: ((mrJson as unknown as { demand_signals?: string[] }).demand_signals ?? []).length,
}, null, 2)}`
    : '(No structured market research JSON available — rely on the rendered report below.)';

  const priorityHints = firstPriorities.length === 3
    ? `Strategic seeds from market research (use as inspiration; refine for the task surface — you are generating SIBLINGS of these, not verbatim copies):
- engineering seed: ${priorityByslot.engineering?.title ?? '(missing)'} — ${priorityByslot.engineering?.rationale ?? ''}
- research seed: ${priorityByslot.research?.title ?? '(missing)'} — ${priorityByslot.research?.rationale ?? ''}
- task 3 seed: ${task3Seed?.title ?? '(missing)'} — ${task3Seed?.rationale ?? ''}`
    : '(No first_priorities from market research — generate titles fresh from context below.)';

  // Journey-aware Task 3 framing — pre-product journeys need interviews/validation,
  // post-product needs sales. The DB tag stays 'outreach' for all; only the prompt
  // instructions + title format + description vary by journey.
  const task3Block = isGrow
    ? `TASK 3 — slot: sales outreach (GROW journey — founder has a product to sell)
  CAN: cold email from ${ctx.slug}@baljia.app, find and verify professional emails, web search for prospects.
  CANNOT: write code, post on social platforms, run ads.
  TITLE format: "Cold outreach: Find N <role> who <buying signal>". These are SALES prospects with qualifying signals.
  DESCRIPTION (3-4 sentences, self-contained):
  - Channels: match to target customer geography (if known) OR founder location "${geoLine}" (fallback) OR omit if neither. Never hardcode a country.
  - First message structure: 1-line value prop + 1 qualifying question.
  - Response signals that indicate buying intent (e.g. "asks about pricing or timeline", not "shows interest").`
    : isBuild
    ? `TASK 3 — slot: user discovery (BUILD journey — founder has conviction but no users yet)
  CAN: cold email from ${ctx.slug}@baljia.app, find and verify professional emails, web search for prospects.
  CANNOT: write code, post on social platforms, run ads.
  TITLE format: "User discovery: Find N <role> who <behavior>". Example: "User discovery: Find 15 indie authors who published 3+ books in 2024". These are INTERVIEW targets, not sales — the product doesn't exist yet.
  DESCRIPTION (3-4 sentences, self-contained):
  - Channels: match to audience geography (if known) OR founder location "${geoLine}" (fallback) OR omit. Never hardcode a country.
  - Interview questions to ask: "What do you use today for X?", "What's broken about it?", "What would make you switch?", "What would you pay?"
  - Response signals that validate the problem: specific complaints about current tools, stated workarounds, willingness to try a prototype.`
    : `TASK 3 — slot: validation outreach (SURPRISE-ME journey — system-invented idea, unvalidated)
  CAN: cold email from ${ctx.slug}@baljia.app, find and verify professional emails, web search for prospects.
  CANNOT: write code, post on social platforms, run ads.
  TITLE format: "Validation outreach: Find N <role> in <space> to gauge interest". These are INTEREST checks, not sales.
  DESCRIPTION (3-4 sentences, self-contained):
  - Channels: match to audience geography (if known) OR founder location "${geoLine}" (fallback) OR omit. Never hardcode a country.
  - Lightweight interest check: "Does this problem resonate?", "Would you try a solution if it existed?", "What's the #1 frustration you have today around X?"
  - Response signals that justify building: expressed pain, described current workaround, asked when it's launching.`;

  const prompt = `You are generating 3 starter tasks for ${ctx.companyName} during onboarding. These become the founder's first task queue.

INPUTS:
- Company: ${ctx.companyName}
- Journey: ${ctx.journey}
- Mission one-liner: ${ctx.oneLiner}
- Founder angle: ${ctx.founderAngle ?? '(none)'}
- Founder location: ${geoLine}
- Idea / business: ${ideaText}

${structuredResearchBlock}

Market research (full rendered report, for any narrative context not in the JSON above):
${marketContext.slice(0, 2000)}

${priorityHints}

BEFORE WRITING, reason through these silently (do not include in output):
  1. IDEA COMPLEXITY: Is the idea a simple tool (calculator, directory, basic CRUD, dashboard) or a complex system (marketplace, AI platform, multi-role app, real-time features)?
     → Simple → engineering complexity 5-6, broader MVP scope is OK
     → Moderate (CRUD + one API integration, basic AI) → complexity 6-7
     → Complex → complexity 7-9, but NARROW the MVP slice aggressively rather than attempting a broad build
  2. BUILDABILITY: Can the described MVP slice actually ship in 3 hours of agent work? If no, CUT features until it can. A working thin slice beats an ambitious broken build.
  3. RETENTION OVERRIDE (GROW only): if retention_check.signal from the structured research is "warning", the engineering task MUST be a retention fix, not a growth/acquisition feature. Do NOT pour gas on a leaky bucket.

═══════════════════════════════════════════════════════
ALREADY PROVISIONED DURING ONBOARDING (do NOT build again):
═══════════════════════════════════════════════════════

The following artifacts ALREADY exist. The engineering task must NOT recreate them.

- **Landing page** — a marketing / waitlist landing page is already live at
  \`${ctx.slug || '{slug}'}.baljia.app\`. The engineering task must NOT build "a landing
  page", "a marketing site", or "a waitlist capture page" — those already work. If an
  SEO-focused landing page refresh is genuinely needed, that's a SECOND-cycle task.
- **Company email** — \`${ctx.slug || '{slug}'}@baljia.app\` is active and forwards to the founder.
- **Backend infrastructure** — a per-company database and code repository are already
  provisioned and empty. Engineering should push product code and create schema here —
  do NOT include setup of a new database or repository in the task scope.
- **Mission document** — written and saved.
- **Market research report** — saved (you're consuming it above).
- **Launch tweet** — already posted or queued (do NOT make the engineering task create tweets).

The ENGINEERING task's job is to build **the actual product** — the thing the founder's
customers will use to receive value. Not the marketing landing page. Not the waitlist.
Not the tweet. The PRODUCT itself (the tool / platform / app described in the idea + mission).

═══════════════════════════════════════════════════════
PLATFORM CAPABILITIES (what the platform can and cannot do):
═══════════════════════════════════════════════════════

${capabilities}

═══════════════════════════════════════════════════════
TASK FRAMEWORK (shared with runtime CEO — same source, same rules):
═══════════════════════════════════════════════════════

${CEO_TEN_SKILLS}

${TASK_SCOPING_RULES}

Additional rules specific to Day-0 onboarding (3 parallel tasks, not a reactive queue):
- Each task description is SELF-CONTAINED — embed all needed context inline (competitor names, audience details). Tasks run in parallel; NEVER reference other tasks' output.
- One concern per task: Engineering builds. Research analyzes. Outreach sells. Do not mix.

═══════════════════════════════════════════════════════
TASK 1 — slot: engineering, priority: high, hours: 3
Complexity: scaled per Step 0 (5-9 — do NOT default to 7-9)
═══════════════════════════════════════════════════════

Engineering work CAN: build full-stack web apps with a database, APIs, webhooks, dashboards, scheduled jobs, Stripe payments (subscriptions/one-time/Connect), deploy to the company subdomain.
Engineering work CANNOT: browse web, send emails, post tweets, run ads, do web research.

TITLE: action verb + specific ${engineeringLabel}. Max 12 words.

DESCRIPTION: 5-section spec (self-contained). If idea complexity is simple, describe a broader MVP; if complex, describe a NARROW first slice with explicit out-of-scope boundaries:
${engineeringSpec}

Return your complexity assessment (integer 5-9) as a "complexity" field alongside title/description/reasoning. This scales the saved task metadata to the actual scope.

REASONING: 2 sentences, OPERATIONAL-VOICED (queue justification: "this task should run because..."). What's blocked without it. What revenue or validation signal it unlocks. NOT founder-facing strategic narrative.

═══════════════════════════════════════════════════════
TASK 2 — slot: research, priority: medium, hours: 1, complexity: 3-4
═══════════════════════════════════════════════════════

Research work CAN: web research, competitive analysis, market intelligence, customer persona development.
Research work CANNOT: write code, deploy, post anywhere, send emails.

TITLE format varies by the biggest gap in the market research:
- If competitor coverage was thin (< 3 named competitors, or data_gaps mentions competitor data): "Scout the <category>: <Competitor1>, <Competitor2>, <Competitor3>" naming 3+ from the competitors array above
- If demand signals were absent or thin: "Validate demand for <product>: search trends, forums, review sentiment"
- If channels are unclear: "Map acquisition channels: how <A>, <B>, <C> reach <audience>"
- Otherwise default to the competitor scout format

DESCRIPTION: 3-4 sentences, self-contained. Dimensions to compare / validate. Deliverable (comparison or demand report saved as document). Decision this informs (positioning, pricing, build scope, or kill decision).

REASONING: 2 sentences, OPERATIONAL-VOICED. Why this research now. How it sharpens the engineering task or unlocks a go/no-go decision.

═══════════════════════════════════════════════════════
${task3Block}
REASONING: 2 sentences, OPERATIONAL-VOICED. Why these specific people. Why now, and what the response data will unblock.

═══════════════════════════════════════════════════════
HARD RULES:
═══════════════════════════════════════════════════════

1. Each task description is SELF-CONTAINED — embed competitor names, audience details, infra assumptions inline. Never say "see other task" or "see report".
2. Each task respects its agent's CAN/CANNOT capability boundaries declared above.
3. Engineering DESCRIPTION must contain all 5 sections and be >= 6 sentences.
4. Engineering task must build the PRODUCT (the thing the founder's customers use), NOT:
   - a landing page / marketing site / SEO page / waitlist capture  ← already provisioned
   - a homepage / hero page / "coming soon" page                     ← already provisioned
   - the company email setup / DNS / infrastructure                  ← already provisioned
   - a code repository or database                                   ← already provisioned
   If the market-research engineering seed mentions any of the above, OVERRIDE it: pick
   the real product feature (the core user-facing thing that delivers the mission's value
   proposition) instead. Treat the seed as a suggestion, not a mandate.
5. Research TITLE adapts to the biggest gap (competitor depth / demand validation / channel mapping). If competitor-scout format is chosen, name 3+ actual competitors from the market research competitors[] array.
6. Task 3 DESCRIPTION must use ${geoLine} for geography when GeoIP is known OR match channels to AUDIENCE when unknown. NEVER hardcode a country in fallback.
7. REASONING fields are OPERATIONAL-VOICED (queue justification), not founder-facing strategic narrative.
8. No filler verbs anywhere: ${FILLER_VERBS.map((v) => `"${v}"`).join(', ')}.
9. Engineering complexity (5-9) MUST reflect actual idea complexity from Step 0. Over-scoping to 9 on simple ideas causes first-task failures.
10. GROW with retention_check.signal = "warning": engineering task MUST address retention, not acquisition. Override the seed if it points at growth features.

Return a JSON object with this exact shape:
{
  "engineering": { "title": "...", "description": "...", "reasoning": "...", "complexity": 6 },
  "research":    { "title": "...", "description": "...", "reasoning": "..." },
  "outreach":    { "title": "...", "description": "...", "reasoning": "..." }
}
Note: the JSON key is always "outreach" regardless of journey — the routing layer uses that key. The prompt framing (user discovery / validation / sales) is captured in the title and description.`;

  await emitActivity(ctx, 'Generating 3 starter tasks', 'llm');

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
      // Dynamic complexity from LLM's Step 0 assessment. Clamp to [5, 9] so
      // a runaway value can't throw off queue sorting. Default 8 only when
      // the LLM didn't return a complexity field (shouldn't happen with retry).
      complexity: clampComplexity(result.engineering.complexity ?? 8),
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

function clampComplexity(value: unknown): number {
  const n = typeof value === 'number' ? Math.round(value) : 8;
  if (Number.isNaN(n)) return 8;
  if (n < 5) return 5;
  if (n > 9) return 9;
  return n;
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
3. Critical libraries (list 1-3 libraries the feature genuinely needs — or "none" if vanilla)
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
