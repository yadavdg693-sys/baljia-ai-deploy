// Late.dev — Multi-platform social media posting/scheduling
// Posts to Twitter, LinkedIn, Instagram, Facebook, etc. via a unified API
//
// Env: LATEDEV_API_KEY

import { createLogger } from '@/lib/logger';

const log = createLogger('LateDev');

const LATE_API_BASE = 'https://api.late.dev/v1';

export function isLateDevConfigured(): boolean {
  return !!process.env.LATEDEV_API_KEY;
}

// ══════════════════════════════════════════════
// API CALLER
// ══════════════════════════════════════════════

async function lateApi<T>(
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: Record<string, unknown>
): Promise<T> {
  const apiKey = process.env.LATEDEV_API_KEY;
  if (!apiKey) throw new Error('LATEDEV_API_KEY not configured');

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && method === 'POST') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${LATE_API_BASE}${path}`, options);
  const result = await response.json() as T;

  if (!response.ok) {
    const msg = (result as { error?: string }).error ?? `HTTP ${response.status}`;
    throw new Error(`Late.dev API error: ${msg}`);
  }

  return result;
}

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

type Platform = 'twitter' | 'linkedin' | 'instagram' | 'facebook' | 'threads';

interface SocialAccount {
  id: string;
  platform: Platform;
  username: string;
  connected: boolean;
}

interface PostResult {
  id: string;
  platform: Platform;
  url?: string;
  status: 'published' | 'scheduled' | 'failed';
}

// ══════════════════════════════════════════════
// ACCOUNTS — list connected social accounts
// ══════════════════════════════════════════════

export async function listAccounts(): Promise<SocialAccount[]> {
  if (!isLateDevConfigured()) return [];
  return lateApi<SocialAccount[]>('/accounts');
}

// ══════════════════════════════════════════════
// POST — publish to one or more platforms
// ══════════════════════════════════════════════

interface CreatePostOptions {
  /** Text content */
  text: string;
  /** Platforms to post to */
  platforms: Platform[];
  /** Media URLs to attach */
  mediaUrls?: string[];
  /** Schedule for later (ISO timestamp) */
  scheduledFor?: string;
  /** Account IDs to use (optional, uses defaults) */
  accountIds?: string[];
}

export async function createPost(options: CreatePostOptions): Promise<PostResult[]> {
  if (!isLateDevConfigured()) {
    log.warn('Late.dev not configured, post skipped', { platforms: options.platforms });
    return options.platforms.map((p) => ({
      id: 'not-configured',
      platform: p,
      status: 'failed' as const,
    }));
  }

  const result = await lateApi<{ posts: PostResult[] }>('/posts', 'POST', {
    text: options.text,
    platforms: options.platforms,
    media_urls: options.mediaUrls,
    scheduled_for: options.scheduledFor,
    account_ids: options.accountIds,
  });

  log.info('Social post created', {
    platforms: options.platforms,
    scheduled: !!options.scheduledFor,
    results: result.posts.length,
  });

  return result.posts;
}

// ══════════════════════════════════════════════
// SCHEDULE — queue a post for later
// ══════════════════════════════════════════════

export async function schedulePost(
  text: string,
  platforms: Platform[],
  scheduledFor: string,
  mediaUrls?: string[]
): Promise<PostResult[]> {
  return createPost({ text, platforms, scheduledFor, mediaUrls });
}

// ══════════════════════════════════════════════
// DELETE — remove a scheduled/published post
// ══════════════════════════════════════════════

export async function deletePost(postId: string): Promise<boolean> {
  if (!isLateDevConfigured()) return false;

  try {
    await lateApi(`/posts/${postId}`, 'DELETE');
    return true;
  } catch {
    return false;
  }
}
