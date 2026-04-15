import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { db, companies } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { isValidUUID } from '@/lib/uuid-validation'; // G-INPUT-001: single canonical implementation

type ApiError = NextResponse<{ error: string }>;

// User type — minimal shape needed for auth checks
interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Authenticate the request and return the user.
 * Uses custom JWT session from httpOnly cookie.
 */
export async function requireAuth(): Promise<
  { user: AuthUser } | ApiError
> {
  const user = await getSessionFromCookies();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return { user };
}

/**
 * Verify the authenticated user owns the given company.
 */
export async function requireCompanyOwnership(
  companyId: string,
  userId: string
): Promise<true | ApiError> {
  const [company] = await db.select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.owner_id, userId)))
    .limit(1);

  if (!company) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return true;
}

/**
 * Combined auth + company ownership check.
 */
export async function requireAuthAndCompany(
  companyId: string
): Promise<{ user: AuthUser } | ApiError> {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const ownershipResult = await requireCompanyOwnership(companyId, authResult.user.id);
  if (ownershipResult instanceof NextResponse) return ownershipResult;

  return authResult;
}

/**
 * Extract company_id from query params, returning 400 if missing or invalid UUID.
 */
export function getRequiredCompanyId(request: NextRequest): string | ApiError {
  const companyId = request.nextUrl.searchParams.get('company_id');
  if (!companyId) {
    return NextResponse.json({ error: 'company_id required' }, { status: 400 });
  }
  if (!isValidUUID(companyId)) {
    return NextResponse.json({ error: 'company_id must be a valid UUID' }, { status: 400 });
  }
  return companyId;
}

/**
 * Extract any UUID param from query, returning 400 if missing or invalid.
 */
export function getRequiredUUIDParam(request: NextRequest, name: string): string | ApiError {
  const value = request.nextUrl.searchParams.get(name);
  if (!value) {
    return NextResponse.json({ error: `${name} required` }, { status: 400 });
  }
  if (!isValidUUID(value)) {
    return NextResponse.json({ error: `${name} must be a valid UUID` }, { status: 400 });
  }
  return value;
}

/**
 * Safely parse JSON body, returning 400 on malformed input.
 */
export async function parseJsonBody(request: NextRequest): Promise<unknown | ApiError> {
  try {
    return await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
}

/** Type guard to check if a result is an error response. */
export function isApiError(value: unknown): value is ApiError {
  return value instanceof NextResponse;
}

/**
 * RBAC: Require admin role.
 * Checks user email against ADMIN_EMAILS env var (comma-separated).
 */
export async function requireAdmin(): Promise<
  { user: AuthUser } | ApiError
> {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const userEmail = authResult.user.email?.toLowerCase() ?? '';

  if (adminEmails.length === 0) {
    // Fail closed: if ADMIN_EMAILS is not configured, deny all
    return NextResponse.json({ error: 'Forbidden: admin access not configured' }, { status: 403 });
  }

  if (!adminEmails.includes(userEmail)) {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  return authResult;
}
