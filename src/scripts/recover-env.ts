// Recover scrambled .env.local — v3: also splits on embedded
// `[A-Z][A-Z0-9_]{2,}=` patterns inside what looks like one value.

import { readFileSync, writeFileSync } from 'fs';

const raw = readFileSync('.env.local', 'utf8');
const text = raw.replace(/^﻿/, '');

// Pass 1: find all KEY= positions, even those without word boundary in front.
// We use a non-anchored regex; later we'll de-duplicate keys.
const keyRegex = /([A-Z][A-Z0-9_]{2,})=/g;
const matches: { key: string; start: number; end: number }[] = [];
let m: RegExpExecArray | null;
while ((m = keyRegex.exec(text)) !== null) {
  matches.push({ key: m[1], start: m.index, end: m.index + m[0].length });
}

// Filter out spurious matches: drop keys that look like ALL-CAPS suffixes of
// real words (e.g. "passwordSTRIPE_KEY" — the SUFFIX part is what we want
// since it's a real env key, not the longer one). We keep ALL matches and
// rely on dedup to surface the right values.
console.log(`Found ${matches.length} raw KEY= positions`);

// Build chunks between matches
const recovered: { key: string; value: string }[] = [];
const validValueChar = /[A-Za-z0-9_\-:/.@?=&%+,*~!$()'\[\]\s]/; // exclude `#` (comment marker)

for (let i = 0; i < matches.length; i++) {
  const cur = matches[i];
  const nextStart = matches[i + 1]?.start ?? text.length;
  let chunk = text.slice(cur.end, nextStart);

  // Drop any chunk that is part of a wider key prefix
  // (e.g. cur=KEY at position N, but text[N-1] is a letter, so this is a
  // false match like the "URL" in NEXT_PUBLIC_APP_URL — but since
  // NEXT_PUBLIC_APP_URL is itself in our match list, this is fine).
  // We don't filter here; dedup at the end.

  let value = '';
  let started = false;
  for (const ch of chunk) {
    if (validValueChar.test(ch)) {
      value += ch;
      started = true;
    } else if (started) {
      break;
    }
  }
  value = value.replace(/\s+#.*$/, '').trim();
  recovered.push({ key: cur.key, value });
}

// Dedup: when a key appears multiple times (e.g. one as a real key, one as a
// suffix-matched false positive), keep the value that's NOT a substring of
// another, longer key+value pair. Heuristic: prefer the FIRST occurrence
// since the real KEY= comes before its mojibake-buried twin.
const byKey = new Map<string, string>();
for (const r of recovered) {
  if (r.value && !byKey.has(r.key)) byKey.set(r.key, r.value);
}

// Drop keys whose name is a strict suffix of another key in the set.
// e.g. URL is a suffix of NEXT_PUBLIC_APP_URL — keep the longer one.
const keep = new Set(byKey.keys());
for (const a of byKey.keys()) {
  for (const b of byKey.keys()) {
    if (a !== b && b.endsWith(a) && b.length > a.length) {
      // a is a suffix of b — a is likely a false-positive
      // BUT only drop if b's value contains a's value
      keep.delete(a);
    }
  }
}

console.log(`\nPre-clean: ${byKey.size} keys; after suffix-filter: ${keep.size} keys.\n`);

// For each remaining key, scan the value for an embedded "[A-Z][A-Z0-9_]{2,}="
// pattern that signals a missed boundary. If found, split: the part before
// the embedded key is the real value of the current key; the embedded key
// gets added with its own value.
const finalPairs = new Map<string, string>();
const embeddedKey = /([A-Z][A-Z0-9_]{2,})=/;

for (const k of keep) {
  let v = byKey.get(k)!;
  const embedMatch = v.match(embeddedKey);
  if (embedMatch && embedMatch.index! > 0) {
    // Split — the value of k ends at embedMatch.index, the rest is a new key+value
    const realValue = v.substring(0, embedMatch.index!).trim();
    const embeddedKeyName = embedMatch[1];
    const afterEmbed = v.substring(embedMatch.index! + embedMatch[0].length).trim();
    // The afterEmbed may itself contain another embedded key — recurse later
    finalPairs.set(k, realValue);
    if (!finalPairs.has(embeddedKeyName)) {
      finalPairs.set(embeddedKeyName, afterEmbed);
    }
  } else {
    finalPairs.set(k, v);
  }
}

// Second pass: any value still containing an embedded key gets split too
let pass = 0;
while (pass < 5) {
  pass++;
  let changed = false;
  for (const [k, v] of Array.from(finalPairs.entries())) {
    const embedMatch = v.match(embeddedKey);
    if (embedMatch && embedMatch.index! > 0) {
      const realValue = v.substring(0, embedMatch.index!).trim();
      const embKey = embedMatch[1];
      const afterEmbed = v.substring(embedMatch.index! + embedMatch[0].length).trim();
      finalPairs.set(k, realValue);
      if (!finalPairs.has(embKey)) finalPairs.set(embKey, afterEmbed);
      changed = true;
    }
  }
  if (!changed) break;
}

// Drop empties
for (const [k, v] of Array.from(finalPairs.entries())) {
  if (!v) finalPairs.delete(k);
}

console.log(`Final: ${finalPairs.size} keys after embed-split.\n`);
const sorted = Array.from(finalPairs.keys()).sort();
for (const k of sorted) {
  const v = finalPairs.get(k)!;
  const masked = v.length > 70
    ? v.substring(0, 30) + '…' + v.substring(v.length - 12)
    : v;
  console.log(`  ${k}=${masked}`);
}

const out = ['# Recovered from corrupted .env.local on 2026-05-07', '# REVIEW BEFORE RENAMING TO .env.local', ''];
for (const k of sorted) out.push(`${k}=${finalPairs.get(k)}`);
writeFileSync('.env.local.recovered', out.join('\n') + '\n', { encoding: 'utf8' });
console.log('\nWrote .env.local.recovered');
