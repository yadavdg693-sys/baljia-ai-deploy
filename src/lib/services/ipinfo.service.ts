// IPinfo — IP geolocation enrichment
// Optional enrichment for analytics and personalization
//
// Env: IPINFO_TOKEN

import { createLogger } from '@/lib/logger';

const log = createLogger('IPinfo');

export function isIPinfoConfigured(): boolean {
  return !!process.env.IPINFO_TOKEN;
}

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

export interface GeoInfo {
  ip: string;
  city: string;
  region: string;
  country: string;
  loc: string;          // "lat,lon"
  org: string;
  postal: string;
  timezone: string;
}

// ══════════════════════════════════════════════
// LOOKUP — get geo info for an IP
// ══════════════════════════════════════════════

const cache = new Map<string, { data: GeoInfo; expires: number }>();

export async function lookupIP(ip: string): Promise<GeoInfo | null> {
  if (!isIPinfoConfigured()) return null;
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;

  // Check cache (TTL: 1 hour)
  const cached = cache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.data;

  try {
    const token = process.env.IPINFO_TOKEN!;
    const response = await fetch(`https://ipinfo.io/${ip}?token=${token}`);

    if (!response.ok) {
      log.warn('IPinfo lookup failed', { ip, status: response.status });
      return null;
    }

    const data = await response.json() as GeoInfo;

    // Cache for 1 hour
    cache.set(ip, { data, expires: Date.now() + 3600_000 });

    // Evict old cache entries (max 1000)
    if (cache.size > 1000) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }

    return data;
  } catch (error) {
    log.error('IPinfo request failed', { ip }, error);
    return null;
  }
}

/**
 * Extract country code from IP (most common use case).
 */
export async function getCountry(ip: string): Promise<string | null> {
  const geo = await lookupIP(ip);
  return geo?.country ?? null;
}
