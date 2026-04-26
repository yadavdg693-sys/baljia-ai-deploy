// POST /api/auth/magic-link — send magic link email
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as authService from '@/lib/services/auth.service';
import { checkRateLimitAsync, checkCustomRateLimitAsync } from '@/lib/rate-limiter';

const schema = z.object({
  email: z.string().email().max(255),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = schema.parse(body);

    // Throttle by email (prevents mailbox flooding) and by IP (prevents enumeration).
    const emailLimit = await checkCustomRateLimitAsync(`magic-link:email:${email.toLowerCase()}`, { maxRequests: 5, windowMs: 60_000 });
    if (emailLimit) return emailLimit; // Returns 429 response if limited

    const ipLimit = await checkRateLimitAsync(request, { maxRequests: 10, windowMs: 60_000, keyPrefix: 'magic-link:ip' });
    if (ipLimit) return ipLimit;

    const result = await authService.createMagicLink(email);

    // Always return success (don't leak whether email exists)
    return NextResponse.json({
      success: true,
      magicLink: process.env.NODE_ENV === 'development' ? result.magicLink : undefined,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    console.error('Magic link error:', err);
    return NextResponse.json({ error: 'Failed to send login link' }, { status: 500 });
  }
}
