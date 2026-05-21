import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '.claude/skills/design-systems';

interface Entry {
  name: string;
  category: string;
  tagline: string;
  bytes: number;
}

function extractMeta(designPath: string): { category: string; tagline: string } {
  const text = readFileSync(designPath, 'utf8');
  const lines = text.split(/\r?\n/);
  let category = '';
  let tagline = '';
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    const l = lines[i].trim();
    const catMatch = l.match(/^>\s*Category:\s*(.+)$/i);
    if (catMatch) {
      category = catMatch[1].trim();
      // Tagline is usually the next blockquote line after Category
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const next = lines[j].trim();
        const tagMatch = next.match(/^>\s*(.+)$/);
        if (tagMatch && !/^Category:/i.test(tagMatch[1])) {
          tagline = tagMatch[1].trim();
          break;
        }
      }
      break;
    }
  }
  return { category, tagline };
}

const dirs = readdirSync(ROOT).filter((d) => {
  const p = join(ROOT, d);
  return statSync(p).isDirectory() && d !== '_schema';
});

const entries: Entry[] = [];
const missing: string[] = [];

for (const d of dirs.sort()) {
  const designPath = join(ROOT, d, 'DESIGN.md');
  try {
    const stat = statSync(designPath);
    if (stat.size < 1000) {
      missing.push(d);
      continue;
    }
    const { category, tagline } = extractMeta(designPath);
    entries.push({ name: d, category: category || 'Uncategorized', tagline, bytes: stat.size });
  } catch {
    missing.push(d);
  }
}

// Group by category
const byCategory: Record<string, Entry[]> = {};
for (const e of entries) {
  (byCategory[e.category] ??= []).push(e);
}

// Emit INDEX.md
const out: string[] = [
  '# Design Systems Catalog — INDEX',
  '',
  `${entries.length} design-language references vendored from [nexu-io/open-design](https://github.com/nexu-io/open-design) (Apache-2.0).`,
  '',
  'To load any system: `get_design_system(name)` — pass the kebab-case name shown below.',
  'To pick the right one for a founder app: match on category + tagline (closest vibe wins).',
  '',
  '---',
  '',
];

for (const cat of Object.keys(byCategory).sort()) {
  out.push(`## ${cat}`);
  out.push('');
  for (const e of byCategory[cat].sort((a, b) => a.name.localeCompare(b.name))) {
    const tag = e.tagline ? ` — ${e.tagline}` : '';
    out.push(`- **\`${e.name}\`**${tag}`);
  }
  out.push('');
}

if (missing.length) {
  out.push('## Skipped (no DESIGN.md or too small)');
  out.push('');
  for (const m of missing) out.push(`- ${m}`);
  out.push('');
}

writeFileSync(join(ROOT, 'INDEX.md'), out.join('\n'));
console.log(`Wrote INDEX.md: ${entries.length} systems across ${Object.keys(byCategory).length} categories`);
if (missing.length) console.log(`Skipped ${missing.length}: ${missing.join(', ')}`);
