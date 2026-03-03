-- ============================================================================
-- 012: Waitlist table for invite-only access control
-- ============================================================================

CREATE TABLE IF NOT EXISTS waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  source TEXT DEFAULT 'landing_page',
  referrer TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Allow anonymous inserts but not reads
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert" ON waitlist
  FOR INSERT WITH CHECK (true);
