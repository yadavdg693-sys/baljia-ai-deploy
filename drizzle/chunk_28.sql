CREATE TABLE "refund_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid,
	"failure_class" varchar(50),
	"decision" varchar(50) NOT NULL,
	"reason" text,
	"credits_refunded" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now()
);