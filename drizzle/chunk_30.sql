CREATE TABLE "revenue_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_type" varchar(50) NOT NULL,
	"gross_amount" numeric(10, 2),
	"net_amount" numeric(10, 2),
	"platform_fee_rate" numeric(3, 2) DEFAULT '0.20',
	"stripe_charge_id" varchar(255),
	"description" text,
	"created_at" timestamp with time zone DEFAULT now()
);