// Onboarding pipeline types — shared across orchestrator, strategies, shared atoms

import type { OnboardingJourney } from '@/types';

export type OnboardingStage =
  | 'heartbeat'
  | 'enrich_geo'
  | 'enrich_linkedin'
  | 'enrich_twitter'
  | 'extract_founder_angle'
  | 'persist_context'
  | 'select_strategy'
  | 'refine_idea'
  | 'fetch_business_url'
  | 'invent_idea'
  | 'name_company'
  | 'provision_infrastructure'
  | 'provision_founder_app_kickoff'
  | 'await_founder_app'
  | 'send_startup_email'
  | 'generate_market_research'
  | 'save_mission'
  | 'create_starter_tasks'
  | 'generate_landing_page'
  | 'post_launch_tweet'
  | 'generate_ceo_summary'
  | 'generate_magic_link'
  | 'send_inbox_message'
  | 'send_completion_email'
  | 'flush_diagnostics'
  | 'celebrate';

export type MoodState =
  | 'listening'
  | 'researching'
  | 'building'
  | 'writing'
  | 'celebrating'
  | 'blocked';

export interface FounderGeoData {
  country: string | null;
  city: string | null;
  timezone: string | null;
  region: string | null;
}

export interface FounderEnrichment {
  linkedinSummary: string | null;
  twitterBio: string | null;
  geo: FounderGeoData | null;
  confidence: 'high' | 'medium' | 'low';
}

// Per-journey idea shapes (exactly ONE populated per run) — see
// memory/project_per_journey_idea_shapes.md for why these are not unified.
export interface RefinedIdea {
  refined_idea: string;
  changes_made: string;
  rationale: string;
}

export interface BusinessProfile {
  business_name: string;
  description: string;
  revenue_model: string | null;
  target_customer: string | null;
  existing_validation: string | null;
  extracted_metadata: {
    title: string | null;
    meta: string | null;
    body: string | null;
  };
}

export interface InventedIdea {
  invented_idea: string;
  changes_made: string;
  rationale: string;
}

// ══════════════════════════════════════════════
// Per-journey market research JSON schemas
// See memory/project_market_research_format_locked.md
// ══════════════════════════════════════════════

// Confidence tagging — used for any stat/claim the LLM synthesizes from Tavily
// or infers. Never inlined in the founder-visible text; kept as metadata so we
// can flag low-confidence items in the rendered markdown and audit at the DB
// level (via sweep-contamination or later founder-facing UI).
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface TaggedStat {
  stat: string;              // the actual claim — "Self-publishing market: $3.2B globally"
  confidence: ConfidenceLevel;
}

export interface MarketCompetitor {
  name: string;
  what_they_do: string;
  pricing: string;           // "not found — verify manually" if Tavily didn't surface it
  gap: string;
}

// Slot can be one of the flexible task-3 variants — task creation maps all
// non-core slots to the 'outreach' DB tag, preserving journey-specific framing
// in the title/description rather than adding new agent tags.
export interface FirstPriority {
  slot: 'engineering' | 'research' | 'outreach' | 'discovery' | 'validation';
  title: string;
  rationale: string;
}

// Gap-filling: after first-pass research, the LLM identifies gaps it couldn't
// fill from initial Tavily snippets and writes targeted queries to fill them.
// Orchestrator runs those queries (2-4 calls), then re-synthesizes with combined
// raw data. Cheap upgrade ($0.05 + ~25s) that materially reduces hallucination
// risk for thin-data markets. See market-research-*.ts.
export interface GapFillingQuery {
  query: string;     // concrete Tavily search string
  fills: string;     // 1-line label of which gap this query targets
}

// Build My Idea — lean report
export interface BuildMarketResearch {
  overview: string;
  competitors: MarketCompetitor[];
  opportunity: string;
  why_this_fits_you: string;
  market_size?: TaggedStat[];          // confidence-tagged market stats
  demand_signals?: string[];           // evidence people want this (Reddit complaints, forum posts, app store reviews). Empty if none found.
  data_gaps?: string[];                // what Tavily didn't cover — transparency vs hallucinated completeness
  gap_filling_queries?: GapFillingQuery[];  // 1st pass: LLM-recommended targeted queries to fill data_gaps. Orchestrator runs them and re-synthesizes.
  research_quality_warning?: string;   // set by orchestrator after 2nd pass if gaps still significant — surfaces "thin public data, validate manually" to the founder
  proceed_or_pause?: 'proceed' | 'narrow_first' | 'validate_first';  // BUILD-only: explicit go/no-go gate. validate_first when demand_signals empty after gap-filling.
  proceed_note?: string;               // BUILD-only: 1-line founder-facing rationale for the proceed_or_pause decision
  first_priorities: FirstPriority[];
}

// Grow My Company — denser report with existing business specifics
export interface GrowMarketCompetitor {
  name: string;
  focus_area: string;
  positioning_or_size: string;
  gap: string;
}

export interface RetentionCheck {
  signal: 'healthy' | 'warning' | 'unknown';
  rationale: string;
  priority: 'scale_acquisition' | 'fix_retention_first' | 'measure_first';
}

export interface FunnelDiagnosis {
  likely_bottleneck: 'awareness' | 'acquisition' | 'activation' | 'retention' | 'monetization' | 'referral';
  rationale: string;
}

export interface GrowMarketResearch {
  business_overview: string;
  revenue_model: string;
  notable_validation: string | null;
  market_analysis: {
    industry_landscape: string;
    key_trends: string[];
    market_timing: string; // "Strong" | "Moderate" | "Early" + rationale
  };
  competitors: GrowMarketCompetitor[];
  competitive_advantages: string[];
  gaps_to_exploit: string[];
  why_this_fits_you: string;
  ai_leverage_points: string[];
  market_size?: TaggedStat[];
  retention_check?: RetentionCheck;    // gates acquisition advice
  funnel_diagnosis?: FunnelDiagnosis;  // where to focus
  data_gaps?: string[];
  gap_filling_queries?: GapFillingQuery[];  // 1st pass: targeted queries to fill data_gaps
  research_quality_warning?: string;   // set by orchestrator after 2nd pass if gaps still significant
  first_priorities: FirstPriority[];
}

// Surprise Me — Build-shaped plus Why Now + Idea Refinements
export interface IdeaRefinement {
  title: string;
  rationale: string;
}

export interface SurpriseMarketResearch {
  idea_overview: string;
  market_validation: {
    size_and_growth: TaggedStat[];     // confidence-tagged
    why_now: string[];
    demand_signals?: string[];
  };
  competitors: MarketCompetitor[];
  why_this_fits_you: string;
  idea_refinements: IdeaRefinement[];
  data_gaps?: string[];
  gap_filling_queries?: GapFillingQuery[];  // 1st pass: targeted queries to fill data_gaps
  research_quality_warning?: string;   // set by orchestrator after 2nd pass if gaps still significant
  first_priorities: FirstPriority[];
}

export type MarketResearchResult = BuildMarketResearch | GrowMarketResearch | SurpriseMarketResearch;

// 3-section mission (replaces 1-line output)
export interface MissionDoc {
  mission: string;                // 1 sentence
  what_were_building: string;     // 2-3 sentences
  where_were_headed: string;      // 4-6 sentences, GeoIP-anchored
}

export interface PipelineContext {
  // Entry
  companyId: string;
  userId: string;
  journey: OnboardingJourney;
  input: string | undefined;
  requestIp: string | null;
  browserTimezone: string | null;
  browserLocale: string | null;
  userAgent: string | null;

  // Founder identity
  founderName: string | null;
  founderEmail: string;

  // Enrichment (scope varies by journey via headers)
  founderEnrichment: FounderEnrichment | null;
  enrichedBusinessSummary: string | null;
  enrichedFounderSummary: string | null;
  founderAngle: string | null;

  // Per-journey idea shapes — populated based on journey
  refinedIdea?: RefinedIdea;
  businessProfile?: BusinessProfile;
  inventedIdea?: InventedIdea;

  // Strategy label (kept for backward compatibility; per-journey
  // stages use their own idea shapes above)
  strategy: string;

  // Company outputs
  companyName: string;
  slug: string;
  oneLiner: string;
  mission: string;
  missionDoc?: MissionDoc;
  marketResearch: string | null;       // rendered markdown (legacy shape, for pre-Phase-3a stages)
  marketResearchJson?: MarketResearchResult; // structured per-journey JSON (Phase 3a)

  // Diagnostics
  startedAt: number;
}
