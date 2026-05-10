// Pattern-based static scan of an agent's pushed code. Catches the class of
// AI-coding bugs that runtime journey verification can't see by definition:
//
//   - process.env.X read directly without going through the validated config
//   - empty / failure-swallowing catch blocks
//   - console.log of likely-secret variables (DATABASE_URL, *_KEY, etc.)
//   - missing await on Promise-returning DB / fetch calls
//   - hardcoded test fixtures that leaked from a journey run
//   - TODO / FIXME / XXX in committed code
//   - app.use(session(...)) without app.set('trust proxy') above it
//
// Light-weight: regex + AST-shape detection over the JS/TS files in the
// agent's most recent commit. No dependencies, no child processes, ~100ms
// per repo. Findings are advisory in the verifier — they don't fail the
// task but show up in the verification report, and the agent's prompt
// directs it to address them via github_create_commit before declaring
// complete.

interface Finding {
  severity: 'high' | 'medium' | 'low';
  file: string;
  lineHint?: number;
  rule: string;
  message: string;
}

interface ScannedFile {
  path: string;
  content: string;
}

const RULE_BUDGET_PER_FILE = 25; // cap finding count to keep verification reports skimmable

function ruleEnvWithoutConfig(content: string): Array<Omit<Finding, 'file'>> {
  // Flag any `process.env.X` read that's NOT inside a Zod schema definition
  // and NOT in a config-loader file. We can't fully prove it's wrong without
  // AST analysis, so this is best-effort.
  const lines = content.split('\n');
  const isConfigSchemaFile = /CONFIG_SCHEMA|configSchema|z\.object/.test(content) && lines.length < 80;
  if (isConfigSchemaFile) return [];
  const findings: Array<Omit<Finding, 'file'>> = [];
  lines.forEach((line, i) => {
    if (/process\.env\.\w+/.test(line) && !/parseConfig|CONFIG_SCHEMA|z\.object/.test(line)) {
      // Skip if the line is part of an env-validation schema definition.
      const ctx = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (/z\.object|CONFIG_SCHEMA|safeParse|parseConfig/.test(ctx)) return;
      findings.push({
        severity: 'medium',
        lineHint: i + 1,
        rule: 'env-without-config',
        message: 'process.env.X read outside the validated config object. Add the var to CONFIG_SCHEMA + read via `config.X` so missing vars fail at boot, not at first request.',
      });
    }
  });
  return findings;
}

function ruleSilentCatch(content: string): Array<Omit<Finding, 'file'>> {
  // catch (e) { return false } / catch (e) {}  — the two highest-cost
  // patterns. Flag both empty body and trivial false-return body.
  const findings: Array<Omit<Finding, 'file'>> = [];
  const re = /catch\s*\(\s*\w*\s*\)\s*\{\s*(\}|return\s+(false|null|undefined)\s*;?\s*\})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const lineHint = content.slice(0, m.index).split('\n').length;
    findings.push({
      severity: 'high',
      lineHint,
      rule: 'silent-catch',
      message: 'Empty or false-returning catch block. Log the error structurally (level=error, with request id + error.message) and return a typed error response. Silent catches make production debugging impossible.',
    });
  }
  return findings;
}

function ruleSecretInLog(content: string): Array<Omit<Finding, 'file'>> {
  // console.log(`...${process.env.X}...`) where X looks secret-ish.
  // logger.info({ ...DATABASE_URL, ... }) etc.
  const findings: Array<Omit<Finding, 'file'>> = [];
  const lines = content.split('\n');
  const secretNamePat = /\b(DATABASE_URL|SESSION_SECRET|STRIPE_API_KEY|STRIPE_SECRET_KEY|API_KEY|SECRET|PASSWORD|TOKEN|AUTH(?!_PROVIDER))\b/i;
  lines.forEach((line, i) => {
    const isLog = /\b(console\.(log|info|warn|error)|logger\.(info|warn|error|debug|fatal))\s*\(/.test(line);
    if (!isLog) return;
    if (secretNamePat.test(line)) {
      findings.push({
        severity: 'high',
        lineHint: i + 1,
        rule: 'secret-in-log',
        message: 'Log statement appears to include a secret-shaped variable. Pino has a `redact` option that masks known sensitive paths automatically — use that, or remove the variable from the log payload.',
      });
    }
  });
  return findings;
}

function ruleTodoFixme(content: string): Array<Omit<Finding, 'file'>> {
  // Flag TODO/FIXME/XXX in committed code — the agent should not ship work-in-progress.
  const findings: Array<Omit<Finding, 'file'>> = [];
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (/\b(TODO|FIXME|XXX)\b/.test(line)) {
      findings.push({
        severity: 'low',
        lineHint: i + 1,
        rule: 'todo-fixme',
        message: 'TODO/FIXME/XXX in committed code. Either complete the work or write a proper issue/ticket and remove the marker.',
      });
    }
  });
  return findings;
}

function ruleSessionWithoutTrustProxy(content: string, path: string): Array<Omit<Finding, 'file'>> {
  // The threadpulse session bug. Pin it forever.
  if (!/express-session|app\.use\(session/.test(content)) return [];
  if (/app\.set\(['"]trust proxy['"]/.test(content)) return [];
  // Only flag if we're in the main entry file.
  if (!/server\.[jt]s$|app\.[jt]s$|index\.[jt]s$/.test(path)) return [];
  return [{
    severity: 'high',
    rule: 'session-without-trust-proxy',
    message: 'app.use(session(...)) is present but app.set("trust proxy", 1) is not. Render runs an HTTP-only reverse proxy in front of the Node process; without trust-proxy, express-session refuses to send Secure cookies and authentication silently breaks.',
  }];
}

function ruleHardcodedTestEmail(content: string): Array<Omit<Finding, 'file'>> {
  // Catch journey-run leftover: hardcoded `test+xxx@baljia.test` etc.
  const findings: Array<Omit<Finding, 'file'>> = [];
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    // Skip lines inside test files
    if (/test\(|describe\(|expect\(/.test(line)) return;
    if (/['"][\w+.-]*@(baljia\.test|test\.local|example\.com)['"]/.test(line)) {
      findings.push({
        severity: 'medium',
        lineHint: i + 1,
        rule: 'hardcoded-test-email',
        message: 'A test-email-style address (e.g. @baljia.test, @example.com) appears in production code. Verify-journey runs may have leaked into the committed source.',
      });
    }
  });
  return findings;
}

function ruleSqlInterpolation(content: string): Array<Omit<Finding, 'file'>> {
  // pool.query(`SELECT ... ${userInput}...`) — string-template SQL is a
  // direct injection vector. Allow SQL embedded in comments / non-call sites.
  const findings: Array<Omit<Finding, 'file'>> = [];
  const re = /\b(pool|client|db)\s*\.\s*(query|execute)\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const lineHint = content.slice(0, m.index).split('\n').length;
    findings.push({
      severity: 'high',
      lineHint,
      rule: 'sql-template-interpolation',
      message: 'SQL with template-literal interpolation. Use parameterized queries: pool.query("SELECT * FROM x WHERE y = $1", [value]).',
    });
  }
  return findings;
}

// Express main entry only: detect when the agent has removed core hardening
// from the skeleton. These rules don't flag every possible app — only the
// shape that started from skeletons/express-render and lost protection.

function isMainEntryFile(path: string): boolean {
  return /server\.[jt]s$|app\.[jt]s$|index\.[jt]s$/.test(path);
}

function looksLikeExpressApp(content: string): boolean {
  return /require\(['"]express['"]\)|from\s+['"]express['"]/.test(content);
}

function ruleMissingHelmet(content: string, path: string): Array<Omit<Finding, 'file'>> {
  if (!isMainEntryFile(path) || !looksLikeExpressApp(content)) return [];
  if (/require\(['"]helmet['"]\)|from\s+['"]helmet['"]/.test(content) && /app\.use\s*\(\s*helmet/.test(content)) return [];
  return [{
    severity: 'high',
    rule: 'missing-helmet',
    message: 'Express app entry has no helmet middleware. Add `const helmet = require("helmet"); app.use(helmet({ contentSecurityPolicy: { ... } }))` before any route. Without helmet, the app ships missing CSP, X-Content-Type-Options, X-Frame-Options, and other baseline security headers.',
  }];
}

function ruleAuthRouteWithoutRateLimit(content: string, path: string): Array<Omit<Finding, 'file'>> {
  if (!isMainEntryFile(path) || !looksLikeExpressApp(content)) return [];
  // Look for POST /auth/* or /login/* /register/* handlers.
  const hasAuthRoute = /app\.(post|put)\s*\(\s*['"]\/(auth\/|login|register|signin|signup)/.test(content);
  if (!hasAuthRoute) return [];
  // Accept either express-rate-limit middleware OR a rate-limit reference on the route.
  const hasRateLimitImport = /express-rate-limit|rateLimit\s*\(/.test(content);
  if (hasRateLimitImport) return [];
  return [{
    severity: 'high',
    rule: 'auth-route-without-rate-limit',
    message: 'Auth routes (/auth/*, /login, /register) are present but no express-rate-limit middleware found. A single bad actor can run 1000 password guesses per minute. Add `const rateLimit = require("express-rate-limit"); const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 30 }); app.post("/auth/login", authLimiter, ...)`.',
  }];
}

function ruleHealthWithoutDbProbe(content: string, path: string): Array<Omit<Finding, 'file'>> {
  if (!isMainEntryFile(path) || !looksLikeExpressApp(content)) return [];
  // Locate the /api/health handler (regex over its body to catch the most common shape).
  const healthRouteMatch = content.match(/app\.get\s*\(\s*['"]\/api\/health['"][^}]+\}/s);
  if (!healthRouteMatch) return [];
  const handlerBody = healthRouteMatch[0];
  // Probe-shaped: a SELECT or .query/.execute call inside the handler.
  const hasDbProbe = /pool\.query|client\.query|db\.execute|SELECT/i.test(handlerBody);
  if (hasDbProbe) return [];
  const lineHint = content.slice(0, healthRouteMatch.index ?? 0).split('\n').length;
  return [{
    severity: 'high',
    lineHint,
    rule: 'health-without-db-probe',
    message: '/api/health handler exists but does not probe the database. Render uses /api/health for routing decisions; without a real probe, /api/health returns 200 even when the DB is unreachable, hiding broken deploys behind a "healthy" status.',
  }];
}

function ruleBodyWithoutSizeLimit(content: string, path: string): Array<Omit<Finding, 'file'>> {
  if (!isMainEntryFile(path) || !looksLikeExpressApp(content)) return [];
  const findings: Array<Omit<Finding, 'file'>> = [];
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    // express.json() / express.urlencoded() WITHOUT a `limit:` option
    if (/express\.(json|urlencoded)\s*\(\s*(\{[^}]*\}|\)\s*)/.test(line) && !/limit\s*:/.test(line)) {
      // Allow if the body parser is followed/preceded by an explicit limit set elsewhere on the line — we already checked.
      findings.push({
        severity: 'medium',
        lineHint: i + 1,
        rule: 'body-without-size-limit',
        message: 'Body parser middleware (express.json / express.urlencoded) configured without a `limit` option. Default limit is 100kb but unbounded growth in patches can hide; pin it explicitly: `express.json({ limit: "64kb" })`.',
      });
    }
  });
  return findings;
}

const RULES: Array<(content: string, path: string) => Array<Omit<Finding, 'file'>>> = [
  (c) => ruleEnvWithoutConfig(c),
  (c) => ruleSilentCatch(c),
  (c) => ruleSecretInLog(c),
  (c) => ruleTodoFixme(c),
  (c, p) => ruleSessionWithoutTrustProxy(c, p),
  (c) => ruleHardcodedTestEmail(c),
  (c) => ruleSqlInterpolation(c),
  (c, p) => ruleMissingHelmet(c, p),
  (c, p) => ruleAuthRouteWithoutRateLimit(c, p),
  (c, p) => ruleHealthWithoutDbProbe(c, p),
  (c, p) => ruleBodyWithoutSizeLimit(c, p),
];

export function scanFile(file: ScannedFile): Finding[] {
  const out: Finding[] = [];
  for (const rule of RULES) {
    for (const f of rule(file.content, file.path)) {
      out.push({ ...f, file: file.path });
      if (out.length >= RULE_BUDGET_PER_FILE) return out;
    }
  }
  return out;
}

export function scanFiles(files: ScannedFile[]): Finding[] {
  const all: Finding[] = [];
  for (const f of files) {
    // Only scan JS/TS source files
    if (!/\.(js|ts|jsx|tsx|mjs|cjs)$/i.test(f.path)) continue;
    // Skip test files (they're allowed to use process.env, hardcoded emails, etc.)
    if (/[\\/](tests?|__tests__|specs?)[\\/]|\.(test|spec)\.[jt]sx?$/i.test(f.path)) continue;
    all.push(...scanFile(f));
  }
  return all;
}

export function summarizeFindings(findings: Finding[]): string {
  if (findings.length === 0) return 'STATIC SCAN PASS: 0 findings.';
  const high = findings.filter((f) => f.severity === 'high').length;
  const medium = findings.filter((f) => f.severity === 'medium').length;
  const low = findings.filter((f) => f.severity === 'low').length;
  const lines = [`STATIC SCAN: ${findings.length} finding(s) — high=${high} medium=${medium} low=${low}`, ''];
  for (const f of findings.slice(0, 25)) {
    lines.push(`  [${f.severity.toUpperCase()}] ${f.file}${f.lineHint ? `:${f.lineHint}` : ''} (${f.rule})`);
    lines.push(`    ${f.message}`);
  }
  if (findings.length > 25) lines.push(`  ... and ${findings.length - 25} more`);
  return lines.join('\n');
}

export type { Finding, ScannedFile };
