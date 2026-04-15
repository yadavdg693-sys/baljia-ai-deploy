-- Migration 00006: Roadmap + Milestone System
-- The #1 missing feature: transforms Baljia from "task executor" to "founder OS"

-- ══════════════════════════════════════════════
-- ROADMAPS — one per company, archetype-driven
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS roadmaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  archetype VARCHAR(50) NOT NULL DEFAULT 'saas',
  title VARCHAR(500) NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  current_phase INTEGER NOT NULL DEFAULT 1,
  total_phases INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_roadmap_archetype CHECK (archetype IN ('saas', 'marketplace', 'agency', 'content', 'ecommerce', 'community')),
  CONSTRAINT chk_roadmap_status CHECK (status IN ('active', 'completed', 'paused', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roadmaps_company ON roadmaps(company_id);
CREATE INDEX IF NOT EXISTS idx_roadmaps_status ON roadmaps(status);

-- ══════════════════════════════════════════════
-- MILESTONES — ordered list per roadmap
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  phase INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  -- Tags map to the task tag system for auto-evaluation
  suggested_task_tags JSONB DEFAULT '[]',
  -- Night shift can use this to generate relevant tasks
  night_shift_hint TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_milestone_status CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_milestones_roadmap ON milestones(roadmap_id);
CREATE INDEX IF NOT EXISTS idx_milestones_company ON milestones(company_id);
CREATE INDEX IF NOT EXISTS idx_milestones_status ON milestones(status);
CREATE INDEX IF NOT EXISTS idx_milestones_phase ON milestones(roadmap_id, phase, sort_order);

-- ══════════════════════════════════════════════
-- MILESTONE CRITERIA — checklist items per milestone
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS milestone_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  -- auto_evaluatable: can the platform check this programmatically?
  auto_evaluatable BOOLEAN DEFAULT FALSE,
  -- evaluation_query: JSON config for auto-evaluation (table, column, condition)
  evaluation_query JSONB,
  is_met BOOLEAN DEFAULT FALSE,
  met_at TIMESTAMPTZ,
  evidence JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_criteria_eval CHECK (
    (auto_evaluatable = TRUE AND evaluation_query IS NOT NULL) OR
    (auto_evaluatable = FALSE)
  )
);

CREATE INDEX IF NOT EXISTS idx_criteria_milestone ON milestone_criteria(milestone_id);
CREATE INDEX IF NOT EXISTS idx_criteria_status ON milestone_criteria(is_met);
