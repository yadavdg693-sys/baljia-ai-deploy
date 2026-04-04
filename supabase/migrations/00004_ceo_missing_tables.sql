-- Migration: Add missing tables for CEO tools
-- Tables: dashboard_links, platform_feedback, tweets

-- ══════════════════════════════════════════════
-- Dashboard Links — quick links shown on company dashboard
-- Used by CEO tools: get_links, update_link
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS dashboard_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT, -- optional emoji or icon name
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, label)
);

CREATE INDEX idx_dashboard_links_company ON dashboard_links(company_id);

-- ══════════════════════════════════════════════
-- Platform Feedback — bug reports + feature requests
-- Used by CEO tools: report_platform_bug, suggest_feature
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS platform_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature')),
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'in_progress', 'resolved', 'wont_fix')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_platform_feedback_company ON platform_feedback(company_id);

-- ══════════════════════════════════════════════
-- Tweets — posted tweets log
-- Used by CEO tools: get_tweets
-- Used by Twitter agent: post_tweet, get_recent_tweets
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tweets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tweet_id TEXT, -- Twitter API tweet ID (null if not yet posted)
  text TEXT NOT NULL,
  status TEXT DEFAULT 'posted' CHECK (status IN ('draft', 'scheduled', 'posted', 'failed')),
  scheduled_for TIMESTAMPTZ,
  posted_at TIMESTAMPTZ DEFAULT now(),
  task_id UUID REFERENCES tasks(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tweets_company ON tweets(company_id);
CREATE INDEX idx_tweets_posted_at ON tweets(company_id, posted_at DESC);
