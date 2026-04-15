CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"session_type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"context_packet_version" integer DEFAULT 1,
	"permission_snapshot" jsonb,
	"started_at" timestamp with time zone DEFAULT now(),
	"ended_at" timestamp with time zone
);