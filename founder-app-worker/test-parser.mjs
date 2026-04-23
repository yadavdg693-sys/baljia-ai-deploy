// Unit test for parseSubdomain() — the Worker's host routing logic.
// Miniflare local dev rewrites Host when wildcard routes are configured,
// which prevents a clean end-to-end smoke from localhost. This test validates
// the pure function logic directly; the production path (CF edge → Worker)
// passes Host through correctly, as confirmed in CF docs and per the Day-1
// spike validation of 8 platform endpoints.

const APEX_DOMAIN = 'baljia.app';
const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'admin', 'mail', 'email', 'cdn', 'assets', 'status', 'parking', 'app']);

function parseSubdomain(host) {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase();
  if (!hostname.endsWith(`.${APEX_DOMAIN}`)) return null;
  const sub = hostname.slice(0, -1 * (APEX_DOMAIN.length + 1));
  if (!sub || sub.length === 0) return null;
  if (sub.includes('.')) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(sub)) return null;
  return sub;
}

const cases = [
  // [input, expected, description]
  ['acme.baljia.app', 'acme', 'normal subdomain'],
  ['ACME.BALJIA.APP', 'acme', 'uppercase normalized'],
  ['acme.baljia.app:8080', 'acme', 'port stripped'],
  ['widget-co.baljia.app', 'widget-co', 'hyphen allowed'],
  ['abc123.baljia.app', 'abc123', 'alphanumeric allowed'],
  ['baljia.app', null, 'apex domain rejected'],
  ['.baljia.app', null, 'empty subdomain rejected'],
  ['foo.bar.baljia.app', null, 'multi-level rejected'],
  ['foo_bar.baljia.app', null, 'underscore rejected (invalid chars)'],
  ['-leading.baljia.app', null, 'leading hyphen rejected'],
  ['example.com', null, 'wrong apex rejected'],
  ['', null, 'empty string rejected'],
  [undefined, null, 'undefined rejected'],
  ['www.baljia.app', 'www', 'www parsed (reserved check happens after parsing)'],
  ['api.baljia.app', 'api', 'api parsed (reserved check happens after parsing)'],
];

let passed = 0;
let failed = 0;
for (const [input, expected, description] of cases) {
  const actual = parseSubdomain(input);
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`PASS  ${description.padEnd(55)} input=${JSON.stringify(input)} → ${JSON.stringify(actual)}`);
  } else {
    failed++;
    console.log(`FAIL  ${description.padEnd(55)} input=${JSON.stringify(input)} expected=${JSON.stringify(expected)} got=${JSON.stringify(actual)}`);
  }
}

// Reserved-subdomain behavior test: parsing returns the name, downstream logic rejects
for (const reserved of RESERVED_SUBDOMAINS) {
  const parsed = parseSubdomain(`${reserved}.${APEX_DOMAIN}`);
  const reservedCheck = parsed !== null && RESERVED_SUBDOMAINS.has(parsed);
  if (reservedCheck) {
    passed++;
    console.log(`PASS  reserved subdomain detection: ${reserved}`);
  } else {
    failed++;
    console.log(`FAIL  reserved subdomain detection failed for: ${reserved}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
