CREATE TABLE "agent_tool_mounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" integer NOT NULL,
	"mcp_server_id" uuid NOT NULL,
	"is_required" boolean DEFAULT false,
	"requires_oauth" boolean DEFAULT false
);