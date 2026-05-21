import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { db, companies } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { isValidUUID } from '@/lib/uuid-validation'; // G-INPUT-001: single canonical implementation
import { isSuperAdminEmail } from '@/lib/super-admin';

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
 * Resolve a company identifier (UUID or slug) to a UUID.
 * Returns the UUID string, or an ApiError if not found.
 */
export async function resolveCompanyIdentifier(identifier: string): Promise<string | ApiError> {
  if (isValidUUID(identifier)) return identifier;

  // Treat as slug — look up company ID
  const [row] = await db.select({ id: companies.id })
    .from(companies)
    .where(eq(companies.slug, identifier))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  }
  return row.id;
}

/**
 * Extract company_id from query params, returning 400 if missing.
 * Accepts UUID or slug — resolves slug to UUID automatically.
 */
export async function getRequiredCompanyId(request: NextRequest): Promise<string | ApiError> {
  const companyId = request.nextUrl.searchParams.get('company_id');
  if (!companyId) {
    return NextResponse.json({ error: 'company_id required' }, { status: 400 });
  }
  return resolveCompanyIdentifier(companyId);
}

/**
 * Resolve company_id from a parsed JSON body field.
 * Accepts UUID or slug — resolves slug to UUID automatically.
 */
export async function resolveBodyCompanyId(body: Record<string, unknown>): Promise<string | ApiError> {
  const companyId = body.company_id;
  if (!companyId || typeof companyId !== 'string') {
    return NextResponse.json({ error: 'company_id required' }, { status: 400 });
  }
  return resolveCompanyIdentifier(companyId);
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

  if (!process.env.ADMIN_EMAILS?.trim()) {
    return NextResponse.json({ error: 'Forbidden: admin access not configured' }, { status: 403 });
  }

  if (!isSuperAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  return authResult;
}
