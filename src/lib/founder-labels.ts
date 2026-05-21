// Founder-facing label maps — strips internal architecture details (Phase 4: Information Leakage)
// Founders should never see agent IDs, internal stage names, failure class internals, or source codes.

/** Agent ID → business-friendly name (no numeric IDs exposed) */
export const FOUNDER_AGENT_LABELS: Record<number, string> = {
  0:  'Your AI CEO',
  29: 'Research Team',
  30: 'Engineering Team',
  32: 'Customer Support',
  33: 'Data & Analytics',
  40: 'Social Media',
  41: 'Ad Campaigns',
  42: 'Web Automation',
  54: 'Sales Outreach',
};

/** Task source → founder-friendly text */
export const FOUNDER_SOURCE_LABELS: Record<string, string> = {
  founder_requested: 'You requested',
  ceo_suggested: 'AI recommended',
  night_shift_generated: 'Overnight planning',
  auto_remediation: 'Auto-fix',
  recurring: 'Recurring',
  onboarding: 'Setup',
  system: 'System',
};

/** Failure class → user-safe text (no internal taxonomy exposed) */
export const FOUNDER_FAILURE_LABELS: Record<string, string> = {
  infra_error: 'System error',
  capability_miss: 'Task requires unavailable capability',
  external_block: 'External service unavailable',
  verification_reject: 'Quality check failed',
  timeout: 'Took too long',
  scope_overflow: 'Task too complex',
  policy_violation: 'Content policy issue',
  connector_failure: 'Connection issue',
  // Legacy classes (in case old data persists)
  worker_failure: 'System error',
  external_dependency: 'External service unavailable',
  platform_scoping: 'Task too complex',
  founder_ambiguity: 'Needs clarification',
  missing_prerequisite: 'Missing setup',
  // Fingerprint categories
  tool_failure: 'Tool error',
  external: 'External service unavailable',
  scope: 'Task too complex',
  routing: 'System error',
};

/** Onboarding stage → founder-friendly label */
export const ONBOARDING_STAGE_LABELS: Record<string, string> = {
  heartbeat: 'Connecting...',
  enrich_geo: 'Detecting your location',
  extract_founder_angle: 'Finding your unique angle',
  persist_context: 'Saving your profile',
  refine_idea: 'Refining your idea',
  fetch_business_url: 'Reading your site',
  invent_idea: 'Inventing an idea from your background',
  name_company: 'Naming your company',
  provision_infrastructure: 'Setting up your workspace',
  provision_founder_app_kickoff: 'Spinning up infrastructure',
  send_startup_email: 'Sending your first company email',
  generate_market_research: 'Analyzing your market',
  save_mission: 'Crafting your mission',
  create_starter_tasks: 'Preparing first plan',
  generate_landing_page: 'Designing your website',
  post_launch_tweet: 'Announcing your launch',
  generate_ceo_summary: 'Preparing your briefing',
  await_founder_app: 'Finalizing infrastructure',
  generate_magic_link: 'Preparing your dashboard link',
  send_inbox_message: 'Sending your welcome note',
  send_completion_email: 'Sending your summary email',
  flush_diagnostics: 'Final checks',
  celebrate: 'Ready to go!',
};
