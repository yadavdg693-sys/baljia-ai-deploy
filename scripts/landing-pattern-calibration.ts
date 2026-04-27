// Calibration script: prints pattern-distribution + family-distribution
// across all 161 industries when each industry name is fed through
// resolveDesignTokens(). Used to verify the goal that no single pattern
// matches > 25% of industries after rebalance.
import { resolveDesignTokens } from '../src/lib/services/onboarding/shared/landing-design-tokens';
import { INDUSTRY_RULES } from '../src/lib/services/onboarding/shared/landing-design-corpus';
import { familyForPattern } from '../src/lib/services/onboarding/shared/landing';

const counts = new Map<string, number>();
const familyCounts = new Map<string, number>();

for (const r of INDUSTRY_RULES) {
  const signal = r.name + ' ' + r.keywords.join(' ');
  const t = resolveDesignTokens({ industry: signal });
  counts.set(t.matchedPattern, (counts.get(t.matchedPattern) ?? 0) + 1);
  const fam = familyForPattern(t.matchedPattern);
  familyCounts.set(fam, (familyCounts.get(fam) ?? 0) + 1);
}

const N = INDUSTRY_RULES.length;
console.log('TOTAL INDUSTRIES:', N);
console.log('--- PATTERN DISTRIBUTION ---');
[...counts.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => {
    const pct = ((v / N) * 100).toFixed(1);
    console.log(`${pct.padStart(5)}%  ${k}  (${v})`);
  });
const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
console.log(`\nDOMINANT PATTERN: "${top[0]}" at ${((top[1] / N) * 100).toFixed(1)}%`);

console.log('\n--- FAMILY DISTRIBUTION ---');
[...familyCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => {
    const pct = ((v / N) * 100).toFixed(1);
    console.log(`${pct.padStart(5)}%  ${k}  (${v})`);
  });
