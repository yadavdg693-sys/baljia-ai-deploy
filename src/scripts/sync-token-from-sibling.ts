// Copy GITHUB_TOKEN from the sibling baljia-ai project's .env.local into
// this project's .env.local (without ever printing either value to stdout).
// Validates the source token format first, then atomically replaces just
// the GITHUB_TOKEN line in the destination.
//
// Usage: npx tsx src/scripts/sync-token-from-sibling.ts

import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = 'C:/Users/Vaishnavi/My_Projects/baljia-ai/.env.local';
const DEST   = resolve(process.cwd(), '.env.local');

function extractValue(file: string, key: string): string | null {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  // Last occurrence wins (matches dotenv behavior).
  let val: string | null = null;
  for (const ln of lines) {
    if (!ln.trimStart().startsWith(key)) continue;
    const eq = ln.indexOf('=');
    if (eq < 0) continue;
    let v = ln.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    val = v;
  }
  return val;
}

function describe(label: string, val: string | null): { len: number; prefix: string; format: string } | null {
  if (!val) { console.log(`${label}: NOT FOUND`); return null; }
  const len = val.length;
  const prefix = val.slice(0, 11);
  let format = 'unknown';
  if (val.startsWith('github_pat_')) format = `fine-grained PAT (expect 93, got ${len})`;
  else if (val.startsWith('ghp_'))    format = `classic PAT (expect 40, got ${len})`;
  else if (val.startsWith('ghs_'))    format = `installation token (expect 40, got ${len})`;
  console.log(`${label}: len=${len}, prefix=${JSON.stringify(prefix)}, format=${format}`);
  return { len, prefix, format };
}

const srcToken  = extractValue(SOURCE, 'GITHUB_TOKEN');
const destToken = extractValue(DEST,   'GITHUB_TOKEN');

console.log(`Source: ${SOURCE}`);
const srcInfo = describe('  GITHUB_TOKEN', srcToken);
console.log(`\nDest:   ${DEST}`);
const destInfo = describe('  GITHUB_TOKEN', destToken);

if (!srcToken) { console.log('\n⚠ Source has no GITHUB_TOKEN — nothing to copy.'); process.exit(1); }

// Validate source token shape
if (srcToken.startsWith('github_pat_') && srcToken.length !== 93) {
  console.log(`\n⚠ Source token also looks malformed (length ${srcToken.length}, expected 93). Aborting.`);
  process.exit(1);
}
if (srcToken.startsWith('ghp_') && srcToken.length !== 40) {
  console.log(`\n⚠ Source classic PAT length is ${srcToken.length}, expected 40. Aborting.`);
  process.exit(1);
}

// Same value? Nothing to do.
if (srcToken === destToken) {
  console.log('\n✓ Source and dest tokens already match. No change needed.');
  process.exit(0);
}

// Backup, then replace the GITHUB_TOKEN line in DEST
const backup = DEST + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
copyFileSync(DEST, backup);
console.log(`\n✓ Backed up dest to ${backup}`);

const destText = readFileSync(DEST, 'utf8');
const newText = destText.replace(/^GITHUB_TOKEN=.*$/m, `GITHUB_TOKEN=${srcToken}`);
if (!newText.includes(`GITHUB_TOKEN=`)) {
  console.log('⚠ Could not locate GITHUB_TOKEN= line in dest to replace. Aborting.');
  process.exit(1);
}
if (newText === destText) {
  console.log('⚠ Replace produced identical text. Aborting.');
  process.exit(1);
}
writeFileSync(DEST, newText);
console.log(`✓ GITHUB_TOKEN replaced in ${DEST}`);

// Re-read and re-describe to confirm
const after = extractValue(DEST, 'GITHUB_TOKEN');
console.log(`\nAfter:`);
describe('  GITHUB_TOKEN', after);
console.log('\nNext: npx tsx --env-file=.env.local src/scripts/diagnose-github-token.ts');
