// Company Service — migrated to Drizzle + Neon
import { db, companies, subscriptions } from '@/lib/db';
import { eq, desc, sql } from 'drizzle-orm';
import { generateSlug } from '@/lib/slug';
import type { Company } from '@/types';

// Trial defaults — keep in sync with PLAN_CONFIG.trial in billing.service.ts
const TRIAL_NIGHT_SHIFTS = 3;
const TRIAL_DURATION_DAYS = 14;

interface CreateCompanyInput {
  owner_id: string;
  name: string;
  one_liner?: string;
  original_idea?: string;
}

export type UpdateCompanyFields = Partial<Pick<Company,
  'name' | 'one_liner' | 'onboarding_status' | 'lifecycle' |
  'execution_state' | 'billing_state' | 'hosting_state' | 'subdomain' |
  'email_identity' | 'github_repo' | 'render_service_id' | 'neon_database_id' | 'custom_domain'
>>;

/**
 * Create a company with slug generation + collision handling.
 */
export async function createCompany(input: CreateCompanyInput): Promise<Company> {
  const slug = await generateSlug(input.name, async (candidate) => {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(companies)
      .where(eq(companies.slug, candidate));
    return (result[0]?.count ?? 0) > 0;
  });

  const [company] = await db.insert(companies).values({
    owner_id: input.owner_id,
    name: input.name,
    slug,
    one_liner: input.one_liner ?? null,
    original_idea: input.original_idea ?? null,
    claim_status: 'owned',
    onboarding_status: 'initializing',
    plan_tier: 'trial',
    lifecycle: 'trial_active',
    execution_state: 'active',
    billing_state: 'trial',
    hosting_state: 'live',
    // company_stage intentionally not set — column deprecated 2026-05-02.
  }).returning();

  // Provision a trial subscription row so the night-shift cron's INNER JOIN
  // matches this company (CLAUDE.md Gotcha #3: "Trial gets night shifts").
  // Without this row the company is silently excluded from night shifts —
  // contradicting the night_shifts_remaining: 3 allowance promised in the
  // onboarding ceo-summary / celebrate steps.
  // Stripe fields stay null until real checkout (handled in billing.service).
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(subscriptions).values({
    user_id: input.owner_id,
    company_id: company.id,
    plan_type: 'trial',
    status: 'active',
    night_shifts_total: TRIAL_NIGHT_SHIFTS,
    night_shifts_remaining: TRIAL_NIGHT_SHIFTS,
    trial_ends_at: trialEndsAt,
    current_period_start: now,
    current_period_end: trialEndsAt,
  });

  return company as unknown as Company;
}

export async function getCompany(companyId: string): Promise<Company | null> {
  const [company] = await db.select().from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  return (company as unknown as Company) ?? null;
}

export async function getCompaniesByOwner(ownerId: string): Promise<Company[]> {
  const result = await db.select().from(companies)
    .where(eq(companies.owner_id, ownerId))
    .orderBy(desc(companies.created_at));

  return result as unknown as unknown as Company[];
}

export async function updateCompany(companyId: string, updates: UpdateCompanyFields): Promise<Company> {
  const [company] = await db.update(companies)
    .set(updates)
    .where(eq(companies.id, companyId))
    .returning();

  if (!company) throw new Error('Failed to update company: not found');
  return company as unknown as Company;
}
