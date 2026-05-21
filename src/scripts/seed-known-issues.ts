// Seed the failure_fingerprints table with the recurring infra failures
// we've observed in real engineering runs. Each entry has fix_status='fixed'
// and a populated fix_notes field, so the engineering agent's
// `read_known_issues` tool returns actionable guidance for similar work.
//
// Idempotent: dedupes by `fingerprint` (a stable hash of the failure shape).
// Safe to re-run.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, failureFingerprints } from '@/lib/db';
import { eq } from 'drizzle-orm';

interface SeedRow {
  fingerprint: string;
  category: string;
  description: string;
  fix_notes: string;
  affected_agents: number[];
  affected_tools: string[];
}

const SEED: SeedRow[] = [
  {
    fingerprint: 'render-envvars-shape-2026-04',
    category: 'connector_failure',
    description: 'Render service created but env vars silently dropped — app booted with undefined config and crashed on first request.',
    fix_notes: 'In the render_create_service body, envVars MUST be at the TOP LEVEL of the request body, NOT nested inside serviceDetails. The Render API silently discards envVars under serviceDetails.envSpecificDetails. Verify the body shape with: curl -X POST https://api.render.com/v1/services -d \'{"envVars":[...], "serviceDetails":{...}}\' (envVars sibling to serviceDetails).',
    affected_agents: [30],
    affected_tools: ['render_create_service'],
  },
  {
    fingerprint: 'render-slug-cname-2026-04',
    category: 'infra_error',
    description: 'Custom CNAME pointed to <slug>.onrender.com returns 503 — Render hostnames include a deploy suffix.',
    fix_notes: 'Render service URLs are NOT <slug>.onrender.com — they are <slug>-<random-suffix>.onrender.com. Always fetch the actual hostname via `getRenderServiceHostname(serviceId)` (calls the Render API and returns the canonical URL). Then point your CNAME at that. Hardcoding <slug>.onrender.com produces a 503 (no service at that hostname).',
    affected_agents: [30],
    affected_tools: ['attach_custom_domain', 'render_create_service'],
  },
  {
    fingerprint: 'trust-proxy-missing-express-2026-05',
    category: 'infra_error',
    description: 'Express + express-session + cookie.secure=true behind Render reverse proxy → no Set-Cookie header sent → registration and sign-in silently fail.',
    fix_notes: 'Add `app.set("trust proxy", 1)` IMMEDIATELY after `const app = express()` and BEFORE `app.use(session(...))`. Render runs an HTTP-only reverse proxy in front of Node; without trust-proxy, express-session sees the internal HTTP hop and refuses to send Secure cookies, breaking auth silently. The static_code_scan rule `session-without-trust-proxy` catches this.',
    affected_agents: [30],
    affected_tools: ['github_create_commit', 'fork_express_skeleton'],
  },
  {
    fingerprint: 'github-token-truncation-2026-05',
    category: 'connector_failure',
    description: 'GITHUB_TOKEN env var was 92 characters instead of 93 — silently truncated in .env file → all GitHub API calls returned 401.',
    fix_notes: 'GitHub fine-grained tokens are 93 chars (prefix + 87 char body). If GITHUB_TOKEN length < 93, suspect truncation. The preflight check now validates length ≥ 40 before launch, but still: when copying tokens between environments, pipe through `wc -c` or check char count explicitly. Never paste tokens that span multiple visual lines without verifying the full string copied.',
    affected_agents: [30],
    affected_tools: ['github_create_repo', 'github_push_file', 'github_create_commit'],
  },
  {
    fingerprint: 'render-hobby-custom-domain-quota-2026-05',
    category: 'external_block',
    description: 'attach_custom_domain failed with HTTP 400 "Hobby Tier is limited to 2 custom domains" — agent then spent multiple turns trying to recover and was killed by the watchdog loop detector.',
    fix_notes: 'Render Hobby tier caps at 2 custom domains per account. When attach_custom_domain returns this error, DO NOT loop trying to fix it. Proceed with the .onrender.com URL: call render_get_service to get the service hostname, then run verify_user_journey against that URL. The custom domain attachment is nice-to-have, not blocking. If the founder really needs the custom domain, write a report explaining the account limit and let the operator handle quota changes.',
    affected_agents: [30],
    affected_tools: ['attach_custom_domain'],
  },
  {
    fingerprint: 'render-pipeline-minutes-exhausted-2026-05',
    category: 'external_block',
    description: 'Render deploy failed before app build logs because service events contained pipeline_minutes_exhausted / build minutes exhausted.',
    fix_notes: 'This is a Render account quota/build-minutes blocker, not an app-code or Render command failure. Do NOT change package.json, render.yaml, build/start commands, env vars, or recreate the service for this signal. Stop deploy/verification churn, run static_code_scan/review_pushed_code if needed after the latest code push, write the codebase map and blocker report, then rerun only after the operator confirms Render build minutes/quota are restored. The render_deploy, render_set_env_vars, and render_update_service_config tools circuit-break repeat build-triggering calls for 24 hours and only allow a controlled retry with force_after_quota_restored=true. Canary smoke/runner preflight probes recent Render events, includes earliest_retry_after when the Render event has a timestamp, and should stay blocked until quota is restored and a newer live deploy clears the stale quota event. Preflight-blocked canary summaries expose earliestRetryAfter; canary_render_engineering should honor that cached retry time and avoid repeated live preflight/API churn until the retry time unless --force-after-quota-restored is used after operator confirmation.',
    affected_agents: [30],
    affected_tools: ['render_deploy', 'render_set_env_vars', 'render_update_service_config', 'render_get_deploy_status', 'render_get_logs', 'smoke_preflight', 'canary_render_engineering'],
  },
  {
    fingerprint: 'agent-modifies-skeleton-health-2026-05',
    category: 'verification_reject',
    description: 'Engineering agent modified the skeleton\'s /api/health handler and removed the DB probe → static_code_scan flagged health-without-db-probe HIGH → task failed.',
    fix_notes: 'Per the engineering prompt rule 3: do NOT modify the skeleton\'s framework files (the Zod schema, trust-proxy, session middleware, /api/health, withTimeout, register/login/logout). Customize ONLY landing copy, dashboard rendering, and feature routes. /api/health probes DB + integrations on purpose — Render uses its return code for routing decisions. If you find yourself rewriting /api/health, stop and re-read the prompt.',
    affected_agents: [30],
    affected_tools: ['github_push_file', 'github_create_commit'],
  },
  {
    fingerprint: 'next-storage-node26-blob-bodyinit-2026-05',
    category: 'build_failure',
    description: 'Next.js/TypeScript build on Render Node 26 failed in lib/storage.ts because Buffer/Uint8Array values were passed directly to BlobPart or fetch BodyInit.',
    fix_notes: 'Patch the storage helper before deploy: convert Buffer/File to a freshly owned `ArrayBuffer`, e.g. `const ab = new ArrayBuffer(file.byteLength); new Uint8Array(ab).set(new Uint8Array(file.buffer, file.byteOffset, file.byteLength));`. Create uploads with `new Blob([ab], { type })`, pass Blob/FormData to fetch, and use `Buffer.from(ab)` only for local fs writes. Use `.byteLength`, never `.length`, for ArrayBuffer metadata. Do not use `bytes.buffer.slice(...)` or pass raw `Buffer`/`Uint8Array` as BlobPart/BodyInit; strict Node 26/TypeScript can still treat those as ArrayBufferLike/SharedArrayBuffer-backed. The platform helper `patchStorageTemplateForNode26` installs the safe helper on fork.',
    affected_agents: [30],
    affected_tools: ['github_push_file', 'github_create_commit', 'render_get_logs'],
  },
  {
    fingerprint: 'llm-sdk-ignored-abort-timeout-2026-05',
    category: 'timeout',
    description: 'Engineering agent turn hung far beyond configured LLM timeout because provider streaming SDK ignored or delayed AbortSignal rejection, leading to watchdog idle kill.',
    fix_notes: 'The LLM timeout wrapper must race the provider promise against an explicit timeout promise and parent-abort promise. Do not rely only on passing AbortSignal to the SDK. Regression test: a provider function that never resolves and ignores AbortSignal must reject with `LLM call timed out after ...` inside the configured timeout.',
    affected_agents: [30],
    affected_tools: [],
  },
  {
    fingerprint: 'neon-http-fetch-failed-migration-2026-05',
    category: 'tool_failure',
    description: 'run_migration/query_company_db failed with Neon HTTP driver TypeError: fetch failed shortly after provisioning a new company database.',
    fix_notes: 'Treat Neon HTTP `fetch failed`, ECONNRESET, ETIMEDOUT, 502/503/504 as transient. Retry migration and query operations with bounded backoff before surfacing failure. Do not rewrite schema or switch app architecture because of a single Neon fetch failure; verify with get_database_info, then rerun the same migration/query after retry delay.',
    affected_agents: [30],
    affected_tools: ['run_migration', 'query_company_db'],
  },
  {
    fingerprint: 'next-session-import-from-utils-2026-05',
    category: 'build_failure',
    description: 'Next.js build failed because generated API routes imported getSession/requireSession from `@/lib/utils`, but server-only session helpers live in `@/lib/session`.',
    fix_notes: 'Patch imports in server routes/components: `import { getSession, requireSession } from "@/lib/session"` and keep `@/lib/utils` only for shared helpers like cn(). static_code_scan rule `session-imported-from-utils` catches this before Render deploy.',
    affected_agents: [30],
    affected_tools: ['static_code_scan', 'github_create_commit', 'render_get_logs'],
  },
  {
    fingerprint: 'verify-browser-ui-framework-text-false-positive-2026-05',
    category: 'verification_reject',
    description: 'verify_browser_ui falsely returned framework_overlay=true for healthy production Next.js pages because normal page/HTML text contained framework strings such as Next.js or webpack.',
    fix_notes: 'Do not patch founder apps to remove Next.js scripts, dev indicators, toaster providers, or framework metadata just to satisfy framework_overlay=true. The platform verifier should only flag actual visible error overlay text such as "Unhandled Runtime Error", "Application error: a client-side exception has occurred", "Failed to compile", "Module not found", or hydration failure messages. If this recurs, patch verify_browser_ui/hasFrameworkErrorOverlay instead of changing the app.',
    affected_agents: [30],
    affected_tools: ['verify_browser_ui'],
  },
  {
    fingerprint: 'next-globals-tw-animate-css-missing-2026-05',
    category: 'build_failure',
    description: 'Next.js Render build failed because app/globals.css imported `tw-animate-css` but package.json did not include that dependency.',
    fix_notes: "If Render logs show `Can't resolve 'tw-animate-css' in app/globals.css`, remove the `@import \"tw-animate-css\";` line or add the package intentionally. For the Baljia skeleton default, remove the import; the platform fork patcher `patchMissingTwAnimateCssImport` now strips it when the dependency is absent.",
    affected_agents: [30],
    affected_tools: ['render_get_logs', 'github_push_file', 'github_create_commit'],
  },
  {
    fingerprint: 'openai-compatible-embedding-model-dimension-2026-05',
    category: 'runtime_error',
    description: 'RAG/document-search canaries failed at runtime when generated code hardcoded an embedding model/dimension that did not match AI_GATEWAY_URL.',
    fix_notes: 'Choose embeddings from the configured gateway, then match pgvector dimensions. If AI_GATEWAY_URL contains `generativelanguage.googleapis.com/v1beta/openai`, use `gemini-embedding-001` with `vector(3072)`; live probes show `text-embedding-3-small` and `text-embedding-004` both 404 on that gateway. If using the Baljia/OpenAI gateway, use `text-embedding-3-small` with `vector(1536)`. After changing model/dims, migrate the table/index, redeploy, rerun verify_user_journey, verify_db_state, and render_get_logs.',
    affected_agents: [30],
    affected_tools: ['render_get_logs', 'run_migration', 'verify_user_journey', 'github_create_commit'],
  },
  {
    fingerprint: 'anthropic-oauth-invalid-refresh-fallback-2026-05',
    category: 'connector_failure',
    description: 'Anthropic OAuth credentials were present, but async refresh returned invalid_grant; Engineering then skipped direct Anthropic API-key auth and fell through to lower-priority providers.',
    fix_notes: 'If Claude Code OAuth refresh fails, do not throw from `createAnthropicWithOAuthAsync`. Log the unusable OAuth state and fall back to normal Anthropic SDK auth so ANTHROPIC_API_KEY or Bedrock can be used inside the same provider slot. Run the Anthropic smoke test and provider-router tests after patching.',
    affected_agents: [30],
    affected_tools: [],
  },
  {
    fingerprint: 'render-custom-domain-length-limit-2026-05',
    category: 'infra_error',
    description: 'Render custom domain attachment failed with HTTP 400 because a canary-generated baljia.app domain exceeded Render\'s 64-character custom-domain limit.',
    fix_notes: 'Before calling Render custom-domain APIs, compute the full domain length. If `${slug}.baljia.app` or the requested custom domain is longer than 64 characters, skip custom-domain attachment and continue with the Render-assigned `.onrender.com` URL. Treat this as non-fatal and do not create a Cloudflare DNS handoff for a domain Render cannot attach.',
    affected_agents: [30],
    affected_tools: ['render_create_service', 'attach_custom_domain'],
  },
];

async function main() {
  console.log(`Seeding ${SEED.length} known fingerprints...`);
  let inserted = 0;
  let skipped = 0;
  const now = new Date();

  for (const row of SEED) {
    const existing = await db.select({ id: failureFingerprints.id })
      .from(failureFingerprints)
      .where(eq(failureFingerprints.fingerprint, row.fingerprint))
      .limit(1);

    if (existing.length > 0) {
      await db.update(failureFingerprints)
        .set({
          category: row.category,
          description: row.description,
          fix_notes: row.fix_notes,
          affected_agents: row.affected_agents,
          affected_tools: row.affected_tools,
          fix_status: 'fixed',
          fix_applied_at: now,
        })
        .where(eq(failureFingerprints.id, existing[0].id));
      console.log(`  ~ ${row.fingerprint}: already present (updated)`);
      skipped++;
      continue;
    }

    await db.insert(failureFingerprints).values({
      fingerprint: row.fingerprint,
      category: row.category,
      description: row.description,
      fix_notes: row.fix_notes,
      affected_agents: row.affected_agents,
      affected_tools: row.affected_tools,
      fix_status: 'fixed',
      fix_applied_at: now,
      first_seen_at: now,
      last_seen_at: now,
      occurrence_count: 1,
    });
    console.log(`  + ${row.fingerprint}: inserted`);
    inserted++;
  }

  console.log(`\nDone. Inserted ${inserted}, skipped ${skipped}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('seed-known-issues failed:', err);
  process.exit(1);
});
