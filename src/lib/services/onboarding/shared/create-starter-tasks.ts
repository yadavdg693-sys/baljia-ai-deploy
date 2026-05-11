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
import { stripInlineMarkdown } from './founder-doc-style';
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

  Adapt Input/Output/Core flow content to what THIS specific product actually does. The slots are fixed; the wording inside must be derived from the company's refined_idea, market_research (especially competitors and overview), and mission_doc — NEVER copied from a template. Different companies must produce different Input/Output/Core flow content, even if their categories are similar.

  Derivation method (apply for ANY application — works regardless of vertical or industry):
    1. Input  = What does THIS product's user provide to start the feature? Read the refined_idea + mission_doc to identify the actual triggering data, file, profile, query, or action.
    2. Output = What does THIS product's user receive when the feature succeeds? Read the mission's "what we're building" to identify the actual deliverable artifact, match, transaction, or state change the founder promised.
    3. Core flow = The 4-7 discrete steps THIS specific system performs between Input and Output, joined with → arrows. Use the product's actual domain language (verbs and nouns from the refined_idea and market_research overview). Avoid generic verbs like "process", "handle", "manage".
    4. Tech line = "Use Express.js + PostgreSQL. Store <primary entity from THIS product> in the database." Replace <primary entity> with the actual noun this product stores (the thing the founder is building around).

  Hard rules for content derivation:
    - Pull entity names, user roles, and verbs from refined_idea + market_research + mission_doc — do NOT invent generic SaaS jargon.
    - Two different companies in the same category must produce DIFFERENT Input/Output/Core flow content (because their actual products differ).
    - If you can't articulate concrete Input/Output/Core flow from the provided context, use the fallback below instead of producing vague slot-fills.

  Broad shape anchors (use ONLY to identify roughly what kind of Input/Output/Core flow makes sense — the actual content must still come from THIS company's refined_idea + market_research, never from these anchors):

    - Content-generation (book/blog/video/deck/copy)         — Input: a brief; Output: a generated artifact; Flow: intake → generate → review → export
    - Sales / outreach / CRM                                  — Input: a target list; Output: replies or meetings; Flow: import → personalize → send → track → reply
    - Client / SMB management                                 — Input: client profile + assets; Output: approved deliverable; Flow: onboard → draft → review → schedule
    - Marketplace / matching                                  — Input: listing or seeker profile; Output: matched connection; Flow: profile → match → message → book
    - Internal tool / data app                                — Input: data import or form; Output: filtered view or report; Flow: ingest → store → query → display
    - Education / training                                    — Input: learner goal; Output: progress + recommendation; Flow: enroll → deliver → assess → recommend
    - Health / fitness / wellness                             — Input: log entry vs goal; Output: trend insight; Flow: log → analyze → display → suggest
    - Finance / budgeting / investment                        — Input: account or transaction; Output: insight or alert; Flow: import → categorize → analyze → report
    - Booking / appointment / scheduling                      — Input: service + slot + customer; Output: confirmed booking; Flow: select → book → pay → notify
    - Community / discussion / Q&A                            — Input: post or question; Output: ranked feed + replies; Flow: post → tag → rank → notify
    - Productivity / task / project                           — Input: item to track; Output: state visible to team; Flow: create → assign → update → display
    - Subscription / e-commerce / digital storefront          — Input: product + payment; Output: order + delivery; Flow: browse → cart → pay → fulfil

  These are SHAPE anchors only. The actual nouns (what the user provides), the actual verbs (what the system does), and the actual entities (what gets stored) must all be derived from THIS company's refined_idea, market_research, and mission_doc.

  Fallback (use ONLY when the context is too thin to articulate concrete Input/Output/Core flow):
    Line 1: One opening sentence ≤ 14 words ending with ":". Names the ONE feature.
    Line 2: blank
    Line 3-5: 2 to 3 bullet lines using "- " (bullets allowed ONLY in fallback). Each bullet ≤ 16 words. ONE concrete piece of the feature per bullet (a data field set, a save flow, a screen, a visible state). NO prose, NO compound sentences with "and... and...".
    Line 6 (optional): ONE closing scope/tech sentence ≤ 14 words. Skip if not needed.

    Total length target: ~250 characters. Hard cap: 350 characters. Anything longer = cut something.

    NEVER: markdown headings, numbered lists, dense paragraphs, vague verbs ("manage", "handle", "process").

  Use the fallback as a last resort, not as a default. If the refined_idea + market_research give you enough signal to articulate specific Input/Output/Core flow, ALWAYS prefer the primary shape. The fallback exists only when forcing the Input/Output/Core flow shape would produce vague slot-fills.

  Shape template (DO NOT fill these placeholders with generic words — derive every angle-bracketed value from THIS company's context):
    "Build the MVP <one-feature noun derived from THIS product's mission>:

    Input: <what THIS product's user provides — pull noun + qualifiers from refined_idea>
    Output: <what THIS product's user receives — pull from mission's what-we're-building>
    Core flow: <step in this product's domain> → <step> → <step> → <step> → <step>
    Use Express.js + PostgreSQL. Store <primary entity for THIS product> in the database."

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
- research.description: string, max 700 characters. Must follow this EXACT crisp shape — no variations:

    Line 1: Opening sentence stating the research scope (what kind of analysis, how many targets), ending with ":".
    Line 2: blank
    Line 3: Comma-separated list of 3-5 specific NAMED targets. Pull these FROM THE PROVIDED CONTEXT — the market_research.competitors array already lists real competitors; otherwise use specific names found in the refined idea or market context. Targets are real company names, real customer segments, real pricing pages, or real communities — never generic labels.
    Line 4: "For each:" or "Document:" + 4-6 concrete data points to capture per target, comma-separated. Pick fields that make sense for the kind of target (e.g. for SaaS competitors: pricing tiers, key features, positioning, weakness; for service providers: packages, onboarding, platforms served; for customer segments: pain point, current workaround, willingness to pay, decision-maker).
    Line 5: "Identify <this company's name>'s <gap, differentiation angle, or strategic insight>" — names the strategic question this research answers, in the company's specific positioning language. Use the actual company name from the context, not a placeholder.
    Line 6 (optional): One short closing sentence describing the deliverable format (e.g. comparison report, positioning recommendation, customer profile doc).

  Hard rules:
    - Line 3 MUST list 3-5 specific real names DERIVED FROM THE CONTEXT (market_research.competitors, refined_idea references, named entities in the research_context). NEVER use placeholders like "top 5 competitors" or "leading agencies". If the context doesn't surface specific names, instruct what KIND of names to find ("5 directly comparable workflow tools that target small accounting firms") rather than inventing them.
    - Line 4 MUST be 4-6 concrete data points appropriate to the target type, not vague verbs like "research" or "analyze".
    - Line 5 MUST use the actual company name from the context and state the gap/angle in the company's specific positioning — derived from the refined idea + market research, not a generic frame.
    - NEVER use "- " bullet markers, markdown headings, numbered lists, or dense paragraphs.
    - NEVER write "do market research", "research competitors", "study the space" — must be specific.
    - Use plain language. No filler like "deep-dive into the landscape", "comprehensive analysis", "thorough understanding".

  Pick the right kind of research target for the company shape (SOFTWARE → competitor SaaS products; SERVICE BUSINESS → competing agencies/consultancies; MARKETPLACE → both market sides; LOCAL → competing local providers; CUSTOMER-VALIDATION → named segments or prospect personas). All target names and fields must come from the provided context, not invented.
- research.reasoning: string, max 260 characters. Explain why this reduces risk.
- outreach.title: string, max 72 characters.
- outreach.description: string, max 700 characters. Must follow this EXACT crisp shape — no variations:

    Line 1: Opening sentence stating the outreach scope (count + audience description), ending with ":". Action-oriented and specific to THIS company's audience. Pull the audience descriptor from refined_idea + market_research, never generic ("potential customers", "early adopters").
    Line 2: blank
    Line 3: Where to find them — specific channels appropriate to the audience (e.g. LinkedIn for B2B, Twitter/X for creators and indie founders, niche forums or communities for technical or vertical audiences, local listings for local businesses). Pick channels that match where THIS audience actually is.
    Line 4: Who specifically to target — concrete qualifying signals (industry + role + behavior, OR profession + experience-level + pain signal, OR business-type + geography + visible problem). Make it specific enough that the agent can recognize a qualified target.
    Line 5: What to send — short description of the message (e.g. "brief, personalized cold emails introducing <product>'s value prop" or "DM with a one-line value statement and ask one question"). Reference the actual product or angle from mission_doc.
    Line 6 (optional): The angle, hook, or goal — ONE short sentence. Can be a quoted message angle (e.g. "What if your next book took hours instead of months?"), or a goal statement (e.g. "validate willingness to pay"). Pull from the company's positioning + mission.

  Hard rules:
    - Count must be small (5-15 contacts) so the campaign fits a 4-hour run.
    - Audience descriptor MUST come from refined_idea + market_research — never generic "early users" or "potential customers".
    - Channels MUST match where this specific audience lives (don't default to "LinkedIn" if the audience is on Twitter/forums/local listings).
    - Targeting criteria MUST include concrete qualifying signals, not vague "interested founders" or "active users".
    - The hook/angle line MUST be specific to THIS company's positioning — if quoted, it should be a real one-line value statement the founder could actually send.
    - NEVER use "- " bullet markers, markdown headings, numbered lists, or dense paragraphs.
    - Use plain language. No filler ("comprehensive outreach campaign", "robust pipeline", "strategic engagement").
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

/**
 * Auto-format the locked task shapes onto separate lines. The LLM frequently
 * emits the full task description on a single line with the labels inline
 * (e.g. "Build the MVP X: Input: ... Output: ... Core flow: ... Use ...").
 * Detect the known labels and split them so the description renders as
 * structured lines, not a wall of paragraph text.
 */
function applyTaskShapeLineBreaks(s: string): string {
  let out = s;
  // Engineering shape: Build the MVP X: \n\n Input: ... \n Output: ... \n Core flow: ... \n Use ...
  out = out.replace(/\s+Input:\s+/g, '\n\nInput: ');
  out = out.replace(/\s+Output:\s+/g, '\nOutput: ');
  out = out.replace(/\s+Core flow:\s+/g, '\nCore flow: ');
  // Tech-stack closing line — usually starts with "Use Express", "Use Next.js"
  // etc. Insert a newline when preceded by sentence-ending punctuation.
  out = out.replace(/([.!?])\s+Use\s+/g, '$1\nUse ');

  // Research shape: opening: \n\n <targets> \n For each: ... / Document: ... \n Identify <co>'s ...
  out = out.replace(/\s+For each:\s+/g, '\nFor each: ');
  out = out.replace(/\s+Document:\s+/g, '\nDocument: ');
  out = out.replace(/([.!?])\s+Identify\s+/g, '$1\nIdentify ');

  // Outreach shape: opening line ending with ":" then 3-5 sentences each
  // starting with a verb (Find / Identify / Target / Send / Focus / Goal /
  // Reach / Search / Track). The LLM doesn't emit labels for this shape,
  // so split on those verb-starts when they follow a period or colon.
  out = out.replace(/([.!?:])\s+(Find|Identify|Target|Send|Focus|Goal|Reach|Search|Track)\b/g, '$1\n$2');

  return out;
}

function normalizeTaskDescription(value: string): string {
  // Whitespace-normalize + strip inline-markdown artifacts + auto-format
  // the locked task shapes onto separate lines.
  const withBreaks = applyTaskShapeLineBreaks(value.replace(/\r\n/g, '\n'));
  const normalized = withBreaks
    .split('\n')
    .map((line) => stripInlineMarkdown(line))
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0)) // collapse multi-blank
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (normalized.length > 1200) {
    log.warn('Task description exceeds soft limit (prompt should be tightened)', { chars: normalized.length });
  }
  return normalized;
}

function normalizeTaskTitle(value: string): string {
  // Whitespace + markdown-artifact strip. Title is plain text in cards.
  const normalized = stripInlineMarkdown(value.replace(/\s+/g, ' ').trim());
  if (normalized.length > 120) {
    log.warn('Task title exceeds soft limit (prompt should be tightened)', { chars: normalized.length, title: normalized.slice(0, 50) });
  }
  return normalized;
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
