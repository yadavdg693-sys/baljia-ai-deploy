// Phase 3b: per-journey task creation inheriting the CEO's CAPE framework.
// - Injects getCapabilitiesBulletsOnly() — bullet lists only, no CEO "worker
//   agent / dispatch" framing, because this prompt's output is saved to founder-
//   visible DB fields (tasks.description + tasks.suggestion_reasoning).
// - IMPORTS CEO's 10 Skills + Task Scoping rules from the shared
//   ceo-framework module so onboarding and the runtime CEO stay in lockstep.
//   When the framework evolves, both consumers update together.
// - Per-slot CAN/CANNOT declarations (capability boundaries)
// - Per-journey engineering spec: Build/Surprise = 4-field thin-slice product
//   spec (250-400 chars, no jargon); Grow = 4-field optimization spec.
// - Polsia field values: priority 100/70/70, complexity 8/3/4, hours 3/1/1
// - Operational-voiced reasoning (different from market-research rationale)
// - Consumes market_research.first_priorities as strategic seed
// - Parallel Promise.all for 3 task creates
//
// See memory/project_task_creation_inherits_ceo.md

import * as taskService from '@/lib/services/task.service';
import { getCapabilitiesBulletsOnly } from '@/lib/platform-capabilities';
import { CEO_TEN_SKILLS, TASK_SCOPING_RULES } from '@/lib/agents/ceo/ceo-framework';
import { createLogger } from '@/lib/logger';
import { callSmallLLMJson } from './json-mode';
import { emitActivity } from '../stage-runner';
import type { PipelineContext, FirstPriority } from '../types';

const log = createLogger('OnboardingStarterTasks');

type StarterSlot = 'engineering' | 'research' | 'outreach';

interface StarterTaskShape {
  title: string;
  description: string;
  reasoning: string;
  complexity?: number;
}

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

  // Interpolate the actual slug into the engineering spec so the LLM sees the
  // real subdomain (e.g. acme.baljia.app) instead of the literal "{slug}".
  const slugForSpec = ctx.slug || '{slug}';
  const engineeringSpec = (isGrow ? GROW_ENG_SPEC : BUILD_ENG_SPEC).replaceAll('{slug}', slugForSpec);
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

DESCRIPTION: thin-slice spec (self-contained). 4 fields, 250-400 chars total, no section headers in output, no implementation jargon. Aggressively narrow the scope — this is the FIRST shippable + payable thing, not a full product:
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
3. Engineering DESCRIPTION is 250-400 chars total, has all 4 fields (sign-up, the one feature, what they get, why they pay for Build / current state, the one change, expected lift, rollback for Grow), NO section headers in output, NO library names, NO numbered sub-steps inside any field. Founder reads this verbatim — keep implementation jargon out.
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

  // The LLM call is wrapped in retryOnce inside callSmallLLMJson; if it
  // STILL returns a malformed object after that, we don't want to crash
  // the pipeline. Day-0 starter tasks are recoverable — every slot has
  // a journey-aware deterministic fallback below. We only apply the
  // fallback for fields that are actually missing, so a partially-good
  // LLM response is preserved as-is.
  let raw: Partial<StarterTasksResult> = {};
  try {
    raw = await callSmallLLMJson<StarterTasksResult>(prompt, { maxTokens: 3000, retryOnce: true });
  } catch (err) {
    log.error('createStarterTasks LLM call failed after retry — falling back to journey-aware defaults', {
      companyId: ctx.companyId,
      journey: ctx.journey,
      error: err instanceof Error ? err.message : String(err),
    });
    await emitActivity(ctx, 'LLM unavailable — using journey-aware defaults for starter tasks', 'llm');
  }

  const result: StarterTasksResult = {
    engineering: ensureSlot(raw.engineering, 'engineering', ctx),
    research: ensureSlot(raw.research, 'research', ctx),
    outreach: ensureSlot(raw.outreach, 'outreach', ctx),
  };

  // Soft-validate the LLM output — log if engineering description blew the
  // length budget or leaked implementation jargon. Soft-fail (no throw) so a
  // single overlong description doesn't kill the pipeline; we'll tighten via
  // re-prompt in a later pass.
  validateTask(result.engineering, 'engineering');
  validateTask(result.research, 'research');
  validateTask(result.outreach, 'outreach');

  // Parallel task creation — Polsia fires all 3 in rapid succession (~600ms total)
  // Day-0 starters are auto-authorized at insert time so the CF queue-tick cron
  // (and Render's worker-boot, which doesn't filter on authorization) can pick
  // them up immediately without requiring founder approval. The Approve button
  // remains the path for any other CEO-proposed task that lands without
  // pre-authorization. Schema has authorized_by + authorization_reason; no
  // authorized_at column today, so we record the timestamp inline in the reason.
  const starterAuthReason = `Day-0 onboarding (auto-authorized at ${new Date().toISOString()})`;
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
      authorized_by: 'system',
      authorization_reason: starterAuthReason,
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
      authorized_by: 'system',
      authorization_reason: starterAuthReason,
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
      authorized_by: 'system',
      authorization_reason: starterAuthReason,
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

/**
 * Take whatever (possibly malformed) shape the LLM returned for a slot and
 * patch only the fields that are missing/empty with journey-aware fallbacks.
 *
 * Day-0 starter tasks are part of a recoverable surface — we'd rather ship a
 * generic-but-useful task than fail the entire onboarding pipeline because
 * one field came back blank. We log loudly per missing field so a flaky LLM
 * shows up in Sentry/log dashboards instead of being silently masked.
 */
function ensureSlot(
  task: Partial<StarterTaskShape> | undefined,
  slot: StarterSlot,
  ctx: PipelineContext,
): StarterTaskShape {
  const fallback = buildSlotFallback(slot, ctx);
  const incoming = task ?? {};
  const missing: string[] = [];

  const title = incoming.title?.trim() || (missing.push('title'), fallback.title);
  const description = incoming.description?.trim() || (missing.push('description'), fallback.description);
  const reasoning = incoming.reasoning?.trim() || (missing.push('reasoning'), fallback.reasoning);

  if (missing.length > 0) {
    log.warn(`createStarterTasks: ${slot} slot LLM response missing fields — applied fallback`, {
      companyId: ctx.companyId,
      slot,
      missingFields: missing,
      // Truncate so we don't dump giant objects into logs but still give
      // operators a fingerprint of what the LLM actually returned.
      receivedShape: JSON.stringify({
        title: typeof incoming.title === 'string' ? incoming.title.slice(0, 80) : incoming.title,
        description_len: typeof incoming.description === 'string' ? incoming.description.length : null,
        reasoning_len: typeof incoming.reasoning === 'string' ? incoming.reasoning.length : null,
      }).slice(0, 300),
    });
  }

  return {
    title,
    description,
    reasoning,
    complexity: incoming.complexity,
  };
}

/**
 * Journey-aware fallback content for each slot. Mirrors the prompt's
 * task3Block framing so a fallback outreach task still respects the
 * sales/discovery/validation distinction.
 */
function buildSlotFallback(slot: StarterSlot, ctx: PipelineContext): StarterTaskShape {
  const companyName = ctx.companyName || 'your company';
  const isGrow = ctx.journey === 'grow_my_company';
  const isBuild = ctx.journey === 'build_my_idea';
  const isSurprise = ctx.journey === 'surprise_me';
  const inboxLabel = ctx.slug ? `${ctx.slug}@baljia.app` : 'your company inbox';

  const geo = ctx.founderEnrichment?.geo;
  const geoLine = geo?.country
    ? [geo.city, geo.country].filter(Boolean).join(', ')
    : '(audience-matched)';

  if (slot === 'engineering') {
    const ideaText =
      ctx.refinedIdea?.refined_idea
      ?? ctx.inventedIdea?.invented_idea
      ?? ctx.businessProfile?.description
      ?? ctx.input
      ?? ctx.oneLiner
      ?? '';
    const scope = ideaText ? ideaText.slice(0, 100) : 'the core slice the founder described';
    return isGrow
      ? {
          // 4-field thin-slice fallback — kept under ~400 chars to match the new spec.
          title: `Optimize the weakest funnel step for ${companyName}`,
          description:
            `Current state: the funnel step with the lowest pass-through today (baseline TBD on instrument). ` +
            `The one change: ship a single concrete edit to that step (copy, layout, or removed friction). ` +
            `Expected lift: +10-20% on the chosen step's pass-through rate. ` +
            `Rollback: keep the change behind a feature flag so we can revert within an hour if it regresses.`,
          reasoning: ENGINEERING_FALLBACK_REASONING,
          complexity: 6,
        }
      : {
          // 4-field thin-slice fallback — sign-up + one feature + output + reason to pay.
          title: `Ship the MVP slice for ${companyName}`,
          description:
            `Sign up: magic-link email signup. The one feature: ${scope}. ` +
            `What they get: the user-visible output of that single workflow, end-to-end. ` +
            `Why they pay: it replaces a manual step they'd otherwise spend hours on. Second feature is the next cycle's task.`,
          reasoning: ENGINEERING_FALLBACK_REASONING,
          complexity: 7,
        };
  }

  if (slot === 'research') {
    // No category field exists on idea shapes today — derive a short label
    // from whatever idea text we have so the title isn't generic. Falls
    // back to the company name if all idea fields are empty.
    const ideaText =
      ctx.refinedIdea?.refined_idea
      ?? ctx.inventedIdea?.invented_idea
      ?? ctx.businessProfile?.description
      ?? ctx.oneLiner
      ?? '';
    const categoryLabel = ideaText
      ? ideaText.slice(0, 60).replace(/[\n\r]+/g, ' ').trim()
      : `${companyName}'s`;
    return {
      title: `Scout the ${categoryLabel} competitive landscape`,
      description:
        `Identify and profile 3-5 direct competitors operating in the same space as ${companyName}. For each, capture: positioning one-liner, ` +
        `target customer, pricing model, weakest documented gap (from public reviews or docs), and one differentiator we could press on. ` +
        `Deliverable: a competitive comparison saved as a research document. Decision this informs: positioning copy on the landing ` +
        `page and feature priority for the next engineering cycle.`,
      reasoning: RESEARCH_FALLBACK_REASONING,
    };
  }

  // outreach
  if (isGrow) {
    return {
      title: `Cold outreach: Find 20 prospects who match our ICP`,
      description:
        `Identify 20 buyers in our ICP for ${companyName}. Channel selection: match to target customer geography (${geoLine}) or ` +
        `the audience's known professional network if geography is irrelevant — never hardcode a country. ` +
        `First message: 1-line value prop tied to a measurable pain + 1 qualifying question (e.g. "are you currently spending on X?"). ` +
        `Send from ${inboxLabel}. Track response signals that indicate buying intent: asks about pricing, asks about timeline, ` +
        `requests a demo. Anything else is filed as "not yet" not "no".`,
      reasoning: OUTREACH_FALLBACK_REASONING,
    };
  }
  if (isBuild) {
    return {
      title: `User discovery: Find 15 prospects to interview`,
      description:
        `Identify 15 people who match the target user description from the mission. Channel selection: match to audience geography ` +
        `(${geoLine}) or audience-defined networks if geo is irrelevant — never hardcode a country. Reach out from ${inboxLabel} ` +
        `with a short interview ask (15 minutes), not a pitch. Questions to cover: "What do you use today for X?", "What's broken ` +
        `about it?", "What would make you switch?", "What would you pay?". Validation signals: specific complaints about current ` +
        `tools, stated workarounds, willingness to try a prototype. Capture quotes verbatim.`,
      reasoning: OUTREACH_FALLBACK_REASONING,
    };
  }
  // surprise_me
  void isSurprise;
  return {
    title: `Validation outreach: Gauge interest from 15 likely users`,
    description:
      `Reach 15 people who match the audience the system inferred for ${companyName}. Channel selection: match to audience ` +
      `geography (${geoLine}) or audience-defined networks — never hardcode a country. From ${inboxLabel} ask a single lightweight ` +
      `interest check: "Does this problem resonate?", "Would you try a solution if it existed?", "What's the #1 frustration around ` +
      `X today?". Validation signals: expressed pain, described workaround, asked when it's launching. If <30% positive, the ` +
      `engineering scope should be revisited before more product work.`,
    reasoning: OUTREACH_FALLBACK_REASONING,
  };
}

/**
 * Soft validator for LLM-generated starter tasks. Logs warnings (does NOT
 * throw) when the engineering description exceeds the thin-slice length
 * budget or leaks implementation jargon. Hard-failing here would crash
 * onboarding for a single oversized description; we prefer to ship the
 * task and surface the regression in logs/Sentry.
 */
function validateTask(
  task: { title: string; description: string; reasoning: string },
  slot: string,
): void {
  if (!task?.title?.trim() || !task.description?.trim()) {
    throw new Error(`createStarterTasks: ${slot} task missing title or description`);
  }
  // Enforce thin-slice length on engineering descriptions.
  if (slot === 'engineering' && task.description.length > 500) {
    log.warn(
      `[createStarterTasks] engineering description ${task.description.length} chars (target <500)`,
      { slot, length: task.description.length, titleSnippet: task.title.slice(0, 80) },
    );
  }
  // Strip implementation jargon from any task description. We only log —
  // any heavy rewriting belongs in a re-prompt loop.
  const jargonPatterns = /\b(openai|cheerio|zod|drizzle|neon|tavily|stripe sdk|webhook handler|api endpoint|database migration)\b/gi;
  const jargonHits = task.description.match(jargonPatterns);
  if (jargonHits && jargonHits.length > 0) {
    log.warn(
      `[createStarterTasks] ${slot} description leaked implementation jargon`,
      { slot, hits: jargonHits, titleSnippet: task.title.slice(0, 80) },
    );
  }
}

const BUILD_ENG_SPEC = `
The MVP = the THINNEST billable slice. The landing page is ALREADY live at {slug}.baljia.app —
you are building the APP at {slug}.baljia.app/app.

Description has EXACTLY these 4 fields. No section headers in output. No numbered lists. No
bullet sub-steps. Founder reads this — implementation jargon stays out.

1. SIGN UP: how does a user create an account? (1 sentence — magic link / email signup / Google OAuth)
2. THE ONE FEATURE: the single workflow a user pays to do. ONE workflow, named specifically. (2 sentences max)
3. WHAT THEY GET: the user-visible output of that one workflow. (1 sentence)
4. WHY THEY PAY: what makes this credit-card-worthy? (1 sentence)

DO NOT INCLUDE: dashboards, admin panels, settings pages, "key features" lists, library
names (no "openai, cheerio, zod"), success criteria, out-of-scope sections, numbered
sub-steps inside any field, multiple features, integrations not strictly needed for the
one feature.

A second feature is the second cycle's task. This task is the FIRST shippable + payable thing.

Total target length: 250-400 characters. If you wrote more than 500 chars, you wrote
the wrong task.
`;

const GROW_ENG_SPEC = `
This is an OPTIMIZATION task on an existing product, not a new build.

Description has EXACTLY these 4 fields. No section headers in output. No numbered lists.

1. CURRENT STATE: what's the metric we're improving + the baseline number if known. (1 sentence)
2. THE ONE CHANGE: ONE concrete edit to the existing product. Named specifically. (2 sentences max)
3. EXPECTED LIFT: what metric improves and target % delta. (1 sentence)
4. ROLLBACK: how we revert if the change makes things worse. (1 sentence)

DO NOT INCLUDE: library names, multiple changes, "phase 1 / phase 2" plans, success criteria
sections, out-of-scope appendices, generic optimization advice.

Total target length: 250-400 characters. If over 500, rewrite shorter.
`;

const ENGINEERING_FALLBACK_REASONING = 'Core product slice that unlocks first usable value. No downstream validation or sales possible until this ships.';
const RESEARCH_FALLBACK_REASONING = 'Sharpens positioning and feature priority by naming competitors explicitly — cheapest way to de-risk the engineering task.';
const OUTREACH_FALLBACK_REASONING = 'First customer conversations surface demand signals before more product is built — cheaper to pivot now than after week of coding.';
