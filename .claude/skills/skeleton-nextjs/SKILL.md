# Skill: Next.js 15 SaaS Skeleton for founder apps

**READ THIS BEFORE building any full-stack SaaS app.**

The Baljia skeleton is a production-ready Next.js 15 template that pre-wires auth, DB, AI, Stripe, and UI. **Never build a SaaS from scratch with Express or plain HTML.** Clone the skeleton, patch in the feature — that's the build pattern.

---

## When to use this skill

Use the skeleton for ANY task that includes:
- Login / register / user accounts
- AI-powered features (book generation, content creation, etc.)
- Payments / subscriptions / Stripe
- Dashboard / protected routes
- Any full-stack SaaS app

---

## What the skeleton pre-wires (you get for free)

| Feature | File | Notes |
|---|---|---|
| **Auth** | `lib/auth.ts` | Better Auth — email+password, optional Google/GitHub OAuth |
| **Database** | `db/schema.ts` + `db/index.ts` | Drizzle ORM + Neon Postgres |
| **AI calls** | `lib/ai.ts` | Anthropic + OpenAI SDK pointed at Baljia AI gateway. **Users NEVER provide their own API key** |
| **Stripe** | `lib/stripe.ts` + `app/actions/billing.ts` | Checkout + webhook handler already written |
| **UI** | Shadcn/ui + Tailwind 4 | Button, Input, Card, Label pre-installed |
| **Server** | Next.js 15 App Router | Always a real server — no static site fallback |

---

## Build order (follow exactly)

### STEP 1 — Fork the skeleton
Call `github_fork_skeleton` with the company repo slug.
This copies the full skeleton into the company's GitHub repo.

### STEP 2 — Provision infra
Call `provision_database` → get `DATABASE_URL`.
The AI gateway credentials (`AI_GATEWAY_URL`, `AI_GATEWAY_TOKEN`) are set automatically by the platform.

### STEP 3 — Add feature-specific DB tables
Read the current `db/schema.ts` via `github_read_file`.
Add ONLY the app-specific tables (e.g. `books`, `generations`, `projects`).
The skeleton already has: `user`, `session`, `account`, `verification`, `subscription`, `stripe_event`.

```typescript
// Example: add a books table on top of the skeleton schema
export const book = pgTable('book', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  genre: text('genre').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Push the updated schema via `github_push_file` to `db/schema.ts`.

### STEP 4 — Run schema sync
Call `run_drizzle_push` — this runs `pnpm db:push` against the company's Neon DB.
It creates all tables including the new feature tables.
**Do NOT use `run_migration` for skeleton apps** — Drizzle handles schema sync.

### STEP 5 — Write feature code (patch, don't rewrite)

**Add Server Actions** in `app/actions/<feature>.ts`:
```typescript
'use server';
import { requireSession } from '@/lib/utils';
import { anthropic } from '@/lib/ai';  // ← ALWAYS import from here, NEVER new Anthropic({apiKey: ...})
import { db } from '@/db';
import { book } from '@/db/schema';

export async function generateBook(title: string, genre: string) {
  const session = await requireSession();  // throws if not logged in

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: `Write a 3-chapter book outline for: "${title}" (genre: ${genre})` }],
  });

  const content = message.content[0].type === 'text' ? message.content[0].text : '';

  const [saved] = await db.insert(book).values({
    userId: session.user.id,
    title,
    genre,
    content,
  }).returning();

  return saved;
}
```

**Add pages** in `app/app/<feature>/page.tsx` (auth-gated by the middleware):
```typescript
// app/app/books/page.tsx — auto-protected by middleware.ts
import { db } from '@/db';
import { book } from '@/db/schema';
import { requireSession } from '@/lib/utils';
import { eq, desc } from 'drizzle-orm';

export default async function BooksPage() {
  const session = await requireSession();
  const books = await db.query.book.findMany({
    where: eq(book.userId, session.user.id),  // ALWAYS scope by userId
    orderBy: [desc(book.createdAt)],
  });
  return (
    <div>
      {books.map(b => <div key={b.id}>{b.title}</div>)}
    </div>
  );
}
```

### STEP 6 — Push all changed files
Use `github_push_file` for each file you added or changed.
Use `github_create_commit` for multiple files in one commit.

### STEP 7 — Deploy to Render
Call `render_create_service` with:
```
buildCommand:  pnpm install --no-frozen-lockfile --prod=false && pnpm build
startCommand:  pnpm exec next start -H 0.0.0.0 -p $PORT
healthCheckPath: /
env_vars:
  DATABASE_URL          → from provision_database
  BETTER_AUTH_SECRET    → generate with: openssl rand -base64 32
  BETTER_AUTH_URL       → https://<company-slug>.onrender.com
  NEXT_PUBLIC_APP_URL   → https://<company-slug>.onrender.com
  AI_GATEWAY_URL        → https://generativelanguage.googleapis.com/v1beta/openai
  AI_GATEWAY_TOKEN      → platform Gemini key
  AI_TEXT_MODEL         → gemini-2.5-flash
  AI_JSON_MODEL         → gemini-2.5-flash
  AI_EMBEDDING_MODEL    → gemini-embedding-001
  AI_EMBEDDING_DIMENSIONS → 3072
  STRIPE_SECRET_KEY     → (optional — only if Stripe features are in scope)
  NODE_ENV              → production
```

### STEP 8 — Verify
1. `render_get_deploy_status` — wait for `live`
2. `check_url_health` on `/` (landing), `/sign-in` (auth), `/app` (dashboard)
3. If you created `/api/health`, check it too and verify dependency checks are all healthy

---

## Critical rules (violations break the app)

1. **Always import AI from `@/lib/ai`** — never `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })`. The gateway handles the key automatically.
2. **Always scope DB queries by `userId`** — `where: eq(table.userId, session.user.id)` on every user-data query. No RLS — this is the only protection.
3. **Server Components by default** — only add `'use client'` when using state, effects, or event handlers.
4. **Server Actions for mutations** — not API routes. API routes are only for webhooks and OAuth callbacks.
5. **Never use `express-session`, `bcryptjs`, or `connect-pg-simple`** — those are for Express apps. Better Auth handles all of this.
6. **pnpm only** — not npm, not yarn. The lockfile is pnpm-lock.yaml.

---

## Skeleton file structure

```
app/
├── layout.tsx             root shell
├── page.tsx               public landing page
├── (auth)/
│   ├── sign-in/page.tsx   login form (Better Auth)
│   └── sign-up/page.tsx   register form (Better Auth)
└── app/                   ← ALL authenticated pages go here (middleware protects)
    ├── layout.tsx         auth guard via getSession()
    ├── page.tsx           main dashboard
    └── settings/page.tsx  subscription management

db/
├── index.ts               Drizzle client (Neon HTTP)
└── schema.ts              ← ADD your tables here

lib/
├── auth.ts                Better Auth server config
├── auth-client.ts         Better Auth browser client
├── ai.ts                  ← USE THIS for all AI calls
├── stripe.ts              Stripe client
└── utils.ts               cn(), getSession(), requireSession()
```

---

## Common pitfalls

- **Don't create a new Express server** — this is Next.js, not Express
- **Don't write SQL migrations manually** — use `run_drizzle_push`
- **Don't use `process.env.ANTHROPIC_API_KEY` directly** — import from `@/lib/ai`
- **Don't put user data in `/app/app/` without `requireSession()`** — the middleware protects routes but the data queries need the userId filter too
- **Render free tier** — Next.js 15 SSR works on Render. Set `startCommand: pnpm exec next start -H 0.0.0.0 -p $PORT` and `buildCommand: pnpm install --no-frozen-lockfile --prod=false && pnpm build`. Apply schema changes before deploy with `run_migration` or `run_drizzle_push`.
