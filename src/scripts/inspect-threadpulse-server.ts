// Pull server.js from BALAJIapps/threadpulse and find the pg connection
// setup + the /auth/register handler so we can patch the SSL config.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

void (async () => {
  const t = process.env.GITHUB_TOKEN!;
  const r = await fetch('https://api.github.com/repos/BALAJIapps/threadpulse/contents/server.js', {
    headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json' },
  });
  const j = await r.json() as { content: string; sha: string };
  const code = Buffer.from(j.content, 'base64').toString();
  const lines = code.split('\n');

  console.log(`server.js sha=${j.sha} lines=${lines.length}\n`);

  // Block-scan for relevant sections
  let inPg = false, inRegister = false, inHealth = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const ln = (i + 1).toString().padStart(4);
    if (/new Pool|pg.Pool|require\('pg'\)|from 'pg'|connectionString/.test(l)) {
      console.log(`[PG L${ln}] ${l}`);
      inPg = true;
    } else if (inPg && /^\s*\}\)/.test(l)) {
      console.log(`[PG L${ln}] ${l}`);
      inPg = false;
    } else if (inPg) {
      console.log(`[PG L${ln}] ${l}`);
    }

    if (/auth\/register|app\.post.*register/.test(l)) {
      inRegister = true;
      console.log(`\n[REG L${ln}] ${l}`);
    } else if (inRegister && /^\s*\}\);?/.test(l) && l.length < 5) {
      console.log(`[REG L${ln}] ${l}`);
      inRegister = false;
    } else if (inRegister) {
      console.log(`[REG L${ln}] ${l}`);
    }

    if (/api\/health|app\.get.*health/.test(l)) {
      inHealth = true;
      console.log(`\n[HEALTH L${ln}] ${l}`);
    } else if (inHealth && /^\s*\}\);?/.test(l) && l.length < 5) {
      console.log(`[HEALTH L${ln}] ${l}`);
      inHealth = false;
    } else if (inHealth) {
      console.log(`[HEALTH L${ln}] ${l}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
