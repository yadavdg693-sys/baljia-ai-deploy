# event-tracking

Lightweight product analytics — capture user actions to a Postgres `events`
table and query them for funnels, retention, and dashboards. Read this skill
BEFORE adding any "track when user does X" feature. No external SaaS required
(no Mixpanel, no Amplitude, no Segment).

Agents that skip this skill consistently:
1. Reach for Mixpanel / Posthog SDKs (extra cost, extra creds, extra latency)
2. Block the response while writing the event row (slows every page)
3. Use a wide column-per-property schema that breaks on every new event type
4. Forget to add an index on `(name, created_at)` — every analytics query timeouts

---

## The Schema — one table, JSONB properties

```sql
-- migrations/0001_events.sql
CREATE TABLE IF NOT EXISTS events (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL,                              -- e.g. 'signup_completed'
  user_id      uuid,                                       -- nullable for anon
  session_id   text,                                       -- client-generated, persists across pageviews
  properties   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- These three indexes cover ~95% of analytics queries
CREATE INDEX IF NOT EXISTS events_name_created_idx ON events (name, created_at DESC);
CREATE INDEX IF NOT EXISTS events_user_created_idx ON events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_props_gin_idx   ON events USING GIN (properties);
```

**Why this shape:**
- `name` is a string, not an enum — frictionless to add new event types
- `properties` is JSONB — any per-event payload, queryable via `->`/`->>`
- Three indexes cover lookups by event type, by user, and by arbitrary property
- No `updated_at` — events are immutable; never UPDATE them

---

## The Client — one helper, fire-and-forget

```ts
// lib/events.ts
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

type TrackInput = {
  name: string;
  userId?: string | null;
  sessionId?: string | null;
  properties?: Record<string, unknown>;
};

/**
 * Fire-and-forget event tracking. NEVER await this in a request path —
 * use `void track(...)` so the response isn't blocked.
 */
export function track(input: TrackInput): void {
  void writeEvent(input).catch((err) => {
    // NEVER throw from analytics. Log + drop.
    console.error('[events] track failed', { name: input.name, err });
  });
}

async function writeEvent(input: TrackInput): Promise<void> {
  const props = JSON.stringify(input.properties ?? {});
  await db.execute(sql`
    INSERT INTO events (name, user_id, session_id, properties)
    VALUES (${input.name}, ${input.userId ?? null}, ${input.sessionId ?? null}, ${props}::jsonb)
  `);
}
```

### Naming convention — `noun_verbed`

| ✅ Good | ❌ Bad |
|---|---|
| `signup_completed` | `signup` |
| `checkout_started` | `start_checkout` |
| `invoice_paid` | `paymentSuccess` |
| `dashboard_viewed` | `view-dashboard` |

Past-tense verb after the noun. Always snake_case. Stable across the codebase.

---

## Server-side tracking (preferred)

Track from the server whenever the action is server-confirmed. More reliable
than client-side (no ad-blockers, no network failures, no spoofing).

```ts
// In any route handler — fire-and-forget
import { track } from '@/lib/events';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  const user = await createUser(email, password);

  track({
    name: 'signup_completed',
    userId: user.id,
    properties: { plan: 'trial', source: 'organic' },
  });

  return NextResponse.json({ user });
}
```

---

## Client-side tracking (for UI-only events)

For things the server doesn't see — page views, button clicks, scroll depth —
post to a thin endpoint.

### Endpoint

```ts
// src/app/api/events/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { track } from '@/lib/events';
import { getSession } from '@/lib/auth';

const Body = z.object({
  name: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(100).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const session = await getSession(req);
  track({
    name: parsed.data.name,
    userId: session?.userId ?? null,
    sessionId: parsed.data.sessionId,
    properties: parsed.data.properties,
  });
  return NextResponse.json({ ok: true });
}
```

### Client helper

```ts
// lib/track-client.ts  (mark the importing file with 'use client')
function getSessionId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  let sid = localStorage.getItem('sid');
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem('sid', sid);
  }
  return sid;
}

export function trackClient(name: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;  // no-op during SSR
  const body = JSON.stringify({ name, sessionId: getSessionId(), properties });

  // Use sendBeacon when available — survives page unload (great for clicks → navigate)
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
    return;
  }
  fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}
```

---

## Querying events — common patterns

### Daily active users

```sql
SELECT DATE(created_at) AS day, COUNT(DISTINCT user_id) AS dau
FROM events
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND user_id IS NOT NULL
GROUP BY 1 ORDER BY 1;
```

### Funnel: signup → checkout → paid

```sql
WITH steps AS (
  SELECT user_id,
    MIN(CASE WHEN name = 'signup_completed'  THEN created_at END) AS s1,
    MIN(CASE WHEN name = 'checkout_started'  THEN created_at END) AS s2,
    MIN(CASE WHEN name = 'invoice_paid'      THEN created_at END) AS s3
  FROM events
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY user_id
)
SELECT
  COUNT(*)                              FILTER (WHERE s1 IS NOT NULL) AS signed_up,
  COUNT(*) FILTER (WHERE s2 >= s1)                                   AS checked_out,
  COUNT(*) FILTER (WHERE s3 >= s2 AND s2 >= s1)                      AS paid
FROM steps;
```

### Filter by JSONB property

```sql
-- Signups by source
SELECT properties->>'source' AS source, COUNT(*)
FROM events
WHERE name = 'signup_completed'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1 ORDER BY 2 DESC;
```

The `events_props_gin_idx` makes these property queries fast even at millions of rows.

---

## Retention — keep volume bounded

Events grow unboundedly. Add a retention policy:

```sql
-- Run nightly via background-jobs cron
DELETE FROM events WHERE created_at < NOW() - INTERVAL '180 days';
```

For long-term aggregates, materialize them daily into a thin `event_daily` table:

```sql
CREATE TABLE IF NOT EXISTS event_daily (
  day   date NOT NULL,
  name  text NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (day, name)
);

-- Run nightly
INSERT INTO event_daily (day, name, count)
SELECT DATE(created_at), name, COUNT(*)
FROM events
WHERE created_at >= CURRENT_DATE - INTERVAL '1 day'
  AND created_at <  CURRENT_DATE
GROUP BY 1, 2
ON CONFLICT (day, name) DO UPDATE SET count = EXCLUDED.count;
```

---

## Anti-patterns

| ❌ Wrong | ✅ Right |
|---|---|
| `await track(...)` in request handler | `track(...)` (sync wrapper, fire-and-forget) |
| One column per property (`signup_source`, `signup_plan`, ...) | Single JSONB `properties` column |
| Throwing from `track()` on DB error | Catch + log; never break the user flow |
| `fetch('/api/events')` from client without `keepalive` | Use `navigator.sendBeacon` or `fetch({ keepalive: true })` |
| Trusting `userId` from client body | Resolve `userId` from server session, ignore client value |
| Inconsistent names (`signup`, `signed_up`, `signupComplete`) | Stick to `noun_verbed` |
| No retention policy | Nightly DELETE older than 180 days + daily rollup |
| Querying without `(name, created_at)` index | Always have that compound index |

---

## Verification Checklist

- [ ] `events` table created with PK + 3 indexes (name+time, user+time, properties GIN)
- [ ] `lib/events.ts` `track()` is sync wrapper around `void writeEvent(...).catch(...)`
- [ ] Server-side: at least one event fires from a real action (signup / checkout / etc.)
- [ ] Client-side endpoint validates with Zod and resolves `userId` from session, not body
- [ ] Client helper uses `sendBeacon` with `fetch keepalive` fallback
- [ ] All event names follow `noun_verbed` snake_case
- [ ] Nightly retention job DELETEs events older than 180 days
- [ ] Tested: trigger an event, run `SELECT * FROM events ORDER BY id DESC LIMIT 1` and confirm row persisted
