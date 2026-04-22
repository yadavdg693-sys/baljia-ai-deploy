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
  | 'generate_roadmap'
  | 'derive_active_milestone'
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

export interface MarketCompetitor {
  name: string;
  what_they_do: string;
  pricing: string;
  gap: string;
}

export interface FirstPriority {
  slot: 'engineering' | 'research' | 'outreach';
  title: string;
  rationale: string;
}

// Build My Idea — lean 5-section report
export interface BuildMarketResearch {
  overview: string;
  competitors: MarketCompetitor[];
  opportunity: string;
  why_this_fits_you: string;
  first_priorities: FirstPriority[];
}

// Grow My Company — denser 10-section report with existing business specifics
export interface GrowMarketCompetitor {
  name: string;
  focus_area: string;
  positioning_or_size: string;
  gap: string;
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
    size_and_growth: string[];
    why_now: string[];
  };
  competitors: MarketCompetitor[];
  why_this_fits_you: string;
  idea_refinements: IdeaRefinement[];
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

  // Roadmap derivatives
  activeMilestoneTitle: string | null;
  activeMilestoneTags: string[];

  // Diagnostics
  startedAt: number;
}
