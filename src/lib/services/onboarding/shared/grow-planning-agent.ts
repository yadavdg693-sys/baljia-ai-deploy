// Grow journey planning agent.
//
// The founder has an existing business. This agent owns market research and
// mission together so the mission cannot drift into startup-invention copy.

import { isTavilyAvailable } from '@/lib/tavily';
import { createLogger } from '@/lib/logger';
import { callSmallLLMJson } from './json-mode';
import { GrowPlanningAgentSchema } from './schemas';
import { trackedTavilySearch } from './tracked-calls';
import { appendMemorySection } from './memory-sections';
import { compactLine, compactParagraphs, stripInlineMarkdown } from './founder-doc-style';
import { emitActivity, recordOnboardingIssue } from '../stage-runner';
import type {
  BusinessProfile,
  GrowMarketResearch,
  MissionDoc,
  PipelineContext,
} from '../types';

const log = createLogger('GrowPlanningAgent');

export interface GrowPlanningArtifacts {
  market_research: GrowMarketResearch;
  mission_doc: MissionDoc;
}

function fallbackGrowPlanningArtifacts(ctx: PipelineContext, profile: BusinessProfile): GrowPlanningArtifacts {
  const name = profile.business_name || ctx.companyName || 'the business';
  const description = profile.description || 'an existing business submitted by the founder';
  const target = profile.target_customer || 'its target customers';
  return GrowPlanningAgentSchema.parse({
    market_research: {
      business_type: profile.business_type || 'existing business',
      main_growth_bottleneck: 'The main bottleneck is unclear; measure the path from interest to qualified demand before scaling.',
      customer_wedge: `Focus on ${target} where the need and buying trigger are easiest to verify.`,
      offer_packaging_direction: 'Clarify the offer, proof, and buying path before scaling acquisition.',
      market_tension: 'Customers want a clearer reason to trust this business over current alternatives.',
      business_overview: `${name} is ${description}. The growth plan should preserve the existing offer and focus on clearer demand generation, proof, and conversion.`,
      revenue_model: profile.revenue_model || 'Revenue model was not clear from available website context.',
      notable_validation: profile.existing_validation || null,
      market_analysis: {
        industry_landscape: `${name} competes for attention and trust against existing providers, manual workflows, and generic alternatives in its category.`,
        key_trends: ['Buyers expect clearer proof, faster response, and a simpler path to evaluate the offer.'],
        market_timing: 'Moderate - validate the sharpest acquisition and conversion lever before scaling.',
      },
      growth_opportunity: `The strongest opportunity is to make ${name}'s offer easier for ${target} to understand, trust, and act on.`,
      competitors: [{
        name: 'Current alternatives',
        focus_area: 'Existing providers, consultants, tools, or manual workflows.',
        positioning_or_size: 'Positioning or pricing was not clear from available research.',
        gap: `${name} can win by making its offer, proof, and buying path clearer.`,
      }],
      business_edge: `${name} already has a real business context to improve rather than starting from zero.`,
      business_gap: 'The biggest gap is the need for a clearer offer, proof, and conversion path.',
      competitive_advantages: profile.proof_signals?.length ? profile.proof_signals : ['Existing business context and a real offer to improve.'],
      gaps_to_exploit: ['Clarify the offer and make the next buying step easier.'],
      threats: ['Lower-cost substitutes can win if the offer, proof, or buying path stays unclear.'],
      what_not_to_do_yet: 'Do not scale broad acquisition until the sharpest offer, proof, and conversion path are clearer.',
      why_this_fits_you: ctx.founderAngle || `This direction fits because it works from ${name}'s actual business instead of inventing a new company.`,
      ai_leverage_points: [
        'Lead qualification - Turn inbound interest into clearer next steps.',
        'Reporting - Summarize progress and outcomes for prospects or customers.',
      ],
      first_priorities: undefined,
      retention_check: {
        signal: 'unknown',
        rationale: 'Retention cannot be judged from available public context.',
        priority: 'measure_first',
      },
      funnel_diagnosis: {
        likely_bottleneck: 'unknown',
        rationale: 'The main bottleneck should be measured before scaling acquisition.',
      },
    },
    mission_doc: {
      one_liner: `${name} growth for ${target}.`,
      mission: `Help ${target} get a clearer, more trustworthy path to ${name}'s value.`,
      what_were_building: `${name} provides ${description}. The growth direction should sharpen the offer, proof, and first conversion path for ${target}.`,
      where_were_headed: `${name} should become easier for the right buyers to understand and trust. The first improvements should make the offer clearer and the buying path simpler. Better proof and follow-up should turn more interest into qualified conversations. From there, the business can scale the channels that produce real demand.`,
    },
  }) as GrowPlanningArtifacts;
}

function hostnameFromInput(input: string | undefined): string | null {
  if (!input) return null;
  try {
    const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    return new URL(withProto).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function categoryFromProfile(ctx: PipelineContext): string {
  const profile = ctx.businessProfile;
  if (!profile) return ctx.companyName || ctx.input || 'business';
  return (
    profile.description.split(/[.,:]/)[0]?.trim()
    || profile.target_customer
    || profile.business_name
  );
}

async function gatherGrowResearch(ctx: PipelineContext): Promise<string> {
  if (!isTavilyAvailable()) {
    throw new Error('Grow planning requires Tavily - not configured');
  }

  const profile = ctx.businessProfile;
  if (!profile) {
    throw new Error('Grow planning requires ctx.businessProfile');
  }

  const host = hostnameFromInput(ctx.input);
  const geo = ctx.founderEnrichment?.geo;
  const region = [geo?.city, geo?.country].filter(Boolean).join(' ');
  const category = categoryFromProfile(ctx);
  const target = profile.target_customer || category;
  const validation = profile.existing_validation || '';

  const queries = [
    host ? `site:${host} ${profile.business_name} services clients case studies` : `"${profile.business_name}" services clients case studies`,
    `"${profile.business_name}" competitors pricing services ${region}`.trim(),
    `${category} competitors ${region} pricing packages positioning`.trim(),
    `${target} buying criteria pain points reviews ${category}`.trim(),
    `${category} lead generation conversion offer audit examples 2026`.trim(),
  ];

  for (const query of queries) {
    await emitActivity(ctx, `Searching: "${query.slice(0, 90)}"`, 'tavily_search');
  }

  const [siteRaw, namedCompetitorRaw, categoryCompetitorRaw, buyerRaw, offerRaw] = await Promise.all([
    trackedTavilySearch(queries[0], 5, 'advanced'),
    trackedTavilySearch(queries[1], 5, 'advanced'),
    trackedTavilySearch(queries[2], 5, 'advanced'),
    trackedTavilySearch(queries[3], 4),
    trackedTavilySearch(queries[4], 4),
  ]);

  const queryBlock = [
    'TAVILY SEARCHES ALREADY RUN',
    ...queries.map((query) => `- ${query}`),
  ].join('\n');

  const websiteBlock = [
    'EXTRACTED WEBSITE CONTEXT',
    `Business name: ${profile.business_name}`,
    `Description: ${profile.description}`,
    `Revenue model: ${profile.revenue_model ?? 'unclear'}`,
    `Target customer: ${profile.target_customer ?? 'unclear'}`,
    `Existing validation: ${validation || 'none visible'}`,
    `Business type: ${profile.business_type ?? 'unclear'}`,
    (profile.services_or_products ?? []).length ? `Services/products: ${(profile.services_or_products ?? []).join(', ')}` : null,
    `Location/market: ${profile.location_or_market ?? 'unclear'}`,
    `Visible offer: ${profile.visible_offer ?? 'unclear'}`,
    `Main CTA: ${profile.main_cta ?? 'unclear'}`,
    (profile.proof_signals ?? []).length ? `Proof signals: ${(profile.proof_signals ?? []).join(', ')}` : null,
    profile.extracted_metadata.title ? `Title: ${profile.extracted_metadata.title}` : null,
    profile.extracted_metadata.meta ? `Meta: ${profile.extracted_metadata.meta}` : null,
    profile.extracted_metadata.body ? `Body excerpt: ${profile.extracted_metadata.body.slice(0, 2400)}` : null,
  ].filter(Boolean).join('\n');

  const rawParts = [
    queryBlock,
    websiteBlock,
    siteRaw ? `SITE / VALIDATION RESULTS\n${siteRaw}` : null,
    namedCompetitorRaw ? `NAMED COMPETITOR RESULTS\n${namedCompetitorRaw}` : null,
    categoryCompetitorRaw ? `CATEGORY COMPETITOR RESULTS\n${categoryCompetitorRaw}` : null,
    buyerRaw ? `BUYER / PAIN RESULTS\n${buyerRaw}` : null,
    offerRaw ? `OFFER / CONVERSION RESULTS\n${offerRaw}` : null,
  ].filter(Boolean);

  if (rawParts.length <= 2) {
    throw new Error('Grow planning: Tavily returned zero usable context');
  }

  return rawParts.join('\n\n---\n\n').slice(0, 9500);
}

export async function runGrowPlanningAgent(ctx: PipelineContext): Promise<GrowPlanningArtifacts> {
  let profile = ctx.businessProfile;
  if (!profile) {
    const businessName = ctx.companyName && ctx.companyName !== 'My Company'
      ? ctx.companyName
      : 'Existing Business';
    profile = {
      business_name: businessName,
      description: 'An existing business submitted by the founder for growth planning.',
      revenue_model: 'unclear',
      target_customer: 'unclear',
      existing_validation: null,
      business_type: 'existing business',
      services_or_products: [],
      location_or_market: null,
      visible_offer: null,
      main_cta: null,
      proof_signals: [],
      extracted_metadata: { title: null, meta: null, body: null },
    };
    ctx.businessProfile = profile;
    await recordOnboardingIssue(ctx, {
      stage: 'generate_market_research',
      kind: 'missing_business_profile_fallback',
      severity: 'high',
      message: 'Grow planning did not receive a business profile, so it used a deterministic existing-business fallback.',
      fallbackUsed: true,
    });
  }

  const geo = ctx.founderEnrichment?.geo;
  const locationLine = geo?.country
    ? `Founder location signal: ${[geo.city, geo.country].filter(Boolean).join(', ')}. Use it only if the business profile or research supports the same market.`
    : 'Founder location unknown. Do not invent a city, country, or local market.';

  await emitActivity(ctx, 'Planning growth: existing-business research and mission', 'llm');
  let rawResearch: string;
  try {
    rawResearch = await gatherGrowResearch(ctx);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('Grow planning research unavailable - continuing cautiously', { companyId: ctx.companyId, error });
    await recordOnboardingIssue(ctx, {
      stage: 'generate_market_research',
      kind: 'planning_research_fallback',
      severity: 'medium',
      error,
      message: 'Grow planning research was unavailable, so onboarding continued with website/profile context only.',
      fallbackUsed: true,
    });
    rawResearch = 'External research was unavailable. Use the existing business profile only, avoid unsupported claims, and focus on measurable growth priorities.';
  }

  const prompt = `You are Baljia's Grow My Company planning agent.

The founder submitted an EXISTING business website. Your job is to understand the current business and produce:
1. founder-facing growth market research,
2. a mission document for the existing business.

You are not inventing a new startup and you are not renaming the business.

Existing business profile:
{
  "business_name": ${JSON.stringify(profile.business_name)},
  "description": ${JSON.stringify(profile.description)},
  "revenue_model": ${JSON.stringify(profile.revenue_model ?? 'unclear')},
  "target_customer": ${JSON.stringify(profile.target_customer ?? 'unclear')},
  "existing_validation": ${JSON.stringify(profile.existing_validation ?? 'none visible')},
  "business_type": ${JSON.stringify(profile.business_type ?? 'unclear')},
  "services_or_products": ${JSON.stringify(profile.services_or_products ?? [])},
  "location_or_market": ${JSON.stringify(profile.location_or_market ?? 'unclear')},
  "visible_offer": ${JSON.stringify(profile.visible_offer ?? 'unclear')},
  "main_cta": ${JSON.stringify(profile.main_cta ?? 'unclear')},
  "proof_signals": ${JSON.stringify(profile.proof_signals ?? [])},
  "submitted_url": ${JSON.stringify(ctx.input ?? null)}
}

Founder context:
${ctx.founderAngle || ctx.enrichedFounderSummary || 'No founder-specific context available. Do not invent personal facts or roles.'}

Location context:
${locationLine}

Research context:
${rawResearch}

How to think:
- Treat the website and extracted business profile as the source of truth.
- Preserve the existing company identity, services, target customer, proof, and local/industry positioning when supported.
- If founder context is not clearly connected to the business, do not claim the founder has a specific role there.
- First infer the business type from the website and research: service business, software/product, ecommerce, marketplace, local business, agency/studio/consultancy, content/media, or other.
- Choose the growth lens from the inferred business type and evidence. Do not assume the business needs a dashboard, software feature, AI tool, or agency workflow.
- Run a relevance check before writing: every opportunity, gap, competitor, AI leverage point, and mission line must make sense for the inferred business_type. If it would only fit another business type, do not include it.
- Analyze the highest-leverage growth levers for that business type: offer clarity, proof, pricing, lead conversion, retention, referrals, reporting, packaging, distribution, onboarding, repeat purchase, marketplace liquidity, audience growth, or operational leverage.
- Pick competitors/substitutes in this order: direct competitors in the same category and geography when available, larger category leaders, adjacent providers or products, then substitute workflows/tools customers use instead.
- Do not default to global SaaS, US companies, or generic automation platforms unless they are genuinely relevant substitutes for this specific business.
- Do not invent founder background, client logos, years in business, pricing, competitors, awards, or customer behavior.
- Do not invent guarantees, ROI percentages, revenue impact, market-size numbers, or future targets unless the research context directly supports them.
- If evidence is weak, write carefully instead of pretending certainty.
- Keep output founder-facing, concise, and useful. Prefer specific short bullets over long consultant paragraphs.
- The final report should feel like a sharp founder dashboard document: enough depth to act, not a research dump.
- The saved market research and mission must be crisp, pointwise, and easy to scan.
- Use short sections, bold lead lines, bullets, and table-ready competitor rows.
- Lists should have 3-5 bullets max.
- Each bullet should be one concrete point, 1-2 short lines max.
- Overview and mission sections may use short paragraphs, but no dense consulting memo paragraphs.
- Tables must use short cells, not paragraph cells.
- Do not create long AI leverage menus, long first-priority explanations, or generic filler.
- Build a clear strategy spine before writing:
  1. What proof does the business already have?
  2. What is the main growth bottleneck right now?
  3. Which customer wedge should the business pursue next?
  4. What offer, package, pricing model, proof asset, or conversion path should be sharpened first?
  5. What sequence should the founder follow over the next 30-90 days?
- If the business has impressive enterprise/legacy proof but the best next wedge is smaller buyers, explain that bridge clearly. Do not let old logos obscure the next customer target.
- If pricing or packaging is unclear, do not stop at "pricing not disclosed." Sketch practical package directions or pricing-model options without inventing exact prices.
- For the mission, convert research into belief:
  1. What market tension does this business resolve?
  2. What does this business believe that competitors underplay?
  3. Which customer should feel seen by the mission?
  4. What line would the founder be proud to repeat?
- Mission must express the company's strategic belief, not just describe its services or product.
- Useful tensions include craft vs speed, trust vs automation, local expertise vs global scale, affordability vs quality, simplicity vs power, data vs instinct, access vs exclusivity, human service vs self-serve tools. Use only the tension that fits the actual business.
- Prefer crisp rhythm when it fits, such as parallel sentences, contrast, or a memorable anti-positioning line. Do not force poetry or copy any example.
- Do not let business-type examples become the answer. The final answer must come from this company's website/profile/research context.
- Write each field for this founder-facing rendered structure:
  1. Business Overview: short paragraphs with business type, offer, customer, proof, revenue model.
  2. Market Analysis: one market paragraph, then short market signals/trends, then timing and opportunity.
  3. Competitive Landscape: table-ready competitor rows, then one edge sentence and one gap sentence.
  4. Opportunities and gaps: concise advantages, gaps, threats, and what not to do yet.
  5. Why This Fits You: one human paragraph that connects assets to the next growth path.
  6. AI Leverage Points: 2-3 high-impact operational plays, not a long menu.
  7. First Priorities: ranked 1-2-3 sequence, not equal-weight ideas.
- Output only the JSON fields in the shape below.

Return JSON only. The JSON object must include these top-level keys:
- market_research
- mission_doc

Field rules:
- market_research.business_overview: string. Founder-facing Markdown with 2-3 short paragraphs. Paragraph 1 explains what the business is, who buys it, and what it sells. Paragraph 2 names visible proof/validation. Paragraph 3, only if needed, explains positioning. Keep each paragraph to 1-2 short sentences.
- market_research.business_type: string. One concise classification from the evidence, such as service business, software/product, ecommerce, marketplace, local business, agency/studio/consultancy, content/media, or other.
- market_research.main_growth_bottleneck: string. One sentence naming the current bottleneck: awareness, acquisition, activation, conversion, retention, delivery, reporting, client_communication, monetization, referrals, pricing, positioning, or unknown.
- market_research.customer_wedge: string. One sentence naming the next customer segment or buyer situation the business should focus on, grounded in website/research evidence.
- market_research.offer_packaging_direction: string. One sentence describing the offer, package, pricing model, proof asset, or conversion path to sharpen first. Do not invent exact prices.
- market_research.market_tension: string. One sentence naming the strategic tension the business resolves, grounded in evidence.
- market_research.revenue_model: string. Concrete revenue model when evident. If pricing is not public, say that, then sketch 2-3 practical package/pricing-model directions without inventing exact prices. Keep it short.
- market_research.notable_validation: string or null. Use only visible clients, years in business, case studies, reviews, press, funding, testimonials, or other proof.
- market_research.market_size: array. Use concrete market or growth stats from research only; each item needs stat and confidence. Confidence must be high, medium, or low. Use an empty array if no credible stats surfaced.
- market_research.market_analysis.industry_landscape: string. One concise paragraph, 2-3 short sentences maximum, explaining the market around this business and what affects growth.
- market_research.market_analysis.key_trends: array of 4-5 strings. Each trend must directly affect this business getting, converting, retaining, or expanding customers. Each trend must be one short line.
- market_research.market_analysis.market_timing: string. Use Strong, Moderate, or Early, then add a one-line rationale. Be conservative in mature markets.
- market_research.growth_opportunity: string. 1-2 short sentences that name the current proof, main bottleneck, next customer wedge, and the first offer/conversion path to sharpen. This should read like the report's strategic thesis.
- market_research.competitors: array with 4-5 objects when research supports them; at least one object if research is thin.
- Each competitor object needs name, focus_area, positioning_or_size, and gap as strings.
- Competitor name must be a real competitor, incumbent, adjacent provider/product, or substitute workflow supported by research.
- positioning_or_size should use pricing, scale, or positioning when surfaced; otherwise use a short uncertainty sentence.
- market_research.business_edge: string. One sharp sentence with the strongest advantage this existing business has versus alternatives.
- market_research.business_gap: string. One sharp sentence with the biggest growth weakness or missing piece it should address.
- market_research.competitive_advantages: array of 3-5 short strings grounded in the website or research. Each should be one line, not a paragraph.
- market_research.gaps_to_exploit: array of 4-5 short strings covering the most important growth, conversion, channel, offer, positioning, proof, delivery, or retention gaps. Each should name the gap and why it matters in one line.
- market_research.threats: array of exactly 3 short strings. Name realistic threats from competitors, substitutes, customer behavior, pricing, channel dependency, retention, delivery, or market timing.
- market_research.what_not_to_do_yet: string. One direct sentence naming the tempting move the business should avoid until the first priorities are handled.
- market_research.why_this_fits_you: string. One short paragraph, max 2 sentences, explaining why this growth direction fits this business/founder. Anchor it to actual assets, proof, current positioning, and a realistic 6-18 month path. Use personal founder context only if actually provided and relevant.
- market_research.ai_leverage_points: array of 2-3 high-impact AI or automation opportunities derived from how this business actually works. Prefer concrete operational leverage over generic ideas. For service businesses, favor proposal/brief acceleration, client reporting, intake/qualification, case-study production, or delivery coordination when relevant. For product/ecommerce/marketplace/content businesses, choose the equivalent high-leverage workflows for that model.
- market_research.first_priorities: array of exactly 3 concise priority sentences. These must be ranked and sequential, not equal-weight ideas:
  1. First clarify/package the offer, proof, pricing model, or conversion path.
  2. Then research competitors/substitutes against that sharper offer.
  3. Then run outreach/distribution using the sharper pitch.
  Do not write final task proposals here; write strategic priorities that explain order.
- market_research.retention_check.signal: string. One of healthy, warning, or unknown.
- market_research.retention_check.rationale: string. One sentence based on visible evidence.
- market_research.retention_check.priority: string. One of scale_acquisition, fix_retention_first, or measure_first.
- market_research.funnel_diagnosis.likely_bottleneck: string. One of awareness, acquisition, activation, conversion, retention, delivery, reporting, client_communication, monetization, referrals, or unknown.
- market_research.funnel_diagnosis.rationale: string. One sentence.
- mission_doc.one_liner: string. Dashboard topbar tagline. Max 14 words / ~80 characters. ONE short descriptive line stating WHAT ${profile.business_name} is and WHO it's for. Pattern: "<short noun phrase> for <audience>" or "<verb-led description in <= 14 words>". Concrete, not aspirational. Examples (DO NOT copy verbatim, just match length and shape): "AI stock research for retail Indian investors." / "Local plumbing services for South Mumbai homeowners." / "Cold outreach copywriter for SaaS founders." NEVER more than 14 words. NEVER ends with a comma or "covering..." style fragment. This goes in the dashboard topbar; long sentences break the UI.
- mission_doc.mission: string. Exactly one sentence, short, sharp, specific to the existing business, and built from the business's strategic belief or market tension. It should be a line the founder could proudly say out loud.
- mission_doc.what_were_building: string. 2 concrete sentences describing what the business provides, for whom, and how it delivers value today or through the sharpened growth direction.
- mission_doc.where_were_headed: string. 3-4 grounded short sentences describing the future state for the business's actual customers. Turn the mission belief into a realistic future. Match the business scale; do not make it sound like a new unrelated startup.

Rules:
- Existing business, not startup invention.
- Mission must be about ${profile.business_name}, not a generic company.
- What we're building must not describe a brand-new product unless the website/research already supports it.
- For service businesses, describe the service offer, delivery mechanism, and customer outcome.
- For product businesses, describe the product workflow and customer outcome.
- AI leverage points must be practical for the actual business and derived from the website, buyer journey, service/product workflow, or research context.
- Mission should sound like it belongs to the business. It should be memorable, concrete, and emotionally clear without making unsupported performance promises.
- Avoid bland phrases like "trusted, measurable solutions", "tangible business growth", "comprehensive services", and "end-to-end partner" unless the surrounding sentence adds specific meaning.
- Mission should not be a category description. Avoid "We provide...", "We deliver...", "We help businesses..." unless the sentence contains a distinctive belief or tension.
- What we're building should explain the actual business mechanics. Where we're headed should make the belief feel inevitable without exaggerating claims.
- First priorities must read like a sequence. The first item should unlock the second, and the second should make the third stronger.
- Do not over-index on the business's biggest legacy proof if the growth wedge is elsewhere. Use legacy proof as credibility, then point at the next customer segment.
- Mention local market only when the business website/research supports it, not merely because the founder is located there.
- Use clear language. Avoid "revolutionize", "cutting-edge", "empower", "synergy", "world-class", "best-in-class", "modern", "streamlined", and "innovative".`;

  let artifacts: GrowPlanningArtifacts;
  try {
    artifacts = await callSmallLLMJson<GrowPlanningArtifacts>(prompt, {
      maxTokens: 4400,
      retryOnce: true,
      schema: GrowPlanningAgentSchema,
      sanitizeFields: [],
      sanitizeArrayOfObjects: ['competitors'],
      useBigModel: true,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error('Grow planning LLM failed - using deterministic fallback artifacts', { companyId: ctx.companyId, error });
    await recordOnboardingIssue(ctx, {
      stage: 'generate_market_research',
      kind: 'planning_llm_fallback',
      severity: 'high',
      error,
      message: 'Grow planning model output failed, so onboarding used deterministic market research and mission fallbacks.',
      fallbackUsed: true,
    });
    artifacts = fallbackGrowPlanningArtifacts(ctx, profile);
  }

  const missionDoc = artifacts.mission_doc;
  ctx.missionDoc = {
    one_liner: stripInlineMarkdown(compactLine(missionDoc.one_liner ?? '', 120, 1)),
    mission: stripInlineMarkdown(compactLine(missionDoc.mission, 220, 1)),
    what_were_building: stripInlineMarkdown(compactParagraphs(missionDoc.what_were_building, 1, 430, 2)),
    where_were_headed: stripInlineMarkdown(compactParagraphs(missionDoc.where_were_headed, 1, 620, 4)),
  };
  ctx.mission = ctx.missionDoc.mission;
  const llmOneLiner = ctx.missionDoc.one_liner ?? '';
  const missionFallback = ctx.missionDoc.mission ?? '';
  const buildingFallback = stripInlineMarkdown(
    (ctx.missionDoc.what_were_building ?? '').split(/[.!?]/)[0].trim(),
  );
  ctx.oneLiner = llmOneLiner || missionFallback || buildingFallback;
  ctx.strategy = `${profile.business_name} growth: ${artifacts.market_research.funnel_diagnosis?.likely_bottleneck ?? 'customer acquisition'}`;

  log.info('Grow planning completed', {
    companyId: ctx.companyId,
    businessName: profile.business_name,
    competitorCount: artifacts.market_research.competitors.length,
  });
  await emitActivity(ctx, `Growth plan anchored to ${profile.business_name}`, 'llm');
  await appendMemorySection(ctx.companyId, '## Growth Planning', [
    `Existing business: ${profile.business_name}`,
    `Focus: ${ctx.strategy}`,
    `Mission: ${ctx.missionDoc.mission}`,
    'Planning mode: existing-business research and mission only.',
  ]);

  return artifacts;
}
