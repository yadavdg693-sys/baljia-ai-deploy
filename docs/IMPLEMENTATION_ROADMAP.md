# Baljia AI — Detailed Implementation Roadmap

> Complete file-by-file, function-by-function specification for building the entire platform.
> 7 phases, ~80 files, ~8-11 weeks solo.

---

## Current State (What's Built)

```
✅ Phase 0 Complete:
├── Next.js 15 + TypeScript + React 19 + Tailwind v4
├── 27-table database schema (supabase/migrations/00001_initial_schema.sql)
├── TypeScript types for all entities (src/types/index.ts)
├── Supabase client setup (server.ts + client.ts)
├── Auth pages (login, callback, onboarding)
├── PostCSS config, .gitignore, middleware
├── 11 base UI components (Button, Input, Textarea, Card, Badge, Tabs, Dialog, Dropdown, Skeleton, Toast, ScrollArea)
├── 7 dashboard components (DashboardShell, TaskBoard, TaskCard, TaskDetailDialog, MetricsPanel, CreditDisplay, DocumentList, CompanyHeader)
├── Dashboard layout with auth wrapper
├── Baljia mascot (7 states, 5 sizes)
├── Slug generation + collision handling
├── Utility functions (cn, formatCredits, formatRelativeTime, formatRunningTime)
└── Design system (globals.css: dark theme, gold accent, CSS vars, fonts)
```

---

## PHASE 3: Core API Routes & Service Layer

**Goal**: Backend CRUD. Dashboard shows live data. Mock CEO chat. Onboarding creates companies.

### 3.1 — Supabase Admin Client

**File**: `src/lib/supabase/admin.ts`

```typescript
// Server-only client using SUPABASE_SERVICE_ROLE_KEY
// Bypasses RLS for platform-initiated operations:
//   - Credit deductions (platform charges on task start)
//   - Task status changes by verifier (not user-initiated)
//   - Company creation during onboarding
//   - Night shift task generation

export function createAdminClient(): SupabaseClient
```

### 3.2 — Service Layer

**7 service files** in `src/lib/services/`. Each is a plain TypeScript module exporting async functions (no classes).

---

#### `src/lib/services/company.service.ts`

```typescript
// Company CRUD + lifecycle management

createCompany(input: {
  owner_id: string;
  name: string;
  original_idea?: string;
  journey: OnboardingJourney;
}): Promise<Company>
  // 1. Generate slug via src/lib/slug.ts (with collision handling)
  // 2. INSERT into companies table
  // 3. DB trigger auto-creates 5 core document slots + 3 memory layers
  // 4. Return company record

getCompanyBySlug(slug: string): Promise<Company | null>

getCompanyById(id: string): Promise<Company | null>

getUserCompanies(userId: string): Promise<Company[]>

updateCompany(id: string, updates: Partial<Company>): Promise<Company>

updateCompanyStage(id: string): Promise<CompanyStage>
  // Classify stage based on: revenue, users, tasks completed, time since creation
  // Stages: early → validation → monetization → retention → scale → compounding
```

---

#### `src/lib/services/credit.service.ts`

```typescript
// Single source of truth for ALL credit mutations
// Uses admin client to write to credit_ledger (bypasses RLS)

getBalance(companyId: string): Promise<number>
  // Call Supabase RPC get_credit_balance(p_company_id)

deductCredit(input: {
  companyId: string;
  taskId: string;
  amount: number;          // almost always 1
  description: string;
}): Promise<CreditLedgerEntry>
  // 1. Get current balance
  // 2. Check balance >= amount (throw if insufficient)
  // 3. INSERT credit_ledger entry:
  //    entry_type: 'task_deduction'
  //    amount: -amount
  //    balance_after: currentBalance - amount
  //    task_id: taskId

addCredit(input: {
  companyId: string;
  entryType: 'monthly_grant' | 'welcome_bonus' | 'addon_purchase' | 'refund' | 'referral_bonus';
  amount: number;
  description: string;
  taskId?: string;
}): Promise<CreditLedgerEntry>
  // INSERT positive credit_ledger entry

getRecentLedger(companyId: string, limit?: number): Promise<CreditLedgerEntry[]>
  // Last N ledger entries for display

grantTrialCredits(companyId: string): Promise<void>
  // Add 10 credits with entry_type 'welcome_bonus'
```

---

#### `src/lib/services/task.service.ts`

```typescript
// Task CRUD + lifecycle transitions + queue management

createTask(input: {
  companyId: string;
  title: string;
  description?: string;
  tag: string;
  source: TaskSource;
  estimatedCredits?: number;   // default 1
  priority?: number;           // default 5
  complexity?: number;         // 1-10, planning metadata only
  suggestionReasoning?: string;
  executabilityType?: ExecutabilityType;
}): Promise<Task>
  // INSERT with status='created', queue_order=next available

listTasks(companyId: string, filters?: {
  status?: TaskStatus[];
}): Promise<Task[]>
  // SELECT with optional status filter
  // ORDER BY queue_order ASC NULLS LAST, created_at DESC

getTask(taskId: string): Promise<Task | null>

updateTask(taskId: string, updates: Partial<Task>): Promise<Task>

// ── Lifecycle Transitions ──
// Valid transitions:
//   created → todo (founder approves)
//   created → rejected (founder rejects)
//   todo → in_progress (execution starts — platform calls this, NOT agent)
//   in_progress → completed_verified | completed_unverified | failed | blocked | partial
//   blocked → todo (unblocked)

approveTask(taskId: string): Promise<Task>
  // created → todo
  // Validate current status is 'created'

rejectTask(taskId: string): Promise<Task>
  // created → rejected

startTask(taskId: string): Promise<Task>
  // todo → in_progress
  // 1. Validate status is 'todo'
  // 2. Call creditService.deductCredit() — 1 credit
  // 3. Set status='in_progress', started_at=now()
  // KEY: Credit deducted HERE, at start, not at completion
  // Failed tasks still consume their credit (no auto-refund)

completeTask(taskId: string, params: {
  verified: boolean;
}): Promise<Task>
  // in_progress → completed_verified or completed_unverified
  // Set completed_at=now()

failTask(taskId: string, params: {
  failureClass: FailureClass;
}): Promise<Task>
  // in_progress → failed
  // Set failure_class, completed_at=now()

reorderTasks(companyId: string, orderedTaskIds: string[]): Promise<void>
  // Batch update queue_order based on array position
```

---

#### `src/lib/services/document.service.ts`

```typescript
// Document CRUD + suggestion flow
// LOCKED DECISION #4: Core documents update via user-reviewed suggestions ONLY

listDocuments(companyId: string): Promise<Document[]>

getDocument(documentId: string): Promise<Document | null>

updateDocument(documentId: string, content: string): Promise<Document>
  // Direct edit by founder (always allowed)
  // Increment version, set is_empty=false if content provided

// ── Suggestion Flow ──
// Agents propose changes. Founder reviews: accept/edit/skip.

createSuggestion(input: {
  documentId: string;
  suggestedContent: string;
  suggestedBy: string;      // 'agent:engineering', 'agent:research', etc.
  reasoning: string;
}): Promise<DocumentSuggestion>

listPendingSuggestions(companyId: string): Promise<DocumentSuggestion[]>

reviewSuggestion(suggestionId: string, decision: {
  action: 'accept' | 'edit' | 'skip';
  editedContent?: string;   // only if action='edit'
}): Promise<void>
  // accept: apply suggestedContent to document, increment version
  // edit: apply editedContent to document, increment version
  // skip: mark suggestion as skipped
```

---

#### `src/lib/services/chat.service.ts`

```typescript
// Chat session management + message persistence

getOrCreateSession(companyId: string, userId: string): Promise<ChatSession>
  // Find active session or create new one

appendMessage(sessionId: string, message: ChatMessage): Promise<ChatSession>
  // Add message to messages JSONB array
  // Increment message_count
  // If message_count % 20 === 0: trigger memory L2 autosave (future)

getSessionHistory(sessionId: string): Promise<ChatMessage[]>

closeSession(sessionId: string): Promise<void>
  // Set is_active=false
```

---

#### `src/lib/services/memory.service.ts`

```typescript
// 3-layer memory system + learnings

// ── Memory Layers ──
// Layer 1: Domain Knowledge (15K tokens) — company-specific technical/business knowledge
// Layer 2: User & Company Preferences (3K tokens) — mission, preferences, context
// Layer 3: Cross-Company Patterns (15K tokens) — shared learnings across companies

getMemoryLayer(companyId: string, layer: 1 | 2 | 3): Promise<MemoryLayer>

updateMemoryLayer(companyId: string, layer: 1 | 2 | 3, content: string): Promise<void>
  // Update content, recalculate token_count
  // Trim if exceeds max_tokens (prioritize recent entries)

// ── Worker Memory Packet ──
// Assembled for injection into agent prompts (workers get this, not direct access)

getWorkerPacket(companyId: string, taskId: string): Promise<{
  layer2_summary: string;
  relevant_learnings: string[];
  recent_task_summaries: string[];
  prior_related_reports: string[];
}>
  // 1. Load Layer 2 content
  // 2. Query learnings WHERE company_id AND tags match task.tag, top 5 by recency
  // 3. Load last 3-5 task execution summaries (completed in last 30 days)
  // 4. If task.related_task_ids exist, fetch reports for those tasks

// ── CEO Memory Access (direct read/write) ──

getCEOContext(companyId: string): Promise<{
  layer1: string;
  layer2: string;
  layer3: string;
  recentLearnings: Learning[];
}>

// ── Learnings CRUD ──

createLearning(input: {
  companyId: string;
  content: string;
  tags: string[];
  category: string;
  confidence: 'high' | 'medium' | 'low';
  sourceTaskId?: string;
}): Promise<Learning>

searchLearnings(companyId: string, query: {
  tags?: string[];
  category?: string;
  limit?: number;
}): Promise<Learning[]>
```

---

#### `src/lib/services/event.service.ts`

```typescript
// Platform event persistence + queries
// Real-time pub/sub comes in Phase 5 (Upstash Redis)

createEvent(event: {
  type: string;
  companyId: string;
  payload: Record<string, unknown>;
  isPublicSafe: boolean;
}): Promise<PlatformEvent>
  // INSERT into platform_events table

getCompanyEvents(companyId: string, limit?: number): Promise<PlatformEvent[]>
  // Recent events for a company

getPublicEvents(limit?: number): Promise<PlatformEvent[]>
  // Events where is_public_safe=true (for live wall)
```

### 3.3 — API Routes

**11 route files** in `src/app/api/`.

---

#### `src/app/api/onboarding/route.ts` — POST

```typescript
// Receives onboarding form submission
// Creates company + grants trial credits + creates starter tasks

Request:  { journey: OnboardingJourney, idea?: string, business_url?: string }
Response: { company_id: string, redirect_url: string }

Flow:
  1. Get authenticated user from middleware
  2. Call companyService.createCompany({ owner_id, name: 'New Company', journey })
  3. Call creditService.grantTrialCredits(company.id) — 10 credits
  4. Generate company name (for now: use idea or 'My Company')
  5. Create 3 starter tasks per journey template:
     - surprise_me: "Research market opportunity", "Build landing page", "Launch social presence"
     - build_my_idea: "Research [idea] market", "Build [idea] MVP", "Create growth plan"
     - grow_my_company: "Analyze [url]", "Optimize digital presence", "Expand reach"
  6. Set onboarding_status='completed'
  7. Return { company_id, redirect_url: `/dashboard/${company.id}` }
```

---

#### `src/app/api/chat/route.ts` — POST

```typescript
// CEO chat endpoint — mock response for Phase 3 (real Claude in Phase 4)

Request:  { company_id: string, message: string }
Response: ReadableStream (SSE) with ChatMessage

Flow:
  1. Validate auth
  2. Get or create chat session
  3. Append user message
  4. Generate mock CEO response based on message content:
     - Mentions "task"/"build"/"create" → respond with task suggestion
     - Mentions "credit"/"balance" → respond with credit info
     - Mentions "document"/"doc" → respond with document list
     - Default → friendly CEO greeting with company context
  5. Append assistant message
  6. Return streamed response
```

---

#### `src/app/api/tasks/route.ts` — GET, POST

```typescript
GET:  List tasks for company
  Query: ?company_id=xxx&status=todo,in_progress
  Response: Task[]

POST: Create a new task
  Body: { company_id, title, description?, tag, source?, priority? }
  Response: Task
```

---

#### `src/app/api/tasks/[taskId]/route.ts` — GET, PATCH

```typescript
GET:   Task detail with full metadata
PATCH: Update task fields (title, description, priority, queue_order)
```

---

#### `src/app/api/tasks/[taskId]/approve/route.ts` — POST

```typescript
// Founder approves a CEO-suggested task
// Moves from created → todo
```

---

#### `src/app/api/tasks/[taskId]/reject/route.ts` — POST

```typescript
// Founder rejects a task
// Moves from created → rejected
```

---

#### `src/app/api/documents/route.ts` — GET

```typescript
// List documents for company
GET: ?company_id=xxx
Response: Document[]
```

---

#### `src/app/api/documents/[documentId]/route.ts` — GET, PATCH

```typescript
GET:   Document detail with content
PATCH: Direct edit by founder — { content: string }
```

---

#### `src/app/api/documents/suggestions/route.ts` — GET, POST

```typescript
GET:  List pending suggestions for company
POST: Review suggestion — { suggestion_id, action: 'accept'|'edit'|'skip', edited_content? }
```

---

#### `src/app/api/credits/route.ts` — GET

```typescript
// Balance + recent ledger entries
GET: ?company_id=xxx
Response: { balance: number, recent: CreditLedgerEntry[] }
```

---

#### `src/app/api/webhooks/stripe/route.ts` — POST

```typescript
// Stub — logs webhook events
// Real implementation in Phase 5
```

### 3.4 — Validation Schemas

**File**: `src/lib/validations/index.ts`

```typescript
// Zod schemas for all API request bodies
import { z } from 'zod';

export const onboardingSchema = z.object({
  journey: z.enum(['surprise_me', 'build_my_idea', 'grow_my_company']),
  idea: z.string().max(500).optional(),
  business_url: z.string().url().optional(),
});

export const chatMessageSchema = z.object({
  company_id: z.string().uuid(),
  message: z.string().min(1).max(5000),
});

export const createTaskSchema = z.object({
  company_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  tag: z.string().min(1).max(50),
  source: z.enum(['founder_requested', 'ceo_suggested', 'night_shift_generated',
                   'auto_remediation', 'recurring', 'onboarding']).optional(),
  priority: z.number().min(1).max(10).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  priority: z.number().min(1).max(10).optional(),
  queue_order: z.number().optional(),
});

export const updateDocumentSchema = z.object({
  content: z.string(),
});

export const reviewSuggestionSchema = z.object({
  suggestion_id: z.string().uuid(),
  action: z.enum(['accept', 'edit', 'skip']),
  edited_content: z.string().optional(),
});
```

### Phase 3 Test Criteria
- [ ] Create company via onboarding → see in dashboard with 10 credits
- [ ] Task CRUD: create, list, update, approve, reject
- [ ] Credit balance reflects initial grant and deductions
- [ ] Mock chat sends message and receives response
- [ ] Document list shows 5 core document slots

---

## PHASE 4: CEO Chat & Governance Engine

**Goal**: Real Claude-powered CEO chat. Task proposals with credit quotes.

### 4.1 — Chat UI Components

**5 files** in `src/components/chat/`:

#### `ChatPanel.tsx`
- Right-column chat interface
- Message list with auto-scroll
- Input area with send button
- Streaming response display (SSE)
- Typing indicator while assistant responds

#### `ChatMessage.tsx`
- Renders user and assistant messages
- Assistant messages support structured actions:
  - TaskProposalCard (approve/reject buttons)
  - CreditQuoteCard (cost display)
  - Split suggestion (multiple sub-tasks)
  - Blocker notification

#### `ChatInput.tsx`
- Text input with send button
- Shift+Enter for newline
- Disabled while streaming
- Character count hint

#### `TaskProposalCard.tsx`
- Inline card showing: title, description, estimated credits, execution mode, verification level
- Approve / Reject buttons that call `/api/tasks/[id]/approve` and `/api/tasks/[id]/reject`

#### `CreditQuoteCard.tsx`
- Shows credit cost before execution
- Current balance vs cost
- Warning if insufficient credits

### 4.2 — CEO Agent

**3 files** in `src/lib/agents/ceo/`:

#### `ceo.agent.ts`
```typescript
// CEO/Chat agent — founder-facing brain
// Uses Anthropic SDK with Claude Sonnet 4
// Reactive (no turn limit, responds per message)

import Anthropic from '@anthropic-ai/sdk';

export async function* streamCEOResponse(input: {
  companyId: string;
  message: string;
  sessionHistory: ChatMessage[];
}): AsyncGenerator<string>

  // 1. Assemble system prompt via ceo.prompt.ts
  // 2. Build messages array from session history
  // 3. Call anthropic.messages.stream() with tools from ceo.tools.ts
  // 4. Handle tool_use blocks:
  //    - propose_task → call governance engine → return TaskProposal action
  //    - get_credit_balance → call credit service
  //    - read_memory → call memory service
  //    - etc.
  // 5. Yield text tokens as they arrive
  // 6. Return final message with any embedded actions
```

#### `ceo.prompt.ts`
```typescript
// System prompt assembly for CEO

export async function assembleCEOPrompt(companyId: string): Promise<string>
  // Concatenates (in this order):
  // 1. Base CEO personality + role definition
  // 2. Company context (name, one_liner, stage, lifecycle)
  // 3. Memory (all 3 layers for CEO)
  // 4. Available documents (titles + types of non-empty docs)
  // 5. Current task queue state (count by status)
  // 6. Credit balance
  // 7. Behavioral rules:
  //    - Never execute without founder approval
  //    - Always quote credits before proposing tasks
  //    - Push back if insufficient credits
  //    - Decompose bundled features
  //    - Use founder-safe language
```

#### `ceo.tools.ts`
```typescript
// Tool definitions for CEO agent
// Phase 4 MVP: 8 core tools implemented, rest stubbed

export const CEO_TOOLS: Anthropic.Tool[] = [
  // ── IMPLEMENTED (Phase 4) ──
  {
    name: 'propose_task',
    description: 'Propose a new task for the company. Runs governance engine for sizing/quoting.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        tag: { type: 'string' },
      },
      required: ['title', 'description', 'tag'],
    },
  },
  // get_task_queue — returns current tasks by status
  // get_credit_balance — returns balance + recent ledger
  // read_memory — read from memory layer 1, 2, or 3
  // write_memory — write to memory layer 1 or 2
  // get_documents — list available documents
  // search_learnings — search by tags/content
  // explain_task_status — detailed status of a specific task

  // ── STUBBED (returns "not yet available") ──
  // approve_task, reject_task, split_task (Phase 5)
  // brave_web_search, brave_local_search, etc. (Phase 6)
  // get_agent_status, get_night_shift_plan, etc. (Phase 7)
  // ~36 more tools...
];

export async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  companyId: string
): Promise<unknown>
```

### 4.3 — Governance Engine

**File**: `src/lib/services/governance.service.ts`

```typescript
// Uses Claude Haiku 4.5 for fast classification
// Takes task description → returns GovernanceDecision

export async function evaluateTask(input: {
  title: string;
  description: string;
  tag: string;
  companyId: string;
}): Promise<GovernanceDecision>

// GovernanceDecision contains:
{
  verdict: 'approved' | 'split_required' | 'blocked' | 'refused',
  execution_mode: 'deterministic' | 'template_plus_params' | 'full_agent',
  estimated_credits: number,        // almost always 1
  verification_level: VerificationLevel,
  split_tasks?: Partial<Task>[],    // if split_required
  blocker_reason?: string,          // if blocked
  refund_policy: 'auto_eligible' | 'manual_review' | 'no_refund',
  founder_safe_explanation: string, // plain English for chat
}

// Classification Logic (via Haiku 4.5):
//
// 1. EXECUTION MODE:
//    - Tag in [crud, admin, config, seo-meta] → deterministic
//    - Tag in [landing-page, auth, payment, api] → template_plus_params
//    - Tag in [mvp, complex-feature, integration] → full_agent
//
// 2. VERIFICATION LEVEL:
//    - Backend/API tasks → deterministic (DB + API assertions)
//    - UI/product tasks → browser_flow or hybrid
//    - Content/copy tasks → quality_review
//    - Low-risk internal → none
//
// 3. SPLIT DETECTION:
//    - Multiple features mentioned → split_required
//    - Mixed work types (frontend + backend + content) → split_required
//    - More than 3 deliverables → split_required
//
// 4. PREREQUISITE CHECK:
//    - Needs OAuth connection not yet set up → blocked
//    - Needs infrastructure not provisioned → blocked
//
// 5. REFUND POLICY:
//    - All tasks default to 'auto_eligible' unless tag is 'external-api'
//    - External API tasks → 'no_refund'
```

### 4.4 — Router Service

**File**: `src/lib/services/router.service.ts`

```typescript
// Maps task tags to agent IDs

export function routeTask(tag: string): number
  // Tag → Agent mapping:
  //   engineering, build, deploy, fix, api, auth, payment, landing-page, crud → 30 (Engineering)
  //   browse, screenshot, form-fill, verify-site, account-setup → 42 (Browser)
  //   research, market-analysis, competitor, trend → 29 (Research)
  //   analytics, sql, metrics, dashboard-data, report → 33 (Data)
  //   support, email-reply, customer, escalation → 32 (Support)
  //   tweet, social, twitter → 40 (Twitter)
  //   meta-ads, facebook-ads, instagram-ads, ad-campaign → 41 (MetaAds)
  //   outreach, cold-email, lead-gen, prospecting → 54 (ColdOutreach)
  //   default → 30 (Engineering)
```

### 4.5 — Streaming Chat API (Replace Mock)

**File**: `src/app/api/chat/route.ts` — rewrite

```typescript
// Replace mock with real CEO agent streaming

POST handler:
  1. Validate auth + parse body
  2. Get or create chat session
  3. Append user message
  4. Call streamCEOResponse() from ceo.agent.ts
  5. Return ReadableStream that:
     - Yields text tokens as SSE events
     - Yields structured action events (task proposals, credit quotes)
     - Appends final assistant message to session
```

### Phase 4 Test Criteria
- [ ] Chat with CEO, get natural language response
- [ ] Ask "build a landing page" → get task proposal with credit quote
- [ ] Approve proposal → appears in task board as 'todo'
- [ ] Ask for complex feature → CEO splits into sub-tasks
- [ ] CEO accurately reports credit balance
- [ ] CEO refuses tasks needing unavailable connections

---

## PHASE 5: Task Execution Engine & Billing

**Goal**: Tasks actually execute. Credits deducted. Reports generated. Stripe works.

### 5.1 — Agent Factory

**3 files** in `src/lib/agents/factory/`:

#### `agent.factory.ts`
```typescript
// Given agent_id + task_id → returns configured agent instance

export async function createAgentInstance(agentId: number, taskId: string): Promise<{
  systemPrompt: string;
  tools: Anthropic.Tool[];
  model: string;
  maxTurns: number;
}>
  // 1. Load agent record from agents table
  // 2. Load task record
  // 3. Load company record via task.company_id
  // 4. Assemble prompt via prompt.assembler.ts
  // 5. Resolve tools via tool.registry.ts
  // 6. Return configured instance
```

#### `prompt.assembler.ts`
```typescript
// The assembleAgentPrompt() function
// 10-step assembly (order critical for context window):

export async function assembleAgentPrompt(
  agent: Agent,
  task: Task,
  company: Company,
  briefing: CompiledBriefing
): Promise<string>
  // 1. Load base_system_prompt from agent record
  // 2. Template variable injection:
  //    {{company_name}} → company.name
  //    {{current_date}} → ISO date
  //    {{cycles_completed}} → count of completed tasks
  //    {{company_slug}} → company.slug
  // 3. Append company context block
  // 4. Append memory packet (layer2_summary + learnings + task summaries)
  // 5. Append prior related reports (if task.related_task_ids exist)
  // 6. Append known issues (from failure_fingerprints for this task.tag)
  // 7. Append task briefing (title + description)
  // 8. Append mode-specific instructions:
  //    deterministic: "Follow template exactly. No creative interpretation."
  //    template_plus_params: (standard)
  //    full_agent: (standard)
  // 9. Append skill files (Engineering agent only)
  // 10. Append instance context (Engineering/Data only: stack, schema, logs, code chunks)
```

#### `tool.registry.ts`
```typescript
// Reads MCP tables, resolves tool surface, filters phantom mounts

export async function resolveToolSurface(agentId: number): Promise<Anthropic.Tool[]>
  // 1. Query agent_tool_mounts WHERE agent_id = agentId
  // 2. For each mount, check mcp_servers.is_available = true
  // 3. FILTER OUT phantom mounts (memory, skills, stripe, gmail)
  // 4. Check requires_oauth — skip if OAuth token missing
  // 5. Load mcp_tools for each available server
  // 6. Convert to Anthropic.Tool[] format
  // 7. Return tool surface array
```

### 5.2 — Worker Launcher

**4 files** in `src/lib/agents/worker/`:

#### `worker.launcher.ts`
```typescript
// Core execution loop — PLATFORM manages lifecycle (Baljia improvement)

export async function executeTask(taskId: string): Promise<TaskExecution>

  // PLATFORM STEP 1: Load task, verify status is 'todo'
  const task = await taskService.getTask(taskId);
  if (task.status !== 'todo') throw new Error('Task not in todo state');

  // PLATFORM STEP 2: Deduct credit
  await creditService.deductCredit({
    companyId: task.company_id,
    taskId: task.id,
    amount: 1,
    description: `Task: ${task.title}`,
  });

  // PLATFORM STEP 3: Set in_progress
  await taskService.startTask(taskId);

  // PLATFORM STEP 4: Compile briefing
  const briefing = await compileBriefing(task);

  // PLATFORM STEP 5: Create agent instance
  const agentId = task.assigned_to_agent_id ?? routeTask(task.tag);
  const instance = await agentFactory.createAgentInstance(agentId, taskId);

  // PLATFORM STEP 6: Execute agent
  const result = await runAgent(instance, briefing, task);

  // PLATFORM STEP 7: Capture report
  const report = await createReport(task, result);

  // PLATFORM STEP 8: Run verification (stub for now → real in Phase 7)
  const verified = await verify(task, result);

  // PLATFORM STEP 9: Set final status
  if (verified) {
    await taskService.completeTask(taskId, { verified: true });
  } else {
    await taskService.failTask(taskId, { failureClass: 'worker_failure' });
  }

  // PLATFORM STEP 10: Create execution record
  const execution = await createExecution(task, result, report);

  // PLATFORM STEP 11: Emit events
  await eventService.createEvent({
    type: verified ? 'task_completed' : 'task_failed',
    companyId: task.company_id,
    payload: { taskId, reportId: report.id },
    isPublicSafe: true,
  });

  return execution;
```

#### `compiled.briefing.ts`
```typescript
// Assembles CompiledBriefing for agent prompt injection

export async function compileBriefing(task: Task): Promise<CompiledBriefing>
  // Returns:
  // {
  //   task: full task object,
  //   company_context: { name, slug, one_liner, stage },
  //   memory_packet: from memoryService.getWorkerPacket(),
  //   template_vars: { company_name, current_date, cycles_completed, company_slug },
  //   tool_surface: string[] of available tool names,
  //   skill_files: string[] (engineering only),
  //   instance_context: { stack, schema_summary, recent_logs, relevant_code_chunks, known_issues }
  // }
```

#### `execution.logger.ts`
```typescript
// Captures structured execution log for founder transparency

export class ExecutionLogger {
  private log: ExecutionStep[] = [];

  addStep(step: { tool: string; action: string; result: string }): void
  getLog(): ExecutionStep[]
  getSummary(): string   // 3-5 sentence summary for reports
}
```

#### `watchdog.ts`
```typescript
// Detects stuck agent runs

export class Watchdog {
  constructor(taskId: string, maxIdleSeconds: number)

  recordProgress(tool: string): void
  isStuck(): boolean
  getEvents(): WatchdogEvent[]
  kill(): void
}
```

### 5.3 — Engineering Agent

**2 files** in `src/lib/agents/engineering/`:

#### `engineering.agent.ts`
```typescript
// Engineering agent — Claude Sonnet 4, 200 turns, 3 execution modes

export async function runEngineeringAgent(
  instance: AgentInstance,
  briefing: CompiledBriefing,
  task: Task
): Promise<AgentResult>

  // Mode routing:
  if (task.execution_mode === 'deterministic') {
    return runDeterministic(task, briefing);
    // Predefined sequence, no LLM calls
    // Used for: CRUD ops, admin tables, config changes, SEO meta
  }
  else if (task.execution_mode === 'template_plus_params') {
    return runTemplateMode(task, briefing);
    // Load template, use Haiku to fill parameters
    // Used for: landing pages, auth flows, standard patterns
  }
  else {
    return runFullAgent(instance, briefing, task);
    // Full Claude Sonnet 4 agentic loop, 200 turns
    // Used for: novel features, complex integrations, ambiguous work
  }
```

#### `engineering.tools.ts`
```typescript
// Platform infrastructure tools for Engineering agent

// Neon DB tools:
//   query_db(sql) — run SQL on company Neon database
//   get_schema() — get current DB schema

// GitHub tools:
//   read_file(path) — read file from repo
//   write_file(path, content) — write file to repo
//   create_branch(name) — create feature branch
//   create_commit(files, message) — commit changes
//   create_pr(title, body) — open pull request

// Render tools:
//   deploy_service() — trigger deployment
//   get_service_status() — check deployment status
//   get_logs(lines) — recent deployment logs
```

### 5.4 — Event Bus

**2 files** in `src/lib/events/`:

#### `event-bus.ts`
```typescript
// Upstash Redis pub/sub wrapper
// Dual-write: Redis (real-time) + platform_events table (persistence)

import { Redis } from '@upstash/redis';

export async function publish(event: PlatformEvent): Promise<void>
  // 1. Write to platform_events table (persistence)
  // 2. Publish to Redis channel (real-time)

export async function subscribe(
  channel: string,
  handler: (event: PlatformEvent) => void
): Promise<void>
```

#### `channels.ts`
```typescript
// Channel definitions
export const CHANNELS = {
  companyTasks: (id: string) => `company:${id}:tasks`,
  companyChat: (id: string) => `company:${id}:chat`,
  companyEvents: (id: string) => `company:${id}:events`,
  platformLive: 'platform:live',
} as const;
```

### 5.5 — Billing

**File**: `src/lib/services/billing.service.ts`

```typescript
import Stripe from 'stripe';

// Stripe customer creation
createStripeCustomer(userId: string, email: string): Promise<string>

// Subscription management
createSubscription(companyId: string, planTier: PlanTier): Promise<Subscription>
cancelSubscription(companyId: string): Promise<void>

// Credit purchase
createCreditCheckout(companyId: string, creditPack: CreditPack): Promise<string>
  // Returns Stripe Checkout URL
  // Packs: 15/$19, 25/$29, 50/$49, 100/$99, 200/$199, 500/$499, 1000/$999

// Trial management
activateTrial(companyId: string): Promise<void>
  // Set plan_tier='trial', billing_state='trial'
  // Grant 10 credits, 3 night shifts

// Webhook processing
handleWebhookEvent(event: Stripe.Event): Promise<void>
  // checkout.session.completed → activate subscription / add credits
  // invoice.paid → renew monthly credits
  // invoice.payment_failed → set billing_state='past_due'
  // customer.subscription.deleted → set billing_state='cancelled'
```

**API Routes**:
- `src/app/api/webhooks/stripe/route.ts` — real webhook handler
- `src/app/api/billing/route.ts` — GET status, POST create checkout
- `src/app/api/tasks/[taskId]/execute/route.ts` — trigger task execution

### 5.6 — Neon Integration

**File**: `src/lib/services/neon.service.ts`

```typescript
// Programmatic Neon database provisioning for founder companies

createDatabase(companyId: string, companySlug: string): Promise<{
  databaseId: string;
  connectionString: string;
}>

getConnectionString(companyId: string): Promise<string>

executeQuery(companyId: string, sql: string): Promise<unknown>

deleteDatabase(companyId: string): Promise<void>
```

### Phase 5 Test Criteria
- [ ] Approve task → credits deducted → status moves to in_progress
- [ ] Engineering agent executes simple task (e.g., "add about page")
- [ ] Report appears after task completion
- [ ] Execution log visible in TaskDetailDialog
- [ ] Watchdog detects stuck run (simulate with timeout)
- [ ] Stripe webhook processes test subscription
- [ ] Credit purchase flow works
- [ ] Event bus publishes task_completed events

---

## PHASE 6: Onboarding Pipeline & Additional Agents

**Goal**: Real enrichment-based onboarding. Research, Browser, Data, Support agents.

### 6.1 — Onboarding Pipeline

**File**: `src/lib/services/onboarding.service.ts`

```typescript
// 16-stage Sapiom-style async pipeline

export async function runOnboardingPipeline(input: OnboardingInput): Promise<void>

// Stage 1: HEARTBEAT — confirm sandbox alive
// Stage 2: ENRICH_FOUNDER — Tavily search on founder email/name/twitter
// Stage 3: ENRICH_BUSINESS — Tavily search on business URL (grow_my_company only)
// Stage 4: PERSIST_CONTEXT — save enrichment to user record + memory
// Stage 5: SELECT_STRATEGY — 3-tier decision:
//   - Strong person match → personalize_around_person
//   - Weak person + strong business URL → personalize_around_business
//   - Weak both → bounded_bucket_fallback (5 abstract shapes × 12 categories)
// Stage 6: NAME_COMPANY — LLM-generated name via Haiku 4.5, slug via slug.ts
// Stage 7: GENERATE_MARKET_RESEARCH — Research-style synthesis, save to reports
// Stage 8: PROVISION_INFRASTRUCTURE — Neon DB + GitHub repo + Render service + subdomain + email
// Stage 9: CREATE_LANDING_PAGE — Engineering agent deterministic mode
// Stage 10: SAVE_MISSION — Generate 5 core documents (mission, product_overview, tech_notes, brand_voice, user_research)
// Stage 11: SEND_COMMUNICATIONS — Welcome email via Postmark
// Stage 12: CREATE_STARTER_TASKS — Per-journey templates with dependency chain (Research → Build → Growth)
// Stage 13: GENERATE_MAGIC_LINK — Dashboard access link
// Stage 14: SEND_ACTIVATION — Email with dashboard link
// Stage 15: FLUSH_DIAGNOSTICS — Save telemetry to platform_events
// Stage 16: CELEBRATE — Set onboarding_status='completed', emit event
```

### 6.2 — Onboarding UI

**2 files** in `src/components/onboarding/`:

- `OnboardingProgress.tsx` — real-time stage tracker with terminal-style log
- `OnboardingStageIndicator.tsx` — per-stage indicator (pending/running/done/failed)

### 6.3 — New Agents

Each agent has 2 files: `{name}.agent.ts` + `{name}.tools.ts`

#### Research Agent (`src/lib/agents/research/`)
- Structured, 200 turns, Claude Sonnet 4
- Tools: Tavily search (read-only web), report creation, task completion
- Produces structured reports: target market, size, competitors, strategy
- Must provide citations or state "insufficient evidence"

#### Browser Agent (`src/lib/agents/browser/`)
- Structured, 200 turns
- Tools: Browserbase (9 tools), browser_auth (11 tools), company_email (5)
- 3-tier site system enforcement via get_site_tier()
- One task = one browser session, max ~4 hours
- Credential management: company-scoped → per-site → persistent contexts

#### Data Agent (`src/lib/agents/data/`)
- Structured, 200 turns
- Tools: Neon query execution, analytics helpers
- SQL queries against company Neon DB, metrics aggregation, log analysis
- Must distinguish correlation vs causation, note data limitations

#### Support Agent (`src/lib/agents/support/`)
- Structured, 200 turns
- Tools: Postmark email (5), conditional gmail, tasks, reports
- Email-first: plain-text, match incoming length, independent judgment
- Escalation: technical → Engineering task; billing/security → message owner

### 6.4 — External Integrations

- `src/lib/services/tavily.service.ts` — Tavily API wrapper for read-only web search
- `src/lib/services/email.service.ts` — Postmark transactional email (welcome, activation, summaries)

### Phase 6 Test Criteria
- [ ] Full "Surprise Me" onboarding: enrichment → name → research → landing page → starter tasks
- [ ] "Build My Idea" with custom idea input
- [ ] "Grow My Company" with business URL enrichment
- [ ] Research agent uses Tavily for web research
- [ ] Browser agent navigates URL and takes screenshot
- [ ] Support agent sends email reply via Postmark
- [ ] Onboarding progress UI shows real-time stages

---

## PHASE 7: Advanced Features

**Goal**: Night shifts, verification, growth agents, live wall.

### 7.1 — Verification Service

**File**: `src/lib/services/verification.service.ts`

```typescript
// 5 verification levels
// KEY RULE: Verifier sets final status, NOT the worker

export async function verify(task: Task, result: AgentResult): Promise<VerificationResult>

// Level 1: none → pass-through, mark completed_unverified
// Level 2: deterministic → API/DB/log/deploy assertions
//   - Check expected DB rows exist
//   - Check API endpoints respond with 200
//   - Check deploy logs show no errors
//   - Check expected files exist in repo
// Level 3: browser_flow → dispatch Browser agent to validate UI
//   - Navigate to deployed URL
//   - Screenshot key pages
//   - DOM assertions (element exists, text matches)
//   - Form submission tests
// Level 4: quality_review → LLM rubric judgment (Haiku 4.5)
//   - Score content against quality rubric
//   - Check brand voice compliance
//   - Verify factual accuracy where possible
// Level 5: hybrid → deterministic + browser + quality

// Evidence capture: screenshots, DOM assertions, API responses,
// DB assertions, deploy status, log summary, artifact URLs,
// quality scores → stored in task_executions.verification_evidence

// Repair loop:
// If verification fails AND turn_count < 80% of max_turns:
//   → call agent.repair(issues) → re-verify
//   → if re-verify passes → completed_verified
//   → if re-verify fails → failed + fingerprint
// If turn_count >= 80%: → failed + fingerprint
```

### 7.2 — Failure Learning

**File**: `src/lib/services/failure.service.ts`

```typescript
// 6-step closed loop

// Step 1: Capture failure evidence
// Step 2: Generate normalized fingerprint (lowercase, remove timestamps/UUIDs, hash)
// Step 3: Check failure_fingerprints registry
//   - Match → increment occurrence_count, update last_seen_at
//   - No match → create new entry
// Step 4: Emit event (task_failure_fingerprinted or known_issue_regression)
// Step 5: Track fix_status (open → investigating → fixed → wont_fix)
// Step 6: Feed back into night shift planner as knownIssues

// 5 failure categories: routing, tool_failure, timeout, scope, external
// 5 failure classes: founder_ambiguity, missing_prerequisite, platform_scoping, worker_failure, external_dependency
```

### 7.3 — Night Shift System

**File**: `src/lib/services/night-shift.service.ts`

```typescript
export async function executeNightShift(companyId: string): Promise<void>

  // 1. Gate check: ['active', 'trial'].includes(billing_state)
  // 2. Gate check: night_shifts_remaining > 0
  // 3. Classify company stage (early/validation/monetization/retention/scale/compounding)
  // 4. Calculate founder trust score
  // 5. Gather planning inputs:
  //    - Current queue, recent completions/failures
  //    - Document state, founder sentiment, known issues
  // 6. Generate prioritized task list:
  //    Priority: trust recovery → repair → regression prevention → roadmap
  //    Stage-specific objectives:
  //      early → "what is obviously missing?"
  //      validation → "what blocks activation?"
  //      monetization → "what blocks conversion?"
  //      retention → "what is underused or churn-inducing?"
  //      scale → "what channel is underperforming?"
  //      compounding → "what can be automated or defended?"
  // 7. Execute tasks
  // 8. Generate summary → deliver to CEO chat
  // 9. Deduct night shift

// Scheduler: cron via /api/cron/night-shift/route.ts
// Trial: 3 shifts. Full: 30/month.
```

### 7.4 — Growth Agents

| Agent | Dir | Style | Turns | Key Features |
|-------|-----|-------|-------|-------------|
| Twitter | `src/lib/agents/twitter/` | graph | 200 | post_tweet, get_twitter_account, documents access, brand voice rules, dedupe |
| MetaAds | `src/lib/agents/meta-ads/` | graph | 100 | 12 tools, Sora 2 video ads, $10/day test, 20% platform fee, moderation recovery |
| ColdOutreach | `src/lib/agents/cold-outreach/` | graph | 200 | company_email (5), hunter_io (2), documents access, ~2 emails/day, research-first |

### 7.5 — Recurring Tasks

**File**: `src/lib/services/recurring.service.ts`

```typescript
// Evaluate recurring_tasks table, create instances when next_run_at reached

export async function evaluateRecurringTasks(): Promise<void>
  // For each recurring task where next_run_at <= now():
  //   1. Create new task instance from template
  //   2. Calculate next_run_at based on cadence (daily/weekly/biweekly/monthly)
  //   3. Update recurring_tasks.next_run_at
```

### 7.6 — Live Operations Wall

- `src/app/(public)/live/page.tsx` — public, no auth required
- `src/components/live/LiveWall.tsx` — 3-column real-time event display
- `src/components/live/EventCard.tsx` — individual event card with redaction
- `src/app/api/events/live/route.ts` — SSE stream of public-safe events

### 7.7 — Referral System

- Track via `referral_code` on users table
- Award 25 credits on referred user's paid subscription
- `src/app/api/referrals/route.ts` — track and query status

### 7.8 — Document Suggestion Review UI

- `src/components/dashboard/DocumentSuggestionReview.tsx` — inline diff view with accept/edit/skip

### Phase 7 Test Criteria
- [ ] Night shift runs for trial company, generates tasks, delivers summary
- [ ] Deterministic verification catches a failed task (DB assertion)
- [ ] Browser verification screenshots and validates UI
- [ ] Failed task gets fingerprinted, appears in known issues
- [ ] Twitter agent composes and posts tweet
- [ ] MetaAds agent creates campaign with $10/day budget
- [ ] ColdOutreach sends verified email
- [ ] Live wall shows real-time events
- [ ] Recurring task fires on schedule
- [ ] Referral code generates and tracks
- [ ] Document suggestion review works end-to-end

---

## Complete File Tree (Final State)

```
baljia-ai/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx                          ✅ Built
│   │   │   ├── callback/route.ts                       ✅ Built
│   │   │   └── onboarding/page.tsx                     ✅ Built
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx                              ✅ Built
│   │   │   └── dashboard/[companyId]/page.tsx           ✅ Built
│   │   ├── (public)/
│   │   │   └── live/page.tsx                           Phase 7
│   │   ├── api/
│   │   │   ├── chat/route.ts                           Phase 3 (mock) → Phase 4 (real)
│   │   │   ├── tasks/route.ts                          Phase 3
│   │   │   ├── tasks/[taskId]/route.ts                 Phase 3
│   │   │   ├── tasks/[taskId]/approve/route.ts         Phase 3
│   │   │   ├── tasks/[taskId]/reject/route.ts          Phase 3
│   │   │   ├── tasks/[taskId]/execute/route.ts         Phase 5
│   │   │   ├── documents/route.ts                      Phase 3
│   │   │   ├── documents/[documentId]/route.ts         Phase 3
│   │   │   ├── documents/suggestions/route.ts          Phase 3
│   │   │   ├── credits/route.ts                        Phase 3
│   │   │   ├── billing/route.ts                        Phase 5
│   │   │   ├── onboarding/route.ts                     Phase 3
│   │   │   ├── events/live/route.ts                    Phase 7
│   │   │   ├── referrals/route.ts                      Phase 7
│   │   │   ├── cron/night-shift/route.ts               Phase 7
│   │   │   └── webhooks/stripe/route.ts                Phase 3 (stub) → Phase 5 (real)
│   │   ├── globals.css                                  ✅ Built
│   │   └── layout.tsx                                   ✅ Built
│   ├── components/
│   │   ├── ui/ (11 components)                          ✅ Built
│   │   ├── dashboard/ (8 components)                    ✅ Built
│   │   │   └── DocumentSuggestionReview.tsx             Phase 7
│   │   ├── chat/
│   │   │   ├── ChatPanel.tsx                            Phase 4
│   │   │   ├── ChatMessage.tsx                          Phase 4
│   │   │   ├── ChatInput.tsx                            Phase 4
│   │   │   ├── TaskProposalCard.tsx                     Phase 4
│   │   │   └── CreditQuoteCard.tsx                      Phase 4
│   │   ├── onboarding/
│   │   │   ├── OnboardingProgress.tsx                   Phase 6
│   │   │   └── OnboardingStageIndicator.tsx             Phase 6
│   │   ├── live/
│   │   │   ├── LiveWall.tsx                             Phase 7
│   │   │   └── EventCard.tsx                            Phase 7
│   │   └── mascot/BaljiaMascot.tsx                      ✅ Built
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── server.ts                                ✅ Built
│   │   │   ├── client.ts                                ✅ Built
│   │   │   └── admin.ts                                 Phase 3
│   │   ├── agents/
│   │   │   ├── ceo/
│   │   │   │   ├── ceo.agent.ts                         Phase 4
│   │   │   │   ├── ceo.prompt.ts                        Phase 4
│   │   │   │   └── ceo.tools.ts                         Phase 4
│   │   │   ├── factory/
│   │   │   │   ├── agent.factory.ts                     Phase 5
│   │   │   │   ├── prompt.assembler.ts                  Phase 5
│   │   │   │   └── tool.registry.ts                     Phase 5
│   │   │   ├── worker/
│   │   │   │   ├── worker.launcher.ts                   Phase 5
│   │   │   │   ├── compiled.briefing.ts                 Phase 5
│   │   │   │   ├── execution.logger.ts                  Phase 5
│   │   │   │   └── watchdog.ts                          Phase 5
│   │   │   ├── engineering/
│   │   │   │   ├── engineering.agent.ts                 Phase 5
│   │   │   │   └── engineering.tools.ts                 Phase 5
│   │   │   ├── research/
│   │   │   │   ├── research.agent.ts                    Phase 6
│   │   │   │   └── research.tools.ts                    Phase 6
│   │   │   ├── browser/
│   │   │   │   ├── browser.agent.ts                     Phase 6
│   │   │   │   └── browser.tools.ts                     Phase 6
│   │   │   ├── data/
│   │   │   │   ├── data.agent.ts                        Phase 6
│   │   │   │   └── data.tools.ts                        Phase 6
│   │   │   ├── support/
│   │   │   │   ├── support.agent.ts                     Phase 6
│   │   │   │   └── support.tools.ts                     Phase 6
│   │   │   ├── twitter/
│   │   │   │   ├── twitter.agent.ts                     Phase 7
│   │   │   │   └── twitter.tools.ts                     Phase 7
│   │   │   ├── meta-ads/
│   │   │   │   ├── meta-ads.agent.ts                    Phase 7
│   │   │   │   └── meta-ads.tools.ts                    Phase 7
│   │   │   └── cold-outreach/
│   │   │       ├── cold-outreach.agent.ts               Phase 7
│   │   │       └── cold-outreach.tools.ts               Phase 7
│   │   ├── services/
│   │   │   ├── company.service.ts                       Phase 3
│   │   │   ├── credit.service.ts                        Phase 3
│   │   │   ├── task.service.ts                          Phase 3
│   │   │   ├── document.service.ts                      Phase 3
│   │   │   ├── chat.service.ts                          Phase 3
│   │   │   ├── memory.service.ts                        Phase 3
│   │   │   ├── event.service.ts                         Phase 3
│   │   │   ├── governance.service.ts                    Phase 4
│   │   │   ├── router.service.ts                        Phase 4
│   │   │   ├── billing.service.ts                       Phase 5
│   │   │   ├── neon.service.ts                          Phase 5
│   │   │   ├── onboarding.service.ts                    Phase 6
│   │   │   ├── tavily.service.ts                        Phase 6
│   │   │   ├── email.service.ts                         Phase 6
│   │   │   ├── verification.service.ts                  Phase 7
│   │   │   ├── failure.service.ts                       Phase 7
│   │   │   ├── night-shift.service.ts                   Phase 7
│   │   │   └── recurring.service.ts                     Phase 7
│   │   ├── events/
│   │   │   ├── event-bus.ts                             Phase 5
│   │   │   └── channels.ts                              Phase 5
│   │   ├── validations/
│   │   │   └── index.ts                                 Phase 3
│   │   ├── slug.ts                                      ✅ Built
│   │   └── utils.ts                                     ✅ Built
│   └── types/
│       └── index.ts                                     ✅ Built
├── supabase/
│   └── migrations/
│       └── 00001_initial_schema.sql                     ✅ Built
├── docs/
│   ├── Baljia_Knowledge_Graph_v2.md                     ✅ Reference
│   ├── Baljia_Technical_Architecture_Spec_v2.md         ✅ Reference
│   ├── Baljia_Audit_Findings.md                         ✅ Reference
│   └── IMPLEMENTATION_ROADMAP.md                        This file
├── .env.example                                         ✅ Built
├── .env.local                                           ✅ Built (placeholders)
├── .gitignore                                           ✅ Built
├── postcss.config.mjs                                   ✅ Built
├── package.json                                         ✅ Built
├── package-lock.json                                    ✅ Built
├── tsconfig.json                                        ✅ Built
├── next.config.ts                                       ✅ Built
├── CLAUDE.md                                            ✅ Built
└── src/middleware.ts                                     ✅ Built
```

---

## Timeline Summary

| Phase | Name | Files | Duration | Milestone |
|-------|------|-------|----------|-----------|
| ~~1~~ | ~~Build Blockers~~ | ~~6~~ | ~~Done~~ | ~~Project compiles~~ |
| ~~2~~ | ~~UI Shell~~ | ~~20~~ | ~~Done~~ | ~~Dashboard renders~~ |
| 3 | API + Services | ~20 | 5-7 days | Data flows, mock chat |
| 4 | CEO Chat + Governance | ~10 | 7-10 days | Real AI chat |
| 5 | Execution + Billing | ~15 | 10-14 days | **Usable MVP** |
| 6 | Onboarding + Agents | ~12 | 10-14 days | Full onboarding, 4 agents |
| 7 | Advanced Features | ~15 | 14-21 days | **Production MVP** |
| **Total** | | **~80 files** | **~8-11 weeks** | |

---

## Critical Architecture Rules (Non-Negotiable)

1. **1 task = 1 credit**, deducted at `start_task` (todo → in_progress)
2. **Failed tasks consume their credit** — no auto-refund
3. **Verifier sets final status**, NOT the worker agent
4. **Documents update via user-reviewed suggestions ONLY** — no silent auto-update
5. **Platform manages worker lifecycle** — agent only does domain work
6. **Filter phantom mounts** (memory, skills, stripe, gmail) in tool resolution
7. **Document access is restricted** — only Twitter + ColdOutreach get `documents` MCP
8. **Trial gets night shifts** — check `['active', 'trial'].includes(billing_state)`
9. **Complexity (1-10) is planning metadata only** — doesn't affect credits/tools/runtime
10. **Free planning, paid execution** — chat, task creation, docs are always free
11. **Credits buy volume, not concurrency** — sequential execution per company
