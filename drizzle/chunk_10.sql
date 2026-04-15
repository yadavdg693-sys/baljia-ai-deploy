CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_type" varchar(50) NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"task_id" uuid,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now()
);