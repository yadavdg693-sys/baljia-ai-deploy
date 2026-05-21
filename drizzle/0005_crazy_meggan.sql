CREATE TABLE "payment_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"mode" varchar(10) DEFAULT 'test' NOT NULL,
	"secret_key_encrypted" text NOT NULL,
	"publishable_key" varchar(255),
	"webhook_secret_encrypted" text,
	"account_id" varchar(255),
	"display_name" varchar(255),
	"status" varchar(20) DEFAULT 'connected' NOT NULL,
	"last_validated_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_connections" ADD CONSTRAINT "payment_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_payment_connection_per_provider" ON "payment_connections" USING btree ("company_id","provider");--> statement-breakpoint
CREATE INDEX "idx_payment_connections_company" ON "payment_connections" USING btree ("company_id");