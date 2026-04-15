CREATE TABLE "approval_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"risk_class" varchar(50) NOT NULL,
	"approved_by" varchar(50) NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone,
	"status" varchar(50) DEFAULT 'active' NOT NULL
);