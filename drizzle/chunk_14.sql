CREATE TABLE "email_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"thread_id" varchar(255),
	"subject" varchar(500),
	"from_address" varchar(255),
	"to_address" varchar(255),
	"direction" varchar(10),
	"body" text,
	"external_id" varchar(255),
	"is_read" boolean DEFAULT false,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);