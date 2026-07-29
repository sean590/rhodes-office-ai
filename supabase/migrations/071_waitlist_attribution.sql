-- 071: Ad-attribution columns on waitlist
--
-- Landing pages (index.html / family-office.html in the marketing site) now
-- capture utm_* + gclid from the URL (populated by the Google Ads account-level
-- final URL suffix) and include them in the waitlist insert.
--
-- Additive + idempotent: no data touched, no RLS changes. The existing
-- waitlist_insert_anon/auth policies (068) cover the new columns automatically.
--
-- NOTE (deploy order): apply this BEFORE deploying the updated landing pages —
-- PostgREST rejects inserts referencing unknown columns.

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS utm_source   TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium   TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_term     TEXT,
  ADD COLUMN IF NOT EXISTS utm_content  TEXT,
  ADD COLUMN IF NOT EXISTS gclid        TEXT,
  ADD COLUMN IF NOT EXISTS landing_path TEXT;

COMMENT ON COLUMN public.waitlist.utm_source   IS 'Ad platform, e.g. google (from URL utm_source)';
COMMENT ON COLUMN public.waitlist.utm_medium   IS 'e.g. cpc for paid clicks';
COMMENT ON COLUMN public.waitlist.utm_campaign IS 'Google Ads campaign ID via {campaignid} ValueTrack';
COMMENT ON COLUMN public.waitlist.utm_term     IS 'Matched keyword via {keyword} ValueTrack';
COMMENT ON COLUMN public.waitlist.utm_content  IS 'Creative/ad ID via {creative} ValueTrack';
COMMENT ON COLUMN public.waitlist.gclid        IS 'Google Click ID (auto-tagging); joinable to Ads click reports';
COMMENT ON COLUMN public.waitlist.landing_path IS 'Path the visitor first landed on, e.g. / or /family-office';
