CREATE TABLE "mcp_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"risk_level" varchar(20) DEFAULT 'low',
	"requires_approval" boolean DEFAULT false
);