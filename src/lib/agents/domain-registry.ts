// Domain Registry — what kind of product is this?
//
// Capability matching answers: what must it do? (auth, crud, payments…)
// Domain matching answers: what shape of product is this? (ecommerce store,
// booking app, real estate listing, social community…).
//
// The Engineering agent uses both. A CEO task that says "build an art-class
// booking app with payments" must match domain=local_service_booking AND
// capabilities=auth+crud+booking+payments_stripe+deployment_render — and the
// resulting architecture/frontend MUST reflect the domain, not collapse to
// the generic CRUD-dashboard template that wins on capability score alone.
//
// All capability/reference IDs are stored as plain strings here to avoid
// circular type imports with capability-registry / reference-pattern-registry.

export type DomainId =
  | 'ecommerce_store'
  | 'business_website_crm'
  | 'local_service_booking'
  | 'inventory_operations'
  | 'construction_operations'
  | 'finance_crypto'
  | 'social_community'
  | 'education_content'
  | 'health_fitness_food'
  | 'media_creator'
  | 'real_estate_property'
  | 'advanced_ai_mixed';

export type DomainPack = {
  id: DomainId;
  title: string;
  summary: string;
  signals: string[];
  typicalActors: string[];
  typicalEntities: string[];
  expectedPages: string[];
  expectedApiRoutes: string[];
  expectedDbTables: string[];
  frontendPatterns: string[];
  backendPatterns: string[];
  requiredCapabilities: string[];
  referencePatterns: string[];
  verificationJourneys: Array<{ name: string; steps: string[] }>;
  commonFailures: string[];
  antiGenericWarnings: string[];
};

export type DomainMatchInput = {
  title?: string;
  description?: string | null;
  productContext?: string | null;
  companyContext?: string | null;
  existingCodebaseMap?: string | null;
};

export type MatchedDomain = {
  id: DomainId;
  title: string;
  score: number;
  reasons: string[];
  requiredCapabilities: string[];
  antiGenericWarnings: string[];
};

// ── 12 domain packs ───────────────────────────────────────────────────

export const DOMAIN_PACKS: DomainPack[] = [
  {
    id: 'ecommerce_store',
    title: 'Ecommerce Store',
    summary: 'Storefront with product catalog, cart, checkout, orders, and customer accounts.',
    signals: [
      'store', 'shop', 'storefront', 'ecommerce', 'e-commerce', 'product', 'catalog', 'sku',
      'cart', 'checkout', 'order', 'inventory', 'merchant', 'seller', 'buyer', 'shipping',
      'coupon', 'discount', 'tax', 'fulfillment',
    ],
    typicalActors: ['customer', 'store admin', 'order operator', 'guest shopper'],
    typicalEntities: ['products', 'product_variants', 'categories', 'carts', 'cart_items', 'orders', 'order_items', 'customers', 'addresses', 'coupons', 'payments'],
    expectedPages: ['/', '/shop', '/product/[id]', '/cart', '/checkout', '/orders', '/account', '/admin/orders'],
    expectedApiRoutes: [
      'GET /api/products',
      'GET /api/products/[id]',
      'POST /api/cart/items',
      'PATCH /api/cart/items/[id]',
      'POST /api/checkout/sessions',
      'POST /api/webhooks/stripe',
      'GET /api/orders',
      'PATCH /api/admin/orders/[id]/status',
    ],
    expectedDbTables: ['products', 'product_variants', 'categories', 'carts', 'cart_items', 'orders', 'order_items', 'customers', 'addresses', 'coupons', 'payments', 'webhook_events'],
    frontendPatterns: [
      'Storefront with product grid + filters, not a SaaS dashboard.',
      'Product detail page with image gallery, variant selector, price, add-to-cart.',
      'Persistent cart drawer/sidebar reflecting current items + subtotal.',
      'Multi-step or single-page checkout with address, shipping, payment.',
      'Order confirmation page with order id and status timeline.',
    ],
    backendPatterns: [
      'Cart state persisted server-side keyed by session or user id.',
      'Order creation is transactional: order + order_items + payment intent in one txn.',
      'Stripe webhook drives order status transitions, not the client.',
      'Inventory decrement on payment_intent.succeeded, not on cart add.',
    ],
    requiredCapabilities: ['auth', 'crud', 'payments_stripe', 'cart_orders_checkout', 'coupons_tax_shipping', 'payment_lifecycle', 'stripe_webhooks', 'dashboard', 'admin_workflow', 'deployment_render'],
    referencePatterns: ['stripe-billing-sample-patterns', 'shadcn-dashboard-patterns'],
    verificationJourneys: [
      { name: 'browse and add to cart', steps: ['load storefront', 'open product detail', 'add to cart', 'cart drawer shows item + subtotal'] },
      { name: 'checkout to order', steps: ['proceed to checkout', 'create Stripe session or payment-ready record', 'order persists with status=pending', 'webhook (or simulated webhook) flips order to paid'] },
      { name: 'order history', steps: ['view /orders or /account', 'most recent order visible with status'] },
      { name: 'admin order status', steps: ['admin opens admin/orders', 'changes status', 'audit row created'] },
    ],
    commonFailures: [
      'Cart total computed client-side and trusted on the server.',
      'Order persists even when Stripe call fails — no atomicity.',
      'Webhook missing — orders stay in pending forever.',
      'Inventory overcount on concurrent purchases (no row lock or transactional decrement).',
    ],
    antiGenericWarnings: [
      'Do not ship a generic "items table" admin dashboard and call it an ecommerce store.',
      'Homepage must be a storefront, not an admin login.',
      'Checkout flow must persist an order even when Stripe creds are missing (payment-ready state).',
    ],
  },
  {
    id: 'business_website_crm',
    title: 'Business Website + Lead CRM',
    summary: 'Public marketing pages + lead-capture form + internal CRM pipeline for sales follow-up.',
    signals: [
      'marketing site', 'business website', 'lead', 'leads', 'contact form', 'enquiry', 'inquiry',
      'crm', 'pipeline', 'sales pipeline', 'agency', 'consultancy', 'services site', 'small business website',
      'newsletter signup', 'demo request', 'quote request',
    ],
    typicalActors: ['visitor', 'sales rep', 'admin / owner'],
    typicalEntities: ['pages', 'lead_forms', 'leads', 'lead_notes', 'pipeline_stages', 'reps', 'activities'],
    expectedPages: ['/', '/about', '/services', '/contact', '/admin/leads', '/admin/leads/[id]'],
    expectedApiRoutes: [
      'POST /api/leads',
      'GET /api/admin/leads',
      'PATCH /api/admin/leads/[id]',
      'POST /api/admin/leads/[id]/notes',
    ],
    expectedDbTables: ['leads', 'lead_notes', 'pipeline_stages', 'reps', 'activities'],
    frontendPatterns: [
      'Marketing-style hero + features + CTA on /, not an admin dashboard.',
      'Lead form with name/email/phone/message, server-side validated, success state confirms submission.',
      'CRM table view with stage filters, row click → detail with notes timeline.',
      'Kanban-style pipeline columns optional (open/contacted/qualified/won/lost).',
    ],
    backendPatterns: [
      'Public lead endpoint is rate-limited and CAPTCHA-tolerant.',
      'Email notification fired on new lead (or notification-ready record if email not configured).',
      'Stage transitions are explicit (no free-text status).',
      'Audit row written on every stage change.',
    ],
    requiredCapabilities: ['auth', 'crud', 'roles', 'admin_workflow', 'email_notifications', 'seo_public_pages', 'audit_logs', 'deployment_render'],
    referencePatterns: ['shadcn-dashboard-patterns'],
    verificationJourneys: [
      { name: 'public marketing site', steps: ['load /', 'verify hero + CTA + services sections render', 'mobile viewport usable'] },
      { name: 'lead submission', steps: ['submit /contact form', 'success state shows', 'DB row in leads table', 'admin sees lead in /admin/leads'] },
      { name: 'pipeline stage transition', steps: ['admin opens lead detail', 'moves stage', 'audit/activity row written'] },
    ],
    commonFailures: [
      'Lead form returns 200 but row never persists.',
      'Public pages indexable but missing meta/og tags.',
      'CRM table is an admin login wall on /, blocking real visitors.',
    ],
    antiGenericWarnings: [
      'Homepage must be a public marketing page, NOT an admin login.',
      'CRM is internal — should sit behind /admin route, not be the homepage.',
      'Lead form must persist a row even if email service unconfigured.',
    ],
  },
  {
    id: 'local_service_booking',
    title: 'Local Service Booking',
    summary: 'Customer-facing booking flow for services (salon, tutor, fitness, repair) with availability and admin dashboard.',
    signals: [
      'booking', 'book', 'appointment', 'reservation', 'schedule', 'slot', 'availability', 'calendar',
      'salon', 'spa', 'tutor', 'class', 'session', 'consult', 'consultation', 'haircut', 'massage',
      'fitness booking', 'gym class', 'studio booking', 'repair appointment', 'home service',
    ],
    typicalActors: ['customer', 'provider/operator', 'admin'],
    typicalEntities: ['services', 'providers', 'availability_slots', 'bookings', 'customers', 'booking_notes'],
    expectedPages: ['/', '/services', '/book', '/account/bookings', '/admin/calendar', '/admin/bookings/[id]'],
    expectedApiRoutes: [
      'GET /api/services',
      'GET /api/availability',
      'POST /api/bookings',
      'GET /api/account/bookings',
      'PATCH /api/admin/bookings/[id]',
    ],
    expectedDbTables: ['services', 'providers', 'availability_slots', 'bookings', 'customers', 'booking_notes'],
    frontendPatterns: [
      'Customer flow: pick service → pick provider (optional) → pick date+slot → confirm.',
      'Available slots shown as time chips, taken slots disabled with reason.',
      'Confirmation page or email with booking id + cancel link.',
      'Admin calendar view (day/week) with all bookings.',
    ],
    backendPatterns: [
      'Booking insert is transactional with availability check inside the txn.',
      'Double-book rejected with 409 not silently accepted.',
      'Cancellation flips status, never deletes row.',
      'Timezone explicit on slot start/end (TIMESTAMPTZ).',
    ],
    requiredCapabilities: ['auth', 'crud', 'booking', 'email_notifications', 'admin_workflow', 'dashboard', 'deployment_render'],
    referencePatterns: ['calcom-booking-patterns'],
    verificationJourneys: [
      { name: 'browse services', steps: ['/services lists at least 1 service', 'each shows duration + price'] },
      { name: 'create booking', steps: ['select slot', 'submit booking', 'DB row created', 'confirmation shown'] },
      { name: 'double-book rejected', steps: ['attempt second booking for same slot', 'API returns 409 or surfaces conflict UI', 'DB still has only one booking for that slot'] },
      { name: 'admin sees bookings', steps: ['admin opens calendar', 'today/this-week bookings visible'] },
    ],
    commonFailures: [
      'Two simultaneous requests both succeed (no row lock).',
      'Timezone confusion: slot in UTC stored, but UI shows local without conversion.',
      'Cancel deletes the booking row instead of flipping status — audit lost.',
    ],
    antiGenericWarnings: [
      'Do not ship a "bookings CRUD admin" without a customer-facing booking flow.',
      'Available-slots view must show times as chips, not a raw datetime input.',
      'Double-book prevention belongs in the DB transaction, not just in disabled UI buttons.',
    ],
  },
  {
    id: 'inventory_operations',
    title: 'Inventory / Warehouse Operations',
    summary: 'Stock items, movements, low-stock alerts, CSV import/export, audit trail for warehouse/back-office.',
    signals: [
      'inventory', 'stock', 'warehouse', 'sku', 'bin', 'location', 'lot', 'batch',
      'goods receipt', 'goods issue', 'stock movement', 'stock-in', 'stock-out', 'restock',
      'low stock', 'reorder', 'csv import', 'csv export', 'barcode', 'audit',
    ],
    typicalActors: ['warehouse operator', 'manager', 'admin'],
    typicalEntities: ['items', 'locations', 'stock_levels', 'stock_movements', 'suppliers', 'purchase_orders', 'audit_logs'],
    expectedPages: ['/items', '/items/[id]', '/movements', '/import', '/reports/low-stock', '/admin/audit'],
    expectedApiRoutes: [
      'GET /api/items',
      'POST /api/items',
      'POST /api/movements',
      'GET /api/stock-levels',
      'POST /api/import/csv',
      'GET /api/export/csv',
      'GET /api/reports/low-stock',
    ],
    expectedDbTables: ['items', 'locations', 'stock_levels', 'stock_movements', 'suppliers', 'purchase_orders', 'audit_logs'],
    frontendPatterns: [
      'Items table with search, filter by category/location, paginate.',
      'Movement form: pick item + location + delta + reason, validate non-negative result.',
      'Low-stock report page with threshold setting.',
      'CSV import wizard with preview/validation and per-row errors.',
    ],
    backendPatterns: [
      'Stock level computed from movements (event-sourced) OR materialized + reconciled — never silently mutated.',
      'Negative stock blocked at the API layer unless explicit allow-oversell flag.',
      'CSV import idempotent on a natural key (sku); failed rows reported, not silently dropped.',
      'Every mutation writes an audit row.',
    ],
    requiredCapabilities: ['auth', 'roles', 'crud', 'admin_workflow', 'import_export_csv', 'audit_logs', 'dashboard', 'deployment_render'],
    referencePatterns: ['shadcn-dashboard-patterns'],
    verificationJourneys: [
      { name: 'create item', steps: ['POST item', 'item appears in list', 'DB row exists'] },
      { name: 'stock movement', steps: ['POST movement with delta', 'stock level updates', 'audit row written'] },
      { name: 'low-stock state', steps: ['set threshold', 'create item below threshold', 'item appears on low-stock report'] },
      { name: 'csv export', steps: ['GET /api/export/csv', 'response has Content-Type text/csv', 'contains item rows'] },
    ],
    commonFailures: [
      'Stock goes negative because two movements race.',
      'CSV import silently drops malformed rows, no error surface.',
      'Stock level recomputed inconsistently across pages (cached vs live).',
    ],
    antiGenericWarnings: [
      'This is operational software for staff — homepage is the items table or login, not a marketing page.',
      'Do not ship a generic CRUD with no movement entity. Inventory without movements is just a static catalog.',
    ],
  },
  {
    id: 'construction_operations',
    title: 'Construction Project Operations',
    summary: 'Project tracking, bids/estimates, schedule, safety logs, equipment, subcontractor management.',
    signals: [
      'construction', 'contractor', 'subcontractor', 'project', 'site', 'jobsite',
      'bid', 'estimate', 'rfq', 'rfp', 'schedule', 'gantt',
      'safety log', 'incident', 'equipment', 'material', 'punch list', 'daily report',
    ],
    typicalActors: ['project manager', 'site supervisor', 'estimator', 'admin'],
    typicalEntities: ['projects', 'bids', 'estimates', 'schedule_entries', 'safety_logs', 'equipment', 'subcontractors', 'daily_reports'],
    expectedPages: ['/projects', '/projects/[id]', '/projects/[id]/schedule', '/projects/[id]/safety', '/equipment', '/admin/dashboard'],
    expectedApiRoutes: [
      'GET /api/projects',
      'POST /api/projects',
      'POST /api/projects/[id]/bids',
      'POST /api/projects/[id]/schedule',
      'POST /api/projects/[id]/safety-logs',
      'GET /api/equipment',
    ],
    expectedDbTables: ['projects', 'bids', 'estimates', 'schedule_entries', 'safety_logs', 'equipment', 'subcontractors', 'daily_reports'],
    frontendPatterns: [
      'Project list cards with status (planning/active/complete) + key dates.',
      'Project detail with tabs: overview / schedule / bids / safety / equipment.',
      'Schedule view as table or simple Gantt-style bars; allow add/edit.',
      'Safety log entry form with date/category/severity.',
    ],
    backendPatterns: [
      'Project + bid status transitions explicit (draft → submitted → won/lost).',
      'Schedule entries validated to belong to project date range.',
      'Equipment can be assigned to one project at a time (constraint).',
    ],
    requiredCapabilities: ['auth', 'roles', 'crud', 'admin_workflow', 'audit_logs', 'dashboard', 'deployment_render'],
    referencePatterns: ['shadcn-dashboard-patterns'],
    verificationJourneys: [
      { name: 'project create', steps: ['POST /api/projects with name + dates', 'appears in project list'] },
      { name: 'bid creation', steps: ['POST bid on project', 'bid appears under project bids tab'] },
      { name: 'schedule entry', steps: ['add schedule item', 'visible on schedule view'] },
      { name: 'safety log entry', steps: ['add safety log', 'visible on safety tab with severity badge'] },
      { name: 'equipment record', steps: ['create equipment', 'list shows equipment assigned to project'] },
    ],
    commonFailures: [
      'No project context — everything is a flat list of unrelated items.',
      'Bid status overwritten without audit trail.',
      'Equipment double-assigned because no uniqueness constraint.',
    ],
    antiGenericWarnings: [
      'Do not collapse to a single "tasks" table. Projects, bids, schedule, safety, equipment are distinct entities.',
      'Homepage for construction ops is the project list, not a marketing page.',
    ],
  },
  {
    id: 'finance_crypto',
    title: 'Finance / Crypto Dashboard',
    summary: 'Portfolio tracking, price alerts, transaction history, external market data with safe fallbacks.',
    signals: [
      'portfolio', 'crypto', 'wallet', 'token', 'coin', 'price alert', 'watchlist',
      'transaction history', 'trade', 'pnl', 'stock', 'equity', 'investment',
      'finance dashboard', 'market data', 'ticker', 'candlestick', 'chart',
    ],
    typicalActors: ['retail user', 'admin / data steward'],
    typicalEntities: ['portfolios', 'holdings', 'transactions', 'price_alerts', 'watchlists', 'instruments', 'price_snapshots'],
    expectedPages: ['/', '/portfolio', '/portfolio/[id]', '/watchlist', '/alerts', '/transactions', '/instruments/[symbol]'],
    expectedApiRoutes: [
      'GET /api/portfolios',
      'POST /api/portfolios',
      'GET /api/instruments/[symbol]/price',
      'POST /api/alerts',
      'GET /api/transactions',
    ],
    expectedDbTables: ['portfolios', 'holdings', 'transactions', 'price_alerts', 'watchlists', 'instruments', 'price_snapshots'],
    frontendPatterns: [
      'Dashboard with portfolio summary card + chart + holdings table.',
      'Instrument detail with price chart + recent trades.',
      'Watchlist as compact table with price + 24h change.',
      'Alert form: instrument + condition (above/below) + threshold.',
    ],
    backendPatterns: [
      'External market data fetch wrapped in retry + cache; degraded mode if API unavailable.',
      'Price snapshots persisted (do not recompute history from external API on every load).',
      'Alerts evaluated by a cron/background job, not on each request.',
      'Show last_updated timestamp on prices so stale data is visible.',
    ],
    requiredCapabilities: ['auth', 'crud', 'dashboard', 'external_api', 'cron_jobs', 'analytics', 'security_ops', 'deployment_render'],
    referencePatterns: ['shadcn-dashboard-patterns'],
    verificationJourneys: [
      { name: 'create portfolio', steps: ['POST portfolio', 'portfolio appears in list'] },
      { name: 'price alert', steps: ['create alert', 'alert stored', 'visible on /alerts'] },
      { name: 'transaction history', steps: ['POST transaction', 'appears on /transactions with running balance'] },
      { name: 'external API fallback', steps: ['simulate market API down', 'UI shows last-known price + stale indicator, not a crash'] },
    ],
    commonFailures: [
      'Market API key missing → entire dashboard 500s instead of degrading gracefully.',
      'Holdings computed from transactions but no consistency check.',
      'Alert eval runs on every request, hammering external API.',
    ],
    antiGenericWarnings: [
      'Show explicit safety boundaries — "this is not financial advice", price data may be delayed.',
      'Do not invent fake portfolio numbers — if no data, show empty state with action.',
    ],
  },
  {
    id: 'social_community',
    title: 'Social / Community / Forum',
    summary: 'Profiles, posts, comments, feed/search, moderation, notifications for community platforms.',
    signals: [
      'social', 'community', 'forum', 'feed', 'timeline', 'post', 'thread', 'reply', 'comment',
      'profile', 'follow', 'mention', 'notification', 'reaction', 'upvote', 'like',
      'moderation', 'report', 'ban', 'flag', 'discord-style', 'reddit-style', 'twitter-style',
    ],
    typicalActors: ['member', 'moderator', 'admin'],
    typicalEntities: ['profiles', 'posts', 'comments', 'reactions', 'follows', 'mentions', 'notifications', 'reports', 'mod_actions'],
    expectedPages: ['/', '/feed', '/profile/[handle]', '/post/[id]', '/notifications', '/admin/reports', '/admin/mod-queue'],
    expectedApiRoutes: [
      'GET /api/feed',
      'POST /api/posts',
      'POST /api/posts/[id]/comments',
      'POST /api/posts/[id]/reactions',
      'POST /api/follows',
      'GET /api/notifications',
      'POST /api/reports',
      'POST /api/admin/mod-actions',
    ],
    expectedDbTables: ['profiles', 'posts', 'comments', 'reactions', 'follows', 'mentions', 'notifications', 'reports', 'mod_actions'],
    frontendPatterns: [
      'Feed as scrollable list of post cards (author, body, reactions, comment count).',
      'Post detail page with comment thread.',
      'Profile page with bio + post grid.',
      'Notification list grouped by type with unread badge.',
      'Mod queue table with report reason + action buttons.',
    ],
    backendPatterns: [
      'Feed retrieval ranked or chronological — pagination by cursor not offset.',
      'Reaction toggles idempotent (one reaction per (user, post)).',
      'Reports queue actionable: each report has status (open/actioned/dismissed).',
      'Notifications fan-out on post/comment/mention.',
    ],
    requiredCapabilities: ['auth', 'roles', 'crud', 'admin_workflow', 'search', 'realtime', 'notification_preferences', 'deployment_render'],
    referencePatterns: ['shadcn-dashboard-patterns'],
    verificationJourneys: [
      { name: 'profile', steps: ['user has profile after register', '/profile/[handle] renders bio'] },
      { name: 'post + comment', steps: ['create post', 'add comment', 'comment appears under post'] },
      { name: 'moderation', steps: ['user A reports post', 'mod sees in queue', 'mod action recorded'] },
      { name: 'notification', steps: ['user A comments on user B post', 'notification row exists for user B (notification-ready record OK if push not configured)'] },
      { name: 'feed/search', steps: ['create post', 'appears in /feed', 'searchable by keyword'] },
    ],
    commonFailures: [
      'Feed query is O(N) per render with no pagination.',
      'Duplicate reactions because no unique constraint.',
      'Report queue invisible to mods — surface is missing.',
    ],
    antiGenericWarnings: [
      'A social app without a feed is not a social app.',
      'Do not render the admin moderation table as the homepage.',
      'Posts must be public-renderable (no auth) unless explicitly private community.',
    ],
  },
  {
    id: 'education_content',
    title: 'Education / Content / LMS',
    summary: 'Courses, lessons, progress tracking, rich content authoring, instructor/admin publish flow.',
    signals: [
      'course', 'lesson', 'module', 'curriculum', 'student', 'teacher', 'instructor',
      'enrollment', 'progress', 'quiz', 'assessment', 'grading', 'syllabus',
      'lms', 'school', 'tutoring', 'training', 'classroom', 'cohort', 'bootcamp',
    ],
    typicalActors: ['student', 'instructor', 'admin'],
    typicalEntities: ['courses', 'modules', 'lessons', 'enrollments', 'progress', 'quizzes', 'submissions', 'resources'],
    expectedPages: ['/', '/courses', '/courses/[slug]', '/lessons/[id]', '/account/progress', '/instructor/courses', '/admin/publish'],
    expectedApiRoutes: [
      'GET /api/courses',
      'POST /api/instructor/courses',
      'POST /api/instructor/lessons',
      'POST /api/enrollments',
      'POST /api/progress',
      'POST /api/admin/courses/[id]/publish',
    ],
    expectedDbTables: ['courses', 'modules', 'lessons', 'enrollments', 'progress', 'quizzes', 'quiz_questions', 'submissions', 'resources'],
    frontendPatterns: [
      'Course catalog with cards (title, instructor, duration, level).',
      'Course detail with module/lesson outline and enroll button.',
      'Lesson view with content body + mark-complete action.',
      'Progress page showing % per enrolled course.',
      'Instructor authoring with rich-text editor for lesson body.',
    ],
    backendPatterns: [
      'Lessons content stored as structured rich text (Markdown or JSON blocks), not raw HTML.',
      'Progress unique on (user, lesson) — toggling complete is idempotent.',
      'Publish flow flips course.published_at; drafts hidden from /courses.',
      'Quiz submissions immutable once graded.',
    ],
    requiredCapabilities: ['auth', 'roles', 'crud', 'rich_text_cms', 'admin_workflow', 'dashboard', 'deployment_render'],
    referencePatterns: ['shadcn-dashboard-patterns'],
    verificationJourneys: [
      { name: 'course creation', steps: ['instructor POSTs course', 'course visible in instructor dashboard'] },
      { name: 'lesson creation', steps: ['add lesson to course', 'lesson renders under course'] },
      { name: 'progress tracking', steps: ['student marks lesson complete', 'progress row exists, % increases'] },
      { name: 'rich content', steps: ['lesson body supports formatted text/lists/code blocks', 'renders correctly on student view'] },
      { name: 'admin publish', steps: ['admin/instructor publishes course', 'course visible on public /courses'] },
    ],
    commonFailures: [
      'Lessons stored as raw HTML — XSS risk.',
      'Progress double-counted on retry — no unique constraint.',
      'Draft courses leak into public listing.',
    ],
    antiGenericWarnings: [
      'Do not ship a generic "lessons CRUD" with no progress tracking — progress is the LMS.',
      'Course detail must show structured outline, not a flat lesson list with no grouping.',
    ],
  },
  {
    id: 'health_fitness_food',
    title: 'Health / Fitness / Meal Planner',
    summary: 'User plans, workouts/recipes, progress logs, preferences, personal dashboard.',
    signals: [
      'fitness', 'workout', 'exercise', 'training plan', 'gym', 'reps', 'sets',
      'meal plan', 'recipe', 'nutrition', 'calorie', 'macros', 'diet',
      'health', 'wellness', 'habit', 'streak', 'sleep', 'hydration',
      'weight tracker', 'body composition', 'fasting',
    ],
    typicalActors: ['user', 'coach (optional)', 'admin'],
    typicalEntities: ['plans', 'workouts', 'recipes', 'workout_logs', 'meal_logs', 'measurements', 'preferences', 'goals'],
    expectedPages: ['/', '/plan', '/today', '/log/workout', '/log/meal', '/progress', '/preferences'],
    expectedApiRoutes: [
      'GET /api/plan',
      'POST /api/plans',
      'POST /api/workout-logs',
      'POST /api/meal-logs',
      'GET /api/progress',
      'PATCH /api/preferences',
    ],
    expectedDbTables: ['plans', 'workouts', 'recipes', 'workout_logs', 'meal_logs', 'measurements', 'preferences', 'goals'],
    frontendPatterns: [
      "Today's plan view as the homepage when logged in.",
      'Log entry forms are mobile-first, large touch targets.',
      'Progress page with charts of streaks/weight/calories.',
      'Preferences page for diet/restrictions/units.',
    ],
    backendPatterns: [
      'Plan generation may be deterministic or AI-assisted but must persist a concrete plan record.',
      'Logs append-only; edits via new log row referencing original.',
      'Goals separated from preferences (goals change, preferences are static-ish).',
    ],
    requiredCapabilities: ['auth', 'crud', 'dashboard', 'cron_jobs', 'deployment_render'],
    referencePatterns: ['shadcn-dashboard-patterns'],
    verificationJourneys: [
      { name: 'plan create', steps: ['create plan', 'plan visible on /plan'] },
      { name: 'log workout/meal', steps: ['log workout or meal', 'log row exists', 'visible on /today and /progress'] },
      { name: 'progress', steps: ['multiple logs → /progress shows aggregated chart'] },
      { name: 'preferences', steps: ['update preferences', 'persisted', 'affects shown plan content'] },
    ],
    commonFailures: [
      'Plan is a static template — no per-user persistence.',
      'Logs lost across days because of timezone confusion.',
      'No empty state for new users — dashboard looks broken.',
    ],
    antiGenericWarnings: [
      'Logged-in homepage is the daily plan, not an admin dashboard.',
      'Do not ship as "a generic tasks app" — workouts/meals/measurements are distinct.',
    ],
  },
  {
    id: 'media_creator',
    title: 'Media / Creator Platform',
    summary: 'Creator uploads + gallery/portfolio + gated/payment-ready premium content + creator admin.',
    signals: [
      'creator', 'portfolio', 'gallery', 'media', 'video', 'photo', 'image upload',
      'subscription tier', 'paid content', 'gated', 'patreon-style',
      'art', 'music', 'photographer', 'youtuber', 'streamer', 'podcast',
    ],
    typicalActors: ['creator', 'fan / subscriber', 'admin'],
    typicalEntities: ['creators', 'media_items', 'collections', 'subscriptions', 'tiers', 'fans', 'payments'],
    expectedPages: ['/', '/creator/[handle]', '/media/[id]', '/account/subscriptions', '/creator/dashboard', '/creator/upload'],
    expectedApiRoutes: [
      'POST /api/media',
      'GET /api/creator/[handle]',
      'POST /api/subscriptions',
      'POST /api/webhooks/stripe',
      'GET /api/media/[id]/access',
    ],
    expectedDbTables: ['creators', 'media_items', 'collections', 'subscriptions', 'tiers', 'fans', 'payments'],
    frontendPatterns: [
      'Creator landing page (public) with hero + featured media + subscribe CTA.',
      'Media gallery as image/video grid with infinite scroll or pagination.',
      'Gated media shows preview + unlock CTA for non-subscribers.',
      'Creator dashboard for uploads + subscriber count + revenue.',
    ],
    backendPatterns: [
      'Media uploads store metadata even when blob storage creds missing (persist filename, size, mime, intended path).',
      'Access check on every gated fetch — server-side, not just UI hide.',
      'Subscription state driven by Stripe webhook or payment-ready record.',
    ],
    requiredCapabilities: ['auth', 'roles', 'crud', 'uploads_storage', 'payments_stripe', 'file_privacy_validation', 'stripe_webhooks', 'dashboard', 'deployment_render'],
    referencePatterns: ['stripe-billing-sample-patterns'],
    verificationJourneys: [
      { name: 'media upload metadata', steps: ['creator uploads media', 'media_items row exists with metadata', 'gallery shows item'] },
      { name: 'gallery/portfolio', steps: ['public /creator/[handle] page renders gallery'] },
      { name: 'gated/payment-ready', steps: ['gated media returns 402/403 for non-subscriber', 'subscriber gets content'] },
      { name: 'creator admin', steps: ['creator dashboard shows uploads + counters'] },
    ],
    commonFailures: [
      'Gated content URL leaks to non-subscribers (signed URL not enforced).',
      'Upload only persists when blob storage configured — should always persist metadata.',
      'Subscriber/fan counters computed wrong on cancellation.',
    ],
    antiGenericWarnings: [
      'Creator page is the public surface — do not require auth to view a creator profile.',
      'Do not collapse to a generic file-uploader. Gating + tier semantics are required.',
    ],
  },
  {
    id: 'real_estate_property',
    title: 'Real Estate / Property',
    summary: 'Property listings, filters/search, inquiries, saved properties, admin/agent approval.',
    signals: [
      'real estate', 'property', 'listing', 'rental', 'rent', 'sale', 'mls',
      'house', 'apartment', 'condo', 'land', 'agent', 'broker', 'inquiry',
      'saved properties', 'favorites', 'tour request', 'open house',
    ],
    typicalActors: ['buyer / renter', 'agent / broker', 'admin'],
    typicalEntities: ['properties', 'agents', 'inquiries', 'saved_properties', 'photos', 'agent_approvals'],
    expectedPages: ['/', '/listings', '/listings/[id]', '/account/saved', '/inquire/[id]', '/admin/approvals'],
    expectedApiRoutes: [
      'GET /api/listings',
      'GET /api/listings/[id]',
      'POST /api/inquiries',
      'POST /api/saved-properties',
      'POST /api/agent/listings',
      'POST /api/admin/listings/[id]/approve',
    ],
    expectedDbTables: ['properties', 'agents', 'inquiries', 'saved_properties', 'photos', 'agent_approvals'],
    frontendPatterns: [
      'Listings index with filter bar (city/price/beds/baths) + result cards.',
      'Listing detail with photo gallery, key facts, agent contact, map (optional).',
      'Inquiry form on listing detail.',
      'Saved listings view in account.',
      'Admin approval queue for new agent listings.',
    ],
    backendPatterns: [
      'Search uses filtered SQL or a search service — pagination always.',
      'Inquiry creates a row + (best effort) email to agent.',
      'Saved unique on (user, property).',
      'Approval flow flips status; only approved listings appear in /listings.',
    ],
    requiredCapabilities: ['auth', 'roles', 'crud', 'search', 'admin_workflow', 'uploads_storage', 'email_notifications', 'seo_public_pages', 'deployment_render'],
    referencePatterns: ['shadcn-dashboard-patterns'],
    verificationJourneys: [
      { name: 'listing create', steps: ['agent POSTs listing', 'listing in pending', 'admin approves', 'shows on public /listings'] },
      { name: 'filters/search', steps: ['filter by city/price', 'results subset', 'page count updates'] },
      { name: 'inquiry', steps: ['submit inquiry on listing', 'inquiry row exists, agent notified or notification-ready'] },
      { name: 'saved property', steps: ['user saves listing', 'appears in /account/saved'] },
      { name: 'admin approval', steps: ['admin opens approvals queue', 'approves listing, status updates'] },
    ],
    commonFailures: [
      'Unapproved listings visible publicly.',
      'Filters reset on pagination (state lost in query string).',
      'Inquiry only persists when email configured.',
    ],
    antiGenericWarnings: [
      'Homepage must be public listings or a marketing+search page — not admin login.',
      'Do not skip the approval flow — without it the site is a free-for-all.',
    ],
  },
  {
    id: 'advanced_ai_mixed',
    title: 'Advanced Mixed AI / RAG Workflow',
    summary: 'Uploads → AI/RAG processing → stored output → user dashboard, with background jobs and external API fallback.',
    signals: [
      'ai workflow', 'rag', 'retrieval', 'document analysis', 'extract',
      'summarize', 'chatbot', 'agent', 'pipeline', 'job', 'queue',
      'ai dashboard', 'embeddings', 'vector', 'semantic search',
      'analyze document', 'transcribe', 'classify', 'extract fields',
    ],
    typicalActors: ['user', 'admin', 'system worker'],
    typicalEntities: ['uploads', 'jobs', 'ai_runs', 'documents', 'document_chunks', 'results', 'job_logs'],
    expectedPages: ['/', '/upload', '/jobs', '/jobs/[id]', '/results/[id]', '/admin/jobs'],
    expectedApiRoutes: [
      'POST /api/uploads',
      'POST /api/jobs',
      'GET /api/jobs/[id]',
      'POST /api/ai/run',
      'GET /api/results/[id]',
      'POST /api/admin/jobs/[id]/retry',
    ],
    expectedDbTables: ['uploads', 'jobs', 'ai_runs', 'documents', 'document_chunks', 'results', 'job_logs'],
    frontendPatterns: [
      'Upload area with drag-drop + progress.',
      'Jobs list with status badges (pending/running/done/failed) and live updates or polling.',
      'Result detail with structured output rendered + raw JSON toggle.',
      'Admin job retry/inspect view.',
    ],
    backendPatterns: [
      'Long-running AI work goes through a job queue or background worker — never tied to a single HTTP request.',
      'Persist intermediate state (uploads + jobs + ai_runs) so UI can show progress and retry from any step.',
      'External AI API failure → job moves to failed with reason; UI shows retry; not silent.',
      'Cost-cap and rate-limit per user to avoid runaway spend.',
    ],
    requiredCapabilities: ['auth', 'crud', 'uploads_storage', 'ai_openai', 'rag_search', 'long_running_ai_jobs', 'queue_workers', 'ai_safety_cost_controls', 'cron_jobs', 'dashboard', 'deployment_render'],
    referencePatterns: ['vercel-ai-chatbot-patterns', 'shadcn-dashboard-patterns'],
    verificationJourneys: [
      { name: 'upload', steps: ['POST /api/uploads', 'upload row exists with metadata'] },
      { name: 'AI/RAG result', steps: ['POST /api/jobs to start AI run', 'job row created', 'ai_runs row created on completion (or job-ready state if AI keys absent)'] },
      { name: 'stored output', steps: ['result persisted', 'visible at /results/[id]'] },
      { name: 'background job or job-ready', steps: ['job has status field that transitions or is observably ready to transition'] },
      { name: 'dashboard', steps: ['user dashboard lists their jobs/results'] },
      { name: 'external API fallback', steps: ['simulate AI provider down', 'job marked failed with reason, UI shows retry — no crash'] },
    ],
    commonFailures: [
      'AI call inside the HTTP handler — request times out.',
      'No persistence of intermediate state — failed job loses upload.',
      'No rate-limit or cost-cap — single user can drain credits.',
    ],
    antiGenericWarnings: [
      'Do not ship a "chat with AI" page only. Persistent uploads → jobs → results is required.',
      'Generic "tasks" dashboard does not satisfy this domain. Jobs have stages and durations.',
    ],
  },
];

const PACK_BY_ID: Map<DomainId, DomainPack> = new Map(DOMAIN_PACKS.map((pack) => [pack.id, pack]));

// ── Public API ────────────────────────────────────────────────────────

export function listDomainPacks(): DomainPack[] {
  return DOMAIN_PACKS;
}

export function getDomainPack(id: string): DomainPack | null {
  return PACK_BY_ID.get(id as DomainId) ?? null;
}

export function normalizeDomainId(id: string): DomainId | null {
  const trimmed = id.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return PACK_BY_ID.has(trimmed as DomainId) ? (trimmed as DomainId) : null;
}

export function matchDomainApp(input: DomainMatchInput, limit = 4): MatchedDomain[] {
  const text = normalizeDomainScoringText([
    input.title ?? '',
    input.description ?? '',
    input.productContext ?? '',
    input.companyContext ?? '',
    input.existingCodebaseMap ?? '',
  ].join(' ').toLowerCase());

  if (!text.trim()) return [];

  const matches: MatchedDomain[] = DOMAIN_PACKS.map((pack) => {
    let score = 0;
    const reasons: string[] = [];

    for (const signal of pack.signals) {
      const needle = signal.toLowerCase();
      if (isAmbiguousDomainSignal(pack.id, needle, text)) continue;
      // Single-word signals match by word boundary so "health" doesn't match
      // "healthz" or "post" doesn't match "outpost". Multi-word phrases use
      // substring because phrases are inherently specific.
      const isSingleWord = !/\s/.test(needle);
      const matched = isSingleWord
        ? new RegExp(`\\b${escapeRegex(needle)}\\b`, 'i').test(text)
        : text.includes(needle);
      if (matched) {
        score += 3;
        reasons.push(`signal: "${signal}"`);
      }
    }

    // Title match boosts harder than body match.
    const titleText = (input.title ?? '').toLowerCase();
    for (const signal of pack.signals) {
      const needle = signal.toLowerCase();
      if (isAmbiguousDomainSignal(pack.id, needle, text)) continue;
      const isSingleWord = !/\s/.test(needle);
      const titleMatched = isSingleWord
        ? new RegExp(`\\b${escapeRegex(needle)}\\b`, 'i').test(titleText)
        : titleText.includes(needle);
      if (titleMatched) {
        score += 2;
        reasons.push(`title contains "${signal}"`);
      }
    }

    return {
      id: pack.id,
      title: pack.title,
      score,
      reasons: [...new Set(reasons)].slice(0, 6),
      requiredCapabilities: pack.requiredCapabilities,
      antiGenericWarnings: pack.antiGenericWarnings,
    };
  })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const top = matches[0];
  const second = matches[1];
  const mixedProductRequested = /\b(mixed|combination|combine|adversarial|multi[- ]?domain|marketplace\s+with|booking\s+marketplace|platform\s+with)\b/i.test(text);
  if (
    top &&
    second &&
    !mixedProductRequested &&
    top.score >= 10 &&
    top.score >= second.score + 5
  ) {
    return [top];
  }

  return matches.slice(0, Math.max(1, Math.min(limit, DOMAIN_PACKS.length)));
}

export function hasClearDomainSignals(input: DomainMatchInput, minScore = 4): boolean {
  const matches = matchDomainApp(input, 1);
  return matches.length > 0 && matches[0].score >= minScore;
}

function normalizeDomainScoringText(text: string): string {
  return text
    .replace(/\/api\/health[a-z0-9/_-]*/g, ' ')
    .replace(/\bhealthz?\s+(?:check|route|endpoint|probe|url|status|api)\b/g, ' ')
    .replace(/\b(?:existing|current|target)\s+product\b/g, 'existing app')
    .replace(/\bproduct[-\s]?(?:shape|context|surface|ui|requirements?|scope)\b/g, 'app ');
}

function isAmbiguousDomainSignal(domainId: DomainId, signal: string, text: string): boolean {
  if (domainId === 'ecommerce_store' && signal === 'product') {
    return !/\b(products|product\s+(?:catalog|grid|page|detail|variant|price|sku|listing)|shop|storefront|cart|checkout|order)\b/i.test(text);
  }
  if (domainId === 'health_fitness_food' && signal === 'health') {
    return !/\b(health\s+(?:tracker|app|plan|dashboard|log|goal|metrics)|fitness|workout|exercise|meal plan|recipe|nutrition|calorie|diet|wellness)\b/i.test(text);
  }
  return false;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Formatters ────────────────────────────────────────────────────────

export function formatDomainList(): string {
  return [
    'Domain packs (call match_domain_app to score, then get_domain_pack for the chosen domain):',
    ...DOMAIN_PACKS.map((pack) => `- ${pack.id}: ${pack.title} — ${pack.summary}`),
  ].join('\n');
}

export function formatDomainMatches(matches: MatchedDomain[]): string {
  if (matches.length === 0) {
    return 'No domain matches. Either the task has no clear product-shape signals, or this is generic infra/admin work. The crud + dashboard + deployment_render fallback is allowed only when no domain signals exist.';
  }
  return [
    'Domain matches:',
    ...matches.map((match, index) =>
      `${index + 1}. ${match.id} (${match.title}) score=${match.score}\n` +
      `   reasons: ${match.reasons.join('; ') || 'baseline'}\n` +
      `   required capabilities: ${match.requiredCapabilities.join(', ')}\n` +
      `   anti-generic warnings: ${match.antiGenericWarnings.join(' | ')}`
    ),
  ].join('\n');
}

export function formatDomainPack(pack: DomainPack): string {
  return [
    `Domain: ${pack.id} — ${pack.title}`,
    pack.summary,
    '',
    `Typical actors: ${pack.typicalActors.join(', ')}`,
    `Typical entities: ${pack.typicalEntities.join(', ')}`,
    `Expected pages: ${pack.expectedPages.join(', ')}`,
    `Expected API routes: ${pack.expectedApiRoutes.join(' | ')}`,
    `Expected DB tables: ${pack.expectedDbTables.join(', ')}`,
    '',
    `Frontend patterns:\n${pack.frontendPatterns.map((p) => `- ${p}`).join('\n')}`,
    '',
    `Backend patterns:\n${pack.backendPatterns.map((p) => `- ${p}`).join('\n')}`,
    '',
    `Required capabilities: ${pack.requiredCapabilities.join(', ')}`,
    `Reference patterns: ${pack.referencePatterns.join(', ') || 'none — call match_reference_repos with these domains'}`,
    '',
    `Verification journeys:\n${pack.verificationJourneys.map((j, i) => `${i + 1}. ${j.name}: ${j.steps.join(' -> ')}`).join('\n')}`,
    '',
    `Common failures:\n${pack.commonFailures.map((f) => `- ${f}`).join('\n')}`,
    '',
    `Anti-generic warnings:\n${pack.antiGenericWarnings.map((w) => `- ${w}`).join('\n')}`,
  ].join('\n');
}
