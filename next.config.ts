import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'assets.baljia.app',  // D3 FIX: R2 bucket, not Supabase
      },
    ],
  },
  // Serve the standalone waitlist page at the root — keeps URL clean (no redirect)
  async rewrites() {
    return [
      {
        source: '/',
        destination: '/waitlist.html',
      },
    ];
  },
  webpack(config, { dev }) {
    if (!dev) {
      // Next's bundled webpack can crash in production builds on Windows/Node 22
      // while hashing persistent cache entries. Disabling the cache keeps the
      // build deterministic; Render/Linux still benefits from npm layer cache.
      config.cache = false;
    }
    return config;
  },
};

// Wrap with Sentry only when auth token is available (avoids build errors in dev)
const sentryWrapped = process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      telemetry: false,
    })
  : nextConfig;

export default sentryWrapped;
