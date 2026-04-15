CREATE TABLE "tweets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tweet_id" text,
	"text" text NOT NULL,
	"status" text DEFAULT 'posted',
	"scheduled_for" timestamp with time zone,
	"posted_at" timestamp with time zone DEFAULT now(),
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);