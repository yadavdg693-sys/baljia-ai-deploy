import { db, companies } from '@/lib/db';
import { sql } from 'drizzle-orm';

void (async () => {
  const cs = await db.select({ count: sql<number>`count(*)::int` }).from(companies);
  console.log(`Platform DB companies:    ${cs[0].count}`);

  if (process.env.RENDER_API_KEY) {
    const r = await fetch('https://api.render.com/v1/services?limit=50', {
      headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: 'application/json' },
    });
    const services = await r.json() as Array<{ service: { id: string; name: string; type: string } }>;
    console.log(`Render services:          ${services.length}`);
    for (const s of services) console.log(`  - ${s.service.name} (${s.service.type}, ${s.service.id})`);
  }

  if (process.env.GITHUB_TOKEN && process.env.GITHUB_ORG) {
    const r = await fetch(`https://api.github.com/orgs/${process.env.GITHUB_ORG}/repos?per_page=20`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'baljia' },
    });
    if (r.ok) {
      const repos = await r.json() as Array<{ name: string; full_name: string }>;
      console.log(`GitHub repos in ${process.env.GITHUB_ORG}: ${repos.length}`);
      for (const repo of repos) console.log(`  - ${repo.name}`);
    }
  }

  if (process.env.NEON_API_KEY) {
    const r = await fetch('https://console.neon.tech/api/v2/projects?limit=50', {
      headers: { Authorization: `Bearer ${process.env.NEON_API_KEY}`, Accept: 'application/json' },
    });
    if (r.ok) {
      const data = await r.json() as { projects: Array<{ id: string; name: string }> };
      console.log(`Neon projects:            ${data.projects.length}`);
      for (const p of data.projects) console.log(`  - ${p.name} (${p.id})`);
    }
  }
  process.exit(0);
})();
