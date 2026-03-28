-- COMMAND HUB: AI Chief of Staff for LeadShift
-- Full database schema

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- for text search

-- Organizations: the billing/relationship entity
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  industry TEXT,
  notes TEXT,
  status TEXT DEFAULT 'active',
  strategic_value TEXT DEFAULT 'standard',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Contacts: people at organizations Josh works with
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  relationship_type TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Engagements: distinct workstreams
CREATE TABLE engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  name TEXT NOT NULL,
  type TEXT,
  status TEXT DEFAULT 'active',
  value_amount DECIMAL,
  start_date DATE,
  end_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Commitments: The heart of the entire system
CREATE TABLE commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  commitment_type TEXT NOT NULL,
  org_id UUID REFERENCES organizations(id),
  contact_id UUID REFERENCES contacts(id),
  engagement_id UUID REFERENCES engagements(id),
  other_party TEXT,
  owner TEXT DEFAULT 'josh',
  due_date TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_touched_at TIMESTAMPTZ DEFAULT now(),
  priority_score INTEGER DEFAULT 50,
  manual_priority_override TEXT,
  status TEXT DEFAULT 'pending',
  source_type TEXT,
  source_ref TEXT,
  source_snippet TEXT,
  escalation_level INTEGER DEFAULT 0,
  last_escalated_at TIMESTAMPTZ,
  ai_priority_modifier INTEGER DEFAULT 0,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Calendar events cache
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ms_event_id TEXT UNIQUE NOT NULL,
  subject TEXT,
  body_preview TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  location TEXT,
  attendees JSONB,
  org_id UUID REFERENCES organizations(id),
  is_processed BOOLEAN DEFAULT false,
  ai_analysis JSONB,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Email tracking
CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ms_message_id TEXT UNIQUE NOT NULL,
  subject TEXT,
  sender TEXT,
  sender_email TEXT,
  recipients JSONB,
  body_text TEXT,
  body_preview TEXT,
  received_at TIMESTAMPTZ,
  is_read BOOLEAN DEFAULT false,
  org_id UUID REFERENCES organizations(id),
  is_processed BOOLEAN DEFAULT false,
  ai_extraction JSONB,
  review_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Transcripts
CREATE TABLE transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  engagement_id UUID REFERENCES engagements(id),
  title TEXT NOT NULL,
  transcript_date DATE,
  transcript_type TEXT,
  duration_minutes INTEGER,
  participants JSONB,
  raw_text TEXT NOT NULL,
  summary TEXT,
  key_themes JSONB,
  client_insights JSONB,
  session_arc TEXT,
  notable_quotes JSONB,
  ai_extraction JSONB,
  review_status TEXT DEFAULT 'pending',
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RAG chunks
CREATE TABLE transcript_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id UUID REFERENCES transcripts(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id),
  chunk_index INTEGER,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Josh's voice/style profile
CREATE TABLE josh_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_type TEXT NOT NULL,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Commitment activity log
CREATE TABLE commitment_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID REFERENCES commitments(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Microsoft Graph auth tokens
CREATE TABLE auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL UNIQUE DEFAULT 'microsoft',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_commitments_status ON commitments(status) WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX idx_commitments_due ON commitments(due_date) WHERE status = 'pending';
CREATE INDEX idx_commitments_snoozed ON commitments(snoozed_until) WHERE status = 'snoozed';
CREATE INDEX idx_commitments_priority ON commitments(priority_score DESC) WHERE status IN ('pending', 'in_progress');
CREATE INDEX idx_commitments_org ON commitments(org_id);
CREATE INDEX idx_commitments_owner ON commitments(owner);
CREATE INDEX idx_calendar_start ON calendar_events(start_time);
CREATE INDEX idx_emails_received ON emails(received_at);
CREATE INDEX idx_emails_review ON emails(review_status) WHERE review_status = 'pending';
CREATE INDEX idx_chunks_content_trgm ON transcript_chunks USING gin (content gin_trgm_ops);
CREATE INDEX idx_chunks_content_fts ON transcript_chunks USING gin (to_tsvector('english', content));
CREATE INDEX idx_chunks_org ON transcript_chunks(org_id);
CREATE INDEX idx_activity_commitment ON commitment_activity(commitment_id);

-- ============================================================
-- PRIORITY SCORE FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_priority_scores()
RETURNS void AS $$
BEGIN
  UPDATE commitments c
  SET priority_score = LEAST(100, GREATEST(0,
    40
    + CASE
        WHEN c.due_date IS NOT NULL AND c.due_date < now()
        THEN LEAST(30, EXTRACT(DAY FROM now() - c.due_date)::int * 5)
        ELSE 0
      END
    + CASE
        WHEN c.due_date IS NOT NULL AND c.due_date::date = CURRENT_DATE THEN 15
        WHEN c.due_date IS NOT NULL AND c.due_date::date = CURRENT_DATE + 1 THEN 10
        WHEN c.due_date IS NOT NULL AND c.due_date::date <= CURRENT_DATE + 7 THEN 5
        ELSE 0
      END
    + CASE
        WHEN c.due_date IS NULL THEN
          LEAST(20, EXTRACT(DAY FROM now() - c.created_at)::int * 2)
        ELSE 0
      END
    + CASE
        WHEN c.commitment_type = 'promise_made' THEN 10
        WHEN c.commitment_type = 'deliverable' THEN 8
        WHEN c.commitment_type = 'ask_received' THEN 5
        WHEN c.commitment_type = 'prep' THEN
          CASE WHEN c.due_date IS NOT NULL AND c.due_date::date <= CURRENT_DATE + 1 THEN 15 ELSE 3 END
        ELSE 0
      END
    + CASE
        WHEN o.strategic_value = 'strategic' THEN 8
        WHEN o.strategic_value = 'emerging' THEN 3
        ELSE 0
      END
    + CASE
        WHEN c.last_touched_at < now() - interval '10 days' THEN 10
        WHEN c.last_touched_at < now() - interval '5 days' THEN 5
        ELSE 0
      END
    + COALESCE(c.ai_priority_modifier, 0)
  )),
  escalation_level = CASE
    WHEN c.due_date IS NOT NULL AND c.due_date < now() AND c.status = 'pending'
    THEN LEAST(5, EXTRACT(DAY FROM now() - c.due_date)::int / 2)
    WHEN c.due_date IS NULL AND c.last_touched_at < now() - interval '14 days'
    THEN LEAST(3, EXTRACT(DAY FROM now() - c.last_touched_at)::int / 7)
    ELSE c.escalation_level
  END,
  updated_at = now()
  FROM organizations o
  WHERE c.org_id = o.id
    AND c.status IN ('pending', 'in_progress')
    AND c.manual_priority_override IS NULL;

  -- Also update commitments with no org_id
  UPDATE commitments
  SET priority_score = LEAST(100, GREATEST(0,
    40
    + CASE WHEN due_date IS NOT NULL AND due_date < now()
        THEN LEAST(30, EXTRACT(DAY FROM now() - due_date)::int * 5) ELSE 0 END
    + CASE
        WHEN due_date IS NOT NULL AND due_date::date = CURRENT_DATE THEN 15
        WHEN due_date IS NOT NULL AND due_date::date = CURRENT_DATE + 1 THEN 10
        WHEN due_date IS NOT NULL AND due_date::date <= CURRENT_DATE + 7 THEN 5
        ELSE 0 END
    + CASE WHEN due_date IS NULL THEN LEAST(20, EXTRACT(DAY FROM now() - created_at)::int * 2) ELSE 0 END
    + CASE
        WHEN commitment_type = 'promise_made' THEN 10
        WHEN commitment_type = 'deliverable' THEN 8
        WHEN commitment_type = 'ask_received' THEN 5
        WHEN commitment_type = 'prep' THEN
          CASE WHEN due_date IS NOT NULL AND due_date::date <= CURRENT_DATE + 1 THEN 15 ELSE 3 END
        ELSE 0 END
    + CASE WHEN last_touched_at < now() - interval '10 days' THEN 10
        WHEN last_touched_at < now() - interval '5 days' THEN 5 ELSE 0 END
    + COALESCE(ai_priority_modifier, 0)
  )),
  updated_at = now()
  WHERE org_id IS NULL
    AND status IN ('pending', 'in_progress')
    AND manual_priority_override IS NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SNOOZE WAKEUP
-- ============================================================
CREATE OR REPLACE FUNCTION wake_snoozed_commitments()
RETURNS void AS $$
BEGIN
  UPDATE commitments
  SET status = 'pending',
      snoozed_until = NULL,
      last_touched_at = now(),
      updated_at = now()
  WHERE status = 'snoozed'
    AND snoozed_until <= now();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TEXT SEARCH: Full-text + trigram search across transcript chunks
-- ============================================================
CREATE OR REPLACE FUNCTION search_transcript_chunks_text(
  search_query text,
  match_count int DEFAULT 10,
  filter_org_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  transcript_id uuid,
  transcript_title text,
  transcript_date date,
  transcript_type text,
  org_name text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    tc.id,
    tc.content,
    tc.metadata,
    ts_rank(to_tsvector('english', tc.content), websearch_to_tsquery('english', search_query))::float as similarity,
    t.id as transcript_id,
    t.title as transcript_title,
    t.transcript_date,
    t.transcript_type,
    o.name as org_name
  FROM transcript_chunks tc
  JOIN transcripts t ON tc.transcript_id = t.id
  LEFT JOIN organizations o ON tc.org_id = o.id
  WHERE (filter_org_id IS NULL OR tc.org_id = filter_org_id)
    AND (
      to_tsvector('english', tc.content) @@ websearch_to_tsquery('english', search_query)
      OR tc.content ILIKE '%' || search_query || '%'
    )
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
