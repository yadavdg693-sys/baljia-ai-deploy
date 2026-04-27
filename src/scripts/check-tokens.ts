import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
import { db, magicLinkTokens } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import crypto from 'node:crypto';

async function main() {
  const tokens = await db.select().from(magicLinkTokens).orderBy(desc(magicLinkTokens.created_at)).limit(5);
  console.log("Last 5 tokens in DB:");
  tokens.forEach(t => {
    console.log(`- Token hash: ${t.token}, Used At: ${t.used_at}, Expires: ${t.expires_at}`);
  });
  
  // Hash the test token I just generated
  const testToken = 'hpaTD7pWnNHU0f2uBAFCv1XTu6BjZcA82SLh6lUIHSs';
  const expectedHash = crypto.createHash('sha256').update(testToken).digest('hex');
  console.log(`\nExpected Hash for test token: ${expectedHash}`);
  
  process.exit(0);
}
main();
