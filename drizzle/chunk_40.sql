CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"onboarding_intent" varchar(50),
	"idea_text" text,
	"business_website" varchar(500),
	"timezone" varchar(100),
	"ip_address" varchar(45),
	"converted_user_id" uuid,
	"converted_company_id" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);