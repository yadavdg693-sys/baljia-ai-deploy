// Sentry instrumentation for Next.js 15+
// This file is auto-loaded by Next.js to initialize Sentry on the server

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
