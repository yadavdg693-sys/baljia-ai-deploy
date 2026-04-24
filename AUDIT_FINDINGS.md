# Baljia AI Folder Audit Findings

Audit date: 2026-04-24

This file records the findings from the whole-folder audit of `baljia-ai-cf`.

## Finding 1: [P0] Tracked API Key

Location: `cf-workflow-poc/wrangler.toml:13`

This tracked Cloudflare config contains a real Gemini API key.

Impact:
The exposed key can be copied from the repository and abused until it is revoked. Because the file is tracked, the key may also exist in git history even after removal.

Recommended fix:
Rotate the Gemini API key, remove it from the working tree and git history, and use `wrangler secret put GEMINI_API_KEY` or a local-only ignored vars file instead.

## Finding 2: [P0] Public Route Can Overwrite Platform LLM Credentials

Location: `src/app/api/auth/codex/route.ts:17-29`

`/api/auth/codex` is public through the auth route allowlist, starts an OAuth flow without admin gating, and the flow saves credentials into the global Codex credential store used before `OPENAI_API_KEY`.

Impact:
A visitor could replace the server's primary LLM credential, affecting platform-wide LLM calls and potentially binding the service to an attacker-controlled account.

Recommended fix:
Split user login from platform credentials, require admin or internal authentication for platform credential setup, and bind OAuth jobs to a session/state cookie.

## Finding 3: [P1] Production Build Is Blocked

Location: `src/lib/services/storage.service.ts:142`

The root `npm run build` and `npx tsc --noEmit` both fail because this `@ts-expect-error` is now unused.

Impact:
Render's configured `npm install && npm run build` deployment command cannot complete.

Recommended fix:
Remove the unused `@ts-expect-error` or replace it with a real type-safe stream narrowing.

## Finding 4: [P1] Public Signup Path Has No Abuse Guard

Location: `src/app/api/quick-start/route.ts:20`

This unauthenticated endpoint creates a user, creates a company, and grants welcome credits without IP/email rate limiting or bot protection.

Impact:
Attackers can mass-create users/companies and consume welcome credits, database rows, onboarding resources, and downstream agent capacity.

Recommended fix:
Add the same Redis-backed limiter pattern used for magic links, consider Turnstile/CAPTCHA, and defer credits until email verification.

## Finding 5: [P1] Redis Config Drift Disables Persistent Rate Limits

Location: `src/lib/redis.ts:22-25`

The Redis client only reads `REDIS_URL`, but `.env.example` and Render configs define `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

Impact:
Following the documented config leaves Redis disabled, so rate limits and event pub/sub fall back to process memory.

Recommended fix:
Either update deployment/env docs to provide `REDIS_URL`, or update `src/lib/redis.ts` to support the documented Upstash variables.

## Finding 6: [P1] Stripe Event Dedupe Is Race-Prone

Location: `src/app/api/webhooks/stripe/route.ts:46-64`

The webhook checks `platform_events` for an event id and only records it after side effects.

Impact:
Two concurrent Stripe deliveries can both pass the dedupe check and grant credits twice.

Recommended fix:
Use a dedicated `processed_stripe_events` table or unique expression index and insert/claim the event before credit mutation, ideally in a transaction.

## Check Results

- `npm run lint`: Passed with 2 warnings.
- `npm test`: Passed, 4 test files and 22 tests.
- `npm run build`: Failed on the unused `@ts-expect-error` in `storage.service.ts`.
- `npx tsc --noEmit`: Failed on the same unused `@ts-expect-error`.
- `npm audit --omit=dev`: Found 4 moderate transitive advisories.
- `founder-app-worker` typecheck: Passed.
- `founder-app-worker` production audit: 0 vulnerabilities.

## Note

CodeRabbit CLI was not installed during the audit, so these findings came from local/manual inspection and project checks.
