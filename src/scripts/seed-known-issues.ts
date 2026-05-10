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
    fingerprint: 'agent-modifies-skeleton-health-2026-05',
    category: 'verification_reject',
    description: 'Engineering agent modified the skeleton\'s /api/health handler and removed the DB probe → static_code_scan flagged health-without-db-probe HIGH → task failed.',
    fix_notes: 'Per the engineering prompt rule 3: do NOT modify the skeleton\'s framework files (the Zod schema, trust-proxy, session middleware, /api/health, withTimeout, register/login/logout). Customize ONLY landing copy, dashboard rendering, and feature routes. /api/health probes DB + integrations on purpose — Render uses its return code for routing decisions. If you find yourself rewriting /api/health, stop and re-read the prompt.',
    affected_agents: [30],
    affected_tools: ['github_push_file', 'github_create_commit'],
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
      console.log(`  - ${row.fingerprint}: already present (skip)`);
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
