-- Add granular processing progress tracking to document_queue
-- Fixes the broken progress bar that jumps from 0% to 100%

ALTER TABLE document_queue
  ADD COLUMN IF NOT EXISTS processing_step TEXT,
  ADD COLUMN IF NOT EXISTS processing_progress DECIMAL(5,2) DEFAULT 0;

-- processing_step values: 'downloading' | 'triage' | 'waiting_user' | 'extracting' | 'applying' | 'completing'
-- processing_progress: 0-100 percentage within current processing lifecycle
