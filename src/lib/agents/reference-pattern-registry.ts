import type { CapabilityId } from './capability-registry';
import { getCapabilityPack, normalizeCapabilityId } from './capability-registry';
import type { DomainId } from './domain-registry';

export type ReferencePatternPurpose =
  | 'domain_architecture'
  | 'ui_craft'
  | 'accessibility'
  | 'visual_repair'
  | 'dashboard_craft';

export type ReferencePattern = {
  id: string;
  name: string;
  repo: string;
  url: string;
  license: string;
  capabilities: CapabilityId[];
  /**
   * Optional domain IDs this pattern is designed for. Domain-aware
   * match_reference_repos boosts patterns whose `domains` overlap with the
   * caller's `domains` argument, so a "build me an ecommerce store" task
   * gets shopify-style refs rather than the generic shadcn dashboard.
   */
  domains?: DomainId[];
  purpose?: ReferencePatternPurpose;
  qualityAxes?: string[];
  summary: string;
  stack: string[];
  signals: string[];
  usefulFor: string[];
  uiPatterns: string[];
  schemaPatterns: string[];
  apiPatterns: string[];
  componentExamples: string[];
  caution: string[];
};

export type ReferenceMatchInput = {
  title?: string;
  description?: string | null;
  productContext?: string | null;
  actors?: string[];
  workflows?: string[];
  entities?: string[];
  capabilities?: string[];
  designSystem?: string | null;
  /** Optional domain IDs from match_domain_app. Boosts patterns whose
   *  `domains` overlap with the requested set. */
  domains?: string[];
};

export type MatchedReferencePattern = {
  pattern: ReferencePattern;
  score: number;
  reasons: string[];
  mappedCapabilities: CapabilityId[];
};

export type RetrievedComponentExample = {
  referenceId: string;
  repo: string;
  capabilities: CapabilityId[];
  example: string;
  guidance: string;
};

export const REFERENCE_PATTERNS: ReferencePattern[] = [
  {
    id: 'shadcn-dashboard-patterns',
    name: 'shadcn dashboard patterns',
    repo: 'shadcn-ui/ui',
    url: 'https://github.com/shadcn-ui/ui',
    license: 'MIT-style project license; verify upstream before reusing code',
    capabilities: ['dashboard', 'analytics', 'crud', 'admin_workflow'],
    summary: 'Composable dashboard surface patterns using shadcn/ui primitives, dense tables, filters, cards, and command surfaces.',
    stack: ['React', 'Next.js', 'Tailwind CSS', 'shadcn/ui'],
    signals: ['shadcn', 'dashboard', 'admin', 'table', 'filters', 'analytics', 'cards', 'sidebar'],
    usefulFor: ['admin dashboards', 'reporting screens', 'CRM work queues', 'operations consoles'],
    uiPatterns: [
      'Use compact cards for metrics and reserve wide tables for repeated operational work.',
      'Pair filters/search with table state, not separate marketing sections.',
      'Use Tabs, DropdownMenu, Badge, Dialog, and Sheet for dense app controls.',
    ],
    schemaPatterns: [
      'Expose status/date/owner fields needed by table filters.',
      'Use aggregate queries for dashboard totals instead of invented static metrics.',
    ],
    apiPatterns: [
      'Return paginated list data with total counts and filter echo.',
      'Keep metric endpoints bounded by date range and actor role.',
    ],
    componentExamples: [
      'Dashboard shell with sidebar navigation, header actions, summary cards, and data table.',
      'Review queue table with status badges, row actions, and a detail dialog.',
      'Analytics cards backed by real aggregate queries.',
    ],
    caution: [
      'Do not copy sample dashboard content or default chart data.',
      'Avoid generic three-card SaaS hero layouts for operational screens.',
    ],
  },
  {
    id: 'calcom-booking-patterns',
    name: 'Cal.com booking patterns',
    repo: 'calcom/cal.com',
    url: 'https://github.com/calcom/cal.com',
    license: 'AGPL/commercial licensing applies; use only as architectural reference unless license is reviewed',
    capabilities: ['booking', 'auth', 'roles', 'email_notifications', 'dashboard'],
    domains: ['local_service_booking'],
    summary: 'Scheduling product patterns for availability, booking creation, owner/customer views, confirmations, and calendar-like UI.',
    stack: ['Next.js', 'Postgres', 'Prisma', 'React'],
    signals: ['booking', 'calendar', 'slot', 'availability', 'appointment', 'schedule', 'reservation'],
    usefulFor: ['appointment apps', 'resource booking', 'availability management', 'customer scheduling'],
    uiPatterns: [
      'Use a date selector plus explicit available time slots rather than a bare text form.',
      'Show booking status, timezone, attendee, and cancellation state in admin/customer views.',
      'Separate provider availability setup from customer booking flow.',
    ],
    schemaPatterns: [
      'availability_slots with owner, start_at, end_at, timezone, capacity, and active flag.',
      'bookings with slot_id, customer identity, status, created_at, and cancellation fields.',
    ],
    apiPatterns: [
      'Create bookings transactionally and reject an already-booked slot.',
      'Expose available slots as a read endpoint filtered by date and provider.',
    ],
    componentExamples: [
      'Slot picker with date rail, time buttons, timezone label, and confirmation panel.',
      'Admin schedule table grouped by day with status badges and cancel action.',
    ],
    caution: [
      'Do not copy Cal.com code into proprietary apps without license review.',
      'Do not skip double-book prevention just because the UI disables taken slots.',
    ],
  },
  {
    id: 'stripe-billing-sample-patterns',
    name: 'Stripe billing sample patterns',
    repo: 'stripe-samples/checkout-single-subscription',
    url: 'https://github.com/stripe-samples/checkout-single-subscription',
    license: 'sample license; verify upstream before reusing code',
    capabilities: ['payments_stripe', 'auth', 'dashboard'],
    summary: 'Stripe Checkout subscription flow patterns for pricing, checkout session creation, billing status, and webhook persistence.',
    stack: ['Stripe Checkout', 'Node.js', 'React'],
    signals: ['stripe', 'billing', 'checkout', 'subscription', 'pricing', 'payment', 'invoice'],
    usefulFor: ['SaaS subscriptions', 'paid memberships', 'billing dashboards', 'payment-ready flows'],
    uiPatterns: [
      'Pricing/account UI should show plan, billing status, and next action.',
      'Keep checkout initiation as one clear action, not a fake card number form.',
      'Show payment-ready state when live Stripe credentials are not configured.',
    ],
    schemaPatterns: [
      'Persist stripe_customer_id, stripe_subscription_id, plan, and billing_status.',
      'Store webhook event ids or payment_events for idempotency.',
    ],
    apiPatterns: [
      'POST create-checkout-session validates actor and price id.',
      'Webhook verifies Stripe signature and updates billing state idempotently.',
    ],
    componentExamples: [
      'Pricing cards connected to a checkout endpoint.',
      'Account billing panel with current plan, status badge, and manage billing action.',
    ],
    caution: [
      'Do not require Stripe env vars at build time unless the task truly needs live payments.',
      'Never trust client-submitted price or plan without server validation.',
    ],
  },
  {
    domains: ['ecommerce_store', 'real_estate_property'],
    id: 'vercel-commerce-marketplace-patterns',
    name: 'commerce listing patterns',
    repo: 'vercel/commerce',
    url: 'https://github.com/vercel/commerce',
    license: 'MIT-style project license; verify upstream before reusing code',
    capabilities: ['marketplace', 'search', 'payments_stripe', 'dashboard'],
    summary: 'Listing, browse, detail, cart-like selection, and product discovery patterns for commerce or marketplace apps.',
    stack: ['Next.js', 'React', 'Tailwind CSS'],
    signals: ['marketplace', 'listing', 'commerce', 'catalog', 'browse', 'search', 'seller', 'product'],
    usefulFor: ['course marketplaces', 'service directories', 'listing platforms', 'digital product stores'],
    uiPatterns: [
      'Browse page needs search/filter/sort plus listing cards with concrete metadata.',
      'Detail page should carry provider, status, price/access, and primary action.',
      'Admin/vendor views should be separate from buyer browse views.',
    ],
    schemaPatterns: [
      'listings table with owner/provider, title, description, category, status, price/access fields.',
      'profiles/vendors table for supply-side identity and approval state.',
    ],
    apiPatterns: [
      'GET listings supports pagination and filters.',
      'POST/PATCH listing mutations require owner/admin authorization.',
    ],
    componentExamples: [
      'Marketplace browse grid with search, filters, result count, and detail links.',
      'Listing detail page with provider summary, status, access action, and related items.',
    ],
    caution: [
      'Do not reduce a marketplace to a generic lead form.',
      'Do not copy storefront branding or sample data.',
    ],
  },
  {
    id: 'uploadthing-file-manager-patterns',
    name: 'UploadThing file manager patterns',
    repo: 'pingdotgg/uploadthing',
    url: 'https://github.com/pingdotgg/uploadthing',
    license: 'MIT-style project license; verify upstream before reusing code',
    capabilities: ['uploads_storage', 'auth', 'crud', 'admin_workflow'],
    summary: 'Upload widget, file metadata, progress, validation, and storage-backed file management patterns.',
    stack: ['Next.js', 'React', 'Object Storage'],
    signals: ['upload', 'file', 'document', 'pdf', 'attachment', 'storage', 'manager', 'portal'],
    usefulFor: ['document portals', 'media galleries', 'compliance uploads', 'lesson uploads'],
    uiPatterns: [
      'Use a clear upload zone with progress, type limits, and post-upload file rows.',
      'Expose file metadata, status, owner, and remove/replace actions where appropriate.',
      'Pair upload UI with empty, error, and permission states.',
    ],
    schemaPatterns: [
      'files table with owner_id, storage_key, url, mime_type, size_bytes, status, created_at.',
      'Attach files to domain records with a foreign key instead of storing bytes in Postgres.',
    ],
    apiPatterns: [
      'Validate file type and size before accepting metadata.',
      'Write metadata only after storage succeeds or mark pending until upload callback.',
    ],
    componentExamples: [
      'Document upload portal with dropzone, progress row, and recent files table.',
      'Admin document review table with preview link and approve/reject controls.',
    ],
    caution: [
      'Do not store uploaded binary content directly in the relational database.',
      'Do not expose public file URLs for private documents without authorization checks.',
    ],
  },
  {
    id: 'vercel-ai-chatbot-patterns',
    name: 'Vercel AI chatbot patterns',
    repo: 'vercel/ai-chatbot',
    url: 'https://github.com/vercel/ai-chatbot',
    license: 'template/project license; verify upstream before reusing code',
    capabilities: ['ai_openai', 'rag_search', 'auth', 'crud', 'realtime'],
    summary: 'AI chat/result/history patterns for persisted conversations, streaming output, and generated artifact display.',
    stack: ['Next.js', 'Vercel AI SDK', 'React', 'Postgres'],
    signals: ['ai', 'chat', 'assistant', 'summarize', 'document analyzer', 'history', 'stream'],
    usefulFor: ['AI assistants', 'document analyzers', 'lesson summarizers', 'content generators'],
    uiPatterns: [
      'Show prompt/input, generated result, loading state, retry, and persisted history.',
      'For document analysis, split source/document context from extracted result.',
      'Use streaming or progress state only when the endpoint supports it.',
    ],
    schemaPatterns: [
      'ai_runs or conversations/messages tables with user_id, input, output, status, model, created_at.',
      'For RAG, documents and chunks need source metadata and searchable text.',
    ],
    apiPatterns: [
      'AI route validates input, wraps provider call in timeout, persists result, and returns typed errors.',
      'RAG route retrieves sources first and includes source ids or snippets in response.',
    ],
    componentExamples: [
      'AI result panel with source/input on the left and generated summary on the right.',
      'History sidebar or table with previous runs and status badges.',
    ],
    caution: [
      'Do not claim AI output was generated if the provider call failed or was skipped.',
      'Do not answer from model memory when task requires retrieval from uploaded content.',
    ],
  },
  {
    id: 'documenso-approval-portal-patterns',
    name: 'document workflow portal patterns',
    repo: 'documenso/documenso',
    url: 'https://github.com/documenso/documenso',
    license: 'AGPL/commercial licensing applies; use only as architectural reference unless license is reviewed',
    capabilities: ['uploads_storage', 'admin_workflow', 'roles', 'email_notifications', 'dashboard'],
    summary: 'Document workflow patterns for status, ownership, signatures/reviews, audit trails, and notification-ready portals.',
    stack: ['Next.js', 'Postgres', 'React'],
    signals: ['document', 'approval', 'compliance', 'review', 'portal', 'notification', 'workflow'],
    usefulFor: ['vendor compliance portals', 'document review tools', 'approval workflows'],
    uiPatterns: [
      'Use a document list with owner, status, last activity, and review action.',
      'Keep review detail pages focused on document preview/metadata and decision controls.',
      'Show notification-ready state or delivery history when email credentials are absent.',
    ],
    schemaPatterns: [
      'documents table plus approval_reviews/audit_events table.',
      'notification_events table for durable email-ready workflow state.',
    ],
    apiPatterns: [
      'PATCH approval status requires admin role and records reviewer/time/note.',
      'Notification trigger should happen after durable status change.',
    ],
    componentExamples: [
      'Compliance inbox table with status chips and admin decision drawer.',
      'Document detail panel with metadata, upload state, and approval timeline.',
    ],
    caution: [
      'Do not copy AGPL code into closed-source apps without legal approval.',
      'Do not let the UI update status without a server-side role guard.',
    ],
  },
  {
    id: 'inngest-job-workflow-patterns',
    name: 'background job workflow patterns',
    repo: 'inngest/inngest',
    url: 'https://github.com/inngest/inngest',
    license: 'project license varies by package; use only as workflow architecture reference unless license is reviewed',
    capabilities: ['cron_jobs', 'email_notifications', 'external_api', 'analytics'],
    summary: 'Durable background job patterns for scheduled work, retries, idempotency, event history, and operator-visible run status.',
    stack: ['TypeScript', 'Event-driven jobs', 'Cron', 'Queues'],
    signals: ['cron', 'background job', 'scheduled', 'retry', 'workflow', 'nightly', 'queue', 'sync'],
    usefulFor: ['scheduled reports', 'notification digests', 'external API sync jobs', 'long-running workflow status'],
    uiPatterns: [
      'Expose job status, last run, next run, and last error on admin dashboards when jobs are user-visible.',
      'Use timeline or run-history rows for retryable background work.',
    ],
    schemaPatterns: [
      'job_runs with job_key, status, started_at, finished_at, attempt, error, and metadata.',
      'idempotency keys for scheduled work that can be retried safely.',
    ],
    apiPatterns: [
      'Cron endpoint validates a secret and records each run before processing.',
      'Retryable handlers should be idempotent and persist partial progress.',
    ],
    componentExamples: [
      'Admin job monitor table with status badges, next run, duration, and retry action.',
      'Notification digest run history with sent/skipped/failed counts.',
    ],
    caution: [
      'Do not make cron handlers public without a secret or platform auth.',
      'Do not run long jobs inside request paths without timeout and retry strategy.',
    ],
  },
  {
    id: 'resend-email-workflow-patterns',
    name: 'email notification workflow patterns',
    repo: 'resend/react-email',
    url: 'https://github.com/resend/react-email',
    license: 'MIT-style project license; verify upstream before reusing code',
    capabilities: ['email_notifications', 'auth', 'admin_workflow', 'crud'],
    summary: 'Transactional email patterns for template composition, durable notification events, delivery state, and previewable message content.',
    stack: ['React Email', 'TypeScript', 'Transactional Email'],
    signals: ['email', 'notification', 'welcome', 'invite', 'approval email', 'receipt', 'digest'],
    usefulFor: ['approval notifications', 'welcome flows', 'booking confirmations', 'billing emails'],
    uiPatterns: [
      'Show notification-ready or delivery status in admin/detail views when provider credentials are absent.',
      'Provide clear email preference/status surfaces for account-facing products.',
    ],
    schemaPatterns: [
      'notification_events with recipient, template_key, status, provider_message_id, related_entity_id, and error.',
      'Store intended notification before sending so retries and audit are possible.',
    ],
    apiPatterns: [
      'Notification endpoints validate actor role and persist event state before provider call.',
      'Provider failures should mark failed/pending instead of losing the business action.',
    ],
    componentExamples: [
      'Notification history table attached to an approval or booking detail page.',
      'Email preference panel with verified address and notification toggles.',
    ],
    caution: [
      'Do not fake delivered email when credentials are missing; record notification-ready state.',
      'Do not put provider secrets in client bundles.',
    ],
  },
  {
    id: 'sse-realtime-status-patterns',
    name: 'realtime status patterns',
    repo: 'vercel-labs/ai-sdk-preview-roundtrips',
    url: 'https://github.com/vercel-labs/ai-sdk-preview-roundtrips',
    license: 'sample license; verify upstream before reusing code',
    capabilities: ['realtime', 'ai_openai', 'dashboard', 'crud'],
    summary: 'Realtime update patterns for streaming status, server-sent events, optimistic UI, and fallback polling.',
    stack: ['Next.js', 'Server-Sent Events', 'React'],
    signals: ['realtime', 'live', 'stream', 'sse', 'status updates', 'progress', 'polling'],
    usefulFor: ['AI generation progress', 'live dashboards', 'upload processing status', 'workflow progress'],
    uiPatterns: [
      'Show live status with explicit connected/reconnecting/fallback polling states.',
      'Keep optimistic UI reversible when the server rejects or times out.',
    ],
    schemaPatterns: [
      'events or activity table with actor_id, entity_id, event_type, payload, created_at.',
      'Persist final state even if live transport drops.',
    ],
    apiPatterns: [
      'SSE endpoint authenticates the actor and scopes events to allowed resources.',
      'Provide a normal GET endpoint as fallback verification for realtime state.',
    ],
    componentExamples: [
      'Live activity feed with connection status and timestamped events.',
      'AI job progress panel that streams updates then persists final output.',
    ],
    caution: [
      'Do not make realtime the only source of truth; persist state in Postgres.',
      'Do not expose cross-tenant events over a shared stream.',
    ],
  },
  {
    id: 'nango-external-api-sync-patterns',
    name: 'external API integration patterns',
    repo: 'NangoHQ/nango',
    url: 'https://github.com/NangoHQ/nango',
    license: 'project license applies; use only as integration architecture reference unless license is reviewed',
    capabilities: ['external_api', 'cron_jobs', 'auth', 'dashboard'],
    summary: 'External integration patterns for credential state, sync jobs, webhook ingestion, mapping, error handling, and admin visibility.',
    stack: ['TypeScript', 'OAuth', 'Webhooks', 'Postgres'],
    signals: ['external api', 'integration', 'oauth', 'webhook', 'sync', 'import', 'third-party'],
    usefulFor: ['CRM sync', 'calendar sync', 'accounting import', 'third-party webhook ingestion'],
    uiPatterns: [
      'Integration settings should show connected account, scopes, last sync, and disconnect/retry actions.',
      'Admin views should expose sync failures with enough context to repair credentials or mappings.',
    ],
    schemaPatterns: [
      'integration_connections with provider, account_id, status, encrypted credentials reference, scopes, and last_sync_at.',
      'webhook_events or sync_runs table with idempotency key, status, payload hash, and error.',
    ],
    apiPatterns: [
      'Webhook endpoint verifies provider signature and processes idempotently.',
      'Sync endpoint separates credential refresh, fetch, transform, persist, and audit steps.',
    ],
    componentExamples: [
      'Integration settings panel with provider status, last sync, and retry/disconnect actions.',
      'Sync run history table with imported/updated/failed counts.',
    ],
    caution: [
      'Do not block app completion on unsupported third-party credentials unless the task requires live API access.',
      'Do not store raw third-party secrets in plain text.',
    ],
  },
  // ─────────────────────────────────────────────────────────────────────
  // Domain-specific pattern groups (12 — one per goal domain).
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'medusa-ecommerce-patterns',
    name: 'Medusa ecommerce cart/orders patterns',
    repo: 'medusajs/medusa',
    url: 'https://github.com/medusajs/medusa',
    license: 'MIT (per project license at time of writing); confirm before reuse',
    capabilities: ['crud', 'cart_orders_checkout', 'coupons_tax_shipping', 'payment_lifecycle', 'stripe_webhooks', 'admin_workflow', 'dashboard'],
    domains: ['ecommerce_store'],
    summary: 'Modular ecommerce backend patterns: products, variants, cart, order workflows, fulfillment, payment lifecycle, and admin operations.',
    stack: ['TypeScript', 'Postgres', 'Express', 'Admin SPA'],
    signals: ['store', 'storefront', 'product', 'cart', 'checkout', 'order', 'merchant', 'fulfillment'],
    usefulFor: ['ecommerce backend shape', 'cart/order lifecycle', 'admin order ops', 'payment + refund flows'],
    uiPatterns: [
      'Storefront product grid + product detail with variant selector and add-to-cart.',
      'Persistent cart drawer with line items and subtotal.',
      'Admin order list with status filter and detail panel with line items + payments.',
    ],
    schemaPatterns: [
      'products + product_variants + categories; orders + order_items; carts + cart_items; payments + refunds.',
      'order status enum (pending → paid → fulfilled → cancelled); payments status enum (pending → succeeded → failed → refunded).',
    ],
    apiPatterns: [
      'Cart endpoints separate from order endpoints; order created atomically at checkout.',
      'Payment intent created BEFORE Stripe call so DB has pending row; webhook transitions state.',
    ],
    componentExamples: [
      'Storefront product card with image, title, price, and variant CTA.',
      'Cart drawer with editable quantities, subtotal, and checkout CTA.',
      'Admin orders list with status badges, search, and row-click detail.',
    ],
    caution: [
      'Do not copy whole Medusa modules; use as architecture reference only.',
      'Do not trust client-computed cart totals — recompute server-side.',
    ],
  },
  {
    id: 'cal-business-leadcrm-patterns',
    name: 'business marketing site + lead CRM patterns',
    repo: 'calcom/cal.com',
    url: 'https://github.com/calcom/cal.com',
    license: 'AGPL/commercial; use only as architectural reference unless license is reviewed',
    capabilities: ['crud', 'admin_workflow', 'email_notifications', 'seo_public_pages', 'audit_logs', 'dashboard'],
    domains: ['business_website_crm'],
    summary: 'Patterns for public marketing surfaces paired with internal CRM/admin: lead capture forms, pipeline stages, notification on new lead, role separation.',
    stack: ['Next.js', 'Postgres', 'Prisma'],
    signals: ['marketing', 'business site', 'lead', 'leads', 'contact form', 'crm', 'pipeline', 'sales'],
    usefulFor: ['public marketing + internal CRM split', 'lead pipeline UI', 'admin notification flows'],
    uiPatterns: [
      'Public /, /about, /services, /contact rendered server-side with proper meta tags.',
      'Internal CRM at /admin/leads with stage filter, lead detail with notes timeline.',
      'Kanban or stage-grouped table for pipeline.',
    ],
    schemaPatterns: [
      'leads (name, email, phone, message, source, stage)',
      'pipeline_stages; lead_notes; activities (call/email/note types).',
    ],
    apiPatterns: [
      'Public POST /api/leads is rate-limited and validates server-side.',
      'Stage transitions write audit/activity rows.',
    ],
    componentExamples: [
      'Marketing hero + features + lead-capture CTA.',
      'CRM table with stage filter, status badge, and row-click detail with notes.',
    ],
    caution: [
      'Do not gate the homepage behind admin login.',
      'Do not skip rate-limit on public lead form.',
    ],
  },
  {
    id: 'erpnext-inventory-warehouse-patterns',
    name: 'inventory + warehouse operations patterns',
    repo: 'frappe/erpnext',
    url: 'https://github.com/frappe/erpnext',
    license: 'GPLv3; architecture reference only — license incompatibility with closed-source apps; review before reuse',
    capabilities: ['crud', 'admin_workflow', 'import_export_csv', 'audit_logs', 'dashboard', 'roles'],
    domains: ['inventory_operations'],
    summary: 'Operational warehouse patterns: items, locations, movements (stock-in/out), low-stock thresholds, CSV import with row errors, audit logging.',
    stack: ['Python', 'MariaDB/Postgres', 'Frappe framework'],
    signals: ['inventory', 'stock', 'warehouse', 'sku', 'goods receipt', 'stock movement', 'low stock', 'csv import'],
    usefulFor: ['inventory data model', 'movement audit', 'CSV import with per-row errors', 'low-stock alerts'],
    uiPatterns: [
      'Items table with bulk actions, filters, and CSV import/export buttons.',
      'Movement form: pick item + location + delta + reason; validates non-negative result.',
      'Low-stock report with threshold editing and reorder CTA.',
    ],
    schemaPatterns: [
      'items, locations, stock_levels (materialized OR derived), stock_movements append-only.',
      'audit_logs append-only with actor, action, before/after.',
    ],
    apiPatterns: [
      'Stock mutation goes through movement endpoint — never direct UPDATE.',
      'CSV import returns per-row error array, not silent drop.',
    ],
    componentExamples: [
      'Bulk CSV import wizard with preview + error table.',
      'Items table with row-action menu (adjust, delete, view history).',
    ],
    caution: [
      'GPLv3 — architecture reference only; do not copy code into a closed-source app.',
      'Do not mutate stock level directly; always go through movements.',
    ],
  },
  {
    id: 'construction-ops-board-patterns',
    name: 'construction project operations patterns',
    repo: 'reference-pattern-only',
    url: 'https://github.com/topics/construction-management',
    license: 'pattern-only — no upstream repo, document architecture rather than copy code',
    capabilities: ['crud', 'admin_workflow', 'audit_logs', 'dashboard', 'roles', 'uploads_storage'],
    domains: ['construction_operations'],
    summary: 'Project tracking with tabbed surfaces (overview / schedule / bids / safety / equipment). Equipment uniqueness constraints. Safety log severity. Subcontractor relations.',
    stack: ['any web stack — pattern shape, not code'],
    signals: ['construction', 'project management', 'bid', 'estimate', 'jobsite', 'safety log', 'subcontractor', 'equipment', 'schedule'],
    usefulFor: ['multi-tab project detail', 'bid/estimate workflow', 'safety log entry', 'equipment assignment'],
    uiPatterns: [
      'Project list cards with status + key dates.',
      'Tabbed project detail: Overview / Schedule / Bids / Safety / Equipment.',
      'Safety log with severity badge and incident timeline.',
      'Equipment table with current-project column (one-at-a-time constraint).',
    ],
    schemaPatterns: [
      'projects, bids, estimates, schedule_entries, safety_logs (severity), equipment, equipment_assignments (unique active per equipment).',
      'project status: planning → active → complete; bid status: draft → submitted → won/lost.',
    ],
    apiPatterns: [
      'Bid status transitions explicit + audited.',
      'Equipment double-assign rejected at DB level (partial unique index).',
    ],
    componentExamples: [
      'Tabbed project detail with consistent layout per tab.',
      'Safety log entry form with category + severity selector.',
    ],
    caution: [
      'No specific upstream repo — document the patterns, do not copy code.',
      'Do not collapse to a single "tasks" table — each entity has distinct lifecycle.',
    ],
  },
  {
    id: 'lemmy-social-community-patterns',
    name: 'social community / forum patterns',
    repo: 'LemmyNet/lemmy',
    url: 'https://github.com/LemmyNet/lemmy',
    license: 'AGPLv3 — architecture reference only',
    capabilities: ['auth', 'roles', 'crud', 'admin_workflow', 'search', 'realtime', 'notification_preferences'],
    domains: ['social_community'],
    summary: 'Feed/post/comment/reaction patterns with moderation queue, reports, notifications, and community-scoped feeds.',
    stack: ['Rust + TypeScript', 'Postgres', 'WebSocket'],
    signals: ['feed', 'post', 'thread', 'comment', 'community', 'forum', 'moderation', 'report', 'notification'],
    usefulFor: ['feed retrieval', 'comment threading', 'moderation queue UX', 'notification fan-out'],
    uiPatterns: [
      'Feed of post cards with author + body + reaction + comment count.',
      'Post detail with threaded comment view.',
      'Moderation queue table with report reason + action buttons.',
      'Notification list grouped by type with unread badge.',
    ],
    schemaPatterns: [
      'posts, comments (parent_id for threading), reactions (unique on (user, post)), follows, mentions, notifications, reports, mod_actions.',
      'community-scoped feeds via community_id FK.',
    ],
    apiPatterns: [
      'Cursor-based pagination (not offset) for feeds.',
      'Reaction toggle idempotent via UNIQUE constraint.',
      'Report queue surfaces unresolved + actioned tabs.',
    ],
    componentExamples: [
      'Feed card with reaction button (aria-pressed), comment count, share action.',
      'Mod queue table with action dropdown.',
    ],
    caution: [
      'AGPL — architecture reference only.',
      'Do not load full feed without cursor pagination — kills perf.',
    ],
  },
  {
    id: 'real-estate-listing-patterns',
    name: 'real estate listings patterns',
    repo: 'reference-pattern-only',
    url: 'https://github.com/topics/real-estate',
    license: 'pattern-only — describe architecture, do not copy any specific repo',
    capabilities: ['crud', 'auth', 'roles', 'search', 'admin_workflow', 'uploads_storage', 'email_notifications', 'seo_public_pages'],
    domains: ['real_estate_property'],
    summary: 'Listings index + detail with filters, photo gallery, agent contact, inquiry form, saved listings, and admin approval queue.',
    stack: ['any web stack — pattern shape, not code'],
    signals: ['real estate', 'property', 'listing', 'rental', 'sale', 'tour request', 'open house', 'agent', 'mls'],
    usefulFor: ['listings index with filters', 'listing detail with gallery', 'inquiry form', 'agent vs admin roles'],
    uiPatterns: [
      'Listings grid with filter rail (city/price/beds/baths) and result count.',
      'Listing detail with photo carousel + key facts + agent card + inquiry form.',
      'Saved listings view in user account.',
      'Admin approval queue for new listings.',
    ],
    schemaPatterns: [
      'properties (status: draft/pending/approved/rejected), photos, agents, inquiries, saved_properties, agent_approvals.',
    ],
    apiPatterns: [
      'Search uses filtered SQL with paginated results.',
      'Inquiry creates row even when email service unconfigured.',
      'Approval flow gates public visibility.',
    ],
    componentExamples: [
      'Listing card with hero photo + price + key facts.',
      'Inquiry form with name/email/phone/message/tour-date and rate-limit/honeypot.',
    ],
    caution: [
      'Approval must gate public visibility — never list pending properties.',
      'Carousel + map must be keyboard accessible.',
    ],
  },
  {
    id: 'health-fitness-tracker-patterns',
    name: 'health / fitness / meal plan tracker patterns',
    repo: 'reference-pattern-only',
    url: 'https://github.com/topics/fitness-tracker',
    license: 'pattern-only — architecture description, not a specific code source',
    capabilities: ['auth', 'crud', 'dashboard', 'cron_jobs'],
    domains: ['health_fitness_food'],
    summary: "Per-user plans, log entries (workouts/meals), progress tracking with streaks, goals + preferences, mobile-first today view.",
    stack: ['any web stack with mobile-first UI'],
    signals: ['fitness', 'workout', 'meal plan', 'recipe', 'nutrition', 'health', 'streak', 'progress'],
    usefulFor: ['plan generation persistence', 'log entry forms', 'streak/progress charts', 'preferences UI'],
    uiPatterns: [
      "Today view as logged-in homepage with plan content.",
      'Log entry forms mobile-first with large touch targets.',
      'Progress page with line charts for streak/weight/calories.',
      'Preferences for diet restrictions / units / goals.',
    ],
    schemaPatterns: [
      'plans, workouts, recipes, workout_logs (append-only), meal_logs, measurements, preferences, goals (separate from preferences).',
    ],
    apiPatterns: [
      'Plan generation persists a concrete plan record, not just template.',
      'Timezone handled via TIMESTAMPTZ + user preference; logs anchored to date with TZ.',
    ],
    componentExamples: [
      'Daily plan card with mark-complete actions.',
      'Streak card with current/best streak counters.',
    ],
    caution: [
      'Logged-in homepage must be today plan — not an admin dashboard.',
      'Logs must not get lost across timezones (frequent bug).',
    ],
  },
  {
    id: 'lms-education-content-patterns',
    name: 'education / LMS patterns',
    repo: 'moodle/moodle',
    url: 'https://github.com/moodle/moodle',
    license: 'GPL — architecture reference only',
    capabilities: ['auth', 'roles', 'crud', 'rich_text_cms', 'admin_workflow', 'dashboard'],
    domains: ['education_content'],
    summary: 'Course catalog + module/lesson outline + lesson content + progress tracking + instructor authoring + publish workflow.',
    stack: ['PHP', 'MySQL/Postgres', 'Moodle plugins'],
    signals: ['course', 'lesson', 'module', 'curriculum', 'enrollment', 'progress', 'quiz', 'lms'],
    usefulFor: ['LMS data model', 'rich content authoring', 'publish workflow', 'progress tracking'],
    uiPatterns: [
      'Course catalog cards with instructor + duration + level.',
      'Course detail with module accordion + lesson list.',
      'Lesson view with content body + mark-complete + previous/next nav.',
      'Instructor authoring with rich-text editor (Markdown OR structured JSON, NOT raw HTML).',
    ],
    schemaPatterns: [
      'courses (published_at NULL = draft), modules, lessons (body as Markdown/JSON), enrollments, progress (unique on (user, lesson)), quizzes + submissions (immutable when graded).',
    ],
    apiPatterns: [
      'Draft courses excluded from public /courses.',
      'Mark-complete is idempotent (one row per (user, lesson)).',
      'Quiz submission row immutable after grading.',
    ],
    componentExamples: [
      'Course outline accordion grouped by module.',
      'Progress bar component per enrolled course.',
    ],
    caution: [
      'Never store lesson body as raw HTML — XSS risk.',
      'Drafts must not leak into public catalog.',
    ],
  },
  {
    id: 'creator-portfolio-platform-patterns',
    name: 'media / creator portfolio platform patterns',
    repo: 'reference-pattern-only',
    url: 'https://github.com/topics/creator-economy',
    license: 'pattern-only — architecture description',
    capabilities: ['auth', 'roles', 'crud', 'uploads_storage', 'payments_stripe', 'file_privacy_validation', 'stripe_webhooks', 'dashboard'],
    domains: ['media_creator'],
    summary: 'Creator landing pages, gallery grid, gated/premium media with subscription tiers, creator admin dashboard.',
    stack: ['any web stack with object storage + payments'],
    signals: ['creator', 'portfolio', 'gallery', 'gated content', 'subscription tier', 'premium', 'photographer', 'streamer'],
    usefulFor: ['public creator profile shape', 'gated content access patterns', 'subscription/tier UX'],
    uiPatterns: [
      'Public creator profile with bio + subscribe + featured media.',
      'Gallery grid with free/premium tabs and gated overlay on premium tiles.',
      'Creator dashboard with uploads + subscriber count + revenue.',
    ],
    schemaPatterns: [
      'creators, media_items (visibility: public/premium/private), collections, subscriptions, tiers, fans.',
    ],
    apiPatterns: [
      'Gated content access checked server-side on every fetch — not just UI hide.',
      'Upload metadata persists even when blob storage credentials missing.',
    ],
    componentExamples: [
      'Subscribe CTA with tier comparison.',
      'Gated media tile with lock icon + unlock CTA.',
    ],
    caution: [
      'Direct-URL bypass for gated media is the most common failure — always verify server-side.',
      'Public creator profile must work without auth.',
    ],
  },
  {
    id: 'finance-dashboard-patterns',
    name: 'finance / crypto portfolio dashboard patterns',
    repo: 'tradingview/lightweight-charts',
    url: 'https://github.com/tradingview/lightweight-charts',
    license: 'Apache-2.0 (chart library); architecture inspiration only',
    capabilities: ['auth', 'crud', 'dashboard', 'external_api', 'cron_jobs', 'analytics', 'security_ops'],
    domains: ['finance_crypto'],
    summary: 'Portfolio summary + holdings + price chart + alerts + transaction history with stale-data safety on external API failure.',
    stack: ['TypeScript', 'Chart library', 'External price API'],
    signals: ['portfolio', 'crypto', 'token', 'price alert', 'watchlist', 'pnl', 'market data', 'transaction history'],
    usefulFor: ['portfolio summary UX', 'price chart integration', 'alert evaluation patterns', 'stale-data UI safety'],
    uiPatterns: [
      'Summary cards: total value, 24h change, allocation pie (real values only).',
      'Price chart with stale-data indicator when feed is down.',
      'Alert form: instrument + condition + threshold.',
      'Transaction list with running balance.',
    ],
    schemaPatterns: [
      'portfolios, holdings, transactions, price_alerts, watchlists, price_snapshots (persisted, never recompute from external API).',
    ],
    apiPatterns: [
      'External market data behind cached fetch + retry with backoff.',
      'Alert evaluation runs in cron, NOT on each request.',
      'Last-updated timestamp on prices surfaced in UI.',
    ],
    componentExamples: [
      'Metric card with stale-data badge when last_updated > threshold.',
      'Alert row with active toggle + last triggered.',
    ],
    caution: [
      'Never invent portfolio values when data is missing — show empty state with CTA.',
      'Show "not financial advice" + delay disclaimer when displaying market data.',
    ],
  },
  {
    id: 'tiptap-cms-block-editor-patterns',
    name: 'CMS / block editor patterns',
    repo: 'ueberdosis/tiptap',
    url: 'https://github.com/ueberdosis/tiptap',
    license: 'MIT (per project license); confirm before reuse',
    capabilities: ['rich_text_cms', 'crud', 'auth', 'roles', 'admin_workflow', 'seo_public_pages'],
    domains: ['education_content', 'business_website_crm', 'media_creator'],
    summary: 'Structured rich-text / block editor patterns for safe content authoring with version history.',
    stack: ['TypeScript', 'ProseMirror', 'React'],
    signals: ['rich text', 'wysiwyg', 'block editor', 'cms', 'blog', 'markdown', 'tiptap'],
    usefulFor: ['safe content storage shape', 'editor toolbar UX', 'revision history'],
    uiPatterns: [
      'Editor with formatting toolbar (bold, italic, list, heading, code).',
      'Side-by-side or toggle preview render.',
      'Auto-save indicator + manual save button.',
    ],
    schemaPatterns: [
      'content stored as structured JSON (preferred) OR Markdown — NEVER raw HTML.',
      'content_versions table for revision history when needed.',
    ],
    apiPatterns: [
      'Sanitize/validate content on write.',
      'Render via safe markdown-to-html or block renderer (no innerHTML of user input).',
    ],
    componentExamples: [
      'Editor toolbar with primary formatting buttons + image insert.',
      'Render component that safely transforms stored JSON to HTML.',
    ],
    caution: [
      'XSS is the #1 failure here — never trust input HTML.',
      'Auto-save must not silently swallow errors.',
    ],
  },
  {
    id: 'llamaindex-rag-pipeline-patterns',
    name: 'advanced AI / RAG pipeline patterns',
    repo: 'run-llama/llama_index',
    url: 'https://github.com/run-llama/llama_index',
    license: 'MIT (per project license); confirm before reuse',
    capabilities: ['ai_openai', 'rag_search', 'long_running_ai_jobs', 'queue_workers', 'ai_safety_cost_controls', 'uploads_storage', 'cron_jobs'],
    domains: ['advanced_ai_mixed'],
    summary: 'Upload → chunk → embed → index → retrieve → answer pipeline patterns with job persistence, retry-from-step, and rate-limit safety.',
    stack: ['Python (reference)', 'Vector DB', 'LLM gateway'],
    signals: ['rag', 'embeddings', 'vector', 'document analysis', 'pipeline', 'extract', 'long ai', 'background ai'],
    usefulFor: ['RAG pipeline shape', 'multi-step job orchestration', 'cost-capped AI flows'],
    uiPatterns: [
      'Job list with status badge + retry per row.',
      'Per-step progress (upload → chunk → embed → retrieve → answer).',
      'Result detail with structured output + raw JSON toggle.',
    ],
    schemaPatterns: [
      'uploads, jobs (status enum + attempts + payload), ai_runs (per step), document_chunks (with embedding when vector indexed), results.',
      'persistence after each step so retry resumes from last good step.',
    ],
    apiPatterns: [
      'AI calls inside background worker, never inside HTTP handler.',
      'Rate limit + daily spend cap per user BEFORE call.',
      'External AI failure → job moves to failed with reason; manual retry from step.',
    ],
    componentExamples: [
      'Job detail view with step timeline + retry button per step.',
      'Result viewer with structured + raw views.',
    ],
    caution: [
      'Never run AI synchronously inside an HTTP request — it will time out.',
      'For founder apps use the fixed Gemini embedding contract (gemini-embedding-001 + vector(3072)) — never hardcode text-embedding-004.',
    ],
  },
  {
    id: 'open-codesign-design-agent-patterns',
    name: 'Open CoDesign design-agent workflow patterns',
    repo: 'OpenCoworkAI/open-codesign',
    url: 'https://github.com/OpenCoworkAI/open-codesign',
    license: 'MIT; use as design-workflow reference only, do not import runtime code',
    capabilities: ['dashboard', 'crud', 'analytics', 'seo_public_pages'],
    purpose: 'ui_craft',
    qualityAxes: ['design brief', 'preview loop', 'multi-viewport self-check', 'design memory'],
    summary: 'Design-agent workflow patterns for turning product intent into a concrete visual brief, previewing, critiquing, and iterating before completion.',
    stack: ['Design agent workflow', 'React', 'Tailwind CSS', 'multi-model UI iteration'],
    signals: ['design agent', 'codesign', 'co-design', 'ui blueprint', 'frontend blueprint', 'visual brief', 'design memory', 'design guideline', 'world-class ui', 'ai slop', 'generic ui'],
    usefulFor: ['UI blueprint before implementation', 'design memory for canary tasks', 'multi-viewport design self-check', 'anti-generic visual planning'],
    uiPatterns: [
      'Create a short product-specific UI blueprint before coding major user-facing surfaces.',
      'Carry a design memory through implementation: typography, spacing, interaction tone, and viewport expectations.',
      'Use preview/self-check feedback to repair the exact visual issue instead of restyling unrelated pages.',
    ],
    schemaPatterns: [
      'No application schema pattern; this reference informs planning artifacts and verification evidence.',
    ],
    apiPatterns: [
      'No API pattern; use it to improve planning discipline before UI implementation.',
    ],
    componentExamples: [
      'Design brief with product audience, layout intent, visual rules, and verification checklist.',
      'Preview loop: screenshot -> critique -> targeted patch -> repeat until blockers are gone.',
    ],
    caution: [
      'Pattern-only: do not add Open CoDesign as a dependency inside generated founder apps.',
      'Do not let a design-agent workflow replace browser verification or DB/API proof.',
    ],
  },
  {
    id: 'onlook-visual-repair-patterns',
    name: 'Onlook visual repair patterns',
    repo: 'onlook-dev/onlook',
    url: 'https://github.com/onlook-dev/onlook',
    license: 'project license applies; use as visual repair workflow reference only',
    capabilities: ['dashboard', 'crud', 'admin_workflow'],
    purpose: 'visual_repair',
    qualityAxes: ['DOM-to-component tracing', 'exact-surface repair', 'visual diff mindset', 'targeted CSS patch'],
    summary: 'Visual repair workflow patterns for mapping a browser-visible defect to the exact component/style, patching only that surface, and rechecking in-browser.',
    stack: ['React', 'Tailwind CSS', 'visual editor workflow'],
    signals: ['visual repair', 'onlook', 'button contrast', 'white button', 'dropdown invisible', 'select invisible', 'unreadable', 'contrast', 'browser ui fail', 'exact failing surface', 'dom to code'],
    usefulFor: ['white-on-white button fixes', 'dropdown/select visibility repair', 'targeted visual bug repair', 'browser screenshot driven fixes'],
    uiPatterns: [
      'Treat screenshot failures as element-level bugs: identify the visible label, route, and component before patching.',
      'Patch the smallest component/style that owns the failing control, then rerun the same browser check.',
      'Preserve working layout and data flow while fixing contrast or interaction affordance.',
    ],
    schemaPatterns: [
      'No schema pattern; use for visual repair only.',
    ],
    apiPatterns: [
      'No API pattern; pair visual repair with existing interaction/DB proof when the control submits data.',
    ],
    componentExamples: [
      'Unreadable action button repair: locate button by accessible name, inspect text/background, patch variant tokens, rerun contrast.',
      'Dropdown repair: locate select/listbox/menu options, patch option foreground/background/focus state, rerun browser visual audit.',
    ],
    caution: [
      'Do not perform a broad redesign for a narrow contrast bug.',
      'Do not count a fixed-looking button as working until interaction proof/readback passes when it submits data.',
    ],
  },
  {
    id: 'radix-accessibility-primitives',
    name: 'Radix accessibility primitive patterns',
    repo: 'radix-ui/primitives',
    url: 'https://github.com/radix-ui/primitives',
    license: 'MIT; verify upstream before reusing code',
    capabilities: ['dashboard', 'crud', 'auth', 'admin_workflow'],
    purpose: 'accessibility',
    qualityAxes: ['keyboard navigation', 'focus management', 'ARIA semantics', 'accessible overlays'],
    summary: 'Accessible primitive patterns for dropdowns, selects, dialogs, popovers, menus, focus trapping, and keyboard-first UI behavior.',
    stack: ['React', 'Headless UI primitives', 'ARIA'],
    signals: ['radix', 'accessibility', 'a11y', 'dropdown', 'select', 'dialog', 'popover', 'menu', 'keyboard', 'focus', 'aria', 'screen reader'],
    usefulFor: ['dropdown/select/menu implementation', 'modal/dialog focus safety', 'keyboard navigation', 'accessible shadcn-style controls'],
    uiPatterns: [
      'Use real button/menu/select semantics with accessible names and visible focus states.',
      'Dropdown and select options need readable foreground/background in rest, hover, focus, and selected states.',
      'Dialogs/popovers must trap focus, close predictably, and expose labels/descriptions.',
    ],
    schemaPatterns: [
      'No schema pattern; this reference informs component behavior and verification.',
    ],
    apiPatterns: [
      'No API pattern; UI state must still submit through typed backend actions when data changes.',
    ],
    componentExamples: [
      'Dropdown menu with trigger label, keyboard navigation, readable focused item, and deterministic close behavior.',
      'Dialog form with labelled inputs, visible submit/cancel actions, focus trap, and error/readback state.',
    ],
    caution: [
      'Do not use divs with click handlers for controls that need keyboard or screen-reader support.',
      'Do not hide labels just because icons are visible; icon-only controls require aria-label/title.',
    ],
  },
  {
    id: 'tremor-analytics-dashboard-patterns',
    name: 'Tremor analytics dashboard patterns',
    repo: 'tremorlabs/tremor',
    url: 'https://github.com/tremorlabs/tremor',
    license: 'MIT; verify upstream before reusing code',
    capabilities: ['dashboard', 'analytics', 'crud'],
    purpose: 'dashboard_craft',
    qualityAxes: ['KPI hierarchy', 'chart clarity', 'table density', 'empty/stale states'],
    summary: 'Analytics dashboard composition patterns for KPI cards, charts, tables, filters, and data-status states.',
    stack: ['React', 'Tailwind CSS', 'Charts'],
    signals: ['tremor', 'analytics dashboard', 'kpi', 'chart', 'metric card', 'dashboard metrics', 'reporting', 'insights', 'data table'],
    usefulFor: ['analytics dashboards', 'KPI-heavy admin screens', 'reporting pages', 'chart/table composition'],
    uiPatterns: [
      'Lead with a small number of real KPIs, then expose trend/detail tables below.',
      'Charts need labels, time range, empty state, and stale/error state instead of fake data.',
      'Use compact spacing and predictable table filters for repeat operational use.',
    ],
    schemaPatterns: [
      'Persist metric source rows and derive aggregates from bounded queries.',
      'Store last_updated/source metadata when metrics come from external systems.',
    ],
    apiPatterns: [
      'Metric endpoints return totals, ranges, and source freshness.',
      'Chart endpoints should bound date ranges and never invent missing values.',
    ],
    componentExamples: [
      'KPI card row with trend labels and accessible deltas.',
      'Dashboard section with filter controls, chart, and backing table.',
    ],
    caution: [
      'Do not ship dashboards with static demo numbers.',
      'Do not make color the only signal for chart status or deltas.',
    ],
  },
  {
    id: 'dub-saas-dashboard-patterns',
    name: 'Dub SaaS dashboard patterns',
    repo: 'dubinc/dub',
    url: 'https://github.com/dubinc/dub',
    license: 'AGPLv3/open-core; architecture and UI pattern reference only unless license is reviewed',
    capabilities: ['dashboard', 'analytics', 'auth', 'payments_stripe', 'teams_workspaces', 'email_notifications'],
    purpose: 'dashboard_craft',
    qualityAxes: ['SaaS navigation', 'settings/account UX', 'billing surface', 'analytics polish'],
    summary: 'Polished SaaS dashboard patterns for workspace navigation, account/settings, billing-ready surfaces, analytics, and operational empty states.',
    stack: ['Next.js', 'TypeScript', 'Tailwind CSS', 'Prisma', 'Stripe'],
    signals: ['dub', 'saas dashboard', 'workspace', 'settings', 'account', 'billing', 'pricing', 'analytics', 'team', 'invite'],
    usefulFor: ['SaaS dashboards', 'billing/account UI', 'team/workspace settings', 'analytics-led tools'],
    uiPatterns: [
      'Use a durable app shell with sidebar/topbar, workspace switcher, settings, and clear primary action.',
      'Account and billing pages should show current plan/status and next action, not a generic pricing card only.',
      'Empty states should teach the next action and link to the creation flow.',
    ],
    schemaPatterns: [
      'workspaces, memberships, invitations, plan/billing status, usage events.',
    ],
    apiPatterns: [
      'Workspace-scoped APIs validate membership before reads/writes.',
      'Billing actions create durable pending events before external checkout redirects.',
    ],
    componentExamples: [
      'Workspace dashboard shell with analytics cards, table, filters, and primary create action.',
      'Settings/account page with team members, invites, billing status, and danger zone.',
    ],
    caution: [
      'License-sensitive: use as pattern guidance only.',
      'Do not copy branding, marketing copy, or full app structure.',
    ],
  },
  {
    id: 'midday-business-ops-patterns',
    name: 'Midday business ops patterns',
    repo: 'midday-ai/midday',
    url: 'https://github.com/midday-ai/midday',
    license: 'AGPL/commercial terms may apply; use as pattern reference only unless license is reviewed',
    capabilities: ['dashboard', 'analytics', 'uploads_storage', 'ai_openai', 'external_api', 'crud'],
    domains: ['business_website_crm', 'finance_crypto'],
    purpose: 'dashboard_craft',
    qualityAxes: ['business ops workbench', 'finance/file surfaces', 'assistant panel', 'dense utility UI'],
    summary: 'Business operations UI patterns for finance overview, files, invoices/time tracking, reconciliation, integrations, and assistant-style workbench surfaces.',
    stack: ['Next.js', 'TypeScript', 'Tailwind CSS', 'Postgres', 'AI assistant'],
    signals: ['midday', 'business ops', 'finance overview', 'invoice', 'time tracking', 'file reconciliation', 'assistant', 'workbench', 'documents'],
    usefulFor: ['business ops dashboards', 'finance/file portals', 'AI-assisted back-office tools', 'integration-heavy workbenches'],
    uiPatterns: [
      'Group business workflows into a workbench with clear modules instead of a single generic dashboard.',
      'File/finance rows need status, owner/source, last activity, and clear next action.',
      'Assistant panels should sit beside durable history/results, not replace app navigation.',
    ],
    schemaPatterns: [
      'documents/files, transactions, invoices, customers/vendors, reconciliation status, ai_runs.',
    ],
    apiPatterns: [
      'External integration syncs write durable source/status rows before UI display.',
      'AI assistant actions persist input/output/status and link to affected records.',
    ],
    componentExamples: [
      'Business workbench layout with finance overview, files, and assistant/history panel.',
      'Document/transaction reconciliation table with status badges and action drawer.',
    ],
    caution: [
      'License-sensitive: do not copy code or product-specific implementation.',
      'Do not hide operational complexity behind a decorative landing page.',
    ],
  },
  {
    id: 'twenty-crm-workspace-patterns',
    name: 'Twenty CRM workspace patterns',
    repo: 'twentyhq/twenty',
    url: 'https://github.com/twentyhq/twenty',
    license: 'AGPL-style/open-source CRM project; use as architecture/UI pattern reference only unless license is reviewed',
    capabilities: ['dashboard', 'crud', 'admin_workflow', 'roles', 'teams_workspaces', 'search'],
    domains: ['business_website_crm'],
    purpose: 'dashboard_craft',
    qualityAxes: ['object views', 'pipeline UX', 'filters/saved views', 'workspace navigation'],
    summary: 'CRM/workspace UI patterns for contacts, companies, opportunities, pipelines, filters, object detail views, and dense business workflows.',
    stack: ['React', 'TypeScript', 'GraphQL', 'Postgres'],
    signals: ['twenty', 'crm', 'pipeline', 'contacts', 'companies', 'deals', 'opportunities', 'workspace', 'object view', 'saved views'],
    usefulFor: ['CRM apps', 'business object workspaces', 'pipeline dashboards', 'admin data tools'],
    uiPatterns: [
      'Use object-list plus detail-drawer/page patterns for dense CRUD instead of isolated forms.',
      'Pipeline views should show stage, owner, amount/status, and next activity.',
      'Filters/saved views are first-class UI for repeated business work.',
    ],
    schemaPatterns: [
      'contacts, companies/accounts, opportunities/deals, stages, activities, notes, saved_views.',
    ],
    apiPatterns: [
      'List APIs support filters, sort, search, pagination, and field projections.',
      'Stage/status updates write activity/audit entries.',
    ],
    componentExamples: [
      'CRM object table with filters, row actions, and detail drawer.',
      'Pipeline board/list with stage movement and activity readback.',
    ],
    caution: [
      'License-sensitive: use as pattern reference only.',
      'Do not turn every business app into CRM; apply only when object/workspace signals are present.',
    ],
  },
];

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
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

function normalizeCapabilities(capabilities?: string[]): CapabilityId[] {
  return unique((capabilities ?? [])
    .map(normalizeCapabilityId)
    .map((id) => getCapabilityPack(id)?.id)
    .filter((id): id is CapabilityId => !!id));
}

function inputText(input: ReferenceMatchInput): string {
  return [
    input.title,
    input.description,
    input.productContext,
    input.designSystem,
    input.actors?.join(' '),
    input.workflows?.join(' '),
    input.entities?.join(' '),
    input.capabilities?.join(' '),
    input.domains?.join(' '),
  ].filter(Boolean).join('\n').toLowerCase();
}

function isUiQualityPattern(pattern: ReferencePattern): boolean {
  return Boolean(pattern.purpose && pattern.purpose !== 'domain_architecture');
}

function hasUiQualitySignal(text: string): boolean {
  return /\b(ui|frontend|front-end|design|visual|browser|button|dropdown|select|dialog|popover|menu|accessib|a11y|keyboard|focus|responsive|mobile|dashboard|chart|analytics|kpi|crm|saas|settings|billing|workspace|portal|marketplace|listing|ecommerce|store|booking|scheduling|document|upload|course|customer|admin views?|form|canary|world-class|world class|polish|contrast|unreadable|starter shell|ai slop|generic ui)\b/i.test(text);
}

const USER_FACING_REFERENCE_CAPABILITIES = new Set<CapabilityId>([
  'dashboard',
  'admin_workflow',
  'marketplace',
  'booking',
  'payments_stripe',
  'cart_orders_checkout',
  'coupons_tax_shipping',
  'payment_lifecycle',
  'uploads_storage',
  'ai_openai',
  'rag_search',
  'analytics',
  'rich_text_cms',
  'teams_workspaces',
  'seo_public_pages',
  'search',
]);

function shouldEnsureUiQualityReference(text: string, requestedCapabilities: CapabilityId[]): boolean {
  if (!hasUiQualitySignal(text)) return false;
  return requestedCapabilities.some((capability) => USER_FACING_REFERENCE_CAPABILITIES.has(capability));
}

function uiPurposeBoost(purpose: ReferencePatternPurpose | undefined, text: string): { score: number; reason: string | null } {
  if (purpose === 'visual_repair' && /\b(visual|contrast|unreadable|white[-\s]?on[-\s]?white|button|dropdown|select|browser ui fail|exact failing surface|screenshot)\b/i.test(text)) {
    return { score: 14, reason: 'visual repair reference for failing rendered control' };
  }
  if (purpose === 'accessibility' && /\b(accessib|a11y|dropdown|select|dialog|popover|menu|keyboard|focus|aria|screen reader|icon-only|icon only)\b/i.test(text)) {
    return { score: 14, reason: 'accessibility primitive reference for controls' };
  }
  if (purpose === 'dashboard_craft' && /\b(dashboard|analytics|chart|kpi|metric|crm|pipeline|saas|settings|billing|business ops|finance|workspace|table|filters?)\b/i.test(text)) {
    return { score: 9, reason: 'dashboard craft reference for dense app UI' };
  }
  if (purpose === 'ui_craft' && /\b(ui|frontend|design|visual|blueprint|world[-\s]?class|canary|generic|ai slop|design system|preview|critique)\b/i.test(text)) {
    return { score: 9, reason: 'UI craft reference for design planning' };
  }
  return { score: 0, reason: null };
}

export function matchReferenceRepos(input: ReferenceMatchInput, limit = 6): MatchedReferencePattern[] {
  const text = inputText(input);
  const tokens = tokenize(text);
  const requestedCapabilities = normalizeCapabilities(input.capabilities);
  const requestedDomains = new Set((input.domains ?? []).map((id) => id.trim()).filter(Boolean));
  const uiQualityRequested = hasUiQualitySignal(text);

  const ensureUiQualityReference = shouldEnsureUiQualityReference(text, requestedCapabilities);

  const matches = REFERENCE_PATTERNS.map((pattern) => {
    const reasons: string[] = [];
    let score = 0;
    const uiQualityPattern = isUiQualityPattern(pattern);

    const capabilityOverlap = requestedCapabilities.filter((capability) => pattern.capabilities.includes(capability));
    if (capabilityOverlap.length > 0) {
      const weight = uiQualityPattern ? (uiQualityRequested ? 4 : 0) : 8;
      if (weight > 0) {
        score += capabilityOverlap.length * weight;
        reasons.push(`maps to capabilities: ${capabilityOverlap.join(', ')}`);
      }
    }

    const domainOverlap = (pattern.domains ?? []).filter((domain) => requestedDomains.has(domain));
    if (domainOverlap.length > 0) {
      score += domainOverlap.length * 10;
      reasons.push(`maps to domains: ${domainOverlap.join(', ')}`);
    }

    const purposeBoost = uiPurposeBoost(pattern.purpose, text);
    if (purposeBoost.score > 0) {
      score += purposeBoost.score;
      if (purposeBoost.reason) reasons.push(purposeBoost.reason);
    }

    for (const signal of pattern.signals) {
      if (signalMatches(text, tokens, signal)) {
        score += signal.includes(' ') ? 5 : 3;
        reasons.push(`matched "${signal}"`);
      }
    }

    for (const phrase of pattern.usefulFor) {
      const phraseTokens = phrase.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) ?? [];
      const hits = phraseTokens.filter((word) => tokens.has(word)).length;
      if (hits >= Math.min(2, phraseTokens.length)) {
        score += hits;
        reasons.push(`useful for ${phrase}`);
      }
    }

    if (pattern.id.includes('shadcn') && /ui|frontend|dashboard|admin|portal|app/.test(text)) {
      score += 4;
      reasons.push('baseline shadcn UI reference for user-facing app');
    }

    return {
      pattern,
      score,
      reasons: unique(reasons).slice(0, 6),
      mappedCapabilities: capabilityOverlap,
    };
  })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.pattern.id.localeCompare(b.pattern.id));

  const resolvedLimit = Math.max(1, Math.min(limit, REFERENCE_PATTERNS.length));
  const selected = matches.slice(0, resolvedLimit);

  if (ensureUiQualityReference && !selected.some((match) => isUiQualityPattern(match.pattern))) {
    const bestUiQualityMatch = matches.find((match) => isUiQualityPattern(match.pattern));
    if (bestUiQualityMatch) {
      if (selected.length < resolvedLimit) {
        selected.push(bestUiQualityMatch);
      } else {
        selected[selected.length - 1] = bestUiQualityMatch;
      }
      selected.sort((a, b) => b.score - a.score || a.pattern.id.localeCompare(b.pattern.id));
    }
  }

  return selected;
}

export function getReferenceRepoPatterns(idOrRepo: string): ReferencePattern | null {
  const normalized = idOrRepo.trim().toLowerCase();
  if (!normalized) return null;
  return REFERENCE_PATTERNS.find((pattern) =>
    pattern.id.toLowerCase() === normalized ||
    pattern.repo.toLowerCase() === normalized ||
    pattern.url.toLowerCase() === normalized ||
    pattern.name.toLowerCase() === normalized
  ) ?? null;
}

export function retrieveComponentExamples(input: ReferenceMatchInput, limit = 8): RetrievedComponentExample[] {
  const matches = matchReferenceRepos(input, limit);
  const requestedCapabilities = normalizeCapabilities(input.capabilities);
  const examples: RetrievedComponentExample[] = [];

  for (const match of matches) {
    const relevantCapabilities = requestedCapabilities.length
      ? match.pattern.capabilities.filter((capability) => requestedCapabilities.includes(capability))
      : match.pattern.capabilities;
    for (const example of match.pattern.componentExamples) {
      examples.push({
        referenceId: match.pattern.id,
        repo: match.pattern.repo,
        capabilities: relevantCapabilities.length ? relevantCapabilities : match.pattern.capabilities.slice(0, 3),
        example,
        guidance: `${match.pattern.name}: ${match.pattern.summary}`,
      });
      if (examples.length >= limit) return examples;
    }
  }

  return examples;
}

export function formatReferenceMatches(matches: MatchedReferencePattern[]): string {
  if (matches.length === 0) {
    return 'No reference patterns matched. Use capability packs, design system, codebase map, skills, and known issues as the retrieval basis.';
  }
  return [
    'Reference repo matches (patterns only, do not copy whole apps):',
    ...matches.map((match, index) =>
      `${index + 1}. ${match.pattern.id} (${match.pattern.repo}) score=${match.score}\n` +
      `   capabilities: ${match.pattern.capabilities.join(', ')}\n` +
      `   purpose: ${match.pattern.purpose ?? 'domain_architecture'}${match.pattern.qualityAxes?.length ? ` (${match.pattern.qualityAxes.join(', ')})` : ''}\n` +
      `   reasons: ${match.reasons.join('; ') || 'baseline'}\n` +
      `   license note: ${match.pattern.license}\n` +
      `   useful patterns: ${match.pattern.uiPatterns.slice(0, 2).join(' ')}`
    ),
    '',
    'Rule: summarize architecture/UI/schema/API patterns, respect upstream licenses, and build the CEO-specific app in the company repo.',
  ].join('\n');
}

export function formatReferencePattern(pattern: ReferencePattern): string {
  return [
    `Reference pattern: ${pattern.id} - ${pattern.name}`,
    `Repo: ${pattern.repo}`,
    `URL: ${pattern.url}`,
    `License note: ${pattern.license}`,
    `Capabilities: ${pattern.capabilities.join(', ')}`,
    `Purpose: ${pattern.purpose ?? 'domain_architecture'}`,
    pattern.qualityAxes?.length ? `Quality axes: ${pattern.qualityAxes.join(', ')}` : null,
    `Stack: ${pattern.stack.join(', ')}`,
    pattern.summary,
    '',
    `Useful for: ${pattern.usefulFor.join('; ')}`,
    `UI patterns: ${pattern.uiPatterns.join('; ')}`,
    `Schema patterns: ${pattern.schemaPatterns.join('; ')}`,
    `API patterns: ${pattern.apiPatterns.join('; ')}`,
    `Component examples: ${pattern.componentExamples.join('; ')}`,
    `Cautions: ${pattern.caution.join('; ')}`,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function formatComponentExamples(examples: RetrievedComponentExample[]): string {
  if (examples.length === 0) {
    return 'No component examples matched. Fall back to shadcn/ui components and capability-specific UI patterns.';
  }
  return [
    'Retrieved component examples:',
    ...examples.map((example, index) =>
      `${index + 1}. ${example.example}\n` +
      `   source: ${example.referenceId} (${example.repo})\n` +
      `   capabilities: ${example.capabilities.join(', ')}\n` +
      `   guidance: ${example.guidance}`
    ),
    '',
    'Use these as pattern guidance only. Implement original components using the app skeleton, shadcn/ui, lucide-react, and the selected design system.',
  ].join('\n');
}
