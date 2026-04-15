CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referred_id" uuid NOT NULL,
	"status" varchar(50) DEFAULT 'signed_up',
	"credits_awarded" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"converted_at" timestamp with time zone
);