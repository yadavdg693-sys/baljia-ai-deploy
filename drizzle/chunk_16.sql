CREATE TABLE "learnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid,
	"agent_id" integer,
	"category" varchar(100),
	"learning_type" varchar(50) DEFAULT 'domain_knowledge',
	"tags" jsonb,
	"content" text NOT NULL,
	"confidence" varchar(20) DEFAULT 'medium',
	"usage_count" integer DEFAULT 0,
	"last_referenced_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now()
);