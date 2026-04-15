CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"meta_campaign_id" varchar(255),
	"meta_adset_id" varchar(255),
	"meta_ad_id" varchar(255),
	"external_id" varchar(255),
	"platform" varchar(50) DEFAULT 'meta',
	"status" varchar(50) DEFAULT 'draft',
	"daily_budget" numeric(10, 2),
	"total_spend" numeric(10, 2) DEFAULT '0',
	"spend" numeric(10, 2) DEFAULT '0',
	"impressions" integer DEFAULT 0,
	"clicks" integer DEFAULT 0,
	"ctr" numeric(5, 4),
	"cpc" numeric(10, 2),
	"creative_url" varchar(500),
	"placements" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "ad_spend_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"campaign_id" uuid,
	"daily_budget" numeric(10, 2),
	"actual_spend" numeric(10, 2),
	"platform_fee" numeric(10, 2),
	"charge_date" date,
	"stripe_charge_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "agent_tool_mounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" integer NOT NULL,
	"mcp_server_id" uuid NOT NULL,
	"is_required" boolean DEFAULT false,
	"requires_oauth" boolean DEFAULT false
);;
CREATE TABLE "agents" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"role" varchar(255),
	"base_system_prompt" text,
	"default_max_turns" integer DEFAULT 200,
	"default_model" varchar(100) DEFAULT 'claude-sonnet-4-20250514',
	"execution_style" varchar(50) DEFAULT 'agentic',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "approval_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"risk_class" varchar(50) NOT NULL,
	"approved_by" varchar(50) NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone,
	"status" varchar(50) DEFAULT 'active' NOT NULL
);;
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"artifact_type" varchar(50) NOT NULL,
	"content_ref" text,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "browser_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"site_domain" varchar(255) NOT NULL,
	"site_tier" integer DEFAULT 3,
	"username" varchar(255),
	"password_encrypted" text,
	"browser_context_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"messages" jsonb,
	"message_count" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"one_liner" text,
	"original_idea" text,
	"claim_status" varchar(50) DEFAULT 'owned',
	"onboarding_status" varchar(50) DEFAULT 'initializing',
	"onboarding_journey" varchar(50),
	"plan_tier" varchar(50) DEFAULT 'free',
	"lifecycle" varchar(50) DEFAULT 'trial_active',
	"execution_state" varchar(50) DEFAULT 'active',
	"billing_state" varchar(50) DEFAULT 'free',
	"hosting_state" varchar(50) DEFAULT 'live',
	"company_stage" varchar(50) DEFAULT 'early',
	"subdomain" varchar(255),
	"email_identity" varchar(255),
	"github_repo" varchar(255),
	"render_service_id" varchar(255),
	"neon_database_id" varchar(255),
	"neon_connection_string" text,
	"custom_domain" varchar(255),
	"company_email" varchar(255),
	"timezone" varchar(50),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);;
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"email" varchar(255),
	"name" varchar(255),
	"source" varchar(50),
	"lead_status" varchar(50) DEFAULT 'pending',
	"email_verified" boolean DEFAULT false,
	"last_contacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_type" varchar(50) NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"task_id" uuid,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "dashboard_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"icon" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "document_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"task_id" uuid,
	"suggested_content" text NOT NULL,
	"reason" text,
	"status" varchar(50) DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now(),
	"reviewed_at" timestamp with time zone
);;
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"doc_type" varchar(50) NOT NULL,
	"title" varchar(500),
	"content" text,
	"source" varchar(50),
	"version" integer DEFAULT 1,
	"is_empty" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "email_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"thread_id" varchar(255),
	"subject" varchar(500),
	"from_address" varchar(255),
	"to_address" varchar(255),
	"direction" varchar(10),
	"body" text,
	"external_id" varchar(255),
	"is_read" boolean DEFAULT false,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "failure_fingerprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" varchar(255) NOT NULL,
	"category" varchar(100),
	"description" text,
	"occurrence_count" integer DEFAULT 1,
	"affected_agents" jsonb,
	"affected_tools" jsonb,
	"fix_status" varchar(50) DEFAULT 'open',
	"regression_sensitive" boolean DEFAULT false,
	"root_cause" text,
	"fix_notes" text,
	"fix_applied_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now(),
	"last_seen_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "failure_fingerprints_fingerprint_unique" UNIQUE("fingerprint")
);;
CREATE TABLE "learnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid,
	"agent_id" integer,
	"category" varchar(100),
	"learning_type" varchar(50) DEFAULT 'domain_knowledge',
	"tags" jsonb,
	"content" text NOT NULL,
	"confidence" varchar(20) DEFAULT 'medium',
	"usage_count" integer DEFAULT 0,
	"last_referenced_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "magic_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "magic_link_tokens_token_unique" UNIQUE("token")
);;
CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"category" varchar(50),
	"tool_count" integer,
	"is_available" boolean DEFAULT true,
	"requires_oauth" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "mcp_servers_name_unique" UNIQUE("name")
);;
CREATE TABLE "mcp_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"risk_level" varchar(20) DEFAULT 'low',
	"requires_approval" boolean DEFAULT false
);;
CREATE TABLE "memory_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"layer" integer NOT NULL,
	"content" text,
	"token_count" integer DEFAULT 0,
	"max_tokens" integer NOT NULL,
	"version" integer DEFAULT 1,
	"updated_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "milestone_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"auto_evaluatable" boolean DEFAULT false,
	"evaluation_query" jsonb,
	"is_met" boolean DEFAULT false,
	"met_at" timestamp with time zone,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roadmap_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"phase" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"suggested_task_tags" jsonb DEFAULT '[]'::jsonb,
	"night_shift_hint" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "night_shift_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"cycle_number" integer,
	"company_stage" varchar(50),
	"trust_score" numeric(3, 2),
	"planned_tasks" jsonb,
	"executed_tasks" jsonb,
	"summary" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "platform_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"company_id" uuid,
	"payload" jsonb NOT NULL,
	"is_public" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "platform_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"severity" text DEFAULT 'medium',
	"status" text DEFAULT 'open',
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "recurring_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"tag" varchar(50) NOT NULL,
	"priority" integer DEFAULT 0,
	"cadence" varchar(50) NOT NULL,
	"monthly_credits_estimate" integer,
	"is_active" boolean DEFAULT true,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referred_id" uuid NOT NULL,
	"status" varchar(50) DEFAULT 'signed_up',
	"credits_awarded" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"converted_at" timestamp with time zone
);;
CREATE TABLE "refund_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid,
	"failure_class" varchar(50),
	"decision" varchar(50) NOT NULL,
	"reason" text,
	"credits_refunded" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid,
	"title" varchar(500),
	"content" text,
	"report_type" varchar(50),
	"structured_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "revenue_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_type" varchar(50) NOT NULL,
	"gross_amount" numeric(10, 2),
	"net_amount" numeric(10, 2),
	"platform_fee_rate" numeric(3, 2) DEFAULT '0.20',
	"stripe_charge_id" varchar(255),
	"description" text,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "roadmaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"archetype" varchar(50) DEFAULT 'saas' NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"current_phase" integer DEFAULT 1 NOT NULL,
	"total_phases" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"status" varchar(50) DEFAULT 'running' NOT NULL,
	"agent_id" integer,
	"execution_mode" varchar(50) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"ended_at" timestamp with time zone,
	"failure_class" varchar(50),
	"turn_count" integer DEFAULT 0,
	"token_usage" jsonb,
	"wall_clock_seconds" integer,
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"session_type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"context_packet_version" integer DEFAULT 1,
	"permission_snapshot" jsonb,
	"started_at" timestamp with time zone DEFAULT now(),
	"ended_at" timestamp with time zone
);;
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid,
	"stripe_subscription_id" varchar(255),
	"stripe_customer_id" varchar(255),
	"plan_type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'active',
	"trial_ends_at" timestamp with time zone,
	"night_shifts_remaining" integer DEFAULT 0,
	"night_shifts_total" integer DEFAULT 0,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "task_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" integer NOT NULL,
	"execution_mode" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'running',
	"turn_count" integer DEFAULT 0,
	"max_turns" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"wall_clock_seconds" integer,
	"token_usage" jsonb,
	"error_summary" text,
	"watchdog_events" jsonb,
	"verification_evidence" jsonb,
	"execution_log" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "task_failure_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"fingerprint_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"tag" varchar(50) NOT NULL,
	"task_type" varchar(50),
	"status" varchar(50) DEFAULT 'todo',
	"priority" integer DEFAULT 0,
	"complexity" integer,
	"queue_order" integer,
	"source" varchar(50) DEFAULT 'founder_requested',
	"suggestion_reasoning" text,
	"executability_type" varchar(50) DEFAULT 'can_run_now',
	"execution_mode" varchar(50),
	"assigned_to_agent_id" integer,
	"estimated_hours" numeric(4, 1),
	"estimated_credits" integer DEFAULT 1,
	"actual_credits_charged" integer DEFAULT 0,
	"verification_level" varchar(50),
	"refund_policy" varchar(50) DEFAULT 'manual_review',
	"failure_class" varchar(50),
	"related_task_ids" jsonb,
	"run_link" varchar(500),
	"markdown_link" varchar(500),
	"authorized_by" varchar(50),
	"authorization_reason" text,
	"max_turns" integer DEFAULT 200,
	"turn_count" integer DEFAULT 0,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "tweets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tweet_id" text,
	"text" text NOT NULL,
	"status" text DEFAULT 'posted',
	"scheduled_for" timestamp with time zone,
	"posted_at" timestamp with time zone DEFAULT now(),
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"twitter_handle" varchar(100),
	"auth_provider" varchar(50) DEFAULT 'magic_link',
	"google_id" varchar(255),
	"email_verified" boolean DEFAULT false,
	"timezone" varchar(50),
	"locale" varchar(10),
	"ip_country" varchar(5),
	"device_type" varchar(50),
	"referral_source" varchar(255),
	"referral_code" varchar(50),
	"referred_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code")
);;
CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"onboarding_intent" varchar(50),
	"idea_text" text,
	"business_website" varchar(500),
	"timezone" varchar(100),
	"ip_address" varchar(45),
	"converted_user_id" uuid,
	"converted_company_id" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);;
CREATE UNIQUE INDEX "idx_agent_tool_mounts_unique" ON "agent_tool_mounts" USING btree ("agent_id","mcp_server_id");;
CREATE INDEX "idx_approval_records_task" ON "approval_records" USING btree ("task_id");;
CREATE INDEX "idx_artifacts_run" ON "artifacts" USING btree ("run_id");;
CREATE INDEX "idx_artifacts_task" ON "artifacts" USING btree ("task_id");;
CREATE UNIQUE INDEX "idx_browser_creds_unique" ON "browser_credentials" USING btree ("company_id","site_domain");;
CREATE INDEX "idx_chat_sessions_company" ON "chat_sessions" USING btree ("company_id");;
CREATE INDEX "idx_companies_owner" ON "companies" USING btree ("owner_id");;
CREATE INDEX "idx_companies_lifecycle" ON "companies" USING btree ("lifecycle");;
CREATE INDEX "idx_contacts_company" ON "contacts" USING btree ("company_id");;
CREATE INDEX "idx_credit_ledger_company" ON "credit_ledger" USING btree ("company_id");;
CREATE INDEX "idx_dashboard_links_company" ON "dashboard_links" USING btree ("company_id");;
CREATE UNIQUE INDEX "idx_dashboard_links_unique" ON "dashboard_links" USING btree ("company_id","label");;
CREATE INDEX "idx_documents_company" ON "documents" USING btree ("company_id");;
CREATE INDEX "idx_email_threads_company" ON "email_threads" USING btree ("company_id");;
CREATE INDEX "idx_learnings_company" ON "learnings" USING btree ("company_id");;
CREATE INDEX "idx_magic_link_token" ON "magic_link_tokens" USING btree ("token");;
CREATE UNIQUE INDEX "idx_mcp_tools_unique" ON "mcp_tools" USING btree ("server_id","name");;
CREATE UNIQUE INDEX "idx_memory_company_layer" ON "memory_layers" USING btree ("company_id","layer");;
CREATE INDEX "idx_criteria_milestone" ON "milestone_criteria" USING btree ("milestone_id");;
CREATE INDEX "idx_criteria_status" ON "milestone_criteria" USING btree ("is_met");;
CREATE INDEX "idx_milestones_roadmap" ON "milestones" USING btree ("roadmap_id");;
CREATE INDEX "idx_milestones_company" ON "milestones" USING btree ("company_id");;
CREATE INDEX "idx_milestones_status" ON "milestones" USING btree ("status");;
CREATE INDEX "idx_milestones_phase" ON "milestones" USING btree ("roadmap_id","phase","sort_order");;
CREATE INDEX "idx_events_company" ON "platform_events" USING btree ("company_id");;
CREATE INDEX "idx_events_type" ON "platform_events" USING btree ("event_type");;
CREATE INDEX "idx_platform_feedback_company" ON "platform_feedback" USING btree ("company_id");;
CREATE INDEX "idx_reports_company" ON "reports" USING btree ("company_id");;
CREATE INDEX "idx_reports_task" ON "reports" USING btree ("task_id");;
CREATE UNIQUE INDEX "idx_roadmaps_company" ON "roadmaps" USING btree ("company_id");;
CREATE INDEX "idx_roadmaps_status" ON "roadmaps" USING btree ("status");;
CREATE INDEX "idx_runs_session" ON "runs" USING btree ("session_id");;
CREATE INDEX "idx_runs_task" ON "runs" USING btree ("task_id");;
CREATE INDEX "idx_runs_status" ON "runs" USING btree ("status");;
CREATE INDEX "idx_sessions_task" ON "sessions" USING btree ("task_id");;
CREATE INDEX "idx_sessions_company" ON "sessions" USING btree ("company_id");;
CREATE INDEX "idx_sessions_status" ON "sessions" USING btree ("status");;
CREATE INDEX "idx_executions_task" ON "task_executions" USING btree ("task_id");;
CREATE INDEX "idx_executions_status" ON "task_executions" USING btree ("status");;
CREATE INDEX "idx_tasks_company" ON "tasks" USING btree ("company_id");;
CREATE INDEX "idx_tasks_status" ON "tasks" USING btree ("status");;
CREATE INDEX "idx_tasks_company_status" ON "tasks" USING btree ("company_id","status");;
CREATE INDEX "idx_tasks_company_order" ON "tasks" USING btree ("company_id","queue_order");;
CREATE INDEX "idx_tweets_company" ON "tweets" USING btree ("company_id");;
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "ad_spend_ledger" ADD CONSTRAINT "ad_spend_ledger_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "ad_spend_ledger" ADD CONSTRAINT "ad_spend_ledger_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "agent_tool_mounts" ADD CONSTRAINT "agent_tool_mounts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "agent_tool_mounts" ADD CONSTRAINT "agent_tool_mounts_mcp_server_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "browser_credentials" ADD CONSTRAINT "browser_credentials_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "dashboard_links" ADD CONSTRAINT "dashboard_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "document_suggestions" ADD CONSTRAINT "document_suggestions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "document_suggestions" ADD CONSTRAINT "document_suggestions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "document_suggestions" ADD CONSTRAINT "document_suggestions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "memory_layers" ADD CONSTRAINT "memory_layers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "milestone_criteria" ADD CONSTRAINT "milestone_criteria_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_roadmap_id_roadmaps_id_fk" FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "night_shift_cycles" ADD CONSTRAINT "night_shift_cycles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "platform_events" ADD CONSTRAINT "platform_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "platform_feedback" ADD CONSTRAINT "platform_feedback_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "recurring_tasks" ADD CONSTRAINT "recurring_tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_id_users_id_fk" FOREIGN KEY ("referred_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "refund_history" ADD CONSTRAINT "refund_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "refund_history" ADD CONSTRAINT "refund_history_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "reports" ADD CONSTRAINT "reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "reports" ADD CONSTRAINT "reports_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "revenue_ledger" ADD CONSTRAINT "revenue_ledger_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "runs" ADD CONSTRAINT "runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "task_failure_links" ADD CONSTRAINT "task_failure_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "task_failure_links" ADD CONSTRAINT "task_failure_links_fingerprint_id_failure_fingerprints_id_fk" FOREIGN KEY ("fingerprint_id") REFERENCES "public"."failure_fingerprints"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_agent_id_agents_id_fk" FOREIGN KEY ("assigned_to_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "tweets" ADD CONSTRAINT "tweets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "tweets" ADD CONSTRAINT "tweets_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_converted_user_id_users_id_fk" FOREIGN KEY ("converted_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;;