import { SignJWT, jwtVerify } from 'jose';
import { db, usageEvents } from '@/lib/db';

export const BALJIA_RUNTIME_VERSION = '2.0.0';

export type RuntimeTokenInput = {
  companyId: string;
  appSlug: string;
  runtimeVersion?: string;
  capabilities?: string[];
};

export type VerifiedRuntimeToken = {
  companyId: string;
  appSlug: string;
  runtimeVersion: string;
  capabilities: string[];
};

export type UsageEventInput = {
  companyId: string;
  userId?: string | null;
  appSlug: string;
  packageName: string;
  feature: string;
  units?: number;
  costUsd?: string | number;
  status: 'success' | 'error' | 'started' | 'completed' | string;
  metadata?: Record<string, unknown> | null;
};

function runtimeSecret(): Uint8Array {
  const secret =
    process.env.BALJIA_RUNTIME_SIGNING_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    (process.env.NODE_ENV === 'test' ? process.env.GITHUB_TOKEN : undefined);

  if (!secret) {
    throw new Error('BALJIA_RUNTIME_SIGNING_SECRET is not configured.');
  }

  return new TextEncoder().encode(secret);
}

export async function signRuntimeToken(input: RuntimeTokenInput): Promise<string> {
  const runtimeVersion = input.runtimeVersion ?? BALJIA_RUNTIME_VERSION;

  return new SignJWT({
    companyId: input.companyId,
    appSlug: input.appSlug,
    runtimeVersion,
    capabilities: input.capabilities ?? [],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('baljia-platform')
    .setAudience('baljia-runtime')
    .setSubject(input.companyId)
    .setIssuedAt()
    .setExpirationTime('365d')
    .sign(runtimeSecret());
}

export async function verifyRuntimeToken(token: string): Promise<VerifiedRuntimeToken> {
  try {
    const { payload } = await jwtVerify(token, runtimeSecret(), {
      issuer: 'baljia-platform',
      audience: 'baljia-runtime',
    });

    const companyId = String(payload.companyId ?? '');
    const appSlug = String(payload.appSlug ?? '');
    const runtimeVersion = String(payload.runtimeVersion ?? '');
    const capabilities = Array.isArray(payload.capabilities)
      ? payload.capabilities.map((value) => String(value))
      : [];

    if (!companyId || !appSlug || !runtimeVersion) {
      throw new Error('runtime token missing required claims');
    }

    return { companyId, appSlug, runtimeVersion, capabilities };
  } catch (err) {
    throw new Error(`Invalid runtime token: ${err instanceof Error ? err.message : 'verification failed'}`);
  }
}

export function bearerTokenFromHeader(header: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return match?.[1]?.trim() || null;
}

export async function recordUsageEvent(input: UsageEventInput) {
  const [row] = await db.insert(usageEvents).values({
    company_id: input.companyId,
    user_id: input.userId ?? null,
    app_slug: input.appSlug,
    package_name: input.packageName,
    feature: input.feature,
    units: input.units ?? 1,
    cost_usd: String(input.costUsd ?? '0'),
    status: input.status,
    metadata: input.metadata ?? {},
  }).returning();

  return row;
}
