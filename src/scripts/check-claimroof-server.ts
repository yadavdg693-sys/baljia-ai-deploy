void (async () => {
  const r = await fetch('https://api.github.com/repos/BALAJIapps/claimroof/contents/server.js', {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'baljia' },
  });
  const data = await r.json() as { content: string; encoding: string };
  const content = Buffer.from(data.content, 'base64').toString('utf8');

  const checks = {
    hasHelmet:        /require\(['"]helmet['"]\)/.test(content) && /app\.use\(\s*helmet/.test(content),
    hasRateLimit:     /express-rate-limit/.test(content),
    hasTrustProxy:    /app\.set\(['"]trust proxy['"]/.test(content),
    hasSession:       /express-session/.test(content),
    hasZodValidation: /CONFIG_SCHEMA|z\.object/.test(content),
    hasBodyLimit:     /express\.json\s*\(\s*\{[^}]*limit/.test(content),
    hasHealthDbProbe: /\/api\/health[\s\S]+?(pool\.query|SELECT)/.test(content),
    lineCount:        content.split('\n').length,
    sizeBytes:        content.length,
  };
  console.log(JSON.stringify(checks, null, 2));
  process.exit(0);
})();
