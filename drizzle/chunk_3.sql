CREATE TABLE "agents" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"role" varchar(255),
	"base_system_prompt" text,
	"default_max_turns" integer DEFAULT 200,
	"default_model" varchar(100) DEFAULT 'claude-sonnet-4-20250514',
	"execution_style" varchar(50) DEFAULT 'agentic',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);