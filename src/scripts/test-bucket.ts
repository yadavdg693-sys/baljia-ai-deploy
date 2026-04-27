// Sanity check: load business-ideas bucket, apply same filter as invent-idea.ts,
// and show stats + a 5-item sample so we can eyeball quality.
import bucketRaw from '../../data/business-ideas-bucket.json';

interface E {
  idea_id: string; category: string; target_user: string;
  source_text: string; opportunity_score: number;
  evidence_strength: 'high' | 'medium' | 'low';
}

const all = bucketRaw as E[];
const eligible = all.filter(
  (e) =>
    typeof e.opportunity_score === 'number' &&
    e.opportunity_score >= 40 &&
    (e.evidence_strength === 'high' || e.evidence_strength === 'medium') &&
    e.source_text && e.target_user && e.category,
);

console.log(`Total ideas:      ${all.length}`);
console.log(`Eligible (≥40, h/m): ${eligible.length}`);

const byCat: Record<string, number> = {};
for (const e of eligible) byCat[e.category] = (byCat[e.category] ?? 0) + 1;
console.log('\nTop categories:');
Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([c, n]) =>
  console.log(`  ${n.toString().padStart(3)}  ${c}`),
);

console.log('\nSample of 5 eligible entries:');
for (let i = 0; i < 5; i++) {
  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  const text = pick.source_text.replace(/\s+/g, ' ').trim().slice(0, 200);
  console.log(`  [${pick.category}] target: ${pick.target_user} — ${text}`);
}
