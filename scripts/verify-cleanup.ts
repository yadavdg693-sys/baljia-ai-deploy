import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { neon } from '@neondatabase/serverless';

const SLUGS = ['bookmint', 'pagegenie', 'amendly'];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);

  const remaining = (await sql`
    SELECT id, slug, name FROM companies WHERE slug = ANY(${SLUGS})
  `) as Array<{ id: string; slug: string; name: string }>;

  if (remaining.length === 0) {
    console.log('✅ All 3 test companies deleted.');
  } else {
    console.log('❌ Still present:');
    for (const c of remaining) console.log(`  ${c.slug} ${c.id} (${c.name})`);
  }

  // Also show total companies
  const [{ count }] = (await sql`SELECT COUNT(*)::int AS count FROM companies`) as Array<{ count: number }>;
  console.log(`Total companies remaining: ${count}`);

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
