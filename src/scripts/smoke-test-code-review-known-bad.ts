// Verify review_pushed_code's Haiku reviewer actually flags real issues.
//
// We construct a fixture diff with 4 deliberate problems:
//   1. Silent catch block (returns false on error, no log)
//   2. Auth bypass — admin route forgets requireAuth middleware
//   3. SQL injection — template-literal SQL with user input
//   4. Secret exposed — logger.info logs DATABASE_URL
//
// Then call reviewDiff() and assert Haiku catches at least 3 of the 4.
// (Tolerance for one miss because LLM judgment is non-deterministic.)

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { reviewDiff, summarizeReview } from '@/lib/services/code-review.service';

const KNOWN_BAD_DIFF = `--- a/server.js
+++ b/server.js
@@ -10,3 +10,30 @@ const pool = new Pool({ connectionString: process.env.DATABASE_URL });

+// Bug 1: Silent catch — swallows the error and returns false with no log.
+app.post('/api/items', requireAuth, async (req, res) => {
+  try {
+    const { rows } = await pool.query('INSERT INTO items (user_id, title) VALUES ($1, $2) RETURNING id', [req.session.userId, req.body.title]);
+    res.json({ id: rows[0].id });
+  } catch (err) {
+    return false;
+  }
+});
+
+// Bug 2: Auth bypass — admin route forgot the requireAuth middleware.
+// Anyone can hit /admin/users and dump the user table.
+app.get('/admin/users', async (req, res) => {
+  const { rows } = await pool.query('SELECT id, email FROM users');
+  res.json(rows);
+});
+
+// Bug 3: SQL injection via template-literal interpolation.
+// req.params.email is user-controlled.
+app.get('/api/lookup/:email', async (req, res) => {
+  const email = req.params.email;
+  const { rows } = await pool.query(\`SELECT * FROM users WHERE email = '\${email}'\`);
+  res.json(rows);
+});
+
+// Bug 4: Secret exposed in logs. DATABASE_URL contains the password.
+app.use((req, res, next) => {
+  logger.info({ db: process.env.DATABASE_URL, userId: req.session?.userId }, 'request received');
+  next();
+});
`;

void (async () => {
  console.log('Submitting known-bad diff to reviewDiff()...\n');
  const t0 = Date.now();
  const result = await reviewDiff(KNOWN_BAD_DIFF, 'BALAJIapps/test-known-bad');
  const elapsed = Date.now() - t0;
  console.log(summarizeReview(result));
  console.log(`\nelapsed: ${elapsed}ms`);
  console.log(`ok: ${result.ok}`);
  console.log(`findings count: ${result.findings.length}`);

  if (!result.ok) {
    console.log('\n⚠ Result was not parseable JSON — printing raw response for diagnosis:');
    console.log(result.rawResponse?.slice(0, 1000) ?? '(none)');
    process.exit(1);
  }

  // Assert at least 3 of 4 categories were flagged. We use loose category
  // matching since the reviewer might categorize differently than we did.
  // Look for any finding whose `issue` text contains keywords for each bug.
  const flagged = {
    silentCatch:    result.findings.some(f => /silent|return false|catch|swallow|no log/i.test(`${f.issue} ${f.category}`)),
    authBypass:     result.findings.some(f => /auth|admin|requireAuth|middleware|access/i.test(`${f.issue} ${f.category}`)),
    sqlInjection:   result.findings.some(f => /sql|injection|template|parameter|interpolat/i.test(`${f.issue} ${f.category}`)),
    secretInLog:    result.findings.some(f => /secret|DATABASE_URL|expose|log.*credential|password|sensitive/i.test(`${f.issue} ${f.category}`)),
  };

  console.log('\nCategory detection:');
  for (const [k, v] of Object.entries(flagged)) {
    console.log(`  ${v ? '✓' : '✗'} ${k}`);
  }
  const detected = Object.values(flagged).filter(Boolean).length;
  console.log(`\nDetected ${detected}/4 known-bad categories.`);

  // High-severity findings should be at least 2 (auth bypass + SQL injection are unambiguous).
  const high = result.findings.filter(f => f.severity === 'high').length;
  console.log(`High-severity findings: ${high}`);

  const passed = detected >= 3 && high >= 2;
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  RESULT: ${passed ? 'PASS' : 'FAIL'}`);
  console.log(`  ${passed
    ? 'Haiku correctly identified the deliberate bugs.'
    : `Expected ≥3 categories detected and ≥2 high-severity findings; got ${detected} and ${high}.`}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  process.exit(passed ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
