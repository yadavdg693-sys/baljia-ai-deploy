# Onboarding — Research & Content Creation Reference

> **Purpose.** This is the source of truth for *how* the Research and Content Creation phases of onboarding work. It maps Polsia's observable behavior (which we're matching) to our current code, marks the gaps, and defines the per-journey divergence we need.
>
> Reference exists because these two phases are the most important — research is what makes the company *credible*, content is what makes it *real*.

---

## Table of Contents

1. [Where these phases sit](#where-these-phases-sit)
2. [Research Phase](#research-phase)
3. [Content Creation Phase](#content-creation-phase)
4. [Cross-cutting concerns](#cross-cutting-concerns-activity-mood-watchdog)
5. [Polsia-to-Baljia mapping cheat sheet](#polsia-to-baljia-mapping)

---

## Where these phases sit

The onboarding pipeline runs in **fire-and-forget** mode after a founder signs up. The full ordering is:

```
heartbeat
  → enrich_founder           ┐
  → enrich_business          │
  → persist_context          │  RESEARCH PHASE
  → extract_founder_angle    │
  → select_strategy          │
  → classify_archetype       │
  → name_company             ┘
  → provision_infrastructure
  → send_startup_email       ┐
  → generate_market_research │
  → save_mission             │  CONTENT CREATION PHASE
  → generate_roadmap         │
  → derive_active_milestone  │
  → create_starter_tasks     │
  → generate_landing_page    │
  → post_launch_tweet        │
  → generate_ceo_summary     ┘
  → send_completion_email
  → flush_diagnostics
  → celebrate
```

Source: `src/lib/services/onboarding.service.ts:147-172`

---

## Research Phase

### What it does (plain terms)

Before we can build anything *for* the founder, we need to understand:
1. **Who they are** — name, location, public footprint (LinkedIn, Twitter)
2. **What their advantage is** — what domain do they credibly sit in?
3. **What market they're entering** — competitors, pricing, gaps
4. **What to call the company** — and is the slug available?

This phase is **information-only** — it produces *no* user-visible artifacts yet. Everything generated here feeds the Content Creation phase.

### Polsia's observed behavior

From the three Polsia executions (Penora, CoauthorOS, AgentDeck):

| Polsia log line | What's happening |
|---|---|
| `Updating company mood... / Mood updated` | Live dashboard status push. Founder sees "🔍 Researching..." in real-time |
| `Using sapiom:web_search... / Deep searching web for: X` | A *deeper* web search than the standard tool — used for complex multi-entity queries |
| `Searching web for: X` | Standard web search — quick lookup |
| `Failed: getaddrinfo ENOTFOUND couathour.io` | Tried to fetch the founder's existing site — DNS failed → fall back to web search |
| `Failed: No web results found` | Search returned zero results → adapt query and retry |
| `Reading mcp-sapiom-web_search-X.txt... Failed: 26398 tokens > 25000` | Search results were too large → switched to GrepTool (surgical extraction) |
| `Using dashboard:save_surprise_strategy...` | Locked in the chosen strategy template before doing any building |
| `Saving user profile... User profile updated (only blank fields were modified)` | **Non-destructive** merge — never overwrites founder choices |
| `Company name updated to "AgentDeck"` (after 2 batches of 5 candidates) | Name generation = generate batch → check availability → pick → retry batch if all taken |
| `Note: slug "coauthoros" was taken, saved as "coauthoros-2" instead` | Slug collision recovery |

### Per-journey divergence (CRITICAL)

The three Polsia executions show **three distinct research shapes**:

| Journey | Research shape | Founder input |
|---|---|---|
| **Build My Idea** (Penora) | Clean: 2 searches keyed on the idea, single name attempt | Idea text (e.g. "AI book generator for indie authors") |
| **Grow My Company** (CoauthorOS) | Fetch existing URL → DNS fail → 6 fallback searches (3 for product, 3 for founder) | Business URL (e.g. "couathour.io") |
| **Surprise Me** (AgentDeck) | Sapiom *deep* search → batch-generate 5 names → check availability → pick → if none, retry with 5 more | None — system invents everything |

> **Note (April 2026 decision):** All 3 journeys are KEPT in v1. Surprise Me is the differentiating "Baljia magic" path — the personal-context cost is concentrated only on the journey where it actually creates substance (inventing an idea from background). Build/Grow get a leaner enrichment scope.

### Per-journey enrichment scope (locked decision)

Personal context enrichment (LinkedIn search, Twitter search, founder angle extraction) is required ONLY for Surprise Me. Build and Grow skip it because the founder already declared what they're building/growing — personal context would only add polish, not substance.

| Stage | Build My Idea | Grow My Company | Surprise Me |
|---|---|---|---|
| `enrichGeoIP` (location) | ✅ | ✅ | ✅ |
| Browser timezone | ✅ | ✅ | ✅ |
| `enrichLinkedIn` | ❌ | ❌ | ✅ |
| `enrichTwitter` | ❌ | ❌ | ✅ |
| `extractFounderAngle` | ❌ | ❌ | ✅ |
| Idea processing | `refine_idea` (active transform) | `fetch_business_url` (with DNS recovery) | `invent_idea` (from background) |

**Net effect:** Build/Grow are leaner and cheaper (~3 fewer LLM calls + ~3 fewer Tavily searches per onboarding). Surprise Me keeps full personal enrichment because that's the journey where it pays off.

### Build vs Grow research intent (locked decision)

Even when both journeys are in the same industry, they ask **fundamentally different research questions**:

| | Build My Idea | Grow My Company |
|---|---|---|
| **One-line summary** | "You don't have PMF, find it" | "You have PMF, find DISTRIBUTION" |
| **Research focus** | Product (landscape, features, MVP scope) | Distribution (acquisition channels, conversion, positioning) |
| **Tavily query patterns** | `${idea} competitors features pricing 2025`, `${category} market size`, `${competitor} reviews complaints` | `${competitor} traffic sources SimilarWeb`, `${category} acquisition channels`, `${audience} communities Reddit forums` |
| **Report sections** | Market Overview / Why Now / Competitors / The Opportunity / Why This Fits | Current Positioning / Competitor Acquisition Channels / Competitive Landscape / Growth Opportunities / Recommended Actions |
| **Engineering task** | Build MVP from zero (5-section product spec) | Optimize existing (5-section optimization spec) |
| **Mission framing** | Articulate a future that doesn't exist | Refine an existing identity |

Surprise Me is closer to Build (PMF doesn't exist for the invented idea) but adds extra sections (Why Now + Idea Refinements) to justify the system-invented idea.

### Market research format reference (locked structure)

Three Polsia samples define the format and the quality bar. Per-journey section sets differ — Grow is denser (existing business gives us more to analyze), Build is lean, Surprise adds Idea Refinements to justify the invented idea.

#### Per-journey section sets

| Section | Build My Idea | Grow My Company | Surprise Me |
|---|---|---|---|
| Overview | Market Overview | Business Overview (+ revenue_model + notable_validation) | Idea Overview |
| Market analysis | folded into Overview | Industry Landscape + Key Trends + Market Timing | Market Validation + Why Now |
| Competitive Landscape (table) | ✅ | ✅ | ✅ |
| The Opportunity | ✅ | folded into Gaps to Exploit | folded into Idea Refinements |
| Competitive Advantages | — | ✅ bullets | — |
| Gaps to Exploit | — | ✅ bullets | — |
| AI Leverage Points | — | ✅ bullets | — |
| Idea Refinements | — | — | ✅ 4 numbered items |
| Why This Fits You | ✅ (geo + angle) | ✅ (geo + adjacent business) | ✅ (geo + ecosystem) |
| First Priorities | ✅ 3 numbered | ✅ 3 numbered | ✅ 3 numbered |

**"First Priorities" is the bridge to starter tasks.** The 3 numbered priorities map directly to the 3 starter tasks (research / build / outreach in slot order). Phase 3b `create_starter_tasks` reads `first_priorities` from market_research output instead of re-prompting from scratch.

#### Sample 1 — AgentDeck (Surprise Me flavor)

> **Idea Overview**
>
> Digvijay wants to build a platform that provides different specialized AI agents for digital work. Think of it as a one-stop shop where businesses pick the right AI agent for each task: content writing, data entry, customer support, research, email management, scheduling, and more. Each agent is purpose-built for its domain, not a generic chatbot trying to do everything.
>
> Based on research, the strongest positioning is a marketplace of specialized AI agents for SMBs and mid-market companies who can't afford to build custom AI workflows but need automation across multiple business functions.
>
> **Market Validation**
>
> The numbers are massive and growing fast:
> - Global AI agents market: $7.6B in 2025 → $10.9B in 2026 (43% YoY growth)
> - Projected to reach $52-183B by 2030-2033 depending on the estimate
> - 85% of organizations have integrated AI agents in at least one workflow
> - 51% of companies have already deployed AI agents
> - Gartner predicts 40% of enterprise apps will include task-specific AI agents by end of 2026 (up from <5% in 2025)
> - Asia Pacific is the fastest-growing region, and India's $1.2B national AI mission is fueling adoption
>
> Why now:
> - Multi-agent systems are exploding: Gartner reported a 1,445% surge in multi-agent system inquiries from Q1 2024 to Q2 2025
> - Standardization is happening: Anthropic's MCP and Google's A2A protocols are making agent interoperability viable
> - Only 1% of companies describe their AI rollouts as mature, meaning the market is wide open for platforms that make agents accessible
> - Companies report 6-10% revenue increases and up to 37% cost savings from AI agents
>
> **Competitive Landscape**
>
> | Competitor | What They Do | Pricing | Gap |
> |---|---|---|---|
> | CrewAI | Open-source multi-agent orchestration framework | Free + Enterprise | Developer-focused, requires coding |
> | Relevance AI | No-code AI agent builder | Free + paid from $19/mo | Generic, not pre-specialized by domain |
> | Beam AI | Enterprise AI agent platform | Custom (enterprise) | Too expensive/complex for SMBs |
> | Lindy AI | Pre-built AI assistants | From $49/mo | Limited variety, US-focused |
> | Agent.ai | AI agent marketplace/directory | Varies | Directory not platform; fragmented quality |
>
> Key whitespace: No major player offers a curated marketplace of domain-specific agents at SMB-friendly pricing. India-based pricing/support is a real differentiator for Asia Pacific.
>
> **Why This Fits You**
>
> Digvijay is based in Pune, one of India's top tech hubs with direct access to IT services talent and a natural client pipeline. Indian SMBs and IT services companies are actively looking for AI automation tools. Lower operating costs enable aggressive pricing against US-based competitors. IST overlaps with both US evening and European morning. India's $1.2B AI mission creates tailwinds.
>
> **Idea Refinements**
>
> 1. **Pre-built, specialized agents over generic builders**: Don't make users build their own agents. Offer a curated deck of ready-to-use agents.
> 2. **Marketplace model**: Let third-party developers also publish agents on the platform.
> 3. **SMB-first pricing**: Start at $29-49/mo with usage-based scaling.
> 4. **India-first, global ambition**: Launch targeting Indian SMBs, then expand to SE Asia and US/EU.
>
> **First Priorities**
>
> 1. **Build the MVP**: Web platform with 3-5 pre-built AI agents covering common digital work tasks
> 2. **Competitive deep-dive**: Analyze CrewAI, Relevance AI, Lindy AI, Beam AI, and Agent.ai for feature gaps and pricing opportunities
> 3. **Cold outreach**: Contact 5-10 Indian SMBs and IT services companies to validate demand

#### Sample 2 — Penora (Build My Idea flavor)

> **Market Overview**
>
> The AI-assisted publishing market is in hypergrowth. The self-publishing industry hit $4.2 billion in 2025, and 30% of indie authors now use AI somewhere in their writing workflow. The AI writing tools market is projected to reach $6.464 billion by 2030 at a 26.94% CAGR.
>
> Total publishing revenue rose 4.1% in 2024 to $32.5 billion (AAP). Self-publishing alone accounts for ~$1.25 billion. The audiobook segment is growing even faster.
>
> Key trend: The market is shifting from "AI writing assistants" to "AI book generators". Nobody has built the full-stack autonomous agent — one that goes from brief to published book without human intervention at every step.
>
> **Competitive Landscape**
>
> | Competitor | What They Do | Pricing | Gap |
> |---|---|---|---|
> | Squibler | All-in-one writing platform with AI assistance | Free / $29/mo Pro | Still a tool you operate — not autonomous |
> | Sudowrite | Fiction-focused AI co-writer (Story Engine 3.0) | $19-$44/mo | Helps with writing, not publishing pipeline |
> | Inkfluence AI | Most complete: writing + covers + audiobooks + export | Free + paid | Closest to full-stack but requires manual steps |
> | Automateed | One-time pricing AI eBook creator | $149 one-time | Focused on eBooks, limited quality control |
> | SidekickWriter | Research + drafting + export workflow | Subscription | Strong research but not autonomous |
> | Novelcrafter | Power-user control with Codex worldbuilding | Subscription | Great for fantasy but very hands-on |
>
> **The Opportunity**
>
> Every competitor is a tool. You open it, you click buttons, you guide the AI, you export, you upload to Amazon. Nobody has built an employee — an AI agent that:
> - Takes a brief or topic
> - Autonomously researches the subject
> - Outlines, drafts, and edits the full manuscript
> - Generates a professional cover
> - Formats for Kindle, ePub, PDF
> - Publishes to marketplaces
>
> This is the difference between hiring a writing assistant vs. hiring an autonomous author. Penora is the autonomous author.
>
> **Why This Fits**
>
> Based in Pune — one of India's top tech hubs — with an existing Polsia company (SkillPress) focused on education. Book generation is adjacent to education but distinctly different: SkillPress turns expertise into courses, Penora turns ideas into published books. India's self-publishing ecosystem is also booming with Notion Press and Amazon KDP India seeing rapid growth.
>
> **First Priorities**
>
> 1. **Build MVP** — Core book generation engine: input a brief, output a formatted manuscript
> 2. **Competitive research** — Deep-dive into Inkfluence AI and Squibler's feature sets to identify differentiation
> 3. **Early outreach** — Target indie authors, content creators, and course creators (natural overlap with SkillPress audience)

#### Sample 3 — XYZ Registry (Grow My Company flavor)

> **Business Overview**
>
> XYZ Registry (XYZ.COM LLC) operates the .xyz top-level domain, one of the most successful new gTLDs launched in 2014. The company manages 35+ domain extensions with over 4 million registered domains across 230+ countries. Founded by Daniel Negari.
>
> **Revenue model**: Domain registration fees, annual renewals, premium name sales, bulk registration services. Revenue flows from 200+ registrar partners (GoDaddy, Namecheap, etc.).
>
> **Notable validation**: Alphabet (Google's parent) uses abc.xyz as its corporate website.
>
> **Market Analysis**
>
> *Industry Landscape*: The global domain registration market is valued at approximately $3-5 billion annually. Legacy TLDs (.com, .net, .org) dominate with 150M+ registrations for .com alone.
>
> *Key Trends*:
> - Web3 and crypto adoption: .xyz has become popular among blockchain projects
> - Emerging market growth: Domain demand rising in Asia, Africa, Latin America
> - AI-driven web presence: More businesses and AI projects need unique identities
> - Price competition: New TLDs compete aggressively (from $0.99/year for numerics)
>
> *Market Timing*: Strong. The internet continues expanding, emerging markets are coming online, and alternative TLDs are gaining mainstream acceptance.
>
> **Competitive Landscape**
>
> | Competitor | TLD | Registrations | Positioning |
> |---|---|---|---|
> | Verisign | .com, .net | 150M+ | Legacy dominance, $1B/yr revenue |
> | Public Interest Registry | .org | 25M+ | Non-profit/organization focus |
> | Radix | .online, .store, .tech | 5M+ | Industry-specific TLDs |
> | Identity Digital | .io, .co, .me | 3M+ | Tech/startup-focused |
> | TopLevel Domains | .top | 2.9M+ | Price-competitive, Asia-focused |
>
> **Competitive Advantages**
> - Brand neutrality: .xyz isn't tied to any industry
> - Google endorsement: abc.xyz gives instant credibility
> - Price range: From $0.99 (numeric) to premium names
> - Scale: 35+ TLDs in portfolio diversifies revenue
>
> **Gaps to Exploit**
> - Registrar dashboard analytics are basic; no unified view across all 35+ TLDs
> - No real-time competitive intelligence on registration trends
> - Partner (registrar) performance tracking is manual
> - Premium name pricing optimization is underserved
>
> **Why This Fits You**
>
> Based in Pune, one of India's tech capitals, you're well-positioned to leverage India's growing domain market. The domain industry runs 24/7 globally, and an operating system that tracks registrations, revenue, partner performance, and competitive moves in real-time would be a force multiplier.
>
> **AI Leverage Points**
> - Automated registration trend analysis: Detect spikes, drops, patterns across TLDs
> - Competitive monitoring: Track competitor TLD registrations and pricing changes daily
> - Revenue forecasting: Predict renewal rates based on historical patterns
> - Partner performance scoring: Rank registrars by volume, growth, revenue
> - Abuse detection: Flag suspicious bulk registrations
>
> **First Priorities**
>
> 1. **Build the core dashboard** — Registration volume, revenue, and partner metrics in one view
> 2. **Map the competitive landscape** — Detailed analysis of top 5 competing TLD operators
> 3. **Start outreach** — Connect with potential registrar partners and enterprise domain buyers

#### JSON output schemas (per-journey, no forced unification)

Per the locked per-journey-shapes principle, each journey returns its own JSON shape — strategy classes consume only their own shape.

**BuildMarketResearch** (Build My Idea):
```typescript
{
  overview: string,                    // Market Overview, 1-2 paragraphs
  competitors: Array<{ name, what_they_do, pricing, gap }>,
  opportunity: string,                 // The Opportunity, 1 paragraph + bullet list
  why_this_fits_you: string,           // 1 paragraph, MUST anchor in GeoIP city/country
  first_priorities: [
    { slot: 'research', title, rationale },
    { slot: 'build', title, rationale },
    { slot: 'outreach', title, rationale }
  ]
}
```

**GrowMarketResearch** (Grow My Company):
```typescript
{
  business_overview: string,
  revenue_model: string,
  notable_validation: string | null,
  market_analysis: {
    industry_landscape: string,
    key_trends: string[],
    market_timing: string              // Strong/Moderate/Early + 1-line rationale
  },
  competitors: Array<{ name, focus_area, positioning_or_size, gap }>,
  competitive_advantages: string[],
  gaps_to_exploit: string[],
  why_this_fits_you: string,
  ai_leverage_points: string[],
  first_priorities: [
    { slot: 'research', title, rationale },
    { slot: 'build', title, rationale },
    { slot: 'outreach', title, rationale }
  ]
}
```

**SurpriseMarketResearch** (Surprise Me):
```typescript
{
  idea_overview: string,               // Idea Overview, 1-2 paragraphs
  market_validation: {
    size_and_growth: string[],         // bulleted concrete numbers
    why_now: string[]                  // bulleted timing rationale
  },
  competitors: Array<{ name, what_they_do, pricing, gap }>,
  why_this_fits_you: string,
  idea_refinements: Array<{ title, rationale }>,  // 4 numbered items
  first_priorities: [
    { slot: 'research', title, rationale },
    { slot: 'build', title, rationale },
    { slot: 'outreach', title, rationale }
  ]
}
```

#### Format constraints (locked)

- **Length**: 800–1200 rendered words per report. `maxTokens` ≥ 2500 (current 1200 is too tight for the new format)
- **Competitor table**: 4–6 rows. Never fewer than 3. Each row must have concrete pricing and a sharp 1-line gap
- **Specific numbers required**: market size in $B/$M, growth rate as percentage, adoption stats. LLM must surface these from Tavily output, not invent them
- **Geographic anchoring**: `why_this_fits_you` MUST inject `${city}, ${country}` from GeoIP. If GeoIP unavailable, use generic phrasing without naming a city — never substitute a hardcoded country
- **No source citations**: Tavily URLs stay in logs only, never in the saved document
- **first_priorities is mandatory** — drives Phase 3b `create_starter_tasks`

#### Failure recovery

- Tavily completely fails (zero results across all queries): **throw** — research is foundational
- Tavily returns partial results: proceed but log thin coverage; still produce all required fields
- JSON parse fails: retry once with simplified prompt; if second attempt fails, throw
- GeoIP missing: keep `why_this_fits_you` section but use generic phrasing; do not name a city or country

#### Implementation notes for Phase 3a

- Use OpenAI structured outputs (`response_format: { type: 'json_schema' }`) — not regex parsing
- Per-journey prompts share core scaffold but inject:
  - Different Tavily query patterns (locked in `project_grow_vs_build_intent` memory)
  - Different required sections (per the table above)
  - Different section emphasis (Build = product gaps; Grow = distribution gaps; Surprise = idea justification)
- Storage: single `market_research` document with JSON content; render to markdown for dashboard display
- `first_priorities` is read by `create_starter_tasks` in Phase 3b — no separate task generation prompt needed for the Title/Rationale fields (full eng task spec still gets generated separately for the engineering slot)

### Our current implementation

| Polsia stage | Our function | File | Status |
|---|---|---|---|
| Mood update | *(not implemented)* | — | **MISSING** — not emitted as platform event |
| Founder enrichment (LinkedIn/Twitter/GeoIP) | `runEnrichFounder` | `src/lib/services/onboarding.service.ts:216` | ✅ Built (Tavily + ipstack/ipinfo) |
| Business enrichment | `runEnrichBusiness` | `:452` | ✅ Built (Tavily query, branches by journey) |
| Persist context to memory | `runPersistContext` | `:471` | ✅ Built (writes to Layer 1) |
| Founder angle extraction | `runExtractFounderAngle` | `:272` | ✅ Built (Haiku-extracted positioning) |
| Strategy selection | `runSelectStrategy` | `:525` | 🔄 Replacing — splits per-journey: `refine_idea` (Build, active transform), `fetch_business_url` (Grow), `invent_idea` (Surprise) |
| Archetype classification | `runClassifyArchetype` | `:582` | ❌ **Dropping** — redundant with `generateRoadmap`'s own classifier; stub never built per-archetype templates anyway |
| Name generation | `runNameCompany` | `:624` | ⚠️ **Single name with 3 retries** — Polsia uses *batch* of 5 with availability check |
| Market research (3 parallel searches + Haiku synthesis) | `runMarketResearch` | `:683` | ✅ Built |
| **Live activity log lines** | *(not implemented)* | — | **MISSING** — `event.service` exists but no per-stage activity emissions |
| **Token overflow recovery** | *(N/A — we slice at 3000 chars)* | `:715` | ✅ Already mitigated by truncation; no grep needed |
| **Business URL fetch (Grow journey)** | *(not implemented)* | — | **MISSING** — currently we only search, never `fetch()` the URL |

### What's missing — concrete gaps

1. **Live activity stream emissions.** Every search, every name attempt, every retry should emit an `onboarding_activity` event so the founder's dashboard can render a Polsia-style scrolling log.

2. **Mood updates.** Push `researching` → `building` → `writing` → `celebrating` so the mascot animates in real-time.

3. **Business URL fetch for Grow My Company.** Currently we *search* for the URL via Tavily; we should `fetch()` the actual page (with DNS failure recovery → fall back to search).

4. **Batch name generation for Surprise Me.** Polsia generates 5 candidates → checks availability → picks the best available → if 0 available, retries with 5 fresh names. We currently do single-name with retry-on-collision.

5. **Per-journey strategy divergence.** Currently most stages run identically across journeys with small `if (journey === ...)` branches. Should be three explicit `Strategy` classes that own their stage list.

---

## Content Creation Phase

### What it does (plain terms)

Take the research outputs and turn them into **real, public, user-visible artifacts**:

1. **Market research report** — saved as a versioned document the founder can read
2. **Mission document** — the company's "why," written from the founder's angle
3. **One-liner** — 10-15 word description used in landing page meta + email subjects
4. **Landing page** — full HTML page served at `{slug}.baljia.app`
5. **Launch tweet** — public announcement on @baljia_ai
6. **Welcome/startup email** — first email the founder receives, from `{slug}@baljia.app`
7. **Inbox message** — in-platform notification with deep links *(NOT IMPLEMENTED)*
8. **Magic link** — one-click jump-into-dashboard token *(NOT IMPLEMENTED as separate stage)*
9. **Completion email** — recap email from `system@baljia.ai` with magic link embedded

### Polsia's observed behavior

| Polsia log line | What's happening |
|---|---|
| `Saving report: Market Research Report... Report #451413 saved` | Research → permanent, ID-addressable artifact. Future tasks reference by ID |
| `Sending email... Email sent` (early) | Welcome email from `{slug}@polsia.app` — "your AI company is alive" identity moment |
| `Posting to Twitter... Tweet posted` | Launch announcement on @polsia (shared platform handle) |
| `Creating landing page... Landing page live at https://penora.polsia.app` | LLM writes HTML → deployed (Polsia serves via wildcard subdomain) |
| `Document "mission" saved successfully` | Mission written and stored as a structured document |
| `Sending inbox message... Message sent to company inbox` | In-platform notification — separate from email |
| `Magic link generated / Generating login link...` | One-click auth token created for the completion email |
| `Sending summary email... Summary email sent` | Final recap email from `system@polsia.com` (platform sender) |
| `Celebrating! Celebration triggered!` | Confetti animation flag set on dashboard |

### How content artifacts compose

```
research outputs
       │
       ├──► mission.md         (one-liner + mission)
       ├──► market_research.md (full competitive analysis)
       ├──► landing_page.html  (consumes mission + one-liner + research)
       ├──► launch_tweet       (consumes one-liner)
       ├──► startup_email      (from {slug}@baljia.app, present-tense, "I'm building...")
       └──► completion_email   (from system@baljia.ai, past-tense, "I built...")
```

Every artifact draws from the **same upstream context** — that's why research must be solid before content runs.

### Mission format reference (locked structure)

The mission document follows Polsia's **3-section structure** — NOT a single one-line statement. Current `runSaveMission` generates only a 1-2 sentence mission + 10-15 word one-liner. Phase 3a will replace this with the full structure below.

#### Structure

1. **Mission** (1 sentence) — aspirational. Two patterns:
   - "Make X [property] for [audience]" (positive framing)
   - "No [audience] should [bad thing]" (negative framing)

2. **What we're building** (2-3 sentences) — concrete product description. What it does. Who it's for. No vision-language; pure product.

3. **Where we're headed** (4-6 sentences) — vivid future-state narrative. Specific places (driven by founder GeoIP). Specific people (teacher, founder, two-person startup). Ends with a category-defining reframe.

#### Sample 1 — AgentDeck

> **Mission**
>
> Make AI agents accessible to every business, not just the ones with engineering teams and enterprise budgets.
>
> **What we're building**
>
> AgentDeck is a platform of specialized AI agents for digital work. Each agent is purpose-built for one domain: content, research, email, data, support, code. Businesses pick the agent they need, point it at the task, and get results. No prompt engineering, no setup, no hiring.
>
> **Where we're headed**
>
> A world where "I need someone for this" never means a 3-week hiring process for repetitive digital work. Every small business, every solo founder, every growing team has a deck of AI specialists on call. The work gets done at machine speed with human oversight. AgentDeck becomes the default answer to "who handles that?" for every digital task a business runs into.

#### Sample 2 — Qontakt

> **Mission**
>
> No business should lose a deal because they couldn't follow up fast enough.
>
> **What we're building**
>
> An autonomous AI sales agent that handles everything between "who should I sell to?" and "meeting booked." Qontakt prospects, writes outreach, follows up, and qualifies leads for businesses that need customers but can't afford a full sales team.
>
> **Where we're headed**
>
> A world where every business, from a two-person startup in Pune to a growing SaaS company in Bangalore, has access to the same caliber of sales development that Fortune 500 companies take for granted. No SDR teams. No $5K/month tools. Just an AI agent that works around the clock, finding the right people and starting the right conversations. Sales becomes a solved problem, and founders get back to building what they love.

#### Sample 3 — Penora

> **Mission**
>
> Make publishing as simple as having an idea.
>
> **What we're building**
>
> An autonomous AI author that takes a brief and delivers a complete, published book. Research, writing, editing, cover design, formatting. Not a tool you operate. An employee that ships manuscripts while you sleep.
>
> **Where we're headed**
>
> A world where the barrier to publishing is zero. Where a teacher in Pune can turn her classroom insights into a bestselling education guide overnight. Where a founder's hard-won lessons become a book before the lessons fade. Where the only thing standing between an idea and a published work is the decision to start. Penora makes the entire publishing industry accessible to anyone with something worth saying.

#### Per-journey mission framing (locked)

| Journey | Mission framing | "Where we're headed" framing |
|---|---|---|
| Build My Idea | Articulate a future that doesn't exist | Vivid scenarios in founder's region; "X becomes the default for Y" reframe |
| Surprise Me | Same as Build (invented idea) + reference founder's background as credibility anchor | Same as Build |
| Grow My Company | Refine existing identity (don't reinvent) | Speak to current customers' future + expansion to adjacent segments |

#### Implementation notes for Phase 3a

- **JSON output mode**: LLM returns `{mission, what_were_building, where_were_headed}` fields — no regex parsing
- **Single document**: all 3 sections stored in one `mission` document (not 3 separate docs); rendered with section headers in dashboard
- **One-liner stays separate**: still used by landing page meta + email subjects; derive it from "What we're building" first sentence rather than re-prompting
- **Geographic anchoring is mandatory**: "Where we're headed" prompt MUST inject founder GeoIP city/country — that's the source of Pune/Bangalore specificity in samples; if no GeoIP available, fall back to "your city" or skip place-specific lines
- **Length budget**: full mission ≈ 200 words (current is ~50)
- **Source material**: pulls from full market research output (not slice) + founder angle + journey + ctx idea shape

### Our current implementation

| Polsia artifact | Our function | File | Status |
|---|---|---|---|
| Market research report (with ID) | Saved as `market_research` document in `runSaveMission` | `:858` | ✅ Built (no separate ID, but document has its own UUID) |
| Mission document | `runSaveMission` | `:804` | ✅ Built (Haiku generates one-liner + mission) |
| Landing page | `runGenerateLandingPage` | `:1017` | ✅ Built (LLM writes HTML, saved as `landing_page` document) |
| Launch tweet | `runPostLaunchTweet` | `:1217` | ✅ Built (Late.dev integration, non-blocking) |
| Startup email (from `{slug}@baljia.app`) | `runSendStartupEmail` | `:1078` | ✅ Built (present-tense, ASCII "Excited") |
| Completion email (from `system@baljia.ai`) | `runSendCompletionEmail` | `:1134` | ✅ Built (past-tense, ASCII "Celebrating") |
| CEO bootstrap message | `runGenerateCeoSummary` | `:1247` | ✅ Built (writes to chat session) |
| **Inbox message** | *(not implemented as separate surface)* | — | **MISSING** — currently subsumed by chat message |
| **Magic link at end** | *(not implemented as onboarding stage)* | — | **MISSING** — auth magic link exists in `auth.service`, just needs to be called from finalize stage and embedded in completion email |
| **Live activity log** | *(not implemented)* | — | **MISSING** |
| **Mood transitions** | *(not implemented)* | — | **MISSING** |
| **Landing page deployment** | Currently served by Next.js middleware via wildcard `*.baljia.app` DNS | — | ✅ Architecture decided (no per-page deployment needed) |

### Landing page deployment — how it actually works

Polsia says "Landing page live at https://penora.polsia.app." That suggests deployment, but it's actually:

1. LLM generates HTML
2. HTML stored in `documents` table with `doc_type='landing_page'`
3. Cloudflare wildcard DNS `*.baljia.app` → our Next.js app
4. Next.js middleware reads `Host` header → extracts slug → looks up company → serves the stored HTML

**Cloudflare does only DNS routing.** No hosting, no compute, no page generation.

The Engineering agent will *later* swap the wildcard for a per-company CNAME pointing at a real Render service when it builds the actual product. Until then, every landing page is rendered from the database.

---

## Cross-cutting concerns (Activity, Mood, Watchdog)

These three sit *across* both phases and are the largest gaps in our current code.

### Activity stream

Every stage should emit human-readable log lines that match Polsia's style:

```
"Searching web for: AI book platforms 2025 competitors..."
"Strategy 'Novel Idea' saved. Proceed with this approach."
"Saving report: Market Research Report..."
"Report #117095 saved"
"Landing page live at https://penora.baljia.app"
"Magic link generated"
"Celebration triggered!"
```

These are emitted on a separate channel from the machine-readable `onboarding_stage` events:

| Channel | Consumer | Purpose |
|---|---|---|
| `onboarding_stage` | progress bar UI | Machine-readable: `{stage, status}` |
| `onboarding_activity` *(NEW)* | terminal-style log strip | Human-readable: `{text, tool, timestamp}` |
| `onboarding_mood` *(NEW)* | mascot animation | Single value: `researching | building | celebrating | ...` |

All three flow through the existing `event.service` (Redis pub/sub + Neon dual-write).

### Mood states

```
heartbeat       → first stage, mascot wakes
researching     → enrich + market search
building        → provision + landing + tasks
writing         → mission + roadmap + tweet
publishing      → email + tweet
celebrating     → finalize
blocked         → watchdog stall warning
failed          → terminal failure
```

### Watchdog

Currently onboarding has **no watchdog** — only worker agents do (`src/lib/agents/watchdog.ts`). For a 60-180s async pipeline, we need:

- Tick every 5s
- Emit `Watchdog: Xs since progress, active tool=Y` if idle > 10s
- Force kill if idle > 60s
- Absolute timeout of 600s
- Mark `onboarding_status='failed'` on kill

In-process is fine for v1. External cron-based cleanup (sweep stuck `running` rows) can come later when pod restarts become a real source of stuck rows.

---

## Polsia-to-Baljia mapping

Quick reference for translating Polsia execution log lines to our code:

| Polsia line | Our equivalent |
|---|---|
| `Executing in isolated Sapiom sandbox (async fire-and-forget)` | `runOnboardingPipeline` called without `await` from `/api/onboarding/route.ts` |
| `Stage: heartbeat` | `runHeartbeat` |
| `Updating company mood...` | *Not implemented* — would emit `onboarding_mood` event |
| `Searching web for: X` | `tavilySearchText` calls in `runEnrichFounder`, `runEnrichBusiness`, `runMarketResearch` |
| `Saving user profile...` | `runPersistContext` writes to memory Layer 1 |
| `Saving report: Market Research Report... Report #N saved` | `runSaveMission` writes `market_research` document |
| `Document "mission" saved successfully` | `runSaveMission` writes `mission` document |
| `Company name updated to "X"` | `runProvisionInfrastructure` updates `companies.name` |
| `Managing infrastructure...` (name availability check) | `runNameCompany` (single attempt × 3 — Polsia does batch × N) |
| `Creating landing page... Landing page live at X` | `runGenerateLandingPage` (HTML stored, served by wildcard DNS) |
| `Sending email... Email sent` (early) | `runSendStartupEmail` from `{slug}@baljia.app` |
| `Sending summary email... Summary email sent` (late) | `runSendCompletionEmail` from `system@baljia.ai` |
| `Posting to Twitter... Tweet posted` | `runPostLaunchTweet` via Late.dev |
| `Magic link generated` | *Not yet a stage* — `auth.service.createMagicLink` exists, needs new finalize stage |
| `Sending inbox message...` | *Not yet a stage* — subsumed in `runGenerateCeoSummary` chat message |
| `Celebrating! Celebration triggered!` | `runCelebrate` emits `onboarding_completed` event |
| `Stage: flush_diagnostics` | `runFlushDiagnostics` |
| `Watchdog: Xs since progress...` | *Not implemented for onboarding* (only worker agents have it) |
| `Execution finalized via sandbox_callback` | Implicit — Promise resolves, no callback needed |

---

## See also

- [onboarding-implementation-plan.md](./onboarding-implementation-plan.md) — phased build plan
- `src/lib/services/onboarding.service.ts` — current pipeline
- `src/lib/services/event.service.ts` — pub/sub for activity/mood/stage events
- `src/lib/agents/watchdog.ts` — existing worker watchdog (template for onboarding watchdog)
- `CLAUDE.md` — overall architecture and locked decisions
