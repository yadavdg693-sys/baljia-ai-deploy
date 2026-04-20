// Quick script: sign a JWT for the smoke-test user, hit /dashboard/{id}, print response
import { signJWT } from '@/lib/auth';
import { db, users, companies } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';

async function main() {
  const [user] = await db.select({ id: users.id }).from(users)
    .where(eq(users.email, 'smoke-test@baljia.app')).limit(1);
  if (!user) throw new Error('smoke user missing');

  const [company] = await db.select({ id: companies.id, name: companies.name, slug: companies.slug })
    .from(companies)
    .where(and(eq(companies.owner_id, user.id), eq(companies.onboarding_status, 'completed')))
    .orderBy(desc(companies.created_at))
    .limit(1);
  if (!company) throw new Error('no completed smoke company');

  const token = await signJWT(user.id);
  const port = process.argv[2] ?? '3003';
  const url = `http://localhost:${port}/dashboard/${company.id}`;
  console.log('Hitting:', url);
  console.log('Company:', company.name, '(', company.slug, ')');

  const res = await fetch(url, {
    headers: { Cookie: `baljia-session=${token}` },
    redirect: 'manual',
  });
  console.log('HTTP:', res.status, res.statusText);
  console.log('Location:', res.headers.get('location') ?? '(none)');

  const body = await res.text();
  console.log('Body length:', body.length);
  console.log('First 400 chars:');
  console.log(body.slice(0, 400));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
