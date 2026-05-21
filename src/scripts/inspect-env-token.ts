// Inspect the GITHUB_TOKEN line in .env.local for corruption WITHOUT printing
// the secret. Reports byte vs character length, hidden characters, leading/
// trailing whitespace, line endings, and duplicate entries — the usual
// suspects when "the token I just pasted doesn't work."
//
// Usage: npx tsx src/scripts/inspect-env-token.ts

import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
const raw = readFileSync(envPath); // Buffer, not decoded — preserves bytes

// Detect line-ending convention
const hasCRLF = raw.includes(Buffer.from([0x0d, 0x0a]));
const hasLoneCR = (() => {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x0d && raw[i + 1] !== 0x0a) return true;
  }
  return false;
})();

console.log(`File: ${envPath}`);
console.log(`Total bytes: ${raw.length}`);
console.log(`Line endings: ${hasCRLF ? 'CRLF' : 'LF'}${hasLoneCR ? ' + lone CR (BAD)' : ''}`);

// Decode as UTF-8 and split on either CRLF or LF
const text = raw.toString('utf8');
const lines = text.split(/\r?\n/);

const tokenLines: Array<{ idx: number; line: string }> = [];
const orgLines: Array<{ idx: number; line: string }> = [];
for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trimStart();
  if (trimmed.startsWith('GITHUB_TOKEN')) tokenLines.push({ idx: i + 1, line: lines[i] });
  if (trimmed.startsWith('GITHUB_ORG'))   orgLines.push({ idx: i + 1, line: lines[i] });
}

console.log(`\nGITHUB_TOKEN entries: ${tokenLines.length}${tokenLines.length > 1 ? ' ⚠ DUPLICATE — last one wins' : ''}`);
console.log(`GITHUB_ORG   entries: ${orgLines.length}${orgLines.length > 1 ? ' ⚠ DUPLICATE — last one wins' : ''}`);

if (tokenLines.length === 0) { console.log('\nNo GITHUB_TOKEN line found.'); process.exit(0); }

const lastTokenLine = tokenLines[tokenLines.length - 1];
console.log(`\nInspecting last GITHUB_TOKEN line (line ${lastTokenLine.idx}):`);

const eqIdx = lastTokenLine.line.indexOf('=');
if (eqIdx < 0) { console.log('  ⚠ no "=" found'); process.exit(0); }

const key   = lastTokenLine.line.slice(0, eqIdx);
const value = lastTokenLine.line.slice(eqIdx + 1);

console.log(`  key: "${key}"  ${key !== 'GITHUB_TOKEN' ? '⚠ unexpected key formatting' : '✓'}`);
console.log(`  raw value length:  ${value.length}`);
console.log(`  trimmed length:    ${value.trim().length}`);
const leadingWs = value.length - value.trimStart().length;
const trailingWs = value.length - value.trimEnd().length;
console.log(`  leading whitespace:  ${leadingWs} char(s) ${leadingWs > 0 ? '⚠' : '✓'}`);
console.log(`  trailing whitespace: ${trailingWs} char(s) ${trailingWs > 0 ? '⚠' : '✓'}`);

// Quote inspection
const isWrappedInQuotes = value.startsWith('"') && value.endsWith('"');
const isWrappedInSingleQuotes = value.startsWith("'") && value.endsWith("'");
console.log(`  wrapped in double quotes: ${isWrappedInQuotes ? 'yes' : 'no'}`);
console.log(`  wrapped in single quotes: ${isWrappedInSingleQuotes ? 'yes' : 'no'}`);

const trimmed = value.trim().replace(/^["']|["']$/g, '');
console.log(`  effective value length: ${trimmed.length}`);

// Hidden character scan (excludes printable ASCII)
let hidden = 0;
let hiddenCharsList: string[] = [];
for (let i = 0; i < trimmed.length; i++) {
  const code = trimmed.charCodeAt(i);
  // Allow printable ASCII (0x20..0x7E)
  if (code < 0x20 || code > 0x7E) {
    hidden++;
    if (hiddenCharsList.length < 5) hiddenCharsList.push(`pos ${i}: 0x${code.toString(16).padStart(2, '0')}`);
  }
}
console.log(`  hidden/non-ASCII characters: ${hidden}${hidden > 0 ? ' ⚠ ' + hiddenCharsList.join(', ') : ' ✓'}`);

// Token format expectation
const prefix = trimmed.slice(0, 12);
console.log(`\nExpected GitHub token formats:`);
console.log(`  • Classic PAT:        ghp_${'.'.repeat(36)}              (40 chars total)`);
console.log(`  • Fine-grained PAT:   github_pat_${'.'.repeat(82)}        (93 chars total)`);
console.log(`  • Installation token: ghs_${'.'.repeat(36)}              (40 chars total)`);

console.log(`\nActual value: ${trimmed.length} chars, prefix matches: `);
const looksLikeFG = trimmed.startsWith('github_pat_');
const looksLikeClassic = trimmed.startsWith('ghp_');
const looksLikeInstallation = trimmed.startsWith('ghs_');
console.log(`  github_pat_… (fine-grained, expect 93 chars): ${looksLikeFG ? 'YES' : 'no'}`);
console.log(`  ghp_…        (classic, expect 40 chars):       ${looksLikeClassic ? 'YES' : 'no'}`);
console.log(`  ghs_…        (installation, expect 40 chars):  ${looksLikeInstallation ? 'YES' : 'no'}`);

if (looksLikeFG && trimmed.length !== 93) {
  console.log(`\n  ⚠ Looks like a fine-grained PAT but length is ${trimmed.length}, expected 93. ` +
              `Off by ${93 - trimmed.length} character(s) — likely truncation or extra char.`);
}
if (looksLikeClassic && trimmed.length !== 40) {
  console.log(`\n  ⚠ Looks like a classic PAT but length is ${trimmed.length}, expected 40.`);
}
if (!looksLikeFG && !looksLikeClassic && !looksLikeInstallation) {
  console.log(`\n  ⚠ Does not match any known GitHub token prefix. Likely:`);
  console.log(`     • truncated (start chars missing — common when copy-pasting from GitHub UI scrolled)`);
  console.log(`     • wrong token pasted (e.g. accidentally copied an OAuth client secret or API key)`);
  console.log(`     • prefix-stripped by the editor`);
}

// Diff vs what dotenv-cli would give us
const fromProcessEnv = process.env.GITHUB_TOKEN;
if (fromProcessEnv && fromProcessEnv !== trimmed) {
  console.log(`\n  ⚠ process.env.GITHUB_TOKEN differs from .env.local raw value. Length: ${fromProcessEnv.length} vs ${trimmed.length}.`);
  console.log(`    (means another env source — shell export or .env — is overriding .env.local)`);
}
