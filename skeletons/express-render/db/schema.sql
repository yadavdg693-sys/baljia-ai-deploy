-- db/schema.sql — Baljia Express skeleton baseline.
-- Run on the Neon DB before first deploy via run_migration. The Engineering
-- Agent should ADD feature-specific tables below the marked section, not
-- modify the framework tables (users, session).

-- ── Framework tables (do not modify) ─────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  plan          text NOT NULL DEFAULT 'free',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- connect-pg-simple session store
CREATE TABLE IF NOT EXISTS "session" (
  sid    varchar NOT NULL COLLATE "default",
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY (sid)
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" (expire);

-- ── Feature scaffold (CUSTOMIZE) ─────────────────────────────────
-- The "items" table is a placeholder for the founder's domain object.
-- Rename to the feature noun (monitors, posts, leads, etc.) and add
-- domain-specific columns. Keep the user_id FK and timestamp pattern.

CREATE TABLE IF NOT EXISTS items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_user_id_created_at_idx
  ON items (user_id, created_at DESC);
