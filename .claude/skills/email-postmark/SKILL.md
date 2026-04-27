# Skill: Email via Postmark

**READ THIS BEFORE adding email send, transactional notifications, or inbound email handling.**

## The setup is already done

`baljia.app` is domain-verified at Postmark with DKIM + Return-Path. **Any `<anything>@baljia.app` sender works** — no per-address signature.

The platform calls Postmark via `src/lib/services/email.service.ts:sendEmail()`. Founder apps that need to send mail call Postmark directly.

## Pattern 1 — Founder app sends transactional email

Pass the API token via `additional_secrets` on `cf_deploy_app`:

```
cf_deploy_app({
  slug: 'foundercorp',
  script_content: '...',
  additional_secrets: { POSTMARK_KEY: 'server-token-abc...' },
})
```

In the Worker:

```js
async function sendEmail(env, { to, subject, textBody, htmlBody }) {
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': env.POSTMARK_KEY,
    },
    body: JSON.stringify({
      From: `${env.COMPANY_SUBDOMAIN}@baljia.app`,  // sends from the founder's company address
      To: to,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
      ReplyTo: `${env.COMPANY_SUBDOMAIN}@baljia.app`,
      MessageStream: 'outbound',
      Tag: 'app-transactional',
      TrackOpens: false,
      TrackLinks: 'None',
    }),
  });

  const result = await res.json();
  if (!res.ok || result.ErrorCode !== 0) {
    throw new Error(`Postmark error ${result.ErrorCode}: ${result.Message}`);
  }
  return result.MessageID;
}
```

## Pattern 2 — Platform sends on behalf of founder

If the founder app posts back to the platform (`env.PLATFORM_API_BASE`) and lets the platform send via its own Postmark token, you avoid putting the token in the Worker. Useful when:
- The same email goes to multiple recipients with different templates (template logic stays platform-side)
- You want unified send tracking across all founder companies
- The founder hasn't given you a dedicated Postmark account

The Worker hits a platform endpoint; the platform calls `email.service.ts:sendEmail()` with the right `companyId` so the email shows up in the dashboard's email panel.

## Inbound email — current state of the architecture

Inbound to `<slug>@baljia.app` has TWO possible paths. Operator picks one:

| Path | What happens | Where to wire |
|---|---|---|
| **Cloudflare Email Routing** (current default) | Mail forwarded to founder's personal email. Platform sees nothing. | `provisionCompanyEmail()` in `company-email.service.ts` — creates a CF rule that forwards |
| **Postmark Inbound Stream** (recommended for Support agent) | Mail POSTed to `/api/webhooks/email` → written to `email_threads` table → forwarded to founder's personal email | Operator-side: set MX records on `baljia.app` to Postmark, configure Inbound Stream → webhook URL → Basic auth via `POSTMARK_WEBHOOK_SECRET` |

If the founder's app needs to read incoming mail, you NEED Path B. The Support agent's `get_inbox` reads `email_threads` and that table is only populated when Path B is wired.

## HTML vs text — send both

Always include both. Many email clients (Gmail mobile, Outlook web) prefer HTML; some corporate filters prefer text-only.

```
TextBody: 'Click here to confirm: https://...',
HtmlBody: '<p>Click here to confirm: <a href="https://...">Confirm</a></p>',
```

Plaintext-only emails get penalized in spam scores; HTML-only emails sometimes show as "(no content)" in plaintext clients.

## Common requirements

### Verification email

```js
const code = crypto.randomUUID().slice(0, 6).toUpperCase();
await db.insert(verifications).values({ email, code, expires_at: new Date(Date.now() + 15 * 60 * 1000) });
await sendEmail(env, {
  to: email,
  subject: 'Your verification code',
  textBody: `Your code is ${code}. It expires in 15 minutes.`,
  htmlBody: `<p>Your code is <strong>${code}</strong>. It expires in 15 minutes.</p>`,
});
```

### Password reset

Send a SHORT-LIVED token in the URL, not in the email body. Token in DB has `expires_at` ≤ 30 min.

```
htmlBody: `<a href="https://${env.COMPANY_SUBDOMAIN}.baljia.app/reset?token=${token}">Reset password</a>`,
```

### Notification with unsubscribe

CAN-SPAM requires unsubscribe on transactional + marketing email:

```
htmlBody: `${body}<hr><p style="font-size:11px;color:#888"><a href="https://${env.COMPANY_SUBDOMAIN}.baljia.app/unsubscribe?email=${encodeURIComponent(to)}&token=${unsubToken}">Unsubscribe</a></p>`,
```

Plus a plaintext footer with the unsubscribe URL. The platform's webhook auto-detects "unsubscribe"/"opt out"/"stop emailing" in inbound replies and marks contacts as unsubscribed.

## Tags + tracking

Always pass a `Tag` so Postmark dashboard groups emails:

```
Tag: 'verification' | 'password-reset' | 'transactional' | 'marketing' | 'notification'
```

`TrackOpens: false` is the safe default — open tracking adds a 1×1 pixel that some users find creepy and some clients (Apple Mail Privacy Protection) load it pre-emptively which corrupts your "did they read it" metric anyway.

## Rate limits + cost

- Postmark: $1.25 per 1,000 emails on the basic plan
- Soft rate limit: ~25 messages/sec from a single token. For burst sends, use Postmark's batch endpoint (`/email/batch`) which accepts up to 500 messages per request.
- Hard rate limit: account-level varies; Postmark throttles aggressive senders to protect deliverability.

## Don't do these

- ❌ **`From: noreply@baljia.app`** — replies go to a black hole. Use the company subdomain (`<slug>@baljia.app`) so replies thread back via the inbound webhook.
- ❌ **HTML with `<style>` tags but no inline styles** — Gmail strips `<style>` blocks. Inline critical styles (or use a tool like Maizzle / `juice` if you really need a complex template).
- ❌ **Embedding images via `<img src="data:image/png;base64,...">`** — Gmail rejects base64 images. Host them on R2 and use `<img src="https://<slug>.baljia.app/files/...">`.
- ❌ **Sending from your personal address** — kills your domain reputation. Always send from `<slug>@baljia.app`.
- ❌ **Forgetting `MessageStream: 'outbound'`** — messages without it fail with a confusing "stream not found" error.

## Verification

After adding email features:

1. Send a test message to a real address (Postmark test mode also exists — see their docs)
2. Confirm it arrives + the From / ReplyTo / Subject look right
3. Reply to the test message — confirm the inbound flow works (if you set up Postmark Inbound)
4. Check the Postmark Activity dashboard for "Delivered" status (not "Sent" — Sent means handed to the SMTP layer; Delivered means the recipient server accepted)
5. Run a real spam check: https://www.mail-tester.com — paste the address, send a test, score should be 9+/10

An email task is NOT done because "the API call returned 200." It's done when the email landed in an inbox + replies thread back correctly.
