// Day-0 starter task generation.
//
// Onboarding gets a narrower task framework than the runtime CEO. The runtime
// CEO can plan dependency chains, auth, payments, and dashboards; starter tasks
// should create three independent first moves, with engineering focused on one
// sellable feature only.

import * as taskService from '@/lib/services/task.service';
import { getCapabilitiesBulletsOnly } from '@/lib/platform-capabilities';
import { ONBOARDING_TASK_FRAMEWORK } from '@/lib/agents/ceo/ceo-framework';
import { createLogger } from '@/lib/logger';
import { callSmallLLMJson } from './json-mode';
import { StarterTasksSchema } from './schemas';
import { emitActivity, recordOnboardingIssue } from '../stage-runner';
import type { PipelineContext } from '../types';

const log = createLogger('OnboardingStarterTasks');

type StarterSlot = 'engineering' | 'research' | 'outreach';

interface StarterTaskShape {
  title: string;
  description: string;
  reasoning: string;
  complexity?: number;
}

export interface StarterTasksResult {
  engineering: { title: string; description: string; reasoning: string; complexity?: number };
  research: { title: string; description: string; reasoning: string };
  // Slot is always saved under the 'outreach' DB tag. The title/description
  // carry journey-specific framing: discovery, validation, or sales.
  outreach: { title: string; description: string; reasoning: string };
}

const FILLER_VERBS = ['explore', 'investigate', 'consider', 'look into', 'leverage', 'synergize', 'deep-dive'];

export async function createStarterTasks(ctx: PipelineContext): Promise<void> {
  const isGrow = ctx.journey === 'grow_my_company';
  const isBuild = ctx.journey === 'build_my_idea';

  const mrJson = ctx.marketResearchJson;
  const geo = ctx.founderEnrichment?.geo;
  const geoLine = geo?.country
    ? `${[geo.city, geo.country].filter(Boolean).join(', ')}`
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

  const researchJson = mrJson as unknown as {
    competitors?: Array<{
      name?: string;
      what_they_do?: string;
      focus_area?: string;
      positioning_or_size?: string;
      gap?: string;
    }>;
    market_validation?: string | { demand_signals?: string[] };
    market_positioning?: string;
    demand_signals?: string[];
    first_priorities?: string[];
    growth_opportunity?: string;
    business_edge?: string;
    business_gap?: string;
    competitive_advantages?: string[];
    gaps_to_exploit?: string[];
    ai_leverage_points?: string[];
    retention_check?: unknown;
    funnel_diagnosis?: unknown;
  } | null;

  const structuredResearchBlock = researchJson
    ? `Structured market research JSON:
${JSON.stringify({
  competitors: researchJson.competitors?.map((c) => ({
    name: c.name,
    what_they_do: c.what_they_do ?? c.focus_area,
    positioning_or_size: c.positioning_or_size,
    gap: c.gap,
  })) ?? [],
  growth_opportunity: researchJson.growth_opportunity ?? null,
  business_edge: researchJson.business_edge ?? null,
  business_gap: researchJson.business_gap ?? null,
  market_validation: typeof researchJson.market_validation === 'string'
    ? researchJson.market_validation.slice(0, 700)
    : null,
  market_positioning: researchJson.market_positioning?.slice(0, 700) ?? null,
  first_priorities: researchJson.first_priorities?.slice(0, 3) ?? [],
  demand_signals_count: researchJson.demand_signals?.length
    ?? (typeof researchJson.market_validation === 'object' ? researchJson.market_validation?.demand_signals?.length : 0)
    ?? 0,
  retention_check: researchJson.retention_check ?? null,
  funnel_diagnosis: researchJson.funnel_diagnosis ?? null,
  competitive_advantages: researchJson.competitive_advantages?.slice(0, 5) ?? [],
  gaps_to_exploit: researchJson.gaps_to_exploit?.slice(0, 5) ?? [],
  ai_leverage_points: researchJson.ai_leverage_points?.slice(0, 5) ?? [],
}, null, 2)}`
    : 'Structured market research JSON: unavailable. Use the rendered report below.';

  const onboardingBriefBlock = ctx.onboardingBrief
    ? `Canonical onboarding brief:
${JSON.stringify(ctx.onboardingBrief, null, 2)}`
    : 'Canonical onboarding brief: unavailable.';

  const landingBriefBlock = ctx.landingPageBrief
    ? `Landing page already generated. Use this as public positioning context; do not recreate it:
${JSON.stringify(ctx.landingPageBrief, null, 2)}`
    : 'Landing page context: unavailable. Still assume onboarding already handled the landing page.';

  const missionDocBlock = ctx.missionDoc
    ? `Mission document:
${JSON.stringify(ctx.missionDoc, null, 2)}`
    : `Mission document: ${ctx.mission || ctx.oneLiner || '(unavailable)'}`;

  const businessProfileBlock = ctx.businessProfile
    ? `Existing business profile:
${JSON.stringify({
  business_name: ctx.businessProfile.business_name,
  description: ctx.businessProfile.description,
  revenue_model: ctx.businessProfile.revenue_model,
  target_customer: ctx.businessProfile.target_customer,
  business_type: ctx.businessProfile.business_type,
  services_or_products: ctx.businessProfile.services_or_products ?? [],
  location_or_market: ctx.businessProfile.location_or_market,
  visible_offer: ctx.businessProfile.visible_offer,
  main_cta: ctx.businessProfile.main_cta,
  proof_signals: ctx.businessProfile.proof_signals ?? [],
}, null, 2)}`
    : 'Existing business profile: unavailable.';

  const inboxLabel = ctx.slug ? `${ctx.slug}@baljia.app` : 'the company inbox';
  const task3Block = isGrow
    ? `Task 3 is sales outreach. Name specific buyer/prospect criteria and the buying signal to look for. Use ${inboxLabel} as the sender when email is needed.`
    : isBuild
      ? `Task 3 is user discovery. Name specific interview targets and the pain/switching signal to look for. Use ${inboxLabel} as the sender when email is needed.`
      : `Task 3 is validation outreach. Name specific likely users and the interest signal to look for. Use ${inboxLabel} as the sender when email is needed.`;

  const prompt = `You are Baljia's company execution task agent.

Create exactly 3 useful starter tasks for this company:
1. one engineering/product task,
2. one research/validation task,
3. one outreach/growth task.

The founder has already completed onboarding. Market research, mission, and landing page are already created. Do not recreate them.

Inputs:
- Company: ${ctx.companyName}
- Journey: ${ctx.journey}
- Founder location: ${geoLine}
- Founder angle: ${ctx.founderAngle ?? '(none)'}
- Founder raw idea / business: ${ctx.input ?? '(none)'}
- Refined idea: ${ideaText || '(unavailable)'}
- Mission one-liner: ${ctx.oneLiner ?? '(unavailable)'}

${onboardingBriefBlock}

${missionDocBlock}

${businessProfileBlock}

${landingBriefBlock}

${structuredResearchBlock}

Market research rendered report:
${marketContext.slice(0, 2200)}

Baljia can execute work like:
${capabilities}

The capability list describes what the platform can do overall. The onboarding framework below controls starter-task scope.

${ONBOARDING_TASK_FRAMEWORK}

How to think:
- Start from the refined idea, market research, mission, and landing page promise.
- The 3 tasks should support the same core company thesis, but they should not depend on each other.
- Task 1 should build exactly one sellable MVP feature for Build/Surprise, or one revenue-facing growth asset/workflow for Grow My Company.
- Task 2 should reduce the biggest market, competitor, pricing, workflow, or positioning uncertainty.
- Task 3 should get real people, customers, users, or prospects into the loop.
- Use Baljia capabilities to keep tasks executable.
- Do not create tasks for work already done during onboarding.
- Do not create vague strategy tasks.

Grow My Company decision gate:
- First decide the likely growth bottleneck from funnel_diagnosis, retention_check, gaps_to_exploit, the website, and the landing page promise.
- If the bottleneck is awareness or acquisition, Task 1 should usually be an external sales or marketing asset that helps prospects understand value, self-qualify, compare options, request a quote, or start a buying conversation.
- If the bottleneck is activation or conversion, Task 1 should usually improve the first buyer action, reduce friction before a sales conversation, or make the offer easier to evaluate.
- If the bottleneck is retention, referrals, delivery, reporting, or client_communication, Task 1 may be an internal/client workflow tool, but the description must state the direct revenue outcome.
- If the business is clearly a software/product company, a product feature can be valid. If it is a service business, agency, local business, consultancy, studio, or B2B service provider, default to revenue-facing sales/marketing/service-delivery assets.
- Do not pick a client management dashboard just because the business has clients.

Task 1 engineering/product:
- Must be exactly one sellable MVP feature for Build/Surprise, or exactly one revenue-facing growth asset/workflow for Grow My Company.
- Must be one user-facing feature that proves the core promise.
- For Grow My Company, the feature should help the existing business get leads, convert prospects, retain clients, win referrals, report value, or deliver one service step better. Do not invent a new business.
- For Grow My Company, prefer an external revenue-facing asset unless the research explicitly points to retention/delivery/client communication as the bottleneck.
- Can include only the minimum UI/data needed to demo that feature.
- No auth, payment, pricing, subscriptions, admin settings, onboarding flows, full dashboards, calendars, infrastructure, landing pages, waitlists, email setup, or analytics unless the feature itself is analytics.
- Do not write "build the MVP", "build the platform", or "create the dashboard" unless the dashboard itself is the single sellable feature.
- Must fit inside one 4-hour Render worker run.
- Title should be a plain founder-facing task title, not an internal label.

Task 2 research/validation:
- Must study the highest-risk unknown affecting product, market, pricing, workflow, or positioning.
- Must name specific competitors, customer segments, workflows, pricing pages, reviews, communities, or behavior to inspect.
- Must produce a concrete deliverable and state the decision it informs.
- Must fit inside one 4-hour Render worker run.

${task3Block}
Task 3 must fit inside one 4-hour Render worker run and must not require the engineering task to be finished first.

Hard rules:
- The engineering task must be one feature, not a bundle of flows.
- The research task must be specific, not "do market research".
- The outreach task must identify who to reach and what to learn.
- All 3 tasks must be independently executable.
- All 3 tasks must support the same company direction.
- All 3 tasks must be scoped to finish within 4 hours.
- Descriptions must be self-contained; do not say "see report", "from above", or "after task 1".
- Do not use filler verbs: ${FILLER_VERBS.map((v) => `"${v}"`).join(', ')}.
- Use plain language. No startup fluff.

- ★ The four real constraints for every engineering task (these matter more than char count):
    1. CLEAR — the engineering agent (Baljia's autonomous coding agent, not a human) reads it once and knows exactly what to build, with no ambiguity. No vague phrases like "user-friendly UI", "robust auth", "modern dashboard". Name concrete fields, routes, response shapes, and visible outcomes the agent can verify with verify_user_journey.
    2. CRISP — every line earns its place. Cut anything that could be removed without losing meaning. No filler, no startup adjectives ("seamless", "robust", "powerful", "intuitive", "modern"), no marketing language.
    3. SIMPLE FEATURE — describes ONE feature, not a bundle. One screen + one save flow + one visible result, OR one pipeline (Input → Output) + one display. Anything bigger gets split into a separate future task.
    4. 4-HOUR / ~200-TURN FIT — the engineering agent runs in a single Render worker bounded by 4 hours wall-clock and 200 LLM turns. The feature must be buildable AND deployable to Render AND verifiable via verify_user_journey within that envelope. If it requires multi-third-party integration setup, a complex multi-table schema, multi-step billing, or an admin console — it's too big and must be scoped down.
  Self-check before returning: could the engineering agent fork the Express skeleton, customize ONE feature, deploy to Render, run a verify_user_journey end-to-end, and finish inside 200 turns? If no, scope it down.

- Engineering task descriptions must follow this EXACT crisp shape — no variations:

    Line 1: "Build the MVP <thing>:" or "Build the core <thing>:" — opening sentence MUST end with ":".
    Line 2: blank
    Line 3: "Input: " + one short line describing what the user provides.
    Line 4: "Output: " + one short line describing what the system delivers.
    Line 5: "Core flow: " + arrow-separated steps using → between them (4-7 steps).
    Line 6: One short closing sentence with the tech stack (e.g. "Use Express.js + PostgreSQL. Store {entity} in the database.").

  Hard rules:
    - The ONLY allowed labels are "Input:", "Output:", "Core flow:". No other labels, no invented section headers.
    - NEVER use "- " bullet markers, "1. " numbered lists, or markdown headings.
    - One sentence per labeled line. No prose paragraphs, no consulting-memo wording.
    - The closing tech line is required and is the LAST line.
    - Still describes exactly ONE user-facing feature (the one-feature self-test below applies).

  Adapt Input/Output/Core flow content to what the feature ACTUALLY does. The slots are fixed; the wording inside must be specific to this product, never generic.

  Derivation method (apply this for ANY application — works regardless of vertical, industry, or whether the idea fits a familiar category):
    1. Input  = What does the user provide to start the feature? (Could be: a brief, a profile, a file upload, a query, a parameter set, a piece of data, a connection, a payment, an event, a triggering action.)
    2. Output = What does the user receive when the feature succeeds? (Could be: a generated artifact, a match, a booking, a report, a notification, a state change confirmation, a delivered service step, a payment receipt.)
    3. Core flow = The discrete steps the system performs between Input and Output, joined with → arrows. Pick the 4-7 steps that ACTUALLY happen, named in the product's domain language. Avoid generic verbs like "process" or "handle".
    4. Tech line = State the stack (Express + PostgreSQL by default for the skeleton) and the primary stored entity.

  Reference patterns (NOT a closed list — derive from the method above for anything outside these):

    - Content-generation (book/blog/video/deck/copy):
        Input = brief/topic + parameters (style, audience, length)
        Output = generated artifact in a usable format (PDF, doc, video, image)
        Core flow = brief intake → research → outline → generation → review → export

    - Sales / outreach / CRM:
        Input = ideal customer profile or prospect list (segments, criteria)
        Output = booked meetings / replies / qualified leads
        Core flow = prospect intake → segmentation → message generation → sending → tracking → reply handling

    - Client / SMB management (content calendar, social posts, reports):
        Input = client/business profile + assets (handles, brand, schedule)
        Output = approved scheduled deliverables
        Core flow = onboard → load assets → generate drafts → review/approve → schedule

    - Marketplace / matching (jobs, dating, freelance, rentals, services):
        Input = listing or seeker profile (preferences, requirements)
        Output = matched connection + transaction confirmation
        Core flow = profile creation → matching → messaging → booking → payment

    - Internal tool / data app (analytics, ops dashboards, workflow tools):
        Input = data import or form submission
        Output = filtered/aggregated view or report
        Core flow = ingest → store → query/filter → display → export

    - Education / training (courses, micro-learning, tutoring, assessments):
        Input = learner profile + topic/skill goal
        Output = completion record + skill progress + next-step recommendation
        Core flow = enroll → deliver content → quiz/assess → grade → progress update → recommend next

    - Health / fitness / wellness tracking:
        Input = user goal + measurement/log entry (workout, meal, vitals, sleep)
        Output = trend insight + plan adjustment + streak/milestone
        Core flow = log entry → store → analyze trend → compare to goal → display insight → suggest next action

    - Finance / budgeting / investment tools:
        Input = account/asset connection or transaction entry
        Output = categorized view + insight + suggested action
        Core flow = connect/import → categorize → reconcile → analyze → report → alert

    - Booking / appointment / scheduling apps:
        Input = service/offering + availability + customer details
        Output = confirmed booking + reminder + calendar entry
        Core flow = browse → select slot → enter details → pay/confirm → notify → reminder

    - Community / discussion / Q&A platforms:
        Input = user post (question, answer, content) + tags
        Output = ranked feed + reputation + notifications
        Core flow = post → moderate → tag/index → display ranked → vote/comment → notify

    - Productivity / task / project apps:
        Input = item to track (task, note, doc, deadline) + assignment
        Output = updated state visible to the user/team
        Core flow = create → assign → track state → notify on change → display in views → export/report

    - Subscription / e-commerce / digital storefront:
        Input = product browse + customer details + payment method
        Output = order confirmation + delivery/access + receipt
        Core flow = browse → cart → checkout → pay → fulfil → confirm

  Fallback (use ONLY when the idea genuinely does not fit any reference pattern AND you cannot articulate concrete domain-specific Input / Output / Core flow content):

    Line 1: One opening sentence ≤ 14 words ending with ":". Names the ONE feature.
    Line 2: blank
    Line 3-5: 2 to 3 bullet lines using "- " (bullets allowed ONLY in fallback). Each bullet ≤ 16 words. ONE concrete piece of the feature per bullet (a data field set, a save flow, a screen, a visible state). NO prose, NO compound sentences with "and... and...".
    Line 6 (optional): ONE closing scope/tech sentence ≤ 14 words. Skip if not needed.

    Total length target: ~250 characters. Hard cap: 350 characters. Anything longer = cut something.

    NEVER: markdown headings, numbered lists, dense paragraphs, vague verbs ("manage", "handle", "process").

  Crisp fallback example (DO NOT copy verbatim):
    "Build the claim entry form:

    - Form fields: claimant name, policy number, incident date, description, photo upload.
    - Save flow: validate fields, store row in claims table, redirect to claim detail page.
    - One screen, no list view yet."

  Use the fallback as a last resort, not as a default. If the idea matches any reference pattern even loosely, use the Input/Output/Core flow shape — do not force generic "form → save → display" content into it; pick a smaller, more concrete feature you can describe specifically. The fallback exists for genuinely novel ideas (a niche B2B vertical tool, an AI agent for a specific workflow, a creator-economy primitive) where forcing the Input/Output/Core flow shape would produce vague slot-fills.

  Concrete example of the correct shape (DO NOT copy verbatim — just match the structure and adapt to category):
    "Build the MVP book generation pipeline:

    Input: user provides a topic/brief (title, genre, target audience, tone)
    Output: a structured manuscript with chapters, formatted as downloadable PDF
    Core flow: brief intake form → AI research phase → outline generation → chapter-by-chapter writing → basic editing pass → PDF export
    Use Express.js + PostgreSQL. Store book projects and generation status in the database."

★ One-feature self-test before you return JSON:
  - Engineering task title and description must describe exactly ONE user-facing feature.
  - Wrong (bundle): "Build claim form + claim list + reminder logic" — three features in one task.
  - Right (single): "Build the claim entry form" with bullets describing its fields, validation, and save behavior — one feature.
  - If your engineering description names two or more separate views/flows/deliverables, rewrite it as one feature before returning.

Return JSON only with exactly these top-level keys:
- engineering
- research
- outreach

Field rules:
- engineering.title: string, max 72 characters. Use a natural title like "Build the {company} {feature} MVP" or "Build the {feature}". Title must name ONE feature, not two joined with "+" or "and".
- engineering.description: string, max 700 characters. Must follow the crisp shape from the description-format rules above (opening sentence ending with ":", then "Input:", "Output:", "Core flow:" with → arrows, then one tech-stack closing line). NO "- " bullet markers, NO markdown, NO numbered lists, NO labels other than Input/Output/Core flow. Describe exactly one growth asset/workflow or product feature — never a bundle.
- engineering.reasoning: string, max 260 characters. Explain why this feature proves the core promise.
- engineering.complexity: integer from 5 to 9.
- research.title: string, max 72 characters.
- research.description: string, max 700 characters. Intro sentence + 2-3 bullets describing pieces of the same one research deliverable.
- research.reasoning: string, max 260 characters. Explain why this reduces risk.
- outreach.title: string, max 72 characters.
- outreach.description: string, max 700 characters. Intro sentence + 2-3 bullets describing pieces of the same one outreach motion.
- outreach.reasoning: string, max 260 characters. Explain why this gets useful signal.`;

  await emitActivity(ctx, 'Generating 3 starter tasks', 'llm');

  let raw: Partial<StarterTasksResult> = {};
  try {
    raw = await callSmallLLMJson<StarterTasksResult>(prompt, {
      maxTokens: 3000,
      retryOnce: true,
      schema: StarterTasksSchema,
      useBigModel: true,
    });
  } catch (err) {
    log.error('createStarterTasks LLM call failed after retry - falling back to journey-aware defaults', {
      companyId: ctx.companyId,
      journey: ctx.journey,
      error: err instanceof Error ? err.message : String(err),
    });
    await recordOnboardingIssue(ctx, {
      stage: 'create_starter_tasks',
      kind: 'starter_tasks_llm_fallback',
      severity: 'high',
      error: err instanceof Error ? err.message : String(err),
      message: 'Starter task generation failed, so onboarding used journey-aware fallback tasks.',
      fallbackUsed: true,
    });
    await emitActivity(ctx, 'LLM unavailable - using journey-aware defaults for starter tasks', 'llm');
  }

  // Critic pass — catch the "engineering task is a bundle of 2-3 features"
  // failure mode. The generator prompt has 8 enforcement points but mid-prompt
  // constraints can still slip through; we run an independent yes/no check
  // and, on fail, regenerate once with the critic's reason injected.
  if (raw.engineering?.title && raw.engineering.description) {
    const verdict = await criticIsSingleFeature(
      raw.engineering.title,
      raw.engineering.description,
    );
    if (!verdict.pass) {
      log.warn('Starter engineering task flagged as bundle by critic — regenerating once', {
        companyId: ctx.companyId,
        title: raw.engineering.title,
        reason: verdict.reason,
      });
      await emitActivity(ctx, 'Engineering task too broad — refining to a single feature', 'llm');
      const fixedRaw = await regenerateWithCriticFeedback(prompt, raw, verdict.reason);
      if (fixedRaw) raw = fixedRaw;
    }
  }

  const result: StarterTasksResult = {
    engineering: ensureSlot(raw.engineering, 'engineering', ctx),
    research: ensureSlot(raw.research, 'research', ctx),
    outreach: ensureSlot(raw.outreach, 'outreach', ctx),
  };

  await persistStarterTasks(ctx, result);
}

// ─────────────────────────────────────────────────────────────
// Critic pass: is the engineering task one feature or a bundle?
// ─────────────────────────────────────────────────────────────

interface CriticVerdict {
  pass: boolean;
  reason: string;
}

async function criticIsSingleFeature(title: string, description: string): Promise<CriticVerdict> {
  const prompt = `You are a strict reviewer. Decide if the engineering task below is exactly ONE user-facing feature, or whether it bundles two or more separate features.

A "bundle" means the task names two or more deliverables that could each ship on their own (e.g. a form AND a list view AND a reminder system; or an entry screen AND an admin dashboard AND an analytics page). Bullets that describe pieces of the SAME ONE feature (data fields, validation, save behavior, the single screen it lives in) are fine — that is one feature.

Title: ${title}
Description: ${description}

Return JSON ONLY in this exact shape:
{"pass": true|false, "reason": "<one sentence — if pass=false, name the separate features the task is bundling>"}

If unsure, prefer pass=false.`;

  try {
    const verdict = await callSmallLLMJson<CriticVerdict>(prompt, {
      maxTokens: 200,
      retryOnce: true,
      rejectPlaceholders: false,
    });
    if (typeof verdict.pass !== 'boolean') return { pass: true, reason: 'critic returned malformed output; accepting' };
    return { pass: verdict.pass, reason: typeof verdict.reason === 'string' ? verdict.reason : '' };
  } catch (err) {
    log.warn('Critic pass failed — accepting original task', { error: err instanceof Error ? err.message : String(err) });
    return { pass: true, reason: 'critic unavailable' };
  }
}

async function regenerateWithCriticFeedback(
  originalPrompt: string,
  previous: Partial<StarterTasksResult>,
  criticReason: string,
): Promise<Partial<StarterTasksResult> | null> {
  const fixPrompt = `${originalPrompt}

PREVIOUS ATTEMPT WAS REJECTED — your engineering task bundled multiple features.

Critic feedback: ${criticReason}

Your previous engineering task:
- title: ${previous.engineering?.title ?? '(missing)'}
- description: ${previous.engineering?.description ?? '(missing)'}

Rewrite ALL THREE tasks. The engineering task must now describe EXACTLY ONE user-facing feature. Pick the single highest-leverage piece from the bundle and drop the rest. The bullets must describe slices of that one feature only (its data fields, the save flow, the screen it lives in) — not separate features.

Return JSON only.`;

  try {
    return await callSmallLLMJson<StarterTasksResult>(fixPrompt, {
      maxTokens: 3000,
      retryOnce: true,
      schema: StarterTasksSchema,
      useBigModel: true,
    });
  } catch (err) {
    log.warn('Critic-feedback regenerate failed — keeping original tasks', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function persistStarterTasks(
  ctx: PipelineContext,
  plannedTasks: Partial<StarterTasksResult>,
): Promise<void> {
  const result: StarterTasksResult = {
    engineering: ensureSlot(plannedTasks.engineering, 'engineering', ctx),
    research: ensureSlot(plannedTasks.research, 'research', ctx),
    outreach: ensureSlot(plannedTasks.outreach, 'outreach', ctx),
  };

  validateTask(result.engineering, 'engineering');
  validateTask(result.research, 'research');
  validateTask(result.outreach, 'outreach');

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
      complexity: clampComplexity(result.engineering.complexity ?? 6),
      estimated_hours: '4',
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
      estimated_hours: '4',
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
      estimated_hours: '4',
      estimated_credits: 1,
      suggestion_reasoning: result.outreach.reasoning || OUTREACH_FALLBACK_REASONING,
      authorized_by: 'system',
      authorization_reason: starterAuthReason,
    }),
  ]);

  await emitActivity(ctx, '3 tasks queued: engineering, research, outreach (each scoped <=4h)', 'task');
}

function clampComplexity(value: unknown): number {
  const n = typeof value === 'number' ? Math.round(value) : 6;
  if (Number.isNaN(n)) return 6;
  if (n < 5) return 5;
  if (n > 9) return 9;
  return n;
}

function normalizeTaskDescription(value: string): string {
  const normalized = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (normalized.length <= 700) return normalized;
  return `${normalized.slice(0, 697).trimEnd()}...`;
}

function normalizeTaskTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 72) return normalized;
  return `${normalized.slice(0, 69).trimEnd()}...`;
}

function ensureSlot(
  task: Partial<StarterTaskShape> | undefined,
  slot: StarterSlot,
  ctx: PipelineContext,
): StarterTaskShape {
  const fallback = buildSlotFallback(slot, ctx);
  const incoming = task ?? {};
  const missing: string[] = [];

  const title = normalizeTaskTitle(incoming.title?.trim() || (missing.push('title'), fallback.title));
  const description = normalizeTaskDescription(
    incoming.description?.trim() || (missing.push('description'), fallback.description),
  );
  const reasoning = incoming.reasoning?.trim() || (missing.push('reasoning'), fallback.reasoning);

  if (missing.length > 0) {
    log.warn(`createStarterTasks: ${slot} slot LLM response missing fields - applied fallback`, {
      companyId: ctx.companyId,
      slot,
      missingFields: missing,
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

function buildSlotFallback(slot: StarterSlot, ctx: PipelineContext): StarterTaskShape {
  const companyName = ctx.companyName || 'your company';
  const isGrow = ctx.journey === 'grow_my_company';
  const isBuild = ctx.journey === 'build_my_idea';
  const inboxLabel = ctx.slug ? `${ctx.slug}@baljia.app` : 'the company inbox';

  const geo = ctx.founderEnrichment?.geo;
  const geoLine = geo?.country
    ? [geo.city, geo.country].filter(Boolean).join(', ')
    : 'audience-matched channels';

  if (slot === 'engineering') {
    const ideaText =
      ctx.refinedIdea?.refined_idea
      ?? ctx.inventedIdea?.invented_idea
      ?? ctx.businessProfile?.description
      ?? ctx.input
      ?? ctx.oneLiner
      ?? '';
    const scope = ideaText ? ideaText.slice(0, 100) : 'the founder core promise';
    return isGrow
      ? {
          title: `Build the ${companyName} growth lever`,
          description:
            `Build one revenue-facing asset for ${companyName}:\n- Help prospects understand the core offer and next buying step\n- Use proof, services, or buyer objections from the existing business\n- Keep it focused on leads, conversion, retention, or referrals\n\nKeep it small enough for one 4-hour run.`,
          reasoning: ENGINEERING_FALLBACK_REASONING,
          complexity: 6,
        }
      : {
          title: `Build the ${companyName} core feature`,
          description:
            `Build one demoable user-facing feature for ${scope}:\n- Show the core action a user would come back for\n- Use seeded data if needed to make the flow feel real\n- Avoid auth, payment, admin settings, or a broad dashboard shell\n\nKeep it to one feature that can run in 4 hours.`,
          reasoning: ENGINEERING_FALLBACK_REASONING,
          complexity: 6,
        };
  }

  if (slot === 'research') {
    const ideaText =
      ctx.refinedIdea?.refined_idea
      ?? ctx.inventedIdea?.invented_idea
      ?? ctx.businessProfile?.description
      ?? ctx.oneLiner
      ?? '';
    const categoryLabel = ideaText
      ? ideaText.slice(0, 60).replace(/[\n\r]+/g, ' ').trim()
      : `${companyName}'s space`;
    return {
      title: `Map the ${categoryLabel} competitive gap`,
      description:
        `Compare 3-5 direct or adjacent alternatives for ${companyName}:\n- Capture target customer, workflow, pricing, and strongest promise\n- Identify the weakest gap or underserved buyer segment\n- Summarize the product or positioning decision this should change`,
      reasoning: RESEARCH_FALLBACK_REASONING,
    };
  }

  if (isGrow) {
    return {
      title: 'Cold outreach: Find 20 prospects who match our ICP',
      description:
        `Identify 20 buyers in the target customer profile using ${geoLine}:\n- Find prospects with visible need, budget signal, or recent activity\n- Send a short personalized email from ${inboxLabel}\n- Track buying signals like pricing questions, timeline, or demo requests`,
      reasoning: OUTREACH_FALLBACK_REASONING,
    };
  }

  if (isBuild) {
    return {
      title: 'User discovery: Find 15 prospects to interview',
      description:
        `Find 15 likely users in ${geoLine} for discovery:\n- Ask what they use today and what feels broken\n- Ask what would make them switch or try a prototype\n- Track specific complaints, workarounds, and willingness to pay`,
      reasoning: OUTREACH_FALLBACK_REASONING,
    };
  }

  return {
    title: 'Validation outreach: Gauge interest from 15 likely users',
    description:
      `Reach 15 likely users in ${geoLine} from ${inboxLabel}:\n- Ask whether the problem resonates with their current workflow\n- Ask what workaround they use today\n- Track expressed pain, launch questions, or willingness to try the idea`,
    reasoning: OUTREACH_FALLBACK_REASONING,
  };
}

function validateTask(
  task: { title: string; description: string; reasoning: string },
  slot: string,
): void {
  if (!task?.title?.trim() || !task.description?.trim()) {
    throw new Error(`createStarterTasks: ${slot} task missing title or description`);
  }

  if (task.description.length > 700) {
    log.warn(
      `[createStarterTasks] ${slot} description ${task.description.length} chars (target <700)`,
      { slot, length: task.description.length, titleSnippet: task.title.slice(0, 80) },
    );
  }

  const jargonPatterns = /\b(openai|cheerio|zod|drizzle|neon|tavily|stripe sdk|webhook handler|api endpoint|database migration)\b/gi;
  const jargonHits = task.description.match(jargonPatterns);
  if (jargonHits && jargonHits.length > 0) {
    log.warn(
      `[createStarterTasks] ${slot} description leaked implementation jargon`,
      { slot, hits: jargonHits, titleSnippet: task.title.slice(0, 80) },
    );
  }
}

const ENGINEERING_FALLBACK_REASONING = 'One sellable feature proves the product promise before the team spends time on a broader app.';
const RESEARCH_FALLBACK_REASONING = 'Specific competitor and workflow evidence sharpens the first feature and the market position.';
const OUTREACH_FALLBACK_REASONING = 'Early conversations test whether real prospects feel the pain before more product work is added.';
