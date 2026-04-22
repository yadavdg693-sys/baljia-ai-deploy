// One-off test: verify Postmark sandbox approval is live.
//
// Sends a test email from {slug}@baljia.app to the user's gmail (external,
// unverified address). In sandbox, Postmark rejects with ErrorCode 412
// ("Recipient address is not verified" / "pending approval"). In production
// mode, it returns ErrorCode 0 and a MessageID.
//
// Run with: npx tsx scripts/test-postmark-approval.ts

// Load env vars from .env.local first (matches runtime behavior)
import 'dotenv/config';
// Also try .env.local explicitly since Next.js loads it but tsx doesn't by default
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) config({ path: '.env.local', override: true });

const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';
const TO = process.argv[2] ?? 'yadavdg4@gmail.com';
const FROM = process.argv[3] ?? 'test@baljia.app';

async function main(): Promise<void> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) {
    console.error('❌ POSTMARK_SERVER_TOKEN not in env');
    process.exit(1);
  }

  console.log('──────────────────────────────────────────');
  console.log('Postmark approval test');
  console.log(`  From: ${FROM}`);
  console.log(`  To:   ${TO}`);
  console.log(`  Token prefix: ${token.slice(0, 8)}...`);
  console.log('──────────────────────────────────────────');

  const res = await fetch(POSTMARK_API_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify({
      From: FROM,
      To: TO,
      Subject: 'Baljia — Postmark approval verification',
      TextBody: [
        'This is a test email verifying that Postmark has approved sending to external addresses.',
        '',
        `If you received this at ${TO}, sandbox approval is LIVE and startup / completion emails will flow.`,
        '',
        'Reply is not monitored — this is an automated test.',
        '',
        '— Baljia onboarding-rewrite branch test',
      ].join('\n'),
      Tag: 'approval-test',
      TrackOpens: false,
      TrackLinks: 'None',
    }),
  });

  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }

  console.log(`HTTP: ${res.status} ${res.statusText}`);
  console.log('Body:', JSON.stringify(body, null, 2));
  console.log('──────────────────────────────────────────');

  if (res.ok && typeof body === 'object' && body && 'ErrorCode' in body) {
    const errorCode = (body as { ErrorCode: number }).ErrorCode;
    if (errorCode === 0) {
      console.log('✅ APPROVED — Postmark accepted the send. Check inbox.');
      process.exit(0);
    } else {
      console.log(`❌ Postmark rejected (ErrorCode ${errorCode})`);
      process.exit(2);
    }
  } else {
    console.log('❌ Non-2xx response — sandbox block or auth issue');
    process.exit(3);
  }
}

main().catch((err: unknown) => {
  console.error('❌ Test crashed:', err instanceof Error ? err.message : String(err));
  process.exit(4);
});
