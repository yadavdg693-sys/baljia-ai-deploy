# Baljia AI — Technical Architecture Specification v2
## Engineering Blueprint for Build

**Derived from**: Baljia Knowledge Graph v2 (13 domains)
**Version**: v2 — all 70 audit findings applied

---

# PART 1: SYSTEM TOPOLOGY & SERVICE MAP

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: FOUNDER-FACING                                      │
│  Web App (React) │ Chat/CEO Gateway │ Dashboard API │        │
│  Public Wall API │ Onboarding Pipeline (Sapiom sandbox)      │
├─────────────────────────────────────────────────────────────┤
│ LAYER 2: ORCHESTRATION                                       │
│  Task Queue Manager │ Router Service │ Governance Engine │   │
│  Night Planner │ Worker Launcher │ Watchdog Monitor │        │
│  Verification Service │ Failure Learning Service             │
├─────────────────────────────────────────────────────────────┤
│ LAYER 3: PLATFORM SERVICES                                   │
│  Billing Service │ Memory Service │ Provisioning Service │   │
│  Tool Registry │ OAuth Manager │ Event Bus │ Agent Factory   │
├─────────────────────────────────────────────────────────────┤
│ LAYER 4: INFRASTRUCTURE                                      │
│  Postgres(Neon) │ Redis │ R2 │ Render │ GitHub │            │
│  Browserbase │ Postmark │ Stripe │ Tavily │ LLM APIs        │
└─────────────────────────────────────────────────────────────┘
```

## 1.1 Service Contracts

| Service | Owns | Consumed By |
|---------|------|-------------|
| Chat Gateway | Founder conversation, request intake | Web App |
| Task Queue Manager | Task CRUD, lifecycle, ordering | Chat Gateway, Night Planner, Workers |
| Router Service | Agent selection, tag→agent mapping, historical routing | Task Queue Manager |
| Governance Engine | Task sizing, split, mode selection, credit quote | Chat Gateway, Task Queue Manager |
| Worker Launcher | Agent instantiation, context compilation, execution | Task Queue Manager |
| Watchdog Monitor | Stuck-run detection, progress tracking | Worker Launcher |
| Verification Service | Post-execution checks (5 levels), evidence capture | Worker Launcher |
| Failure Learning Service | Failure fingerprinting, clustering, regression guard | Verification Service, Night Planner |
| Night Planner | Stage-aware cycle planning, trust-recovery | Scheduler (cron) |
| Billing Service | Credits, subscriptions, ledger, Stripe | Governance Engine, Task Queue Manager |
| Memory Service | 3-layer memory, learnings, context assembly | Chat Gateway, Worker Launcher |
| Provisioning Service | Company creation, infra setup, slug management | Onboarding Pipeline |
| Event Bus | Platform-wide event distribution | All services, Live Wall |
| Tool Registry | MCP server registration, per-agent mount config | Worker Launcher, Agent Factory |
| Agent Factory | Agent config, prompt assembly, tool selection | Worker Launcher |
| OAuth Manager | Token storage, refresh, connection state | Tool Registry, Workers |

---

# PART 2: DATABASE SCHEMA

## 2.1 Core Tables

### `users`
```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  name            VARCHAR(255),
  twitter_handle  VARCHAR(100),
  auth_provider   VARCHAR(50) DEFAULT 'magic_link',  -- magic_link | google
  timezone        VARCHAR(50),
  locale          VARCHAR(10),
  ip_country      VARCHAR(5),
  device_type     VARCHAR(50),                       -- desktop | mobile | tablet
  referral_source VARCHAR(255),                      -- UTM source
  referral_code   VARCHAR(50) UNIQUE,
  referred_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

### `companies`
```sql
CREATE TABLE companies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID REFERENCES users(id),
  name              VARCHAR(255) NOT NULL,
  slug              VARCHAR(100) UNIQUE NOT NULL,
  one_liner         TEXT,
  original_idea     TEXT,                             -- preserved from onboarding
  claim_status      VARCHAR(50) DEFAULT 'owned',      -- owned | baljia_fund | unclaimed
  onboarding_status VARCHAR(50) DEFAULT 'initializing', -- initializing | completed
  plan_tier         VARCHAR(50) DEFAULT 'free',       -- free | trial | full | keep_live
  lifecycle         VARCHAR(50) DEFAULT 'trial_active',
  -- lifecycle: trial_active | trial_expired | full_active | keep_live_active | suspended_billing | archived | deleted
  execution_state   VARCHAR(50) DEFAULT 'active',     -- active | paused | suspended
  billing_state     VARCHAR(50) DEFAULT 'free',       -- free | trial | active | past_due | cancelled
  hosting_state     VARCHAR(50) DEFAULT 'live',       -- live | suspended | archived
  company_stage     VARCHAR(50) DEFAULT 'early',      -- early | validation | monetization | retention | scale | compounding
  subdomain         VARCHAR(255),                     -- {slug}.baljia.app
  email_identity    VARCHAR(255),                     -- {slug}@baljia.app
  github_repo       VARCHAR(255),
  render_service_id VARCHAR(255),
  neon_database_id  VARCHAR(255),
  custom_domain     VARCHAR(255),
  timezone          VARCHAR(50),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  deleted_at        TIMESTAMPTZ                       -- soft delete, 30-day retention
);
CREATE INDEX idx_companies_owner ON companies(owner_id);
CREATE INDEX idx_companies_slug ON companies(slug);
```

### `tasks`
```sql
CREATE TABLE tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID REFERENCES companies(id) NOT NULL,
  title                 VARCHAR(500) NOT NULL,
  description           TEXT,
  tag                   VARCHAR(50) NOT NULL,
  -- tags: engineering | browser | research | data | support | twitter | meta_ads | cold_outreach | growth | content | ops
  task_type             VARCHAR(50),
  -- types: bug | feature | refactor | css | auth | seo | onboarding | infrastructure | copy | research | outreach
  status                VARCHAR(50) DEFAULT 'created',
  -- statuses: created | todo | in_progress | completed_verified | completed_unverified | failed | rejected | blocked | partial
  priority              INTEGER DEFAULT 0,
  complexity            INTEGER,                      -- 1-10 planning metadata (1=trivial, 10=very complex)
  queue_order           INTEGER,                      -- mutable queue position, separate from priority
  source                VARCHAR(50) DEFAULT 'founder_requested',
  -- sources: founder_requested | ceo_suggested | night_shift_generated | auto_remediation | recurring | onboarding
  suggestion_reasoning  TEXT,                         -- why the platform created this task
  executability_type    VARCHAR(50) DEFAULT 'can_run_now',
  -- types: can_run_now | needs_new_connection | manual_task
  execution_mode        VARCHAR(50),
  -- modes: deterministic | template_plus_params | full_agent
  assigned_to_agent_id  INTEGER,                      -- can be null (lazy assignment at execution)
  estimated_hours       DECIMAL(4,1),
  estimated_credits     INTEGER DEFAULT 1,
  actual_credits_charged INTEGER DEFAULT 0,
  verification_level    VARCHAR(50),
  -- levels: none | deterministic | browser_flow | quality_review | hybrid
  failure_class         VARCHAR(50),
  -- classes: NULL | founder_ambiguity | missing_prerequisite | platform_scoping | worker_failure | external_dependency
  related_task_ids      UUID[],
  run_link              VARCHAR(500),                 -- magic-auth execution URL (needs TTL/revocation)
  markdown_link         VARCHAR(500),                 -- deep-link to dashboard detail
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
```

### `task_executions`
```sql
CREATE TABLE task_executions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             UUID REFERENCES tasks(id) NOT NULL,
  agent_id            INTEGER NOT NULL,
  execution_mode      VARCHAR(50) NOT NULL,
  status              VARCHAR(50) DEFAULT 'running',
  -- statuses: running | completed | failed | timed_out | killed
  turn_count          INTEGER DEFAULT 0,
  max_turns           INTEGER NOT NULL,
  started_at          TIMESTAMPTZ DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  wall_clock_seconds  INTEGER,
  token_usage         JSONB,                          -- {input, output, model}
  error_summary       TEXT,
  watchdog_events     JSONB[],                        -- [{ts, event, tool, elapsed}]
  verification_evidence JSONB,                        -- {screenshot_url, dom_assertion, api_response, db_assertion, deploy_status, log_summary, artifact_url, external_id, quality_score}
  execution_log       JSONB[],                        -- [{step, tool, action, result, timestamp}] - founder-visible structured log
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_executions_task ON task_executions(task_id);
```

### `reports`
```sql
CREATE TABLE reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES companies(id) NOT NULL,
  task_id       UUID REFERENCES tasks(id),
  title         VARCHAR(500),
  content       TEXT,
  report_type   VARCHAR(50),                          -- execution_report | market_research | analytics | strategy | onboarding_research
  structured_data JSONB,                              -- for market_research: {target_market, market_size, competitors, strategy, audience_framing}
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### `documents`
```sql
CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES companies(id) NOT NULL,
  doc_type      VARCHAR(50) NOT NULL,
  -- core types: mission | product_overview | tech_notes | brand_voice | user_research
  -- other: market_research | custom | user_context (possible alias/hidden surface)
  title         VARCHAR(500),
  content       TEXT,
  source        VARCHAR(50),                          -- onboarding | chat_draft | agent_output | founder_edit
  version       INTEGER DEFAULT 1,
  is_empty      BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX idx_documents_company_type ON documents(company_id, doc_type)
  WHERE doc_type IN ('mission', 'product_overview', 'tech_notes', 'brand_voice', 'user_research');
```

### `document_suggestions`
```sql
-- Locked rebuild choice: core documents update via founder-reviewed suggestions only
CREATE TABLE document_suggestions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES companies(id) NOT NULL,
  document_id   UUID REFERENCES documents(id) NOT NULL,
  task_id       UUID REFERENCES tasks(id),            -- which task triggered the suggestion
  suggested_content TEXT NOT NULL,
  reason        TEXT,                                  -- why the update is suggested
  status        VARCHAR(50) DEFAULT 'pending',         -- pending | accepted | edited | skipped
  created_at    TIMESTAMPTZ DEFAULT now(),
  reviewed_at   TIMESTAMPTZ
);
```

### `memory_layers`
```sql
CREATE TABLE memory_layers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES companies(id) NOT NULL,
  layer         INTEGER NOT NULL CHECK (layer IN (1, 2, 3)),
  content       TEXT,
  token_count   INTEGER DEFAULT 0,
  max_tokens    INTEGER NOT NULL,                     -- L1: 15000, L2: 3000, L3: 15000
  version       INTEGER DEFAULT 1,
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX idx_memory_company_layer ON memory_layers(company_id, layer);
```

### `learnings`
```sql
CREATE TABLE learnings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES companies(id) NOT NULL,
  task_id       UUID REFERENCES tasks(id),
  agent_id      INTEGER,
  category      VARCHAR(100),
  tags          VARCHAR(100)[],
  content       TEXT NOT NULL,
  confidence    VARCHAR(20) DEFAULT 'medium',
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_learnings_company ON learnings(company_id);
CREATE INDEX idx_learnings_tags ON learnings USING GIN(tags);
```

## 2.2 Billing & Credits

### `subscriptions`
```sql
CREATE TABLE subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID REFERENCES users(id) NOT NULL,
  company_id             UUID REFERENCES companies(id),
  stripe_subscription_id VARCHAR(255),
  plan_type              VARCHAR(50) NOT NULL,         -- trial | full | keep_live
  status                 VARCHAR(50) DEFAULT 'active',
  trial_ends_at          TIMESTAMPTZ,
  night_shifts_remaining INTEGER DEFAULT 0,
  night_shifts_total     INTEGER DEFAULT 0,            -- 30 for full, 3 for trial
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT now()
);
```

### `credit_ledger`
```sql
CREATE TABLE credit_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES companies(id) NOT NULL,
  entry_type    VARCHAR(50) NOT NULL,
  -- types: monthly_grant | welcome_bonus | addon_purchase | task_deduction | refund | night_shift_deduction | referral_bonus
  amount        INTEGER NOT NULL,                     -- positive=credit, negative=debit
  balance_after INTEGER NOT NULL,
  task_id       UUID REFERENCES tasks(id),
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
-- NOTE: night_shift_deduction is internal accounting; founder sees night shifts as "included capacity"
CREATE INDEX idx_credit_ledger_company ON credit_ledger(company_id);
```

### `revenue_ledger`
```sql
CREATE TABLE revenue_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) NOT NULL,
  entry_type      VARCHAR(50) NOT NULL,
  -- types: customer_payment | platform_fee | stripe_fee | refund | dispute | withdrawal
  gross_amount    DECIMAL(10,2),
  net_amount      DECIMAL(10,2),
  platform_fee_rate DECIMAL(3,2) DEFAULT 0.20,        -- 20% default
  stripe_charge_id VARCHAR(255),
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### `ad_spend_ledger`
```sql
CREATE TABLE ad_spend_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) NOT NULL,
  campaign_id     UUID REFERENCES ad_campaigns(id),
  daily_budget    DECIMAL(10,2),
  actual_spend    DECIMAL(10,2),
  platform_fee    DECIMAL(10,2),                      -- 20% of spend
  charge_date     DATE,
  stripe_charge_id VARCHAR(255),
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### `refund_history`
```sql
CREATE TABLE refund_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) NOT NULL,
  task_id         UUID REFERENCES tasks(id),
  failure_class   VARCHAR(50),
  decision        VARCHAR(50) NOT NULL,               -- auto_refund | partial_refund | deny | route_to_human
  reason          TEXT,
  credits_refunded INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### `referrals`
```sql
CREATE TABLE referrals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     UUID REFERENCES users(id) NOT NULL,
  referred_id     UUID REFERENCES users(id) NOT NULL,
  status          VARCHAR(50) DEFAULT 'signed_up',    -- signed_up | trial | subscribed | credited
  credits_awarded INTEGER DEFAULT 0,                  -- 25 on subscription
  created_at      TIMESTAMPTZ DEFAULT now(),
  converted_at    TIMESTAMPTZ
);
```

## 2.3 Agent & Tool Tables

### `agents`
```sql
CREATE TABLE agents (
  id                INTEGER PRIMARY KEY,
  name              VARCHAR(100) NOT NULL,
  role              VARCHAR(100),
  base_system_prompt TEXT,                            -- template, NOT full runtime prompt
  default_max_turns INTEGER DEFAULT 200,
  default_model     VARCHAR(100),
  execution_style   VARCHAR(50),                      -- agentic | structured | graph
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now()
);
```

### `mcp_servers`
```sql
CREATE TABLE mcp_servers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) UNIQUE NOT NULL,
  category        VARCHAR(50),                        -- platform_infra | business | internal_platform | conditional
  tool_count      INTEGER,
  is_available    BOOLEAN DEFAULT true,
  requires_oauth  BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### `mcp_tools`
```sql
CREATE TABLE mcp_tools (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id         UUID REFERENCES mcp_servers(id) NOT NULL,
  name              VARCHAR(100) NOT NULL,
  description       TEXT,
  risk_level        VARCHAR(20) DEFAULT 'low',        -- low | medium | high | critical
  requires_approval BOOLEAN DEFAULT false,
  UNIQUE(server_id, name)
);
```

### `agent_tool_mounts`
```sql
CREATE TABLE agent_tool_mounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        INTEGER REFERENCES agents(id) NOT NULL,
  mcp_server_id   UUID REFERENCES mcp_servers(id) NOT NULL,
  is_required     BOOLEAN DEFAULT false,
  requires_oauth  BOOLEAN DEFAULT false,
  UNIQUE(agent_id, mcp_server_id)
);
```

## 2.4 Night Shift & Recurring

### `recurring_tasks`
```sql
CREATE TABLE recurring_tasks (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID REFERENCES companies(id) NOT NULL,
  title                    VARCHAR(500) NOT NULL,
  description              TEXT,
  tag                      VARCHAR(50) NOT NULL,
  priority                 INTEGER DEFAULT 0,
  cadence                  VARCHAR(50) NOT NULL,       -- daily | weekly | biweekly | monthly
  monthly_credits_estimate INTEGER,
  is_active                BOOLEAN DEFAULT true,
  last_run_at              TIMESTAMPTZ,
  next_run_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ DEFAULT now()
);
```

### `night_shift_cycles`
```sql
CREATE TABLE night_shift_cycles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) NOT NULL,
  cycle_number    INTEGER,
  company_stage   VARCHAR(50),
  trust_score     DECIMAL(3,2),
  planned_tasks   UUID[],
  executed_tasks  UUID[],
  summary         TEXT,                               -- what shipped | in progress | queued | tomorrow's focus
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

## 2.5 Communication & Browser

### `email_threads`, `contacts`, `browser_credentials`, `ad_campaigns`
*(Same as v1 — no audit findings on these tables)*

```sql
CREATE TABLE email_threads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id) NOT NULL,
  thread_id   VARCHAR(255),
  subject     VARCHAR(500),
  from_address VARCHAR(255),
  to_address  VARCHAR(255),
  direction   VARCHAR(10),
  content     TEXT,
  is_read     BOOLEAN DEFAULT false,
  parent_id   UUID REFERENCES email_threads(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) NOT NULL,
  email           VARCHAR(255),
  name            VARCHAR(255),
  source          VARCHAR(50),
  lead_status     VARCHAR(50) DEFAULT 'pending',
  email_verified  BOOLEAN DEFAULT false,
  last_contacted_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE browser_credentials (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID REFERENCES companies(id) NOT NULL,
  site_domain         VARCHAR(255) NOT NULL,
  site_tier           INTEGER DEFAULT 3,
  username            VARCHAR(255),
  password_encrypted  BYTEA,                          -- AES-256-GCM
  browser_context_id  VARCHAR(255),
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, site_domain)
);

CREATE TABLE ad_campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID REFERENCES companies(id) NOT NULL,
  meta_campaign_id  VARCHAR(255),
  meta_adset_id     VARCHAR(255),
  meta_ad_id        VARCHAR(255),
  status            VARCHAR(50) DEFAULT 'draft',
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
```

## 2.6 Failure Learning

### `failure_fingerprints`
```sql
CREATE TABLE failure_fingerprints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint     VARCHAR(255) UNIQUE NOT NULL,       -- normalized failure signature
  category        VARCHAR(100),                       -- routing | tool_failure | timeout | scope | external
  description     TEXT,
  occurrence_count INTEGER DEFAULT 1,
  affected_agents INTEGER[],
  affected_tools  VARCHAR(100)[],
  fix_status      VARCHAR(50) DEFAULT 'open',         -- open | investigating | fixed | wont_fix
  regression_sensitive BOOLEAN DEFAULT false,
  first_seen_at   TIMESTAMPTZ DEFAULT now(),
  last_seen_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE task_failure_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID REFERENCES tasks(id) NOT NULL,
  fingerprint_id  UUID REFERENCES failure_fingerprints(id) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

---

# PART 3: EVENT BUS CONTRACT

```typescript
interface PlatformEvent {
  id: string; type: string; company_id: string;
  timestamp: string; payload: Record<string, any>;
  is_public_safe: boolean;
}

// Task, Company, Content, Metric, Mascot events — same as v1

// NEW: Failure events
type FailureEvents =
  | { type: 'task_failure_fingerprinted'; payload: { task_id, fingerprint_id, category } }
  | { type: 'known_issue_regression'; payload: { fingerprint_id, new_task_id } }
```

---

# PART 4: API CONTRACTS

## 4.1 Chat Gateway API
*(Same as v1 — no audit findings)*

## 4.2 Task Governance API (Updated)

```typescript
interface GovernanceDecision {
  verdict: 'approved' | 'split_required' | 'blocked' | 'refused';
  execution_mode: 'deterministic' | 'template_plus_params' | 'full_agent';
  estimated_credits: number;
  verification_level: 'none' | 'deterministic' | 'browser_flow' | 'quality_review' | 'hybrid';
  split_tasks?: TaskProposal[];
  blocker_reason?: string;
  refund_policy: 'auto_eligible' | 'manual_review' | 'no_refund';
  founder_safe_explanation: string;
}
```

## 4.3 Worker Launcher API (Updated)

```typescript
// Worker-side startup ceremony (11 steps):
// 1. Task exists in queue
// 2. Matching agent triggered by platform
// 3. System prompt loads (base_system_prompt + injections)
// 4. Mounted tools load (phantom mounts filtered out)
// 5. Memory context injected (Layer 2 + relevant learnings)
// 6. Skills context loads (if Engineering)
// 7. Agent calls get_available_tasks() — agent-side action
// 8. Agent calls start_task() — agent-side action, triggers credit deduction
// 9. Agent does the domain work
// 10. Agent calls create_report()
// 11. Agent calls complete_task() / fail_task() / block_task()
// Baljia improvement: steps 7-8, 10-11 move into platform to save 4 API calls

interface CompiledBriefing {
  task: TaskDetail;
  company_context: {
    name: string; slug: string; one_liner: string; stage: string;
  };
  memory_packet: {
    layer2_summary: string;
    relevant_learnings: string[];
    recent_task_summaries: string[];
    prior_related_reports: string[];          // NEW: enforce prior-report reading
  };
  template_vars: {                             // NEW: observed prompt variables
    company_name: string;
    current_date: string;
    cycles_completed: number;
    company_slug: string;
  };
  tool_surface: string[];
  skill_files: string[];
  instance_context?: {
    stack: string; schema_summary: string;
    recent_logs: string; relevant_code_chunks: string[];
    known_issues: string[];                    // NEW: from failure_fingerprints
  };
}
```

---

# PART 5: ONBOARDING PIPELINE SPEC (Updated)

```typescript
enum OnboardingStage {
  HEARTBEAT = 'heartbeat',
  ENRICH_FOUNDER = 'enrich_founder',
  ENRICH_BUSINESS = 'enrich_business',
  PERSIST_CONTEXT = 'persist_context',
  SELECT_STRATEGY = 'select_strategy',        // NEW: save_surprise_strategy
  NAME_COMPANY = 'name_company',
  GENERATE_MARKET_RESEARCH = 'generate_market_research',
  PROVISION_INFRASTRUCTURE = 'provision_infrastructure',
  CREATE_LANDING_PAGE = 'create_landing_page',
  SAVE_MISSION = 'save_mission',
  SEND_COMMUNICATIONS = 'send_communications',
  CREATE_STARTER_TASKS = 'create_starter_tasks',
  GENERATE_MAGIC_LINK = 'generate_magic_link',
  SEND_ACTIVATION = 'send_activation',
  FLUSH_DIAGNOSTICS = 'flush_diagnostics',
  CELEBRATE = 'celebrate'
}

// Runs in isolated Sapiom sandbox (async fire-and-forget + webhook callback)
// NOT a visible agent; NOT a normal background job

// 3-tier enrichment decision tree (UPDATED from v1)
interface EnrichmentResult {
  person_confidence: 'high' | 'medium' | 'low';
  business_confidence: 'high' | 'medium' | 'low';
  decision:
    | 'personalize_around_person'      // strong person match
    | 'personalize_around_business'    // weak person, strong business URL
    | 'bounded_bucket_fallback';       // weak both → 5-bucket system
}

// Starter tasks: per-journey templates (locked rebuild choice)
// Dependency chain: Research → Build → Growth (Baljia improvement)
// Handoff artifacts: research summary, ICP, competitor set, feature scope, live URL
interface StarterTaskMetadata {
  complexity: number;     // Engineering ~8, Research ~3, Growth ~4
  estimated_hours: number; // Engineering ~3, Research ~1, Growth ~1
  source: 'onboarding';
  assigned_to_agent_id: null;  // lazy assignment
  suggestion_reasoning: string;
  run_link: string;
  markdown_link: string;
}
```

---

# PART 6: NIGHT SHIFT SPEC (Updated)

```typescript
async function executeNightShift(companyId: string): Promise<void> {
  const state = await getCompanyState(companyId);
  
  // FIXED: trial also gets night shifts
  if (!['active', 'trial'].includes(state.billing_state)) return;
  if (state.night_shifts_remaining <= 0) return;
  
  const stage = await classifyCompanyStage(companyId);
  const trust = await getFounderTrustScore(companyId);
  
  // Stage-aware + trust-aware planning
  const plan = await nightPlanner.plan({
    companyId, stage, trustScore: trust,
    currentQueue: await getQueue(companyId),
    completedTasks: await getRecentCompleted(companyId),
    failedTasks: await getRecentFailed(companyId),      // NEW: failure context
    documents: await getDocumentState(companyId),
    founderSentiment: await getRecentChatSentiment(companyId),
    knownIssues: await getActiveFailureFingerprints(companyId)  // NEW
  });
  
  // Priority: trust recovery → repair → regression prevention → roadmap
  for (const task of plan.executableTasks) {
    await executeTask(task);
  }
  
  // Deliver summary via send_reply (async founder-message delivery)
  const summary = await generateNightSummary(companyId, plan);
  await sendReply(companyId, summary);
  
  await deductNightShift(companyId);
}
```

---

# PART 7: VERIFICATION FRAMEWORK (Updated)

```typescript
// 5 verification levels (FIXED from v1's 3)
enum VerificationLevel {
  NONE = 'none',                        // low-risk internal bookkeeping
  DETERMINISTIC = 'deterministic',      // API, DB, log, deploy assertions
  BROWSER_FLOW = 'browser_flow',        // scripted browser UI validation
  QUALITY_REVIEW = 'quality_review',    // LLM/rubric-based judgment for subjective output
  HYBRID = 'hybrid'                     // deterministic + browser + quality
}

// Verification by task type
// backend/API → deterministic | UI/product → browser_flow or hybrid
// content/copy → quality_review | outreach/posting → deterministic + optional quality
// recurring reports → deterministic data checks

// Worker is NOT the final authority on completion
// Verifier sets final status, NOT the agent
async function executeWithVerification(task, agent): Promise<void> {
  const result = await agent.execute(task);
  const verification = await verify(task.id, task.verification_level);
  
  // Capture typed evidence
  const evidence = await captureEvidence(task, verification);
  // Types: screenshot, dom_assertion, api_response, db_assertion,
  // deploy_status, log_summary, artifact_url, external_id, quality_score
  
  await saveVerificationEvidence(task.id, evidence);
  
  if (verification.passed) {
    await setTaskStatus(task.id, 'completed_verified');    // platform sets, not agent
  } else if (verification.is_minor_fixable && agent.turn_count < agent.max_turns * 0.8) {
    await agent.repair(verification.issues);
    const reVerification = await verify(task.id, task.verification_level);
    if (reVerification.passed) {
      await setTaskStatus(task.id, 'completed_verified');
    } else {
      await setTaskStatus(task.id, 'failed');
      await fingerprintFailure(task.id, reVerification);   // NEW: failure learning
    }
  } else {
    await setTaskStatus(task.id, 'failed');
    await fingerprintFailure(task.id, verification);       // NEW: failure learning
  }
}
```

---

# PART 8: AGENT FACTORY (Updated)

```typescript
async function assembleAgentPrompt(agentId, taskId, executionMode): Promise<string> {
  const agent = await getAgent(agentId);
  const task = await getTask(taskId);
  const company = await getCompany(task.company_id);
  
  // 1. Base system prompt template
  let prompt = agent.base_system_prompt;  // FIXED: renamed from system_prompt
  
  // 2. Template variable injection (NEW)
  prompt = prompt
    .replace('{{company_name}}', company.name)
    .replace('{{current_date}}', new Date().toISOString().split('T')[0])
    .replace('{{cycles_completed}}', String(await getCyclesCompleted(company.id)))
    .replace('{{company_slug}}', company.slug);
  
  // 3. Company context
  prompt += `\n\n## Company Context\n${company.name} - ${company.one_liner}`;
  
  // 4. Memory injection (Layer 2 + learnings + prior reports)
  const memory = await memoryService.getWorkerPacket(task.company_id, agentId);
  prompt += `\n\n## Memory\n${memory}`;
  
  // 5. Prior related reports (NEW: enforce reading)
  if (task.related_task_ids?.length) {
    const priorReports = await getReportsForTasks(task.related_task_ids);
    if (priorReports.length) {
      prompt += `\n\n## Prior Related Work\n${priorReports.map(r => r.content).join('\n---\n')}`;
    }
  }
  
  // 6. Known issues context (NEW: from failure fingerprints)
  const knownIssues = await getRelevantFailureContext(task.company_id, task.tag);
  if (knownIssues.length) {
    prompt += `\n\n## Known Issues\n${knownIssues.join('\n')}`;
  }
  
  // 7. Task briefing
  prompt += `\n\n## Your Task\n${task.title}\n${task.description}`;
  
  // 8. Mode-specific instructions
  if (executionMode === 'deterministic') {
    prompt += '\n\nFollow the template exactly. No creative interpretation.';
  }
  
  // 9. Skills (Engineering only — skip shared skills block on non-Engineering agents)
  if (agentId === ENGINEERING_AGENT_ID) {
    const skills = await getRelevantSkills(task);
    prompt += `\n\n## Skills\n${skills}`;
  }
  
  // 10. Instance context (Engineering/Data only)
  if ([ENGINEERING_AGENT_ID, DATA_AGENT_ID].includes(agentId)) {
    const ctx = await compileInstanceContext(task.company_id);
    prompt += `\n\n## Instance Context\n${ctx}`;
  }
  
  return prompt;
}

// Tool mount resolution — same as v1 with phantom-mount filtering
```

---

# PART 9: IMPLEMENTATION PRIORITIES (Updated)

## Phase 0: Foundation (Weeks 1-3)
- [ ] Postgres schema (ALL tables above including document_suggestions, failure_fingerprints, referrals)
- [ ] Event bus (Redis Pub/Sub) — needed by Watchdog in Phase 1
- [ ] User auth (magic link + Google OAuth)
- [ ] Company CRUD + slug generation + provisioning
- [ ] Dashboard shell (React) — desktop 3-column + mobile single-column
- [ ] Chat gateway (WebSocket + CEO prompt)

## Phase 1: Core Execution (Weeks 4-7)
- [ ] Task management (full lifecycle + queue + task board with 6 tabs)
- [ ] Credit/billing system (Stripe + 4-lane billing + ledger)
- [ ] Governance engine (sizing + mode selection + split enforcement + credit quote)
- [ ] Worker launcher + agent factory + prompt assembly (with template vars + prior reports)
- [ ] Engineering agent (with infra equivalent + 3 execution modes)
- [ ] Provisioning service (subdomain, email, repo, deploy)
- [ ] Watchdog monitor

## Phase 2: Agent Fleet (Weeks 8-11)
- [ ] Browser agent (Browserbase + browser_auth + site tier system)
- [ ] Research agent (with Tavily read-only web)
- [ ] Data agent + Support agent + company email
- [ ] Verification service (5 levels + evidence capture + verifier-as-authority)

## Phase 3: Growth (Weeks 12-15)
- [ ] Twitter agent (with voice rules + dedupe)
- [ ] Meta Ads agent (Sora + optimization thresholds + moderation)
- [ ] Cold Outreach agent (Hunter.io + proper lead pipeline)
- [ ] Night shift system (planner + scheduler + stage classification + trust scoring)
- [ ] Recurring tasks
- [ ] Onboarding pipeline (3 journeys + Sapiom-style sandbox + 3-tier enrichment)

## Phase 4: Public Proof (Weeks 16-18)
- [ ] Live operations wall (/live page with 3-column layout)
- [ ] Public company pages
- [ ] Real-time event projection + redaction rules
- [ ] Baljia mascot state system (7 states)
- [ ] Portfolio view

## Phase 5: Platform Maturity (Weeks 19+)
- [ ] Closed-loop failure learning (6-step: capture → fingerprint → registry → fix → monitor → feedback)
- [ ] Remediation/trust-recovery loop
- [ ] Memory improvement + unified retrieval surface
- [ ] Platform ops monitoring
- [ ] Referral system (25 credits on subscription)
- [ ] FAQ knowledge base (categorized accordion)
- [ ] Document suggestion review system

---

*v2 — All 70 audit findings applied. Maps 1:1 to Knowledge Graph v2.*
