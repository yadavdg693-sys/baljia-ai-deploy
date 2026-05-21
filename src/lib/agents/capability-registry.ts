import { getDomainPack as getDomainPackByIdLoose } from './domain-registry';
import { classifyPlanningDepth, type PlanningDepth } from './planning-depth';
import { classifyTaskIntent, type TaskIntent } from './task-intent';

export type CapabilityId =
  | 'auth'
  | 'roles'
  | 'crud'
  | 'dashboard'
  | 'payments_stripe'
  | 'uploads_storage'
  | 'email_notifications'
  | 'ai_openai'
  | 'rag_search'
  | 'search'
  | 'admin_workflow'
  | 'analytics'
  | 'realtime'
  | 'cron_jobs'
  | 'external_api'
  | 'marketplace'
  | 'booking'
  | 'deployment_render'
  // ── Deeper full-stack packs (additive — old IDs above must remain valid) ──
  | 'cart_orders_checkout'
  | 'coupons_tax_shipping'
  | 'payment_lifecycle'
  | 'stripe_webhooks'
  | 'teams_workspaces'
  | 'oauth_password_reset'
  | 'multi_tenant_isolation'
  | 'rich_text_cms'
  | 'import_export_csv'
  | 'audit_logs'
  | 'soft_delete_restore'
  | 'file_privacy_validation'
  | 'notification_preferences'
  | 'realtime_collaboration'
  | 'queue_workers'
  | 'long_running_ai_jobs'
  | 'ai_safety_cost_controls'
  | 'seo_public_pages'
  | 'security_ops'
  | 'rollback_backup_ops';

export type CapabilityPack = {
  id: CapabilityId;
  title: string;
  summary: string;
  whenNeeded: string[];
  signals: string[];
  requiredSkills: string[];
  requiredFiles: string[];
  envVars: string[];
  schemaPatterns: string[];
  apiPatterns: string[];
  uiPatterns: string[];
  verificationRequirements: string[];
  commonFailures: string[];
  verticalSlice: string[];
};

export type MatchedCapability = {
  id: CapabilityId;
  title: string;
  score: number;
  requirement: 'required' | 'optional';
  reasons: string[];
  requiredSkills: string[];
  verificationRequirements: string[];
};

export type CapabilityPlanInput = {
  title?: string;
  description?: string | null;
  productContext?: string | null;
  actors?: string[];
  workflows?: string[];
  entities?: string[];
  capabilities?: string[];
  designSystem?: string | null;
  referencePatterns?: string[];
  existingCodebaseHints?: string[];
  knownIssueHints?: string[];
  previousLearnings?: string[];
  taskIntent?: TaskIntent | null;
  taskIntentLane?: 'build' | 'extend' | 'repair' | 'verify' | null;
  planningDepth?: PlanningDepth | null;
  /**
   * Optional domain context from match_domain_app. When supplied, the matcher
   * boosts capabilities listed in each domain's requiredCapabilities so a
   * clearly-shaped product (e.g. ecommerce_store) doesn't collapse to a
   * generic crud+dashboard fallback just because keyword signals are sparse.
   * Old callers that omit `domains` keep the original signal-only behavior.
   */
  domains?: string[];
};

export type CapabilityArchitecturePlan = {
  appSummary: string;
  actors: string[];
  workflows: string[];
  entities: string[];
  capabilities: CapabilityId[];
  integrations: string[];
  pages: string[];
  apiRoutes: string[];
  databaseTables: string[];
  designSystem?: string | null;
  referencePatterns: string[];
  hybridRetrieval: {
    sources: string[];
    decisions: string[];
  };
  verticalSlices: Array<{
    capability: CapabilityId;
    steps: string[];
  }>;
  verificationJourneys: Array<{
    name: string;
    covers: CapabilityId[];
    steps: string[];
  }>;

  // ── New (Section 6 of the world-class goal — extended fields, additive) ──
  /** Domain IDs supplied by match_domain_app and used to compose this plan. */
  domains: string[];
  /** Per-API-route contract: method, path, purpose, request/response shape,
   *  status codes, auth/role expectation, DB read/write expectation, failure cases. */
  apiContracts: ApiContract[];
  /** Assertions to feed verify_db_state — one entry per write the plan creates. */
  dbStateChecks: DbStateCheck[];
  /** Per-page browser UI checks — required_text, required_buttons, form_submission_checks. */
  browserUiChecks: BrowserUiCheck[];
  /** Compact summary of the matching frontend plan (pattern ids + page count). */
  frontendPlanSummary?: {
    uiType: string;
    patternIds: string[];
    pages: string[];
  };
};

export type ApiContract = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  purpose: string;
  capability: CapabilityId;
  request: string;
  response: string;
  statusCodes: number[];
  auth: 'public' | 'authenticated' | 'role-required' | 'webhook-signed';
  dbExpectation: string;
  failureCases: string[];
};

export type DbStateCheck = {
  name: string;
  table: string;
  expects: string;
  triggeredBy: string;
};

export type BrowserUiCheck = {
  pagePath: string;
  required_text: string[];
  required_buttons: string[];
  form_submission_checks: string[];
};

export const CAPABILITY_PACKS: CapabilityPack[] = [
  {
    id: 'auth',
    title: 'Authentication',
    summary: 'User signup, login, sessions, protected routes, and account identity.',
    whenNeeded: ['Users need accounts', 'private dashboards', 'member portals', 'client portals'],
    signals: ['auth', 'login', 'sign up', 'signup', 'register', 'session', 'account', 'member', 'client portal', 'password', 'oauth'],
    requiredSkills: ['auth-sessions', 'neon-postgres', 'verify-deploy'],
    requiredFiles: ['auth config', 'protected route middleware', 'login/register pages or server actions'],
    envVars: ['BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'],
    schemaPatterns: ['users table', 'sessions/accounts table when the skeleton requires it'],
    apiPatterns: ['register/login/logout route or Better Auth handlers', 'session guard helper'],
    uiPatterns: ['clear auth state', 'error states for invalid credentials', 'account menu'],
    verificationRequirements: ['register or login journey', 'protected route denies anonymous access', 'session persists across requests'],
    commonFailures: ['missing auth URL on Render', 'cookie secure flag mismatch', 'login returns 302 while insert failed'],
    verticalSlice: ['schema/auth config', 'auth routes', 'login/register UI', 'protected route verification'],
  },
  {
    id: 'roles',
    title: 'Roles And Permissions',
    summary: 'Role-based access for admins, vendors, customers, teams, or operators.',
    whenNeeded: ['Different actor types need different permissions', 'admin-only workflows'],
    signals: ['role', 'roles', 'permission', 'admin', 'vendor', 'teacher', 'student', 'customer', 'operator', 'approve', 'moderator'],
    requiredSkills: ['auth-sessions', 'neon-postgres'],
    requiredFiles: ['role field or memberships table', 'authorization helper', 'admin route guards'],
    envVars: [],
    schemaPatterns: ['role enum', 'memberships table', 'organization_id foreign key'],
    apiPatterns: ['authorize before mutation', 'return 403 for forbidden role'],
    uiPatterns: ['role-aware navigation', 'admin-only controls hidden from normal users'],
    verificationRequirements: ['admin can perform restricted action', 'non-admin receives 403 or redirect'],
    commonFailures: ['UI hides button but API lacks server-side authorization'],
    verticalSlice: ['role schema', 'server-side guard', 'role-specific UI', 'forbidden-access journey'],
  },
  {
    id: 'crud',
    title: 'CRUD And Data Management',
    summary: 'Create, read, update, delete, and list domain records.',
    whenNeeded: ['The task mentions records, objects, submissions, listings, leads, items, or workflows'],
    signals: ['crud', 'create', 'submit', 'form', 'record', 'item', 'lead', 'listing', 'manage', 'edit', 'delete', 'update', 'table'],
    requiredSkills: ['neon-postgres', 'verify-deploy'],
    requiredFiles: ['db/schema.ts', 'API route or server action', 'form/list UI'],
    envVars: ['DATABASE_URL'],
    schemaPatterns: ['id uuid primary key', 'created_at/updated_at', 'status when workflow-shaped'],
    apiPatterns: ['POST for create', 'GET list/detail', 'PATCH for updates', 'Zod validation'],
    uiPatterns: ['form with validation states', 'empty state', 'recent records list/table'],
    verificationRequirements: ['create record journey', 'GET/list shows created record', 'verify_db_state SELECT confirms row'],
    commonFailures: ['HTTP returns success but DB insert silently failed', 'missing migration before deploy'],
    verticalSlice: ['schema', 'mutation endpoint', 'list endpoint', 'form/list UI', 'DB assertion'],
  },
  {
    id: 'dashboard',
    title: 'Dashboard And Operations UI',
    summary: 'Dense product surfaces for repeated operational use.',
    whenNeeded: ['Dashboards, admin panels, CRM, analytics, status tracking, operations tools'],
    signals: ['dashboard', 'admin panel', 'crm', 'kanban', 'status', 'operations', 'workspace', 'metrics', 'reporting', 'table'],
    requiredSkills: ['frontend-design', 'design-systems', 'verify-deploy'],
    requiredFiles: ['dashboard route', 'summary cards/tables', 'loading and empty states'],
    envVars: [],
    schemaPatterns: ['aggregate queries by status/date/owner'],
    apiPatterns: ['GET summary endpoint when server-rendering cannot cover it'],
    uiPatterns: ['compact tables', 'filters', 'status badges', 'segmented controls', 'predictable navigation'],
    verificationRequirements: ['dashboard route 200', 'data appears after a create journey', 'design_audit/design_critique'],
    commonFailures: ['marketing hero instead of operational UI', 'invented metrics with no source'],
    verticalSlice: ['data summary', 'dashboard route', 'filters/actions', 'visual verification'],
  },
  {
    id: 'payments_stripe',
    title: 'Stripe Payments',
    summary: 'Checkout, subscriptions, billing portals, webhooks, products, and Connect payouts.',
    whenNeeded: ['The app charges money, gates plans, sells products, subscriptions, or handles payouts'],
    signals: ['stripe', 'payment', 'checkout', 'subscription', 'subscriptions', 'subscribe', 'subscriber', 'payout', 'payouts', 'paid plan', 'paywall'],
    requiredSkills: ['stripe-payments', 'webhooks', 'verify-deploy'],
    requiredFiles: ['checkout route/action', 'pricing UI', 'webhook route guarded for missing envs'],
    envVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    schemaPatterns: ['customer_id', 'subscription_id', 'plan/status fields', 'payment_events table when needed'],
    apiPatterns: ['create checkout session', 'webhook signature verification', 'idempotent event handling'],
    uiPatterns: ['pricing cards only when relevant', 'billing status badge', 'clear paid/free state'],
    verificationRequirements: ['pricing/checkout link liveness', 'webhook route does not break build without configured optional envs'],
    commonFailures: ['unused Stripe webhook route fails Next build because STRIPE_SECRET_KEY is missing', 'non-idempotent webhook handling'],
    verticalSlice: ['billing schema', 'checkout endpoint', 'pricing/account UI', 'webhook verification'],
  },
  {
    id: 'uploads_storage',
    title: 'File Uploads And Storage',
    summary: 'Document/image/media uploads with metadata, permissions, and retrieval.',
    whenNeeded: ['Users upload documents, images, PDFs, media, evidence, receipts, or compliance files'],
    signals: ['upload', 'file', 'document', 'pdf', 'image', 'media', 'attachment', 'compliance', 'storage', 'gallery', 'receipt'],
    requiredSkills: ['r2-storage', 'neon-postgres', 'verify-deploy'],
    requiredFiles: ['upload route', 'storage helper', 'metadata table', 'file input UI'],
    envVars: ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'],
    schemaPatterns: ['files/documents table with owner_id, key, url, mime_type, size'],
    apiPatterns: ['multipart upload or signed upload URL', 'size/type validation', 'permission check on read/delete'],
    uiPatterns: ['upload progress', 'file list', 'empty/error states', 'remove/replace controls'],
    verificationRequirements: ['upload journey or signed-url liveness', 'metadata row exists', 'invalid type/size rejected'],
    commonFailures: ['storing file bytes in Postgres instead of object storage', 'metadata writes without storage success'],
    verticalSlice: ['storage env/config', 'metadata schema', 'upload endpoint', 'upload UI', 'metadata assertion'],
  },
  {
    id: 'email_notifications',
    title: 'Email And Notifications',
    summary: 'Transactional emails, alerts, welcome messages, workflow notifications.',
    whenNeeded: ['The task needs transactional email, invites, notifications, receipts, reminders, or approval alerts'],
    signals: ['send email', 'email notification', 'transactional email', 'notify', 'notification', 'invite', 'welcome', 'receipt', 'reminder', 'alert', 'digest'],
    requiredSkills: ['email-postmark', 'background-jobs'],
    requiredFiles: ['email sender helper', 'notification trigger', 'template copy'],
    envVars: ['POSTMARK_SERVER_TOKEN', 'FROM_EMAIL'],
    schemaPatterns: ['notification_events or audit trail when delivery matters'],
    apiPatterns: ['send after durable DB write', 'retry-safe notification event'],
    uiPatterns: ['email preferences when user-facing', 'sent/failed status when operational'],
    verificationRequirements: ['mail trigger path returns success or records queued event', 'missing token fails clearly'],
    commonFailures: ['send before DB commit', 'swallowing provider failures'],
    verticalSlice: ['template/helper', 'trigger integration', 'delivery/audit state', 'verification'],
  },
  {
    id: 'ai_openai',
    title: 'AI Features',
    summary: 'LLM calls, summaries, classification, extraction, chat, OCR, and image generation.',
    whenNeeded: ['The product needs GPT, summaries, chat, extraction, OCR, image generation, or AI assistance'],
    signals: ['ai', 'openai', 'gpt', 'llm', 'chatbot', 'summarize', 'summarizes', 'summary', 'extract', 'classify', 'ocr', 'image generation', 'assistant'],
    requiredSkills: ['agent-sdk', 'openai-proxy', 'verify-deploy'],
    requiredFiles: ['AI route/action', 'prompt template', 'result persistence when user-visible'],
    envVars: ['AI_GATEWAY_BASE_URL', 'AI_GATEWAY_TOKEN'],
    schemaPatterns: ['ai_runs table or feature-specific result columns'],
    apiPatterns: ['timeout around model call', 'model errors surfaced cleanly', 'persist generated result'],
    uiPatterns: ['loading/progress state', 'retry action', 'show source/input and generated output'],
    verificationRequirements: ['AI endpoint handles a real request', 'result saved or returned in expected shape', 'logs clean after model call'],
    commonFailures: ['hardcoded unavailable model id', 'no timeout', 'claiming result generated without persistence'],
    verticalSlice: ['prompt + route', 'result schema', 'AI UI state', 'live endpoint verification'],
  },
  {
    id: 'rag_search',
    title: 'RAG And Semantic Search',
    summary: 'Retrieval over documents, examples, knowledge bases, or uploaded content.',
    whenNeeded: ['Search should understand meaning or answer from a corpus'],
    signals: ['rag', 'semantic', 'embedding', 'embeddings', 'knowledge base', 'vector', 'document search', 'retrieval', 'ask documents'],
    requiredSkills: ['neon-postgres', 'openai-proxy'],
    requiredFiles: ['ingestion route/job', 'embedding helper', 'search/answer route'],
    envVars: ['AI_GATEWAY_URL', 'AI_GATEWAY_TOKEN', 'AI_EMBEDDING_MODEL', 'DATABASE_URL'],
    schemaPatterns: ['documents table', 'chunks table', 'embedding/vector or vectorless index fields', 'founder apps use gemini-embedding-001 with pgvector vector(3072) on the fixed Gemini gateway'],
    apiPatterns: ['ingest -> chunk -> embed/index -> retrieve -> answer', 'citation/source metadata', 'use AI_EMBEDDING_MODEL or gemini-embedding-001 for founder app embeddings'],
    uiPatterns: ['search box/chat', 'source list', 'empty/no-match state'],
    verificationRequirements: ['ingest sample content', 'query retrieves expected source', 'answer cites or includes retrieved fact'],
    commonFailures: ['answering from model memory instead of retrieved content', 'no source attribution', 'hardcoding text-embedding-004 or a vector dimension that does not match AI_GATEWAY_URL'],
    verticalSlice: ['content schema', 'ingestion', 'retrieval endpoint', 'answer UI', 'source assertion'],
  },
  {
    id: 'search',
    title: 'Keyword Search And Filtering',
    summary: 'Fast filters, keyword search, faceting, and sort for records/listings.',
    whenNeeded: ['Users need to find records by keyword, status, date, category, owner, or location'],
    signals: ['search', 'filter', 'facet', 'sort', 'find', 'directory', 'browse'],
    requiredSkills: ['neon-postgres', 'frontend-design'],
    requiredFiles: ['search query endpoint or server-rendered params', 'filter UI'],
    envVars: [],
    schemaPatterns: ['indexes on search/filter columns', 'status/category fields'],
    apiPatterns: ['validated query params', 'pagination/limit'],
    uiPatterns: ['search input', 'filter chips', 'empty state', 'sort menu'],
    verificationRequirements: ['created record appears in filtered search', 'no-result state works'],
    commonFailures: ['unbounded SELECT *', 'case-sensitive search surprises'],
    verticalSlice: ['indexes/query', 'search API', 'filter UI', 'search journey'],
  },
  {
    id: 'admin_workflow',
    title: 'Admin Review Workflow',
    summary: 'Queues, approval/rejection, moderation, status changes, and audit trails.',
    whenNeeded: ['Admins review vendors, listings, payouts, documents, posts, or approvals'],
    signals: ['approve', 'approval', 'reject', 'review', 'moderate', 'queue', 'admin', 'status', 'workflow'],
    requiredSkills: ['frontend-design', 'neon-postgres'],
    requiredFiles: ['admin list/detail route', 'status mutation endpoint', 'audit trail schema'],
    envVars: [],
    schemaPatterns: ['status enum', 'reviewed_by', 'reviewed_at', 'review_note'],
    apiPatterns: ['PATCH status with authorization', 'append audit event'],
    uiPatterns: ['review queue', 'detail panel', 'approve/reject buttons', 'status badge'],
    verificationRequirements: ['admin changes status', 'non-admin blocked', 'DB status/audit row confirms change'],
    commonFailures: ['status update has no role guard', 'approval action is only client-side'],
    verticalSlice: ['status schema', 'admin guard', 'review UI', 'status journey'],
  },
  {
    id: 'analytics',
    title: 'Analytics And Reporting',
    summary: 'Metrics, trends, charts, funnels, and operational reporting.',
    whenNeeded: ['The task asks for analytics, reporting, metrics, funnel, trends, or charts'],
    signals: ['analytics', 'report', 'metric', 'chart', 'trend', 'funnel', 'kpi', 'insight'],
    requiredSkills: ['event-tracking', 'forecasting', 'frontend-design'],
    requiredFiles: ['event capture or aggregate query', 'chart/dashboard component'],
    envVars: [],
    schemaPatterns: ['events table or aggregate views', 'date bucket fields'],
    apiPatterns: ['bounded date range', 'aggregate endpoint'],
    uiPatterns: ['charts with labels', 'comparison periods', 'no invented metrics'],
    verificationRequirements: ['seed/action creates event', 'dashboard reflects count/trend'],
    commonFailures: ['invented values', 'expensive unbounded aggregations'],
    verticalSlice: ['event/aggregate schema', 'metric endpoint', 'chart UI', 'metric assertion'],
  },
  {
    id: 'realtime',
    title: 'Realtime Or Live Updates',
    summary: 'Polling, SSE, streaming progress, live status, or chat token streams.',
    whenNeeded: ['Users expect live progress, streaming, chat, or near-realtime status'],
    signals: ['realtime', 'real-time', 'live update', 'live progress', 'stream', 'sse', 'progress', 'chat tokens', 'polling'],
    requiredSkills: ['realtime-features', 'agent-sdk'],
    requiredFiles: ['SSE/stream endpoint or polling endpoint', 'client live state'],
    envVars: [],
    schemaPatterns: ['run/status table when progress must persist'],
    apiPatterns: ['bounded stream', 'heartbeat/timeout', 'fallback polling'],
    uiPatterns: ['progress state', 'connection error state', 'retry'],
    verificationRequirements: ['endpoint streams/polls status', 'UI handles loading and completion'],
    commonFailures: ['long request without timeout', 'client waits forever'],
    verticalSlice: ['status schema', 'stream/poll endpoint', 'live UI', 'timeout verification'],
  },
  {
    id: 'cron_jobs',
    title: 'Background And Scheduled Jobs',
    summary: 'Recurring jobs, reminders, digests, syncs, cleanup, and async processing.',
    whenNeeded: ['The task needs scheduled work, reminders, daily digest, sync, import, or background processing'],
    signals: ['cron', 'scheduled job', 'scheduled report', 'daily', 'weekly', 'reminder', 'digest', 'sync', 'background job'],
    requiredSkills: ['background-jobs', 'render-infra'],
    requiredFiles: ['job handler route/script', 'job state table', 'idempotency guard'],
    envVars: ['CRON_SECRET'],
    schemaPatterns: ['job_runs table', 'last_processed_at', 'idempotency key'],
    apiPatterns: ['authenticated job endpoint', 'idempotent processing'],
    uiPatterns: ['last run status when operationally visible'],
    verificationRequirements: ['manual job trigger works', 'job state recorded', 'repeat trigger idempotent'],
    commonFailures: ['duplicate sends on retries', 'no auth on cron endpoint'],
    verticalSlice: ['job schema', 'job route', 'manual verification', 'status surface'],
  },
  {
    id: 'external_api',
    title: 'External API Integration',
    summary: 'Third-party data fetches, syncs, webhooks, and provider-specific workflows.',
    whenNeeded: ['The task mentions a third-party service or API-backed data'],
    signals: ['api integration', 'external api', 'webhook', 'sync', 'import from', 'connect to', 'provider', 'integration'],
    requiredSkills: ['webhooks', 'verify-deploy'],
    requiredFiles: ['provider client', 'webhook/sync route', 'env validation'],
    envVars: ['PROVIDER_API_KEY'],
    schemaPatterns: ['external_id', 'sync_status', 'last_synced_at'],
    apiPatterns: ['timeout/retry', 'signature verification for webhooks', 'rate-limit-aware sync'],
    uiPatterns: ['connection status', 'sync error state'],
    verificationRequirements: ['mock or live-safe request path', 'missing env fails clearly', 'webhook rejects bad signature'],
    commonFailures: ['unbounded external request', 'webhook accepts unsigned payload'],
    verticalSlice: ['provider config', 'client/route', 'status persistence', 'integration verification'],
  },
  {
    id: 'marketplace',
    title: 'Marketplace And Listings',
    summary: 'Supply/demand listings, directories, job boards, service marketplaces, and reviews.',
    whenNeeded: ['The product connects sellers/providers with buyers/customers'],
    signals: ['marketplace', 'listing', 'directory', 'job board', 'buyer', 'seller', 'review', 'payout'],
    requiredSkills: ['frontend-design', 'neon-postgres', 'stripe-payments'],
    requiredFiles: ['listing schema', 'browse/detail pages', 'create listing flow'],
    envVars: [],
    schemaPatterns: ['listings table', 'profiles/vendors table', 'reviews table when needed'],
    apiPatterns: ['create/list/detail listing endpoints', 'search/filter params'],
    uiPatterns: ['listing cards/table', 'detail page', 'seller/admin status'],
    verificationRequirements: ['create listing', 'browse/search finds listing', 'detail page renders'],
    commonFailures: ['marketplace reduced to generic lead form', 'no role distinction between provider and buyer'],
    verticalSlice: ['profiles/listings schema', 'listing CRUD', 'browse/detail UI', 'search/listing journey'],
  },
  {
    id: 'booking',
    title: 'Booking And Scheduling',
    summary: 'Availability, bookings, reservations, appointments, and status workflows.',
    whenNeeded: ['Users reserve time, make appointments, book services, or manage availability'],
    signals: ['booking', 'book service', 'appointment', 'reservation', 'availability slot', 'booking calendar', 'time slot'],
    requiredSkills: ['neon-postgres', 'email-postmark', 'frontend-design'],
    requiredFiles: ['availability schema', 'booking endpoint', 'booking UI'],
    envVars: [],
    schemaPatterns: ['availability_slots table', 'bookings table', 'status/cancelled_at'],
    apiPatterns: ['prevent double booking', 'transactional create booking', 'cancel/reschedule endpoint'],
    uiPatterns: ['date/slot picker', 'booking confirmation', 'status badge'],
    verificationRequirements: ['create booking', 'same slot cannot double-book', 'booking appears in list'],
    commonFailures: ['race allows duplicate booking', 'timezone not explicit'],
    verticalSlice: ['availability schema', 'booking transaction', 'slot UI', 'double-book verification'],
  },
  {
    id: 'deployment_render',
    title: 'Render Deployment',
    summary: 'GitHub-backed Render web service with Neon Postgres and live verification.',
    whenNeeded: ['Every shipped founder web app or API must deploy to Render'],
    signals: ['deploy', 'render', 'ship', 'live', 'full-stack', 'app', 'website', 'api'],
    requiredSkills: ['render-infra', 'verify-deploy'],
    requiredFiles: ['package.json scripts', 'Render build/start commands', 'health route when appropriate'],
    envVars: ['DATABASE_URL', 'BETTER_AUTH_SECRET'],
    schemaPatterns: ['migrations applied before deploy'],
    apiPatterns: ['health or landing route returns 2xx', 'start binds 0.0.0.0 and $PORT'],
    uiPatterns: ['live URL linked in report'],
    verificationRequirements: ['render_get_deploy_status live', 'render_get_logs clean', 'check_url_health 2xx'],
    commonFailures: ['BUILD_COMMAND set as env var instead of service config', 'hardcoded port 3000', 'health path points to missing route'],
    verticalSlice: ['commit code', 'apply schema', 'deploy', 'logs/health/journey verification'],
  },
  // ─────────────────────────────────────────────────────────────────────
  // Deeper full-stack capability packs (additive — preserve IDs above).
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'cart_orders_checkout',
    title: 'Cart, Orders, and Checkout',
    summary: 'Server-side cart, order creation, line items, and confirmation flow.',
    whenNeeded: ['Ecommerce or any "add to cart → buy" flow', 'restaurant/marketplace order baskets'],
    signals: ['cart', 'add to cart', 'checkout', 'order', 'line item', 'basket', 'shopping cart', 'order confirmation'],
    requiredSkills: ['neon-postgres', 'frontend-design', 'stripe-payments', 'verify-deploy'],
    requiredFiles: ['cart route + table', 'order route + table', 'checkout page', 'order confirmation page'],
    envVars: ['DATABASE_URL'],
    schemaPatterns: ['carts (id, user_or_session_id)', 'cart_items (cart_id, product_id, qty, price_at_add)', 'orders (id, user_id, status, total, currency)', 'order_items (order_id, product_id, qty, unit_price)'],
    apiPatterns: ['POST /api/cart/items', 'PATCH /api/cart/items/[id]', 'POST /api/checkout/sessions (transactional)', 'GET /api/orders'],
    uiPatterns: ['cart drawer with line items + subtotal', 'checkout summary panel', 'order confirmation with order id'],
    verificationRequirements: ['add to cart updates cart count + drawer', 'checkout creates order + order_items atomically', 'confirmation page shows persisted order'],
    commonFailures: ['cart total trusted from client', 'order persists when payment session fails (no atomicity)', 'cart resets on refresh because session id lost'],
    verticalSlice: ['cart schema', 'cart endpoints', 'cart UI', 'checkout endpoint', 'order schema', 'order endpoints', 'confirmation page', 'checkout journey verification'],
  },
  {
    id: 'coupons_tax_shipping',
    title: 'Coupons, Tax, and Shipping',
    summary: 'Discount codes, tax computation, and shipping options applied to orders.',
    whenNeeded: ['Storefront supports promo codes', 'order totals include tax or shipping', 'cart shows discount applied'],
    signals: ['coupon', 'promo', 'discount', 'tax', 'vat', 'gst', 'shipping', 'shipping rate', 'shipping zone'],
    requiredSkills: ['neon-postgres', 'frontend-design'],
    requiredFiles: ['coupons table + lookup', 'tax helper', 'shipping options API'],
    envVars: [],
    schemaPatterns: ['coupons (code, kind, value, starts_at, ends_at, usage_limit)', 'order_discounts (order_id, coupon_id, amount)', 'tax_rates / shipping_zones'],
    apiPatterns: ['POST /api/checkout/apply-coupon (validates server-side, returns recomputed totals)', 'GET /api/shipping/options for cart contents'],
    uiPatterns: ['coupon input with applied state', 'breakdown row: subtotal, tax, shipping, total', 'shipping option radio group'],
    verificationRequirements: ['valid coupon reduces total', 'invalid coupon rejected with reason', 'tax/shipping line items persist in order'],
    commonFailures: ['coupon validated client-side only', 'expired or limit-exceeded coupon still applies', 'tax computed in two places and they disagree'],
    verticalSlice: ['coupon schema', 'coupon apply endpoint', 'tax + shipping helpers', 'cart UI breakdown', 'verification'],
  },
  {
    id: 'payment_lifecycle',
    title: 'Payment Lifecycle (Pending → Paid → Refund)',
    summary: 'Persistent payment state across creation, success, failure, refund, and chargeback.',
    whenNeeded: ['Stripe checkout/PaymentIntent is involved', 'orders or subscriptions need durable payment state'],
    signals: ['payment intent', 'payment status', 'paid', 'refund', 'chargeback', 'failed payment', 'authorize', 'capture'],
    requiredSkills: ['stripe-payments', 'neon-postgres', 'webhooks'],
    requiredFiles: ['payments table', 'state machine helper', 'reconciliation script when needed'],
    envVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    schemaPatterns: ['payments (id, order_id, provider_id, status, amount, currency)', 'status enum: pending/processing/paid/failed/refunded/disputed', 'idempotency_key column'],
    apiPatterns: ['create PaymentIntent in own row first, then call Stripe', 'webhook transitions row via state-machine helper', 'refund endpoint records reverse-row not delete'],
    uiPatterns: ['order page shows current payment status badge', 'refunded orders visibly marked'],
    verificationRequirements: ['payment row exists with state=pending after intent', 'webhook flips state to paid', 'refund creates reverse row'],
    commonFailures: ['payment status driven by client redirect (unreliable)', 'amount drift between Stripe + DB', 'no idempotency on webhook → duplicate state writes'],
    verticalSlice: ['payments schema + state machine', 'intent creation endpoint', 'webhook handler with idempotency', 'refund endpoint', 'verification'],
  },
  {
    id: 'stripe_webhooks',
    title: 'Stripe Webhook Reliability',
    summary: 'Signed, idempotent webhook receiver with raw-body verification and retry-safe handling.',
    whenNeeded: ['Any Stripe integration that persists state', 'subscription/payment_intent/charge events drive app state'],
    signals: ['webhook', 'stripe webhook', 'event handler', 'payment event', 'subscription event', 'signature verification'],
    requiredSkills: ['stripe-payments', 'webhooks'],
    requiredFiles: ['webhook route with raw-body parsing', 'signature verification', 'event handlers per type'],
    envVars: ['STRIPE_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY'],
    schemaPatterns: ['webhook_events (id, provider_id unique, type, payload, processed_at)', 'idempotency via UNIQUE on provider_id'],
    apiPatterns: ['raw body required for signature verify', 'reject on bad signature with 400', 'process event in DB transaction', 'return 200 only after successful persist'],
    uiPatterns: ['ops view of recent webhook events (optional)'],
    verificationRequirements: ['valid signed payload accepted', 'invalid signature rejected with 400', 'duplicate event_id is no-op (idempotent)'],
    commonFailures: ['parsed JSON before verifying signature', 'returning 200 before DB commit → Stripe never retries lost work', 'no UNIQUE constraint on event id → double processing'],
    verticalSlice: ['webhook route + raw-body config', 'signature verify', 'event handler switch', 'idempotency check', 'webhook test using Stripe CLI'],
  },
  {
    id: 'teams_workspaces',
    title: 'Teams / Workspaces / Memberships',
    summary: 'Users belong to teams or workspaces with roles and resource scoping.',
    whenNeeded: ['B2B app with multiple users per account', 'product needs team invites and admin/member separation'],
    signals: ['team', 'teams', 'workspace', 'organization', 'org', 'tenant', 'membership', 'invite', 'collaborator'],
    requiredSkills: ['auth-sessions', 'neon-postgres'],
    requiredFiles: ['workspaces table', 'memberships table', 'workspace switcher UI', 'invite flow'],
    envVars: [],
    schemaPatterns: ['workspaces (id, name, slug)', 'memberships (workspace_id, user_id, role)', 'invites (workspace_id, email, token, expires_at)'],
    apiPatterns: ['workspace selector in session or active_workspace_id column', 'all resource queries filtered by workspace_id', 'invite/accept endpoints'],
    uiPatterns: ['workspace switcher in header', 'member list with roles + remove', 'invite form'],
    verificationRequirements: ['create workspace + invite member journey', 'member can only see their workspace data', 'role-aware UI'],
    commonFailures: ['leaked cross-workspace data (queries missing workspace_id)', 'invite tokens with no expiry', 'workspace switch leaks data via React state'],
    verticalSlice: ['workspace schema', 'membership schema + invites', 'workspace context wiring', 'invite flow', 'cross-workspace isolation verification'],
  },
  {
    id: 'oauth_password_reset',
    title: 'OAuth + Password Reset',
    summary: 'Google/GitHub OAuth login and self-service password reset flow.',
    whenNeeded: ['Auth needs to support social login', 'users must reset forgotten passwords'],
    signals: ['oauth', 'google login', 'github login', 'social sign-in', 'sso', 'password reset', 'forgot password'],
    requiredSkills: ['auth-sessions', 'email-postmark'],
    requiredFiles: ['oauth provider config', 'reset request route', 'reset confirm route', 'reset email template'],
    envVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BETTER_AUTH_SECRET'],
    schemaPatterns: ['accounts table linking provider+provider_account_id to user', 'password_reset_tokens (token, user_id, expires_at)'],
    apiPatterns: ['OAuth callback persists account row', 'reset request emails one-use token', 'reset confirm rotates password + revokes sessions'],
    uiPatterns: ['login page with provider buttons', 'forgot password form', 'reset confirm page'],
    verificationRequirements: ['OAuth round-trip persists user/account', 'reset email sends or queues', 'token expires + is one-use'],
    commonFailures: ['reset tokens never expire', 'OAuth callback creates duplicate users on email-collision', 'session not invalidated after password change'],
    verticalSlice: ['oauth provider config', 'reset schema + email', 'login UI', 'reset journeys'],
  },
  {
    id: 'multi_tenant_isolation',
    title: 'Multi-Tenant Data Isolation',
    summary: 'Hard tenant scoping on every query so user A never sees user B data.',
    whenNeeded: ['Multi-user app with per-user or per-team data', 'B2B product with org separation'],
    signals: ['multi tenant', 'isolation', 'tenant id', 'per-user data', 'per-org data', 'row level security'],
    requiredSkills: ['auth-sessions', 'neon-postgres'],
    requiredFiles: ['tenant scoping helper', 'middleware that injects tenant_id', 'audit of all queries'],
    envVars: [],
    schemaPatterns: ['tenant_id (or user_id / workspace_id) NOT NULL on every business table', 'composite indexes (tenant_id, ...)', 'optional RLS policies'],
    apiPatterns: ['centralized query helper that REFUSES to run a query missing tenant filter', 'PATCH/DELETE authorize tenant_id matches session'],
    uiPatterns: ['no UI hide-only of foreign-tenant data — server returns nothing'],
    verificationRequirements: ['cross-tenant access journey: user A cannot GET/PATCH/DELETE user B record (returns 404 or 403)'],
    commonFailures: ['admin endpoint accidentally exposes tenant_id from URL → IDOR', 'analytics queries skip tenant filter', 'foreign key without tenant context allows pivot from public id'],
    verticalSlice: ['tenant column + index audit', 'query helper enforcement', 'admin/IDOR review', 'cross-tenant journey test'],
  },
  {
    id: 'rich_text_cms',
    title: 'Rich Text / CMS / Block Editor',
    summary: 'Structured rich-text or block-based content with safe rendering.',
    whenNeeded: ['Content authoring beyond plain text (lessons, blog posts, descriptions)', 'instructor or admin needs WYSIWYG'],
    signals: ['rich text', 'wysiwyg', 'editor', 'cms', 'blog', 'lesson body', 'block editor', 'tiptap', 'markdown'],
    requiredSkills: ['frontend-design', 'neon-postgres'],
    requiredFiles: ['editor component', 'content storage column', 'safe renderer'],
    envVars: [],
    schemaPatterns: ['content stored as Markdown OR structured JSON (NOT raw HTML)', 'version table when revision history needed'],
    apiPatterns: ['validate + sanitize on write', 'render via safe markdown-to-html or block renderer'],
    uiPatterns: ['toolbar with formatting actions', 'image insertion with size limit', 'preview/render side'],
    verificationRequirements: ['author edit persists', 'reader render matches authored content', 'XSS smoke: <script> in input is escaped'],
    commonFailures: ['content stored as raw HTML → XSS', 'editor loses content on slow save', 'image upload disconnected from content'],
    verticalSlice: ['content schema', 'editor UI', 'safe renderer', 'XSS verification'],
  },
  {
    id: 'import_export_csv',
    title: 'CSV Import / Export',
    summary: 'Bulk data import with row validation/errors and export to CSV/Excel.',
    whenNeeded: ['Operational apps with bulk data (inventory, leads, members)', 'reports need download-as-CSV'],
    signals: ['csv', 'import', 'export', 'bulk upload', 'download as csv', 'excel', 'spreadsheet'],
    requiredSkills: ['neon-postgres', 'background-jobs'],
    requiredFiles: ['import endpoint', 'parser helper', 'export endpoint with streaming'],
    envVars: [],
    schemaPatterns: ['import_jobs (id, status, errors_json) for async imports', 'natural key for idempotency (sku, email)'],
    apiPatterns: ['parse + validate row-by-row', 'return per-row errors not silent skip', 'export streams text/csv with correct Content-Type'],
    uiPatterns: ['import wizard with preview + error table', 'export button with progress for large datasets'],
    verificationRequirements: ['valid CSV imports rows', 'malformed row reported with line number', 'export response is text/csv with header row'],
    commonFailures: ['silently dropped rows', 'no idempotency → re-import duplicates everything', 'export holds entire dataset in memory'],
    verticalSlice: ['import endpoint', 'parser + validator', 'error surface', 'export endpoint', 'verification'],
  },
  {
    id: 'audit_logs',
    title: 'Audit Logs',
    summary: 'Append-only record of who did what to which resource and when.',
    whenNeeded: ['Operational apps with admin actions (approvals, status changes, deletes)', 'compliance/regulated industries', 'any product handling money or sensitive workflow'],
    signals: ['audit', 'audit log', 'audit trail', 'history', 'changelog', 'who changed', 'reviewed by'],
    requiredSkills: ['neon-postgres'],
    requiredFiles: ['audit_logs table', 'audit helper invoked from mutations'],
    envVars: [],
    schemaPatterns: ['audit_logs (id, actor_id, action, target_table, target_id, before_json, after_json, occurred_at)', 'append-only — no UPDATE/DELETE on audit rows'],
    apiPatterns: ['write audit row in same transaction as the mutation', 'admin endpoint to read audit per resource'],
    uiPatterns: ['per-resource history timeline', 'admin audit search'],
    verificationRequirements: ['mutation creates audit row in same txn', 'audit row contains actor + before + after', 'audit cannot be edited or deleted via API'],
    commonFailures: ['audit written after txn commit and lost on rollback', 'no actor on audit (anonymous actions)', 'audit rows mutable'],
    verticalSlice: ['audit schema', 'audit helper', 'integration into key mutations', 'admin audit UI', 'verification'],
  },
  {
    id: 'soft_delete_restore',
    title: 'Soft Delete + Restore',
    summary: 'Records are marked deleted instead of hard-removed, with restore + purge windows.',
    whenNeeded: ['Operational apps that should support "undo delete"', 'GDPR purge windows', 'records referenced by foreign keys but business says "delete"'],
    signals: ['soft delete', 'archive', 'restore', 'trash', 'recover deleted', 'purge'],
    requiredSkills: ['neon-postgres'],
    requiredFiles: ['deleted_at column on business tables', 'restore endpoint', 'purge job'],
    envVars: [],
    schemaPatterns: ['deleted_at TIMESTAMPTZ NULL on business tables', 'index on deleted_at for fast filter', 'periodic purge cron'],
    apiPatterns: ['default queries filter WHERE deleted_at IS NULL', 'DELETE flips deleted_at instead of removing', 'restore endpoint clears deleted_at'],
    uiPatterns: ['archive/trash view', 'restore button per row', 'auto-purge after N days notice'],
    verificationRequirements: ['delete hides from list', 'restore returns it', 'purge job runs idempotently'],
    commonFailures: ['queries forget WHERE deleted_at filter → soft-deleted rows leak back', 'unique constraints conflict with re-create (need partial index)', 'purge job missing'],
    verticalSlice: ['deleted_at column', 'query helper enforcing filter', 'restore endpoint', 'purge job', 'verification'],
  },
  {
    id: 'file_privacy_validation',
    title: 'File Privacy + Validation',
    summary: 'Server-side file type/size limits and per-file access control beyond URL guessing.',
    whenNeeded: ['Any uploads where private docs must stay private', 'KYC/medical/legal documents', 'gated creator content'],
    signals: ['private upload', 'access control', 'file permission', 'signed url', 'authenticated download', 'kyc', 'sensitive file'],
    requiredSkills: ['r2-storage', 'auth-sessions'],
    requiredFiles: ['signed-URL helper', 'access check on file fetch', 'mime + size validation'],
    envVars: ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'],
    schemaPatterns: ['files (id, owner_id, visibility, mime, size, sha256)', 'no public listing endpoint that returns all keys'],
    apiPatterns: ['server-side mime + size validation BEFORE storing', 'download endpoint checks owner/role + issues short-lived signed URL', 'never expose direct bucket URL for private files'],
    uiPatterns: ['upload UI shows accepted formats + limits', 'private indicator on file row'],
    verificationRequirements: ['oversized file rejected', 'wrong mime rejected', 'another user cannot access another user file via direct or guessed URL'],
    commonFailures: ['private files in a publicly listable bucket', 'mime trusted from client', 'no size cap → fill disk / spend bandwidth'],
    verticalSlice: ['validation helper', 'access-check middleware', 'signed-URL helper', 'verification'],
  },
  {
    id: 'notification_preferences',
    title: 'Notification Preferences',
    summary: 'Per-user opt-in/opt-out for each notification kind with respect-the-pref enforcement.',
    whenNeeded: ['App sends multiple email/push types', 'compliance with CAN-SPAM / GDPR opt-out', 'user complaints about noise'],
    signals: ['notification preferences', 'unsubscribe', 'email preferences', 'opt-in', 'opt-out', 'mute notifications'],
    requiredSkills: ['email-postmark', 'neon-postgres'],
    requiredFiles: ['notification_preferences table', 'preference page', 'pref-check before send'],
    envVars: [],
    schemaPatterns: ['notification_preferences (user_id, kind, channel, enabled)', 'global unsubscribe boolean for compliance'],
    apiPatterns: ['send helper checks pref before sending', 'one-click unsubscribe link in every email'],
    uiPatterns: ['preferences page with toggles per kind', 'inline mute on notification list'],
    verificationRequirements: ['changing pref persists', 'subsequent send skipped when disabled', 'unsubscribe link works without login'],
    commonFailures: ['send helper bypasses preference check', 'no one-click unsubscribe → CAN-SPAM violation', 'preference change UI updates client state but DB never written'],
    verticalSlice: ['preferences schema', 'preferences UI', 'send guard', 'verification'],
  },
  {
    id: 'realtime_collaboration',
    title: 'Realtime Collaboration',
    summary: 'Multiple users see each other and changes in shared state with concurrency safety.',
    whenNeeded: ['Document editing with multiple authors', 'live cursors', 'shared whiteboard or canvas', 'live status of teammates'],
    signals: ['collaborate', 'collaborative', 'multi-user editing', 'live cursors', 'presence', 'co-edit', 'crdt', 'operational transform'],
    requiredSkills: ['realtime-features'],
    requiredFiles: ['websocket / SSE channel', 'presence helper', 'merge/conflict strategy'],
    envVars: [],
    schemaPatterns: ['document_revisions when persistent history matters', 'presence ephemeral (in memory or short-TTL key)'],
    apiPatterns: ['authoritative server resolves conflicts (last-write-wins or CRDT/OT)', 'broadcast change events with user_id'],
    uiPatterns: ['avatar stack of present users', 'live cursors with name labels', 'conflict indicator on simultaneous edit'],
    verificationRequirements: ['two clients see each other join/leave', 'one client edit appears on the other within ~1s', 'simultaneous edits do not lose work'],
    commonFailures: ['no presence cleanup → ghost users forever', 'naive overwrite loses work on concurrent edit', 'no auth on websocket → strangers join doc'],
    verticalSlice: ['transport channel', 'presence', 'change broadcast', 'merge strategy', 'two-client verification'],
  },
  {
    id: 'queue_workers',
    title: 'Queue + Background Workers',
    summary: 'Decouple long/expensive work from HTTP requests with a durable queue and worker process.',
    whenNeeded: ['Tasks take > 1-2 seconds and would time out HTTP', 'fan-out work (send N emails, process N files)', 'retry-with-backoff for flaky externals'],
    signals: ['queue worker', 'background worker', 'background job', 'process async', 'retry queue', 'fan-out', 'task queue'],
    requiredSkills: ['background-jobs'],
    requiredFiles: ['jobs table', 'worker script/route', 'enqueue helper', 'process management'],
    envVars: ['CRON_SECRET'],
    schemaPatterns: ['jobs (id, kind, payload, status, attempts, scheduled_for, locked_by, locked_at)', 'atomic claim via UPDATE ... WHERE status=pending RETURNING'],
    apiPatterns: ['enqueue returns immediately', 'worker claims one job atomically + processes + transitions status', 'max-attempts with exponential backoff'],
    uiPatterns: ['admin jobs view with retry/dead-letter', 'user-facing "in progress" state'],
    verificationRequirements: ['enqueue creates row', 'worker processes job and transitions status', 'concurrent workers do not double-process (atomic claim test)'],
    commonFailures: ['no atomic claim → two workers process same job', 'no max-attempts → infinite retry burns spend', 'no dead-letter → quietly stuck jobs'],
    verticalSlice: ['jobs schema', 'enqueue helper', 'worker loop with atomic claim', 'admin jobs UI', 'concurrent-claim verification'],
  },
  {
    id: 'long_running_ai_jobs',
    title: 'Long-Running AI Jobs',
    summary: 'AI work routed through the queue with persisted intermediate state and retry from any step.',
    whenNeeded: ['AI calls > 30s (large doc analysis, video, batch)', 'multi-step AI pipelines (extract → classify → summarize)', 'cost-capping per user'],
    signals: ['ai pipeline', 'long ai', 'batch ai', 'background ai', 'pipeline', 'multi step ai', 'document analysis'],
    requiredSkills: ['agent-sdk', 'background-jobs', 'openai-proxy'],
    requiredFiles: ['ai_runs table', 'step persistence', 'orchestrator'],
    envVars: ['AI_GATEWAY_BASE_URL', 'AI_GATEWAY_TOKEN'],
    schemaPatterns: ['ai_runs (id, job_id, step, input_ref, output_ref, status, cost_cents)', 'persist after each step so retry resumes from last good step'],
    apiPatterns: ['orchestrator pulls step from queue, runs, writes ai_runs, enqueues next step', 'failed step → retry with backoff, then dead-letter'],
    uiPatterns: ['per-step progress', 'partial result visible mid-run', 'retry-from-step admin action'],
    verificationRequirements: ['multi-step job persists each step', 'killed mid-job → resume picks up at last good step', 'AI failure → job moves to failed with reason'],
    commonFailures: ['monolithic run that loses everything on failure', 'no resume capability', 'partial state vanishes if process crashes'],
    verticalSlice: ['ai_runs schema', 'orchestrator', 'retry-from-step admin', 'verification'],
  },
  {
    id: 'ai_safety_cost_controls',
    title: 'AI Safety + Cost Controls',
    summary: 'Per-user/job rate limits, daily spend caps, prompt-injection defenses, content moderation hooks.',
    whenNeeded: ['Any user-facing AI', 'AI features that could be abused (prompt injection, content generation)', 'paid plans where cost-per-user matters'],
    signals: ['rate limit', 'cost cap', 'spend cap', 'prompt injection', 'content moderation', 'pii', 'abuse', 'safety filter'],
    requiredSkills: ['agent-sdk'],
    requiredFiles: ['rate-limit helper', 'spend tracker', 'moderation hook'],
    envVars: [],
    schemaPatterns: ['ai_spend_daily (user_id, date, cents)', 'ai_rate_limit (user_id, window, count)'],
    apiPatterns: ['enforce limit BEFORE calling AI', 'log spend after every call', 'optional moderation call before or after generation'],
    uiPatterns: ['clear upgrade prompt at limit', 'transparency: today\'s usage visible'],
    verificationRequirements: ['hitting limit returns 429 not 500', 'daily cap actually halts further calls', 'prompt-injection in user input does not exfiltrate system prompt or PII'],
    commonFailures: ['no rate limit → single user drains entire daily AI budget', 'limit per request but not per user', 'moderation runs but result ignored'],
    verticalSlice: ['rate-limit + spend schema', 'enforcement at AI call site', 'user transparency UI', 'abuse verification'],
  },
  {
    id: 'seo_public_pages',
    title: 'SEO-Friendly Public Pages',
    summary: 'Server-rendered public surface with proper meta, structured data, sitemap, and crawlable links.',
    whenNeeded: ['Marketing site / landing pages', 'public listings (real estate, marketplace, courses)', 'public blog / content'],
    signals: ['seo', 'meta tags', 'open graph', 'og', 'sitemap', 'robots.txt', 'crawlable', 'indexable'],
    requiredSkills: ['frontend-design'],
    requiredFiles: ['per-page meta helper', '/sitemap.xml', '/robots.txt', 'OG image generator (optional)'],
    envVars: [],
    schemaPatterns: ['public content tables have published_at + slug', 'sitemap derives from published rows'],
    apiPatterns: ['SSR/SSG for public pages (not client-only)', 'sitemap dynamic', 'robots disallow admin/api'],
    uiPatterns: ['shareable URLs work without auth', 'OG image previews when shared'],
    verificationRequirements: ['public page response includes meta tags + og:image + canonical', 'sitemap lists published content', 'robots.txt blocks /admin'],
    commonFailures: ['public pages are SPA-only → empty crawl', 'admin pages indexed', 'duplicate canonicals'],
    verticalSlice: ['meta helper', 'sitemap route', 'robots.txt', 'per-page meta', 'crawl verification'],
  },
  {
    id: 'security_ops',
    title: 'Security Ops',
    summary: 'Baseline application security: secrets handling, CSRF, XSS, SQL safety, secure cookies, security headers.',
    whenNeeded: ['Every shipped app should have this baseline', 'apps handling money or PII especially'],
    signals: ['security', 'csrf', 'xss', 'sql injection', 'secret management', 'security headers', 'rate limit', 'csp'],
    requiredSkills: ['auth-sessions'],
    requiredFiles: ['security middleware', 'env validation', 'rate-limit helper'],
    envVars: [],
    schemaPatterns: ['no secrets in DB', 'sensitive fields hashed (passwords with bcrypt/argon2)'],
    apiPatterns: ['all input validated with Zod', 'parameterized queries only', 'CSRF tokens on state-changing forms when cookie-auth', 'rate limit auth endpoints'],
    uiPatterns: ['CSP-friendly inline styles avoided', 'secure cookies with SameSite + Secure + HttpOnly'],
    verificationRequirements: ['Zod rejects malformed input', 'SQL injection probe blocked', 'cookies have Secure + HttpOnly + SameSite', 'security headers present'],
    commonFailures: ['secrets logged or returned in errors', 'CORS opened to *', 'no rate limit on /login → credential stuffing', 'XSS in user-provided content'],
    verticalSlice: ['Zod validators', 'security headers middleware', 'cookie hardening', 'rate limit', 'security verification'],
  },
  {
    id: 'rollback_backup_ops',
    title: 'Rollback + Backup Ops',
    summary: 'Production safety: deployable rollback, DB backups, fast revert path on bad deploy.',
    whenNeeded: ['Production app with paying customers', 'any DB migrations that could lose data', 'apps that ship daily'],
    signals: ['rollback', 'backup', 'restore', 'migration safety', 'revert deploy', 'point in time'],
    requiredSkills: ['render-infra', 'neon-postgres'],
    requiredFiles: ['migration up + down', 'backup verification script', 'rollback runbook'],
    envVars: [],
    schemaPatterns: ['migrations versioned + reversible', 'Neon branches for risky changes', 'DB backups verified by restore-test'],
    apiPatterns: ['feature flags for risky deploys', 'health check that fails on partial migration'],
    uiPatterns: ['maintenance / read-only mode optional'],
    verificationRequirements: ['migration up + down both run cleanly', 'backup can be restored to a test branch', 'previous Render deploy is one click to roll back to'],
    commonFailures: ['no down migration', 'backup never tested → unrestorable when needed', 'rolling deploy creates a window where schema is half-migrated'],
    verticalSlice: ['reversible migrations', 'backup verify script', 'rollback runbook', 'verification'],
  },
];

const PACK_BY_ID = new Map<CapabilityId, CapabilityPack>(CAPABILITY_PACKS.map((pack) => [pack.id, pack]));

export function listCapabilityPacks(): CapabilityPack[] {
  return CAPABILITY_PACKS;
}

export function getCapabilityPack(id: string): CapabilityPack | null {
  return PACK_BY_ID.get(normalizeCapabilityId(id) as CapabilityId) ?? null;
}

export function normalizeCapabilityId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []);
}

function signalMatches(text: string, tokens: Set<string>, signal: string): boolean {
  const normalized = signal.toLowerCase();
  if (normalized.includes(' ')) return text.includes(normalized);
  if (normalized.length < 3) return new RegExp(`\\b${normalized}\\b`, 'i').test(text);
  return tokens.has(normalized);
}

export function matchCapabilities(input: CapabilityPlanInput, limit = 10): MatchedCapability[] {
  const text = [
    input.title,
    input.description,
    input.productContext,
    input.actors?.join(' '),
    input.workflows?.join(' '),
    input.entities?.join(' '),
    input.capabilities?.join(' '),
  ].filter(Boolean).join('\n').toLowerCase();

  const tokens = tokenize(text);
  const requestedIds = new Set((input.capabilities ?? []).map(normalizeCapabilityId));

  // Domain-driven boost: when match_domain_app told us this is e.g.
  // ecommerce_store, every capability listed by that domain pack gets a
  // floor score so the matcher does not collapse to crud+dashboard.
  const domainBoostIds = new Set<string>();
  for (const domainId of input.domains ?? []) {
    const pack = getDomainPackByIdLoose(domainId);
    for (const cap of pack?.requiredCapabilities ?? []) {
      const normalized = normalizeCapabilityId(cap);
      domainBoostIds.add(normalized);
    }
  }

  const matches = CAPABILITY_PACKS.map((pack) => {
    const reasons: string[] = [];
    let score = requestedIds.has(pack.id) ? 12 : 0;
    if (requestedIds.has(pack.id)) reasons.push('explicitly requested');

    for (const signal of pack.signals) {
      if (signalMatches(text, tokens, signal)) {
        score += signal.includes(' ') ? 5 : 3;
        reasons.push(`matched "${signal}"`);
      }
    }

    for (const phrase of pack.whenNeeded) {
      const lowered = phrase.toLowerCase();
      const words = lowered.match(/[a-z0-9][a-z0-9-]{3,}/g) ?? [];
      const hits = words.filter((word) => tokens.has(word)).length;
      if (hits >= Math.min(2, words.length)) {
        score += hits;
      }
    }

    if (pack.id === 'deployment_render' && /\b(build|create|ship|deploy|launch|full-stack|app|website|portal|dashboard|api)\b/i.test(text)) {
      score += 8;
      reasons.push('shipping a web app requires Render deployment');
    }
    if (pack.id === 'crud' && /\b(full-stack|portal|dashboard|crm|admin|marketplace|booking|app)\b/i.test(text)) {
      score += 5;
      reasons.push('full-stack app likely needs persisted records');
    }

    if (domainBoostIds.has(pack.id)) {
      score += 6;
      reasons.push('required by matched domain pack');
    }

    return {
      id: pack.id,
      title: pack.title,
      score,
      requirement: 'optional' as const,
      reasons: [...new Set(reasons)].slice(0, 5),
      requiredSkills: pack.requiredSkills,
      verificationRequirements: pack.verificationRequirements,
    };
  })
    .filter((match) => match.score >= 3 && match.reasons.length > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const selected = matches.slice(0, Math.max(1, Math.min(limit, CAPABILITY_PACKS.length)));
  if (selected.length > 0 && !selected.some((match) => match.id === 'deployment_render') && /\b(build|create|ship|deploy|launch|full-stack|app|website|portal|dashboard)\b/i.test(text)) {
    const render = PACK_BY_ID.get('deployment_render')!;
    selected.push({
      id: render.id,
      title: render.title,
      score: 8,
      requirement: 'optional',
      reasons: ['shipping a web app requires Render deployment'],
      requiredSkills: render.requiredSkills,
      verificationRequirements: render.verificationRequirements,
    });
  }

  const requiredIds = requiredCapabilityIds(selected, input);
  return selected.map((match) => ({
    ...match,
    requirement: requiredIds.has(match.id) ? 'required' as const : 'optional' as const,
  }));
}

function requiredCapabilityIds(matches: MatchedCapability[], input: CapabilityPlanInput): Set<CapabilityId> {
  if (matches.length === 0) return new Set();

  const text = [
    input.title,
    input.description,
    input.productContext,
    input.capabilities?.join(' '),
  ].filter(Boolean).join('\n');
  const taskIntent = input.taskIntent
    ? { intent: input.taskIntent, lane: input.taskIntentLane ?? 'build' as const }
    : classifyTaskIntent({
      title: input.title,
      description: input.description,
      productContext: input.productContext,
    });
  const planningDepth = input.planningDepth ?? classifyPlanningDepth({
    title: input.title,
    description: input.description,
    productContext: input.productContext,
    taskIntent: taskIntent.intent,
    taskIntentLane: taskIntent.lane,
    selectedCapabilities: matches.map((match) => match.id),
    selectedDomains: input.domains,
  }).depth;

  if (planningDepth === 'canary_world_class' || planningDepth === 'mixed_complex_app') {
    return new Set(matches.map((match) => match.id));
  }

  const ordered = matches.map((match) => match.id);
  const explicitlyRequested = new Set((input.capabilities ?? []).map(normalizeCapabilityId) as CapabilityId[]);
  const required: CapabilityId[] = [];
  const add = (id: CapabilityId) => {
    if (!required.includes(id) && ordered.includes(id)) required.push(id);
  };

  for (const id of ordered) {
    if (explicitlyRequested.has(id)) add(id);
  }

  const limit = taskIntent.lane === 'repair' || planningDepth === 'simple_feature'
    ? 2
    : planningDepth === 'existing_app_extension'
      ? 4
      : 5;

  const preferDeployment = /\b(render|deploy|deployment|health|env|build failed|service)\b/i.test(text);
  const preferred = taskIntent.lane === 'repair' && !preferDeployment
    ? ordered.filter((id) => id !== 'deployment_render')
    : ordered;

  for (const id of preferred) {
    if (required.length >= limit) break;
    add(id);
  }
  if (required.length === 0) add(ordered[0]);

  return new Set(required.slice(0, limit));
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))];
}

function inferActors(input: CapabilityPlanInput, capabilities: CapabilityId[]): string[] {
  const actors = [...(input.actors ?? [])];
  if (capabilities.includes('admin_workflow') || capabilities.includes('roles')) actors.push('admin');
  if (capabilities.includes('marketplace')) actors.push('provider', 'buyer');
  if (capabilities.includes('booking')) actors.push('customer', 'operator');
  if (capabilities.includes('auth')) actors.push('authenticated user');
  return unique(actors.length ? actors : ['visitor', 'operator']);
}

function inferEntities(input: CapabilityPlanInput, capabilities: CapabilityId[]): string[] {
  const entities = [...(input.entities ?? [])];
  if (capabilities.includes('marketplace')) entities.push('profiles', 'listings');
  if (capabilities.includes('booking')) entities.push('availability_slots', 'bookings');
  if (capabilities.includes('uploads_storage')) entities.push('documents');
  if (capabilities.includes('payments_stripe')) entities.push('subscriptions', 'payment_events');
  if (capabilities.includes('ai_openai')) entities.push('ai_runs');
  if (capabilities.includes('rag_search')) entities.push('documents', 'document_chunks');
  if (capabilities.includes('admin_workflow')) entities.push('approval_reviews');
  if (capabilities.includes('crud') && entities.length === 0) entities.push('records');
  return unique(entities);
}

function entityRouteSegment(entity: string): string {
  const normalized = entity
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'records';
}

function primaryCrudEntity(entities: string[], capabilities: CapabilityId[], explicitEntities: string[]): string {
  const explicitBusinessEntity = explicitEntities.find((entity) =>
    !/^(users?|profiles?|sessions?|accounts?|verification_tokens?)$/i.test(entity)
  );
  if (explicitBusinessEntity) return explicitBusinessEntity;

  if (capabilities.includes('marketplace') && entities.includes('listings')) return 'listings';
  if (capabilities.includes('booking') && entities.includes('bookings')) return 'bookings';
  if (capabilities.includes('rag_search') && entities.includes('documents')) return 'documents';
  if (capabilities.includes('uploads_storage') && entities.includes('documents')) return 'documents';
  if (capabilities.includes('payments_stripe') && entities.includes('subscriptions')) return 'subscriptions';

  const businessEntity = entities.find((entity) =>
    !/^(users?|profiles?|sessions?|accounts?|verification_tokens?|approval_reviews?|payment_events?|ai_runs?|document_chunks?)$/i.test(entity)
  );
  return businessEntity ?? entities[0] ?? 'records';
}

export function composeCapabilityArchitecture(input: CapabilityPlanInput): CapabilityArchitecturePlan {
  const matched = matchCapabilities(input, 12);
  const requiredMatched = matched.filter((match) => match.requirement === 'required');
  const taskIntent = input.taskIntent
    ? { intent: input.taskIntent, lane: input.taskIntentLane ?? 'build' as const }
    : classifyTaskIntent({
      title: input.title,
      description: input.description,
      productContext: input.productContext,
    });
  const planningDepth = input.planningDepth ?? classifyPlanningDepth({
    title: input.title,
    description: input.description,
    productContext: input.productContext,
    taskIntent: taskIntent.intent,
    taskIntentLane: taskIntent.lane,
    selectedCapabilities: matched.map((match) => match.id),
    selectedDomains: input.domains,
  }).depth;
  const strictAllCapabilityPlan = planningDepth === 'canary_world_class' || planningDepth === 'mixed_complex_app';
  const architectureSourceIds = strictAllCapabilityPlan
    ? matched.map((match) => match.id)
    : (requiredMatched.length > 0 ? requiredMatched : matched).map((match) => match.id);
  const capabilityIds = unique([
    ...architectureSourceIds,
  ])
    .map((id) => getCapabilityPack(id)?.id)
    .filter((id): id is CapabilityId => !!id);

  const capabilities: CapabilityId[] = capabilityIds.length ? capabilityIds : ['crud', 'deployment_render'];
  const actors = inferActors(input, capabilities);
  const entities = inferEntities(input, capabilities);
  const workflows = unique([
    ...(input.workflows ?? []),
    capabilities.includes('crud') ? 'create and review persisted records' : null,
    capabilities.includes('admin_workflow') ? 'admin reviews and changes status' : null,
    capabilities.includes('payments_stripe') ? 'customer starts checkout and billing state updates' : null,
    capabilities.includes('uploads_storage') ? 'user uploads a file and sees it attached to the record' : null,
    capabilities.includes('ai_openai') ? 'user submits input and receives an AI-generated result' : null,
    capabilities.includes('rag_search') ? 'user searches retrieved knowledge with source-backed answers' : null,
    capabilities.includes('marketplace') ? 'provider publishes listings and buyer browses/searches them' : null,
    capabilities.includes('booking') ? 'customer books an available slot and duplicate booking is rejected' : null,
  ]);

  const pages = unique([
    '/',
    capabilities.includes('auth') ? '/login' : null,
    capabilities.includes('dashboard') ? '/dashboard' : null,
    capabilities.includes('admin_workflow') ? '/admin' : null,
    capabilities.includes('marketplace') ? '/listings' : null,
    capabilities.includes('booking') ? '/book' : null,
    capabilities.includes('payments_stripe') ? '/pricing' : null,
    capabilities.includes('uploads_storage') ? '/documents' : null,
  ]);

  const primaryEntityRoute = entityRouteSegment(primaryCrudEntity(entities, capabilities, input.entities ?? []));
  const apiRoutes = unique([
    capabilities.includes('crud') ? `GET/POST /api/${primaryEntityRoute}` : null,
    capabilities.includes('admin_workflow') ? 'PATCH /api/admin/:entity/:id/status' : null,
    capabilities.includes('uploads_storage') ? 'POST /api/uploads' : null,
    capabilities.includes('payments_stripe') ? 'POST /api/billing/checkout' : null,
    capabilities.includes('payments_stripe') ? 'POST /api/webhooks/stripe' : null,
    capabilities.includes('ai_openai') ? 'POST /api/ai/run' : null,
    capabilities.includes('rag_search') ? 'POST /api/search' : null,
    capabilities.includes('booking') ? 'POST /api/bookings' : null,
    capabilities.includes('deployment_render') ? 'GET / or /api/health' : null,
  ]);

  const databaseTables = unique(entities.map((entity) => entity.toLowerCase().replace(/[^a-z0-9]+/g, '_')));
  const integrations = unique(capabilities.flatMap((id) => {
    const pack = PACK_BY_ID.get(id);
    return pack?.envVars.length ? pack.envVars : [];
  }));

  const verticalSlices = capabilities.map((id) => ({
    capability: id,
    steps: PACK_BY_ID.get(id)?.verticalSlice ?? ['schema', 'API', 'UI', 'verification'],
  }));

  const verificationJourneys = buildVerificationJourneys(capabilities);
  const referencePatterns = unique(input.referencePatterns ?? []);
  const hybridRetrieval = {
    sources: unique([
      'capability registry',
      'capability packs',
      input.designSystem ? `design system: ${input.designSystem}` : 'design systems',
      referencePatterns.length ? 'GitHub/reference patterns' : null,
      input.existingCodebaseHints?.length ? 'existing company codebase map' : null,
      input.knownIssueHints?.length ? 'known issues/failure registry' : 'known issues/failure registry',
      'skills',
      input.previousLearnings?.length ? 'previous canary learnings' : 'previous canary learnings',
    ].filter((value): value is string => !!value)),
    decisions: unique([
      `Selected capabilities: ${capabilities.join(', ')}`,
      `Build vertical slices in this order: ${capabilities.join(' -> ')}`,
      referencePatterns.length
        ? `Use reference patterns as architecture/UI/schema/API guidance: ${referencePatterns.join(', ')}`
        : 'No reference pattern ids supplied; call match_reference_repos/get_reference_repo_patterns for UI or architecture-heavy work.',
      input.designSystem
        ? `Apply design-system conventions from ${input.designSystem} while keeping company-specific brand/copy.`
        : 'Call match_design_system/get_design_system before implementing user-facing UI.',
      capabilities.includes('rag_search')
        ? 'For RAG in founder/user apps, use the fixed Gemini embedding contract: AI_EMBEDDING_MODEL=gemini-embedding-001 with vector(3072) on https://generativelanguage.googleapis.com/v1beta/openai. Never use text-embedding-004/768-dim or text-embedding-3-small/1536-dim for new founder apps. Do not create ivfflat/hnsw indexes on vector(3072); use exact scan for small data, halfvec, or a <=2000-dim indexed representation.'
        : null,
      'Extend existing codebase map when present; do not create a duplicate generic SaaS app.',
      'Use verification journeys to drive verify_user_journey and verify_db_state evidence.',
    ]),
  };

  // Extended fields per goal Section 6.
  const domains = unique(input.domains ?? []);
  const apiContracts = buildApiContracts(capabilities, primaryEntityRoute);
  const dbStateChecks = buildDbStateChecks(capabilities, entities);
  const browserUiChecks = buildBrowserUiChecks(capabilities, pages, primaryEntityRoute);
  const frontendPlanSummary = buildFrontendPlanSummary(domains, capabilities, pages);

  return {
    appSummary: input.productContext || input.description || input.title || 'CEO-assigned full-stack application task',
    actors,
    workflows,
    entities,
    capabilities,
    integrations,
    pages,
    apiRoutes,
    databaseTables,
    designSystem: input.designSystem ?? null,
    referencePatterns,
    hybridRetrieval,
    verticalSlices,
    verificationJourneys,
    domains,
    apiContracts,
    dbStateChecks,
    browserUiChecks,
    frontendPlanSummary,
  };
}

function buildApiContracts(capabilities: CapabilityId[], primaryEntityRoute: string): ApiContract[] {
  const contracts: ApiContract[] = [];
  if (capabilities.includes('crud')) {
    contracts.push({
      method: 'POST',
      path: `/api/${primaryEntityRoute}`,
      purpose: `Create a ${primaryEntityRoute.replace(/-/g, ' ')} record.`,
      capability: 'crud',
      request: 'JSON body validated by Zod with all required fields',
      response: 'JSON with { id, ...record }',
      statusCodes: [201, 400, 401, 500],
      auth: capabilities.includes('auth') ? 'authenticated' : 'public',
      dbExpectation: `INSERT one row into ${primaryEntityRoute.replace(/-/g, '_')}`,
      failureCases: ['validation error → 400 with field-level reasons', 'auth missing → 401', 'DB constraint → 4xx with reason'],
    });
    contracts.push({
      method: 'GET',
      path: `/api/${primaryEntityRoute}`,
      purpose: `List ${primaryEntityRoute.replace(/-/g, ' ')} records.`,
      capability: 'crud',
      request: 'Query params: optional cursor, limit, filter',
      response: 'JSON with { items: [...], nextCursor? }',
      statusCodes: [200, 401],
      auth: capabilities.includes('auth') ? 'authenticated' : 'public',
      dbExpectation: `SELECT from ${primaryEntityRoute.replace(/-/g, '_')} with filter applied`,
      failureCases: ['auth missing → 401'],
    });
  }
  if (capabilities.includes('admin_workflow')) {
    contracts.push({
      method: 'PATCH',
      path: '/api/admin/:entity/:id/status',
      purpose: 'Admin approves or rejects a record.',
      capability: 'admin_workflow',
      request: 'JSON body: { status: "approved"|"rejected", note?: string }',
      response: 'JSON with updated record + audit row id',
      statusCodes: [200, 401, 403, 404, 422],
      auth: 'role-required',
      dbExpectation: 'UPDATE row.status AND INSERT into audit_logs in same transaction',
      failureCases: ['non-admin → 403', 'invalid transition → 422'],
    });
  }
  if (capabilities.includes('uploads_storage')) {
    contracts.push({
      method: 'POST',
      path: '/api/uploads',
      purpose: 'Upload a file and persist metadata.',
      capability: 'uploads_storage',
      request: 'multipart/form-data with file field; size/type validated server-side',
      response: 'JSON with { id, key, url, mime, size }',
      statusCodes: [201, 400, 401, 413, 415],
      auth: capabilities.includes('auth') ? 'authenticated' : 'public',
      dbExpectation: 'INSERT metadata row even when blob storage creds missing (payment-ready/integration-ready behavior)',
      failureCases: ['oversize → 413', 'wrong mime → 415', 'no auth → 401'],
    });
  }
  if (capabilities.includes('payments_stripe')) {
    contracts.push({
      method: 'POST',
      path: '/api/billing/checkout',
      purpose: 'Create a Stripe checkout session for the current cart/plan.',
      capability: 'payments_stripe',
      request: 'JSON with { priceId or cartId }',
      response: 'JSON with { sessionId, url }',
      statusCodes: [201, 400, 401, 502],
      auth: capabilities.includes('auth') ? 'authenticated' : 'public',
      dbExpectation: 'INSERT payment row in pending state BEFORE Stripe call so atomicity is maintained',
      failureCases: ['Stripe key missing → 502 with reason', 'cart empty → 400'],
    });
    contracts.push({
      method: 'POST',
      path: '/api/webhooks/stripe',
      purpose: 'Receive Stripe webhook events and transition state.',
      capability: 'payments_stripe',
      request: 'raw body + Stripe-Signature header',
      response: '200 only after successful state persist',
      statusCodes: [200, 400],
      auth: 'webhook-signed',
      dbExpectation: 'INSERT into webhook_events (idempotent on event id), UPDATE payment/order state in same transaction',
      failureCases: ['bad signature → 400', 'duplicate event → 200 no-op'],
    });
  }
  if (capabilities.includes('ai_openai')) {
    contracts.push({
      method: 'POST',
      path: '/api/ai/run',
      purpose: 'Submit an AI generation request.',
      capability: 'ai_openai',
      request: 'JSON with { prompt, params }',
      response: 'JSON with { id, result } when sync OR { jobId, status: "queued" } for long runs',
      statusCodes: [200, 202, 400, 429, 500],
      auth: capabilities.includes('auth') ? 'authenticated' : 'public',
      dbExpectation: 'INSERT ai_runs row before model call; UPDATE with result after',
      failureCases: ['rate limit → 429', 'AI provider down → 502 or job marked failed'],
    });
  }
  if (capabilities.includes('rag_search')) {
    contracts.push({
      method: 'POST',
      path: '/api/search',
      purpose: 'Retrieve content matching a query.',
      capability: 'rag_search',
      request: 'JSON with { query, topK? }',
      response: 'JSON with { results: [...], sources: [...] }',
      statusCodes: [200, 400, 401],
      auth: capabilities.includes('auth') ? 'authenticated' : 'public',
      dbExpectation: 'SELECT with vector similarity from document_chunks',
      failureCases: ['empty query → 400', 'no matches → 200 with empty results'],
    });
  }
  if (capabilities.includes('booking')) {
    contracts.push({
      method: 'POST',
      path: '/api/bookings',
      purpose: 'Create a booking for an available slot.',
      capability: 'booking',
      request: 'JSON with { slotId, customer }',
      response: 'JSON with booking record',
      statusCodes: [201, 400, 401, 409],
      auth: capabilities.includes('auth') ? 'authenticated' : 'public',
      dbExpectation: 'INSERT booking + UPDATE slot in same transaction; row lock to prevent double-book',
      failureCases: ['slot taken → 409', 'slot in past → 400'],
    });
  }
  if (capabilities.includes('deployment_render')) {
    contracts.push({
      method: 'GET',
      path: '/api/health',
      purpose: 'Liveness/readiness probe for Render.',
      capability: 'deployment_render',
      request: 'no body',
      response: 'JSON { ok: true } when ready',
      statusCodes: [200, 503],
      auth: 'public',
      dbExpectation: 'optional: SELECT 1 from DB to confirm connectivity',
      failureCases: ['DB unreachable → 503'],
    });
  }
  return contracts;
}

function buildDbStateChecks(capabilities: CapabilityId[], entities: string[]): DbStateCheck[] {
  const checks: DbStateCheck[] = [];
  if (capabilities.includes('crud')) {
    const primaryEntity = entities.find((e) => !['users', 'sessions', 'accounts'].includes(e.toLowerCase())) ?? entities[0] ?? 'records';
    checks.push({
      name: `${primaryEntity} created`,
      table: primaryEntity.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      expects: 'one row exists with the submitted fields',
      triggeredBy: 'POST /api/<entity> via verify_user_journey',
    });
  }
  if (capabilities.includes('admin_workflow')) {
    checks.push({
      name: 'admin status transition',
      table: 'audit_logs',
      expects: 'audit row exists with actor_id, action, target_id, after_json',
      triggeredBy: 'PATCH /api/admin/<entity>/:id/status',
    });
  }
  if (capabilities.includes('uploads_storage')) {
    checks.push({
      name: 'upload metadata',
      table: 'documents',
      expects: 'metadata row with key + mime + size persists, even without storage creds',
      triggeredBy: 'POST /api/uploads',
    });
  }
  if (capabilities.includes('payments_stripe')) {
    checks.push({
      name: 'payment state machine',
      table: 'payments',
      expects: 'pending row created BEFORE Stripe call; webhook flips to paid',
      triggeredBy: 'POST /api/billing/checkout + webhook simulation',
    });
  }
  if (capabilities.includes('booking')) {
    checks.push({
      name: 'no double-book',
      table: 'bookings',
      expects: 'two concurrent POSTs for same slot result in exactly one row',
      triggeredBy: 'parallel POST /api/bookings to same slot',
    });
  }
  if (capabilities.includes('cart_orders_checkout')) {
    checks.push({
      name: 'order atomicity',
      table: 'orders + order_items',
      expects: 'order and all order_items persist together OR neither persists',
      triggeredBy: 'POST /api/checkout/sessions',
    });
  }
  if (capabilities.includes('audit_logs')) {
    checks.push({
      name: 'audit append-only',
      table: 'audit_logs',
      expects: 'audit rows cannot be UPDATEd or DELETEd via API',
      triggeredBy: 'attempt to PATCH/DELETE audit row',
    });
  }
  return checks;
}

function buildBrowserUiChecks(capabilities: CapabilityId[], pages: string[], primaryEntityRoute: string): BrowserUiCheck[] {
  const checks: BrowserUiCheck[] = [];
  if (pages.includes('/')) {
    checks.push({
      pagePath: '/',
      required_text: ['(headline or hero copy)', '(primary CTA label)'],
      required_buttons: ['(primary CTA)'],
      form_submission_checks: [],
    });
  }
  if (pages.includes('/login') && capabilities.includes('auth')) {
    checks.push({
      pagePath: '/login',
      required_text: ['email', 'password OR magic link'],
      required_buttons: ['Sign in / Send magic link'],
      form_submission_checks: ['submit with valid credentials → redirect to /dashboard or /'],
    });
  }
  if (pages.includes('/dashboard') && capabilities.includes('dashboard')) {
    checks.push({
      pagePath: '/dashboard',
      required_text: ['(metric label)', '(at least one entity title or "No data yet" empty state)'],
      required_buttons: ['(primary action like "+ New")'],
      form_submission_checks: [],
    });
  }
  if (pages.includes('/admin') && capabilities.includes('admin_workflow')) {
    checks.push({
      pagePath: '/admin',
      required_text: ['(queue heading)', '(at least one row status badge)'],
      required_buttons: ['Approve', 'Reject'],
      form_submission_checks: ['approve flips row + writes audit row'],
    });
  }
  if (capabilities.includes('crud')) {
    checks.push({
      pagePath: `/${primaryEntityRoute}`,
      required_text: [`(${primaryEntityRoute} heading)`, '(at least one record OR empty state)'],
      required_buttons: ['+ New', 'Edit / Delete (per row)'],
      form_submission_checks: ['create form submit → row appears in list + DB row exists'],
    });
  }
  if (pages.includes('/book') && capabilities.includes('booking')) {
    checks.push({
      pagePath: '/book',
      required_text: ['(service or provider name)', '(date heading)', '(confirmation text after submit)'],
      required_buttons: ['(slot chips)', 'Confirm booking'],
      form_submission_checks: ['pick slot → confirm → booking row created → confirmation shown'],
    });
  }
  if (pages.includes('/pricing') && capabilities.includes('payments_stripe')) {
    checks.push({
      pagePath: '/pricing',
      required_text: ['(plan tier name + price)'],
      required_buttons: ['Subscribe / Get started'],
      form_submission_checks: ['click subscribe → checkout session URL OR payment-ready record'],
    });
  }
  if (pages.includes('/documents') && capabilities.includes('uploads_storage')) {
    checks.push({
      pagePath: '/documents',
      required_text: ['(documents heading)', '(at least one filename OR upload CTA)'],
      required_buttons: ['Upload'],
      form_submission_checks: ['upload → metadata row exists → file appears in list'],
    });
  }
  return checks;
}

function buildFrontendPlanSummary(domains: string[], capabilities: CapabilityId[], pages: string[]): CapabilityArchitecturePlan['frontendPlanSummary'] {
  // Best-effort summary based on domains + capabilities. The agent should call
  // compose_frontend_plan for the full plan; this summary is for at-a-glance
  // reference inside the architecture output.
  if (domains.length === 0 && capabilities.length === 0) return undefined;
  const patternHints: string[] = [];
  if (capabilities.includes('marketplace')) patternHints.push('marketplace_listing');
  if (capabilities.includes('booking')) patternHints.push('booking_calendar');
  if (capabilities.includes('admin_workflow')) patternHints.push('admin_portal');
  if (capabilities.includes('cart_orders_checkout') || domains.includes('ecommerce_store')) patternHints.push('ecommerce_storefront');
  if (capabilities.includes('dashboard') || capabilities.includes('analytics')) patternHints.push('dashboard');
  if (domains.includes('social_community')) patternHints.push('social_feed');
  if (domains.includes('advanced_ai_mixed')) patternHints.push('ai_workspace');
  if (domains.includes('inventory_operations')) patternHints.push('inventory_table');
  if (domains.includes('real_estate_property')) patternHints.push('real_estate_listing');
  if (domains.includes('media_creator')) patternHints.push('media_creator_gallery');
  if (domains.includes('education_content')) patternHints.push('education_lms');
  if (domains.includes('health_fitness_food')) patternHints.push('health_plan_tracker');
  if (domains.includes('construction_operations')) patternHints.push('construction_ops_board');
  if (domains.includes('finance_crypto')) patternHints.push('finance_dashboard');
  if (domains.includes('business_website_crm')) patternHints.push('crm_pipeline');
  return {
    uiType: patternHints.length === 0 ? 'generic' : patternHints.length === 1 ? patternHints[0] : 'mixed',
    patternIds: [...new Set(patternHints)],
    pages,
  };
}

function buildVerificationJourneys(capabilities: CapabilityId[]): CapabilityArchitecturePlan['verificationJourneys'] {
  const journeys: CapabilityArchitecturePlan['verificationJourneys'] = [];
  if (capabilities.includes('auth')) {
    journeys.push({
      name: 'auth access journey',
      covers: ['auth', ...(capabilities.includes('roles') ? ['roles' as CapabilityId] : [])],
      steps: ['register or login', 'open protected route', 'anonymous user is denied protected route'],
    });
  }
  if (capabilities.includes('crud')) {
    journeys.push({
      name: 'create and list record journey',
      covers: ['crud'],
      steps: ['POST create endpoint with valid data', 'GET list/detail endpoint', 'verify_db_state confirms row exists'],
    });
  }
  if (capabilities.includes('uploads_storage')) {
    journeys.push({
      name: 'upload document journey',
      covers: ['uploads_storage'],
      steps: ['upload valid file or exercise signed URL', 'metadata appears in UI/API', 'invalid file type or missing auth is rejected'],
    });
  }
  if (capabilities.includes('payments_stripe')) {
    journeys.push({
      name: 'billing journey',
      covers: ['payments_stripe'],
      steps: ['open pricing/account page', 'create checkout session or payment link', 'webhook route does not break build/runtime'],
    });
  }
  if (capabilities.includes('ai_openai')) {
    journeys.push({
      name: 'AI result journey',
      covers: ['ai_openai'],
      steps: ['POST realistic AI request', 'assert ok/result shape', 'result is rendered or persisted'],
    });
  }
  if (capabilities.includes('rag_search')) {
    journeys.push({
      name: 'retrieval journey',
      covers: ['rag_search'],
      steps: ['ingest known sample', 'query for known fact', 'response includes retrieved source/fact'],
    });
  }
  if (capabilities.includes('admin_workflow')) {
    journeys.push({
      name: 'admin approval journey',
      covers: ['admin_workflow', ...(capabilities.includes('roles') ? ['roles' as CapabilityId] : [])],
      steps: ['create pending item', 'admin approves/rejects item', 'DB status/audit row changes', 'non-admin blocked from same mutation'],
    });
  }
  if (capabilities.includes('booking')) {
    journeys.push({
      name: 'booking journey',
      covers: ['booking'],
      steps: ['create booking for available slot', 'booking appears in list', 'second booking for same slot is rejected'],
    });
  }
  if (capabilities.includes('marketplace')) {
    journeys.push({
      name: 'marketplace listing journey',
      covers: ['marketplace', 'search'],
      steps: ['create listing', 'browse/search finds listing', 'detail page renders listing'],
    });
  }
  journeys.push({
    name: 'deployment health journey',
    covers: ['deployment_render'],
    steps: ['render_get_deploy_status reports live', 'render_get_logs clean', 'check_url_health returns 2xx', 'design checks pass for UI surfaces'],
  });
  return journeys;
}

export function formatCapabilityMatches(matches: MatchedCapability[]): string {
  if (matches.length === 0) {
    return 'No capability matches found. Default to crud + deployment_render, then refine from the CEO task context.';
  }
  return [
    'Capability matches:',
    ...matches.map((match, index) =>
      `${index + 1}. ${match.id} (${match.title}) score=${match.score} requirement=${match.requirement}\n` +
      `   reasons: ${match.reasons.join('; ') || 'baseline'}\n` +
      `   skills: ${match.requiredSkills.join(', ') || 'none'}\n` +
      `   verify: ${match.verificationRequirements.join('; ')}`
    ),
  ].join('\n');
}

export function formatCapabilityPack(pack: CapabilityPack): string {
  return [
    `Capability: ${pack.id} — ${pack.title}`,
    pack.summary,
    '',
    `When needed: ${pack.whenNeeded.join('; ')}`,
    `Required skills: ${pack.requiredSkills.join(', ') || 'none'}`,
    `Required files: ${pack.requiredFiles.join('; ') || 'task-specific'}`,
    `Env vars: ${pack.envVars.join(', ') || 'none'}`,
    `Schema patterns: ${pack.schemaPatterns.join('; ') || 'none'}`,
    `API patterns: ${pack.apiPatterns.join('; ') || 'none'}`,
    `UI patterns: ${pack.uiPatterns.join('; ') || 'none'}`,
    `Verification: ${pack.verificationRequirements.join('; ')}`,
    `Common failures: ${pack.commonFailures.join('; ') || 'none'}`,
    `Vertical slice: ${pack.verticalSlice.join(' -> ')}`,
  ].join('\n');
}

export function formatArchitecturePlan(plan: CapabilityArchitecturePlan): string {
  return [
    'Capability architecture plan:',
    `Summary: ${plan.appSummary}`,
    `Domains: ${plan.domains.join(', ') || 'none (call match_domain_app for user-facing tasks)'}`,
    `Actors: ${plan.actors.join(', ')}`,
    `Capabilities: ${plan.capabilities.join(', ')}`,
    `Entities: ${plan.entities.join(', ') || 'task-specific'}`,
    `Pages: ${plan.pages.join(', ')}`,
    `API routes: ${plan.apiRoutes.join(', ')}`,
    `Database tables: ${plan.databaseTables.join(', ') || 'task-specific'}`,
    `Design system: ${plan.designSystem || 'select with match_design_system before UI implementation'}`,
    `Reference patterns: ${plan.referencePatterns.join(', ') || 'none supplied yet'}`,
    `Frontend plan summary: ${plan.frontendPlanSummary ? `ui_type=${plan.frontendPlanSummary.uiType} patterns=${plan.frontendPlanSummary.patternIds.join(',') || 'none'}` : 'call compose_frontend_plan'}`,
    `Hybrid retrieval sources: ${plan.hybridRetrieval.sources.join(', ')}`,
    `Hybrid decisions: ${plan.hybridRetrieval.decisions.join(' | ')}`,
    '',
    'Vertical slices:',
    ...plan.verticalSlices.map((slice, index) => `${index + 1}. ${slice.capability}: ${slice.steps.join(' -> ')}`),
    '',
    'Verification journeys:',
    ...plan.verificationJourneys.map((journey, index) => `${index + 1}. ${journey.name} [${journey.covers.join(', ')}]: ${journey.steps.join(' -> ')}`),
    '',
    'API contracts:',
    ...plan.apiContracts.map((contract, index) =>
      `${index + 1}. ${contract.method} ${contract.path} — ${contract.purpose}\n` +
      `   capability: ${contract.capability}; auth: ${contract.auth}\n` +
      `   request: ${contract.request}\n` +
      `   response: ${contract.response}\n` +
      `   status codes: ${contract.statusCodes.join(', ')}\n` +
      `   DB expectation: ${contract.dbExpectation}\n` +
      `   failure cases: ${contract.failureCases.join(' | ')}`
    ),
    '',
    'DB state checks (for verify_db_state):',
    ...plan.dbStateChecks.map((check, index) => `${index + 1}. ${check.name} — table=${check.table}; expects=${check.expects}; triggered by ${check.triggeredBy}`),
    '',
    'Browser UI checks (for verify_browser_ui):',
    ...plan.browserUiChecks.map((check, index) =>
      `${index + 1}. ${check.pagePath}\n` +
      `   required_text: ${check.required_text.join(' | ')}\n` +
      `   required_buttons: ${check.required_buttons.join(' | ')}\n` +
      `   form_submission_checks: ${check.form_submission_checks.join(' | ') || 'none'}`
    ),
    '',
    `JSON:\n${JSON.stringify(plan, null, 2)}`,
  ].join('\n');
}
