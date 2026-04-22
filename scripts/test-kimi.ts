// Quick test: Kimi K2.6 via Moonshot AI's direct API (OpenAI-compatible)
async function main() {
  const token = process.env.MOONSHOT_API_KEY;
  const base = process.env.MOONSHOT_API_BASE ?? 'https://api.moonshot.ai/v1';
  if (!token || token === 'placeholder') { console.log('❌ MOONSHOT_API_KEY not set'); process.exit(1); }
  console.log(`Token prefix: ${token.slice(0, 10)}...`);
  console.log(`Base: ${base}`);
  console.log(`Model: kimi-k2.6`);

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'kimi-k2.6',
      messages: [
        { role: 'user', content: 'Reply with exactly one sentence: what model are you and what version?' },
      ],
      max_tokens: 60,
    }),
  });
  const body = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; code?: string };
    usage?: { total_tokens?: number };
  };
  console.log(`HTTP: ${res.status}`);
  if (body.error) {
    console.log(`❌ Error: ${body.error.message} (${body.error.code ?? ''})`);
    process.exit(2);
  }
  console.log(`Response: ${body.choices?.[0]?.message?.content ?? '(no content)'}`);
  console.log(`Tokens used: ${body.usage?.total_tokens ?? 'unknown'}`);
  console.log('✅ Kimi K2.6 working');
}
main().catch((e) => { console.error(e); process.exit(1); });
