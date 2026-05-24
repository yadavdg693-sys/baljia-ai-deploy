// Drizzle ORM Schema — mirrors all 35 Baljia tables
// Generated from docs/legacy/supabase/migrations/00001-00004 (migrated to Neon/Drizzle)

import {
  pgTable, uuid, text, varchar, integer, boolean,
  timestamp, decimal, jsonb, index, uniqueIndex,
  serial, date,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ══════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  twitter_handle: varchar('twitter_handle', { length: 100 }),
  auth_provider: varchar('auth_provider', { length: 50 }).default('magic_link'),
  google_id: varchar('google_id', { length: 255 }).unique(),
  openai_codex_id: varchar('openai_codex_id', { length: 255 }).unique(),
  email_verified: boolean('email_verified').default(false),
  timezone: varchar('timezone', { length: 50 }),
  locale: varchar('locale', { length: 10 }),
  ip_country: varchar('ip_country', { length: 5 }),
  device_type: varchar('device_type', { length: 50 }),
  referral_source: varchar('referral_source', { length: 255 }),
  referral_code: varchar('referral_code', { length: 50 }).unique(),
  referred_by: uuid('referred_by'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ══════════════════════════════════════════════
// MAGIC LINK TOKENS
// ══════════════════════════════════════════════
export const magicLinkTokens = pgTable('magic_link_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  used_at: timestamp('used_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_magic_link_token').on(table.token),
]);

// ══════════════════════════════════════════════
// WAITLIST — pre-auth email capture before onboarding
// ══════════════════════════════════════════════
export const waitlist = pgTable('waitlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull(),
  onboarding_intent: varchar('onboarding_intent', { length: 50 }),  // surprise_me, build_my_idea, grow_my_company
  idea_text: text('idea_text'),
  business_website: varchar('business_website', { length: 500 }),
  timezone: varchar('timezone', { length: 100 }),
  ip_address: varchar('ip_address', { length: 45 }),
  converted_user_id: uuid('converted_user_id').references(() => users.id),
  converted_company_id: uuid('converted_company_id'),
  status: varchar('status', { length: 20 }).default('pending').notNull(), // pending, converted, expired
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ══════════════════════════════════════════════
// COMPANIES
// ══════════════════════════════════════════════
export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  owner_id: uuid('owner_id').references(() => users.id),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  one_liner: text('one_liner'),
  original_idea: text('original_idea'),
  design_system: varchar('design_system', { length: 100 }),
  claim_status: varchar('claim_status', { length: 50 }).default('owned'),
  onboarding_status: varchar('onboarding_status', { length: 50 }).default('initializing'),
  onboarding_journey: varchar('onboarding_journey', { length: 50 }),  // surprise_me, build_my_idea, grow_my_company — persisted for pending_auth resume
  plan_tier: varchar('plan_tier', { length: 50 }).default('free'),
  lifecycle: varchar('lifecycle', { length: 50 }).default('trial_active'),
  execution_state: varchar('execution_state', { length: 50 }).default('active'),
  billing_state: varchar('billing_state', { length: 50 }).default('free'),
  hosting_state: varchar('hosting_state', { length: 50 }).default('live'),
  subdomain: varchar('subdomain', { length: 255 }),
  email_identity: varchar('email_identity', { length: 255 }),
  github_repo: varchar('github_repo', { length: 255 }),
  render_service_id: varchar('render_service_id', { length: 255 }),
  neon_database_id: varchar('neon_database_id', { length: 255 }),
  neon_connection_string: text('neon_connection_string'),
  custom_domain: varchar('custom_domain', { length: 255 }),
  company_email: varchar('company_email', { length: 255 }),
  timezone: varchar('timezone', { length: 50 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('idx_companies_owner').on(t.owner_id),
  index('idx_companies_lifecycle').on(t.lifecycle),
]);

// ══════════════════════════════════════════════
// AGENTS
// ══════════════════════════════════════════════
export const agents = pgTable('agents', {
  id: integer('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  role: varchar('role', { length: 255 }),
  base_system_prompt: text('base_system_prompt'),
  default_max_turns: integer('default_max_turns').default(200),
  default_model: varchar('default_model', { length: 100 }).default('claude-sonnet-4-20250514'),
  execution_style: varchar('execution_style', { length: 50 }).default('agentic'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ══════════════════════════════════════════════
// TASKS
// ══════════════════════════════════════════════
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  tag: varchar('tag', { length: 50 }).notNull(),
  task_type: varchar('task_type', { length: 50 }),
  status: varchar('status', { length: 50 }).default('todo'),
  priority: integer('priority').default(0),
  complexity: integer('complexity'),
  queue_order: integer('queue_order'),
  source: varchar('source', { length: 50 }).default('founder_requested'),
  suggestion_reasoning: text('suggestion_reasoning'),
  executability_type: varchar('executability_type', { length: 50 }).default('can_run_now'),
  execution_mode: varchar('execution_mode', { length: 50 }),
  assigned_to_agent_id: integer('assigned_to_agent_id').references(() => agents.id),
  execution_contract: jsonb('execution_contract').$type<Record<string, unknown>>(),
  estimated_hours: decimal('estimated_hours', { precision: 4, scale: 1 }),
  estimated_credits: integer('estimated_credits').default(1),
  actual_credits_charged: integer('actual_credits_charged').default(0),
  verification_level: varchar('verification_level', { length: 50 }),
  refund_policy: varchar('refund_policy', { length: 50 }).default('no_refund'),
  failure_class: varchar('failure_class', { length: 50 }),
  related_task_ids: jsonb('related_task_ids').$type<string[]>(), // UUID[] stored as JSON array
  run_link: varchar('run_link', { length: 500 }),
  markdown_link: varchar('markdown_link', { length: 500 }),
  authorized_by: varchar('authorized_by', { length: 50 }),  // 'founder', 'night_shift', 'recurring', 'remediation', 'system'
  authorization_reason: text('authorization_reason'),       // human-readable: "Founder approved via dashboard", "Night shift gap-fill", etc.
  max_turns: integer('max_turns').default(200),
  turn_count: integer('turn_count').default(0),
  repair_attempt_count: integer('repair_attempt_count').default(0), // SPEC-CTRL-106: max 100 per scope
  started_at: timestamp('started_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  // ── Durable execution lease (2026-04-24) ──
  // lease_holder: worker instance id (hostname + PID + random) that currently
  //   owns the task. NULL if unclaimed.
  // lease_expires_at: when the lease auto-expires. Worker extends via heartbeat.
  //   If worker crashes, lease expires and reclaim cron/another worker can pick up.
  // attempt_count: total number of claims (for retry bounds — stop after N crashes).
  lease_holder: varchar('lease_holder', { length: 255 }),
  lease_expires_at: timestamp('lease_expires_at', { withTimezone: true }),
  attempt_count: integer('attempt_count').default(0),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_tasks_company').on(t.company_id),
  index('idx_tasks_status').on(t.status),
  index('idx_tasks_company_status').on(t.company_id, t.status),
  index('idx_tasks_company_order').on(t.company_id, t.queue_order),
  // Worker claim index: partial index on (status, lease_expires_at) filtered to
  // todo + reclaimable. Dramatically speeds up worker polling at scale.
  index('idx_tasks_claim').on(t.status, t.lease_expires_at),
]);

// ══════════════════════════════════════════════
// TASK EXECUTIONS
// ══════════════════════════════════════════════
export const taskDrafts = pgTable('task_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  tag: varchar('tag', { length: 50 }).notNull(),
  priority: integer('priority').default(50),
  source: varchar('source', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).default('pending_ceo_review').notNull(),
  suggestion_reasoning: text('suggestion_reasoning'),
  proposed_task: jsonb('proposed_task').$type<Record<string, unknown>>(),
  proposed_execution_contract: jsonb('proposed_execution_contract').$type<Record<string, unknown>>(),
  reviewed_task_id: uuid('reviewed_task_id').references(() => tasks.id),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_task_drafts_company').on(t.company_id),
  index('idx_task_drafts_company_status').on(t.company_id, t.status),
]);

export const taskExecutions = pgTable('task_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  agent_id: integer('agent_id').notNull().references(() => agents.id),
  execution_mode: varchar('execution_mode', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).default('running'),
  turn_count: integer('turn_count').default(0),
  max_turns: integer('max_turns').notNull(),
  started_at: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  wall_clock_seconds: integer('wall_clock_seconds'),
  token_usage: jsonb('token_usage'),
  error_summary: text('error_summary'),
  watchdog_events: jsonb('watchdog_events').$type<Record<string, unknown>[]>(),
  verification_evidence: jsonb('verification_evidence'),
  execution_log: jsonb('execution_log').$type<Record<string, unknown>[]>(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_executions_task').on(t.task_id),
  index('idx_executions_status').on(t.status),
]);

// ══════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  task_id: uuid('task_id').references(() => tasks.id),
  title: varchar('title', { length: 500 }),
  content: text('content'),
  report_type: varchar('report_type', { length: 50 }),
  structured_data: jsonb('structured_data'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_reports_company').on(t.company_id),
  index('idx_reports_task').on(t.task_id),
]);

// ══════════════════════════════════════════════
// DOCUMENTS
// ══════════════════════════════════════════════
export const usageEvents = pgTable('usage_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  user_id: varchar('user_id', { length: 255 }),
  app_slug: varchar('app_slug', { length: 255 }).notNull(),
  package_name: varchar('package_name', { length: 255 }).notNull(),
  feature: varchar('feature', { length: 255 }).notNull(),
  units: integer('units').default(1),
  cost_usd: decimal('cost_usd', { precision: 12, scale: 6 }).default('0'),
  status: varchar('status', { length: 50 }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_usage_events_company').on(t.company_id),
  index('idx_usage_events_company_created').on(t.company_id, t.created_at),
  index('idx_usage_events_package').on(t.package_name),
]);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  doc_type: varchar('doc_type', { length: 50 }).notNull(),
  title: varchar('title', { length: 500 }),
  content: text('content'),
  source: varchar('source', { length: 50 }),
  version: integer('version').default(1),
  is_empty: boolean('is_empty').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_documents_company').on(t.company_id),
]);

// ══════════════════════════════════════════════
// DOCUMENT SUGGESTIONS
// ══════════════════════════════════════════════
export const documentSuggestions = pgTable('document_suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  document_id: uuid('document_id').notNull().references(() => documents.id),
  task_id: uuid('task_id').references(() => tasks.id),
  suggested_content: text('suggested_content').notNull(),
  reason: text('reason'),
  status: varchar('status', { length: 50 }).default('pending'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
});

// ══════════════════════════════════════════════
// MEMORY LAYERS
// ══════════════════════════════════════════════
export const memoryLayers = pgTable('memory_layers', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  layer: integer('layer').notNull(),
  content: text('content'),
  token_count: integer('token_count').default(0),
  max_tokens: integer('max_tokens').notNull(),
  version: integer('version').default(1),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('idx_memory_company_layer').on(t.company_id, t.layer),
]);

// ══════════════════════════════════════════════
// LEARNINGS
// ══════════════════════════════════════════════
export const learnings = pgTable('learnings', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  task_id: uuid('task_id').references(() => tasks.id),
  agent_id: integer('agent_id').references(() => agents.id),
  category: varchar('category', { length: 100 }),
  // SPEC-CTRL-105: learning_type classification
  learning_type: varchar('learning_type', { length: 50 }).default('domain_knowledge'),
  tags: jsonb('tags').$type<string[]>(),
  content: text('content').notNull(),
  confidence: varchar('confidence', { length: 20 }).default('medium'),
  // SPEC-CTRL-105: usage tracking
  usage_count: integer('usage_count').default(0),
  last_referenced_at: timestamp('last_referenced_at', { withTimezone: true }),
  // SPEC-CTRL-105: lifecycle status (active | superseded | archived)
  status: varchar('status', { length: 20 }).default('active'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_learnings_company').on(t.company_id),
]);

// ══════════════════════════════════════════════
// SUBSCRIPTIONS
// ══════════════════════════════════════════════
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull().references(() => users.id),
  company_id: uuid('company_id').references(() => companies.id),
  stripe_subscription_id: varchar('stripe_subscription_id', { length: 255 }),
  stripe_customer_id: varchar('stripe_customer_id', { length: 255 }),
  plan_type: varchar('plan_type', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).default('active'),
  trial_ends_at: timestamp('trial_ends_at', { withTimezone: true }),
  night_shifts_remaining: integer('night_shifts_remaining').default(0),
  night_shifts_total: integer('night_shifts_total').default(0),
  current_period_start: timestamp('current_period_start', { withTimezone: true }),
  current_period_end: timestamp('current_period_end', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ══════════════════════════════════════════════
// CREDIT LEDGER
// ══════════════════════════════════════════════
export const creditLedger = pgTable('credit_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  entry_type: varchar('entry_type', { length: 50 }).notNull(),
  amount: integer('amount').notNull(),
  balance_after: integer('balance_after').notNull(),
  task_id: uuid('task_id').references(() => tasks.id),
  description: text('description'),
  idempotency_key: varchar('idempotency_key', { length: 100 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_credit_ledger_company').on(t.company_id),
  uniqueIndex('idx_credit_ledger_idempotency').on(t.idempotency_key),
]);

// ══════════════════════════════════════════════
// REVENUE LEDGER
// ══════════════════════════════════════════════
export const revenueLedger = pgTable('revenue_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  entry_type: varchar('entry_type', { length: 50 }).notNull(),
  gross_amount: decimal('gross_amount', { precision: 10, scale: 2 }),
  net_amount: decimal('net_amount', { precision: 10, scale: 2 }),
  platform_fee_rate: decimal('platform_fee_rate', { precision: 3, scale: 2 }).default('0.20'),
  stripe_charge_id: varchar('stripe_charge_id', { length: 255 }),
  description: text('description'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ══════════════════════════════════════════════
// AD CAMPAIGNS
// ══════════════════════════════════════════════
export const adCampaigns = pgTable('ad_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  meta_campaign_id: varchar('meta_campaign_id', { length: 255 }),
  meta_adset_id: varchar('meta_adset_id', { length: 255 }),
  meta_ad_id: varchar('meta_ad_id', { length: 255 }),
  external_id: varchar('external_id', { length: 255 }),
  platform: varchar('platform', { length: 50 }).default('meta'),
  status: varchar('status', { length: 50 }).default('draft'),
  daily_budget: decimal('daily_budget', { precision: 10, scale: 2 }),
  total_spend: decimal('total_spend', { precision: 10, scale: 2 }).default('0'),
  spend: decimal('spend', { precision: 10, scale: 2 }).default('0'),
  impressions: integer('impressions').default(0),
  clicks: integer('clicks').default(0),
  ctr: decimal('ctr', { precision: 5, scale: 4 }),
  cpc: decimal('cpc', { precision: 10, scale: 2 }),
  creative_url: varchar('creative_url', { length: 500 }),
  placements: jsonb('placements').$type<string[]>(), // stored as JSON array
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ══════════════════════════════════════════════
// AD SPEND LEDGER
// ══════════════════════════════════════════════
export const adSpendLedger = pgTable('ad_spend_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  campaign_id: uuid('campaign_id').references(() => adCampaigns.id),
  daily_budget: decimal('daily_budget', { precision: 10, scale: 2 }),
  actual_spend: decimal('actual_spend', { precision: 10, scale: 2 }),
  platform_fee: decimal('platform_fee', { precision: 10, scale: 2 }),
  charge_date: date('charge_date'),
  stripe_charge_id: varchar('stripe_charge_id', { length: 255 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ══════════════════════════════════════════════
// REFUND HISTORY
// ══════════════════════════════════════════════
export const refundHistory = pgTable('refund_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  task_id: uuid('task_id').references(() => tasks.id),
  failure_class: varchar('failure_class', { length: 50 }),
  decision: varchar('decision', { length: 50 }).notNull(),
  reason: text('reason'),
  credits_refunded: integer('credits_refunded').default(0),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ══════════════════════════════════════════════
// REFERRALS
// ══════════════════════════════════════════════
export const referrals = pgTable('referrals', {
  id: uuid('id').primaryKey().defaultRandom(),
  referrer_id: uuid('referrer_id').notNull().references(() => users.id),
  referred_id: uuid('referred_id').notNull().references(() => users.id),
  status: varchar('status', { length: 50 }).default('signed_up'),
  credits_awarded: integer('credits_awarded').default(0),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  converted_at: timestamp('converted_at', { withTimezone: true }),
});

// ══════════════════════════════════════════════
// RECURRING TASKS
// ══════════════════════════════════════════════
export const recurringTasks = pgTable('recurring_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  tag: varchar('tag', { length: 50 }).notNull(),
  priority: integer('priority').default(0),
  cadence: varchar('cadence', { length: 50 }).notNull(),
  monthly_credits_estimate: integer('monthly_credits_estimate'),
  is_active: boolean('is_active').default(true),
  last_run_at: timestamp('last_run_at', { withTimezone: true }),
  next_run_at: timestamp('next_run_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ══════════════════════════════════════════════
// NIGHT SHIFT CYCLES
// ══════════════════════════════════════════════
export const nightShiftCycles = pgTable('night_shift_cycles', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  cycle_number: integer('cycle_number'),
  trust_score: decimal('trust_score', { precision: 3, scale: 2 }),
  planned_tasks: jsonb('planned_tasks').$type<string[]>(), // UUID[] stored as JSON
  executed_tasks: jsonb('executed_tasks').$type<string[]>(),
  summary: text('summary'),
  started_at: timestamp('started_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ══════════════════════════════════════════════
// EMAIL THREADS
// ══════════════════════════════════════════════
export const emailThreads = pgTable('email_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  thread_id: varchar('thread_id', { length: 255 }),
  subject: varchar('subject', { length: 500 }),
  from_address: varchar('from_address', { length: 255 }),
  to_address: varchar('to_address', { length: 255 }),
  direction: varchar('direction', { length: 10 }),
  body: text('body'),
  external_id: varchar('external_id', { length: 255 }),
  is_read: boolean('is_read').default(false),
  parent_id: uuid('parent_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_email_threads_company').on(t.company_id),
]);

// ══════════════════════════════════════════════
// CONTACTS
// ══════════════════════════════════════════════
export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  email: varchar('email', { length: 255 }),
  name: varchar('name', { length: 255 }),
  source: varchar('source', { length: 50 }),
  lead_status: varchar('lead_status', { length: 50 }).default('pending'),
  email_verified: boolean('email_verified').default(false),
  last_contacted_at: timestamp('last_contacted_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_contacts_company').on(t.company_id),
  // Required for the onConflictDoUpdate target in add_contact handlers
  // (support.tools.ts + outreach.tools.ts). Without this, INSERT ... ON CONFLICT
  // (company_id, email) fails with Postgres 42P10. NULL emails are allowed
  // multiple times — UNIQUE on a nullable column treats NULLs as distinct.
  uniqueIndex('idx_contacts_company_email_unique').on(t.company_id, t.email),
]);

// ══════════════════════════════════════════════
// BROWSER CREDENTIALS
// ══════════════════════════════════════════════
export const browserCredentials = pgTable('browser_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  site_domain: varchar('site_domain', { length: 255 }).notNull(),
  site_tier: integer('site_tier').default(3),
  username: varchar('username', { length: 255 }),
  password_encrypted: text('password_encrypted'), // bytea → text for Drizzle compat
  browser_context_id: varchar('browser_context_id', { length: 255 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('idx_browser_creds_unique').on(t.company_id, t.site_domain),
]);

// ══════════════════════════════════════════════
// DOMAIN SKILLS — cross-task memory of site selectors / patterns / traps
// Browser Agent reads before navigating; records after a successful interaction.
// ══════════════════════════════════════════════
export const domainSkills = pgTable('domain_skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  site_domain: varchar('site_domain', { length: 255 }).notNull(),
  skill_kind: varchar('skill_kind', { length: 50 }).notNull(), // 'selector' | 'url_pattern' | 'wait' | 'trap' | 'note'
  key: varchar('key', { length: 255 }).notNull(),               // e.g. 'login_button', 'home_url', 'captcha_appears_at'
  value: text('value').notNull(),                                // the actual selector / URL pattern / instruction
  confidence: integer('confidence').default(50),                 // 0-100, increments on success / decrements on miss
  last_used_at: timestamp('last_used_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('idx_domain_skills_unique').on(t.company_id, t.site_domain, t.skill_kind, t.key),
  index('idx_domain_skills_lookup').on(t.company_id, t.site_domain),
]);

// ══════════════════════════════════════════════
// PROVIDER BOOTSTRAP PACKS — pre-built signup recipes (global, not per-company)
// Browser Agent reads via start_provider_pack(provider_id) when tasked with
// provisioning an API key from a known SaaS provider.
// ══════════════════════════════════════════════
export const providerPacks = pgTable('provider_packs', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider_id: varchar('provider_id', { length: 100 }).notNull().unique(), // 'openai' | 'stripe' | 'github' | etc.
  display_name: varchar('display_name', { length: 200 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),                  // 'llm' | 'payments' | 'hosting' | 'devtools' | 'observability' | 'storage'
  signup_url: varchar('signup_url', { length: 500 }).notNull(),
  api_key_url: varchar('api_key_url', { length: 500 }),                     // where the API key is generated post-signup
  steps: jsonb('steps').$type<Array<{ kind: string; instruction: string; selector?: string; expected?: string }>>().notNull(),
  api_key_env_var: varchar('api_key_env_var', { length: 100 }),             // canonical env var name, e.g. 'OPENAI_API_KEY'
  notes: text('notes'),                                                      // gotchas, free tier limits, manual checkpoints
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_provider_packs_category').on(t.category),
]);

// ══════════════════════════════════════════════
// FAILURE FINGERPRINTS
// ══════════════════════════════════════════════
export const failureFingerprints = pgTable('failure_fingerprints', {
  id: uuid('id').primaryKey().defaultRandom(),
  fingerprint: varchar('fingerprint', { length: 255 }).notNull().unique(),
  category: varchar('category', { length: 100 }),
  description: text('description'),
  occurrence_count: integer('occurrence_count').default(1),
  affected_agents: jsonb('affected_agents').$type<number[]>(), // int[] stored as JSON
  affected_tools: jsonb('affected_tools').$type<string[]>(),  // text[] stored as JSON
  fix_status: varchar('fix_status', { length: 50 }).default('open'),
  regression_sensitive: boolean('regression_sensitive').default(false),
  root_cause: text('root_cause'),
  fix_notes: text('fix_notes'),
  fix_applied_at: timestamp('fix_applied_at', { withTimezone: true }),
  first_seen_at: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
});

// ══════════════════════════════════════════════
// TASK FAILURE LINKS
// ══════════════════════════════════════════════
export const taskFailureLinks = pgTable('task_failure_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  fingerprint_id: uuid('fingerprint_id').notNull().references(() => failureFingerprints.id),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ══════════════════════════════════════════════
// MCP SERVERS
// ══════════════════════════════════════════════
export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  category: varchar('category', { length: 50 }),
  tool_count: integer('tool_count'),
  is_available: boolean('is_available').default(true),
  requires_oauth: boolean('requires_oauth').default(false),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ══════════════════════════════════════════════
// MCP TOOLS
// ══════════════════════════════════════════════
export const mcpTools = pgTable('mcp_tools', {
  id: uuid('id').primaryKey().defaultRandom(),
  server_id: uuid('server_id').notNull().references(() => mcpServers.id),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  risk_level: varchar('risk_level', { length: 20 }).default('low'),
  requires_approval: boolean('requires_approval').default(false),
}, (t) => [
  uniqueIndex('idx_mcp_tools_unique').on(t.server_id, t.name),
]);

// ══════════════════════════════════════════════
// AGENT TOOL MOUNTS
// ══════════════════════════════════════════════
export const agentToolMounts = pgTable('agent_tool_mounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent_id: integer('agent_id').notNull().references(() => agents.id),
  mcp_server_id: uuid('mcp_server_id').notNull().references(() => mcpServers.id),
  is_required: boolean('is_required').default(false),
  requires_oauth: boolean('requires_oauth').default(false),
}, (t) => [
  uniqueIndex('idx_agent_tool_mounts_unique').on(t.agent_id, t.mcp_server_id),
]);

// ══════════════════════════════════════════════
// CHAT SESSIONS
// ══════════════════════════════════════════════
export const chatSessions = pgTable('chat_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  user_id: uuid('user_id').notNull().references(() => users.id),
  messages: jsonb('messages').$type<Record<string, unknown>[]>(),
  message_count: integer('message_count').default(0),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_chat_sessions_company').on(t.company_id),
]);

// ══════════════════════════════════════════════
// PLATFORM EVENTS
// ══════════════════════════════════════════════
export const platformEvents = pgTable('platform_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  event_type: varchar('event_type', { length: 100 }).notNull(),
  company_id: uuid('company_id').references(() => companies.id),
  payload: jsonb('payload').notNull(),
  // Physical column renamed to `is_public` in migration 00002; JS field kept as is_public_safe.
  is_public_safe: boolean('is_public').default(false),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_events_company').on(t.company_id),
  index('idx_events_type').on(t.event_type),
]);

// ══════════════════════════════════════════════
// DASHBOARD LINKS (CEO tool)
// ══════════════════════════════════════════════
export const promoVideoJobs = pgTable('promo_video_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  task_id: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 50 }).notNull().default('queued'),
  goal: varchar('goal', { length: 50 }).notNull(),
  duration_seconds: integer('duration_seconds').notNull(),
  aspect_ratio: varchar('aspect_ratio', { length: 20 }).notNull(),
  style: varchar('style', { length: 50 }).notNull(),
  visual_mode: varchar('visual_mode', { length: 50 }).notNull().default('actual_site'),
  voice_mode: varchar('voice_mode', { length: 50 }).notNull(),
  cta: text('cta'),
  brief: jsonb('brief').$type<Record<string, unknown>>(),
  storyboard: jsonb('storyboard').$type<Record<string, unknown>>(),
  capture_assets: jsonb('capture_assets').$type<Record<string, unknown>[]>(),
  ai_usage: jsonb('ai_usage').$type<Record<string, unknown>>(),
  preview_key: text('preview_key'),
  preview_url: text('preview_url'),
  audio_key: text('audio_key'),
  audio_url: text('audio_url'),
  output_key: text('output_key'),
  output_url: text('output_url'),
  thumbnail_key: text('thumbnail_key'),
  thumbnail_url: text('thumbnail_url'),
  error_message: text('error_message'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  index('idx_promo_video_jobs_company').on(t.company_id),
  index('idx_promo_video_jobs_task').on(t.task_id),
  index('idx_promo_video_jobs_status').on(t.status),
  index('idx_promo_video_jobs_company_created').on(t.company_id, t.created_at),
]);

export const dashboardLinks = pgTable('dashboard_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  label: text('label').notNull(),
  url: text('url').notNull(),
  icon: text('icon'),
  sort_order: integer('sort_order').default(0),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_dashboard_links_company').on(t.company_id),
  uniqueIndex('idx_dashboard_links_unique').on(t.company_id, t.label),
]);

// ══════════════════════════════════════════════
// PLATFORM FEEDBACK (CEO tool + agent report_bug)
// ══════════════════════════════════════════════
// status values:
//   'open'              — initial
//   'awaiting_approval' — triage agent has diagnosed, waiting on Gate 1 (human approve)
//   'approved_to_fix'   — human approved Gate 1; writer agent will pick this up
//   'pr_open'           — writer agent opened a PR; verifier reviewed
//   'resolved'          — PR merged + bug repro confirms no longer reproduces
//   'rejected'          — human rejected at Gate 1 or Gate 2
//   'wont_fix'          — explicit decision to leave as-is
export const platformFeedback = pgTable('platform_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  severity: text('severity').default('medium'),
  status: text('status').default('open'),
  source: text('source').default('user'), // 'user' | 'agent' | 'system' | 'onboarding'
  area: text('area'),                     // e.g. 'onboarding', 'billing', 'dashboard'
  fingerprint: text('fingerprint'),       // stable key for de-duping system-detected issues
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  occurrence_count: integer('occurrence_count').default(1),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
  // Phase-A additive columns (additive-only — no rename, no DROP):
  diagnosis: text('diagnosis'),                                    // triage agent's root-cause writeup (denormalized for UI)
  estimated_risk: text('estimated_risk'),                          // 'low' | 'medium' | 'high'
  ops_run_id: uuid('ops_run_id'),                                  // FK to platform_ops_runs.id (latest run that addressed this bug)
  resolution: text('resolution'),                                  // 'auto_fixed' | 'auto_couldnt_fix' | 'manual' | 'rejected' | 'wont_fix'
  reproduced_at: timestamp('reproduced_at', { withTimezone: true }),  // when triage agent last confirmed this bug reproduces
  approved_at: timestamp('approved_at', { withTimezone: true }),   // Gate 1 timestamp
  approved_by: text('approved_by'),                                // 'human:<email>' or 'auto'
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_platform_feedback_company').on(t.company_id),
  index('idx_platform_feedback_status').on(t.status),
  index('idx_platform_feedback_source_status').on(t.source, t.status),
  index('idx_platform_feedback_area').on(t.area),
  index('idx_platform_feedback_fingerprint').on(t.fingerprint),
]);

// ══════════════════════════════════════════════
// PLATFORM OPS RUNS — full audit trail of self-healing agent activity
// One platform_feedback bug produces multiple rows here (triage, writer,
// verifier phases each get their own row). Read-only for platform; written
// only by the platform-ops service. Never linked to any founder data.
// ══════════════════════════════════════════════
export const platformOpsRuns = pgTable('platform_ops_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  feedback_id: uuid('feedback_id').notNull().references(() => platformFeedback.id),
  agent_role: text('agent_role').notNull(),         // 'triage' | 'writer' | 'verifier'
  phase: text('phase').notNull(),                   // 'reproduce' | 'diagnose' | 'fix' | 'test' | 'pr' | 'review' | 'merge'
  status: text('status').notNull().default('running'),  // 'running' | 'done' | 'failed' | 'skipped'

  // Diagnosis fields (triage)
  diagnosis: text('diagnosis'),
  root_cause: text('root_cause'),
  files_to_modify: jsonb('files_to_modify'),        // string[]
  estimated_risk: text('estimated_risk'),           // 'low' | 'medium' | 'high'
  reproduces: boolean('reproduces'),                // true if bug still reproduces, false if stale

  // Fix fields (writer)
  branch_name: text('branch_name'),
  commit_sha: text('commit_sha'),
  diff_hash: text('diff_hash'),                     // sha256 of the diff
  pr_url: text('pr_url'),
  pr_number: integer('pr_number'),

  // Test/repro evidence
  repro_evidence: jsonb('repro_evidence'),          // {before, after} reproductions
  test_evidence: jsonb('test_evidence'),            // test scripts run + outputs

  // Verifier fields
  verifier_vote: text('verifier_vote'),             // 'approve' | 'reject' | 'needs_changes'
  verifier_reasoning: text('verifier_reasoning'),

  // Operational accounting
  turns: integer('turns'),
  wall_clock_seconds: integer('wall_clock_seconds'),
  cost_cents: integer('cost_cents'),
  llm_provider: text('llm_provider'),
  llm_model: text('llm_model'),
  error_summary: text('error_summary'),

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  index('idx_platform_ops_runs_feedback').on(t.feedback_id),
  index('idx_platform_ops_runs_status').on(t.status),
  index('idx_platform_ops_runs_role_phase').on(t.agent_role, t.phase),
]);

// ══════════════════════════════════════════════
// TWEETS (CEO + Twitter agent)
// ══════════════════════════════════════════════
export const tweets = pgTable('tweets', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  tweet_id: text('tweet_id'),
  text: text('text').notNull(),
  status: text('status').default('posted'),
  scheduled_for: timestamp('scheduled_for', { withTimezone: true }),
  posted_at: timestamp('posted_at', { withTimezone: true }).defaultNow(),
  task_id: uuid('task_id').references(() => tasks.id),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_tweets_company').on(t.company_id),
]);

// ══════════════════════════════════════════════
// ROADMAPS — one per company, archetype-driven
// ══════════════════════════════════════════════
export const roadmaps = pgTable('roadmaps', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  archetype: varchar('archetype', { length: 50 }).notNull().default('saas'),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 50 }).notNull().default('active'),
  current_phase: integer('current_phase').notNull().default(1),
  total_phases: integer('total_phases').notNull().default(5),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('idx_roadmaps_company').on(t.company_id),
  index('idx_roadmaps_status').on(t.status),
]);

// ══════════════════════════════════════════════
// MILESTONES — ordered list per roadmap
// ══════════════════════════════════════════════
export const milestones = pgTable('milestones', {
  id: uuid('id').primaryKey().defaultRandom(),
  roadmap_id: uuid('roadmap_id').notNull().references(() => roadmaps.id, { onDelete: 'cascade' }),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  phase: integer('phase').notNull(),
  sort_order: integer('sort_order').notNull().default(0),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  suggested_task_tags: jsonb('suggested_task_tags').$type<string[]>().default([]),
  night_shift_hint: text('night_shift_hint'),
  started_at: timestamp('started_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_milestones_roadmap').on(t.roadmap_id),
  index('idx_milestones_company').on(t.company_id),
  index('idx_milestones_status').on(t.status),
  index('idx_milestones_phase').on(t.roadmap_id, t.phase, t.sort_order),
]);

// ══════════════════════════════════════════════
// MILESTONE CRITERIA — checklist items per milestone
// ══════════════════════════════════════════════
export const milestoneCriteria = pgTable('milestone_criteria', {
  id: uuid('id').primaryKey().defaultRandom(),
  milestone_id: uuid('milestone_id').notNull().references(() => milestones.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  auto_evaluatable: boolean('auto_evaluatable').default(false),
  evaluation_query: jsonb('evaluation_query'),
  is_met: boolean('is_met').default(false),
  met_at: timestamp('met_at', { withTimezone: true }),
  evidence: jsonb('evidence'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_criteria_milestone').on(t.milestone_id),
  index('idx_criteria_status').on(t.is_met),
]);

// ══════════════════════════════════════════════
// SESSIONS — runtime container for one execution context (SPEC-CTRL-102)
// ══════════════════════════════════════════════
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  session_type: varchar('session_type', { length: 50 }).notNull(), // execution | verification | remediation
  status: varchar('status', { length: 50 }).default('active').notNull(),
  context_packet_version: integer('context_packet_version').default(1),
  permission_snapshot: jsonb('permission_snapshot'),
  started_at: timestamp('started_at', { withTimezone: true }).defaultNow(),
  ended_at: timestamp('ended_at', { withTimezone: true }),
}, (t) => [
  index('idx_sessions_task').on(t.task_id),
  index('idx_sessions_company').on(t.company_id),
  index('idx_sessions_status').on(t.status),
]);

// ══════════════════════════════════════════════
// RUNS — one concrete execution attempt within a session (SPEC-CTRL-102)
// ══════════════════════════════════════════════
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  session_id: uuid('session_id').notNull().references(() => sessions.id),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  attempt_number: integer('attempt_number').notNull().default(1),
  status: varchar('status', { length: 50 }).default('running').notNull(),
  agent_id: integer('agent_id').references(() => agents.id),
  execution_mode: varchar('execution_mode', { length: 50 }).notNull(),
  started_at: timestamp('started_at', { withTimezone: true }).defaultNow(),
  ended_at: timestamp('ended_at', { withTimezone: true }),
  failure_class: varchar('failure_class', { length: 50 }),
  turn_count: integer('turn_count').default(0),
  token_usage: jsonb('token_usage'),
  wall_clock_seconds: integer('wall_clock_seconds'),
  error_summary: text('error_summary'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_runs_session').on(t.session_id),
  index('idx_runs_task').on(t.task_id),
  index('idx_runs_status').on(t.status),
]);

// ══════════════════════════════════════════════
// ARTIFACTS — durable output or evidence linked to a run (SPEC-CTRL-102)
// ══════════════════════════════════════════════
export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  run_id: uuid('run_id').notNull().references(() => runs.id),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  artifact_type: varchar('artifact_type', { length: 50 }).notNull(), // report | screenshot | log | receipt | code
  content_ref: text('content_ref'),
  evidence: jsonb('evidence'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_artifacts_run').on(t.run_id),
  index('idx_artifacts_task').on(t.task_id),
]);

// ══════════════════════════════════════════════
// APPROVAL RECORDS — stored approval lineage for risky work (SPEC-CTRL-102)
// ══════════════════════════════════════════════
// OpenCode-style structured runtime records for agent execution replay,
// inspection, abort/resume controls, and safer repair workflows.
export const agentRunEvents = pgTable('agent_run_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  session_id: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
  run_id: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  execution_id: uuid('execution_id').references(() => taskExecutions.id),
  sequence: integer('sequence').notNull(),
  turn: integer('turn'),
  event_type: varchar('event_type', { length: 80 }).notNull(),
  provider: varchar('provider', { length: 50 }),
  tool_name: varchar('tool_name', { length: 120 }),
  status: varchar('status', { length: 50 }),
  message: text('message'),
  input: jsonb('input'),
  output: jsonb('output'),
  metadata: jsonb('metadata'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_agent_run_events_run').on(t.run_id),
  index('idx_agent_run_events_task').on(t.task_id),
  index('idx_agent_run_events_execution').on(t.execution_id),
  index('idx_agent_run_events_type').on(t.event_type),
  uniqueIndex('idx_agent_run_events_execution_sequence').on(t.execution_id, t.sequence),
]);

export const agentRunMessages = pgTable('agent_run_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  run_id: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  execution_id: uuid('execution_id').references(() => taskExecutions.id),
  turn: integer('turn'),
  role: varchar('role', { length: 40 }).notNull(),
  provider: varchar('provider', { length: 50 }),
  content: text('content'),
  raw: jsonb('raw'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_agent_run_messages_run').on(t.run_id),
  index('idx_agent_run_messages_task').on(t.task_id),
]);

export const agentToolCalls = pgTable('agent_tool_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  run_id: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  execution_id: uuid('execution_id').references(() => taskExecutions.id),
  turn: integer('turn'),
  tool_name: varchar('tool_name', { length: 120 }).notNull(),
  input: jsonb('input'),
  result: text('result'),
  status: varchar('status', { length: 50 }).default('completed').notNull(),
  metadata: jsonb('metadata'),
  started_at: timestamp('started_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }).defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_agent_tool_calls_run').on(t.run_id),
  index('idx_agent_tool_calls_task').on(t.task_id),
  index('idx_agent_tool_calls_name').on(t.tool_name),
]);

export const agentGateDecisions = pgTable('agent_gate_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  run_id: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  execution_id: uuid('execution_id').references(() => taskExecutions.id),
  gate_name: varchar('gate_name', { length: 100 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  reason: text('reason'),
  evidence: jsonb('evidence'),
  turn: integer('turn'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_agent_gate_decisions_run').on(t.run_id),
  index('idx_agent_gate_decisions_task').on(t.task_id),
  index('idx_agent_gate_decisions_gate').on(t.gate_name),
]);

export const agentProviderAttempts = pgTable('agent_provider_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  run_id: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  execution_id: uuid('execution_id').references(() => taskExecutions.id),
  provider: varchar('provider', { length: 50 }).notNull(),
  model: varchar('model', { length: 120 }),
  status: varchar('status', { length: 50 }).notNull(),
  error: text('error'),
  latency_ms: integer('latency_ms'),
  token_usage: jsonb('token_usage'),
  cost_usd: decimal('cost_usd', { precision: 10, scale: 6 }),
  metadata: jsonb('metadata'),
  started_at: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  index('idx_agent_provider_attempts_run').on(t.run_id),
  index('idx_agent_provider_attempts_task').on(t.task_id),
  index('idx_agent_provider_attempts_provider').on(t.provider),
]);

export const agentVerificationResults = pgTable('agent_verification_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  run_id: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  execution_id: uuid('execution_id').references(() => taskExecutions.id),
  verifier: varchar('verifier', { length: 100 }).notNull(),
  level: varchar('level', { length: 50 }),
  passed: boolean('passed').notNull(),
  summary: text('summary'),
  checks: jsonb('checks'),
  evidence: jsonb('evidence'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_agent_verification_results_run').on(t.run_id),
  index('idx_agent_verification_results_task').on(t.task_id),
  index('idx_agent_verification_results_passed').on(t.passed),
]);

export const agentSubagentOutputs = pgTable('agent_subagent_outputs', {
  id: uuid('id').primaryKey().defaultRandom(),
  run_id: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  execution_id: uuid('execution_id').references(() => taskExecutions.id),
  role: varchar('role', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).default('completed').notNull(),
  output: jsonb('output'),
  cannot_complete_task: boolean('cannot_complete_task').default(true).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_agent_subagent_outputs_run').on(t.run_id),
  index('idx_agent_subagent_outputs_task').on(t.task_id),
  index('idx_agent_subagent_outputs_role').on(t.role),
]);

export const agentPatchCheckpoints = pgTable('agent_patch_checkpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  run_id: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  execution_id: uuid('execution_id').references(() => taskExecutions.id),
  starting_commit: varchar('starting_commit', { length: 80 }),
  last_good_commit: varchar('last_good_commit', { length: 80 }),
  task_commit_range: varchar('task_commit_range', { length: 180 }),
  failed_commit: varchar('failed_commit', { length: 80 }),
  rollback_available: boolean('rollback_available').default(false).notNull(),
  rollback_confidence: varchar('rollback_confidence', { length: 50 }),
  patch_summary: jsonb('patch_summary'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_agent_patch_checkpoints_run').on(t.run_id),
  index('idx_agent_patch_checkpoints_task').on(t.task_id),
]);

export const agentRunControls = pgTable('agent_run_controls', {
  id: uuid('id').primaryKey().defaultRandom(),
  run_id: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  execution_id: uuid('execution_id').references(() => taskExecutions.id),
  action: varchar('action', { length: 80 }).notNull(),
  status: varchar('status', { length: 50 }).default('requested').notNull(),
  requested_by: varchar('requested_by', { length: 120 }),
  reason: text('reason'),
  payload: jsonb('payload'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  handled_at: timestamp('handled_at', { withTimezone: true }),
}, (t) => [
  index('idx_agent_run_controls_run').on(t.run_id),
  index('idx_agent_run_controls_task').on(t.task_id),
  index('idx_agent_run_controls_status').on(t.status),
]);

export const approvalRecords = pgTable('approval_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  risk_class: varchar('risk_class', { length: 50 }).notNull(),
  approved_by: varchar('approved_by', { length: 50 }).notNull(), // founder | auto | governance
  approved_at: timestamp('approved_at', { withTimezone: true }).defaultNow(),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  status: varchar('status', { length: 50 }).default('active').notNull(),
}, (t) => [
  index('idx_approval_records_task').on(t.task_id),
]);

// ══════════════════════════════════════════════
// RUNTIME AI COSTS — per-call LLM cost tracking (SPEC-BILL-105)
// ══════════════════════════════════════════════
export const runtimeAiCosts = pgTable('runtime_ai_costs', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  task_id: uuid('task_id').references(() => tasks.id),
  execution_id: uuid('execution_id'),
  model: varchar('model', { length: 100 }).notNull(),
  input_tokens: integer('input_tokens').default(0).notNull(),
  output_tokens: integer('output_tokens').default(0).notNull(),
  cost_usd: decimal('cost_usd', { precision: 10, scale: 6 }).default('0').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_runtime_ai_costs_company').on(t.company_id),
  index('idx_runtime_ai_costs_task').on(t.task_id),
]);

// ══════════════════════════════════════════════
// KNOWN ISSUE REGISTRY — clustered failure families (SPEC-OPS-001)
// ══════════════════════════════════════════════
export const knownIssueRegistry = pgTable('known_issue_registry', {
  id: uuid('id').primaryKey().defaultRandom(),
  fingerprint_pattern: varchar('fingerprint_pattern', { length: 255 }).notNull().unique(),
  description: text('description'),
  fix_status: varchar('fix_status', { length: 50 }).default('open').notNull(),
  fix_commit: varchar('fix_commit', { length: 100 }),
  regression_count: integer('regression_count').default(0).notNull(),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_known_issue_registry_status').on(t.fix_status),
]);

// ══════════════════════════════════════════════
// PAYMENT CONNECTIONS — founder-owned Stripe / Razorpay credentials
// Engineering agent reads these when running stripe_* / razorpay_* tools
// so products/prices/payment-links are created in the FOUNDER'S account,
// not Baljia's. Encrypted at rest via Web Crypto AES-256-GCM.
// ══════════════════════════════════════════════
export const paymentConnections = pgTable('payment_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 20 }).notNull(),          // 'stripe' | 'razorpay'
  mode: varchar('mode', { length: 10 }).notNull().default('test'),  // 'test' | 'live'
  auth_method: varchar('auth_method', { length: 20 }).notNull().default('paste_key'), // 'paste_key' | 'oauth'
  secret_key_encrypted: text('secret_key_encrypted').notNull(),     // OAuth access_token OR pasted secret key
  publishable_key: varchar('publishable_key', { length: 255 }),
  webhook_secret_encrypted: text('webhook_secret_encrypted'),
  account_id: varchar('account_id', { length: 255 }),               // Stripe acct_xxx (stripe_user_id) or Razorpay merchant id
  display_name: varchar('display_name', { length: 255 }),
  status: varchar('status', { length: 20 }).notNull().default('connected'), // 'connected' | 'invalid' | 'revoked'
  last_validated_at: timestamp('last_validated_at', { withTimezone: true }),
  connected_at: timestamp('connected_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('uniq_payment_connection_per_provider').on(t.company_id, t.provider),
  index('idx_payment_connections_company').on(t.company_id),
]);

export const superAdminAuditEvents = pgTable('super_admin_audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  admin_user_id: uuid('admin_user_id').references(() => users.id, { onDelete: 'set null' }),
  admin_email: varchar('admin_email', { length: 255 }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  target_type: varchar('target_type', { length: 80 }),
  target_id: text('target_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_super_admin_audit_admin').on(t.admin_user_id),
  index('idx_super_admin_audit_action').on(t.action),
  index('idx_super_admin_audit_target').on(t.target_type, t.target_id),
  index('idx_super_admin_audit_created').on(t.created_at),
]);

// ══════════════════════════════════════════════
// USER SESSIONS — JWT session revocation (G-SEC-003)
// ══════════════════════════════════════════════
export const userSessions = pgTable('user_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jti: varchar('jti', { length: 64 }).notNull().unique(),
  is_active: boolean('is_active').default(true).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_user_sessions_user').on(t.user_id),
  index('idx_user_sessions_jti').on(t.jti),
]);
