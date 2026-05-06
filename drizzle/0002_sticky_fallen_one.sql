CREATE TABLE "domain_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"site_domain" varchar(255) NOT NULL,
	"skill_kind" varchar(50) NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text NOT NULL,
	"confidence" integer DEFAULT 50,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "domain_skills" ADD CONSTRAINT "domain_skills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_domain_skills_unique" ON "domain_skills" USING btree ("company_id","site_domain","skill_kind","key");--> statement-breakpoint
CREATE INDEX "idx_domain_skills_lookup" ON "domain_skills" USING btree ("company_id","site_domain");