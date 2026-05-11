// Surprise journey planning agent.
//
// Runs after invent_idea. It validates the invented idea, writes market
// research in the same clean Build format, and produces the mission.

import { isTavilyAvailable } from '@/lib/tavily';
import { createLogger } from '@/lib/logger';
import { callSmallLLMJson } from './json-mode';
import { SurprisePlanningAgentSchema } from './schemas';
import { trackedTavilySearch } from './tracked-calls';
import { appendMemorySection } from './memory-sections';
import { saveOnboardingBrief } from './onboarding-brief';
import { compactLine, compactParagraphs, stripInlineMarkdown } from './founder-doc-style';
import { emitActivity, recordOnboardingIssue } from '../stage-runner';
import type {
  BuildMarketResearch,
  InventedIdea,
  MissionDoc,
  PipelineContext,
} from '../types';

const log = createLogger('SurprisePlanningAgent');

export interface SurprisePlanningArtifacts {
  invented_idea: InventedIdea;
  market_research: BuildMarketResearch;
  mission_doc: MissionDoc;
}

function fallbackSurprisePlanningArtifacts(ctx: PipelineContext, inventedIdea: string): SurprisePlanningArtifacts {
  const idea = inventedIdea.slice(0, 240) || 'a focused invented business idea';
  return SurprisePlanningAgentSchema.parse({
    invented_idea: {
      invented_idea: idea,
      changes_made: 'The invented idea was preserved and narrowed into a validation-first direction.',
      rationale: 'The safest next step is to test whether the target customer has the problem and wants this outcome.',
    },
    market_research: {
      overview: `${idea}\n\nThis invented direction should be treated as a hypothesis. The first onboarding report stays cautious because external research or model output was unavailable during planning.`,
      market_validation: '**This invented idea needs validation before scale.**\n- The customer segment should be tested directly.\n- The problem should be confirmed through conversations or public demand signals.\n- The first product should prove one workflow before expanding.\n\nWhy now: The next step is fast evidence, not broad claims.',
      competitors: [{
        name: 'Current alternatives',
        what_they_do: 'Customers likely use manual work, generic tools, service providers, or internal processes.',
        pricing: 'Pricing varies or was not clear from available research.',
        gap: 'A focused first offer can be easier to try than broad alternatives.',
      }],
      opportunity: 'The opportunity is to validate whether this invented idea maps to a real, urgent customer problem.',
      market_positioning: '**The strongest angle is a testable wedge.**\n- Pick a narrow customer.\n- Solve one painful workflow.\n- Use outreach to decide whether to keep, sharpen, or abandon the idea.',
      why_this_fits_you: ctx.founderAngle || 'This direction may fit if early customer evidence confirms the pain and buying intent.',
      first_priorities: undefined,
    },
    mission_doc: {
      one_liner: 'A focused product for a clearly defined customer.',
      mission: 'Turn a promising hypothesis into a company customers can actually validate.',
      what_were_building: `We are testing the smallest useful version of ${idea}. The first version should make the customer, workflow, and outcome clear enough for real feedback.`,
      where_were_headed: 'The company should only grow after the idea earns evidence. Early work should reveal whether customers feel the pain, understand the offer, and want the first workflow. If the signal is strong, the product can expand from a narrow wedge. If the signal is weak, the founder can pivot early with minimal waste.',
    },
  }) as SurprisePlanningArtifacts;
}

async function gatherSurpriseResearch(ctx: PipelineContext, idea: string): Promise<string> {
  if (!isTavilyAvailable()) {
    throw new Error('Surprise planning requires Tavily - not configured');
  }

  const queries = [
    `${idea} competitors features pricing 2026`,
    `${idea} market size growth funding why now 2025 2026`,
    `${idea} reviews complaints what customers want`,
    `${idea} forum complaints alternatives customer pain`,
  ];

  for (const query of queries) {
    await emitActivity(ctx, `Searching: "${query.slice(0, 90)}"`, 'tavily_search');
  }

  const [competitorRaw, marketRaw, reviewRaw, painRaw] = await Promise.all([
    trackedTavilySearch(queries[0], 5, 'advanced'),
    trackedTavilySearch(queries[1], 4),
    trackedTavilySearch(queries[2], 4),
    trackedTavilySearch(queries[3], 4),
  ]);

  const rawParts = [
    competitorRaw ? `COMPETITOR RESULTS\n${competitorRaw}` : null,
    marketRaw ? `MARKET / WHY NOW RESULTS\n${marketRaw}` : null,
    reviewRaw ? `REVIEW / DEMAND RESULTS\n${reviewRaw}` : null,
    painRaw ? `FORUM / PAIN RESULTS\n${painRaw}` : null,
  ].filter(Boolean);

  if (rawParts.length === 0) {
    throw new Error('Surprise planning: Tavily returned zero usable context');
  }

  const queryBlock = [
    'TAVILY SEARCHES ALREADY RUN',
    ...queries.map((query) => `- ${query}`),
  ].join('\n');

  return [queryBlock, ...rawParts].join('\n\n---\n\n').slice(0, 8000);
}

export async function runSurprisePlanningAgent(ctx: PipelineContext): Promise<SurprisePlanningArtifacts> {
  if (!ctx.inventedIdea?.invented_idea?.trim()) {
    await recordOnboardingIssue(ctx, {
      stage: 'refine_idea',
      kind: 'missing_invented_idea_fallback',
      severity: 'high',
      message: 'Surprise planning did not receive an invented idea, so it used a deterministic fallback planning artifact.',
      fallbackUsed: true,
    });
    const artifacts = fallbackSurprisePlanningArtifacts(ctx, 'a focused invented business idea');
    ctx.inventedIdea = {
      invented_idea: artifacts.invented_idea.invented_idea.trim().slice(0, 300),
      changes_made: artifacts.invented_idea.changes_made.trim().slice(0, 250),
      rationale: artifacts.invented_idea.rationale.trim().slice(0, 250),
    };
    ctx.strategy = ctx.inventedIdea.invented_idea;
    ctx.missionDoc = {
      one_liner: stripInlineMarkdown(compactLine(artifacts.mission_doc.one_liner ?? '', 120, 1)),
      mission: stripInlineMarkdown(compactLine(artifacts.mission_doc.mission, 220, 1)),
      what_were_building: stripInlineMarkdown(compactParagraphs(artifacts.mission_doc.what_were_building, 1, 430, 2)),
      where_were_headed: stripInlineMarkdown(compactParagraphs(artifacts.mission_doc.where_were_headed, 1, 620, 4)),
    };
    ctx.mission = ctx.missionDoc.mission;
    ctx.oneLiner = ctx.missionDoc.one_liner || ctx.missionDoc.mission;
    return artifacts;
  }

  const inventedIdea = ctx.inventedIdea.invented_idea.trim();
  const geo = ctx.founderEnrichment?.geo;
  const locationLine = geo?.country
    ? `Founder location: ${[geo.city, geo.country].filter(Boolean).join(', ')}. Use this only where it genuinely matters.`
    : 'Founder location unknown. Do not invent a city or country.';

  await emitActivity(ctx, 'Planning invented company: market research and mission', 'llm');
  let rawResearch: string;
  try {
    rawResearch = await gatherSurpriseResearch(ctx, inventedIdea);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('Surprise planning research unavailable - continuing cautiously', { companyId: ctx.companyId, error });
    await recordOnboardingIssue(ctx, {
      stage: 'refine_idea',
      kind: 'planning_research_fallback',
      severity: 'medium',
      error,
      message: 'Surprise planning research was unavailable, so onboarding continued with cautious fallback context.',
      fallbackUsed: true,
    });
    rawResearch = 'External research was unavailable. Write cautiously, avoid unsupported claims, and frame the idea as a hypothesis to validate.';
  }

  const prompt = `You are Baljia's Surprise Me research and mission agent.

The idea below was invented by Baljia for the founder. Your job is to validate and sharpen it, not cheerlead it.

Produce:
1. a clearer invented startup direction,
2. practical market research,
3. a mission document.

You only know the invented idea, founder context, founder location, and research context provided below. Do not assume anything outside that context.

Invented idea:
"${inventedIdea}"

How the idea was chosen:
${ctx.inventedIdea.changes_made || '(not available)'}

Initial rationale:
${ctx.inventedIdea.rationale || '(not available)'}

Founder location:
${locationLine}

Founder context:
${ctx.founderAngle || ctx.enrichedFounderSummary || 'No founder-specific context available. Do not invent personal facts.'}

Research context:
${rawResearch}

How to think:
- Treat this as an invented idea that still needs validation.
- Preserve the invented idea's core direction unless research shows it is too vague or incoherent.
- Clarify the target customer, workflow, and positioning without turning it into a different business.
- Use research context to identify the market, competitors, demand signals, and positioning gap.
- Use founder context only when it is actually available and relevant.
- Do not invent founder background, traction, market numbers, competitors, pricing, or customer behavior.
- If evidence is weak, write carefully instead of pretending certainty.
- Make the output useful for a founder deciding whether this invented idea is worth pursuing.
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
- invented_idea
- market_research
- mission_doc

Field rules:
- invented_idea.invented_idea: string. One sentence describing the clarified invented startup direction.
- invented_idea.changes_made: string. One sentence describing what was clarified from the original invented idea.
- invented_idea.rationale: string. One sentence explaining why this direction may fit the founder and market.
- market_research.overview: string. 2 short paragraphs max explaining the idea, product category, target customer, and core problem.
- market_research.market_validation: string. Founder-facing Markdown. Start with one bold summary sentence, then 3-5 short bullet demand signals, then one short "Why now:" line when research supports it.
- market_research.competitors: array with at least one object.
- Each competitor object needs name, what_they_do, pricing, and gap as strings.
- Competitor name must be a real competitor, incumbent, substitute behavior, or adjacent tool supported by research.
- Competitor pricing should use real pricing when surfaced. If pricing is not surfaced, write a short plain-language uncertainty sentence.
- market_research.opportunity: string. 1-2 short sentences explaining the whitespace, underserved customer, and positioning opportunity.
- market_research.market_positioning: string. Founder-facing Markdown. Start with one bold angle line, then 3-5 concrete customer pains or buying reasons, then one short positioning paragraph.
- market_research.why_this_fits_you: string. 1 short paragraph, max 2 sentences, using founder context when available; otherwise explain idea-market fit and uncertainty.
- market_research.first_priorities: array of exactly 3 concise priority sentences covering the first build, research, and outreach priorities.
- mission_doc.one_liner: string. Dashboard topbar tagline. Max 14 words / ~80 characters. ONE short descriptive line stating WHAT the product is and WHO it's for. Pattern: "<short noun phrase> for <audience>" or "<verb-led description in <= 14 words>". Concrete, not aspirational. Examples (DO NOT copy verbatim, just match length and shape): "AI stock research for retail Indian investors." / "Auto-confirmation tool for solo dental clinics." / "Cold outreach copywriter for SaaS founders." NEVER more than 14 words. NEVER ends with a comma or "covering..." style fragment. This goes in the dashboard topbar; long sentences break the UI.
- mission_doc.mission: string. Exactly one sentence, short, sharp, and specific.
- mission_doc.what_were_building: string. 2 concrete sentences describing the product, audience, and mechanism.
- mission_doc.where_were_headed: string. 3-4 vivid but grounded short sentences describing the future state for the target users.

Rules:
- Preserve the invented idea's actual direction unless it is vague or incoherent.
- Do not invent facts.
- Use specific competitors when research supports them.
- If direct competitors are unclear, use adjacent tools, incumbent workflows, agencies, freelancers, spreadsheets, email, or manual work as substitutes.
- Market validation should include demand signals and why now, but only when supported by the research context.
- Be more cautious than Build My Idea because the founder did not arrive with this idea.
- Do not use generic phrases like "revolutionize", "cutting-edge", "empower", "synergy", or "world-class".
- Mission should not be generic startup copy.
- What we're building should describe product mechanics, not repeat the mission.
- Where we're headed should match the idea's actual scale.`;

  let artifacts: SurprisePlanningArtifacts;
  try {
    artifacts = await callSmallLLMJson<SurprisePlanningArtifacts>(prompt, {
      maxTokens: 4200,
      retryOnce: true,
      schema: SurprisePlanningAgentSchema,
      sanitizeFields: [],
      sanitizeArrayOfObjects: ['competitors'],
      useBigModel: true,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error('Surprise planning LLM failed - using deterministic fallback artifacts', { companyId: ctx.companyId, error });
    await recordOnboardingIssue(ctx, {
      stage: 'refine_idea',
      kind: 'planning_llm_fallback',
      severity: 'high',
      error,
      message: 'Surprise planning model output failed, so onboarding used deterministic market research and mission fallbacks.',
      fallbackUsed: true,
    });
    artifacts = fallbackSurprisePlanningArtifacts(ctx, inventedIdea);
  }

  ctx.inventedIdea = {
    invented_idea: artifacts.invented_idea.invented_idea.trim().slice(0, 300),
    changes_made: artifacts.invented_idea.changes_made.trim().slice(0, 250),
    rationale: artifacts.invented_idea.rationale.trim().slice(0, 250),
  };
  ctx.strategy = ctx.inventedIdea.invented_idea;
  ctx.missionDoc = {
    one_liner: stripInlineMarkdown(compactLine(artifacts.mission_doc.one_liner ?? '', 120, 1)),
    mission: stripInlineMarkdown(compactLine(artifacts.mission_doc.mission, 220, 1)),
    what_were_building: stripInlineMarkdown(compactParagraphs(artifacts.mission_doc.what_were_building, 1, 430, 2)),
    where_were_headed: stripInlineMarkdown(compactParagraphs(artifacts.mission_doc.where_were_headed, 1, 620, 4)),
  };
  ctx.mission = ctx.missionDoc.mission;
  const llmOneLiner = ctx.missionDoc.one_liner ?? '';
  const missionFallback = ctx.missionDoc.mission ?? '';
  const buildingFallback = stripInlineMarkdown(
    (ctx.missionDoc.what_were_building ?? '').split(/[.!?]/)[0].trim(),
  );
  ctx.oneLiner = llmOneLiner || missionFallback || buildingFallback;

  log.info('Surprise planning completed', {
    companyId: ctx.companyId,
    competitorCount: artifacts.market_research.competitors.length,
  });
  await emitActivity(ctx, `Sharpened invented idea: "${ctx.inventedIdea.invented_idea.slice(0, 100)}"`, 'llm');
  await appendMemorySection(ctx.companyId, '## Idea (Invented and Planned)', [
    `Invented: ${ctx.inventedIdea.invented_idea}`,
    `Changes: ${ctx.inventedIdea.changes_made}`,
    `Rationale: ${ctx.inventedIdea.rationale}`,
    'Planning mode: research and mission only.',
  ]);
  await saveOnboardingBrief(ctx);

  return artifacts;
}
