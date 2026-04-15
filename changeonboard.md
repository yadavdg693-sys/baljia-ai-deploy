# Onboarding Changes — Polsia Spec Alignment

All changes made after studying `C:\Users\Vaishnavi\My_Projects\polsia\specs\internal\onboarding-bootstrap.md` against the Baljia codebase.

---

## 1. Pipeline Expanded from 12 to 20 Stages

**File:** `src/lib/services/onboarding.service.ts`

Added 8 new stages to match the Polsia spec:

| # | New Stage | Purpose |
|---|-----------|---------|
| 1 | `classify_archetype` | Categorizes company into saas/marketplace/agency/content/ecommerce/community before naming |
| 2 | `generate_roadmap` | Blocking roadmap generation (was fire-and-forget in celebrate) |
| 3 | `derive_active_milestone` | Extracts first milestone tags/title for starter task context |
| 4 | `generate_landing_page` | Haiku generates narrative-first HTML landing page (4000 max_tokens), saved as `landing_page` document |
| 5 | `send_welcome_email` | Sends from company inbox `{slug}@baljia.app` (not platform `hello@baljia.app`) |
| 6 | `post_launch_tweet` | Posts via Late.dev if configured |
| 7 | `generate_ceo_summary` | Creates first CEO chat message with checklist + task list + trial CTA |
| 8 | `flush_diagnostics` | Pipeline diagnostics flush |

**Full 20-stage pipeline order:**
heartbeat → enrich_founder → enrich_business → persist_context → extract_founder_angle → select_strategy → classify_archetype → name_company → provision_infrastructure → generate_market_research → save_mission → generate_roadmap → derive_active_milestone → create_starter_tasks → generate_landing_page → send_welcome_email → post_launch_tweet → generate_ceo_summary → flush_diagnostics → celebrate

---

## 2. Archetype Classification Stage

**File:** `src/lib/services/onboarding.service.ts` — `runClassifyArchetype()`

- Uses keyword classification as baseline
- Refines with Haiku when rich context is available
- Persists archetype to Layer 1 memory
- Added `archetype` to `PipelineContext`

---

## 3. Milestone-Aware Starter Tasks

**File:** `src/lib/services/onboarding.service.ts` — `generatePersonalizedTasks()`

- Starter tasks now derive from the active milestone (not disconnected templates)
- Added `ctx.archetype`, `ctx.activeMilestoneTitle`, `ctx.activeMilestoneTags` to LLM prompt context
- Roadmap generation is now a blocking stage so milestones exist before task creation

---

## 4. CEO Bootstrap Message

**File:** `src/lib/services/onboarding.service.ts` — `runGenerateCeoSummary()`

- Creates a chat session and posts the first CEO message
- Message includes: checklist of accomplished items, starter task list, subscribe CTA, daily progress promise
- Matches Polsia spec for first-touch CEO interaction

---

## 5. Bootstrap Proof Bundle (Landing Page, Welcome Email, Launch Tweet)

**File:** `src/lib/services/onboarding.service.ts`

- **Landing page:** Haiku-generated narrative HTML saved as `landing_page` doc_type document (non-blocking, try/catch)
- **Welcome email:** Sent from company inbox identity, not platform address (non-blocking)
- **Launch tweet:** Posted via Late.dev if configured (non-blocking)
- All three are visible artifacts BEFORE trial/card capture

---

## 6. Trial Packaging in Celebrate Event

**File:** `src/lib/services/onboarding.service.ts` — `runCelebrate()`

- Added trial metadata to completion event payload: `trial_days: 3, trial_credits: 10, trial_night_shifts: 3`
- Removed fire-and-forget calls to `sendWelcomeEmail` and `roadmapService.generateRoadmap` (now handled by earlier pipeline stages)

---

## 7. Browser Timezone Capture

**Files:**
- `src/app/(auth)/onboarding/page.tsx` — Captures `Intl.DateTimeFormat().resolvedOptions().timeZone`
- `src/lib/validations/index.ts` — Added `timezone` to `onboardingSchema` and `quickStartSchema`
- `src/lib/services/onboarding.service.ts` — `runPersistContext` prefers browser timezone over GeoIP: `ctx.browserTimezone ?? geo?.timezone ?? null`
- Added `browserTimezone` to `PipelineContext`

---

## 8. Pre-Auth Draft Flow (Waitlist + Quick-Start)

### New Files:

**`src/app/api/waitlist/route.ts`**
- Pre-auth email capture endpoint
- Checks if user already exists → returns `existing_user: true`
- New user → inserts into waitlist table → returns redirect to `/onboarding?email=...`

**`src/app/api/quick-start/route.ts`**
- Unauthenticated draft company creation
- Finds or creates unverified user record
- Creates draft company shell via `companyService.createCompany`
- Adds 10 welcome credits + emits `company_created` event
- Updates waitlist record to `converted`
- Sets company `onboarding_status: 'pending_auth'` and `onboarding_journey` on company record
- Returns redirect to `/login?redirect=/dashboard/{slug}`

### Schema Changes:

**`src/lib/db/schema.ts`**
- Added `waitlist` table: id, email, onboarding_intent, idea_text, business_website, timezone, ip_address, converted_user_id, converted_company_id, status, created_at
- Added `onboarding_journey` column to `companies` table (persists journey for pending_auth resume)

**`src/lib/validations/index.ts`**
- Added `waitlistSchema`: `{ email: z.string().email().max(255) }`
- Added `quickStartSchema`: `{ email, journey, idea?, business_url?, timezone? }`

---

## 9. Pending-Auth Auto-Resume After Login (BUG 6 Fix)

The pre-auth flow creates a company with `pending_auth` status but the pipeline never ran. After login, the user lands on the dashboard which didn't know how to resume it.

### Fix across 4 files:

**`src/app/(dashboard)/dashboard/[companyId]/page.tsx`**
- Detects `onboarding_status === 'pending_auth'`
- Redirects to `/onboarding?resume={companyId}`

**`src/app/(auth)/onboarding/page.tsx`**
- Reads `resume` query param
- If present: initializes in `creating` step with `companyId` already set
- Auto-POSTs to `/api/onboarding` via useEffect (runs once via ref guard)
- SSE stream connects immediately for progress tracking

**`src/app/api/onboarding/route.ts`**
- Resume logic reads `company.onboarding_journey` as primary journey source
- Falls back to POST body journey if stored journey is null

**`src/app/api/quick-start/route.ts`**
- Now stores `onboarding_journey` on company when setting `pending_auth`

**Complete resume flow:**
quick-start → stores journey + pending_auth → login → dashboard → detects pending_auth → redirects to /onboarding?resume=... → auto-POSTs → pipeline runs → SSE shows progress → redirects to dashboard

---

## 10. Onboarding UI Updates (Polsia Spec Alignment)

**File:** `src/app/(auth)/onboarding/page.tsx`

- Level 1 heading: "Let's get started."
- Level 2 heading: "Let's build something."
- Build My Idea placeholder: "e.g. A social media agency for small restaurants"
- Build My Idea CTA: "Start building ->"
- Grow My Company URL placeholder: "yourcompany.com" (removed https://)
- Added `useSearchParams` for email prefill from waitlist redirect
- Updated STAGE_ORDER to include all 20 stages
- Handles unauthenticated flow: tries `/api/onboarding` first, on 401 with prefillEmail falls back to `/api/quick-start`

---

## 11. SSE Status Labels Updated

**File:** `src/app/api/onboarding/status/route.ts`

Updated STAGE_LABELS to include all 20 stages with human-readable labels:
- "Classifying business type..."
- "Building your roadmap..."
- "Setting your first milestone..."
- "Generating your landing page..."
- "Sending welcome email..."
- "Posting launch tweet..."
- "Preparing CEO briefing..."
- "Saving diagnostics..."

---

## 12. Type Updates

**File:** `src/types/index.ts`

- `OnboardingStatus` expanded: `'initializing' | 'pending_auth' | 'running' | 'completed' | 'failed'`
- `Company` interface: added `onboarding_journey: OnboardingJourney | null`

---

## Audit Fixes Applied

| Bug | Severity | Description | Fix |
|-----|----------|-------------|-----|
| BUG 2 | Medium | Landing page Haiku max_tokens too low for full HTML | Changed from 2000 to 4000 |
| BUG 5 | Cosmetic | Pipeline comment said "16-stage" | Updated to "20-stage" |
| BUG 6 | Critical | pending_auth pipeline never auto-resumes after login | Full fix across 4 files (see section 9 above) |

---

## Files Changed (Complete List)

| File | Change Type |
|------|-------------|
| `src/lib/services/onboarding.service.ts` | Modified — 8 new stages, archetype, milestone-aware tasks, CEO message, browser timezone |
| `src/app/(auth)/onboarding/page.tsx` | Modified — UI updates, 20-stage list, pre-auth flow, resume flow |
| `src/app/api/onboarding/route.ts` | Modified — timezone passthrough, pending_auth resume with stored journey |
| `src/app/api/onboarding/status/route.ts` | Modified — 20-stage labels |
| `src/lib/validations/index.ts` | Modified — waitlistSchema, quickStartSchema, timezone in onboardingSchema |
| `src/lib/db/schema.ts` | Modified — waitlist table, onboarding_journey column on companies |
| `src/types/index.ts` | Modified — pending_auth status, onboarding_journey on Company |
| `src/app/(dashboard)/dashboard/[companyId]/page.tsx` | Modified — pending_auth redirect |
| `src/app/api/waitlist/route.ts` | New — pre-auth email capture |
| `src/app/api/quick-start/route.ts` | New — unauthenticated draft company creation |
