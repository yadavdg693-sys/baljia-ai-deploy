# Skill: Neon Postgres on Cloudflare Workers

**READ THIS BEFORE writing any database code, schema, migration, or query.**

## The driver — there is only one that works

**Use `@neondatabase/serverless` (HTTP driver).** That's the only Postgres client that works on Cloudflare Workers (no TCP available).

```js
import { neon } from '@neondatabase/serverless';

export default {
  async fetch(request, env, ctx) {
    const sql = neon(env.NEON_URL);

    const users = await sql`SELECT id, email FROM users WHERE active = true LIMIT 10`;
    // sql is a tagged template — interpolations are PARAMETERIZED, not concatenated
    // → SQL-injection-safe by default

    return Response.json(users);
  },
};
```

## Drivers that DO NOT work (never try these)

| Driver | Why broken on Workers |
|---|---|
| `pg` / `pg-pool` | TCP connection — Workers has no raw socket support |
| `postgres` (the package) | Same — TCP only |
| `mysql2`, `mariadb` | Different DB anyway, but same TCP issue |
| `sequelize`, `typeorm` (default config) | Default to `pg`/`mysql2` adapters which use TCP |

## Drizzle ORM — works great with Neon HTTP

If you want type-safe schema + migrations, Drizzle is the right choice:

```js
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';

const sql = neon(env.NEON_URL);
const db = drizzle(sql);

const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  created_at: timestamp('created_at').defaultNow(),
});

const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
```

## Provisioning a database — the platform does this

You don't manually create the Neon project. Use `provision_database` (one of your tools):

```
provision_database({})  // creates a Neon project for this company, returns connection URI
```

After that, `cf_deploy_app({ ..., with_neon_db: true })` injects the URI as `env.NEON_URL`.

## Migrations — three options, pick by complexity

| Tool | When to use |
|---|---|
| `run_migration({ sql: 'CREATE TABLE ...' })` | Simple one-off DDL. The platform runs it directly against the company DB. |
| Drizzle migration files | When the founder app has multiple coordinated schema changes. Generate via `drizzle-kit generate` locally, ship the SQL via `run_migration`. |
| Raw SQL in app code (DON'T) | NEVER run migrations from inside the Worker on every cold start. They WILL race + corrupt schema. |

Always use `IF NOT EXISTS` on `CREATE TABLE` and `IF EXISTS` on `DROP` — migrations are sometimes re-run.

## Query patterns

### Parameterized (always do this)

```js
// ✓ safe
await sql`SELECT * FROM tasks WHERE company_id = ${companyId} AND status = ${status}`;

// ✗ never — SQL injection
await sql.unsafe(`SELECT * FROM tasks WHERE company_id = '${companyId}'`);
```

### Pagination

```js
const PAGE = 50;
const offset = page * PAGE;
const rows = await sql`
  SELECT id, title, created_at
  FROM tasks
  WHERE company_id = ${companyId}
  ORDER BY created_at DESC
  LIMIT ${PAGE} OFFSET ${offset}
`;
```

### Bulk insert (avoid N+1)

```js
// ✗ slow — 100 round-trips
for (const item of items) {
  await sql`INSERT INTO items (name) VALUES (${item.name})`;
}

// ✓ one round-trip
await sql`
  INSERT INTO items (name)
  SELECT * FROM ${sql(items.map(i => [i.name]))}
`;
// Or with drizzle:
// await db.insert(items).values(items);
```

## Common pitfalls

- **Forgetting `with_neon_db: true` on `cf_deploy_app`** — `env.NEON_URL` will be `undefined`, the Worker will crash on first query. The platform tries to validate this; double-check.
- **Using `sql.transaction()` on Neon HTTP** — the HTTP driver doesn't support multi-statement transactions. For atomicity, use `WITH` CTEs or `INSERT ... RETURNING` + chain queries with explicit error handling. Drizzle's `db.transaction()` calls fail silently on the HTTP adapter.
- **Long-running SELECTs** — Workers has 30s CPU per request. A query that takes 25s leaves 5s for everything else. Add `LIMIT` and indices early.
- **Connection pooling** — Neon already does pooling at the edge. Don't try to pool inside the Worker (you can't anyway — no persistent state across requests).
- **`SELECT *` in production code** — return only the columns you use. Adding a column later breaks downstream code that expected fewer fields.

## Schema conventions used across Baljia

- All tables use `uuid` primary keys with `defaultRandom()`
- Timestamps: `created_at` and `updated_at`, both `timestamp with time zone`, `defaultNow()`
- Foreign keys to `companies.id` are common — index them: `index('idx_<table>_company').on(t.company_id)`
- Soft-delete: prefer status enum (`active|archived|rejected`) over `deleted_at`

## Verify after writing DB code

After your migration runs, write a verify step that:
1. SELECTs from the new table to confirm it exists
2. INSERTs a row and SELECTs it back
3. DELETEs the test row

Don't trust "migration ran without error" as proof — Postgres lies politely.
