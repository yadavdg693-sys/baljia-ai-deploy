CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"email" varchar(255),
	"name" varchar(255),
	"source" varchar(50),
	"lead_status" varchar(50) DEFAULT 'pending',
	"email_verified" boolean DEFAULT false,
	"last_contacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);