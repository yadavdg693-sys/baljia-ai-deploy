// Frontend UI Pattern Registry + compose_frontend_plan.
//
// The Engineering agent must treat frontend as a first-class output, not an
// afterthought. Capability matching tells us what the app must DO; domain
// matching tells us what KIND of product it is; the frontend pattern registry
// tells us what shape the UI must take.
//
// A "build me an art-class booking app" task that produces a generic
// shadcn-dashboard-with-data-table fails the goal even if the API works.
// compose_frontend_plan blocks that drift by selecting concrete UI patterns,
// listing required text/buttons/form-submission checks (used by
// verify_browser_ui), and locking the design intent of the page map.

import type { DomainId } from './domain-registry';

export type FrontendPatternId =
  | 'landing_site'
  | 'dashboard'
  | 'marketplace_listing'
  | 'ecommerce_storefront'
  | 'booking_calendar'
  | 'admin_portal'
  | 'crm_pipeline'
  | 'inventory_table'
  | 'ai_workspace'
  | 'document_portal'
  | 'social_feed'
  | 'real_estate_listing'
  | 'media_creator_gallery'
  | 'education_lms'
  | 'health_plan_tracker'
  | 'construction_ops_board'
  | 'finance_dashboard';

export type FrontendPattern = {
  id: FrontendPatternId;
  title: string;
  summary: string;
  preferredFor: DomainId[];
  requiredComponents: string[];
  requiredIcons: string[];
  pageStructure: string[];
  primaryFlows: string[];
  forms: string[];
  tables: string[];
  cards: string[];
  calendars: string[];
  charts: string[];
  emptyStateGuidance: string;
  loadingStateGuidance: string;
  errorStateGuidance: string;
  mobileExpectations: string[];
  accessibilitySmoke: string[];
  requiredText: string[];
  requiredButtons: string[];
  formSubmissionChecks: string[];
  antiPatterns: string[];
};

export type FrontendPlanInput = {
  taskTitle?: string;
  taskDescription?: string | null;
  productContext?: string | null;
  domains?: string[];
  capabilities?: string[];
  designSystem?: string | null;
  referencePatterns?: string[];
  pages?: string[];
  actors?: string[];
};

export type FrontendPagePlan = {
  path: string;
  uiType: FrontendPatternId | 'generic';
  audience: 'public' | 'authenticated' | 'admin';
  required_text: string[];
  required_buttons: string[];
  form_submission_checks: string[];
  must_call_backend: boolean;
  empty_state: string;
  loading_state: string;
  error_state: string;
};

export type FrontendInteractionContract = {
  id: string;
  kind:
    | 'create_record'
    | 'update_record'
    | 'delete_or_restore'
    | 'search_filter'
    | 'upload_file'
    | 'approve_reject'
    | 'book_reserve'
    | 'checkout'
    | 'subscribe_billing'
    | 'ai_action'
    | 'message_comment'
    | 'import_export'
    | 'auth_session'
    | 'external_sync'
    | 'background_status'
    | 'realtime_update';
  page: string;
  labelPattern: string;
  fields: string[];
  api: string;
  dbWrites: string[];
  uiReadback: string[];
  failureState: string;
  selectorHint: string;
};

export type FrontendPlan = {
  uiType: FrontendPatternId | 'mixed' | 'generic';
  patternIds: FrontendPatternId[];
  pageMap: FrontendPagePlan[];
  navigation: string[];
  primaryFlows: string[];
  shadcnComponents: string[];
  lucideIcons: string[];
  forms: string[];
  tables: string[];
  cards: string[];
  calendars: string[];
  charts: string[];
  loadingStates: string[];
  emptyStates: string[];
  errorStates: string[];
  uiReferencePatterns: string[];
  visualQualityRules: string[];
  componentAccessibilityRules: string[];
  mobileExpectations: string[];
  accessibilitySmoke: string[];
  browserUiRequiredText: string[];
  browserUiRequiredButtons: string[];
  browserUiFormSubmissionChecks: string[];
  interactionContracts: FrontendInteractionContract[];
  blockingRules: string[];
};

// ── 17 patterns ───────────────────────────────────────────────────────

export const FRONTEND_PATTERNS: FrontendPattern[] = [
  {
    id: 'landing_site',
    title: 'Public Landing / Marketing Site',
    summary: 'Public marketing surface: hero, features, social proof, primary CTA.',
    preferredFor: ['business_website_crm', 'media_creator', 'real_estate_property'],
    requiredComponents: ['Button', 'Card', 'Separator', 'Sheet (mobile menu)'],
    requiredIcons: ['ArrowRight', 'Check', 'Sparkles', 'Menu', 'X'],
    pageStructure: ['header with logo + nav + primary CTA', 'hero with headline + subhead + CTA + secondary CTA', 'features section (3-6 items)', 'optional testimonials / social proof', 'optional FAQ', 'footer'],
    primaryFlows: ['visitor clicks primary CTA → leads to contact form, signup, or main app entry'],
    forms: [],
    tables: [],
    cards: ['feature cards', 'testimonial cards'],
    calendars: [],
    charts: [],
    emptyStateGuidance: 'N/A — landing pages should always be populated; if content is empty the page is broken.',
    loadingStateGuidance: 'Landing pages should render static; use SSR/SSG. No spinner on first paint.',
    errorStateGuidance: 'If a section fails to load (e.g. testimonials), the section is omitted, not replaced with an error.',
    mobileExpectations: ['mobile menu replaces nav at <md', 'CTAs are full-width buttons on mobile', 'hero readable without horizontal scroll'],
    accessibilitySmoke: ['heading hierarchy h1→h2→h3', 'every image has alt text', 'CTAs are real <button>/<a> not divs'],
    requiredText: ['headline that explains the product in one line', 'subhead with concrete benefit', 'primary CTA copy'],
    requiredButtons: ['primary CTA (e.g. "Get started", "Book a demo", "Sign up")'],
    formSubmissionChecks: [],
    antiPatterns: ['Hero is just a logo with no headline', 'Primary CTA is "Learn more" that scrolls nowhere', 'Page is an admin login disguised as a landing page'],
  },
  {
    id: 'dashboard',
    title: 'Application Dashboard',
    summary: 'Logged-in overview with metrics, primary actions, and entry points to deep features.',
    preferredFor: ['business_website_crm', 'inventory_operations', 'construction_operations', 'finance_crypto', 'health_fitness_food'],
    requiredComponents: ['Card', 'Tabs', 'Badge', 'DropdownMenu', 'Skeleton'],
    requiredIcons: ['LayoutDashboard', 'TrendingUp', 'TrendingDown', 'ChevronRight', 'Settings'],
    pageStructure: ['header with user menu + primary action', 'metric cards row (3-6)', 'main content tabs or recent activity table', 'secondary panels (charts, recent items)'],
    primaryFlows: ['user lands on dashboard → sees key metric → clicks through to detail view'],
    forms: [],
    tables: ['recent activity', 'top-N entity list'],
    cards: ['metric cards with delta and trend indicator'],
    calendars: [],
    charts: ['line/area for trends', 'bar for category compare'],
    emptyStateGuidance: 'New users see explicit onboarding state (CTA "Create your first X") instead of empty cards with "0".',
    loadingStateGuidance: 'Skeleton for each card and table on first load; do not block entire page on one slow widget.',
    errorStateGuidance: 'If a metric fetch fails, show error card with retry, not a silent zero.',
    mobileExpectations: ['cards stack vertically', 'tables become scrollable or collapse to cards'],
    accessibilitySmoke: ['heading hierarchy', 'metric numbers have aria-labels with units', 'focus visible on interactive cards'],
    requiredText: ['dashboard heading', 'at least one metric label and value'],
    requiredButtons: ['primary action (e.g. "+ New", "Create", "Add")'],
    formSubmissionChecks: [],
    antiPatterns: ['Metrics show fake/sample numbers', 'Dashboard is the marketing homepage', 'No primary action button'],
  },
  {
    id: 'marketplace_listing',
    title: 'Marketplace Listings Index',
    summary: 'Browse + filter + paginate listings for a multi-seller or multi-item index.',
    preferredFor: ['real_estate_property', 'media_creator'],
    requiredComponents: ['Card', 'Badge', 'Input', 'Select', 'Pagination', 'Sheet (filter drawer)'],
    requiredIcons: ['Search', 'Filter', 'MapPin', 'Star', 'Heart'],
    pageStructure: ['header with search', 'filter rail (sticky desktop, sheet on mobile)', 'results grid of cards', 'pagination footer'],
    primaryFlows: ['visitor searches/filters → result count updates → click card → detail page'],
    forms: ['inline filter form (URL-state-driven)'],
    tables: [],
    cards: ['listing card with image, title, price/key facts, badges'],
    calendars: [],
    charts: [],
    emptyStateGuidance: 'When filters yield 0 results, show "no matches" with link to clear filters — do NOT show an empty grid.',
    loadingStateGuidance: 'Skeleton cards in grid layout during fetch.',
    errorStateGuidance: 'Search backend error → "we could not load listings" with retry, keep filters intact.',
    mobileExpectations: ['filters move to bottom-sheet', 'single column card grid', 'search bar pinned'],
    accessibilitySmoke: ['filter controls have labels', 'each card link has descriptive aria-label'],
    requiredText: ['result count', 'category/title text of the first listing'],
    requiredButtons: ['filter/search submit (or auto-update)', 'pagination next/prev'],
    formSubmissionChecks: ['typing in search updates result list', 'changing a filter updates URL state + result set'],
    antiPatterns: ['No filters, no search — just a flat infinite list', 'Result count shows stale numbers', 'Filters reset on pagination'],
  },
  {
    id: 'ecommerce_storefront',
    title: 'Ecommerce Storefront',
    summary: 'Shop catalog + product detail + cart + checkout flow.',
    preferredFor: ['ecommerce_store'],
    requiredComponents: ['Card', 'Sheet (cart drawer)', 'Dialog', 'Tabs', 'Carousel', 'Badge', 'Input', 'Select'],
    requiredIcons: ['ShoppingCart', 'Heart', 'Search', 'Plus', 'Minus', 'Trash2', 'CreditCard', 'Truck'],
    pageStructure: ['storefront grid', 'product detail with gallery + variant selector + add to cart', 'cart drawer with line items and subtotal', 'checkout page with address + shipping + payment + summary'],
    primaryFlows: ['browse → product → add to cart → cart drawer → checkout → confirmation'],
    forms: ['address form', 'shipping selector', 'payment form (Stripe Elements or hosted checkout)'],
    tables: ['cart line items', 'order summary on confirmation'],
    cards: ['product card with image, title, price'],
    calendars: [],
    charts: [],
    emptyStateGuidance: 'Empty cart shows illustration + "Your cart is empty" + CTA to shop.',
    loadingStateGuidance: 'Skeleton product cards in grid; spinner inside add-to-cart button.',
    errorStateGuidance: 'Stock-out → inline message under variant selector with disabled add-to-cart.',
    mobileExpectations: ['cart drawer is full-screen sheet', 'sticky add-to-cart bar on product page', 'checkout fields stack'],
    accessibilitySmoke: ['variant selector keyboard navigable', 'cart count has aria-live so SR users hear updates', 'price has accessible label'],
    requiredText: ['at least one product title visible', 'cart total label', 'checkout/confirmation heading'],
    requiredButtons: ['Add to cart', 'Checkout', 'Place order'],
    formSubmissionChecks: ['add to cart updates cart count and drawer', 'checkout submit creates order row in DB', 'confirmation page shows order id'],
    antiPatterns: ['Cart resets on page reload', 'Add-to-cart is a link to a form, not an action button', 'Checkout has no order summary'],
  },
  {
    id: 'booking_calendar',
    title: 'Booking Calendar / Slot Picker',
    summary: 'Customer-facing flow to select date + time slot and confirm a booking.',
    preferredFor: ['local_service_booking'],
    requiredComponents: ['Calendar', 'Button', 'Card', 'Dialog', 'Select', 'RadioGroup'],
    requiredIcons: ['Calendar', 'Clock', 'CheckCircle2', 'XCircle', 'ChevronLeft', 'ChevronRight'],
    pageStructure: ['service picker (optional)', 'provider picker (optional)', 'date picker (calendar)', 'slot grid (time chips)', 'customer details form', 'confirmation panel'],
    primaryFlows: ['pick service → pick date → pick slot → enter details → submit → confirmation'],
    forms: ['booking form: name, email, phone, notes'],
    tables: [],
    cards: ['service card with name + duration + price'],
    calendars: ['date selector with disabled past dates and indicator of busy dates'],
    charts: [],
    emptyStateGuidance: 'No slots → "No availability on this date" with link to next available date.',
    loadingStateGuidance: 'Skeleton over slot grid while availability loads.',
    errorStateGuidance: 'Booking conflict (slot just taken) → "This slot was just booked. Please pick another." preserve form state.',
    mobileExpectations: ['calendar full-width', 'slot chips wrap to multiple rows', 'sticky confirm button'],
    accessibilitySmoke: ['calendar keyboard navigable', 'slot buttons have aria-label with full date+time', 'disabled slots have aria-disabled'],
    requiredText: ['service or provider name', 'date heading', 'confirmation text after submit (e.g. "Your booking is confirmed")'],
    requiredButtons: ['slot selection chips', 'Confirm booking'],
    formSubmissionChecks: ['picking a slot enables Confirm', 'submit creates booking row', 'confirmation page shows booking id'],
    antiPatterns: ['Bare datetime <input>', 'Available slots not visible until form is submitted', 'Double-book allowed (UI accepts but DB has 2 rows for same slot)'],
  },
  {
    id: 'admin_portal',
    title: 'Admin / Operator Portal',
    summary: 'Internal operations surface with role-aware navigation and approval/management tables.',
    preferredFor: ['ecommerce_store', 'business_website_crm', 'social_community', 'education_content', 'real_estate_property'],
    requiredComponents: ['Table', 'Tabs', 'Badge', 'DropdownMenu', 'Dialog', 'AlertDialog'],
    requiredIcons: ['Shield', 'Eye', 'CheckCircle2', 'XCircle', 'MoreHorizontal', 'AlertTriangle'],
    pageStructure: ['admin nav (sidebar or top tabs)', 'queue/list table', 'row detail dialog or detail page', 'action confirm dialog'],
    primaryFlows: ['admin opens queue → reviews item → approves/rejects → row status updates + audit row'],
    forms: ['approval form with optional notes'],
    tables: ['queue table with sortable columns, status badge, row actions'],
    cards: [],
    calendars: [],
    charts: [],
    emptyStateGuidance: 'Empty queue → "Nothing to review" with friendly illustration, NOT a permanent "no data" error.',
    loadingStateGuidance: 'Skeleton table rows during load.',
    errorStateGuidance: 'Action failure → toast with reason and retry; row stays selectable.',
    mobileExpectations: ['table becomes stacked cards on small screens', 'row actions in popover'],
    accessibilitySmoke: ['table has caption or aria-label', 'row actions are keyboard reachable'],
    requiredText: ['queue/title heading', 'status text on at least one row'],
    requiredButtons: ['Approve / Reject / Action button per row OR bulk action'],
    formSubmissionChecks: ['clicking approve flips row status + writes audit row', 'rejected rows disappear from open queue OR move to rejected tab'],
    antiPatterns: ['Admin actions go through a vague "edit" form instead of explicit approve/reject', 'Status changes have no audit trail', 'Admin portal is the homepage'],
  },
  {
    id: 'crm_pipeline',
    title: 'CRM Pipeline / Kanban',
    summary: 'Lead/deal pipeline visualized as stages with drag-or-click stage transitions and per-lead detail.',
    preferredFor: ['business_website_crm'],
    requiredComponents: ['Card', 'Tabs', 'Badge', 'Avatar', 'Sheet (detail)', 'Select'],
    requiredIcons: ['UserPlus', 'Phone', 'Mail', 'ArrowRight', 'StickyNote'],
    pageStructure: ['stage columns (or stage filters)', 'lead cards with name + stage + last touch', 'detail panel with notes timeline'],
    primaryFlows: ['new lead lands → admin opens lead → adds note → moves stage'],
    forms: ['add note form', 'stage transition select'],
    tables: ['alternative flat lead table view'],
    cards: ['lead card with stage badge'],
    calendars: [],
    charts: [],
    emptyStateGuidance: 'New install: shows demo-state with sample lead OR clear "No leads yet" with form link.',
    loadingStateGuidance: 'Skeleton stage columns.',
    errorStateGuidance: 'Stage transition failure → revert UI position + toast.',
    mobileExpectations: ['stages scroll horizontally or collapse to filter tabs'],
    accessibilitySmoke: ['stage transitions reachable by keyboard, not drag-only'],
    requiredText: ['at least one stage label', 'at least one lead name'],
    requiredButtons: ['Move stage / change stage', 'Add note'],
    formSubmissionChecks: ['adding a note appends to timeline + persists', 'changing stage updates lead.stage + writes audit'],
    antiPatterns: ['Drag-only stage change with no keyboard fallback', 'Notes lost on refresh', 'No way to see lead history'],
  },
  {
    id: 'inventory_table',
    title: 'Inventory / Operations Table',
    summary: 'Operational table for items, locations, movements with import/export.',
    preferredFor: ['inventory_operations'],
    requiredComponents: ['Table', 'Input', 'Select', 'Badge', 'Dialog', 'Tabs', 'DropdownMenu'],
    requiredIcons: ['Package', 'Plus', 'Minus', 'Upload', 'Download', 'AlertTriangle'],
    pageStructure: ['header with filter + import/export', 'items table', 'item detail drawer/page', 'movements log per item'],
    primaryFlows: ['search items → filter by location → adjust stock → audit row written', 'import CSV → preview → confirm → import result with errors per row'],
    forms: ['stock movement form (item, location, delta, reason)', 'CSV import wizard'],
    tables: ['items table', 'movements log table'],
    cards: ['low-stock alert card'],
    calendars: [],
    charts: ['low-stock count over time (optional)'],
    emptyStateGuidance: 'Empty inventory → "No items yet" with Import CSV + Add item CTAs.',
    loadingStateGuidance: 'Skeleton rows; preserve filter inputs.',
    errorStateGuidance: 'Negative stock blocked → inline error on movement form, not a generic 500.',
    mobileExpectations: ['table becomes stacked cards with key fields', 'movement form full-screen on mobile'],
    accessibilitySmoke: ['column headers in <th>', 'row actions keyboard reachable'],
    requiredText: ['inventory/items heading', 'at least one item row with sku/name'],
    requiredButtons: ['Add item / + New', 'Adjust stock or + movement', 'Import CSV / Export CSV'],
    formSubmissionChecks: ['adjusting stock writes movement row + updates level', 'CSV import surfaces per-row errors not silent drops'],
    antiPatterns: ['Stock mutated directly without a movement audit row', 'CSV silently drops malformed rows', 'No low-stock surface'],
  },
  {
    id: 'ai_workspace',
    title: 'AI Workspace / Job-Based AI UI',
    summary: 'Submit work → see job progress → review structured result with retry.',
    preferredFor: ['advanced_ai_mixed'],
    requiredComponents: ['Card', 'Tabs', 'Progress', 'Badge', 'Dialog', 'ScrollArea', 'Skeleton'],
    requiredIcons: ['Upload', 'Sparkles', 'Loader2', 'CheckCircle2', 'AlertCircle', 'RefreshCw'],
    pageStructure: ['upload / submit form', 'jobs list with status badge', 'job detail with result + retry'],
    primaryFlows: ['upload file → job created → polling/realtime updates status → result renders → retry on failure'],
    forms: ['upload form', 'prompt / parameters form'],
    tables: ['jobs list with status'],
    cards: ['job summary cards'],
    calendars: [],
    charts: ['optional: job throughput'],
    emptyStateGuidance: 'No jobs yet → upload zone is the focal point, not an empty list.',
    loadingStateGuidance: 'Progress component during job run; live-poll or stream status.',
    errorStateGuidance: 'Failed job → reason + retry; never silent.',
    mobileExpectations: ['upload area tappable, full-width', 'jobs list scrollable'],
    accessibilitySmoke: ['progress updates announced via aria-live', 'retry button keyboard reachable'],
    requiredText: ['result content rendered (not just "Done")', 'job status text on at least one job'],
    requiredButtons: ['Submit / Upload / Run', 'Retry (when applicable)'],
    formSubmissionChecks: ['submitting creates job row in DB', 'job status transitions (pending → running → done/failed)', 'completed job shows persisted result'],
    antiPatterns: ['AI runs inside HTTP handler (no job row)', 'Result computed each render (not persisted)', 'Failures hidden as success'],
  },
  {
    id: 'document_portal',
    title: 'Document Portal',
    summary: 'Upload + browse + view + share documents with metadata.',
    preferredFor: ['advanced_ai_mixed', 'construction_operations', 'real_estate_property'],
    requiredComponents: ['Card', 'Table', 'Dialog', 'Tabs', 'DropdownMenu', 'Badge', 'ScrollArea'],
    requiredIcons: ['FileText', 'Upload', 'Download', 'Share2', 'Trash2', 'Folder'],
    pageStructure: ['header with upload', 'folder/category tabs', 'document table or grid', 'document detail dialog or page'],
    primaryFlows: ['upload doc → appears in list → open → download or share'],
    forms: ['upload form with title/category/visibility'],
    tables: ['documents table'],
    cards: ['document tile'],
    calendars: [],
    charts: [],
    emptyStateGuidance: 'Empty → "No documents yet" with upload CTA.',
    loadingStateGuidance: 'Skeleton rows / tiles.',
    errorStateGuidance: 'Upload failure → row stays in "failed" state with retry, not silent drop.',
    mobileExpectations: ['documents in card grid', 'upload via tap'],
    accessibilitySmoke: ['file size / type labels exposed to AT', 'upload errors announced'],
    requiredText: ['documents heading', 'at least one filename or category'],
    requiredButtons: ['Upload', 'Download / Share / Delete row actions'],
    formSubmissionChecks: ['uploading persists metadata row even when blob creds missing (file_privacy_validation pack)', 'visibility/role enforced server-side'],
    antiPatterns: ['Anonymous direct-link bypass for private docs', 'Upload only persists when storage credentials configured'],
  },
  {
    id: 'social_feed',
    title: 'Social Feed',
    summary: 'Chronological or ranked feed of posts with comments, reactions, mentions, notifications.',
    preferredFor: ['social_community'],
    requiredComponents: ['Card', 'Avatar', 'Tabs', 'Sheet (post detail)', 'Badge', 'Textarea'],
    requiredIcons: ['Heart', 'MessageCircle', 'Repeat2', 'Bell', 'AtSign', 'Send'],
    pageStructure: ['top tabs (Home/Following/Notifications)', 'compose box', 'feed of post cards', 'post detail with thread'],
    primaryFlows: ['compose post → appears in feed → others comment/react → notification fan-out'],
    forms: ['post compose form', 'comment compose form'],
    tables: [],
    cards: ['post card with author + body + reactions + comment count'],
    calendars: [],
    charts: [],
    emptyStateGuidance: 'Empty feed → suggest follows or show getting-started post.',
    loadingStateGuidance: 'Skeleton post cards while feed loads; infinite-scroll loader at bottom.',
    errorStateGuidance: 'Compose failure → keep draft + show retry.',
    mobileExpectations: ['full-width post cards', 'pull-to-refresh OR refresh button'],
    accessibilitySmoke: ['reaction buttons have aria-label and aria-pressed state'],
    requiredText: ['at least one post body visible', 'reaction or comment count'],
    requiredButtons: ['Post / Reply', 'React / Like'],
    formSubmissionChecks: ['post submit creates row + appears in feed', 'reaction toggle is idempotent (no duplicate rows)'],
    antiPatterns: ['Feed query loads all posts on every render', 'Reactions allow duplicate from same user', 'No notification surface'],
  },
  {
    id: 'real_estate_listing',
    title: 'Real Estate Listing Detail',
    summary: 'Property listing detail with photo gallery, facts, agent contact, inquiry form.',
    preferredFor: ['real_estate_property'],
    requiredComponents: ['Carousel', 'Card', 'Tabs', 'Dialog', 'Badge', 'Button'],
    requiredIcons: ['Home', 'MapPin', 'BedDouble', 'Bath', 'Ruler', 'Heart', 'Mail'],
    pageStructure: ['photo gallery / carousel', 'key facts (beds/baths/area/price)', 'description', 'agent card with contact', 'inquiry form'],
    primaryFlows: ['visitor views listing → fills inquiry → inquiry row + agent notified'],
    forms: ['inquiry form (name, email, phone, message, optional tour date)'],
    tables: [],
    cards: ['agent card', 'similar listings'],
    calendars: ['optional: tour-time picker'],
    charts: [],
    emptyStateGuidance: 'Missing photos → placeholder with "No photos available" — not a broken img.',
    loadingStateGuidance: 'Carousel skeleton; facts skeleton.',
    errorStateGuidance: 'Inquiry submission failure → keep form, show error, allow retry.',
    mobileExpectations: ['gallery swipeable', 'sticky inquiry CTA', 'tabs collapse'],
    accessibilitySmoke: ['carousel keyboard navigable', 'images have alt with caption'],
    requiredText: ['property title/address', 'price', 'beds/baths/area'],
    requiredButtons: ['Inquire / Contact agent', 'Save / favorite'],
    formSubmissionChecks: ['inquiry submit creates inquiry row + emails or queues notification', 'save creates saved_properties row'],
    antiPatterns: ['Listing visible before approval (admin queue bypassed)', 'Inquiry form lacks rate limit / honeypot', 'Carousel without keyboard nav'],
  },
  {
    id: 'media_creator_gallery',
    title: 'Creator Gallery',
    summary: 'Public creator profile with gallery grid + gated premium content + subscribe CTA.',
    preferredFor: ['media_creator'],
    requiredComponents: ['Card', 'Tabs', 'Dialog', 'Badge', 'AspectRatio', 'Avatar'],
    requiredIcons: ['Image', 'Lock', 'Crown', 'Play', 'Heart', 'Share2'],
    pageStructure: ['hero with creator name + bio + subscribe', 'gallery tabs (Free/Premium)', 'media grid', 'gated overlay on premium items'],
    primaryFlows: ['fan opens creator profile → sees gallery → hits gated item → subscribe / unlock'],
    forms: ['subscribe / payment form'],
    tables: [],
    cards: ['media tiles with gated badge'],
    calendars: [],
    charts: [],
    emptyStateGuidance: 'Creator with no media → "Coming soon" placeholder, not an empty grid.',
    loadingStateGuidance: 'Skeleton tiles in grid.',
    errorStateGuidance: 'Gated media access denied → clean unlock CTA, not a 403 page.',
    mobileExpectations: ['gallery 2-column grid', 'subscribe CTA sticky-on-scroll'],
    accessibilitySmoke: ['gated overlay has aria-label "premium content"', 'tab switch reachable by keyboard'],
    requiredText: ['creator name + bio', 'at least one media item title or alt'],
    requiredButtons: ['Subscribe / Unlock', 'Play / View'],
    formSubmissionChecks: ['subscribe flow creates subscription record (or payment-ready record)', 'gated content access checked server-side'],
    antiPatterns: ['Gated URL accessible to non-subscribers via direct link', 'Media uploads only persist when storage configured'],
  },
  {
    id: 'education_lms',
    title: 'Education / LMS UI',
    summary: 'Course catalog + course detail with module outline + lesson view with progress.',
    preferredFor: ['education_content'],
    requiredComponents: ['Card', 'Tabs', 'Accordion (module outline)', 'Progress', 'Badge', 'Dialog'],
    requiredIcons: ['GraduationCap', 'BookOpen', 'PlayCircle', 'CheckCircle2', 'Lock'],
    pageStructure: ['catalog grid', 'course detail with module accordion', 'lesson page with content body + mark-complete', 'progress dashboard'],
    primaryFlows: ['browse → enroll → consume lesson → mark complete → progress updates'],
    forms: ['lesson authoring rich-text', 'quiz submission'],
    tables: ['enrollments admin view'],
    cards: ['course card with instructor + duration + level'],
    calendars: [],
    charts: ['progress bar per course'],
    emptyStateGuidance: 'Not enrolled in any → CTA to browse catalog.',
    loadingStateGuidance: 'Skeleton catalog cards; skeleton outline.',
    errorStateGuidance: 'Lesson load failure → retry, preserve mark-complete state.',
    mobileExpectations: ['outline collapses to accordion on mobile', 'lesson body readable single column'],
    accessibilitySmoke: ['mark-complete is a real button with state', 'video player has captions option'],
    requiredText: ['course title', 'lesson body', 'progress indicator label'],
    requiredButtons: ['Enroll', 'Mark complete'],
    formSubmissionChecks: ['enroll creates enrollment row', 'mark-complete is idempotent (one progress row per (user, lesson))', 'admin publish flips course.published_at'],
    antiPatterns: ['Lessons stored as raw HTML (XSS risk)', 'Progress double-counted', 'Draft courses leak into public catalog'],
  },
  {
    id: 'health_plan_tracker',
    title: 'Health / Fitness Plan Tracker',
    summary: "Today's plan + log entry + progress view tailored to user goals/preferences.",
    preferredFor: ['health_fitness_food'],
    requiredComponents: ['Card', 'Tabs', 'Progress', 'Dialog', 'Switch', 'Input'],
    requiredIcons: ['Dumbbell', 'Apple', 'Flame', 'CheckCircle2', 'Calendar'],
    pageStructure: ['today view (logged-in homepage)', 'log entry forms (workout/meal)', 'progress page with charts', 'preferences page'],
    primaryFlows: ['user opens app → sees today plan → logs workout/meal → progress updates'],
    forms: ['workout log form', 'meal log form', 'preferences form'],
    tables: ['log history table'],
    cards: ['plan card', 'streak card', 'goal card'],
    calendars: ['weekly calendar of plan'],
    charts: ['streak / weight / calories over time'],
    emptyStateGuidance: 'New user → onboarding to set goals, NOT an empty today view.',
    loadingStateGuidance: 'Skeleton plan + progress.',
    errorStateGuidance: 'Log failure → keep entry, allow retry.',
    mobileExpectations: ['large touch targets for log entry', 'today view single column'],
    accessibilitySmoke: ['progress bars have aria-valuenow', 'switches are real <button role="switch">'],
    requiredText: ['today date / plan title', 'at least one workout or meal name'],
    requiredButtons: ['Log workout / Log meal', 'Mark complete'],
    formSubmissionChecks: ['log submit persists row', 'today view reflects new log', 'progress page aggregates correctly'],
    antiPatterns: ['Plan is a hardcoded template', 'Logs lost across days due to timezone confusion', 'No empty state for new users'],
  },
  {
    id: 'construction_ops_board',
    title: 'Construction Operations Board',
    summary: 'Project overview + schedule + bids + safety + equipment for site/project teams.',
    preferredFor: ['construction_operations'],
    requiredComponents: ['Tabs', 'Card', 'Table', 'Badge', 'Dialog', 'Calendar'],
    requiredIcons: ['HardHat', 'Truck', 'CalendarRange', 'ShieldAlert', 'FileText'],
    pageStructure: ['project list', 'project detail with tabs (Overview/Schedule/Bids/Safety/Equipment)', 'add/edit dialogs'],
    primaryFlows: ['PM creates project → adds schedule + bids → site supervisor logs safety + equipment'],
    forms: ['project form', 'bid form', 'schedule entry form', 'safety log form', 'equipment assignment'],
    tables: ['bids table', 'schedule table', 'safety log table', 'equipment table'],
    cards: ['project summary card', 'safety alert card'],
    calendars: ['schedule view'],
    charts: ['optional: project timeline / gantt'],
    emptyStateGuidance: 'New project tab → CTA to create first entry per category.',
    loadingStateGuidance: 'Skeleton per tab.',
    errorStateGuidance: 'Bid status conflict → toast + revert.',
    mobileExpectations: ['tabs collapse to dropdown', 'tables become cards'],
    accessibilitySmoke: ['tab keyboard navigation', 'safety severity has color + label (not color-only)'],
    requiredText: ['project name', 'at least one tab content visible'],
    requiredButtons: ['+ Project', '+ Bid / + Schedule / + Safety / + Equipment'],
    formSubmissionChecks: ['adding entries appears in respective tab + DB row', 'equipment double-assign rejected'],
    antiPatterns: ['Everything collapsed into a single "tasks" table', 'Bid status changed silently with no audit', 'Equipment assigned to two projects simultaneously'],
  },
  {
    id: 'finance_dashboard',
    title: 'Finance / Portfolio Dashboard',
    summary: 'Portfolio summary + holdings + price alerts + transaction history with stale-data safety.',
    preferredFor: ['finance_crypto'],
    requiredComponents: ['Card', 'Tabs', 'Table', 'Badge', 'Dialog', 'Tooltip'],
    requiredIcons: ['TrendingUp', 'TrendingDown', 'BellRing', 'Wallet', 'AlertTriangle'],
    pageStructure: ['summary cards (total value, 24h change, alerts)', 'holdings table', 'price chart', 'alerts list', 'transactions list'],
    primaryFlows: ['user views portfolio → sets alert → records transaction → sees updated balance'],
    forms: ['alert form (instrument, condition, threshold)', 'transaction form'],
    tables: ['holdings', 'alerts', 'transactions'],
    cards: ['summary metric cards with stale-data indicator'],
    calendars: [],
    charts: ['price chart (line/candle)', 'allocation pie'],
    emptyStateGuidance: 'Empty portfolio → "Add your first holding" CTA.',
    loadingStateGuidance: 'Skeleton cards + chart.',
    errorStateGuidance: 'Market API down → show last_updated timestamp + stale indicator (NOT crash or fake numbers).',
    mobileExpectations: ['summary cards stack', 'chart resizes', 'tables become condensed'],
    accessibilitySmoke: ['price deltas have aria-label including direction', 'chart has tabular data alternative'],
    requiredText: ['portfolio value or "Add holding" CTA', 'at least one instrument name'],
    requiredButtons: ['Create alert', 'Add transaction'],
    formSubmissionChecks: ['alert form persists row', 'transaction creates row + updates running balance'],
    antiPatterns: ['Fake portfolio numbers when no data', 'No stale-data indicator on prices', 'Market API failure crashes dashboard'],
  },
];

const PATTERN_BY_ID: Map<FrontendPatternId, FrontendPattern> = new Map(
  FRONTEND_PATTERNS.map((pattern) => [pattern.id, pattern]),
);

const DOMAIN_TO_PATTERNS: Map<DomainId, FrontendPatternId[]> = (() => {
  const map = new Map<DomainId, FrontendPatternId[]>();
  for (const pattern of FRONTEND_PATTERNS) {
    for (const domain of pattern.preferredFor) {
      const existing = map.get(domain) ?? [];
      existing.push(pattern.id);
      map.set(domain, existing);
    }
  }
  return map;
})();

// ── Public API ────────────────────────────────────────────────────────

export function listFrontendPatterns(): FrontendPattern[] {
  return FRONTEND_PATTERNS;
}

export function getFrontendPattern(id: string): FrontendPattern | null {
  return PATTERN_BY_ID.get(id as FrontendPatternId) ?? null;
}

export function patternsForDomain(domain: string): FrontendPatternId[] {
  return DOMAIN_TO_PATTERNS.get(domain as DomainId) ?? [];
}

// ── Plan composition ─────────────────────────────────────────────────

const PUBLIC_DOMAINS = new Set<string>([
  'ecommerce_store',
  'business_website_crm',
  'social_community',
  'media_creator',
  'real_estate_property',
  'education_content',
]);

function classifyAudience(path: string, hasAuth: boolean): 'public' | 'authenticated' | 'admin' {
  const p = path.toLowerCase();
  if (p.startsWith('/admin')) return 'admin';
  if (p.startsWith('/account') || p.startsWith('/dashboard') || p.startsWith('/today') || p.startsWith('/instructor') || p.startsWith('/creator/dashboard')) return 'authenticated';
  return hasAuth && !['/', '/about', '/contact', '/services', '/login', '/signup', '/listings', '/shop', '/product', '/courses', '/feed'].some((pub) => p === pub || p.startsWith(`${pub}/`))
    ? 'authenticated'
    : 'public';
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqBy<T>(values: T[], keyFor: (value: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function contract(
  id: string,
  kind: FrontendInteractionContract['kind'],
  page: string,
  labelPattern: string,
  fields: string[],
  api: string,
  dbWrites: string[],
  uiReadback: string[],
  failureState = 'Show inline error/toast, preserve user input, and keep the action retryable.',
): FrontendInteractionContract {
  return {
    id,
    kind,
    page,
    labelPattern,
    fields,
    api,
    dbWrites,
    uiReadback,
    failureState,
    selectorHint: `Add data-testid="${id}" or an accessible name matching /${labelPattern}/i.`,
  };
}

function normalizeReferencePatternIds(referencePatterns: string[] | undefined): string[] {
  return uniq((referencePatterns ?? []).map((id) => id.trim()).filter(Boolean));
}

function visualQualityRulesForReferences(referencePatternIds: string[]): string[] {
  const ids = referencePatternIds.map((id) => id.toLowerCase());
  const rules = [
    'All visible text/buttons/selects/dropdowns must meet contrast; white-on-white or black-on-dark active controls are blockers.',
    'Primary actions must look clickable and enabled when active; disabled styling is allowed only when the control is actually disabled.',
  ];
  if (ids.some((id) => id.includes('open-codesign'))) {
    rules.push('Carry a product-specific visual brief through implementation and compare deployed screenshots against it before finishing.');
  }
  if (ids.some((id) => id.includes('onlook'))) {
    rules.push('For a browser-visible defect, repair the exact route/component/control reported by the verifier, then rerun the same browser check.');
  }
  if (ids.some((id) => id.includes('tremor') || id.includes('dub') || id.includes('midday') || id.includes('twenty'))) {
    rules.push('Dense dashboard surfaces must use real data, clear empty/error states, compact hierarchy, and no fake demo metrics.');
  }
  return uniq(rules);
}

function accessibilityRulesForReferences(referencePatternIds: string[]): string[] {
  const ids = referencePatternIds.map((id) => id.toLowerCase());
  const rules = [
    'Every interactive control must have an accessible name; icon-only controls require aria-label or title.',
    'Forms must expose labels, validation errors, submit state, and visible success/readback after mutation.',
  ];
  if (ids.some((id) => id.includes('radix'))) {
    rules.push('Dropdown/select/menu/dialog controls must support keyboard navigation, visible focus, readable hover/focus/selected options, and predictable close behavior.');
  }
  if (ids.some((id) => id.includes('onlook'))) {
    rules.push('Screenshot-driven fixes must preserve existing keyboard/focus behavior and data submission contracts.');
  }
  return uniq(rules);
}

function contractsForPattern(
  patternId: FrontendPatternId,
  page: string,
  capabilities: string[],
): FrontendInteractionContract[] {
  const has = (capability: string) => capabilities.includes(capability);
  const contracts: FrontendInteractionContract[] = [];
  switch (patternId) {
    case 'ecommerce_storefront':
      contracts.push(
        contract('add_to_cart', 'checkout', page, 'add to cart|cart', ['product_id', 'quantity', 'variant'], 'POST /api/cart/items or server action', ['cart_items'], ['cart count updates', 'line item appears in cart']),
        contract('checkout_order', 'checkout', page, 'checkout|place order|pay', ['cart_id', 'email', 'shipping_address'], 'POST /api/checkout or Stripe Checkout Session', ['orders', 'payment_events'], ['confirmation heading', 'order id or payment-ready state']),
      );
      break;
    case 'booking_calendar':
      contracts.push(
        contract('confirm_booking', 'book_reserve', page, 'confirm booking|book|reserve|schedule', ['slot_id', 'customer_name', 'customer_email'], 'POST /api/bookings', ['bookings'], ['booking confirmation', 'booking id']),
      );
      break;
    case 'admin_portal':
      contracts.push(
        contract('approve_record', 'approve_reject', page, 'approve|accept', ['record_id', 'review_note'], 'POST/PATCH approval route', ['approval_events', 'audit_logs'], ['status changes to approved', 'row updates visibly']),
        contract('reject_record', 'approve_reject', page, 'reject|decline', ['record_id', 'review_note'], 'POST/PATCH rejection route', ['approval_events', 'audit_logs'], ['status changes to rejected', 'row moves or updates visibly']),
      );
      break;
    case 'document_portal':
      contracts.push(
        contract('save_document', 'upload_file', page, 'upload|save document|record document|submit', ['document_name', 'document_url_or_file', 'document_type'], 'POST /api/documents or storage upload route', ['documents', 'file_metadata'], ['document name appears', 'stored/uploaded status appears']),
      );
      break;
    case 'ai_workspace':
      contracts.push(
        contract('run_ai_action', 'ai_action', page, 'analy[sz]e|extract|summarize|generate|run', ['input_text_or_document_id'], 'POST /api/ai/*', ['ai_results', 'jobs'], ['generated result appears', 'history item appears']),
      );
      if (has('rag_search')) {
        contracts.push(
          contract('search_history', 'search_filter', page, 'search|query', ['query'], 'GET/POST /api/search', [], ['matching result appears', 'empty state appears when no matches']),
        );
      }
      break;
    case 'marketplace_listing':
    case 'real_estate_listing':
      contracts.push(
        contract('search_listings', 'search_filter', page, 'search|filter', ['query', 'category'], 'GET /api/listings/search', [], ['result count updates', 'filtered listing appears']),
      );
      break;
    case 'crm_pipeline':
      contracts.push(
        contract('create_lead', 'create_record', page, 'create lead|add lead|new lead', ['name', 'email', 'stage'], 'POST /api/leads', ['leads'], ['lead card appears', 'pipeline count updates']),
      );
      break;
    case 'inventory_table':
      contracts.push(
        contract('create_inventory_item', 'create_record', page, 'add item|create item|save item', ['sku', 'name', 'quantity'], 'POST /api/items', ['items', 'inventory_movements'], ['item row appears', 'stock count updates']),
      );
      break;
    case 'social_feed':
      contracts.push(
        contract('create_post', 'message_comment', page, 'post|publish|comment|reply', ['body'], 'POST /api/posts or /api/comments', ['posts', 'comments'], ['post/comment appears in feed']),
      );
      break;
    case 'education_lms':
      contracts.push(
        contract('enroll_or_create_lesson', 'create_record', page, 'enroll|create lesson|save lesson|complete lesson', ['course_id', 'title_or_progress'], 'POST /api/courses/*', ['lessons', 'enrollments', 'progress'], ['course/lesson/progress appears']),
      );
      break;
    case 'health_plan_tracker':
      contracts.push(
        contract('log_health_entry', 'create_record', page, 'log|save|complete', ['entry_type', 'value', 'date'], 'POST /api/health-entries', ['health_entries'], ['entry appears', 'progress updates']),
      );
      break;
    case 'construction_ops_board':
      contracts.push(
        contract('create_project_update', 'create_record', page, 'add update|save log|create task', ['project_id', 'status', 'note'], 'POST /api/projects/*', ['project_updates', 'daily_logs'], ['update appears', 'status updates']),
      );
      break;
    case 'finance_dashboard':
      contracts.push(
        contract('create_finance_alert', 'create_record', page, 'add alert|create alert|save watchlist', ['symbol', 'threshold'], 'POST /api/alerts or /api/watchlist', ['alerts', 'watchlist_items'], ['alert/watchlist row appears']),
      );
      break;
    case 'dashboard':
      contracts.push(
        contract('dashboard_primary_action', 'create_record', page, 'new|create|add|save', ['name'], 'POST /api/*', ['records'], ['new record appears', 'metric updates']),
      );
      break;
    case 'landing_site':
    case 'media_creator_gallery':
      break;
  }
  if (has('auth')) {
    contracts.push(
      contract('auth_session', 'auth_session', '/login', 'sign in|sign up|create account|sign out', ['email', 'password'], 'Better Auth /api/auth/* route', ['user', 'session', 'account'], ['authenticated product surface appears', 'sign out removes access']),
    );
  }
  if (has('email_notifications')) {
    contracts.push(
      contract('notification_ready', 'background_status', page, 'notify|send|save|submit', ['recipient', 'message_or_event_id'], 'POST /api/notifications or event hook', ['notifications'], ['notification/activity row appears']),
    );
  }
  return contracts;
}

export function composeFrontendPlan(input: FrontendPlanInput): FrontendPlan {
  const domainIds = uniq((input.domains ?? []).map((id) => id.trim()).filter(Boolean));
  const capabilities = uniq((input.capabilities ?? []).map((id) => id.trim()).filter(Boolean));
  const uiReferencePatterns = normalizeReferencePatternIds(input.referencePatterns);
  const hasAuth = capabilities.includes('auth');

  // Resolve patterns: explicit domains → their preferred patterns; otherwise dashboard fallback.
  const patternIds: FrontendPatternId[] = uniq(
    domainIds.flatMap((id) => patternsForDomain(id)).length > 0
      ? domainIds.flatMap((id) => patternsForDomain(id))
      : [],
  );

  // Always include landing_site when public surface is implied by domain.
  if (domainIds.some((id) => PUBLIC_DOMAINS.has(id)) && !patternIds.includes('landing_site')) {
    patternIds.unshift('landing_site');
  }

  // Always include admin_portal when admin_workflow is selected.
  if (capabilities.includes('admin_workflow') && !patternIds.includes('admin_portal')) {
    patternIds.push('admin_portal');
  }

  // Fallback for "no domain" case: dashboard only.
  if (patternIds.length === 0) {
    patternIds.push('dashboard');
  }

  const patterns = patternIds.map((id) => PATTERN_BY_ID.get(id)).filter((p): p is FrontendPattern => !!p);
  const uiType: FrontendPatternId | 'mixed' | 'generic' =
    patterns.length === 1 ? patterns[0].id : patterns.length > 1 ? 'mixed' : 'generic';

  // Page map: union of provided pages + patterns' page structure hints
  const providedPages = uniq((input.pages ?? []).map((p) => p.trim()).filter(Boolean));
  const inferredPages: string[] = [];
  if (patterns.some((p) => p.id === 'landing_site')) inferredPages.push('/');
  if (patterns.some((p) => p.id === 'dashboard')) inferredPages.push('/dashboard');
  if (patterns.some((p) => p.id === 'ecommerce_storefront')) inferredPages.push('/', '/shop', '/product/[id]', '/cart', '/checkout', '/orders');
  if (patterns.some((p) => p.id === 'booking_calendar')) inferredPages.push('/services', '/book');
  if (patterns.some((p) => p.id === 'admin_portal')) inferredPages.push('/admin');
  if (patterns.some((p) => p.id === 'crm_pipeline')) inferredPages.push('/admin/leads');
  if (patterns.some((p) => p.id === 'inventory_table')) inferredPages.push('/items', '/movements');
  if (patterns.some((p) => p.id === 'ai_workspace')) inferredPages.push('/jobs', '/jobs/[id]');
  if (patterns.some((p) => p.id === 'document_portal')) inferredPages.push('/documents');
  if (patterns.some((p) => p.id === 'social_feed')) inferredPages.push('/feed', '/post/[id]', '/profile/[handle]');
  if (patterns.some((p) => p.id === 'real_estate_listing')) inferredPages.push('/listings', '/listings/[id]');
  if (patterns.some((p) => p.id === 'media_creator_gallery')) inferredPages.push('/creator/[handle]');
  if (patterns.some((p) => p.id === 'education_lms')) inferredPages.push('/courses', '/courses/[slug]', '/lessons/[id]');
  if (patterns.some((p) => p.id === 'health_plan_tracker')) inferredPages.push('/today', '/progress');
  if (patterns.some((p) => p.id === 'construction_ops_board')) inferredPages.push('/projects', '/projects/[id]');
  if (patterns.some((p) => p.id === 'finance_dashboard')) inferredPages.push('/portfolio');
  if (hasAuth) inferredPages.push('/login');

  const pagePaths = uniq([...providedPages, ...inferredPages]);

  // Build per-page plan
  const pageMap: FrontendPagePlan[] = pagePaths.map((path): FrontendPagePlan => {
    const lower = path.toLowerCase();
    let uiTypeForPage: FrontendPatternId | 'generic' = 'generic';
    // Pick the most specific pattern for this path.
    if (lower === '/' && patterns.some((p) => p.id === 'landing_site')) uiTypeForPage = 'landing_site';
    else if (lower === '/' && patterns.some((p) => p.id === 'ecommerce_storefront')) uiTypeForPage = 'ecommerce_storefront';
    else if (lower.startsWith('/admin')) uiTypeForPage = patterns.some((p) => p.id === 'admin_portal') ? 'admin_portal' : 'generic';
    else if (lower.startsWith('/admin/leads')) uiTypeForPage = 'crm_pipeline';
    else if (lower.startsWith('/dashboard') || lower === '/today') uiTypeForPage = patterns.some((p) => p.id === 'health_plan_tracker') ? 'health_plan_tracker' : 'dashboard';
    else if (lower.startsWith('/shop') || lower.startsWith('/product') || lower.startsWith('/cart') || lower.startsWith('/checkout')) uiTypeForPage = 'ecommerce_storefront';
    else if (lower.startsWith('/book') || lower.startsWith('/services')) uiTypeForPage = 'booking_calendar';
    else if (lower.startsWith('/items') || lower.startsWith('/movements')) uiTypeForPage = 'inventory_table';
    else if (lower.startsWith('/jobs')) uiTypeForPage = 'ai_workspace';
    else if (lower.startsWith('/documents')) uiTypeForPage = 'document_portal';
    else if (lower.startsWith('/feed') || lower.startsWith('/post') || lower.startsWith('/profile')) uiTypeForPage = 'social_feed';
    else if (lower.startsWith('/listings')) uiTypeForPage = 'real_estate_listing';
    else if (lower.startsWith('/creator')) uiTypeForPage = 'media_creator_gallery';
    else if (lower.startsWith('/courses') || lower.startsWith('/lessons')) uiTypeForPage = 'education_lms';
    else if (lower.startsWith('/projects')) uiTypeForPage = 'construction_ops_board';
    else if (lower.startsWith('/portfolio') || lower.startsWith('/watchlist') || lower.startsWith('/alerts')) uiTypeForPage = 'finance_dashboard';

    const audience = classifyAudience(path, hasAuth);
    const pattern = uiTypeForPage !== 'generic' ? PATTERN_BY_ID.get(uiTypeForPage) : undefined;
    return {
      path,
      uiType: uiTypeForPage,
      audience,
      required_text: pattern?.requiredText ?? [],
      required_buttons: pattern?.requiredButtons ?? [],
      form_submission_checks: pattern?.formSubmissionChecks ?? [],
      must_call_backend: pattern ? pattern.formSubmissionChecks.length > 0 : false,
      empty_state: pattern?.emptyStateGuidance ?? 'Default to an explicit "no data yet" message with a CTA, never a blank screen.',
      loading_state: pattern?.loadingStateGuidance ?? 'Show a skeleton or spinner for slow fetches; do not block first paint.',
      error_state: pattern?.errorStateGuidance ?? 'Show explicit error message with retry, not a silent failure.',
    };
  });

  // Navigation: top-level paths that real visitors should be able to reach
  const navigation = uniq(pageMap
    .filter((p) => p.audience === 'public' || (p.audience === 'authenticated' && hasAuth))
    .map((p) => p.path)
    .filter((p) => !p.includes('[')));
  const interactionContracts = uniqBy(
    pageMap.flatMap((page) =>
      page.uiType === 'generic'
        ? []
        : contractsForPattern(page.uiType, page.path, capabilities)
    ),
    (item) => item.id,
  );

  return {
    uiType,
    patternIds,
    pageMap,
    navigation,
    primaryFlows: uniq(patterns.flatMap((p) => p.primaryFlows)),
    shadcnComponents: uniq(patterns.flatMap((p) => p.requiredComponents)),
    lucideIcons: uniq(patterns.flatMap((p) => p.requiredIcons)),
    forms: uniq(patterns.flatMap((p) => p.forms)),
    tables: uniq(patterns.flatMap((p) => p.tables)),
    cards: uniq(patterns.flatMap((p) => p.cards)),
    calendars: uniq(patterns.flatMap((p) => p.calendars)),
    charts: uniq(patterns.flatMap((p) => p.charts)),
    loadingStates: uniq(patterns.map((p) => p.loadingStateGuidance)),
    emptyStates: uniq(patterns.map((p) => p.emptyStateGuidance)),
    errorStates: uniq(patterns.map((p) => p.errorStateGuidance)),
    uiReferencePatterns,
    visualQualityRules: visualQualityRulesForReferences(uiReferencePatterns),
    componentAccessibilityRules: accessibilityRulesForReferences(uiReferencePatterns),
    mobileExpectations: uniq(patterns.flatMap((p) => p.mobileExpectations)),
    accessibilitySmoke: uniq(patterns.flatMap((p) => p.accessibilitySmoke)),
    browserUiRequiredText: uniq(patterns.flatMap((p) => p.requiredText)),
    browserUiRequiredButtons: uniq(patterns.flatMap((p) => p.requiredButtons)),
    browserUiFormSubmissionChecks: uniq(patterns.flatMap((p) => p.formSubmissionChecks)),
    interactionContracts,
    blockingRules: [
      'homepage must NOT be only API docs or admin login',
      'UI must NOT be a generic SaaS dashboard for an unrelated domain',
      'buttons and forms MUST call backend endpoints (not just toast on click)',
      'submitted data MUST reappear in the UI on the next render (round-trip)',
      'mobile viewport MUST be usable (no horizontal scroll on key pages)',
      'white-on-white buttons, unreadable dropdown/select options, and icon-only unlabeled controls are blocker bugs',
      'design_audit must report zero HIGH findings',
      'design_critique must report zero BLOCKER findings',
      'verify_browser_ui must be called and fresh (run after final deploy)',
      ...patterns.flatMap((p) => p.antiPatterns.map((rule) => `pattern[${p.id}]: avoid — ${rule}`)),
    ],
  };
}

// ── Formatters ────────────────────────────────────────────────────────

export function formatFrontendPlan(plan: FrontendPlan): string {
  const lines: string[] = [];
  lines.push(`Frontend plan ui_type=${plan.uiType} pattern_ids=${plan.patternIds.join(',') || 'none'}`);
  lines.push('');
  lines.push('Page map:');
  for (const page of plan.pageMap) {
    lines.push(`- ${page.path}  [${page.uiType}]  audience=${page.audience}  must_call_backend=${page.must_call_backend}`);
    if (page.required_text.length) lines.push(`    required_text: ${page.required_text.join(' | ')}`);
    if (page.required_buttons.length) lines.push(`    required_buttons: ${page.required_buttons.join(' | ')}`);
    if (page.form_submission_checks.length) lines.push(`    form_submission_checks: ${page.form_submission_checks.join(' | ')}`);
  }
  lines.push('');
  lines.push(`Navigation: ${plan.navigation.join(', ') || 'n/a'}`);
  lines.push(`Primary flows:\n${plan.primaryFlows.map((f) => `- ${f}`).join('\n') || '- (no flows derived)'}`);
  lines.push('');
  lines.push(`shadcn/ui components: ${plan.shadcnComponents.join(', ')}`);
  lines.push(`lucide-react icons: ${plan.lucideIcons.join(', ')}`);
  lines.push(`Forms: ${plan.forms.join(' | ') || 'none'}`);
  lines.push(`Tables: ${plan.tables.join(' | ') || 'none'}`);
  lines.push(`Cards: ${plan.cards.join(' | ') || 'none'}`);
  lines.push(`Calendars: ${plan.calendars.join(' | ') || 'none'}`);
  lines.push(`Charts: ${plan.charts.join(' | ') || 'none'}`);
  lines.push('');
  lines.push(`UI reference patterns: ${plan.uiReferencePatterns.join(', ') || 'none'}`);
  lines.push('Visual quality rules:');
  for (const rule of plan.visualQualityRules) lines.push(`- ${rule}`);
  lines.push('Component accessibility rules:');
  for (const rule of plan.componentAccessibilityRules) lines.push(`- ${rule}`);
  lines.push('');
  lines.push('Loading states:');
  for (const ls of plan.loadingStates) lines.push(`- ${ls}`);
  lines.push('Empty states:');
  for (const es of plan.emptyStates) lines.push(`- ${es}`);
  lines.push('Error states:');
  for (const es of plan.errorStates) lines.push(`- ${es}`);
  lines.push('');
  lines.push('Mobile expectations:');
  for (const m of plan.mobileExpectations) lines.push(`- ${m}`);
  lines.push('Accessibility smoke:');
  for (const a of plan.accessibilitySmoke) lines.push(`- ${a}`);
  lines.push('');
  lines.push(`Browser UI required_text: ${plan.browserUiRequiredText.join(' | ')}`);
  lines.push(`Browser UI required_buttons: ${plan.browserUiRequiredButtons.join(' | ')}`);
  lines.push('Browser UI form_submission_checks:');
  for (const c of plan.browserUiFormSubmissionChecks) lines.push(`- ${c}`);
  lines.push('');
  lines.push('Interaction contracts (button/form -> API/action -> DB/readback):');
  if (plan.interactionContracts.length === 0) {
    lines.push('- none required for this surface');
  } else {
    for (const item of plan.interactionContracts) {
      lines.push(`- ${item.id} [${item.kind}] page=${item.page}`);
      lines.push(`    action: /${item.labelPattern}/i`);
      lines.push(`    fields: ${item.fields.join(', ') || 'none'}`);
      lines.push(`    backend: ${item.api}`);
      lines.push(`    db_writes: ${item.dbWrites.join(', ') || 'none'}`);
      lines.push(`    ui_readback: ${item.uiReadback.join(' | ')}`);
      lines.push(`    selector: ${item.selectorHint}`);
    }
  }
  lines.push('');
  lines.push('Blocking rules (completion gate enforces these):');
  for (const r of plan.blockingRules) lines.push(`- ${r}`);
  return lines.join('\n');
}
