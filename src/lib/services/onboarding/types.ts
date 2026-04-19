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
  | 'send_startup_email'
  | 'generate_market_research'
  | 'save_mission'
  | 'generate_roadmap'
  | 'derive_active_milestone'
  | 'create_starter_tasks'
  | 'generate_landing_page'
  | 'post_launch_tweet'
  | 'generate_ceo_summary'
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
  marketResearch: string | null;

  // Roadmap derivatives
  activeMilestoneTitle: string | null;
  activeMilestoneTags: string[];

  // Diagnostics
  startedAt: number;
}
