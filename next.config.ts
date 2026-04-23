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
  // SPIKE-ONLY: skip type-check during build to surface CF-specific issues
  // without being blocked by pre-existing TS errors in scripts/
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
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
