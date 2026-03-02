-- Track when compliance reminders were last sent to avoid duplicates
ALTER TABLE compliance_obligations
  ADD COLUMN IF NOT EXISTS last_reminder_sent TIMESTAMPTZ;
