-- Fix: Mark transcripts as processed when they have summaries
-- The processing route was not setting is_processed = true, so prep/chat couldn't see them
UPDATE transcripts SET is_processed = true WHERE summary IS NOT NULL AND is_processed = false;
