// Company Service — migrated to Drizzle + Neon
import { db, companies } from '@/lib/db';
import { eq, desc, sql } from 'drizzle-orm';
import { generateSlug } from '@/lib/slug';
import type { Company } from '@/types';

interface CreateCompanyInput {
  owner_id: string;
  name: string;
  one_liner?: string;
  original_idea?: string;
}

export type UpdateCompanyFields = Partial<Pick<Company,
  'name' | 'one_liner' | 'onboarding_status' | 'company_stage' | 'lifecycle' |
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
    company_stage: 'early',
  }).returning();

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
