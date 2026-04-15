CREATE TABLE "failure_fingerprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" varchar(255) NOT NULL,
	"category" varchar(100),
	"description" text,
	"occurrence_count" integer DEFAULT 1,
	"affected_agents" jsonb,
	"affected_tools" jsonb,
	"fix_status" varchar(50) DEFAULT 'open',
	"regression_sensitive" boolean DEFAULT false,
	"root_cause" text,
	"fix_notes" text,
	"fix_applied_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now(),
	"last_seen_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "failure_fingerprints_fingerprint_unique" UNIQUE("fingerprint")
);