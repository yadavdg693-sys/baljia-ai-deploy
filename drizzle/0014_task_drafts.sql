CREATE TABLE IF NOT EXISTS task_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  title varchar(500) NOT NULL,
  description text,
  tag varchar(50) NOT NULL,
  priority integer DEFAULT 50,
  source varchar(50) NOT NULL,
  status varchar(50) NOT NULL DEFAULT 'pending_ceo_review',
  suggestion_reasoning text,
  proposed_task jsonb,
  proposed_execution_contract jsonb,
  reviewed_task_id uuid REFERENCES tasks(id),
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_drafts_company ON task_drafts(company_id);
CREATE INDEX IF NOT EXISTS idx_task_drafts_company_status ON task_drafts(company_id, status);
