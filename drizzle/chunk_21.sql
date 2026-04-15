CREATE TABLE "milestone_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"auto_evaluatable" boolean DEFAULT false,
	"evaluation_query" jsonb,
	"is_met" boolean DEFAULT false,
	"met_at" timestamp with time zone,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);