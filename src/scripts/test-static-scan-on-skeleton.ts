// Run the static scan against the actual skeleton + against claimroof's
// current server.js to verify (a) skeleton passes cleanly and (b) the
// new health-without-db-probe regex doesn't false-positive.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { scanFile, summarizeFindings } from '@/lib/services/static-code-scan';

void (async () => {
  const skeletonPath = resolve(process.cwd(), 'skeletons/express-render/server.js');
  const skeletonContent = readFileSync(skeletonPath, 'utf8');
  const skeletonFindings = scanFile({ path: 'server.js', content: skeletonContent });
  console.log('━━━ Skeleton (skeletons/express-render/server.js) ━━━');
  console.log(summarizeFindings(skeletonFindings));

  if (process.env.GITHUB_TOKEN) {
    console.log('\n━━━ claimroof live server.js ━━━');
    const r = await fetch('https://api.github.com/repos/BALAJIapps/claimroof/contents/server.js', {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'baljia' },
    });
    const data = await r.json() as { content: string; encoding: string };
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    const claimroofFindings = scanFile({ path: 'server.js', content });
    console.log(summarizeFindings(claimroofFindings));
  }
  process.exit(0);
})();
