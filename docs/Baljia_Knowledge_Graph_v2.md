# Baljia AI — Structured Knowledge Graph v2
## Derived from Polsia Architecture Intelligence

**Purpose**: Restructures the 10,833-line Polsia architecture dossier into buildable domains. All 70 audit findings applied. Every detail preserved, ambiguities flagged, improvements separated from parity.

**Build Principle**: Copy the founder experience. Improve the internal machinery.

**Version**: v2 — incorporates 24 error fixes, 34 omission fixes, 9 stale/misleading corrections, 3 consistency fixes.

---

# DOMAIN 1: FOUNDER JOURNEY & EXPERIENCE

## 1.1 Public Entry Funnel

**Two-surface public entry:**
- Marketing homepage — headline "AI That Runs Your Company While You Sleep", `Get Started` CTA, `Sign in` link, "No credit card required · Free to start", footer with About/Terms/Privacy/Contact
- Live proof page at `/live` — real-time three-column operations wall with lead capture

**Auth layer:**
- `Get Started` → account creation (Google OAuth + direct email)
- `Sign in` → passwordless magic-link email login (no password needed)

**Baljia equivalent:** `baljia.ai` (marketing) + `baljia.ai/live` (proof wall) + same passwordless auth. Single-domain deployment is sufficient (locked rebuild choice).

## 1.2 Onboarding Tree

**Level 1 choice:**
1. `Create a new company`
2. `Grow my company` (existing business)

**Level 2 under "Create a new company":**
1. `Surprise me` — zero explicit input; lands directly into initializing dashboard (no visible chooser); system researches founder identity via hidden enrichment pipeline
2. `Build my idea` — founder provides one idea in a text box; uses SAME hidden enrichment pipeline as Surprise Me but combines typed idea + person research + geo context; NO deep clarification conversation; optimizes for speed over discovery

**"Grow my company" path:**
- Asks: "What's your company's website?" with URL input + "Get started" CTA
- URL is loosely interpreted (any URL accepted)
- System auto-generates company interpretation from resolved URL target (follows redirects)
- **Known weakness:** Can misunderstand the business and rename it without strong correction step; can continue with wrong company understanding if URL is low-signal
- **Baljia improvement:** URL confidence scoring → pause if low confidence → show inferred identity → ask for correction before proceeding (Section 26.9)

**Cross-journey weaknesses (all 3 paths):**
- Weak or missing immediate "aha" moment
- Dashboard can look more complete than it is
- Limited journey-specific adaptation after onboarding
- Chat is the main fallback when users are unsure what to do
- Weak re-engagement after drop-off
- Little structured correction before commitment (no cross-questioning, weak validation)

## 1.3 Hidden Onboarding Pipeline (Control Plane)

**This is NOT a visible agent. It runs in a dedicated isolated sandbox ("Sapiom") with async fire-and-forget + webhook-callback completion. No dedicated visible "Onboarding Agent" among the 8 workers.**

**Ordered sequence (observed from logs):**
1. `Stage: heartbeat`
2. Search business URL
3. Search person/background queries (LinkedIn, Twitter, geo-augmented)
4. Fetch web pages for enrichment
5. Review documents
6. Save user profile (merge-based — fills blank fields only, preserves existing data)
7. Save user context
8. **Select strategy** (`save_surprise_strategy` — e.g., "Novel Idea" saved)
9. Update company name (with slug collision handling + retries)
10. Save Market Research Report (structured: target market, market size, competitors, strategy, localized audience framing)
11. Send welcome email
12. Post to Twitter (shared @polsia account)
13. Create landing page → live at `{slug}.polsia.app`
14. Save mission document
15. Create 3 task proposals (batch, within milliseconds of each other)
16. Generate magic login link
17. Send inbox message + summary email
18. `Stage: flush_diagnostics`
19. Celebration callback (`Celebrating!` / `Celebration triggered!`)

**Watchdog runs during onboarding:** Reports elapsed time and active internal tool (e.g., `Watchdog: 0s since progress, active tool=ToolSearch (0s)`)

**Slug collision policy:**
- Candidate can fail if unique slug cannot be generated (e.g., `Could not generate unique slug for "leadpilot"`)
- Others get numeric suffix (e.g., `pipeforce-2`, `dealforge-57`, `reachforge-3`)
- Company display name stays clean; slug gets suffix underneath

**Naming behavior by journey:**
- New ventures → synthetic startup brand name (e.g., `AutomateX`, `Qontakt`)
- Existing business → semantic wrapper with OS-style suffix (e.g., `XYZ Registry` → `XYZOS`, `CoAuthor AI` → `CoAuthorOS`)

**3-tier enrichment decision tree:**
1. Strong person match → personalize around the person's background
2. Weak person match but strong business URL → personalize around the business context
3. Weak both → fall back to bounded bucket system

**Enrichment confidence behavior:**
- Ambiguous person match → avoid strong personal claims
- Strong business-site context → use site as primary context
- URL redirects → reason from resolved destination

## 1.4 Idea Generation Engine

**NOT infinite creativity. Bounded by stack fit, trend timing, revenue clarity, speed to launch, demo quality.**

**Two-level bucket system:**

Level 1 — 5 abstract business shapes (hidden fallback):
1. Sell a tool
2. Connect two sides (marketplace)
3. Sell content or knowledge
4. Sell a service page
5. Automate a process

Level 2 — 12 stack-friendly business categories:
SaaS tools, marketplaces, agencies/services, directories/listing sites, creator tools, ecommerce, communities, lead-gen/affiliate models, booking/scheduling, internal tools, education/course products, AI wrappers

**Selection inputs:** founder context, city/region, company path, market/trend signals, delivery fit with platform stack, revenue clarity, time-to-first-value

**Dedupe/saturation protection (Baljia improvement):** same-market duplicate suppression, regional overlap awareness, recent suggestion memory, differentiation pressure

**Signup signal usage (Baljia improvement):** IP→local market framing; locale→language defaults; timezone→night-shift timing; device→builder vs browser posture; referral source→different aha strategy; OAuth profile/email domain→side-project vs existing business separation

## 1.5 Mission Document Template

**Highly repeatable 3-section rhetorical template (Mad-Libs-like):**

Section 1 — Pain opener: `No [target persona] should [lose/miss a valuable thing] because they couldn't [act fast/affordably enough].` Biased toward loss-oriented, speed-pain, cost-pain framing.

Section 2 — Product description: `handles everything between "[start state]" and "[end state]"` + exactly 4 product-action verbs (e.g., prospects/writes outreach/follows up/qualifies). Overstates scope relative to actual MVP.

Section 3 — Vision: `A world where every [small entity], from a [small example] to a [growing example], has access to the same [capability] that [large companies] take for granted. No [expensive human]. No [expensive tool]. Just [AI product framing].` Geo-localized examples, Fortune 500 comparison frame.

**Baljia locked choice:** Use `approximate parity` — preserve founder-facing feel and 3-part shape but don't force exact Mad-Libs repetition.

## 1.6 Free Session Outputs (Before Payment)

Created before any paid conversion (no card required):
- Company record + slug + subdomain (`{slug}.baljia.app`)
- Company email identity (`{slug}@baljia.app`)
- Mission document (populated)
- Market Research Report (structured, not free-form)
- Landing page (live deployed HTML)
- Welcome email
- Launch tweet (shared @polsia account)
- 3 starter tasks (queued, NOT executed)
- Dashboard with all above visible
- One-liner
- Quick links to generated surfaces
- Unlimited CEO/chat access

**Empty by default at signup:** `product_overview`, `tech_notes`, `brand_voice`, `user_research`

**Note:** `available_documents` surface only shows populated docs. Empty slots may not appear in certain dashboard/agent contexts.

**Possible additional hidden document:** `user_context` is referenced by at least one agent prompt but may be an alias for `user_research` or a separate hidden surface. Treat as open question.

## 1.7 Starter Task Formula

**Rigid 3-task pattern (not tailored to business type):**
1. Engineering task — complexity ~8, estimated ~3 hours (e.g., "Build the Client Portal MVP")
2. Research task — complexity ~3, estimated ~1 hour
3. Growth task — complexity ~4, estimated ~1 hour

All have: `assigned_to_agent_id: null` (lazy assignment at execution), source `onboarding`, include `run_link`, `markdown_link`, and `suggestion_reasoning`

**Known structural problems:**
- Engineering task starts at high complexity, bundles many features
- Research task routes to agent with no web access
- Growth task assumes tools/channels not present on execution path
- Order is backwards (build before research/validation)
- Tasks don't form a dependency chain — exist in parallel without feeding each other
- No tiny quick-win task for immediate gratification
- Titles read like product copy, not execution specs

**Baljia improvements:**
- Different starter-task templates per journey (locked rebuild choice)
- Stage-aware, dependency-chained (Research → Build → Growth), right-sized, with a quick-win first
- Structured handoff artifacts between tasks: research summary, ICP, competitor set, feature scope, current product state, CTA, live URL

## 1.8 Trial & Conversion Flow

**Pre-trial (no card):** artifacts, planning, live surfaces, CEO/chat — all free

**Trial structure (card required for activation):**
- 3-day free trial
- 3 night shifts included during trial
- Trial credit budget: source says "10 credits" in direct user clarification; one conversation also frames it as "5 base + 10 welcome = 15 credit sprint" — treat as ambiguous, likely 10
- Trial activation unlocks execution (queued tasks don't run before)
- Trial is same product as paid — not a separate limited mode

**Trial unlock behavior:**
- Starter tasks do NOT instant-run at trial start
- Founder can manually choose or reorder what runs first
- If founder stays passive, autopilot likely picks from queue during cycle windows
- Credit deduction happens at `start_task` (todo → in_progress)

**Emotional arc:**
1. Instant value before payment (artifacts, live surfaces, momentum)
2. Visible progress during trial
3. Convert to continuous subscription
4. Operational lock-in before cancellation

**Post-trial states:**
- `trial_active` → `trial_expired` → convert or suspend
- Full plan: `$49/month`
- Keep-live plan: `$19/month` (no night shifts, ~5 manual credits)
- Suspension: site shows pause page (should NOT say "suspended by owner" — use honest messaging)
- Post-trial: planning persists, queued work persists, execution pauses — product becomes paused operating system, not disappearing

**Trial-to-paid transition:** Primarily billing-state and credit-renewal change, NOT dramatic capability switch

## 1.9 Founder Dashboard Layout

**Desktop: Scrollable dashboard with resizable right-side chat panel:**

From top to bottom:
- Black terminal-like activity strip
- Company name as main header
- Three-column body:
  - **Left**: Mascot/status card with adjective summary, trial CTA (`Hire Your AI Employee` / `Start free trial`), Business metrics (Revenue, Balance)
  - **Center**: Task cards, Documents, Links
  - **Right**: Twitter, Email, Ads, CEO chat/support panel (scrollable, can be widened to overlay main content)

**Right-side chat panel contains:** scrollable reasoning/conversation area, current assistant answer, close control, `Ask Polsia anything...` composer, onboarding checklist summary (researched market, sent welcome email, tweeted, built landing page, created mission, queued 3 tasks)

**Task board:** Visible tabs: `To Do`, `Recurring`, `In Progress`, `Completed`, `Rejected`, `Failed`. Clicking a task attempts to start it. No-credit state shows tasks but redirects to payment on execution attempt.

**Mobile: Single-column stacked layout:**
Terminal strip → company name + Menu → mascot/status → trial CTA → Business metrics → Tasks → Documents → Links → Twitter → Email → Ads. Floating circular chat button in lower-right.

**Menu dropdown:** My Portfolio, New Company, Task Credits (with count), Upgrade, Company Settings, Profile Settings, About, FAQ, Refer & Earn, Logout

**Settings (all modals, not page navigations):**
- Company Settings: edit name, pause company, delete company
- Profile Settings: name, email, Twitter handle, delete account
- Refer & Earn: referral URL, copy button, counters, 25 credits earned on referred user's paid subscription only
- FAQ: categorized accordion knowledge base

**+ New button:** Triggers slide-in purchase sheet (not a separate page): 3-Day Free Trial, then $49/month, included items, extra companies/credits selectors, Start CTA, cancel anytime reassurance

## 1.10 Portfolio View

**Multi-company dashboard with:** `My Portfolio` header, summary metrics (Views, Users, Revenue, Companies), company table (name, domain, description, per-company metrics)

---

# DOMAIN 2: AGENT ARCHITECTURE

## 2.1 Agent Catalog (9 Total)

| # | Agent | ID | Role | Max Turns |
|---|-------|----|------|-----------|
| 0 | CEO/Chat | — | Founder-facing brain, planning, routing, task creation, credit guardrail | Reactive (no self-loop) |
| 1 | Engineering | 30 | Build, fix, deploy, integrate | 200 |
| 2 | Browser | 42 | Interactive web execution, credential management | 200 |
| 3 | Research | 29 | Internal synthesis, non-browser qualification | 200 |
| 4 | Data | 33 | SQL, metrics, logs, analysis | 200 |
| 5 | Support | 32 | Customer email replies, escalation | 200 |
| 6 | Twitter | — | Compose and post tweets | 200 |
| 7 | Meta Ads | — | Ad creation, optimization, campaign control | 100 |
| 8 | Cold Outreach | 54 | Outbound email, verification, follow-ups | 200 |

**Key architectural truths:**
- No direct agent-to-agent invocation; no true subagent tree
- Coordination via task queue only (through `create_task_proposal`)
- CEO/chat is reactive, not self-looping (loop risk is in workers only)
- No smart loop detector — `maxTurns` is the hard kill switch + 4-hour ceiling
- No repeated-tool-call detection, no compute circuit breaker, no inter-agent rescue
- Workers run a 4-step lifecycle overhead per task: find task, start task, write report, complete task (Baljia improvement: move lifecycle into platform)
- Fixed token overhead: every task forces LLM to reread all tool definitions + shared context even for tiny tasks
- Shared skills block appears across agents even where skill creation isn't relevant (prompt waste)

**Capability validation weakness:** All agents can return "FULL CAPABILITY to execute" even when they lack required tools (Research has no search, Support lacks Gmail). Capability check validates mount presence at coarse level only.

## 2.2 Common vs Specialized Tool Pattern

**Every worker shares a common backbone:**
- `tasks` (8 tools) — on all 8 workers
- `reports` (3 tools) — on all 8 workers
- Injected memory context (NOT a callable tool)
- Skills guidance (filesystem/injected, NOT a registered MCP)

**Semi-shared surfaces:**
- `polsia_support` (2 tools) — most workers except Twitter and Meta Ads
- `documents` (3 tools) — mainly Twitter and Cold Outreach. **NOTE: Engineering, Data, Browser, Research do NOT have document access in the observed model.**
- `company_email` (5 tools) — mainly Browser, Support, Cold Outreach

**Specialized surfaces:**
- Engineering: `polsia_infra` (9 tools)
- Browser: `browserbase` (9 tools) + `browser_auth` (11 tools) + `company_email`
- Data: `polsia_infra` (analytics behavior)
- Support: `company_email` + conditional `gmail`
- Twitter: `twitter` (2 tools) + `documents`
- Meta Ads: `meta_ads` (12 tools)
- Cold Outreach: `company_email` + `hunter_io` (2 tools) + `documents`

**Tool counts:** Engineering: ~22 | Browser: ~38 | Data: ~22 | Research: ~13 | Support: ~18 | Twitter: ~16 | Meta Ads: ~23 | Cold Outreach: ~23

## 2.3 CEO/Chat Control Surface (~44 tools in 4 groups)

**30 chat/control tools:** get_context, get_tasks, create_task, edit_task, reject_task, score_task, get_task_details, get_task_execution_logs, get_task_execution_status, get_active_executions, approve_task, reorder_task, move_task_to_top, get_task_run_link, get_unscored_tasks, find_best_agent, get_recurring_tasks, create_recurring_task, update_recurring_task, delete_recurring_task, get_document, update_document, get_emails, get_tweets, query_reports, get_links, update_link, pause_ads, report_platform_bug, suggest_feature

**6 capabilities/introspection tools:** list_available_modules, get_module_capabilities, list_mcp_servers, list_available_agents, get_agent_capabilities, find_agent_for_task

**2 memory tools:** search_memory, read_memory

**6 Brave search tools:** brave_web_search, brave_local_search, brave_video_search, brave_image_search, brave_news_search, brave_summarizer

**CEO uses `mcp__chat__*`, `mcp__memory__*`, `mcp__capabilities__*`, `mcp__brave_search__*` namespace — distinct from worker-style mounted MCPs.**

**CEO credit-scoping guardrail behavior:**
- Estimates credit cost BEFORE creating tasks
- Pushes back if founder lacks credits
- Offers alternatives: pick highest-value slice, buy more credits, use referral credits
- Optimizes decomposition for "1 credit = 1 founder-visible outcome" (not implementation substeps)
- Avoids creating oversized tasks when founder lacks credits for likely decomposition
- No backend validator to reject oversized work — relies on CEO/chat scoping quality

**Prompt template variables:** `{{company_name}}`, `{{current_date}}`, `{{cycles_completed}}`, `{{company_slug}}`

**Baljia improvement:** Least-privilege CEO — consumes governed answers from hidden policy services, not raw system access. Remove raw introspection, raw execution logs, raw memory reads. Add safe abstractions instead.

## 2.4 Per-Agent Details

### Engineering (Agent #30)
- Mounts: `polsia_infra`, `stripe`, `tasks`, `reports`, `polsia_support`, `memory`, `skills`
- Practical callable tools: `polsia_infra` (create_instance, push_to_remote, push_to_prod, get_status, get_logs, get_preview, query_db, list_instances, delete_instance), `tasks` (8), `reports` (3), `polsia_support` (2)
- `memory` is injected at startup, not a callable tool; `skills` are filesystem playbooks; `stripe` is a credential/config flag
- Works from pre-cloned repo with relative paths; must push after every file change (timeout loses unpushed work)
- Reads skill files from `.claude/skills/` before implementing
- `delete_instance` is dangerous — should be approval-gated
- Default stack: `express-postgres`; default UI: Tailwind + shadcn/ui
- Builds: landing pages, dashboards, admin panels, auth, Stripe payments, APIs, integrations, webhooks, cron, DB schemas, SEO fixes
- Does NOT do: automated testing, load testing, browser QA, code review, web search, browser automation
- "Completed" means "code deployed without server-side failure" NOT "all UX paths verified"
- **Integration model:** Platform-provided integrations (GitHub, Render, Stripe, Meta Ads, Twitter, Hunter.io, Postmark, Browserbase, R2, company email) available out of box. Founder-provided custom integrations (OpenAI, HubSpot, Calendly, Slack, Zapier, etc.) require founder API key; Engineering wires them in.

### Browser (Agent #42)
- Mounts: `browserbase`, `browser_auth`, `company_email`, `tasks`, `reports`, `polsia_support`, `memory`, `skills`
- Browserbase (9): session_create, navigate, screenshot, click, fill, extract, get_page_content, evaluate, session_close
- Browser Auth (11): get_site_tier, get_company_email, generate_password, get/save_site_credentials, check_verification_inbox, verify_credentials, list_stored_credentials, get_or_create/list/delete_browser_context
- **Site tier system** (enforced via `get_site_tier` before actions):
  - Tier 1 (browse-only): Twitter/X, Instagram, LinkedIn, TikTok, Reddit, Product Hunt, Indie Hackers
  - Tier 1.5 (conditional login): Hacker News, Medium, Dev.to, Gumroad, Etsy, Craigslist
  - Tier 2 (broader): Hashnode, Substack, BetaList, Lobsters
  - Tier 3 (standard): everything else
- Credentials: company-scoped → per-site → with reusable persistent browser contexts
- One task = one session, max ~4 hours
- No reliable 2FA, no desktop apps, no PDF/local-file workflows, no broad multi-tab research
- Key tools: `extract`, `evaluate`, `get_or_create_browser_context`, `save_site_credentials`
- Architecture closest to its job — main weakness is speed and web friction, not blindness

### Research (Agent #29)
- NO live web access — works from model knowledge, internal context, prior material
- Can manage tasks, write reports, use internal context and existing reports
- **Weakest agent** — competitive teardowns are repackaged onboarding research, not fresh web investigation
- **Baljia improvement:** Read-only public web via Tavily; require citations or explicit "insufficient evidence"

### Data (Agent #33)
- Same infra tools as Engineering but analytics-focused; max turns 200
- Expected to: run SQL against company Postgres, inspect schemas, analyze user behavior, collect metrics, check logs, create reports with methodology, confidence levels, actionable recommendations
- Should distinguish correlation from causation; note data limitations explicitly

### Support (Agent #32)
- Email-first operational worker with escalation responsibility
- Owned company: technical → create Engineering task; billing/security → message owner; angry user → message owner
- Not-owned/polsia_fund company: acts more autonomously on billing/refund decisions
- Plain-text emails only, match incoming message length, make judgment calls independently when no owner present
- `gmail` mounted in config but inactive until OAuth connected; default is platform-managed company inbox only
- **Risk:** Can be assigned decision authority (refunds, security) exceeding its visible context/tooling (no Stripe tools, no customer history, no search)
- **Email policy:** Replies to known threads less restricted than cold outbound; transactional replies carry `transactional=true` distinction

### Twitter
- Tools: `post_tweet`, `get_twitter_account` (or `get_account`), plus `documents` (3), `tasks` (8), `reports` (3)
- ~1 tweet/day from shared @polsia account (platform-level limit, not credit rule); higher volume requires founder-owned connected Twitter/X account via OAuth
- No native search or trend awareness in execution path
- Reads brand voice and product docs before composing
- **Voice rules (observed):** Dark-humor/witty/bitter style; avoid upbeat/cheerful language; avoid emojis; avoid hashtags; avoid filler like "excited" or "thrilled"; include website link; launch tweets reference `polsia.com/{slug}`
- **Baljia improvement:** Add trend context, analytics, engagement loop, dedupe against recent tweets

### Meta Ads
- 12 tools: create_campaign, create_adset, create_ad, upload_ad_video, create_video_creative, activate_campaign, save_ad, update_ad_metrics, add_captions, get_ad_account, list_campaigns, get_campaign_insights
- Uses Sora 2-generated ad videos (15-30 seconds final format); selfie-style person, no subtitles in raw video, no transitions, no background music
- Facebook + Instagram placements via shared platform Meta ad account
- Billed separately from task credits: min ~$10/day budget, 20% platform fee (e.g., $10/day = $8 Meta + $2 platform)
- $10/day tests ~2-3 ad variations with different creative angles
- Has explicit recovery/moderation logic (other agents often don't)
- maxTurns: 100 (lower than others)
- **Optimization thresholds:** Healthy: CTR > 1%, CPC < $1. Mediocre: CTR 0.5-1%, CPC $1-$2. Underperforming: CTR < 0.5% or CPC > $2 after multiple days.
- **Moderation rule:** If concept blocked, generate new angle — do not retry same concept
- **Continuous rotation:** Start with small variation set → spend distributes toward winners → pause wasteful ads → generate fresh replacements with different hooks
- Dashboard entry point: `Run Ads` action
- **Baljia improvement:** Clearer watch/kill rules, separate video generation from ad packaging, support customer-owned ad accounts

### Cold Outreach (Agent #54)
- No `browserbase` mounted — Browser does lead sourcing; Research can support qualification
- Callable tools: company_email (5: get_inbox, send_company_email, get_email_thread, add_contact, get_contacts), hunter_io (2: find_email, verify_email), documents (3), tasks (8), reports (3), polsia_support (2) — 23 total, 7 outreach-specific
- Lead state machine: pending → contacted → replied → responded → meeting → dead
- Prompt references `add_lead`/`get_leads`/`update_lead` — these are **STALE**, real tools are `add_contact`/`get_contacts`
- ~2 outbound cold emails/day from company inbox; Gmail connection needed for higher volume
- Plain-text founder-style emails, 50-125 words; follow up after ~5+ days
- Check inbound replies first; if pipeline empty, research new leads; verify every email before sending
- **Baljia improvements:** Research before email; skip prospects without personalization hook; separate lead DB from plain contact storage; keep outbound limits and reputation safety explicit

---

# DOMAIN 3: MCP & TOOL ARCHITECTURE

## 3.1 Registry Overview
- 22 registered MCP servers, 106 named tools
- 21 available; 1 unavailable (`github_publish` — requires user OAuth)

## 3.2 MCP Server Inventory

### Platform Infrastructure (5 servers, 41 tools)
| Server | Count | Named Tools |
|--------|-------|-------------|
| `polsia_infra` | 9 | create_instance, push_to_remote, push_to_prod, get_status, get_logs, get_preview, query_db, list_instances, delete_instance |
| `github` | 7 | read_file, write_file, create_branch, create_commit, create_pr, search_code, list_files |
| `render` | 5 | list_services, get_service, deploy_service, get_metrics, list_databases |
| `browserbase` | 9 | session_create, navigate, screenshot, click, fill, extract, get_page_content, evaluate, session_close |
| `browser_auth` | 11 | get_site_tier, get_company_email, generate_password, get_site_credentials, save_site_credentials, check_verification_inbox, verify_credentials, list_stored_credentials, get_or_create_browser_context, list_browser_contexts, delete_browser_context |

### Business Tools (5 servers, 22 tools)
| Server | Count | Named Tools |
|--------|-------|-------------|
| `meta_ads` | 12 | create_campaign, create_adset, create_ad, upload_ad_video, create_video_creative, activate_campaign, save_ad, update_ad_metrics, add_captions, get_ad_account, list_campaigns, get_campaign_insights |
| `twitter` | 2 | post_tweet, get_twitter_account |
| `hunter_io` | 2 | find_email, verify_email |
| `postmark` | 1 | send_email |
| `company_email` | 5 | get_inbox, send_company_email, get_email_thread, add_contact, get_contacts |

### Internal Platform Services (11 servers, 42 tools)
| Server | Count | Named Tools |
|--------|-------|-------------|
| `tasks` | 8 | create_task_proposal, get_available_tasks, approve_task, reject_task, start_task, complete_task, block_task, fail_task |
| `reports` | 3 | create_report, query_reports, get_reports_by_date |
| `documents` | 3 | get_company_documents, get_company_document, update_company_document |
| `dashboard` | 2 | add_link, get_dashboard |
| `capabilities` | 6 | list_available_modules, get_module_capabilities, list_mcp_servers, list_available_agents, get_agent_capabilities, find_agent_for_task |
| `agent_factory` | 5 | list_mcp_tools, get_mcp_tool_details, create_agent, list_created_agents, get_agent_template |
| `cycle_planning` | 4 | get_cycle_context, create_cycle_plan, update_cycle_plan, submit_review |
| `scripts` | 3 | list_scripts, run_script, get_script_output |
| `learnings` | 5 | create_learning, query_learnings, search_learnings, get_recent_learnings, get_learnings_by_tags |
| `polsia_support` | 2 | report_bug, suggest_feature (write-only — no get_ticket_status) |
| `send_reply` | 1 | send_reply (platform-side async founder-message delivery for onboarding/cycle/notification use) |

### Conditional (1 server)
- `github_publish` — requires user OAuth, unavailable by default

## 3.3 Phantom Mounts (NOT real MCP servers)
- `memory` — platform-side runtime context injection for workers; CEO/chat gets `search_memory`/`read_memory`
- `skills` — filesystem/injected playbooks; `create_skill()`/`update_skill()` in prompts are hidden file-writing primitives
- `stripe` — infrastructure credential/config flag, not a tool surface
- `gmail` — dormant OAuth placeholder, no tools until user connects

**Critical rule:** Configured mount ≠ callable runtime tool. Runtime-visible surfaces are authoritative.

## 3.4 Hidden Platform Consumers
`cycle_planning`, `agent_factory`, `scripts`, `send_reply`, `dashboard` don't mount on visible workers. Consumers: CEO/chat, onboarding pipeline (Sapiom), recurring-cycle orchestration, internal platform services.

---

# DOMAIN 4: MEMORY & CONTEXT SYSTEM

## 4.1 Three Memory Layers

| Layer | Name | Capacity | Purpose | Typical State |
|-------|------|----------|---------|---------------|
| 1 | Domain Knowledge | 15,000 tokens | Company-specific technical/business knowledge | Often empty |
| 2 | User & Company Preferences | 3,000 tokens | Conversation-carried context, mission, preferences | ~1,490 tokens used |
| 3 | Cross-Company Patterns | 15,000 tokens | Shared learnings across companies | Empty (not active) |

**Access model:**
- CEO/Chat: direct read/write to all 3 layers
- 8 Workers: NO direct memory tools — receive injected context at startup only
- Layer 2 autosaves every 20 messages (counter-based, not event-driven)
- No vector search or semantic RAG — flat text + keyword search
- Workers get a "memory packet" not a "searchable library"
- Mid-run discoveries NOT cleanly persisted back
- Prior reports and related_task_ids are retrievable but NOT enforced as part of startup

**Worker startup injection (confirmed thin):** system prompt, tool list, task object, basic template vars. Broad document context, proactive OAuth state, rich memory — NOT reliably injected. CEO/chat sometimes tells founders agents "know" company docs — this is product simplification, not architecture truth.

**Baljia improvements:** Searchable/writable memory as real tools during execution; enforce prior-report reading; unify memory, learnings, and reports under one retrieval surface; track agent-task outcomes for routing quality improvement

## 4.2 Learnings System (Separate from 3 Layers)
- 5 tools: create_learning, query_learnings, search_learnings, get_recent_learnings, get_learnings_by_tags
- Not universally mounted across agents
- More active tool surface than the 3 memory layers

## 4.3 Document System

### 5 Core Documents (Fixed Knowledge Base)
1. `mission` — populated at signup
2. `product_overview` — empty at signup
3. `tech_notes` — empty at signup
4. `brand_voice` — empty at signup
5. `user_research` — empty at signup

**Note:** `user_context` appears in some prompts — may be alias for `user_research` or separate hidden surface (open question). Also: `vision_md` referenced in some contexts.

### Open-ended task outputs
Market Research Report, strategy reports, analytics reports, execution deliverables — these live in the Documents section alongside core docs (blended view).

**Critical problem: Null-document cascade:**
- Mission is the only rich document; others return nothing
- Agents fall back to mission/memory/generic priors
- Outputs converge toward same mission rhetoric
- Documents don't auto-update as work proceeds → document rot
- `product_overview` especially damaging when empty — agents lose shared source of truth
- Customer intelligence stays trapped in chat instead of being promoted to `user_research`

**CEO/chat can draft documents in free planning:** brand_voice (tone, language style, personality, target audience, words to use/avoid) and product_overview (what company is, who it serves, service tiers, workflow, planned surfaces)

**Baljia locked choice:** Core documents update via user-reviewed suggestions only — no silent auto-update. After meaningful task outputs, suggest update for founder to accept/edit/skip.

## 4.4 Skills System

**6 known Engineering skill files:**
1. `frontend-design` (Anthropic-derived, partially aligned — encourages novelty, poor fit for autonomous execution)
2. `stripe-payments` (Stripe-derived, poor fit — conflicts with platform payment model)
3. `neon-postgres` (Neon-derived, poor fit — assumes richer environment than agent has)
4. `agent-sdk` (custom, unknown fit)
5. `r2-proxy` (custom, unknown fit)
6. `email-proxy` (custom, unknown fit)

**Implementation truth:** Skills are file-backed playbooks in hidden execution workspace, NOT in founder-visible repo. Mixed-provenance: copied from external vendors without full reauthoring for autonomous execution.

---

# DOMAIN 5: TASK MANAGEMENT & EXECUTION

## 5.1 Task Lifecycle

States: `created` → `todo` → `in_progress` → `completed` / `failed` / `rejected` / `blocked`

**Baljia improvement — richer completion states:** `completed_verified`, `completed_unverified`, `failed`, `blocked`, `partial`

## 5.2 Task Fields (Observed)

title, description, tag, task_type, status, priority, complexity (1-10 planning metadata), estimated_hours, related_task_ids, queue_order (mutable position), source, suggestion_reasoning, executability_type (`can_run_now` | `needs_new_connection` | `manual_task`), assigned_to_agent_id (can be null — lazy assignment), run_link (magic-auth URL), markdown_link

**Task IDs:** Platform-wide global namespace; founder-visible queue is company-local.

**executability_type:** Pre-run feasibility flag. `needs_new_connection` blocks execution until founder completes OAuth. Mostly a CEO/chat classification hint — weaker enforcement downstream.

**Complexity:** 1=trivial, 5=moderate, 10=very complex. Does NOT directly change credit cost, agent selection, tools, or runtime cap. Planning metadata only — used by CEO/chat for decomposition decisions.

**Decomposition rules:** Split by deliverable boundaries (landing page / auth / dashboard / payments), NOT implementation fragments (DB setup / API only / UI only). CEO optimizes for "1 credit = 1 founder-visible outcome."

## 5.3 Routing

**Two parallel systems (can disagree):**
- `find_best_agent(query)` — returns recommended agent, confidence, similar task counts, avg scores, success rates, common outcomes, warnings
- `find_agent_for_task(task_tag)` — capability/rules-based

**Known weakness:** Historical router is volume-biased — Engineering accumulates recommendation gravity even with worse scores.

## 5.4 Execution Boundaries

- 1 task = 1 credit (deducted at `start_task` / `todo → in_progress`)
- Max ~4 hours per task; maxTurns: 200 for most, 100 for Meta Ads
- Sequential execution per company (no parallel in observed model)
- Failed tasks consume credit — no auto-refund, no auto-retry
- Manual follow-up via new task (CEO creates, links via `related_task_ids`)
- **Daily throughput:** ~6 credits/day strict max (all tasks use full 4hr cap); ~8-12 credits/day practical. 100 credits ≈ 10-14 days heavy execution. Credits buy volume, NOT concurrency.

## 5.5 Execution Log Surface

Founder-facing execution logs should show: step-by-step activity, files created/edited, commands executed, errors, deploy outcome, reasoning narrative. NOT a raw Git diff or code review. Exact schema/fidelity unverified from chat layer. **Baljia locked choice:** Execution log transparency is first-class.

## 5.6 Free vs Paid Boundary

**Free (no credits):** Chatting with CEO, planning/strategy, task scoping, document editing via chat, task creation/editing/reordering/approving, report/log viewing, queue management

**Credit-consuming:** Agent execution work, recurring task runs

**Not credit-consuming:** Hosting (tied to subscription), Meta Ads (separate billing lane)

---

# DOMAIN 6: NIGHT SHIFTS & RECURRING WORK

## 6.1 Night Shift Architecture

**Not an agent — a scheduled platform process:**
- `cycle_planning` MCP (4 tools) + scheduler logic
- Platform-side orchestrator calls `cycle_planning`
- Workers execute resulting concrete work
- Between cycles: batch-oriented, NOT event-driven
- Autopilot likely respects queue order as primary selector; `move_task_to_top()` is the real priority control

**Cycle sequence:**
1. Scheduler triggers
2. Hidden planner evaluates company state + trust context
3. Planner creates/selects/reprioritizes best admissible task
4. Task routed to appropriate worker
5. Worker executes
6. Verification runs
7. CEO produces founder-facing daily summary (what shipped | in progress | queued | tomorrow's focus)

**Consumption:** 30 night shifts/month on $49 plan, **3 during trial**

**Night shift planning separates from CEO/chat:** Planner agent/process creates autonomous tasks from shared context; CEO/chat is the live conversational facade.

**Night shift has 3 layers:** planning (inspect state, create tasks), execution (run admissible work), summary (founder-facing overnight update)

## 6.2 Recurring Tasks

- Fields: title, description, tag, priority, cadence (daily/weekly/biweekly/monthly), monthly_credits_estimate
- Static templates — no visible flag for injecting fresh context per run
- Consume 1 credit per run (same as manual tasks)
- Easy to accidentally consume budget: daily analytics = ~30 credits/month, weekday social = ~22 credits/month

## 6.3 Baljia Improvements

**Stage-dependent night-shift objectives:**
- Early → "what is obviously missing?"
- Validation → "what blocks activation?"
- Monetization → "what blocks conversion?"
- Retention → "what is underused or churn-inducing?"
- Scale → "what channel is underperforming?"
- Compounding → "what can be automated or defended?"

**Trust-recovery priority order:**
1. Broken promised work
2. Trust-damaging credit/delivery issues
3. Easy same-scope repair (uses protected remediation capacity, not fresh manual credits)
4. Regression prevention
5. Normal roadmap progression

**Autonomous policy:** Planning can continue without credits. Execution requires admissibility + credits. Auto-create: obvious improvements, same-scope repairs, SEO/analytics follow-ons, recurring ops. Must wait for founder: major direction pivots, new monetization, real-money spend, destructive changes, ambiguous solution choices.

---

# DOMAIN 7: MONETIZATION & BILLING

## 7.1 Pricing Structure

| Item | Price |
|------|-------|
| Base plan | $49/month (1 company, 30 night shifts, 5 credits/month + 10 first month) |
| Keep-live plan | $19/month (no night shifts, ~5 credits) |
| Extra companies | +$49/month each |
| Credit packs | 15/$19, 25/$29, 50/$49, 100/$99, 200/$199, 500/$499, 1000/$999 |
| AI runtime credits | $5/month (separate from task credits; BYOK option available) |
| Meta Ads | $10-$1000/day, 20% platform fee, separate billing lane |

## 7.2 Four Separate Billing Lanes

1. **Platform subscription** — hosting, control plane, base support
2. **Task credits** — 1 task = 1 credit; charge at start_task; failed tasks consume credit
3. **Ad spend** — completely separate from credits; daily budget + 20% platform fee
4. **Company runtime AI/search budget** — founder's app consuming AI resources; BYOK option

**Credits don't roll over. No multi-tier feature gating — sells execution volume.**

**At 0 credits with active subscription:** Uptime and planning survive, execution pauses. Hosting stays up. Dashboard, docs, reports, CEO/chat remain accessible. Meta Ads continues (separate lane).

## 7.3 Payments Architecture

**Platform-owned payment flow (default):**
- Polsia's Stripe processes customer charges (merchant of record)
- 20% platform fee on customer payments (e.g., $100 → $80 to company balance, $20 retained)
- Earnings → internal balance → founder withdrawal via Settings
- Withdrawal: view gross revenue, platform fee, available balance → enter PayPal/bank → ~48 hours
- Stripe stores saved payment-method identifiers (not full card numbers)
- Stripe Connect-style rails for withdrawals (KYC, hold periods, payout minimums)

## 7.4 Credit Bands (Observed Examples)

- 1 credit: bug fixes, small UI, copy, simple research, small page/form, browser task, SEO tweak, one outreach batch, tweet, support email
- 2-3 credits: moderate feature, redesign, auth, one integration, deeper analysis
- 4-6 credits: client portal, payment flow, multi-step onboarding, full CRUD, email sequences
- 8-15+ credits: full MVP app, admin+client app, complex multi-API, full rebrand

CEO presents larger builds as phased credit playbooks, not single tasks.

---

# DOMAIN 8: INFRASTRUCTURE & PROVISIONING

## 8.1 Core Stack

| Component | Provider |
|-----------|----------|
| Backend | Node.js / Express |
| Frontend | React / Vite |
| Database | Postgres (Neon) |
| Hosting | Render |
| Storage | Cloudflare R2 |
| Email (transactional) | Postmark |
| Browser automation | Browserbase |
| Ads creative | Sora 2 (video generation) |
| Code hosting | GitHub (platform-owned) |
| AI execution | Anthropic, OpenAI, Google |
| Email verification | Hunter.io |
| Payments | Stripe |
| Queue/operational state | Redis |

**Shared across tenants:** Twitter posting, Meta ad account, Browserbase, Hunter.io, Postmark, LLM keys

## 8.2 Tenant Provisioning

Per-company: slug, company record, subdomain (`{slug}.baljia.app` via wildcard DNS), email (`{slug}@baljia.app`), GitHub repo (platform org), Render deployment, Postgres database, dashboard shell

**URL model:** Company page: `polsia.com/{slug}` | Landing: `{slug}.polsia.app` | App runtime: may use `{slug}-{suffix}.polsia.app`

**Custom domains:** Founder-managed DNS cutover to Render-hosted app; subdomain safest for existing sites. Not platform-managed. **Baljia locked choice:** Single-domain sufficient; v1 uses platform subdomains.

**Post-onboarding pivots:** Easy content/doc repositioning; harder infra/identity renaming.

## 8.3 Company Lifecycle States

`trial_active` → `trial_expired` → `full_active` / `keep_live_active` → `suspended_billing` → `archived` → `deleted`

**Three separate dimensions:** task execution state, subscription/billing state, hosting/public-site state

**Control plane vs runtime plane:** Platform outage doesn't kill already-deployed customer apps. Control plane = task execution, planning, reporting; runtime plane = deployed apps on Render/Postgres/R2.

## 8.4 Company Email Architecture

Alias registry per company, inbound routing, outbound sending, bounce handling, spam rejection, SPF/DKIM/DMARC, rate limits, reputation controls, optional custom-domain upgrade later.

## 8.5 Operational Limits

- ~2 cold emails/day from default inbox; ~1 tweet/day from shared account
- No native mobile apps; no Instagram/LinkedIn posting
- No work on existing external repos (standard model)
- No reliable CAPTCHA/2FA automation
- No desktop app control; no heavy WebSocket/WebRTC
- Practical scope: bounded web-app MVP complexity; weak for arbitrary system complexity
- Polsia steers mobile requests toward PWA; oversized requests toward decomposition

---

# DOMAIN 9: SYSTEM TOPOLOGY

## 9.1 Four-Layer Operational Model

| Layer | Responsibility | Visibility |
|-------|---------------|------------|
| 1. Agents | 8 execution workers + CEO/chat | Founder sees via results |
| 2. Orchestration | Task queue, assignment, state transitions, execution gating, maxTurns, watchdog | Partially visible |
| 3. Platform Services | Billing, subscription, memory sync, OAuth, MCP registry, provisioning | Invisible |
| 4. Platform Team | Humans receiving bug/feature reports, shipping changes | Invisible |

## 9.2 Platform Ops Layer (Hidden)

Internal processes: platform_support_triage, bug_reproducer, prompt_policy_improver, routing_orchestration_analyst, billing_credit_auditor, infra_watchdog

Failure management: failure_fingerprinter, known_issue_registry, regression_guard

**Baljia improvement — Closed-Loop Failure Learning (6-step):** failure capture → fingerprinting/clustering → issue registry → fix routing → regression monitoring → runtime feedback to CEO/routing/prompts

## 9.3 Watchdog System

Reports elapsed time since last progress + currently active tool. Time/progress monitor for stuck-run detection. Sits beside `maxTurns`. Post-detection action (kill/restart/alert/refund) is opaque.

---

# DOMAIN 10: PUBLIC PROOF & LIVE WALL

## 10.1 Live Page Layout (`/live`)

**Three-column real-time operations wall:**
- **Left**: Mascot/status card, text/log card, Business analytics (Annual Run Rate, Active Companies, Messages, Tasks, Emails), growth graph
- **Center**: Tasks (live cards with orange borders, agent pills, running timers), Companies (rolling feed), Documents (rolling feed)
- **Right**: Twitter, Email (masked addresses), Ads (spend + creative table), Live Chat with lead capture CTA

**Live behavior:** Real event-driven, not fake animation. Task cards show `Running for 0m 38s`. Fresh events highlight/glow. Metrics animate deltas. Rolling lists keep latest slice only. 24-hour aggregate counts.

**Lead capture:** "Ask Polsia Anything" → modal with name/email → "Start chatting"

**Public visibility default:** Enabled by default, can be disabled in account settings. **Baljia locked choice:** Configuration-driven exposure.

## 10.2 Baljia Status System (Mascot: Baljia Angel)

**State-driven, not decorative. States:** listening, planning, running, investigating, blocked, resolved, growth_mode

Driven by real platform events from same event system as live dashboard.

**Visual rules:** Same base mark, subtle changes (eyes, mouth, glow, particles). Warm, wise, dependable — NOT childish or chaotic. Image=emotion; text=meaning; separate layers. Same canvas geometry across all states.

**Size tokens:** Chat: 40px | Header: 48px | Dashboard: 112px | Live wall: 152px | Hero: 220px

---

# DOMAIN 11: KNOWN CONTRADICTIONS & AMBIGUITIES

## 11.1 Architecture Contradictions

| Contradiction | Detail | Baljia Action |
|---------------|--------|---------------|
| Search split | CEO has Brave Search; workers don't | Give Research read-only web via Tavily |
| Memory split | 3 layers + learnings, no unified retrieval | Unified searchable memory for workers |
| GitHub ownership | Platform vs user OAuth — two modes, user mode underused | Keep platform-owned default, clean upgrade |
| Research value | Sold as capability but agent has no web | Fix with Tavily |
| Runtime mount ≠ config | memory, skills, stripe, gmail in config but not callable | Only expose what's callable |
| Prompt ≠ tools | Cold Outreach references non-existent lead tools; Research claims web | Reconcile prompts to actual tools |
| Growth/Content agents | Routing categories but no dedicated agents | Clear routing to existing agents; future optional dedicated agents |
| Stale prompt summaries | Meta Ads says "4 tools" when 12+ exist | Auto-generate tool summaries from registry |
| Inconsistent safety | Some agents have confidentiality rules, external-facing ones don't | Uniform safety policy |
| Capability validation | Agents report "full capability" even when blind | True readiness check before launch |
| Document access asymmetry | Only Twitter/Cold Outreach have `documents` MCP; Engineering/Browser/Data/Research don't | Broader document access or compiled injection |
| Worker lifecycle overhead | 4 wasted API calls + fixed token cost per task | Move lifecycle into platform |

## 11.2 Open Questions

- Exact billing trigger (likely `start_task` but not 100% confirmed)
- Whether blocked-before-start tasks consume credit
- Whether welcome/monthly credits have different expiry; consumption order when multiple pools exist
- Exact watchdog post-detection action
- Cold Outreach batching: one-credit multi-day send vs decomposed
- Whether inbox/email handling does useful work at 0 credits
- Exact hidden enrichment search stack and geo-signal weighting
- Exact autopilot selection rule (queue order vs priority vs hidden filters)
- `user_context` vs `user_research` document naming — same or different?
- Trial credit budget: 10 or 15? (source gives both framings)

---

# DOMAIN 12: BALJIA REBUILD IMPROVEMENTS

## 12.1 Architecture Improvements (Over Polsia)

| Area | Polsia Reality | Baljia Improvement |
|------|---------------|-------------------|
| Research | No web access | Read-only web via Tavily; require citations |
| Memory | Thin injection, no mid-run persistence | Searchable/writable memory; unified retrieval surface |
| Documents | Static snapshots, null cascade | Suggest updates for founder review after task outputs |
| Loop detection | maxTurns blunt kill | Repeated-tool-call detection, compute circuit breakers |
| Verification | "Completed" = deployed | Tiered verification (none/deterministic/browser-flow/quality-review/hybrid) |
| Task sizing | CEO intuition only | Backend governance validator with hard split rules |
| Skills | Mixed-provenance, conflicts | Platform-native skills for autonomous execution |
| Credit transparency | Flat number | Founder-visible ledger with quote, charge, mode, failure class |
| Engineering modes | One-size-fits-all | Three modes: deterministic, template+params, full agent |
| Night shifts | Generic planner | Stage-aware + trust-recovery + archetype playbooks |
| Starter tasks | Rigid 3-task formula | Per-journey templates, dependency-chained, quick-win first |
| CEO surface | ~44 tools, raw access | Least-privilege with hidden policy engine |
| Suspension | "Suspended by owner" | Honest messaging + clear recovery options |
| Self-improvement | Weak plumbing | 6-step closed-loop failure learning |
| Concurrency | Single-threaded | Default serial, elastic burst when safe |
| Worker lifecycle | 4 wasted API calls per task | Platform manages lifecycle, agent only does domain work |
| Coordination | Queue-only, batch between cycles | Event-driven triggers for inbox/deploy/ad-performance/milestones |
| Multi-tenancy | Shared accounts | Customer-owned GitHub/ad accounts/domains, private-by-default |
| Signup signals | Underused | IP/locale/timezone/device/referral source → personalized onboarding |
| Agent provisioning | Static 8-agent fleet | Dynamic narrow per-task agents (future) |

## 12.2 Locked Build Decisions

1. Onboarding research depth = `balanced` (configurable per journey)
2. Mission generator = `approximate parity` (not exact template copy)
3. Different starter-task templates per journey
4. Core documents update via user-reviewed suggestions only (no silent auto-update)
5. Public-surface visibility = configuration-driven
6. Single-domain deployment sufficient
7. Research = read-only web via Tavily; Browser = interactive web
8. Free planning, paid execution (credits consumed at worker start only)
9. OAuth connections unlock with execution (not pre-trial)
10. Execution log transparency = first-class
11. Data-driven product improvement = explicit, policy-backed, bounded

## 12.3 Three-Layer Architecture Split

| Layer | Purpose | Execution Style |
|-------|---------|----------------|
| **Product** | CEO, Engineering, Browser, Data, Research | Hybrid — agentic where needed |
| **Growth** | Twitter, Meta Ads, Cold Outreach, SEO/content | Graph/workflow-first |
| **Platform** | Governance, verification, scheduler, remediation, memory, refund, tool registry, agent factory | Deterministic control plane |

## 12.4 Task Governance System

**Inputs:** founder request, proposed task, estimated deliverables, dependencies, novelty, integrations, company state, queue state, credits, verification type, regression risk

**Outputs:** approved/split/blocked/refused, execution mode, estimated credits, verification level, refund classification

**Hard split rules:** Force decomposition when: multiple features bundled, mixed work types, multiple deliverables, excessive verification burden, setup+execution should separate

## 12.5 Concurrency Policy

- Default: 1 active execution slot per company
- Burst: 2-3 concurrent when sufficient credits + no dependency conflicts + spare capacity
- Never parallelize: dependent tasks, same-codebase writes, auth/schema/infra changes
- Safe to parallelize: product engineering + separate research, disjoint scope tasks

## 12.6 Future Optional Agents

**Growth Agent:** growth strategy, channel prioritization, ICP refinement, campaign planning, task delegation to existing specialists. Does NOT replace Cold Outreach/Twitter/Meta Ads/Browser.

**Content Agent:** long-form content, SEO pages, blog posts, newsletters, landing copy refinement. Does NOT replace Twitter/Browser/Research.

---

# DOMAIN 13: DATA OBJECTS & ENTITIES

## 13.1 Core Entities

| Entity | Key Fields |
|--------|------------|
| Company | slug, name, one_liner, original_idea, claim_status, lifecycle, onboarding_status, plan_tier, execution/billing/hosting states, subdomain, email_identity, github_repo, render_service_id, timezone |
| Task | id, title, description, tag, task_type, status, priority, complexity, estimated_hours, queue_order, source, suggestion_reasoning, executability_type, assigned_to_agent_id, related_task_ids, run_link, markdown_link, execution_mode, verification_level, failure_class, max_turns, turn_count |
| Report | task-linked, typed (execution_report, market_research, analytics, strategy), including structured onboarding_research |
| Document | type (5 core + custom), source, version, is_empty flag |
| Learning | tagged task-level insight, category, confidence |
| Recurring Task | cadence, monthly_credits_estimate, template fields |
| Email Thread | direction, threading, contacts |
| Browser Credential | company→site scoped, persistent browser contexts |
| Ad Campaign | budget, creative, campaign/adset/ad state, CTR/CPC metrics |
| Contact/Lead | prospect pipeline, lead_status, email_verified |

## 13.2 Data Retention (Policy-Declared)

- Account deletion: soft-delete up to 30 days
- Ad metrics: account life + 12 months
- AI-generated content: until deletion/termination + soft-delete
- Infrastructure credentials: deleted immediately on resource teardown (AES-256-GCM encrypted)
- Browser screenshots/extracted data: session + up to 30 days in logs
- De-identified/aggregated: may be retained longer

---

# BUILD ORDER

**Phase 0: Foundation (Weeks 1-3)**
- Postgres schema (all tables), Event bus (Redis Pub/Sub)
- User auth (magic link + Google OAuth)
- Company CRUD + slug generation + provisioning
- Dashboard shell (React) + mobile layout
- Chat gateway (WebSocket + CEO prompt)

**Phase 1: Core Execution (Weeks 4-7)**
- Task management (full lifecycle + queue + task board UI)
- Credit/billing system (Stripe integration + ledger)
- Governance engine (sizing + mode selection + split enforcement)
- Worker launcher + agent factory + prompt assembly
- Engineering agent (with infra equivalent)
- Watchdog monitor

**Phase 2: Agent Fleet (Weeks 8-11)**
- Browser agent (Browserbase + browser_auth)
- Research agent (with Tavily)
- Data agent, Support agent + company email
- Verification service (5 levels)

**Phase 3: Growth (Weeks 12-15)**
- Twitter agent, Meta Ads agent (Sora), Cold Outreach agent (Hunter.io)
- Night shift system (planner + scheduler + stage classification)
- Recurring tasks

**Phase 4: Public Proof (Weeks 16-18)**
- Live operations wall (/live), public company pages
- Real-time event projection, Baljia mascot state system

**Phase 5: Platform Maturity (Weeks 19+)**
- Closed-loop failure learning system
- Remediation/trust-recovery loop
- Memory improvement loop + unified retrieval
- Platform ops monitoring
- Portfolio view, referral system, FAQ KB

---

*v2 — All 70 audit findings applied. 24 errors fixed, 34 omissions added, 9 stale items corrected, 3 consistency issues resolved.*
