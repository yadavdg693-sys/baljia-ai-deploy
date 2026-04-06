// Drizzle ORM Schema — mirrors all 35 Baljia tables
// Generated from supabase/migrations/00001-00004

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
// COMPANIES
// ══════════════════════════════════════════════
export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  owner_id: uuid('owner_id').references(() => users.id),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  one_liner: text('one_liner'),
  original_idea: text('original_idea'),
  claim_status: varchar('claim_status', { length: 50 }).default('owned'),
  onboarding_status: varchar('onboarding_status', { length: 50 }).default('initializing'),
  plan_tier: varchar('plan_tier', { length: 50 }).default('free'),
  lifecycle: varchar('lifecycle', { length: 50 }).default('trial_active'),
  execution_state: varchar('execution_state', { length: 50 }).default('active'),
  billing_state: varchar('billing_state', { length: 50 }).default('free'),
  hosting_state: varchar('hosting_state', { length: 50 }).default('live'),
  company_stage: varchar('company_stage', { length: 50 }).default('early'),
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
  status: varchar('status', { length: 50 }).default('created'),
  priority: integer('priority').default(0),
  complexity: integer('complexity'),
  queue_order: integer('queue_order'),
  source: varchar('source', { length: 50 }).default('founder_requested'),
  suggestion_reasoning: text('suggestion_reasoning'),
  executability_type: varchar('executability_type', { length: 50 }).default('can_run_now'),
  execution_mode: varchar('execution_mode', { length: 50 }),
  assigned_to_agent_id: integer('assigned_to_agent_id').references(() => agents.id),
  estimated_hours: decimal('estimated_hours', { precision: 4, scale: 1 }),
  estimated_credits: integer('estimated_credits').default(1),
  actual_credits_charged: integer('actual_credits_charged').default(0),
  verification_level: varchar('verification_level', { length: 50 }),
  failure_class: varchar('failure_class', { length: 50 }),
  related_task_ids: jsonb('related_task_ids').$type<string[]>(), // UUID[] stored as JSON array
  run_link: varchar('run_link', { length: 500 }),
  markdown_link: varchar('markdown_link', { length: 500 }),
  max_turns: integer('max_turns').default(200),
  turn_count: integer('turn_count').default(0),
  started_at: timestamp('started_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_tasks_company').on(t.company_id),
  index('idx_tasks_status').on(t.status),
  index('idx_tasks_company_status').on(t.company_id, t.status),
  index('idx_tasks_company_order').on(t.company_id, t.queue_order),
]);

// ══════════════════════════════════════════════
// TASK EXECUTIONS
// ══════════════════════════════════════════════
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
  tags: jsonb('tags').$type<string[]>(), // string array stored as JSON
  content: text('content').notNull(),
  confidence: varchar('confidence', { length: 20 }).default('medium'),
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
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_credit_ledger_company').on(t.company_id),
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
  company_stage: varchar('company_stage', { length: 50 }),
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
  is_public_safe: boolean('is_public_safe').default(false),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_events_company').on(t.company_id),
  index('idx_events_type').on(t.event_type),
]);

// ══════════════════════════════════════════════
// DASHBOARD LINKS (CEO tool)
// ══════════════════════════════════════════════
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
// PLATFORM FEEDBACK (CEO tool)
// ══════════════════════════════════════════════
export const platformFeedback = pgTable('platform_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  severity: text('severity').default('medium'),
  status: text('status').default('open'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_platform_feedback_company').on(t.company_id),
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
