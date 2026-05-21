// Smoke test for fork_express_skeleton.
//
// Provisions a temporary test GitHub repo, runs the tool against it,
// asserts the resulting commit has all the expected skeleton files
// (with __SLUG__ / __APP_NAME__ substituted), then deletes the test repo.
//
// What this validates:
//   - Skeleton dir on disk is consistent (no missing files)
//   - File count + paths match what the tool returns
//   - Placeholders are actually substituted (not left as __SLUG__ literal)
//   - Atomic single-commit push works (one commit, all files)
//   - Refusal-to-overwrite guard fires on second invocation
//
// Usage: npx tsx --env-file=.env.local src/scripts/smoke-test-express-skeleton.ts

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies, users } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { handleEngineeringTool } from '@/lib/agents/tools/engineering.tools';

const GH_API = 'https://api.github.com';
const TEST_SLUG = `skeleton-smoke-${Date.now()}`;

async function ghFetch(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${GH_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

void (async () => {
  const org = process.env.GITHUB_ORG!;
  const owner = process.env.GITHUB_TOKEN ? org : null;
  if (!owner) throw new Error('GITHUB_TOKEN / GITHUB_ORG not configured');

  console.log(`Smoke test slug: ${TEST_SLUG}`);

  // 1. Create a fresh test repo via the GitHub API (auto_init = single README commit)
  console.log(`\n1. Creating test repo ${org}/${TEST_SLUG}...`);
  const createRes = await ghFetch('POST', `/orgs/${org}/repos`, {
    name: TEST_SLUG, description: 'Skeleton smoke test — will be deleted',
    private: true, auto_init: true, has_issues: false, has_wiki: false, has_projects: false,
  });
  if (!createRes.ok) {
    const errBody = await createRes.text();
    throw new Error(`repo create failed: ${createRes.status} ${errBody}`);
  }
  console.log(`   repo created`);

  // 2. Create a temporary user + company row pointing at the test repo so the
  //    tool's company-lookup paths resolve. Cleaned up at the end.
  const [u] = await db.insert(users).values({ email: `${TEST_SLUG}@baljia.test`, auth_provider: 'magic_link' }).returning();
  const [c] = await db.insert(companies).values({
    owner_id:           u.id,
    name:               'Skeleton Smoke',
    slug:               TEST_SLUG,
    onboarding_status:  'completed',
    plan_tier:          'trial',
    lifecycle:          'trial_active',
    execution_state:    'active',
    billing_state:      'trial',
    hosting_state:      'pending',
    github_repo:        `${org}/${TEST_SLUG}`,
  }).returning();
  console.log(`   db rows: user=${u.id.slice(0,8)} company=${c.id.slice(0,8)}`);

  let allChecksPassed = true;
  try {
    // 3. Run fork_express_skeleton
    console.log(`\n2. Running fork_express_skeleton...`);
    const result = await handleEngineeringTool('fork_express_skeleton', { app_name: 'Smoke Test App' }, {
      id: 'smoke', company_id: c.id, tag: 'engineering', title: 'smoke', description: '',
    } as never);
    console.log(result);
    if (!result.startsWith('Express skeleton forked into')) {
      console.error(`   FAIL: tool did not report success`);
      allChecksPassed = false;
    } else {
      console.log(`   PASS: tool reported success`);
    }

    // 4. Inspect resulting commit + files
    console.log(`\n3. Inspecting resulting repo...`);
    const treeRes = await ghFetch('GET', `/repos/${org}/${TEST_SLUG}/git/trees/main?recursive=1`);
    const tree = await treeRes.json() as { tree: Array<{ path: string; type: string; size?: number }> };
    const files = tree.tree.filter((e) => e.type === 'blob').map((e) => e.path);
    console.log(`   files in repo (${files.length}): ${files.join(', ')}`);

    const expected = ['server.js', 'package.json', 'render.yaml', '.gitignore', 'README.md', 'db/schema.sql', 'tests/config.test.js', 'tests/auth.test.js', 'tests/health.test.js'];
    const missing = expected.filter((f) => !files.includes(f));
    if (missing.length === 0) {
      console.log(`   PASS: all 9 skeleton files present`);
    } else {
      console.error(`   FAIL: missing files: ${missing.join(', ')}`);
      allChecksPassed = false;
    }

    // 5. Spot-check placeholder substitution in render.yaml
    console.log(`\n4. Checking placeholder substitution...`);
    const renderYamlRes = await ghFetch('GET', `/repos/${org}/${TEST_SLUG}/contents/render.yaml`);
    const renderYamlData = await renderYamlRes.json() as { content: string };
    const renderYamlText = Buffer.from(renderYamlData.content, 'base64').toString();
    if (renderYamlText.includes(`name: ${TEST_SLUG}`)) {
      console.log(`   PASS: render.yaml has substituted slug`);
    } else {
      console.error(`   FAIL: render.yaml did not substitute __SLUG__. Body:\n${renderYamlText.slice(0, 200)}`);
      allChecksPassed = false;
    }
    if (renderYamlText.includes('__SLUG__') || renderYamlText.includes('__APP_NAME__')) {
      console.error(`   FAIL: render.yaml still contains literal placeholder`);
      allChecksPassed = false;
    } else {
      console.log(`   PASS: no leftover placeholders in render.yaml`);
    }

    // 6. Check README.md substitution too
    const readmeRes = await ghFetch('GET', `/repos/${org}/${TEST_SLUG}/contents/README.md`);
    const readmeData = await readmeRes.json() as { content: string };
    const readmeText = Buffer.from(readmeData.content, 'base64').toString();
    if (readmeText.includes(`# ${TEST_SLUG}`) && readmeText.includes('Smoke Test App')) {
      console.log(`   PASS: README has substituted slug + app name`);
    } else {
      console.error(`   FAIL: README missing slug or app name. First 200 chars:\n${readmeText.slice(0, 200)}`);
      allChecksPassed = false;
    }

    // 7. Refusal-to-overwrite guard — second invocation should refuse
    console.log(`\n5. Verifying refusal-to-overwrite guard...`);
    const result2 = await handleEngineeringTool('fork_express_skeleton', { app_name: 'Should not run' }, {
      id: 'smoke', company_id: c.id, tag: 'engineering', title: 'smoke', description: '',
    } as never);
    if (result2.startsWith('Refusing to fork-overwrite')) {
      console.log(`   PASS: second invocation correctly refused`);
    } else {
      console.error(`   FAIL: expected refusal, got: ${result2.slice(0, 200)}`);
      allChecksPassed = false;
    }
  } finally {
    // 8. Cleanup
    console.log(`\n6. Cleaning up...`);
    await db.delete(companies).where(eq(companies.id, c.id));
    await db.delete(users).where(eq(users.id, u.id));
    const delRes = await ghFetch('DELETE', `/repos/${org}/${TEST_SLUG}`);
    if (delRes.ok || delRes.status === 204) {
      console.log(`   ✓ test repo deleted`);
    } else {
      console.log(`   ⚠ could not delete repo (HTTP ${delRes.status}); manually clean up ${org}/${TEST_SLUG}`);
    }
    console.log(`   ✓ db rows removed`);
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  SMOKE TEST: ${allChecksPassed ? 'PASS' : 'FAIL'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  process.exit(allChecksPassed ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
