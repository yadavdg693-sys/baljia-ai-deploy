// ScreenshotOne — Automated website screenshot generation
// Used for verification reports, site previews, and marketing assets
//
// Env: SCREENSHOTONE_API_KEY

import { createLogger } from '@/lib/logger';

const log = createLogger('ScreenshotOne');

const API_BASE = 'https://api.screenshotone.com/take';

export function isScreenshotOneConfigured(): boolean {
  return !!process.env.SCREENSHOTONE_API_KEY;
}

// ══════════════════════════════════════════════
// SCREENSHOT — capture a webpage
// ══════════════════════════════════════════════

interface ScreenshotOptions {
  url: string;
  /** Viewport width (default: 1280) */
  viewportWidth?: number;
  /** Viewport height (default: 800) */
  viewportHeight?: number;
  /** Full page capture */
  fullPage?: boolean;
  /** Image format */
  format?: 'png' | 'jpeg' | 'webp';
  /** Wait for page load in ms */
  delay?: number;
  /** Dark mode */
  darkMode?: boolean;
  /** Block ads/trackers */
  blockAds?: boolean;
}

export async function takeScreenshot(options: ScreenshotOptions): Promise<{ url: string } | null> {
  if (!isScreenshotOneConfigured()) {
    log.debug('ScreenshotOne not configured, skipped', { url: options.url });
    return null;
  }

  const apiKey = process.env.SCREENSHOTONE_API_KEY!;

  const params = new URLSearchParams({
    access_key: apiKey,
    url: options.url,
    viewport_width: (options.viewportWidth ?? 1280).toString(),
    viewport_height: (options.viewportHeight ?? 800).toString(),
    full_page: (options.fullPage ?? false).toString(),
    format: options.format ?? 'png',
    delay: (options.delay ?? 2000).toString(),
    dark_mode: (options.darkMode ?? false).toString(),
    block_ads: (options.blockAds ?? true).toString(),
    cache: 'true',
    cache_ttl: '86400',
  });

  const screenshotUrl = `${API_BASE}?${params.toString()}`;

  // Validate the URL returns an image
  try {
    const response = await fetch(screenshotUrl, { method: 'HEAD' });
    if (!response.ok) {
      log.error('Screenshot failed', { url: options.url, status: response.status });
      return null;
    }

    log.info('Screenshot captured', { url: options.url });
    return { url: screenshotUrl };
  } catch (error) {
    log.error('Screenshot request failed', { url: options.url }, error);
    return null;
  }
}

/**
 * Get a signed screenshot URL without fetching.
 * Useful when embedding in emails or reports.
 */
export function getScreenshotUrl(url: string, options: Partial<ScreenshotOptions> = {}): string | null {
  if (!isScreenshotOneConfigured()) return null;

  const apiKey = process.env.SCREENSHOTONE_API_KEY!;
  const params = new URLSearchParams({
    access_key: apiKey,
    url,
    viewport_width: (options.viewportWidth ?? 1280).toString(),
    format: options.format ?? 'png',
    cache: 'true',
  });

  return `${API_BASE}?${params.toString()}`;
}
