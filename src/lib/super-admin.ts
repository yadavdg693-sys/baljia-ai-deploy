import { notFound, redirect } from 'next/navigation';

export type SuperAdminUser = {
  id: string;
  email: string;
  name: string | null;
};

export type SuperAdminCompanyFilters = {
  q?: string;
  lifecycle?: string;
  billingState?: string;
  taskHealth?: string;
  activity?: string;
  limit: number;
};

export type RawSuperAdminCompanyFilters = {
  q?: string | string[];
  lifecycle?: string | string[];
  billingState?: string | string[];
  taskHealth?: string | string[];
  activity?: string | string[];
  limit?: number;
};

const COMPANY_LIFECYCLE_FILTERS = new Set([
  'trial_active',
  'full_active',
  'keep_live_active',
  'archived',
  'deleted',
  'active',
  'paused',
  'cancelled',
]);

const COMPANY_BILLING_FILTERS = new Set([
  'free',
  'trial',
  'active',
  'paid',
  'trialing',
  'past_due',
  'cancelled',
  'suspended_billing',
]);

const COMPANY_TASK_HEALTH_FILTERS = new Set(['failed', 'running', 'stuck', 'no_tasks']);
const COMPANY_ACTIVITY_FILTERS = new Set(['last_24h', 'last_7d', 'quiet_7d']);

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeAllowed(value: string | string[] | undefined, allowed: Set<string>): string | undefined {
  const normalized = firstParam(value)?.trim();
  if (!normalized) return undefined;
  return allowed.has(normalized) ? normalized : undefined;
}

export function normalizeSuperAdminCompanyFilters(
  raw: RawSuperAdminCompanyFilters = {}
): SuperAdminCompanyFilters {
  const q = firstParam(raw.q)?.trim() || undefined;
  const requestedLimit = raw.limit ?? 25;
  const limit = Math.max(1, Math.min(100, requestedLimit));

  return {
    ...(q ? { q } : {}),
    ...(normalizeAllowed(raw.lifecycle, COMPANY_LIFECYCLE_FILTERS)
      ? { lifecycle: normalizeAllowed(raw.lifecycle, COMPANY_LIFECYCLE_FILTERS) }
      : {}),
    ...(normalizeAllowed(raw.billingState, COMPANY_BILLING_FILTERS)
      ? { billingState: normalizeAllowed(raw.billingState, COMPANY_BILLING_FILTERS) }
      : {}),
    ...(normalizeAllowed(raw.taskHealth, COMPANY_TASK_HEALTH_FILTERS)
      ? { taskHealth: normalizeAllowed(raw.taskHealth, COMPANY_TASK_HEALTH_FILTERS) }
      : {}),
    ...(normalizeAllowed(raw.activity, COMPANY_ACTIVITY_FILTERS)
      ? { activity: normalizeAllowed(raw.activity, COMPANY_ACTIVITY_FILTERS) }
      : {}),
    limit,
  };
}

export function normalizeAdminEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdminEmail(
  email: string | null | undefined,
  rawAdminEmails = process.env.ADMIN_EMAILS
): boolean {
  const adminEmails = normalizeAdminEmails(rawAdminEmails);
  const normalizedEmail = (email ?? '').trim().toLowerCase();
  return adminEmails.length > 0 && adminEmails.includes(normalizedEmail);
}

export function isValidSuperAdminAccessKey(
  accessKey: string | null | undefined,
  expected = process.env.SUPER_ADMIN_DASHBOARD_SLUG
): boolean {
  return Boolean(accessKey && expected && accessKey === expected);
}

export function getSuperAdminBasePath(
  accessKey = process.env.SUPER_ADMIN_DASHBOARD_SLUG
): string {
  if (!accessKey) return '/owner/not-configured';
  return `/owner/${encodeURIComponent(accessKey)}`;
}

export async function requireSuperAdminPage(
  accessKey: string
): Promise<SuperAdminUser> {
  if (!isValidSuperAdminAccessKey(accessKey)) {
    notFound();
  }

  const { getSessionFromCookies } = await import('@/lib/auth');
  const user = await getSessionFromCookies();
  const next = getSuperAdminBasePath(accessKey);

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!isSuperAdminEmail(user.email)) {
    notFound();
  }

  return user;
}
