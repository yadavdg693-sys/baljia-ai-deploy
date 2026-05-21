import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const table = new Proxy(
  {},
  {
    get: (_target, prop) => prop,
  }
);

vi.mock('@/lib/db', () => ({
  adCampaigns: table,
  chatSessions: table,
  companies: table,
  creditLedger: table,
  db: {
    insert: vi.fn(),
    select: vi.fn(),
  },
  documents: table,
  emailThreads: table,
  platformEvents: table,
  reports: table,
  revenueLedger: table,
  runs: table,
  subscriptions: table,
  superAdminAuditEvents: table,
  tasks: table,
  users: table,
}));

describe('super admin service contract', () => {
  it('exports read-only Owner OS dashboard loaders', async () => {
    const service = await import('./super-admin.service');

    expect(service.getSuperAdminOperations).toBeTypeOf('function');
    expect(service.getSuperAdminBilling).toBeTypeOf('function');
    expect(service.getSuperAdminAuditLog).toBeTypeOf('function');
  });

  it('does not select known secret or raw payload fields', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/services/super-admin.service.ts'), 'utf8');

    expect(source).not.toMatch(/neon_connection_string/);
    expect(source).not.toMatch(/stripe_customer_id/);
    expect(source).not.toMatch(/stripe_subscription_id/);
    expect(source).not.toMatch(/platformEvents\.payload/);
    expect(source).not.toMatch(/reports\.structured_data/);
  });

  it('counts trial subscriptions by trial plan type instead of a trialing status', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/services/super-admin.service.ts'), 'utf8');

    expect(source).toContain("${subscriptions.plan_type} = 'trial'");
    expect(source).not.toContain("${subscriptions.status} = 'trialing'");
  });
});
