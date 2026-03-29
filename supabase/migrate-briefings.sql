-- Add briefings table for storing morning/weekly briefing HTML
CREATE TABLE IF NOT EXISTS briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_type TEXT NOT NULL,
  html_content TEXT NOT NULL,
  summary JSONB,
  generated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_briefings_type_date ON briefings(briefing_type, generated_at DESC);
