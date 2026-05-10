import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';

void (async () => {
  const [c] = await db.select().from(companies).where(eq(companies.slug, 'claimroof')).limit(1);
  console.log('Company:', JSON.stringify({
    id: c.id, slug: c.slug, lifecycle: c.lifecycle,
    github_repo: c.github_repo, render_service_id: c.render_service_id,
    neon_database_id: c.neon_database_id,
  }, null, 2));

  if (!c.github_repo || !process.env.GITHUB_TOKEN) {
    console.log('No repo or no token — skipping repo check');
    process.exit(0);
  }
  const r = await fetch(`https://api.github.com/repos/${c.github_repo}/contents`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'baljia' },
  });
  if (!r.ok) {
    console.log(`GitHub API: HTTP ${r.status} (repo may be empty or unreachable)`);
    process.exit(0);
  }
  const files = await r.json() as Array<{ name: string; type: string; size: number }>;
  console.log(`\nRepo contents (${files.length} entries):`);
  for (const f of files) console.log(`  ${f.type === 'dir' ? 'd' : '-'} ${f.name} (${f.size ?? '-'})`);
  process.exit(0);
})();
