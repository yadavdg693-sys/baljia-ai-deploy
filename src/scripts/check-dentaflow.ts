import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
void (async () => {
  const [c] = await db.select().from(companies).where(eq(companies.slug, 'dentaflow')).limit(1);
  if (!c) { console.log('Not found'); process.exit(0); }
  console.log(JSON.stringify({
    slug: c.slug,
    subdomain: c.subdomain,
    custom_domain: c.custom_domain,
    render_service_id: c.render_service_id,
    github_repo: c.github_repo,
    name: c.name,
  }, null, 2));
  process.exit(0);
})();
