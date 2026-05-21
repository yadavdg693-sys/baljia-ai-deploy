// 12 extended canary scenarios — one per goal domain.
//
// These reuse the CanaryScenario shape from canary-render-engineering.ts and
// add the new fields required by goal Section 7: domains, expectedFailureClasses,
// dbChecks, requiredEvidence. Older fields stay populated so the existing
// runner code keeps working without rewrite — see canary-render-engineering.ts
// for the live-check execution path.

import type { CanaryScenario } from './canary-scenario-types';

export type DbCheckSpec = {
  name: string;
  table: string;
  expects: string;
};

export type ExtendedCanaryScenario = CanaryScenario & {
  domains: string[];
  dbChecks: DbCheckSpec[];
  requiredEvidence: string[];
  expectedFailureClasses: string[];
};

// ─────────────────────────────────────────────────────────────────────
// 1. Ecommerce store
// ─────────────────────────────────────────────────────────────────────

const ecommerceStore: ExtendedCanaryScenario = {
  id: 'ecommerce-store',
  title: 'Ecommerce storefront with cart and checkout',
  originalIdea: 'An online store where customers browse products, add to cart, check out (Stripe or payment-ready), and view order history.',
  domains: ['ecommerce_store'],
  capabilities: ['auth', 'crud', 'payments_stripe', 'cart_orders_checkout', 'coupons_tax_shipping', 'payment_lifecycle', 'stripe_webhooks', 'admin_workflow', 'dashboard', 'deployment_render'],
  requiredRoutes: [
    'app/api/health/route.ts',
    'app/admin/products/page.tsx',
    'app/api/canary-products/route.ts',
    'app/api/canary-cart-items/route.ts',
    'app/api/canary-orders/route.ts',
    'app/api/canary-orders/[id]/route.ts',
    'app/api/canary-orders/[id]/status/route.ts',
  ],
  requiredTables: ['canary_products', 'canary_orders', 'canary_order_items'],
  surfaceRequirements: [
    'Homepage / is a storefront with product grid + add-to-cart, NOT a SaaS dashboard or admin login.',
    '/admin/products is an inventory management screen reachable from the app chrome/admin nav. It lists products and exposes an obvious Add Product form/action for name, SKU, price, and stock.',
    'Cart drawer/page shows line items + subtotal. Checkout produces an order row even when Stripe creds are missing (payment-ready order with status=pending_payment).',
    'Order confirmation page shows the persisted order id.',
  ],
  verificationRequirements: [
    'verify_user_journey covers product browse, add-to-cart, checkout (creates order), and order-status fetch.',
    'verify_user_journey covers admin product creation through the UI, then proves the newly created product appears in both the admin inventory and the public storefront.',
    'verify_db_state proves products + orders + order_items rows landed atomically.',
  ],
  liveChecks: [
    { name: 'GET /', path: '/' },
    { name: 'GET /admin/products', path: '/admin/products' },
    { name: 'GET /api/health', path: '/api/health' },
    { name: 'POST /api/canary-products', path: '/api/canary-products', method: 'POST', required: true, body: () => ({ name: `Canary Gate Product ${Date.now()}`, price_cents: 2500, sku: `CGP-${Date.now()}`, stock: 10 }), capture: { key: 'productId', from: ['product.id', 'id'] } },
    { name: 'GET /api/canary-products', path: '/api/canary-products' },
    { name: 'POST /api/canary-cart-items', path: '/api/canary-cart-items', method: 'POST', body: (state) => ({ product_id: state.productId, qty: 2 }), capture: { key: 'cartItemId', from: ['cart_item.id', 'item.id', 'id'] } },
    { name: 'POST /api/canary-orders', path: '/api/canary-orders', method: 'POST', body: (state) => ({ product_id: state.productId, qty: 2, customer_email: 'buyer@example.com' }), capture: { key: 'orderId', from: ['order.id', 'id'] } },
    { name: 'GET /api/canary-orders/:id', path: (state) => `/api/canary-orders/${encodeURIComponent(String(state.orderId ?? 'missing'))}` },
  ],
  browserUiChecks: [{
    name: 'storefront browser surface',
    requiredTextPatterns: ['shop|store|product', 'cart|basket', 'checkout|order', 'price|\\$|₹|€'],
    requiredButtonPatterns: ['add to cart|buy|purchase', 'checkout|place order|pay'],
    requireNoConsoleErrors: true,
    journeys: [{
      name: 'admin inventory creates a storefront product',
      startPath: '/admin/products',
      preSubmitActions: [{
        name: 'open add product form',
        type: 'click',
        labelPattern: 'add product',
        expectTextPatterns: ['Product Name|Name', 'SKU', 'Price', 'Stock', 'Save Product|Create Product|Add Product'],
        rejectTextPatterns: ['404|not found|coming soon|placeholder|mock only'],
      }],
      formFields: {
        name: 'Canary Admin Product <timestamp>',
        sku: 'ADMIN-<timestamp>',
        price: '32.00',
        stock: '7',
      },
      submitPattern: 'add product|create product|save product',
      expectTextPatterns: ['Canary Admin Product', 'product|inventory|stock'],
      rejectTextPatterns: ['404|not found|coming soon|placeholder|mock only'],
      postSubmitActions: [{
        name: 'created admin product appears on storefront',
        type: 'goto',
        path: '/',
        expectTextPatterns: ['Canary Admin Product', 'add to cart|buy|purchase'],
        rejectTextPatterns: ['404|not found|coming soon|placeholder|mock only'],
      }],
    }],
  }],
  dbChecks: [
    { name: 'product persisted', table: 'canary_products', expects: 'rows include the runner-created product and the admin-created product' },
    { name: 'order persisted', table: 'canary_orders', expects: 'one row with status in (pending|paid|pending_payment)' },
    { name: 'order_items persisted', table: 'canary_order_items', expects: 'at least one row referencing the order' },
  ],
  requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=ecommerce_store', 'FRONTEND_PLAN_EVIDENCE ui_type', 'ARCHITECTURE_PLAN_EVIDENCE capabilities', 'CAPABILITY_MATCH_EVIDENCE', 'verify_browser_ui pass'],
  expectedFailureClasses: ['domain matching gap', 'frontend pattern gap', 'API contract mismatch', 'verification false negative'],
};

// ─────────────────────────────────────────────────────────────────────
// 2. Business website + CRM
// ─────────────────────────────────────────────────────────────────────

const businessWebsiteCrm: ExtendedCanaryScenario = {
  id: 'business-website-crm',
  title: 'Business marketing website with internal CRM',
  originalIdea: 'A public services site with a lead-capture form, and an internal CRM where admins manage leads through stages.',
  domains: ['business_website_crm'],
  capabilities: ['auth', 'crud', 'roles', 'admin_workflow', 'email_notifications', 'seo_public_pages', 'audit_logs', 'deployment_render'],
  requiredRoutes: [
    'app/api/health/route.ts',
    'app/api/canary-leads/route.ts',
    'app/api/canary-admin/leads/route.ts',
    'app/api/canary-admin/leads/[id]/route.ts',
    'app/api/canary-admin/leads/[id]/notes/route.ts',
  ],
  requiredTables: ['canary_leads', 'canary_lead_notes'],
  surfaceRequirements: [
    'Homepage / is a public marketing page with hero + services + lead-capture CTA. NOT an admin login.',
    '/admin/leads shows the captured leads with stage filter and row-click detail.',
    'Lead form persists row even when email service is unconfigured (notification-ready record).',
  ],
  verificationRequirements: [
    'verify_user_journey covers public homepage render, lead form submit, and admin lead detail with a note added.',
    'verify_db_state proves the lead + note rows landed.',
  ],
  liveChecks: [
    { name: 'GET /', path: '/' },
    { name: 'GET /api/health', path: '/api/health' },
    { name: 'POST /api/canary-leads', path: '/api/canary-leads', method: 'POST', body: { name: 'Riley Customer', email: 'riley@example.com', phone: '+1-555-0100', message: 'Interested in your consulting services', source: 'home page' }, capture: { key: 'leadId', from: ['lead.id', 'id'] } },
    { name: 'GET /api/canary-admin/leads', path: '/api/canary-admin/leads' },
    { name: 'POST /api/canary-admin/leads/:id/notes', path: (state) => `/api/canary-admin/leads/${encodeURIComponent(String(state.leadId ?? 'missing'))}/notes`, method: 'POST', body: { note: 'Called, left voicemail' } },
  ],
  browserUiChecks: [{
    name: 'business site + CRM surface',
    requiredTextPatterns: ['service|consulting|business', 'contact|get in touch|talk to', 'lead|customer|crm|pipeline', 'admin|dashboard'],
    requiredButtonPatterns: ['contact|get started|submit', 'add note|approve|move'],
    requireNoConsoleErrors: true,
  }],
  dbChecks: [
    { name: 'lead captured', table: 'canary_leads', expects: 'one row with email=riley@example.com' },
    { name: 'lead note added', table: 'canary_lead_notes', expects: 'at least one row referencing the lead' },
  ],
  requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=business_website_crm', 'FRONTEND_PLAN_EVIDENCE ui_type', 'verify_browser_ui pass'],
  expectedFailureClasses: ['frontend pattern gap', 'API contract mismatch', 'verification false negative'],
};

// ─────────────────────────────────────────────────────────────────────
// 3. Local service booking
// ─────────────────────────────────────────────────────────────────────

const localServiceBooking: ExtendedCanaryScenario = {
  id: 'local-service-booking',
  title: 'Local service booking app',
  originalIdea: 'A salon-style booking app: customers see services, available time slots, and book — double-book rejected.',
  domains: ['local_service_booking'],
  capabilities: ['auth', 'crud', 'booking', 'email_notifications', 'admin_workflow', 'dashboard', 'deployment_render'],
  requiredRoutes: ['app/api/health/route.ts', 'app/api/canary-services/route.ts', 'app/api/canary-availability/route.ts', 'app/api/canary-bookings/route.ts'],
  requiredTables: ['canary_services', 'canary_availability_slots', 'canary_bookings'],
  surfaceRequirements: [
    '/ or /services lists services with duration/price; /book is a slot picker (NOT a raw datetime input).',
    'Double-book on the same slot is rejected at the API layer.',
    '/admin/calendar shows current bookings.',
  ],
  verificationRequirements: [
    'verify_user_journey covers slot creation, customer booking, and rejection of second booking for the same slot.',
    'verify_db_state proves exactly one booking exists for the slot after the dup attempt.',
  ],
  liveChecks: [
    { name: 'GET /', path: '/' },
    { name: 'GET /api/health', path: '/api/health' },
    { name: 'POST /api/auth/sign-up/email', path: '/api/auth/sign-up/email', method: 'POST', required: true, body: () => ({ name: 'Canary Auth User', email: `canary-auth-${Date.now()}@example.com`, password: 'Password123!' }) },
    { name: 'POST /api/canary-services', path: '/api/canary-services', method: 'POST', body: { name: 'Haircut', duration_min: 30, price_cents: 4500 }, capture: { key: 'serviceId', from: ['service.id', 'id'] } },
    { name: 'POST /api/canary-availability', path: '/api/canary-availability', method: 'POST', body: (state) => ({ service_id: state.serviceId, starts_at: '2030-03-10T10:00:00.000Z', ends_at: '2030-03-10T10:30:00.000Z', timezone: 'UTC' }), capture: { key: 'slotId', from: ['slot.id', 'availability.id', 'id'] } },
    { name: 'POST /api/canary-bookings (first)', path: '/api/canary-bookings', method: 'POST', body: (state) => ({ slot_id: state.slotId, customer_email: 'customer1@example.com' }), capture: { key: 'bookingId', from: ['booking.id', 'id'] } },
    { name: 'POST /api/canary-bookings (dup rejected)', path: '/api/canary-bookings', method: 'POST', expectOk: false, body: (state) => ({ slot_id: state.slotId, customer_email: 'customer2@example.com' }) },
    { name: 'POST /api/canary-availability (browser slot)', path: '/api/canary-availability', method: 'POST', body: (state) => ({ service_id: state.serviceId, starts_at: '2030-03-10T11:00:00.000Z', ends_at: '2030-03-10T11:30:00.000Z', timezone: 'UTC' }), capture: { key: 'browserSlotId', from: ['slot.id', 'availability.id', 'id'] } },
    { name: 'GET /api/canary-bookings', path: '/api/canary-bookings' },
  ],
  browserUiChecks: [{
    name: 'booking flow surface',
    requiredTextPatterns: ['service|appointment', 'date|calendar|slot', 'book|reserve|confirm'],
    requiredButtonPatterns: ['book|reserve|confirm|schedule', 'select|pick'],
    requireNoConsoleErrors: true,
    journeys: [{
      name: 'customer books a real visible slot from /book',
      startPath: '/book',
      preSubmitActions: [
        {
          type: 'click',
          labelPattern: 'haircut|service|select',
          expectTextPatterns: ['slot|time|date|available'],
          rejectTextPatterns: ['no services available|check back soon|sign in|required login'],
        },
        {
          type: 'click',
          labelPattern: '10:00|11:00|AM|PM|slot|available|select time|choose time',
          expectTextPatterns: ['email|customer|confirm|book|reserve'],
          rejectTextPatterns: ['no slots|no availability|sign in|required login'],
        },
      ],
      formFields: {
        email: 'customer+<timestamp>@example.com',
      },
      submitPattern: 'book|reserve|confirm|schedule',
      expectTextPatterns: ['confirmed|booked|appointment|success'],
      rejectTextPatterns: ['no services available|check back soon|no slots|no availability|failed|error|sign in|required login'],
    }, {
      name: 'public sign-up creates an authenticated account',
      startPath: '/sign-up',
      formFields: {
        name: 'Canary Auth <timestamp>',
        email: 'canary-auth-<timestamp>@example.com',
        password: 'Password123!',
      },
      submitPattern: 'create account|sign up',
      expectTextPatterns: ['dashboard|settings|subscription|sign out'],
      rejectTextPatterns: ['creating account|sign-up failed|sign up failed|failed|error|invalid|welcome back|sign in'],
      postSubmitActions: [{
        type: 'goto',
        path: '/app',
        expectTextPatterns: ['dashboard|settings|subscription|sign out'],
        rejectTextPatterns: ['welcome back|sign in|no account|sign-up failed|failed|error|invalid'],
      }],
    }],
  }],
  dbChecks: [
    { name: 'service exists', table: 'canary_services', expects: 'one row' },
    { name: 'one booking per slot', table: 'canary_bookings', expects: 'exactly one row for the contested slot' },
  ],
  requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=local_service_booking', 'FRONTEND_PLAN_EVIDENCE pattern_ids contains booking_calendar', 'verify_browser_ui pass'],
  expectedFailureClasses: ['frontend pattern gap', 'API contract mismatch', 'generated app bug'],
};

// ─────────────────────────────────────────────────────────────────────
// 4. Inventory operations
// ─────────────────────────────────────────────────────────────────────

const inventoryOperations: ExtendedCanaryScenario = {
  id: 'inventory-operations',
  title: 'Inventory + warehouse operations',
  originalIdea: 'Warehouse system: items, locations, stock movements, low-stock alerts, CSV export.',
  domains: ['inventory_operations'],
  capabilities: ['auth', 'roles', 'crud', 'admin_workflow', 'import_export_csv', 'audit_logs', 'dashboard', 'deployment_render'],
  requiredRoutes: [
    'app/api/health/route.ts',
    'app/api/canary-items/route.ts',
    'app/api/canary-movements/route.ts',
    'app/api/canary-stock-levels/route.ts',
    'app/api/canary-export/csv/route.ts',
  ],
  requiredTables: ['canary_items', 'canary_stock_movements', 'canary_audit_logs'],
  surfaceRequirements: [
    'Homepage / shows items table with search/filter — operational, not marketing.',
    'Movement form validates that result stock is non-negative.',
    'CSV export endpoint returns text/csv with header row.',
  ],
  verificationRequirements: [
    'verify_user_journey covers item create, stock movement, low-stock check, and CSV export.',
    'verify_db_state proves item + movement + audit rows.',
  ],
  liveChecks: [
    { name: 'GET /', path: '/' },
    { name: 'GET /api/health', path: '/api/health' },
    { name: 'POST /api/canary-items', path: '/api/canary-items', method: 'POST', body: { sku: 'WIDGET-001', name: 'Widget', initial_stock: 5, low_stock_threshold: 3 }, capture: { key: 'itemId', from: ['item.id', 'id'] } },
    { name: 'POST /api/canary-movements', path: '/api/canary-movements', method: 'POST', body: (state) => ({ item_id: state.itemId, delta: -2, reason: 'sale' }) },
    { name: 'GET /api/canary-stock-levels', path: '/api/canary-stock-levels' },
    { name: 'GET /api/canary-export/csv', path: '/api/canary-export/csv' },
  ],
  browserUiChecks: [{
    name: 'inventory operations surface',
    requiredTextPatterns: ['item|sku|inventory|stock', 'movement|in|out', 'low.*stock|threshold'],
    requiredButtonPatterns: ['add item|new|create', 'adjust|movement|stock', 'export|csv'],
    requireNoConsoleErrors: true,
  }],
  dbChecks: [
    { name: 'item exists', table: 'canary_items', expects: 'one row' },
    { name: 'movement audit', table: 'canary_stock_movements', expects: 'at least one movement row' },
  ],
  requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=inventory_operations', 'FRONTEND_PLAN_EVIDENCE pattern_ids contains inventory_table', 'verify_browser_ui pass'],
  expectedFailureClasses: ['frontend pattern gap', 'API contract mismatch'],
};

// ─────────────────────────────────────────────────────────────────────
// 5. Construction operations
// ─────────────────────────────────────────────────────────────────────

const constructionOperations: ExtendedCanaryScenario = {
  id: 'construction-operations',
  title: 'Construction project operations',
  originalIdea: 'Project tracker for a contractor: projects, bids, schedule, safety logs, equipment, plus a dashboard.',
  domains: ['construction_operations'],
  capabilities: ['auth', 'roles', 'crud', 'admin_workflow', 'audit_logs', 'dashboard', 'deployment_render'],
  requiredRoutes: [
    'app/api/health/route.ts',
    'app/api/canary-projects/route.ts',
    'app/api/canary-projects/[id]/bids/route.ts',
    'app/api/canary-projects/[id]/schedule/route.ts',
    'app/api/canary-projects/[id]/safety-logs/route.ts',
    'app/api/canary-equipment/route.ts',
  ],
  requiredTables: ['canary_projects', 'canary_bids', 'canary_schedule_entries', 'canary_safety_logs', 'canary_equipment'],
  surfaceRequirements: [
    '/app is an authenticated construction operations dashboard, not only a public landing page.',
    '/projects or the authenticated /app project area lists projects with status and preserves project dates/details after create.',
    '/projects/[id] or an equivalent authenticated project detail area has working sections/forms for overview, schedule, bids, safety, and equipment.',
    'Equipment can be assigned to one project at a time.',
  ],
  verificationRequirements: [
    'verify_user_journey covers account creation, authenticated dashboard access, project create with non-name fields, bid record, schedule entry, safety log entry, equipment record, and sign-out.',
    'verify_browser_ui proves the same construction workflow through rendered UI controls; landing-page CTA links to signup are not enough.',
    'verify_db_state proves rows in all 5 tables and the project row includes date/detail fields, not only a name.',
  ],
  liveChecks: [
    { name: 'GET /', path: '/' },
    { name: 'GET /api/health', path: '/api/health' },
    { name: 'POST /api/auth/sign-up/email', path: '/api/auth/sign-up/email', method: 'POST', required: true, body: () => ({ name: 'Canary Construction User', email: `canary-construction-${Date.now()}@example.com`, password: 'Password123!' }) },
    { name: 'POST /api/canary-projects', path: '/api/canary-projects', method: 'POST', body: { name: 'Main St Renovation', start_date: '2030-04-01', end_date: '2030-06-30' }, capture: { key: 'projectId', from: ['project.id', 'id'] } },
    { name: 'POST /api/canary-projects/:id/bids', path: (state) => `/api/canary-projects/${encodeURIComponent(String(state.projectId ?? 'missing'))}/bids`, method: 'POST', body: { contractor: 'Acme Co', amount_cents: 4500000, status: 'submitted' } },
    { name: 'POST /api/canary-projects/:id/schedule', path: (state) => `/api/canary-projects/${encodeURIComponent(String(state.projectId ?? 'missing'))}/schedule`, method: 'POST', body: { task: 'Demolition', start_date: '2030-04-02', end_date: '2030-04-10' } },
    { name: 'POST /api/canary-projects/:id/safety-logs', path: (state) => `/api/canary-projects/${encodeURIComponent(String(state.projectId ?? 'missing'))}/safety-logs`, method: 'POST', body: { category: 'incident', severity: 'low', description: 'Slip on wet floor, no injury' } },
    { name: 'POST /api/canary-equipment', path: '/api/canary-equipment', method: 'POST', body: (state) => ({ name: 'Excavator', project_id: state.projectId }) },
  ],
  browserUiChecks: [{
    name: 'construction ops surface',
    requiredTextPatterns: ['project|jobsite|construction', 'bid|estimate', 'schedule|task', 'safety|incident', 'equipment'],
    requiredButtonPatterns: ['new project|create project|add project', 'add bid|new bid|submit bid', 'add log|safety', 'add equipment|track equipment'],
    requireNoConsoleErrors: true,
    journeys: [{
      name: 'public sign-up reaches authenticated construction dashboard',
      startPath: '/sign-up',
      formFields: {
        name: 'Canary Construction <timestamp>',
        email: 'canary-construction-<timestamp>@example.com',
        password: 'Password123!',
      },
      submitPattern: 'create account|sign up',
      expectTextPatterns: ['dashboard|project|jobsite|construction', 'sign out|log out'],
      rejectTextPatterns: ['creating account|sign-up failed|sign up failed|failed|error|invalid|welcome back|sign in'],
      postSubmitActions: [{
        name: 'authenticated app shows construction controls',
        type: 'goto',
        path: '/app',
        expectTextPatterns: ['project|jobsite|construction', 'bid|estimate', 'schedule|task', 'safety|incident', 'equipment', 'sign out|log out'],
        rejectTextPatterns: ['welcome back|sign in|404|not found|starter|template|failed|error'],
      }],
    }, {
      name: 'project create preserves dates and details',
      startPath: '/app',
      preSubmitActions: [{
        name: 'open project creation form',
        type: 'click',
        labelPattern: 'new project|add project|create project',
        expectTextPatterns: ['Project Name|Name', 'Start Date|Start', 'End Date|End'],
        rejectTextPatterns: ['404|not found|coming soon|placeholder|mock only|sign in'],
      }],
      formFields: {
        name: 'Canary Jobsite <timestamp>',
        start_date: '2030-04-01',
        end_date: '2030-06-30',
        description: 'Hospital wing renovation safety-critical project',
      },
      submitPattern: 'create project|save project|add project',
      expectTextPatterns: ['Canary Jobsite', '2030-04-01|Apr 1|04/01|start', '2030-06-30|Jun 30|06/30|end'],
      rejectTextPatterns: ['failed|error|invalid|name only|no date|not found|sign in'],
    }, {
      name: 'bid create appears in the authenticated product UI',
      startPath: '/app',
      preSubmitActions: [{
        name: 'open bid creation form',
        type: 'click',
        labelPattern: 'add bid|new bid|submit bid',
        expectTextPatterns: ['Contractor|Vendor|Bidder', 'Amount|Estimate', 'Status'],
        rejectTextPatterns: ['404|not found|coming soon|placeholder|mock only|sign in'],
      }],
      formFields: {
        contractor: 'Acme Concrete <timestamp>',
        amount: '45000',
        status: 'submitted',
      },
      submitPattern: 'add bid|save bid|submit bid',
      expectTextPatterns: ['Acme Concrete', '45,000|45000|submitted'],
      rejectTextPatterns: ['failed|error|invalid|not found|sign in'],
    }, {
      name: 'schedule entry appears in the authenticated product UI',
      startPath: '/app',
      preSubmitActions: [{
        name: 'open schedule task form',
        type: 'click',
        labelPattern: 'add task|new task|schedule',
        expectTextPatterns: ['Task|Schedule', 'Start Date|Start', 'End Date|End'],
        rejectTextPatterns: ['404|not found|coming soon|placeholder|mock only|sign in'],
      }],
      formFields: {
        task: 'Demo inspection <timestamp>',
        start_date: '2030-04-02',
        end_date: '2030-04-10',
      },
      submitPattern: 'add task|save task|schedule',
      expectTextPatterns: ['Demo inspection', '2030-04-02|Apr 2|04/02', '2030-04-10|Apr 10|04/10'],
      rejectTextPatterns: ['failed|error|invalid|not found|sign in'],
    }, {
      name: 'safety log appears in the authenticated product UI',
      startPath: '/app',
      preSubmitActions: [{
        name: 'open safety log form',
        type: 'click',
        labelPattern: 'add safety log|new safety|safety log|add log',
        expectTextPatterns: ['Category|Incident', 'Severity', 'Description|Notes'],
        rejectTextPatterns: ['404|not found|coming soon|placeholder|mock only|sign in'],
      }],
      formFields: {
        category: 'incident',
        severity: 'low',
        description: 'Wet floor near south stairwell <timestamp>',
      },
      submitPattern: 'add safety log|save log|submit log',
      expectTextPatterns: ['Wet floor near south stairwell', 'incident', 'low'],
      rejectTextPatterns: ['failed|error|invalid|not found|sign in'],
    }, {
      name: 'equipment assignment appears in the authenticated product UI',
      startPath: '/app',
      preSubmitActions: [{
        name: 'open equipment form',
        type: 'click',
        labelPattern: 'add equipment|track equipment|new equipment',
        expectTextPatterns: ['Equipment Name|Name', 'Status|Project|Assigned'],
        rejectTextPatterns: ['404|not found|coming soon|placeholder|mock only|sign in'],
      }],
      formFields: {
        name: 'Excavator <timestamp>',
        status: 'deployed',
        notes: 'Assigned to Canary Jobsite',
      },
      submitPattern: 'add equipment|save equipment|track equipment',
      expectTextPatterns: ['Excavator', 'deployed|on site|assigned'],
      rejectTextPatterns: ['failed|error|invalid|not found|sign in'],
    }, {
      name: 'sign-out clears the authenticated app session',
      startPath: '/app',
      formFields: {},
      submitPattern: 'sign out|log out',
      expectTextPatterns: ['welcome back|sign in'],
      rejectTextPatterns: ['dashboard|sign out|project list|failed|error'],
      postSubmitActions: [{
        name: 'signed-out /app redirects back to auth',
        type: 'goto',
        path: '/app',
        expectTextPatterns: ['welcome back|sign in'],
        rejectTextPatterns: ['dashboard|sign out|project list|equipment|failed|error'],
      }],
    }],
  }],
  dbChecks: [
    { name: 'project exists', table: 'canary_projects', expects: 'one row with name plus start_date/end_date/details' },
    { name: 'bid recorded', table: 'canary_bids', expects: 'at least one row' },
    { name: 'schedule recorded', table: 'canary_schedule_entries', expects: 'at least one row' },
    { name: 'safety log recorded', table: 'canary_safety_logs', expects: 'at least one row' },
    { name: 'equipment recorded', table: 'canary_equipment', expects: 'at least one row' },
  ],
  requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=construction_operations', 'FRONTEND_PLAN_EVIDENCE pattern_ids contains construction_ops_board', 'verify_browser_ui pass'],
  expectedFailureClasses: ['frontend pattern gap', 'API contract mismatch', 'auth session bug', 'generated app bug'],
};

// ─────────────────────────────────────────────────────────────────────
// 6. Finance / crypto dashboard
// ─────────────────────────────────────────────────────────────────────

const financeCryptoDashboard: ExtendedCanaryScenario = {
  id: 'finance-crypto-dashboard',
  title: 'Finance / crypto portfolio dashboard',
  originalIdea: 'Portfolio tracking with price alerts, transaction history, and safe fallback when external market API is down.',
  domains: ['finance_crypto'],
  capabilities: ['auth', 'crud', 'dashboard', 'external_api', 'cron_jobs', 'analytics', 'security_ops', 'deployment_render'],
  requiredRoutes: [
    'app/api/health/route.ts',
    'app/api/canary-portfolios/route.ts',
    'app/api/canary-alerts/route.ts',
    'app/api/canary-transactions/route.ts',
    'app/api/canary-instruments/[symbol]/price/route.ts',
  ],
  requiredTables: ['canary_portfolios', 'canary_holdings', 'canary_alerts', 'canary_transactions', 'canary_price_snapshots'],
  surfaceRequirements: [
    'Dashboard shows portfolio summary, holdings, price chart placeholder, and stale-data indicator if market API is unavailable.',
    'NO invented numbers when there is no data — empty state with CTA.',
  ],
  verificationRequirements: [
    'verify_user_journey covers portfolio create, alert create, transaction record, and price fetch (with explicit stale-state when external API absent).',
    'verify_db_state proves portfolio + alert + transaction rows.',
  ],
  liveChecks: [
    { name: 'GET /', path: '/' },
    { name: 'GET /api/health', path: '/api/health' },
    { name: 'POST /api/canary-portfolios', path: '/api/canary-portfolios', method: 'POST', body: { name: 'Main Portfolio' }, capture: { key: 'portfolioId', from: ['portfolio.id', 'id'] } },
    { name: 'POST /api/canary-alerts', path: '/api/canary-alerts', method: 'POST', body: (state) => ({ portfolio_id: state.portfolioId, symbol: 'BTC', condition: 'above', threshold: 100000 }) },
    { name: 'POST /api/canary-transactions', path: '/api/canary-transactions', method: 'POST', body: (state) => ({ portfolio_id: state.portfolioId, symbol: 'BTC', kind: 'buy', qty: 0.5, price_cents: 5000000 }) },
    { name: 'GET /api/canary-instruments/BTC/price', path: '/api/canary-instruments/BTC/price' },
  ],
  browserUiChecks: [{
    name: 'finance dashboard surface',
    requiredTextPatterns: ['portfolio|wallet|holdings', 'alert|watchlist', 'transaction|history', 'price|usd|\\$'],
    requiredButtonPatterns: ['add holding|create|new portfolio', 'create alert|new alert', 'record|add transaction'],
    requireNoConsoleErrors: true,
  }],
  dbChecks: [
    { name: 'portfolio exists', table: 'canary_portfolios', expects: 'one row' },
    { name: 'alert recorded', table: 'canary_alerts', expects: 'at least one row' },
    { name: 'transaction recorded', table: 'canary_transactions', expects: 'at least one row' },
  ],
  requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=finance_crypto', 'FRONTEND_PLAN_EVIDENCE pattern_ids contains finance_dashboard'],
  expectedFailureClasses: ['external service blocker', 'frontend pattern gap'],
};

// ─────────────────────────────────────────────────────────────────────
// 7. Social / community
// ─────────────────────────────────────────────────────────────────────

const socialCommunity: ExtendedCanaryScenario = {
  id: 'social-community',
  title: 'Social community / forum',
  originalIdea: 'Community platform: profiles, posts, comments, reactions, moderation queue, notifications.',
  domains: ['social_community'],
  capabilities: ['auth', 'roles', 'crud', 'admin_workflow', 'search', 'realtime', 'notification_preferences', 'deployment_render'],
  requiredRoutes: [
    'app/api/health/route.ts',
    'app/api/canary-posts/route.ts',
    'app/api/canary-posts/[id]/comments/route.ts',
    'app/api/canary-posts/[id]/reactions/route.ts',
    'app/api/canary-reports/route.ts',
    'app/api/canary-mod-actions/route.ts',
  ],
  requiredTables: ['canary_profiles', 'canary_posts', 'canary_comments', 'canary_reactions', 'canary_reports'],
  surfaceRequirements: [
    '/feed shows post cards (author + body + reactions + comment count). NOT an admin dashboard as homepage.',
    'Reactions idempotent (one per (user, post)).',
    'Mod queue shows reports with action buttons.',
  ],
  verificationRequirements: [
    'verify_user_journey covers post create, comment, reaction (idempotent), report, mod action.',
    'verify_db_state proves post + comment + reaction rows and ONE reaction per (user, post).',
  ],
  liveChecks: [
    { name: 'GET /', path: '/' },
    { name: 'GET /api/health', path: '/api/health' },
    { name: 'POST /api/canary-posts', path: '/api/canary-posts', method: 'POST', body: { author_email: 'alice@example.com', body: 'Hello, this is a canary post' }, capture: { key: 'postId', from: ['post.id', 'id'] } },
    { name: 'POST /api/canary-posts/:id/comments', path: (state) => `/api/canary-posts/${encodeURIComponent(String(state.postId ?? 'missing'))}/comments`, method: 'POST', body: { author_email: 'bob@example.com', body: 'Nice post' } },
    { name: 'POST /api/canary-posts/:id/reactions', path: (state) => `/api/canary-posts/${encodeURIComponent(String(state.postId ?? 'missing'))}/reactions`, method: 'POST', body: { user_email: 'bob@example.com', kind: 'like' } },
    { name: 'POST /api/canary-reports', path: '/api/canary-reports', method: 'POST', body: (state) => ({ post_id: state.postId, reporter_email: 'carol@example.com', reason: 'spam' }) },
  ],
  browserUiChecks: [{
    name: 'social feed surface',
    requiredTextPatterns: ['feed|community|forum|posts?', 'comment|reply', 'reaction|like|upvote'],
    requiredButtonPatterns: ['post|reply|comment', 'react|like'],
    requireNoConsoleErrors: true,
  }],
  dbChecks: [
    { name: 'post exists', table: 'canary_posts', expects: 'one row' },
    { name: 'comment exists', table: 'canary_comments', expects: 'at least one row' },
    { name: 'reactions unique', table: 'canary_reactions', expects: 'at most one row per (user_email, post_id)' },
  ],
  requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=social_community', 'FRONTEND_PLAN_EVIDENCE pattern_ids contains social_feed'],
  expectedFailureClasses: ['frontend pattern gap', 'API contract mismatch', 'generated app bug'],
};

// ─────────────────────────────────────────────────────────────────────
// 8. Education / content platform
// ─────────────────────────────────────────────────────────────────────

const educationContentPlatform: ExtendedCanaryScenario = {
  id: 'education-content-platform',
  title: 'Education / LMS / content platform',
  originalIdea: 'LMS: instructors create courses with lessons, students enroll and track progress.',
  domains: ['education_content'],
  capabilities: ['auth', 'roles', 'crud', 'rich_text_cms', 'admin_workflow', 'dashboard', 'deployment_render'],
  requiredRoutes: [
    'app/api/health/route.ts',
    'app/api/canary-courses/route.ts',
    'app/api/canary-courses/[id]/lessons/route.ts',
    'app/api/canary-enrollments/route.ts',
    'app/api/canary-progress/route.ts',
    'app/api/canary-admin/courses/[id]/publish/route.ts',
  ],
  requiredTables: ['canary_courses', 'canary_lessons', 'canary_enrollments', 'canary_progress'],
  surfaceRequirements: [
    '/courses lists published courses (drafts hidden).',
    'Course detail has module/lesson outline. Lesson view has mark-complete.',
    'Lesson body stored as Markdown or structured JSON (NOT raw HTML).',
  ],
  verificationRequirements: [
    'verify_user_journey covers course create (draft), lesson create, publish, enrollment, lesson mark-complete.',
    'verify_db_state proves course + lesson + progress rows.',
  ],
  liveChecks: [
    { name: 'GET /', path: '/' },
    { name: 'GET /api/health', path: '/api/health' },
    { name: 'POST /api/canary-courses', path: '/api/canary-courses', method: 'POST', body: { title: 'Intro to Canaries', instructor_email: 'teacher@example.com' }, capture: { key: 'courseId', from: ['course.id', 'id'] } },
    { name: 'POST /api/canary-courses/:id/lessons', path: (state) => `/api/canary-courses/${encodeURIComponent(String(state.courseId ?? 'missing'))}/lessons`, method: 'POST', body: { title: 'Lesson 1', body_markdown: '# Hello\n\nFirst lesson.' }, capture: { key: 'lessonId', from: ['lesson.id', 'id'] } },
    { name: 'POST /api/canary-admin/courses/:id/publish', path: (state) => `/api/canary-admin/courses/${encodeURIComponent(String(state.courseId ?? 'missing'))}/publish`, method: 'POST', body: {} },
    { name: 'POST /api/canary-enrollments', path: '/api/canary-enrollments', method: 'POST', body: (state) => ({ student_email: 'student@example.com', course_id: state.courseId }) },
    { name: 'POST /api/canary-progress', path: '/api/canary-progress', method: 'POST', body: (state) => ({ student_email: 'student@example.com', lesson_id: state.lessonId }) },
  ],
  browserUiChecks: [{
    name: 'LMS surface',
    requiredTextPatterns: ['course|class|curriculum', 'lesson|module', 'enroll|progress'],
    requiredButtonPatterns: ['enroll|sign up', 'mark complete|complete', 'publish|create'],
    requireNoConsoleErrors: true,
  }],
  dbChecks: [
    { name: 'course exists', table: 'canary_courses', expects: 'one row with published_at NOT NULL' },
    { name: 'lesson exists', table: 'canary_lessons', expects: 'at least one row' },
    { name: 'progress idempotent', table: 'canary_progress', expects: 'one row per (student, lesson)' },
  ],
  requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=education_content', 'FRONTEND_PLAN_EVIDENCE pattern_ids contains education_lms'],
  expectedFailureClasses: ['frontend pattern gap', 'API contract mismatch'],
};

// ─────────────────────────────────────────────────────────────────────
// 9. Health / fitness / meal planner
// ─────────────────────────────────────────────────────────────────────

const healthFitnessMealPlanner: ExtendedCanaryScenario = {
  id: 'health-fitness-meal-planner',
  title: 'Health / fitness / meal planner',
  originalIdea: 'Personal plan tracker: daily workout + meal plan, log entries, progress tracking, preferences.',
  domains: ['health_fitness_food'],
  capabilities: ['auth', 'crud', 'dashboard', 'cron_jobs', 'deployment_render'],
  requiredRoutes: ['app/api/health/route.ts', 'app/api/canary-plans/route.ts', 'app/api/canary-workout-logs/route.ts', 'app/api/canary-meal-logs/route.ts', 'app/api/canary-preferences/route.ts'],
  requiredTables: ['canary_plans', 'canary_workout_logs', 'canary_meal_logs', 'canary_preferences'],
  surfaceRequirements: [
    'Logged-in homepage shows today plan + log entry CTAs.',
    'Progress page aggregates logs.',
  ],
  verificationRequirements: [
    'verify_user_journey covers plan create, workout log, meal log, preferences update.',
    'verify_db_state proves plan + logs + preferences rows.',
  ],
  liveChecks: [
    { name: 'GET /', path: '/' },
    { name: 'GET /api/health', path: '/api/health' },
    { name: 'POST /api/canary-plans', path: '/api/canary-plans', method: 'POST', body: { user_email: 'user@example.com', goal: 'lose 5kg' }, capture: { key: 'planId', from: ['plan.id', 'id'] } },
    { name: 'POST /api/canary-workout-logs', path: '/api/canary-workout-logs', method: 'POST', body: (state) => ({ plan_id: state.planId, exercise: 'pushups', sets: 3, reps: 10 }) },
    { name: 'POST /api/canary-meal-logs', path: '/api/canary-meal-logs', method: 'POST', body: (state) => ({ plan_id: state.planId, meal: 'breakfast', items: 'oatmeal', calories: 320 }) },
    { name: 'PATCH /api/canary-preferences', path: '/api/canary-preferences', method: 'PATCH', body: { user_email: 'user@example.com', units: 'metric', diet: 'vegetarian' } },
  ],
  browserUiChecks: [{
    name: 'health/fitness surface',
    requiredTextPatterns: ['plan|today|workout|meal', 'progress|streak|log', 'goal|target'],
    requiredButtonPatterns: ['log workout|log meal|add', 'mark complete|done'],
    requireNoConsoleErrors: true,
  }],
  dbChecks: [
    { name: 'plan exists', table: 'canary_plans', expects: 'one row' },
    { name: 'logs exist', table: 'canary_workout_logs', expects: 'at least one row' },
  ],
  requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=health_fitness_food', 'FRONTEND_PLAN_EVIDENCE pattern_ids contains health_plan_tracker'],
  expectedFailureClasses: ['frontend pattern gap'],
};

// ─────────────────────────────────────────────────────────────────────
// 10. Media / creator platform
// ─────────────────────────────────────────────────────────────────────

const mediaCreatorPlatform: ExtendedCanaryScenario = {
  id: 'media-creator-platform',
  title: 'Media / creator platform with gated content',
  originalIdea: 'Creator portfolio with public gallery and gated premium content with subscriptions.',
  domains: ['media_creator'],
  capabilities: ['auth', 'roles', 'crud', 'uploads_storage', 'payments_stripe', 'file_privacy_validation', 'stripe_webhooks', 'dashboard', 'deployment_render'],
  requiredRoutes: ['app/api/health/route.ts', 'app/api/canary-media/route.ts', 'app/api/canary-creators/[handle]/route.ts', 'app/api/canary-subscriptions/route.ts', 'app/api/canary-media/[id]/access/route.ts'],
  requiredTables: ['canary_creators', 'canary_media_items', 'canary_subscriptions'],
  surfaceRequirements: [
    'Public /creator/[handle] renders gallery + subscribe CTA.',
    'Gated media access checked server-side, not via UI-hide.',
    'Upload metadata persists even when blob storage missing.',
  ],
  verificationRequirements: [
    'verify_user_journey covers media upload (metadata), gallery render, subscribe, gated access.',
    'verify_db_state proves creator + media + subscription rows.',
  ],
  liveChecks: [
    { name: 'GET /', path: '/' },
    { name: 'GET /api/health', path: '/api/health' },
    { name: 'POST /api/canary-media', path: '/api/canary-media', method: 'POST', body: { creator_handle: 'alice-art', title: 'Painting 1', visibility: 'public', mime: 'image/png', size: 102400 }, capture: { key: 'mediaId', from: ['media.id', 'id'] } },
    { name: 'GET /api/canary-creators/alice-art', path: '/api/canary-creators/alice-art' },
    { name: 'POST /api/canary-subscriptions', path: '/api/canary-subscriptions', method: 'POST', body: { fan_email: 'fan@example.com', creator_handle: 'alice-art', tier: 'basic' } },
    { name: 'GET /api/canary-media/:id/access', path: (state) => `/api/canary-media/${encodeURIComponent(String(state.mediaId ?? 'missing'))}/access` },
  ],
  browserUiChecks: [{
    name: 'creator gallery surface',
    requiredTextPatterns: ['creator|portfolio|gallery', 'subscribe|premium|unlock', 'media|art|photo|video'],
    requiredButtonPatterns: ['subscribe|unlock|join', 'upload|add|new'],
    requireNoConsoleErrors: true,
  }],
  dbChecks: [
    { name: 'media metadata persisted', table: 'canary_media_items', expects: 'one row even when storage creds missing' },
    { name: 'subscription persisted', table: 'canary_subscriptions', expects: 'one row' },
  ],
  requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=media_creator', 'FRONTEND_PLAN_EVIDENCE pattern_ids contains media_creator_gallery'],
  expectedFailureClasses: ['frontend pattern gap', 'API contract mismatch', 'external service blocker'],
};

// ─────────────────────────────────────────────────────────────────────
// 11. Real estate / property
// ─────────────────────────────────────────────────────────────────────

const realEstateProperty: ExtendedCanaryScenario = {
  id: 'real-estate-property',
  title: 'Real estate property listings',
  originalIdea: 'Property listings with filters/search, agent listings, inquiries, saved listings, admin approval.',
  domains: ['real_estate_property'],
  capabilities: ['auth', 'roles', 'crud', 'search', 'admin_workflow', 'uploads_storage', 'email_notifications', 'seo_public_pages', 'deployment_render'],
  requiredRoutes: ['app/api/health/route.ts', 'app/api/canary-listings/route.ts', 'app/api/canary-listings/[id]/route.ts', 'app/api/canary-inquiries/route.ts', 'app/api/canary-saved/route.ts', 'app/api/canary-admin/listings/[id]/approve/route.ts'],
  requiredTables: ['canary_properties', 'canary_inquiries', 'canary_saved_properties'],
  surfaceRequirements: [
    'Public /listings index with filters (city/price/beds).',
    'Approval required: pending listings not visible publicly.',
  ],
  verificationRequirements: [
    'verify_user_journey covers listing create (pending), admin approve, inquiry submit, save.',
    'verify_db_state proves listing approved + inquiry + saved rows.',
  ],
  liveChecks: [
    { name: 'GET /', path: '/' },
    { name: 'GET /api/health', path: '/api/health' },
    { name: 'POST /api/canary-listings', path: '/api/canary-listings', method: 'POST', body: { title: 'Main St 2BR', agent_email: 'agent@example.com', city: 'Bangalore', price_cents: 50000000, beds: 2, baths: 2 }, capture: { key: 'listingId', from: ['listing.id', 'id'] } },
    { name: 'POST /api/canary-admin/listings/:id/approve', path: (state) => `/api/canary-admin/listings/${encodeURIComponent(String(state.listingId ?? 'missing'))}/approve`, method: 'POST', body: {} },
    { name: 'GET /api/canary-listings', path: '/api/canary-listings' },
    { name: 'POST /api/canary-inquiries', path: '/api/canary-inquiries', method: 'POST', body: (state) => ({ listing_id: state.listingId, buyer_email: 'buyer@example.com', message: 'Tour?' }) },
    { name: 'POST /api/canary-saved', path: '/api/canary-saved', method: 'POST', body: (state) => ({ listing_id: state.listingId, user_email: 'buyer@example.com' }) },
  ],
  browserUiChecks: [{
    name: 'real estate surface',
    requiredTextPatterns: ['property|listing|home|rental', 'filter|search|city|price', 'agent|inquire|contact'],
    requiredButtonPatterns: ['inquire|contact', 'save|favorite', 'filter|search'],
    requireNoConsoleErrors: true,
  }],
  dbChecks: [
    { name: 'listing approved', table: 'canary_properties', expects: 'one row with status=approved' },
    { name: 'inquiry recorded', table: 'canary_inquiries', expects: 'at least one row' },
  ],
  requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=real_estate_property', 'FRONTEND_PLAN_EVIDENCE pattern_ids contains real_estate_listing'],
  expectedFailureClasses: ['frontend pattern gap', 'API contract mismatch'],
};

// ─────────────────────────────────────────────────────────────────────
// 12. Advanced mixed AI workflow
// ─────────────────────────────────────────────────────────────────────

const advancedMixedAiWorkflow: ExtendedCanaryScenario = {
  id: 'advanced-mixed-ai-workflow',
  title: 'Advanced mixed AI workflow',
  originalIdea: 'Document analysis pipeline: uploads → AI/RAG job → stored output → user dashboard, with background jobs and external API fallback.',
  domains: ['advanced_ai_mixed'],
  capabilities: ['auth', 'crud', 'uploads_storage', 'ai_openai', 'rag_search', 'long_running_ai_jobs', 'queue_workers', 'ai_safety_cost_controls', 'cron_jobs', 'dashboard', 'deployment_render'],
  requiredRoutes: ['app/api/health/route.ts', 'app/api/canary-uploads/route.ts', 'app/api/canary-jobs/route.ts', 'app/api/canary-jobs/[id]/route.ts', 'app/api/canary-ai-run/route.ts', 'app/api/canary-results/[id]/route.ts'],
  requiredTables: ['canary_uploads', 'canary_jobs', 'canary_ai_runs', 'canary_results'],
  surfaceRequirements: [
    'Upload area + jobs list + result detail. NOT a chat-only page.',
    'Jobs have status transitions (pending → running → done/failed) — visible to user.',
    'Failed job shows retry, not silent.',
  ],
  verificationRequirements: [
    'verify_user_journey covers upload, job submission (creates row), AI run (or job-ready), result view.',
    'verify_db_state proves upload + job + (ai_run OR result) rows.',
  ],
  liveChecks: [
    { name: 'GET /', path: '/' },
    { name: 'GET /api/health', path: '/api/health' },
    { name: 'POST /api/canary-uploads', path: '/api/canary-uploads', method: 'POST', body: { filename: 'doc.pdf', mime: 'application/pdf', size: 4096, text: 'This is a canary document about insurance and compliance.' }, capture: { key: 'uploadId', from: ['upload.id', 'id'] } },
    { name: 'POST /api/canary-jobs', path: '/api/canary-jobs', method: 'POST', body: (state) => ({ upload_id: state.uploadId, kind: 'summarize' }), capture: { key: 'jobId', from: ['job.id', 'id'] } },
    { name: 'POST /api/canary-ai-run', path: '/api/canary-ai-run', method: 'POST', body: (state) => ({ job_id: state.jobId, prompt: 'Summarize the document' }), capture: { key: 'resultId', from: ['result.id', 'run.id', 'id'] } },
    { name: 'GET /api/canary-jobs/:id', path: (state) => `/api/canary-jobs/${encodeURIComponent(String(state.jobId ?? 'missing'))}` },
    { name: 'GET /api/canary-results/:id', path: (state) => `/api/canary-results/${encodeURIComponent(String(state.resultId ?? state.jobId ?? 'missing'))}` },
  ],
  browserUiChecks: [{
    name: 'AI workspace surface',
    requiredTextPatterns: ['upload|file|document', 'job|pipeline|run|process', 'result|output|summary'],
    requiredButtonPatterns: ['upload|submit|run', 'retry|view'],
    requireNoConsoleErrors: true,
  }],
  dbChecks: [
    { name: 'upload persisted', table: 'canary_uploads', expects: 'one row' },
    { name: 'job persisted', table: 'canary_jobs', expects: 'one row with status transitions visible' },
    { name: 'result or ai_run persisted', table: 'canary_results / canary_ai_runs', expects: 'at least one row (job-ready state acceptable when AI keys absent)' },
  ],
  requiredEvidence: ['DOMAIN_MATCH_EVIDENCE selected=advanced_ai_mixed', 'FRONTEND_PLAN_EVIDENCE pattern_ids contains ai_workspace'],
  expectedFailureClasses: ['external service blocker', 'capability pack gap', 'frontend pattern gap'],
};

export const EXTENDED_CANARY_SCENARIOS: ExtendedCanaryScenario[] = [
  ecommerceStore,
  businessWebsiteCrm,
  localServiceBooking,
  inventoryOperations,
  constructionOperations,
  financeCryptoDashboard,
  socialCommunity,
  educationContentPlatform,
  healthFitnessMealPlanner,
  mediaCreatorPlatform,
  realEstateProperty,
  advancedMixedAiWorkflow,
];

export const EXTENDED_SCENARIO_IDS = EXTENDED_CANARY_SCENARIOS.map((s) => s.id);
