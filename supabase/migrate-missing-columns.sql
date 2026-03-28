-- ============================================================
-- MIGRATION: Add missing columns referenced by codebase
-- Run this in Supabase SQL Editor in one go.
-- Safe to re-run: uses IF NOT EXISTS / DO blocks.
-- ============================================================

-- 1. transcripts.language_leaks_observed (JSONB)
--    Referenced by: longitudinal/route.ts, briefing/route.ts, chat/route.ts, clients/[id]/page.tsx
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcripts' AND column_name = 'language_leaks_observed'
  ) THEN
    ALTER TABLE transcripts ADD COLUMN language_leaks_observed JSONB;
  END IF;
END $$;

-- 2. transcripts.recommended_focus_next_session (TEXT)
--    Referenced by: longitudinal/route.ts, briefing/route.ts, chat/route.ts, clients/[id]/page.tsx
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcripts' AND column_name = 'recommended_focus_next_session'
  ) THEN
    ALTER TABLE transcripts ADD COLUMN recommended_focus_next_session TEXT;
  END IF;
END $$;

-- 3. transcripts.is_processed (BOOLEAN DEFAULT false)
--    Already in schema, but included here for safety
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcripts' AND column_name = 'is_processed'
  ) THEN
    ALTER TABLE transcripts ADD COLUMN is_processed BOOLEAN DEFAULT false;
  END IF;
END $$;

-- 4. transcripts.source (TEXT DEFAULT 'manual')
--    Already in schema, but included here for safety
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcripts' AND column_name = 'source'
  ) THEN
    ALTER TABLE transcripts ADD COLUMN source TEXT DEFAULT 'manual';
  END IF;
END $$;

-- 5. transcripts.webhook_metadata (JSONB)
--    Already in schema, but included here for safety
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcripts' AND column_name = 'webhook_metadata'
  ) THEN
    ALTER TABLE transcripts ADD COLUMN webhook_metadata JSONB;
  END IF;
END $$;

-- 6. transcripts.category (TEXT DEFAULT 'business')
--    Already in schema, but included here for safety
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcripts' AND column_name = 'category'
  ) THEN
    ALTER TABLE transcripts ADD COLUMN category TEXT DEFAULT 'business';
  END IF;
END $$;

-- 7. commitments.category (TEXT DEFAULT 'business')
--    Already in schema, but included here for safety
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commitments' AND column_name = 'category'
  ) THEN
    ALTER TABLE commitments ADD COLUMN category TEXT DEFAULT 'business';
  END IF;
END $$;

-- ============================================================
-- PERFORMANCE INDEXES
-- Safe to re-run: uses IF NOT EXISTS via CREATE INDEX
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_transcripts_org
  ON transcripts(org_id);

CREATE INDEX IF NOT EXISTS idx_transcripts_processed
  ON transcripts(is_processed) WHERE is_processed = true;

CREATE INDEX IF NOT EXISTS idx_transcripts_category
  ON transcripts(category);

CREATE INDEX IF NOT EXISTS idx_transcripts_source
  ON transcripts(source);

CREATE INDEX IF NOT EXISTS idx_transcripts_date
  ON transcripts(transcript_date DESC);

CREATE INDEX IF NOT EXISTS idx_transcripts_language_leaks
  ON transcripts USING gin (language_leaks_observed)
  WHERE language_leaks_observed IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commitments_category
  ON commitments(category);

-- ============================================================
-- DONE. All columns and indexes are now in place.
-- ============================================================
