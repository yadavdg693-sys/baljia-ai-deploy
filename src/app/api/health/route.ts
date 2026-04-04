import { NextResponse } from 'next/server';

// GET /api/health — Health check endpoint
// FIX: G-INFRA-001 — provides health check for load balancers and monitoring
// NOTE: This endpoint does NOT require auth (excluded from middleware)
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '1.0.0',
    uptime: Math.round(process.uptime()),
  });
}
