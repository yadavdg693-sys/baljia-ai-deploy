# realtime-features

Server-Sent Events (SSE), polling, and live UI updates for founder apps deployed
on Render with Next.js. Read this skill BEFORE writing any "live" feature —
streaming chat, live dashboards, presence, progress bars, notifications.

Agents that skip this skill consistently make four fatal mistakes:
1. Use WebSockets on Render's free Node runtime (sockets get killed at 30s idle)
2. Block the response with `setInterval` instead of streaming
3. Poll every 1s from the client (kills DB and burns credits)
4. Forget to flush headers, so the browser buffers and nothing shows up

---

## The Decision: SSE vs Polling

Pick the cheaper one that satisfies the latency requirement.

| You need... | Use | Why |
|---|---|---|
| Updates within 5–30s, low concurrency (< 100 users/page) | **Polling** | Simple, no connection state, free plan friendly |
| Updates within 1s, server pushes | **SSE** | One-way stream, runs on plain HTTP, works behind Render's load balancer |
| Bidirectional realtime (chat with typing indicators, multiplayer) | **External provider** (Ably, Pusher, Supabase Realtime) | WebSockets are unreliable on Render free; don't try to roll your own |

**Default to polling.** It's the boring choice and it almost always works.
Only reach for SSE when the latency genuinely matters (chat tokens streaming,
job progress, live counters).

---

## Pattern 1: Polling (the default)

### Server (Next.js route handler)

```ts
// src/app/api/jobs/[id]/status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await db.execute(sql`
    SELECT id, status, progress, result FROM jobs WHERE id = ${id} LIMIT 1
  `);
  const job = result.rows[0];
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json(job, {
    headers: {
      // Critical: tell intermediaries not to cache
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
```

### Client (React)

```tsx
'use client';
import { useEffect, useState } from 'react';

export function JobStatus({ id }: { id: string }) {
  const [job, setJob] = useState<{ status: string; progress: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/jobs/${id}/status`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setJob(data);

        // Stop polling when terminal
        if (data.status === 'done' || data.status === 'failed') return;

        // Backoff: faster while running, slower while queued
        const delay = data.status === 'running' ? 1500 : 4000;
        timer = setTimeout(poll, delay);
      } catch {
        // Network blip — try again in 5s
        timer = setTimeout(poll, 5000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  if (!job) return <p>Loading…</p>;
  return <p>{job.status} — {job.progress}%</p>;
}
```

### Polling cadence — pick the slowest acceptable

| User-visible thing | Cadence |
|---|---|
| Background job progress | 1.5s while running, 4s while queued |
| Dashboard counters | 10s |
| Notifications / inbox unread count | 30s |
| "Last seen" / presence | 60s |

**Never poll faster than 1s.** If you need sub-second updates, use SSE.

---

## Pattern 2: Server-Sent Events (when latency matters)

SSE works on Render Node services with **one critical caveat**: you must keep
the connection alive with periodic heartbeats, otherwise Render's load balancer
will close it after ~60s of silence.

### Server

```ts
// src/app/api/jobs/[id]/stream/route.ts
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';   // never cache
export const maxDuration = 300;           // 5 min cap on Render

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval>;
      let interval: ReturnType<typeof setInterval>;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(interval);
        try { controller.close(); } catch {}
      };

      // Client disconnect
      _req.signal.addEventListener('abort', cleanup);

      // Heartbeat every 15s — prevents Render LB from dropping the connection
      heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15000);

      const fetchJob = async () => {
        const r = await db.execute(sql`SELECT * FROM jobs WHERE id = ${id}`);
        return r.rows[0] as { status: string } | undefined;
      };

      // Initial state
      const initial = await fetchJob();
      if (initial) send('status', initial);

      // Poll DB and stream changes (simple version — for high scale, use LISTEN/NOTIFY)
      interval = setInterval(async () => {
        if (closed) return;
        const next = await fetchJob();
        if (!next) return;
        send('status', next);
        if (next.status === 'done' || next.status === 'failed') {
          send('end', { reason: next.status });
          cleanup();
        }
      }, 1000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',  // disable nginx buffering if anything sits in front
    },
  });
}
```

### Client

```tsx
'use client';
import { useEffect, useState } from 'react';

export function JobStream({ id }: { id: string }) {
  const [status, setStatus] = useState<string>('connecting');

  useEffect(() => {
    const es = new EventSource(`/api/jobs/${id}/stream`);

    es.addEventListener('status', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setStatus(data.status);
    });

    es.addEventListener('end', () => es.close());

    es.onerror = () => {
      // EventSource auto-reconnects — only close on terminal failure
      if (es.readyState === EventSource.CLOSED) setStatus('disconnected');
    };

    return () => es.close();
  }, [id]);

  return <p>Status: {status}</p>;
}
```

---

## Pattern 3: Streaming LLM tokens to the client

The most common SSE use case in founder apps. Stream tokens from the AI gateway
straight through to the browser.

```ts
// src/app/api/chat/route.ts
import { openai } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const completion = await openai.chat.completions.create({
    model: process.env.AI_TEXT_MODEL || 'gemini-2.5-flash',
    messages,
    stream: true,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of completion) {
        const token = chunk.choices[0]?.delta?.content ?? '';
        if (token) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
        }
      }
      controller.enqueue(encoder.encode(`event: end\ndata: {}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

---

## Anti-patterns

| ❌ Wrong | ✅ Right |
|---|---|
| WebSockets on Render free Node | SSE for one-way; external provider (Ably/Pusher) for two-way |
| `setInterval(fetch, 500)` from the client | Backoff polling: faster while active, slower while idle |
| SSE without heartbeat | Send `: ping\n\n` every 15s |
| Forgetting `Cache-Control: no-store` | Always set it on streaming + polling endpoints |
| `runtime = 'edge'` for SSE on Render | Render runs Node — use `runtime = 'nodejs'` |
| Returning JSON from an SSE endpoint | Must be `text/event-stream` with `event:` + `data:` lines |
| Forgetting to clean up `setInterval` on disconnect | Listen to `req.signal.abort` and clear timers |
| Polling every page on every dashboard tab | One poller per query at the layout level, share via context |

---

## Render gotchas

- **`maxDuration = 300`** is the cap on Render Node services. Long-running
  streams beyond 5 min must reconnect from the client side (EventSource does
  this automatically).
- **No Edge runtime.** Don't `export const runtime = 'edge'` — Render runs
  Node-only. Use `runtime = 'nodejs'`.
- **Render free plan sleeps after 15min idle.** First request after sleep takes
  30s+ — show a "waking up" state in the client if connection takes > 3s.
- **Connection limit:** Render free Node has ~100 concurrent connections. SSE
  holds one per active viewer — at 100 viewers you're full. Switch to polling
  or upgrade plans before that.

---

## Verification Checklist

- [ ] Polling: `Cache-Control: no-store` on the response
- [ ] Polling: client uses `setTimeout` recursion (not `setInterval`) so it stops cleanly
- [ ] Polling: terminal states (done/failed) stop the loop
- [ ] SSE: heartbeat (`: ping\n\n`) every ≤ 30s
- [ ] SSE: `Content-Type: text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`
- [ ] SSE: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`
- [ ] SSE: `controller.close()` and `clearInterval` called on `req.signal.abort`
- [ ] Client EventSource closes on `event: end` and on unmount
- [ ] Tested: open the page, watch DevTools Network tab show event-stream with periodic data frames
