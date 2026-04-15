// Waitlist API — pre-auth email capture
// New email signups route through here before reaching /onboarding.
// If the user already exists, returns a flag to show "Check your email" instead.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { db, users, waitlist } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { parseJsonBody, isApiError } from '@/lib/api-utils';
import { waitlistSchema } from '@/lib/validations';

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const parsed = waitlistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();

  // Check if user already exists (returning user)
  const [existingUser] = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser) {
    // Existing user — they should use "Sign in" instead.
    // Send them to login with redirect to onboarding if they don't have a company yet.
    return NextResponse.json({
      existing_user: true,
      message: 'Check your email for a login link.',
    });
  }

  // New user — record on waitlist and send them to /onboarding with email prefilled
  const requestIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null;

  await db.insert(waitlist).values({
    email,
    ip_address: requestIp,
    status: 'pending',
  });

  return NextResponse.json({
    existing_user: false,
    redirect: `/onboarding?email=${encodeURIComponent(email)}`,
    message: 'Account ready — continue to onboarding.',
  });
}
