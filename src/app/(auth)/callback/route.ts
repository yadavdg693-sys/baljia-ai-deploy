// Auth callback — JWT session already set by /api/auth/verify or /api/auth/google/callback
// This route just checks company status and redirects appropriately
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const user = await getSessionFromCookies();

  if (!user) {
    return NextResponse.redirect(new URL('/login', requestUrl.origin));
  }

  // Check if user has any companies
  const userCompanies = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.owner_id, user.id))
    .limit(1);

  if (userCompanies.length === 0) {
    return NextResponse.redirect(new URL('/onboarding', requestUrl.origin));
  }

  return NextResponse.redirect(new URL(`/dashboard/${userCompanies[0].id}`, requestUrl.origin));
}
