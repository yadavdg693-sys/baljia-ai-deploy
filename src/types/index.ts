// Baljia AI — Core TypeScript Types
// Derived from Technical Architecture Spec v2

// ============================================
// ENUMS
// ============================================

export type ClaimStatus = 'owned' | 'baljia_fund' | 'unclaimed';
export type OnboardingStatus = 'initializing' | 'pending_auth' | 'running' | 'completed' | 'failed';
export type PlanTier = 'trial' | 'starter' | 'growth' | 'scale';
export type Lifecycle = 'trial_active' | 'trial_expired' | 'full_active' | 'keep_live_active' | 'suspended_billing' | 'archived' | 'deleted';
export type ExecutionState = 'active' | 'paused' | 'suspended';
export type BillingState = 'free' | 'trial' | 'active' | 'past_due' | 'cancelled';
export type HostingState = 'live' | 'suspended' | 'archived';
export type CompanyStage = 'early' | 'validation' | 'monetization' | 'retention' | 'scale' | 'compounding';

export type TaskStatus = 'todo' | 'in_progress' | 'verifying' | 'completed' | 'failed' | 'failed_permanent' | 'rejected' | 'blocked_pre_start' | 'blocked_in_run' | 'repair';
export type TaskSource = 'founder_requested' | 'ceo_suggested' | 'night_shift_generated' | 'auto_remediation' | 'recurring' | 'onboarding';
export type ExecutabilityType = 'can_run_now' | 'needs_new_connection' | 'manual_task';
export type ExecutionMode = 'deterministic' | 'template_plus_params' | 'full_agent';
export type VerificationLevel = 'none' | 'deterministic' | 'browser_flow' | 'quality_review' | 'hybrid';
// Canonical 8-class failure taxonomy (SPEC-CTRL-106)
export const FAILURE_CLASSES = [
  'infra_error',          // Platform/infra failures (DB, queue, internal services)
  'capability_miss',      // Agent lacks tools/skills for the task
  'external_block',       // Third-party API/service unavailable or errored
  'verification_reject',  // Verifier rejected worker output
  'timeout',              // Execution exceeded time or turn budget
  'scope_overflow',       // Task too complex, needs decomposition
  'policy_violation',     // Content safety, compliance, or guardrail breach
  'connector_failure',    // OAuth/credential/integration connection issue
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

// Map legacy 5-class names to canonical 8-class (for data migration + backward compat)
export const LEGACY_FAILURE_CLASS_MAP: Record<string, FailureClass> = {
  worker_failure: 'infra_error',
  external_dependency: 'external_block',
  platform_scoping: 'scope_overflow',
  founder_ambiguity: 'scope_overflow',      // Ambiguous scope → scope_overflow
  missing_prerequisite: 'connector_failure',
  // failure.service.ts legacy categories:
  tool_failure: 'capability_miss',
  external: 'external_block',
  scope: 'scope_overflow',
  routing: 'infra_error',
};

export type BaljiaState = 'listening' | 'planning' | 'running' | 'investigating' | 'blocked' | 'resolved' | 'growth_mode';

export type AgentExecutionStyle = 'agentic' | 'structured' | 'graph';

// DB: memory_layers.layer INTEGER CHECK (layer IN (1,2,3))
export type MemoryLayerNumber = 1 | 2 | 3;

// ============================================
// CORE ENTITIES
// ============================================

export interface User {
  id: string;
  email: string;
  name: string | null;
  twitter_handle: string | null;
  auth_provider: 'magic_link' | 'google';
  google_id: string | null;
  email_verified: boolean;
  timezone: string | null;
  locale: string | null;
  ip_country: string | null;
  device_type: string | null;
  referral_source: string | null;
  referral_code: string;
  referred_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  one_liner: string | null;
  original_idea: string | null;
  claim_status: ClaimStatus;
  onboarding_status: OnboardingStatus;
  onboarding_journey: OnboardingJourney | null;
  plan_tier: PlanTier;
  lifecycle: Lifecycle;
  execution_state: ExecutionState;
  billing_state: BillingState;
  hosting_state: HostingState;
  company_stage: CompanyStage;
  subdomain: string | null;
  email_identity: string | null;
  company_email: string | null;     // Drizzle: company_email VARCHAR(255)
  github_repo: string | null;
  render_service_id: string | null;
  neon_database_id: string | null;
  // neon_connection_string removed — fetched live from Neon API via neon_database_id (Audit #4)
  custom_domain: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Task {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  tag: string;
  task_type: string | null;
  status: TaskStatus;
  priority: number;
  complexity: number | null;
  queue_order: number | null;
  source: TaskSource;
  suggestion_reasoning: string | null;
  executability_type: ExecutabilityType;
  execution_mode: ExecutionMode | null;
  assigned_to_agent_id: number | null;
  estimated_hours: number | null;
  estimated_credits: number;
  actual_credits_charged: number;
  verification_level: VerificationLevel | null;
  refund_policy: 'manual_review' | 'no_refund' | null;
  failure_class: FailureClass | null;
  related_task_ids: string[] | null;
  run_link: string | null;
  markdown_link: string | null;
  authorized_by: string | null;           // 'founder' | 'night_shift' | 'recurring' | 'remediation' | 'system'
  authorization_reason: string | null;     // human-readable reason
  max_turns: number;
  turn_count: number;
  repair_attempt_count: number;  // SPEC-CTRL-106: max 100 per scope
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: number;
  name: string;
  role: string | null;
  base_system_prompt: string | null;
  default_max_turns: number;
  default_model: string;
  execution_style: AgentExecutionStyle;
  is_active: boolean;
}

export interface Document {
  id: string;
  company_id: string;
  doc_type: string;
  title: string | null;
  content: string | null;
  source: string | null;
  version: number;
  is_empty: boolean;
  created_at: string;
  updated_at: string;
}

export interface Report {
  id: string;
  company_id: string;
  task_id: string | null;
  title: string | null;
  content: string | null;
  report_type: string | null;
  structured_data: Record<string, unknown> | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  company_id: string;
  user_id: string;
  messages: ChatMessage[];
  message_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ChatAction is defined in the Chat Types section below

// ============================================
// MASCOT STATE
// ============================================

export interface BaljiaStatus {
  state: BaljiaState;
  label: string;    // e.g., "Planning next move"
  detail: string;   // e.g., "Sizing engineering task"
}

// ============================================
// DASHBOARD
// ============================================

export interface DashboardData {
  company: Company;
  baljia_status: BaljiaStatus;
  tasks: Task[];
  documents: Document[];
  reports: Report[];
  credit_balance: number;
  business_metrics: {
    revenue: number;
    balance: number;
    views: number;
    users: number;
  };
}

// ============================================
// GOVERNANCE
// ============================================

export interface GovernanceDecision {
  verdict: 'approved' | 'split_required' | 'blocked' | 'refused';
  execution_mode: ExecutionMode;
  estimated_credits: number;
  verification_level: VerificationLevel;
  split_tasks?: Partial<Task>[];
  blocker_reason?: string;
  refund_policy: 'manual_review' | 'no_refund';
  founder_safe_explanation: string;
}

// ============================================
// ONBOARDING
// ============================================

export type OnboardingJourney = 'surprise_me' | 'build_my_idea' | 'grow_my_company';

export interface OnboardingInput {
  journey: OnboardingJourney;
  user_id: string;
  idea?: string;          // for build_my_idea
  business_url?: string;  // for grow_my_company
}

export interface EnrichmentResult {
  person_confidence: 'high' | 'medium' | 'low';
  business_confidence: 'high' | 'medium' | 'low';
  decision: 'personalize_around_person' | 'personalize_around_business' | 'bounded_bucket_fallback';
  person_data?: Record<string, unknown>;
  business_data?: Record<string, unknown>;
}

// ============================================
// SERVICE DOMAIN TYPES
// ============================================

export type LedgerEntryType = 'monthly_grant' | 'welcome_bonus' | 'addon_purchase' | 'task_deduction' | 'refund' | 'night_shift_deduction' | 'referral_bonus';

export type EventType =
  | 'task_created'
  | 'task_approved'
  | 'task_retried'
  | 'task_rejected'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'credit_purchased'
  | 'credit_deducted'
  | 'credits_depleted'
  | 'document_updated'
  | 'company_created'
  | 'chat_message'
  | 'night_shift_started'
  | 'night_shift_completed'
  | 'onboarding_stage'
  | 'onboarding_completed'
  | 'onboarding_failed'
  | 'credit_low'
  | 'tweet_scheduled'
  | 'referral_credited'
  | 'stripe_webhook_processed'
  | 'regression_detected'
  | 'infra_health_alert'
  | 'billing_audit_anomaly'
  | 'platform_ops_summary';



export type SuggestionStatus = 'pending' | 'accepted' | 'edited' | 'skipped';

export interface DocumentSuggestion {
  id: string;
  company_id: string;           // DB: company_id UUID NOT NULL
  document_id: string;
  task_id: string | null;       // DB: task_id (not source_task_id)
  suggested_content: string;
  reason: string | null;        // DB: reason (not reasoning)
  status: SuggestionStatus;
  created_at: string;
  reviewed_at: string | null;   // DB: reviewed_at TIMESTAMPTZ
}

export interface MemoryLayer {
  id: string;
  company_id: string;
  layer: MemoryLayerNumber;     // DB: layer INTEGER CHECK (1,2,3) — not layer_type string
  content: string | null;
  token_count: number;
  max_tokens: number;
  version: number;
  updated_at: string;
}

export type LearningConfidence = 'high' | 'medium' | 'low';
export type LearningType = 'success_pattern' | 'failure_pattern' | 'routing_insight' | 'tool_insight' | 'domain_knowledge';
export type LearningStatus = 'active' | 'superseded' | 'archived';

export interface Learning {
  id: string;
  company_id: string;
  task_id: string | null;
  agent_id: number | null;
  category: string;
  learning_type: LearningType;
  tags: string[];
  content: string;
  confidence: LearningConfidence;
  usage_count: number;
  last_referenced_at: string | null;
  status: LearningStatus;
  created_at: string;
}

export interface PlatformEvent {
  id: string;
  company_id: string;
  event_type: EventType;
  payload: Record<string, unknown>;
  is_public_safe: boolean;      // DB: is_public_safe (not is_public)
  created_at: string;
}

// ============================================
// ADDITIONAL DB-BACKED ENTITIES
// ============================================

export interface Subscription {
  id: string;
  user_id: string;                // DB: user_id UUID NOT NULL
  company_id: string | null;      // DB: company_id UUID (nullable)
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  plan_type: PlanTier;             // Matches runtime: trial | starter | growth | scale
  status: 'active' | 'past_due' | 'cancelled' | 'expired';  // DB: includes 'expired'
  trial_ends_at: string | null;   // DB: trial_ends_at TIMESTAMPTZ
  night_shifts_remaining: number;
  night_shifts_total: number;
  current_period_start: string | null;
  current_period_end: string | null;
  created_at: string;
}

export interface TaskExecution {
  id: string;
  task_id: string;
  agent_id: number;
  execution_mode: string;         // DB: execution_mode VARCHAR(50) NOT NULL
  status: 'running' | 'completed' | 'failed' | 'timed_out' | 'killed';  // DB: timed_out, killed
  turn_count: number;
  max_turns: number;              // DB: max_turns INTEGER NOT NULL
  started_at: string;
  completed_at: string | null;
  wall_clock_seconds: number | null;  // DB: wall_clock_seconds INTEGER
  token_usage: Record<string, unknown> | null;  // DB: token_usage JSONB
  error_summary: string | null;   // DB: error_summary (not error_message)
  watchdog_events: Record<string, unknown>[] | null;  // DB: JSONB[]
  verification_evidence: Record<string, unknown> | null;
  execution_log: Record<string, unknown>[] | null;  // DB: JSONB[]
  created_at: string;
}

// ============================================
// RUNTIME ENTITIES (SPEC-CTRL-102)
// ============================================

export interface Session {
  id: string;
  company_id: string;
  task_id: string;
  session_type: 'execution' | 'verification' | 'remediation';
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  context_packet_version: number;
  permission_snapshot: PermissionSnapshot | null;
  started_at: string;
  ended_at: string | null;
}

export interface Run {
  id: string;
  session_id: string;
  task_id: string;
  attempt_number: number;
  status: 'running' | 'completed' | 'failed' | 'timed_out' | 'killed';
  agent_id: number | null;
  execution_mode: ExecutionMode;
  started_at: string;
  ended_at: string | null;
  failure_class: FailureClass | null;
  turn_count: number;
  token_usage: Record<string, unknown> | null;
  wall_clock_seconds: number | null;
  error_summary: string | null;
  created_at: string;
}

export interface Artifact {
  id: string;
  run_id: string;
  task_id: string;
  artifact_type: 'report' | 'screenshot' | 'log' | 'receipt' | 'code';
  content_ref: string | null;
  evidence: Record<string, unknown> | null;
  created_at: string;
}

export interface ApprovalRecord {
  id: string;
  task_id: string;
  risk_class: string;
  approved_by: 'founder' | 'auto' | 'governance';
  approved_at: string;
  expires_at: string | null;
  status: 'active' | 'expired' | 'revoked';
}

// ============================================
// CONTEXT & PERMISSIONS (SPEC-CTRL-105)
// ============================================

export interface ContextPacket {
  memory_layers: {
    l1_domain_knowledge: string;
    l2_user_preferences: string;
    l3_cross_company: string;
  };
  prior_reports: Array<{ id: string; title: string; content: string; task_id: string }>;
  failure_fingerprints: Array<{ fingerprint: string; category: string; description: string }>;
  company_state: {
    stage: CompanyStage;
    lifecycle: Lifecycle;
    billing_state: BillingState;
  };
  compiled_briefing: string;
}

export interface PermissionSnapshot {
  tool_mount_profile: string[];
  allowed_tools: string[];
  forbidden_actions: string[];
  risk_ceiling: 'low' | 'medium' | 'high';
  max_turns: number;
}

// ============================================
// CREDIT QUOTE (SPEC-CEO-001)
// ============================================

export interface CreditQuote {
  credits_required: number;
  task_split: Array<{ title: string; description: string; tag: string }>;
  founder_safe_reason: string;
  included_scope: string;
  blockers: string[];
}

export interface RecurringTask {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  tag: string;
  cadence: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  monthly_credits_estimate: number;
  next_run_at: string;
  is_active: boolean;
  created_at: string;
}

export interface NightShiftCycle {
  id: string;
  company_id: string;
  cycle_number: number | null;      // DB: cycle_number INTEGER
  company_stage: string | null;     // DB: company_stage VARCHAR(50)
  trust_score: number | null;       // DB: trust_score DECIMAL(3,2)
  planned_tasks: string[] | null;   // DB: planned_tasks UUID[]
  executed_tasks: string[] | null;  // DB: executed_tasks UUID[]
  summary: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface FailureFingerprint {
  id: string;
  fingerprint: string;              // DB: fingerprint VARCHAR(255) (not fingerprint_hash)
  category: string | null;          // DB: category VARCHAR(100) — free text, not enum
  description: string | null;       // DB: description TEXT (not error_pattern)
  occurrence_count: number;
  affected_agents: number[] | null; // DB: affected_agents INTEGER[]
  affected_tools: string[] | null;  // DB: affected_tools VARCHAR(100)[]
  fix_status: 'open' | 'investigating' | 'fixed' | 'wont_fix';
  regression_sensitive: boolean;    // DB: regression_sensitive BOOLEAN
  root_cause: string | null;        // DB: root_cause TEXT
  fix_notes: string | null;         // DB: fix_notes TEXT
  fix_applied_at: string | null;    // DB: fix_applied_at TIMESTAMPTZ
  first_seen_at: string;
  last_seen_at: string;
}

export interface EmailThread {
  id: string;
  company_id: string;
  thread_id: string | null;
  subject: string | null;
  from_address: string;
  to_address: string;
  direction: 'inbound' | 'outbound';
  body: string | null;              // Drizzle: body TEXT
  external_id: string | null;       // Drizzle: external_id VARCHAR(255)
  is_read: boolean;                 // Drizzle: is_read BOOLEAN DEFAULT false
  parent_id: string | null;         // Drizzle: parent_id UUID
  created_at: string;
}

export interface Contact {
  id: string;
  company_id: string;
  email: string | null;             // DB: email VARCHAR(255) — nullable
  name: string | null;
  source: string | null;
  lead_status: 'pending' | 'contacted' | 'replied' | 'responded' | 'meeting' | 'dead';  // DB values
  email_verified: boolean;
  last_contacted_at: string | null; // DB: last_contacted_at TIMESTAMPTZ
  created_at: string;
  // NOTE: DB has no 'notes' column
}

export interface BrowserCredential {
  id: string;
  company_id: string;
  site_domain: string;
  site_tier: 1 | 2 | 3;            // DB: site_tier INTEGER DEFAULT 3
  username: string | null;
  password_encrypted: string | null; // DB: password_encrypted BYTEA (not encrypted_password)
  browser_context_id: string | null;
  created_at: string;
  // NOTE: DB has no updated_at column on browser_credentials
}

export interface AdCampaign {
  id: string;
  company_id: string;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_ad_id: string | null;
  external_id: string | null;       // Drizzle: external_id VARCHAR(255)
  platform: string | null;          // Drizzle: platform VARCHAR(50) DEFAULT 'meta'
  status: 'draft' | 'active' | 'paused' | 'completed';
  daily_budget: number;
  total_spend: number;
  spend: number;                    // Drizzle: spend DECIMAL
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  creative_url: string | null;
  placements: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface Referral {
  id: string;
  referrer_id: string;              // DB: referrer_id (not referrer_user_id)
  referred_id: string;              // DB: referred_id (not referred_user_id)
  status: 'signed_up' | 'trial' | 'subscribed' | 'credited';  // DB values
  credits_awarded: number;
  created_at: string;
  converted_at: string | null;      // DB: converted_at TIMESTAMPTZ
  // NOTE: DB has no 'referral_code' column on referrals table
}

// ============================================
// AGENT RUNTIME TYPES (Phase 4-5)
// ============================================

export interface AgentInstance {
  agentId: number;
  taskId: string;
  model: string;
  maxTurns: number;
  systemPrompt: string;
  tools: unknown[];
}

export interface CompiledBriefing {
  task: Task;
  company_context: {
    name: string;
    slug: string;
    one_liner: string | null;
    stage: CompanyStage;
  };
  memory_packet: string;
  template_vars: Record<string, string>;
  tool_surface: string[];
  skill_files: string[];
  instance_context: Record<string, unknown> | null;
}

export interface WatchdogEvent {
  timestamp: string;
  type: 'progress' | 'idle_warning' | 'stuck_detected' | 'killed' | 'loop_detected';
  tool: string | null;
  message: string;
}

export type CreditPack = {
  credits: number;
  price_cents: number;
  label: string;
};

// ============================================
// CHAT TYPES (Phase 4)
// ============================================

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatAction[];
  created_at: string;
}

export type ChatAction =
  | {
      type: 'task_proposal';
      data: TaskProposal;
    }
  | {
      type: 'credit_quote';
      data: { balance: number; recent: CreditLedgerEntry[] };
    }
  | {
      type: 'task_approved';
      data: { task_id: string; title: string };
    }
  | {
      type: 'document_updated';
      data: { doc_type: unknown };
    };

/** Founder-facing task proposal (no internal execution details) */
export interface TaskProposal {
  task_id: string;
  title: string;
  description: string | null;
  tag: string;
  estimated_credits: number;
  agent_name: string;       // founder-friendly label (from FOUNDER_AGENT_LABELS)
  explanation: string;
}

/** Internal task proposal with governance metadata (never sent to frontend) */
export interface TaskProposalInternal extends TaskProposal {
  execution_mode: ExecutionMode;
  verification_level: VerificationLevel;
}

export interface CreditLedgerEntry {
  id: string;
  company_id: string;
  amount: number;
  balance_after: number | null;
  entry_type: LedgerEntryType;
  description: string | null;
  task_id: string | null;
  created_at: string;
}

// ── Streaming Events ──

export type CEOStreamEvent =
  | { type: 'text'; content: string }
  | { type: 'action'; action: ChatAction }
  | { type: 'done' };
