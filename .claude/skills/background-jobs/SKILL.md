# background-jobs

Cron jobs and background tasks on Render. Read this skill BEFORE writing any
scheduled task, queue worker, or async processing pipeline.

Agents that skip this skill consistently make two fatal mistakes:
1. Using `setInterval` inside the web server (dies on every deploy)
2. Using `worker_threads` (not available on Render free plan)

---

## The Golden Rule

**On Render, the ONLY reliable cron pattern is a separate `worker` service
running `node-cron`, with one HTTP endpoint that Render's Cron Job type calls.**

---

## Pattern 1: Render Cron Job Service (Recommended)

Create a **second Render service** of type `cron` pointing at your worker.

### Step 1 — Write the worker file

```ts
// src/workers/cron.ts
import cron from 'node-cron';
import { db } from '@/lib/db';

// Register jobs
cron.schedule('0 * * * *', async () => {
  console.log('[cron] hourly-cleanup starting');
  try {
    await hourlyCleanup();
    console.log('[cron] hourly-cleanup done');
  } catch (err) {
    console.error('[cron] hourly-cleanup failed', err);
  }
});

cron.schedule('0 9 * * 1', async () => {
  console.log('[cron] weekly-report starting');
  try {
    await weeklyReport();
    console.log('[cron] weekly-report done');
  } catch (err) {
    console.error('[cron] weekly-report failed', err);
  }
});

async function hourlyCleanup() {
  // Example: delete expired sessions older than 7 days
  await db.execute(
    `DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '7 days'`
  );
}

async function weeklyReport() {
  // Example: aggregate weekly stats
}
```

### Step 2 — Add a health endpoint

```ts
// src/workers/server.ts  (entry point for the worker service)
import express from 'express';
import './cron'; // Register all cron jobs

const app = express();
const PORT = process.env.PORT ?? 3001;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', jobs: 'running' });
});

app.listen(PORT, () => {
  console.log(`Worker listening on :${PORT}`);
});
```

### Step 3 — render.yaml entry

```yaml
services:
  - type: worker
    name: my-app-worker
    runtime: node
    repo: https://github.com/yadavdg693-sys/my-app
    branch: main
    buildCommand: pnpm install && pnpm build
    startCommand: node dist/workers/server.js
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: my-app-db
          property: connectionString
```

---

## Pattern 2: Simple One-Off Background Task (No queue needed)

For tasks that don't need strict scheduling, fire-and-forget inside an API route:

```ts
// In a Next.js route handler
export async function POST(req: NextRequest) {
  const data = await req.json();

  // Return immediately, don't await the heavy task
  void processInBackground(data); // eslint-disable-line @typescript-eslint/no-floating-promises

  return NextResponse.json({ queued: true });
}

async function processInBackground(data: unknown) {
  try {
    // Heavy work here — runs after response is sent
    await doHeavyWork(data);
  } catch (err) {
    // MUST catch — uncaught rejection will crash the process
    console.error('[bg] processInBackground failed', err);
  }
}
```

> **Warning:** This only works for short tasks (< 30s). Render will kill the
> request after 30s. Use Pattern 1 for anything longer.

---

## Pattern 3: Redis-free Job Queue via Neon

When you need a proper queue without Redis (Render free plan):

```ts
// Schema (Drizzle)
export const jobQueue = pgTable('job_queue', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('pending'), // pending | processing | done | failed
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  scheduledAt: timestamp('scheduled_at').defaultNow(),
  processedAt: timestamp('processed_at'),
  error: text('error'),
});

// Worker — claim and process jobs
async function processJobs() {
  // Atomic claim: UPDATE ... RETURNING prevents double-processing
  const [job] = await db.execute(sql`
    UPDATE job_queue
    SET status = 'processing', attempts = attempts + 1
    WHERE id = (
      SELECT id FROM job_queue
      WHERE status = 'pending'
        AND scheduled_at <= NOW()
        AND attempts < max_attempts
      ORDER BY scheduled_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  if (!job) return; // No pending jobs

  try {
    await dispatch(job.type, job.payload);
    await db.execute(sql`
      UPDATE job_queue SET status = 'done', processed_at = NOW() WHERE id = ${job.id}
    `);
  } catch (err) {
    const failed = job.attempts >= job.maxAttempts;
    await db.execute(sql`
      UPDATE job_queue
      SET status = ${failed ? 'failed' : 'pending'},
          error = ${err instanceof Error ? err.message : 'Unknown'}
      WHERE id = ${job.id}
    `);
    if (failed) {
      console.error('[queue] Job dead-lettered', { id: job.id, type: job.type });
    }
  }
}

// Schedule the worker to poll every 10 seconds
cron.schedule('*/10 * * * * *', processJobs);
```

---

## Anti-patterns

| ❌ Wrong | ✅ Right |
|---|---|
| `setInterval(() => {...}, 60000)` in server.ts | `node-cron` in a separate worker service |
| `new Worker('./job.js')` (worker_threads) | Separate Render worker service |
| Await heavy work inside a webhook handler | Enqueue to `job_queue`, return 200 |
| No try/catch in cron handler | Always wrap job body in try/catch |
| Fire-and-forget without `.catch()` | `void task().catch(console.error)` |
| Single process handles web + cron | Always split: web service + worker service |

---

## Environment Variables for Worker Service

```env
DATABASE_URL=postgres://...  # Same Neon DB as the web app
NODE_ENV=production
PORT=3001                    # Render sets this automatically
```

---

## Verification Checklist

- [ ] Worker service has `/health` endpoint returning 200
- [ ] All cron handlers wrapped in `try/catch` with `console.error` on failure
- [ ] No `setInterval` or `worker_threads` anywhere
- [ ] `job_queue` table uses `FOR UPDATE SKIP LOCKED` for concurrency safety
- [ ] Dead-letter logging when `attempts >= maxAttempts`
- [ ] Worker service is deployed as separate `type: worker` in `render.yaml`
- [ ] Test: deploy worker, check Render logs for `[cron]` messages on schedule
