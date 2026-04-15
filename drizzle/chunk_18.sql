CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"category" varchar(50),
	"tool_count" integer,
	"is_available" boolean DEFAULT true,
	"requires_oauth" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "mcp_servers_name_unique" UNIQUE("name")
);