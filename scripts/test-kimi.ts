// Quick test: Kimi K2.6 via OpenRouter
async function main() {
  const token = process.env.OPENROUTER_API_KEY;
  if (!token) { console.log('❌ OPENROUTER_API_KEY not set'); process.exit(1); }
  console.log(`Token prefix: ${token.slice(0, 10)}...`);

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'moonshotai/kimi-k2.6',
      messages: [{ role: 'user', content: 'Reply with exactly: Kimi K2.6 online.' }],
      max_tokens: 20,
    }),
  });
  const body = await res.json() as Record<string, unknown>;
  console.log(`HTTP: ${res.status}`);
  console.log(JSON.stringify(body, null, 2).slice(0, 500));
}
main().catch((e) => { console.error(e); process.exit(1); });
