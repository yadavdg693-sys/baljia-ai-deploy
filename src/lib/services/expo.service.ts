// Expo EAS — Mobile app build & distribution service
// Triggers React Native builds and submits to App Store / Play Store
//
// Env: EXPO_TOKEN

import { createLogger } from '@/lib/logger';

const log = createLogger('Expo');

const EAS_API_BASE = 'https://api.expo.dev/v2';

export function isExpoConfigured(): boolean {
  return !!process.env.EXPO_TOKEN;
}

// ══════════════════════════════════════════════
// API CALLER
// ══════════════════════════════════════════════

async function easApi<T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>
): Promise<T> {
  const token = process.env.EXPO_TOKEN;
  if (!token) throw new Error('EXPO_TOKEN not configured');

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && method === 'POST') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${EAS_API_BASE}${path}`, options);
  const result = await response.json() as { data?: T; errors?: Array<{ message: string }> };

  if (!response.ok || result.errors?.length) {
    const msg = result.errors?.[0]?.message ?? `HTTP ${response.status}`;
    throw new Error(`EAS API error: ${msg}`);
  }

  return result.data as T;
}

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

interface EASProject {
  id: string;
  slug: string;
  name: string;
}

type BuildPlatform = 'ios' | 'android' | 'all';
type BuildProfile = 'development' | 'preview' | 'production';

interface EASBuild {
  id: string;
  status: 'new' | 'in-queue' | 'in-progress' | 'errored' | 'finished' | 'canceled';
  platform: string;
  artifacts?: {
    buildUrl?: string;
    applicationArchiveUrl?: string;
  };
  createdAt: string;
  completedAt?: string;
}

// ══════════════════════════════════════════════
// PROJECTS — list & get Expo projects
// ══════════════════════════════════════════════

export async function listProjects(accountName: string): Promise<EASProject[]> {
  if (!isExpoConfigured()) return [];
  return easApi<EASProject[]>(`/accounts/${accountName}/projects`);
}

export async function getProject(projectId: string): Promise<EASProject | null> {
  if (!isExpoConfigured()) return null;
  try {
    return await easApi<EASProject>(`/projects/${projectId}`);
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════
// BUILDS — trigger & monitor EAS builds
// ══════════════════════════════════════════════

export async function triggerBuild(
  projectId: string,
  platform: BuildPlatform,
  profile: BuildProfile = 'preview'
): Promise<{ buildId: string; platform: string } | null> {
  if (!isExpoConfigured()) {
    log.warn('Expo not configured, build skipped');
    return null;
  }

  try {
    const result = await easApi<{ id: string; platform: string }>(
      `/projects/${projectId}/builds`,
      'POST',
      { platform, profile }
    );

    log.info('EAS build triggered', { projectId, platform, profile, buildId: result.id });
    return { buildId: result.id, platform: result.platform };
  } catch (error) {
    log.error('EAS build trigger failed', { projectId, platform }, error);
    return null;
  }
}

export async function getBuildStatus(buildId: string): Promise<EASBuild | null> {
  if (!isExpoConfigured()) return null;

  try {
    return await easApi<EASBuild>(`/builds/${buildId}`);
  } catch {
    return null;
  }
}

export async function listBuilds(projectId: string, limit = 10): Promise<EASBuild[]> {
  if (!isExpoConfigured()) return [];

  try {
    return await easApi<EASBuild[]>(`/projects/${projectId}/builds?limit=${limit}`);
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════
// SUBMIT — submit build to App Store / Play Store
// ══════════════════════════════════════════════

export async function submitToStore(
  projectId: string,
  buildId: string,
  platform: 'ios' | 'android'
): Promise<{ submissionId: string } | null> {
  if (!isExpoConfigured()) return null;

  try {
    const result = await easApi<{ id: string }>(
      `/projects/${projectId}/submissions`,
      'POST',
      { buildId, platform }
    );

    log.info('EAS store submission created', { platform, submissionId: result.id });
    return { submissionId: result.id };
  } catch (error) {
    log.error('EAS submission failed', { projectId, buildId, platform }, error);
    return null;
  }
}
