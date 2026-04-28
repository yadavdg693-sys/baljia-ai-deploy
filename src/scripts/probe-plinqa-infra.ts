// What infra is plinqa connected to? GitHub, Neon, Render?
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';

async function main() {
  const [c] = await db.select({
    id: companies.id, name: companies.name, slug: companies.slug,
    github_repo: companies.github_repo,
    neon_connection_string: companies.neon_connection_string,
    render_service_id: companies.render_service_id,
    custom_domain: companies.custom_domain,
  }).from(companies).where(eq(companies.slug, 'plinqa')).limit(1);

  console.log('plinqa state:');
  console.log('  github_repo:           ', c?.github_repo ?? '(none)');
  console.log('  neon (provisioned):    ', c?.neon_connection_string ? 'YES' : 'NO');
  console.log('  render_service_id:     ', c?.render_service_id ?? '(none)');
  console.log('  custom_domain:         ', c?.custom_domain ?? '(none — using slug.baljia.app)');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
