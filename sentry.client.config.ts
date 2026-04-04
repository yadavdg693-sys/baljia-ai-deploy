import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance — sample 10% of transactions in prod, 100% in dev
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Only send errors in production or when DSN is explicitly set
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment tag
  environment: process.env.NODE_ENV ?? 'development',

  // Filter out noisy errors
  ignoreErrors: [
    // Browser extensions
    'ResizeObserver loop',
    // Network noise
    'Failed to fetch',
    'Load failed',
    'NetworkError',
    // Next.js hydration (non-critical)
    'Hydration failed',
    'Text content does not match',
  ],

  // Attach user context when available
  beforeSend(event) {
    // Strip sensitive data from breadcrumbs
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((b) => {
        if (b.data?.url && typeof b.data.url === 'string') {
          // Redact API keys from URLs
          b.data.url = b.data.url.replace(/[?&](key|token|secret)=[^&]*/gi, '$1=REDACTED');
        }
        return b;
      });
    }
    return event;
  },
});
