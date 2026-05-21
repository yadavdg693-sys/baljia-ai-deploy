# Skill: Email via Postmark

**READ THIS BEFORE adding email send, transactional notifications, or inbound email handling.**

Founder engineering apps run on Render. Use Postmark over HTTPS for transactional email. Keep email simple, observable, and easy to test.

## Platform context

`baljia.app` is domain-verified at Postmark with DKIM and Return-Path. Sender addresses like `<company-slug>@baljia.app` are valid when using the platform Postmark account.

For founder apps, prefer one of two paths:

- App sends directly with a Postmark token stored in Render env vars.
- App calls the Baljia platform API and lets the platform send on behalf of the company.

## Direct send from Render

Required env vars:

- `POSTMARK_SERVER_TOKEN`
- `FROM_EMAIL`

```js
async function sendEmail({ to, subject, textBody, htmlBody }) {
  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN,
    },
    body: JSON.stringify({
      From: process.env.FROM_EMAIL,
      To: to,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
      MessageStream: 'outbound',
      TrackOpens: false,
      TrackLinks: 'None',
    }),
  });

  const result = await response.json();
  if (!response.ok || result.ErrorCode !== 0) {
    throw new Error(`Postmark error ${result.ErrorCode}: ${result.Message}`);
  }
  return result.MessageID;
}
```

## Platform send path

Use this when:

- The email should appear in the Baljia dashboard history.
- You want one shared send policy and sender identity.
- The founder app should not hold a Postmark token.

The app posts to the platform endpoint with company context; the platform calls its email service and records the message.

## Inbound email

Inbound email is not automatically available to founder apps. If the task requires reading replies or support mail, the platform must route inbound Postmark messages into `email_threads` first.

## Content rules

- Send both text and HTML.
- Keep transactional emails short.
- Include the company name and a clear reply path.
- Do not fake delivery success; show a retryable error if Postmark fails.

## Verification

An email task is done when:

1. The deployed route or action triggers an email send.
2. Postmark returns a successful response.
3. Failure states are visible in the app or logs.
4. The task report names the sender, recipient used for testing, and any env vars required.
