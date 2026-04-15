CREATE TABLE "ad_spend_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"campaign_id" uuid,
	"daily_budget" numeric(10, 2),
	"actual_spend" numeric(10, 2),
	"platform_fee" numeric(10, 2),
	"charge_date" date,
	"stripe_charge_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now()
);