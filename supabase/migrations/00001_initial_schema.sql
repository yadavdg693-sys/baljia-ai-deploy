-- Baljia AI — Initial Schema Migration
-- Derived from Technical Architecture Spec v2 (70 audit findings applied)
-- This creates the complete platform database schema

-- ============================================
-- USERS
-- ============================================
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  name            VARCHAR(255),
  twitter_handle  VARCHAR(100),
  auth_provider   VARCHAR(50) DEFAULT 'magic_link',
  timezone        VARCHAR(50),
  locale          VARCHAR(10),
  ip_country      VARCHAR(5),
  device_type     VARCHAR(50),
  referral_source VARCHAR(255),
  referral_code   VARCHAR(50) UNIQUE DEFAULT substr(gen_random_uuid()::text, 1, 8),
  referred_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- COMPANIES
-- ============================================
CREATE TABLE companies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID REFERENCES users(id),
  name              VARCHAR(255) NOT NULL,
  slug              VARCHAR(100) UNIQUE NOT NULL,
  one_liner         TEXT,
  original_idea     TEXT,
  claim_status      VARCHAR(50) DEFAULT 'owned'
    CHECK (claim_status IN ('owned', 'baljia_fund', 'unclaimed')),
  onboarding_status VARCHAR(50) DEFAULT 'initializing'
    CHECK (onboarding_status IN ('initializing', 'completed')),
  plan_tier         VARCHAR(50) DEFAULT 'free'
    CHECK (plan_tier IN ('free', 'trial', 'full', 'keep_live')),
  lifecycle         VARCHAR(50) DEFAULT 'trial_active'
    CHECK (lifecycle IN ('trial_active', 'trial_expired', 'full_active', 'keep_live_active', 'suspended_billing', 'archived', 'deleted')),
  execution_state   VARCHAR(50) DEFAULT 'active'
    CHECK (execution_state IN ('active', 'paused', 'suspended')),
  billing_state     VARCHAR(50) DEFAULT 'free'
    CHECK (billing_state IN ('free', 'trial', 'active', 'past_due', 'cancelled')),
  hosting_state     VARCHAR(50) DEFAULT 'live'
    CHECK (hosting_state IN ('live', 'suspended', 'archived')),
  company_stage     VARCHAR(50) DEFAULT 'early'
    CHECK (company_stage IN ('early', 'validation', 'monetization', 'retention', 'scale', 'compounding')),
  subdomain         VARCHAR(255),
  email_identity    VARCHAR(255),
  github_repo       VARCHAR(255),
  render_service_id VARCHAR(255),
  neon_database_id  VARCHAR(255),
  neon_connection_string TEXT,
  custom_domain     VARCHAR(255),
  timezone          VARCHAR(50),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_companies_owner ON companies(owner_id);
CREATE INDEX idx_companies_slug ON companies(slug);
CREATE INDEX idx_companies_lifecycle ON companies(lifecycle);

-- ============================================
-- AGENTS
-- ============================================
CREATE TABLE agents (
  id                INTEGER PRIMARY KEY,
  name              VARCHAR(100) NOT NULL,
  role              VARCHAR(255),
  base_system_prompt TEXT,
  default_max_turns INTEGER DEFAULT 200,
  default_model     VARCHAR(100) DEFAULT 'claude-sonnet-4-20250514',
  execution_style   VARCHAR(50) DEFAULT 'agentic'
    CHECK (execution_style IN ('agentic', 'structured', 'graph')),
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Seed the 9 agents
INSERT INTO agents (id, name, role, default_max_turns, execution_style) VALUES
  (0,  'CEO',            'Founder-facing brain, planning, routing, credit guardrail', 0,   'agentic'),
  (30, 'Engineering',    'Build, fix, deploy, integrate',                             200, 'agentic'),
  (42, 'Browser',        'Interactive web execution, credential management',          200, 'structured'),
  (29, 'Research',       'Web research, synthesis, qualification',                    200, 'structured'),
  (33, 'Data',           'SQL, metrics, logs, analysis',                              200, 'structured'),
  (32, 'Support',        'Customer email replies, escalation',                        200, 'structured'),
  (40, 'Twitter',        'Compose and post tweets',                                   200, 'graph'),
  (41, 'MetaAds',        'Ad creation, optimization, campaign control',               100, 'graph'),
  (54, 'ColdOutreach',   'Outbound email, verification, follow-ups',                  200, 'graph');

-- ============================================
-- TASKS
-- ============================================
CREATE TABLE tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID REFERENCES companies(id) NOT NULL,
  title                 VARCHAR(500) NOT NULL,
  description           TEXT,
  tag                   VARCHAR(50) NOT NULL,
  task_type             VARCHAR(50),
  status                VARCHAR(50) DEFAULT 'created'
    CHECK (status IN ('created', 'todo', 'in_progress', 'completed_verified', 'completed_unverified', 'failed', 'rejected', 'blocked', 'partial')),
  priority              INTEGER DEFAULT 0,
  complexity            INTEGER CHECK (complexity IS NULL OR (complexity >= 1 AND complexity <= 10)),
  queue_order           INTEGER,
  source                VARCHAR(50) DEFAULT 'founder_requested'
    CHECK (source IN ('founder_requested', 'ceo_suggested', 'night_shift_generated', 'auto_remediation', 'recurring', 'onboarding')),
  suggestion_reasoning  TEXT,
  executability_type    VARCHAR(50) DEFAULT 'can_run_now'
    CHECK (executability_type IN ('can_run_now', 'needs_new_connection', 'manual_task')),
  execution_mode        VARCHAR(50)
    CHECK (execution_mode IS NULL OR execution_mode IN ('deterministic', 'template_plus_params', 'full_agent')),
  assigned_to_agent_id  INTEGER REFERENCES agents(id),
  estimated_hours       DECIMAL(4,1),
  estimated_credits     INTEGER DEFAULT 1,
  actual_credits_charged INTEGER DEFAULT 0,
  verification_level    VARCHAR(50)
    CHECK (verification_level IS NULL OR verification_level IN ('none', 'deterministic', 'browser_flow', 'quality_review', 'hybrid')),
  failure_class         VARCHAR(50)
    CHECK (failure_class IS NULL OR failure_class IN ('founder_ambiguity', 'missing_prerequisite', 'platform_scoping', 'worker_failure', 'external_dependency')),
  related_task_ids      UUID[],
  run_link              VARCHAR(500),
  markdown_link         VARCHAR(500),
  max_turns             INTEGER DEFAULT 200,
  turn_count            INTEGER DEFAULT 0,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tasks_company ON tasks(company_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_company_status ON tasks(company_id, status);
CREATE INDEX idx_tasks_company_order ON tasks(company_id, queue_order);

-- ============================================
-- TASK EXECUTIONS
-- ============================================
CREATE TABLE task_executions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               UUID REFERENCES tasks(id) NOT NULL,
  agent_id              INTEGER REFERENCES agents(id) NOT NULL,
  execution_mode        VARCHAR(50) NOT NULL,
  status                VARCHAR(50) DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'timed_out', 'killed')),
  turn_count            INTEGER DEFAULT 0,
  max_turns             INTEGER NOT NULL,
  started_at            TIMESTAMPTZ DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  wall_clock_seconds    INTEGER,
  token_usage           JSONB,
  error_summary         TEXT,
  watchdog_events       JSONB[],
  verification_evidence JSONB,
  execution_log         JSONB[],
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_executions_task ON task_executions(task_id);
CREATE INDEX idx_executions_status ON task_executions(status);

-- ============================================
-- REPORTS
-- ============================================
CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) NOT NULL,
  task_id         UUID REFERENCES tasks(id),
  title           VARCHAR(500),
  content         TEXT,
  report_type     VARCHAR(50),
  structured_data JSONB,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_reports_company ON reports(company_id);
CREATE INDEX idx_reports_task ON reports(task_id);

-- ============================================
-- DOCUMENTS (5 core + custom)
-- ============================================
CREATE TABLE documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) NOT NULL,
  doc_type        VARCHAR(50) NOT NULL,
  title           VARCHAR(500),
  content         TEXT,
  source          VARCHAR(50),
  version         INTEGER DEFAULT 1,
  is_empty        BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_documents_company ON documents(company_id);
CREATE UNIQUE INDEX idx_documents_company_core_type ON documents(company_id, doc_type)
  WHERE doc_type IN ('mission', 'product_overview', 'tech_notes', 'brand_voice', 'user_research');

-- ============================================
-- DOCUMENT SUGGESTIONS (user-reviewed updates)
-- ============================================
CREATE TABLE document_suggestions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID REFERENCES companies(id) NOT NULL,
  document_id       UUID REFERENCES documents(id) NOT NULL,
  task_id           UUID REFERENCES tasks(id),
  suggested_content TEXT NOT NULL,
  reason            TEXT,
  status            VARCHAR(50) DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'edited', 'skipped')),
  created_at        TIMESTAMPTZ DEFAULT now(),
  reviewed_at       TIMESTAMPTZ
);

-- ============================================
-- MEMORY LAYERS (3-layer system)
-- ============================================
CREATE TABLE memory_layers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) NOT NULL,
  layer           INTEGER NOT NULL CHECK (layer IN (1, 2, 3)),
  content         TEXT,
  token_count     INTEGER DEFAULT 0,
  max_tokens      INTEGER NOT NULL,
  version         INTEGER DEFAULT 1,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_memory_company_layer ON memory_layers(company_id, layer);

-- ============================================
-- LEARNINGS
-- ============================================
CREATE TABLE learnings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) NOT NULL,
  task_id         UUID REFERENCES tasks(id),
  agent_id        INTEGER REFERENCES agents(id),
  category        VARCHAR(100),
  tags            VARCHAR(100)[],
  content         TEXT NOT NULL,
  confidence      VARCHAR(20) DEFAULT 'medium'
    CHECK (confidence IN ('high', 'medium', 'low')),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_learnings_company ON learnings(company_id);
CREATE INDEX idx_learnings_tags ON learnings USING GIN(tags);

-- ============================================
-- SUBSCRIPTIONS
-- ============================================
CREATE TABLE subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID REFERENCES users(id) NOT NULL,
  company_id               UUID REFERENCES companies(id),
  stripe_subscription_id   VARCHAR(255),
  stripe_customer_id       VARCHAR(255),
  plan_type                VARCHAR(50) NOT NULL
    CHECK (plan_type IN ('trial', 'full', 'keep_live')),
  status                   VARCHAR(50) DEFAULT 'active'
    CHECK (status IN ('active', 'past_due', 'cancelled', 'expired')),
  trial_ends_at            TIMESTAMPTZ,
  night_shifts_remaining   INTEGER DEFAULT 0,
  night_shifts_total       INTEGER DEFAULT 0,
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  created_at               TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- CREDIT LEDGER
-- ============================================
CREATE TABLE credit_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) NOT NULL,
  entry_type      VARCHAR(50) NOT NULL
    CHECK (entry_type IN ('monthly_grant', 'welcome_bonus', 'addon_purchase', 'task_deduction', 'refund', 'night_shift_deduction', 'referral_bonus')),
  amount          INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  task_id         UUID REFERENCES tasks(id),
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_credit_ledger_company ON credit_ledger(company_id);

-- ============================================
-- REVENUE LEDGER (per-company customer payments)
-- ============================================
CREATE TABLE revenue_ledger (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID REFERENCES companies(id) NOT NULL,
  entry_type          VARCHAR(50) NOT NULL
    CHECK (entry_type IN ('customer_payment', 'platform_fee', 'stripe_fee', 'refund', 'dispute', 'withdrawal')),
  gross_amount        DECIMAL(10,2),
  net_amount          DECIMAL(10,2),
  platform_fee_rate   DECIMAL(3,2) DEFAULT 0.20,
  stripe_charge_id    VARCHAR(255),
  description         TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- AD SPEND LEDGER
-- ============================================
CREATE TABLE ad_campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID REFERENCES companies(id) NOT NULL,
  meta_campaign_id  VARCHAR(255),
  meta_adset_id     VARCHAR(255),
  meta_ad_id        VARCHAR(255),
  status            VARCHAR(50) DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  daily_budget      DECIMAL(10,2),
  total_spend       DECIMAL(10,2) DEFAULT 0,
  impressions       INTEGER DEFAULT 0,
  clicks            INTEGER DEFAULT 0,
  ctr               DECIMAL(5,4),
  cpc               DECIMAL(10,2),
  creative_url      VARCHAR(500),
  placements        VARCHAR(50)[],
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ad_spend_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID REFERENCES companies(id) NOT NULL,
  campaign_id       UUID REFERENCES ad_campaigns(id),
  daily_budget      DECIMAL(10,2),
  actual_spend      DECIMAL(10,2),
  platform_fee      DECIMAL(10,2),
  charge_date       DATE,
  stripe_charge_id  VARCHAR(255),
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- REFUND HISTORY
-- ============================================
CREATE TABLE refund_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID REFERENCES companies(id) NOT NULL,
  task_id           UUID REFERENCES tasks(id),
  failure_class     VARCHAR(50),
  decision          VARCHAR(50) NOT NULL
    CHECK (decision IN ('auto_refund', 'partial_refund', 'deny', 'route_to_human')),
  reason            TEXT,
  credits_refunded  INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- REFERRALS
-- ============================================
CREATE TABLE referrals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     UUID REFERENCES users(id) NOT NULL,
  referred_id     UUID REFERENCES users(id) NOT NULL,
  status          VARCHAR(50) DEFAULT 'signed_up'
    CHECK (status IN ('signed_up', 'trial', 'subscribed', 'credited')),
  credits_awarded INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  converted_at    TIMESTAMPTZ
);

-- ============================================
-- RECURRING TASKS
-- ============================================
CREATE TABLE recurring_tasks (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 UUID REFERENCES companies(id) NOT NULL,
  title                      VARCHAR(500) NOT NULL,
  description                TEXT,
  tag                        VARCHAR(50) NOT NULL,
  priority                   INTEGER DEFAULT 0,
  cadence                    VARCHAR(50) NOT NULL
    CHECK (cadence IN ('daily', 'weekly', 'biweekly', 'monthly')),
  monthly_credits_estimate   INTEGER,
  is_active                  BOOLEAN DEFAULT true,
  last_run_at                TIMESTAMPTZ,
  next_run_at                TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- NIGHT SHIFT CYCLES
-- ============================================
CREATE TABLE night_shift_cycles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) NOT NULL,
  cycle_number    INTEGER,
  company_stage   VARCHAR(50),
  trust_score     DECIMAL(3,2),
  planned_tasks   UUID[],
  executed_tasks  UUID[],
  summary         TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- COMMUNICATION: EMAIL THREADS
-- ============================================
CREATE TABLE email_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) NOT NULL,
  thread_id       VARCHAR(255),
  subject         VARCHAR(500),
  from_address    VARCHAR(255),
  to_address      VARCHAR(255),
  direction       VARCHAR(10) CHECK (direction IN ('inbound', 'outbound')),
  content         TEXT,
  is_read         BOOLEAN DEFAULT false,
  parent_id       UUID REFERENCES email_threads(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_email_threads_company ON email_threads(company_id);

-- ============================================
-- CONTACTS / LEADS
-- ============================================
CREATE TABLE contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID REFERENCES companies(id) NOT NULL,
  email             VARCHAR(255),
  name              VARCHAR(255),
  source            VARCHAR(50),
  lead_status       VARCHAR(50) DEFAULT 'pending'
    CHECK (lead_status IN ('pending', 'contacted', 'replied', 'responded', 'meeting', 'dead')),
  email_verified    BOOLEAN DEFAULT false,
  last_contacted_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_contacts_company ON contacts(company_id);

-- ============================================
-- BROWSER CREDENTIALS
-- ============================================
CREATE TABLE browser_credentials (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID REFERENCES companies(id) NOT NULL,
  site_domain           VARCHAR(255) NOT NULL,
  site_tier             INTEGER DEFAULT 3 CHECK (site_tier IN (1, 2, 3)),
  username              VARCHAR(255),
  password_encrypted    BYTEA,
  browser_context_id    VARCHAR(255),
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, site_domain)
);

-- ============================================
-- FAILURE LEARNING SYSTEM
-- ============================================
CREATE TABLE failure_fingerprints (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint           VARCHAR(255) UNIQUE NOT NULL,
  category              VARCHAR(100),
  description           TEXT,
  occurrence_count      INTEGER DEFAULT 1,
  affected_agents       INTEGER[],
  affected_tools        VARCHAR(100)[],
  fix_status            VARCHAR(50) DEFAULT 'open'
    CHECK (fix_status IN ('open', 'investigating', 'fixed', 'wont_fix')),
  regression_sensitive  BOOLEAN DEFAULT false,
  first_seen_at         TIMESTAMPTZ DEFAULT now(),
  last_seen_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE task_failure_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID REFERENCES tasks(id) NOT NULL,
  fingerprint_id  UUID REFERENCES failure_fingerprints(id) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- MCP SERVERS & TOOLS (for tool registry)
-- ============================================
CREATE TABLE mcp_servers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) UNIQUE NOT NULL,
  category        VARCHAR(50)
    CHECK (category IN ('platform_infra', 'business', 'internal_platform', 'conditional')),
  tool_count      INTEGER,
  is_available    BOOLEAN DEFAULT true,
  requires_oauth  BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE mcp_tools (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id         UUID REFERENCES mcp_servers(id) NOT NULL,
  name              VARCHAR(100) NOT NULL,
  description       TEXT,
  risk_level        VARCHAR(20) DEFAULT 'low'
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  requires_approval BOOLEAN DEFAULT false,
  UNIQUE(server_id, name)
);

CREATE TABLE agent_tool_mounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        INTEGER REFERENCES agents(id) NOT NULL,
  mcp_server_id   UUID REFERENCES mcp_servers(id) NOT NULL,
  is_required     BOOLEAN DEFAULT false,
  requires_oauth  BOOLEAN DEFAULT false,
  UNIQUE(agent_id, mcp_server_id)
);

-- ============================================
-- CHAT SESSIONS (for CEO/chat continuity)
-- ============================================
CREATE TABLE chat_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) NOT NULL,
  user_id         UUID REFERENCES users(id) NOT NULL,
  messages        JSONB[] DEFAULT '{}',
  message_count   INTEGER DEFAULT 0,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_sessions_company ON chat_sessions(company_id);

-- ============================================
-- PLATFORM EVENTS (for event bus / live wall)
-- ============================================
CREATE TABLE platform_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      VARCHAR(100) NOT NULL,
  company_id      UUID REFERENCES companies(id),
  payload         JSONB NOT NULL,
  is_public_safe  BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_events_company ON platform_events(company_id);
CREATE INDEX idx_events_type ON platform_events(event_type);
CREATE INDEX idx_events_public ON platform_events(is_public_safe, created_at DESC);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own companies
CREATE POLICY "Users see own companies" ON companies
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "Users manage own companies" ON companies
  FOR ALL USING (owner_id = auth.uid());

-- Company-scoped access for tasks
CREATE POLICY "Company tasks access" ON tasks
  FOR ALL USING (
    company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())
  );

-- Company-scoped access for documents
CREATE POLICY "Company documents access" ON documents
  FOR ALL USING (
    company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())
  );

-- Company-scoped access for reports
CREATE POLICY "Company reports access" ON reports
  FOR ALL USING (
    company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())
  );

-- Company-scoped access for credit ledger
CREATE POLICY "Company credit access" ON credit_ledger
  FOR SELECT USING (
    company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())
  );

-- Company-scoped chat sessions
CREATE POLICY "Company chat access" ON chat_sessions
  FOR ALL USING (user_id = auth.uid());

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get current credit balance for a company
CREATE OR REPLACE FUNCTION get_credit_balance(p_company_id UUID)
RETURNS INTEGER AS $$
  SELECT COALESCE(
    (SELECT balance_after FROM credit_ledger 
     WHERE company_id = p_company_id 
     ORDER BY created_at DESC LIMIT 1),
    0
  );
$$ LANGUAGE sql STABLE;

-- Auto-create 5 core document slots when a company is created
CREATE OR REPLACE FUNCTION create_core_documents()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO documents (company_id, doc_type, title, is_empty) VALUES
    (NEW.id, 'mission', 'Mission', true),
    (NEW.id, 'product_overview', 'Product Overview', true),
    (NEW.id, 'tech_notes', 'Tech Notes', true),
    (NEW.id, 'brand_voice', 'Brand Voice', true),
    (NEW.id, 'user_research', 'User Research', true);
  
  -- Create 3 memory layers
  INSERT INTO memory_layers (company_id, layer, max_tokens) VALUES
    (NEW.id, 1, 15000),
    (NEW.id, 2, 3000),
    (NEW.id, 3, 15000);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_core_documents
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION create_core_documents();

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_companies_updated_at
  BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_tasks_updated_at
  BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_documents_updated_at
  BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
