import { notFound } from 'next/navigation';
import { db, companies, tasks, reports, platformEvents } from '@/lib/db';
import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { CompanyPublicPage } from '@/components/live/CompanyPublicPage';
import type { Metadata } from 'next';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [company] = await db.select({ name: companies.name, one_liner: companies.one_liner })
    .from(companies).where(eq(companies.slug, slug)).limit(1);

  if (!company) return { title: 'Not Found' };

  return {
    title: `${company.name} — Built with Baljia`,
    description: company.one_liner ?? `${company.name} is being built by AI agents on Baljia.`,
  };
}

export default async function PublicCompanyPage({ params }: Props) {
  const { slug } = await params;

  const [company] = await db.select({
    id: companies.id, name: companies.name, slug: companies.slug,
    one_liner: companies.one_liner, company_stage: companies.company_stage, created_at: companies.created_at,
  }).from(companies).where(eq(companies.slug, slug)).limit(1);

  if (!company) notFound();

  // Get public stats
  const [[taskCount], [reportCount], recentActivityRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(tasks)
      .where(and(eq(tasks.company_id, company.id), inArray(tasks.status, ['completed_verified', 'completed_unverified']))),
    db.select({ count: sql<number>`count(*)::int` }).from(reports)
      .where(eq(reports.company_id, company.id)),
    db.select({
      event_type: platformEvents.event_type, payload: platformEvents.payload,
      created_at: platformEvents.created_at,
    }).from(platformEvents)
      .where(and(eq(platformEvents.company_id, company.id), eq(platformEvents.is_public_safe, true)))
      .orderBy(desc(platformEvents.created_at)).limit(10),
  ]);

  return (
    <CompanyPublicPage
      company={{
        name: company.name,
        slug: company.slug,
        one_liner: company.one_liner,
        stage: company.company_stage ?? 'early',
        created_at: company.created_at ? new Date(company.created_at).toISOString() : new Date().toISOString(),
      }}
      stats={{
        tasks_completed: taskCount?.count ?? 0,
        reports_generated: reportCount?.count ?? 0,
      }}
      recentActivity={recentActivityRows.map((e) => ({
        type: e.event_type,
        payload: (e.payload ?? {}) as Record<string, unknown>,
        created_at: e.created_at ? new Date(e.created_at).toISOString() : new Date().toISOString(),
      }))}
    />
  );
}
