-- Self-serve signup: capture the two qualifying answers (entity count, role) on
-- the org at creation. Kept as jsonb so the onboarding questionnaire can evolve
-- (revised Day 7) without a migration. Attribution columns land separately (Day 11).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS signup_answers JSONB;
