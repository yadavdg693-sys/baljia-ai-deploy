# Skill: Neon Postgres for Render founder apps

**READ THIS BEFORE writing any database code, schema, migration, or query.**

Founder engineering apps deploy on Render and connect to a company-specific Neon Postgres database. Render can use normal Node.js Postgres clients.

## Provisioning

Use the platform tool first:

```text
provision_database({})
```

That creates or returns the company Neon database. Pass the returned connection string to Render as `DATABASE_URL` or `NEON_CONNECTION_STRING` when calling `render_create_service`.

## Recommended Node client

For simple Express apps, use `pg`:

```js
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}
```

Use parameterized queries. Never build SQL by concatenating user input.

## Drizzle

Use Drizzle when the task benefits from typed schema and coordinated migrations. On Render Node, use the Node Postgres adapter:

```js
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export const db = drizzle(pool);
```

## Migrations

Use the platform `run_migration` tool for schema changes:

```sql
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Rules:

- Use `IF NOT EXISTS` for creates.
- Use `IF EXISTS` for drops.
- Add indexes for lookup fields and foreign keys.
- Do not run migrations from app startup on every deploy.

## Vector search (pgvector)

For semantic search, RAG, similarity matching — store Gemini embeddings as
vectors directly in Postgres. Neon ships with the `vector` extension; you just
have to enable it. Founder/user apps use the fixed Gemini provider:
`gemini-embedding-001` with `vector(3072)` on
`https://generativelanguage.googleapis.com/v1beta/openai`.

### 1. Enable extension + add column (one-time, via `run_migration`)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content     text NOT NULL,
  embedding   vector(3072) NOT NULL,        -- Google gateway gemini-embedding-001 = 3072 dims
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Exact search for small canary/founder datasets
-- lists ≈ sqrt(rows). For < 100k rows, lists=100 is fine. Re-tune later.
-- Do NOT create ivfflat/hnsw indexes on vector(3072); pgvector vector indexes
-- support <=2000 dimensions. For small founder/canary data, exact ORDER BY is
-- fine. If you need an ANN index, use a <=2000-dim representation or halfvec.
```

### 2. Insert with embedding

```js
import { openai } from '@/lib/ai';
import { sql } from 'drizzle-orm';

const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || 'gemini-embedding-001';

async function indexDocument(content) {
  const { data: [{ embedding }] } = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: content,
  });
  await db.execute(sql`
    INSERT INTO documents (content, embedding)
    VALUES (${content}, ${JSON.stringify(embedding)}::vector)
  `);
}
```

Pass embeddings as `JSON.stringify(array)::vector` — pgvector parses the JSON
array literal. Don't try to send a Postgres array.

### 3. Query — top-k similar documents

```js
async function searchSimilar(query, k = 5) {
  const { data: [{ embedding }] } = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
  });
  // <=> is the cosine-distance operator (smaller = more similar)
  return db.execute(sql`
    SELECT id, content, 1 - (embedding <=> ${JSON.stringify(embedding)}::vector) AS similarity
    FROM documents
    ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
    LIMIT ${k}
  `);
}
```

### Operators (pick one and stick with it)

| Operator | Distance | Index op-class |
|---|---|---|
| `<=>` | Cosine (most common for OpenAI embeddings) | `vector_cosine_ops` |
| `<->` | L2 / Euclidean | `vector_l2_ops` |
| `<#>` | Negative inner product | `vector_ip_ops` |

OpenAI embeddings are L2-normalized → use `<=>` (cosine).

### Pitfalls

- **Do not ANN-index vector(3072).** `ivfflat`/`hnsw` indexes on pgvector's `vector` type support <=2000 dimensions. For Google `gemini-embedding-001` use exact scan on small datasets, lower dimensions, or `halfvec` if you truly need an index.

- **Don't query millions of rows without an index.** For small founder/canary data exact scan is acceptable; for large data, add an ANN index only after choosing a <=2000-dim vector representation or `halfvec`.
- **Don't mix dimension sizes.** Founder/user apps use `gemini-embedding-001` with `vector(3072)`.
- **`ivfflat` needs training when you do use it.** After bulk-inserting many rows, run `REINDEX` once to rebuild centroids.
- **Filter THEN search, not the other way.** `WHERE user_id = $1 ORDER BY embedding <=> $2 LIMIT 5` is far slower than restricting candidates first via a CTE — pgvector's index doesn't combine well with WHERE filters at small `lists` values.

## Query patterns

Parameterized query:

```js
await pool.query(
  'SELECT * FROM leads WHERE email = $1 LIMIT 1',
  [email]
);
```

Insert and return:

```js
const { rows } = await pool.query(
  'INSERT INTO leads (name, email) VALUES ($1, $2) RETURNING *',
  [name, email]
);
```

Pagination:

```js
const limit = 50;
const offset = page * limit;
await pool.query(
  'SELECT * FROM leads ORDER BY created_at DESC LIMIT $1 OFFSET $2',
  [limit, offset]
);
```

## Common pitfalls

- Missing `DATABASE_URL` in Render env vars.
- Using a masked connection string instead of the real Neon URL.
- Running destructive migrations without checking existing data.
- Creating a new Neon DB when the company already has one.
- Marking the task done without inserting and reading back test data.

## Verification

After DB work:

1. Run the migration.
2. Insert one test row.
3. Read it back through the app or API route.
4. Delete the test row if it should not remain.
5. Report the exact route or query that proved persistence works.
