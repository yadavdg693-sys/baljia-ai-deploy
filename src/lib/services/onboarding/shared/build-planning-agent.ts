// Build journey planning agent.
//
// This agent only owns startup direction, market research, and mission.

import { isTavilyAvailable } from '@/lib/tavily';
import { createLogger } from '@/lib/logger';
import { callSmallLLMJson } from './json-mode';
import { BuildPlanningAgentSchema } from './schemas';
import { isSafeUrl, extractMetadata } from './fetch-business-url';
import { trackedTavilySearch } from './tracked-calls';
import { appendMemorySection } from './memory-sections';
import { saveOnboardingBrief } from './onboarding-brief';
import { compactLine, compactParagraphs, stripInlineMarkdown } from './founder-doc-style';
import { emitActivity, recordOnboardingIssue } from '../stage-runner';
import type {
  BuildMarketResearch,
  MissionDoc,
  PipelineContext,
  RefinedIdea,
} from '../types';

const log = createLogger('BuildPlanningAgent');
const URL_FETCH_TIMEOUT_MS = 10_000;
const URL_REGEX = /\b(?:(?:https?:\/\/)|(?=[a-z0-9-]+\.[a-z]{2,}))((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/i;

export interface BuildPlanningArtifacts {
  refined_idea: RefinedIdea;
  market_research: BuildMarketResearch;
  mission_doc: MissionDoc;
}

function fallbackBuildPlanningArtifacts(ctx: PipelineContext, rawIdea: string): BuildPlanningArtifacts {
  const idea = rawIdea.slice(0, 240) || 'the founder idea';
  return BuildPlanningAgentSchema.parse({
    refined_idea: {
      refined_idea: idea,
      changes_made: 'The founder idea was preserved and converted into a practical first company direction.',
      rationale: 'The safest next step is to validate the customer, problem, and first useful workflow.',
    },
    market_research: {
      overview: `${idea}\n\nThis direction needs founder-facing validation around the target customer, the painful workflow, and the smallest useful first version. The first report is intentionally cautious because external research or model output was unavailable during onboarding.`,
      market_validation: '**The idea needs direct customer validation.**\n- The founder has a clear direction to test.\n- The first useful workflow should be narrowed before building too much.\n- Competitor and substitute research should focus on what customers already use today.\n\nWhy now: The company can move quickly by proving demand before expanding the product scope.',
      competitors: [{
        name: 'Current alternatives',
        what_they_do: 'Customers likely use manual work, spreadsheets, generic tools, agencies, freelancers, or internal processes.',
        pricing: 'Pricing varies or was not clear from available research.',
        gap: 'A focused first offer can be easier to understand and adopt.',
      }],
      opportunity: 'The opportunity is to choose one customer segment, one painful workflow, and one outcome that can be built and validated quickly.',
      market_positioning: '**The strongest angle is a focused first workflow.**\n- Make the target customer obvious.\n- Make the promised outcome specific.\n- Avoid broad platform language until customers prove the wedge.',
      why_this_fits_you: ctx.founderAngle || 'This direction fits because it keeps the founder input intact while turning it into something testable.',
      first_priorities: undefined,
    },
    mission_doc: {
      mission: 'Help the target customer solve the core problem with less friction.',
      what_were_building: `We are building the smallest useful version of ${idea}. The first version should focus on one customer, one workflow, and one outcome that can be validated.`,
      where_were_headed: 'The company should earn trust by solving one painful problem clearly. Early customer conversations should shape the product before it expands. Once the first workflow works, the company can add deeper features around real usage. The goal is a company that grows from evidence, not assumptions.',
    },
  }) as BuildPlanningArtifacts;
}

function detectUrl(input: string): string | null {
  const match = input.match(URL_REGEX);
  if (!match) return null;
  return match[0].trim().replace(/[.,;:!?)]+$/, '');
}

async function fetchUrlContext(rawUrl: string): Promise<string | null> {
  const safe = isSafeUrl(rawUrl);
  if (!safe.ok || !safe.normalized) {
    log.warn('planning: URL rejected by SSRF check', { rawUrl, reason: safe.reason });
    return null;
  }

  try {
    const res = await fetch(safe.normalized, {
      signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Baljia-Onboarding/1.0 (+https://baljia.ai)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      log.warn('planning: URL fetch non-OK', { url: safe.normalized, status: res.status });
      return null;
    }

    const html = await res.text();
    const metadata = extractMetadata(html);
    return [
      `Reference site: ${safe.normalized}`,
      metadata.title ? `Title: ${metadata.title}` : null,
      metadata.meta ? `Meta: ${metadata.meta}` : null,
      metadata.body ? `Body excerpt: ${metadata.body.slice(0, 1500)}` : null,
    ].filter(Boolean).join('\n');
  } catch (err) {
    log.warn('planning: URL fetch failed', {
      rawUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function gatherBuildResearch(ctx: PipelineContext, rawIdea: string): Promise<string> {
  if (!isTavilyAvailable()) {
    throw new Error('Build planning requires Tavily - not configured');
  }

  const detectedUrl = detectUrl(rawIdea);
  if (detectedUrl) {
    await emitActivity(ctx, `Detected reference URL: ${detectedUrl}`, 'http_fetch');
  }

  const scoutQuery = `${rawIdea.slice(0, 200)} existing products tools alternatives`;
  const queries = [
    scoutQuery,
    `${rawIdea} competitors features pricing 2026`,
    `${rawIdea} market size growth rate 2025 2026`,
    `${rawIdea} reviews complaints what customers dislike`,
  ];

  for (const query of queries) {
    await emitActivity(ctx, `Searching: "${query.slice(0, 90)}"`, 'tavily_search');
  }

  const [urlContext, scoutRaw, competitorRaw, marketRaw, reviewRaw] = await Promise.all([
    detectedUrl ? fetchUrlContext(detectedUrl) : Promise.resolve(null),
    trackedTavilySearch(queries[0], 6, 'advanced'),
    trackedTavilySearch(queries[1], 5, 'advanced'),
    trackedTavilySearch(queries[2], 4),
    trackedTavilySearch(queries[3], 4),
  ]);

  const rawParts = [
    urlContext ? `REFERENCE URL CONTEXT\n${urlContext}` : null,
    scoutRaw ? `SPACE SCOUT\n${scoutRaw}` : null,
    competitorRaw ? `COMPETITOR RESULTS\n${competitorRaw}` : null,
    marketRaw ? `MARKET SIZE RESULTS\n${marketRaw}` : null,
    reviewRaw ? `DEMAND / REVIEW RESULTS\n${reviewRaw}` : null,
  ].filter(Boolean);

  if (rawParts.length === 0) {
    throw new Error('Build planning: Tavily and URL fetch returned zero usable context');
  }

  const queryBlock = [
    'TAVILY SEARCHES ALREADY RUN',
    ...queries.map((query) => `- ${query}`),
  ].join('\n');

  return [queryBlock, ...rawParts].join('\n\n---\n\n').slice(0, 8000);
}

export async function runBuildPlanningAgent(ctx: PipelineContext): Promise<BuildPlanningArtifacts> {
  let rawIdea = ctx.input?.trim() || '';
  if (!rawIdea) {
    rawIdea = 'a new business idea that needs a clear first customer and workflow';
    await recordOnboardingIssue(ctx, {
      stage: 'refine_idea',
      kind: 'missing_build_idea_fallback',
      severity: 'high',
      message: 'Build onboarding did not receive founder idea text, so planning used a generic validation-first fallback idea.',
      fallbackUsed: true,
    });
  }
  const geo = ctx.founderEnrichment?.geo;
  const locationLine = geo?.country
    ? `Founder location: ${[geo.city, geo.country].filter(Boolean).join(', ')}. Use this only where it genuinely matters.`
    : 'Founder location unknown. Do not invent a city or country.';

  await emitActivity(ctx, 'Planning the company: idea, market research, and mission', 'llm');
  let rawResearch: string;
  try {
    rawResearch = await gatherBuildResearch(ctx, rawIdea);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('Build planning research unavailable - continuing cautiously', { companyId: ctx.companyId, error });
    await recordOnboardingIssue(ctx, {
      stage: 'refine_idea',
      kind: 'planning_research_fallback',
      severity: 'medium',
      error,
      message: 'Build planning research was unavailable, so onboarding continued with cautious fallback context.',
      fallbackUsed: true,
    });
    rawResearch = 'External research was unavailable. Write cautiously, avoid unsupported claims, and focus on validation priorities.';
  }

  const prompt = `You are Baljia's Build My Idea research and mission agent.

Your job is to understand the founder's idea and produce:
1. a clearer startup direction,
2. practical market research,
3. a mission document.

You only know the founder's idea, founder context, founder location, and research context provided below. Do not assume anything outside that context.

Founder raw idea:
"${rawIdea}"

Founder location:
${locationLine}

Founder context:
${ctx.founderAngle || 'No founder-specific context available. Do not invent personal facts.'}

Research context:
${rawResearch}

How to think:
- Start from the founder's actual idea, not from a generic category.
- ★ "Build like X" defaults to CLONE intent, not differentiated-competitor intent. When the founder references an existing company, product, or website (e.g. "I want to build something like X", "platform like multibagg.ai"), the default refinement is to PRESERVE THE SAME PRODUCT — same audience, same value prop, same feature set as X. Do NOT pre-decide a differentiation angle ("serve the markets X doesn't cover", "better than X at Y", "X-style but for a different region") unless the founder's input explicitly asks for it. If they paste features or capabilities from X, those are the features they want — keep them in the refined_idea verbatim in spirit. Use research and market_positioning sections to surface the competitive landscape — but the refined_idea itself stays close to what they asked for.
- Clarify the idea without changing its core direction or pre-introducing competitive differentiation.
- Use research context to identify the market, competitors, demand signals, and positioning gap. Reference companies (the "like X" target) belong in the competitor table.
- Use founder context only when it is actually available and relevant.
- Do not invent founder background, traction, market numbers, competitors, pricing, or customer behavior.
- If evidence is weak, write carefully instead of pretending certainty.
- Make the output useful for a founder deciding what company they are building.
- Write in clear, direct language. Avoid generic startup fluff.

Founder dashboard style:
- The saved market research and mission must be crisp, pointwise, and easy to scan.
- Use short sections, bold lead lines, bullets, and table-ready competitor rows.
- Lists should have 3-5 bullets max.
- Each bullet should be one concrete point, 1-2 short lines max.
- Overview and mission sections may use short paragraphs, but no dense consulting memo paragraphs.
- Tables must use short cells, not paragraph cells.
- Do not create long AI leverage menus, long first-priority explanations, or generic filler.

Return JSON only. The JSON object must include these top-level keys:
- refined_idea
- market_research
- mission_doc

Field rules:
- refined_idea.refined_idea: string. One sentence describing the clarified startup direction.
- refined_idea.changes_made: string. One sentence describing what was clarified from the raw idea.
- refined_idea.rationale: string. One sentence explaining why this direction is coherent.
- market_research.overview: string. 2 short paragraphs max explaining the idea, product category, target customer, and core problem.
- market_research.market_validation: string. Founder-facing Markdown. Start with one bold summary sentence, then 3-5 short bullet demand signals, then one short "Why now:" line when research supports it.
- market_research.competitors: array with at least one object.
- Each competitor object needs name, what_they_do, pricing, and gap as strings.
- Competitor name must be a real competitor, incumbent, substitute behavior, or adjacent tool supported by research.
- Competitor pricing should use real pricing when surfaced. If pricing is not surfaced, write a short plain-language uncertainty sentence.
- market_research.opportunity: string. 1-2 short sentences explaining the whitespace, underserved customer, and positioning opportunity.
- market_research.market_positioning: string. Founder-facing Markdown. Start with one bold angle line, then 3-5 concrete customer pains or buying reasons, then one short positioning paragraph.
- market_research.why_this_fits_you: string. 1 short paragraph, max 2 sentences, using founder context when available; otherwise explain idea-market fit.
- market_research.first_priorities: array of exactly 3 concise priority sentences covering the first build, research, and outreach priorities.
- mission_doc.mission: string. Exactly one sentence, short, sharp, and specific.
- mission_doc.what_were_building: string. 2 concrete sentences describing the product, audience, and mechanism.
- mission_doc.where_were_headed: string. 3-4 vivid but grounded short sentences describing the future state for the target users.

Rules:
- Preserve the founder's actual direction.
- Do not turn an example product or reference website into a different idea.
- Do not invent facts.
- Use specific competitors when research supports them.
- If direct competitors are unclear, use adjacent tools, incumbent workflows, agencies, freelancers, spreadsheets, email, or manual work as substitutes.
- Market validation should include demand signals and why now, but only when supported by the research context.
- Do not use generic phrases like "revolutionize", "cutting-edge", "empower", "synergy", or "world-class".
- Mission should not be generic startup copy.
- What we're building should describe product mechanics, not repeat the mission.
- Where we're headed should match the idea's actual scale.`;

  let artifacts: BuildPlanningArtifacts;
  try {
    artifacts = await callSmallLLMJson<BuildPlanningArtifacts>(prompt, {
      maxTokens: 4200,
      retryOnce: true,
      schema: BuildPlanningAgentSchema,
      sanitizeFields: [],
      sanitizeArrayOfObjects: ['competitors'],
      useBigModel: true,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error('Build planning LLM failed - using deterministic fallback artifacts', { companyId: ctx.companyId, error });
    await recordOnboardingIssue(ctx, {
      stage: 'refine_idea',
      kind: 'planning_llm_fallback',
      severity: 'high',
      error,
      message: 'Build planning model output failed, so onboarding used deterministic market research and mission fallbacks.',
      fallbackUsed: true,
    });
    artifacts = fallbackBuildPlanningArtifacts(ctx, rawIdea);
  }

  // Trust the LLM-imposed contract from the prompt + JSON schema. Don't
  // char-slice here — that produced "...before writing..." fragments.
  // Strip inline-markdown artifacts so **bold** and *italic* don't leak
  // as literal characters into one-liners and other plain-text contexts.
  const refinedIdeaClean = stripInlineMarkdown(artifacts.refined_idea.refined_idea);
  const changesMadeClean = stripInlineMarkdown(artifacts.refined_idea.changes_made);
  const rationaleClean = stripInlineMarkdown(artifacts.refined_idea.rationale);
  if (refinedIdeaClean.length > 600 || changesMadeClean.length > 500 || rationaleClean.length > 500) {
    await recordOnboardingIssue(ctx, {
      stage: 'refine_idea',
      kind: 'refined_idea_overlong_field',
      severity: 'low',
      message: `refined_idea fields exceeded soft limits (refined_idea=${refinedIdeaClean.length}, changes_made=${changesMadeClean.length}, rationale=${rationaleClean.length}). Tighten the prompt instead of truncating.`,
    });
  }
  ctx.refinedIdea = {
    refined_idea: refinedIdeaClean,
    changes_made: changesMadeClean,
    rationale: rationaleClean,
  };
  ctx.strategy = ctx.refinedIdea.refined_idea;
  ctx.missionDoc = {
    mission: stripInlineMarkdown(compactLine(artifacts.mission_doc.mission, 220, 1)),
    what_were_building: stripInlineMarkdown(compactParagraphs(artifacts.mission_doc.what_were_building, 1, 430, 2)),
    where_were_headed: stripInlineMarkdown(compactParagraphs(artifacts.mission_doc.where_were_headed, 1, 620, 4)),
  };
  ctx.mission = ctx.missionDoc.mission;
  // Use the FULL first sentence as the one-liner. The first sentence is
  // already bounded by its period — capping at 18 words produced mid-clause
  // fragments like "...answers covering" that read as broken UI.
  const firstMissionSentence = ctx.missionDoc.what_were_building.split(/[.!?]/)[0].trim();
  ctx.oneLiner = stripInlineMarkdown(firstMissionSentence);

  await emitActivity(ctx, `Refined: "${ctx.refinedIdea.refined_idea.slice(0, 100)}"`, 'llm');
  await appendMemorySection(ctx.companyId, '## Idea (Refined)', [
    `Original input: ${rawIdea.slice(0, 200)}`,
    `Refined: ${ctx.refinedIdea.refined_idea}`,
    `Changes: ${ctx.refinedIdea.changes_made}`,
    `Rationale: ${ctx.refinedIdea.rationale}`,
    'Planning mode: research and mission only.',
  ]);
  await saveOnboardingBrief(ctx);

  return artifacts;
}
