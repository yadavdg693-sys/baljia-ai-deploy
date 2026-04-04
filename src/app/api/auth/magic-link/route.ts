// POST /api/auth/magic-link — send magic link email
import { NextResponse } from 'next/server';
import { z } from 'zod';
import * as authService from '@/lib/services/auth.service';

const schema = z.object({
  email: z.string().email().max(255),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = schema.parse(body);

    await authService.createMagicLink(email);

    // Always return success (don't leak whether email exists)
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    console.error('Magic link error:', err);
    return NextResponse.json({ error: 'Failed to send login link' }, { status: 500 });
  }
}
