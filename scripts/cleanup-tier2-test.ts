import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { deleteWorkerScript, deleteWorkerRoute } from '@/lib/services/cf-deploy.service';

// Route ID from the deploy test
const ROUTE_ID = 'b46f4aad6da14b1d9c1219145fd69e1c';
const SCRIPT_NAME = 'baljia-app-pagegenie';

async function main() {
  console.log('1. Delete route', ROUTE_ID);
  const routeOk = await deleteWorkerRoute(ROUTE_ID);
  console.log('   result:', routeOk);

  console.log('2. Delete script', SCRIPT_NAME);
  const scriptOk = await deleteWorkerScript(SCRIPT_NAME);
  console.log('   result:', scriptOk);

  console.log('\n3. Wait 5s for propagation, verify landing restored');
  await new Promise(r => setTimeout(r, 5000));
  const res = await fetch(`https://pagegenie.baljia.app/?v=${Date.now()}`);
  const body = await res.text();
  console.log('   status:', res.status);
  console.log('   x-baljia-tier:', res.headers.get('x-baljia-tier'));
  console.log('   has "Get in Touch":', body.includes('Get in Touch'));
  console.log('   has "Tier 2 is LIVE":', body.includes('Tier 2 is LIVE'));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
