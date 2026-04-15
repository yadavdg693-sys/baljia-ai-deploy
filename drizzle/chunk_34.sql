CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid,
	"stripe_subscription_id" varchar(255),
	"stripe_customer_id" varchar(255),
	"plan_type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'active',
	"trial_ends_at" timestamp with time zone,
	"night_shifts_remaining" integer DEFAULT 0,
	"night_shifts_total" integer DEFAULT 0,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);