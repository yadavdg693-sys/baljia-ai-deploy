CREATE TABLE "platform_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"company_id" uuid,
	"payload" jsonb NOT NULL,
	"is_public" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);