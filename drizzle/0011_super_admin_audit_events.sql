-- Additive manual SQL migration: Drizzle migration metadata was already dirty/untracked,
-- and this repo has no db:migrate script. Apply directly or through the deployment SQL runner.
CREATE TABLE IF NOT EXISTS "super_admin_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "admin_email" varchar(255) NOT NULL,
  "action" varchar(100) NOT NULL,
  "target_type" varchar(80),
  "target_id" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_super_admin_audit_admin"
  ON "super_admin_audit_events" ("admin_user_id");

CREATE INDEX IF NOT EXISTS "idx_super_admin_audit_action"
  ON "super_admin_audit_events" ("action");

CREATE INDEX IF NOT EXISTS "idx_super_admin_audit_target"
  ON "super_admin_audit_events" ("target_type", "target_id");

CREATE INDEX IF NOT EXISTS "idx_super_admin_audit_created"
  ON "super_admin_audit_events" ("created_at");
