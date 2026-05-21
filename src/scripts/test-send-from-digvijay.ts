// One-off Postmark smoke test: send from Digvijay.yadav@baljia.ai → yadavdg3@gmail.com
async function main() {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) { console.error('POSTMARK_SERVER_TOKEN missing'); process.exit(1); }

  const r = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify({
      From: 'Digvijay Yadav <Digvijay.yadav@baljia.ai>',
      To: 'yadavdg3@gmail.com',
      Subject: 'Baljia AI — Postmark smoke test from Digvijay.yadav@baljia.ai',
      TextBody: `This is a deliverability test sent at ${new Date().toISOString()}.

If you receive this, the following are confirmed live:
  - POSTMARK_SERVER_TOKEN is valid
  - baljia.ai DKIM is signed by Postmark
  - Digvijay.yadav@baljia.ai is sendable via Postmark

Check Gmail's "show original" → should show DKIM=PASS for baljia.ai.

— Baljia AI smoke test`,
      MessageStream: 'outbound',
      TrackOpens: false,
      TrackLinks: 'None',
    }),
  });

  const body = await r.json();
  console.log('HTTP', r.status);
  console.log(JSON.stringify(body, null, 2));
  process.exit(r.ok && body.ErrorCode === 0 ? 0 : 1);
}

main();
