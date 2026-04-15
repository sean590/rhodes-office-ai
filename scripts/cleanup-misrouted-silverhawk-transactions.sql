-- Cleanup: delete the 27 capital-call transactions wrongly routed to a single
-- investor on Silverhawk Incline Energy II, LP.
--
-- Background: the chat model invented UUIDs for parent_entity_id (because
-- buildChatContext didn't expose real entity IDs at the time). The apply
-- handler then silently fell back to "any active investor" and attached all
-- 27 transactions to whichever investor was first on the deal. This deletes
-- those rows so you can re-run the chat with the new code (which exposes
-- real UUIDs in context AND fails loudly if the model still gets it wrong).
--
-- Run this in three steps in the Supabase SQL editor — DO NOT run all at
-- once. Verify the SELECT output first, then run the DELETE.
--
-- Step 1: find the investment id by name. Verify before continuing.
--   SELECT id, name FROM investments WHERE name ILIKE '%Silverhawk%Incline%';
--
-- Step 2: see exactly which rows would be deleted. Sanity check:
--   - Should be ~27 rows
--   - Description should be "Capital Call Round 1" through "Capital Call Round 9"
--   - All should belong to the same investment_investor_id (Sean's row)

WITH target_investment AS (
  SELECT id FROM investments WHERE name ILIKE '%Silverhawk%Incline%' LIMIT 1
)
SELECT
  t.id,
  t.transaction_date,
  t.amount,
  t.description,
  t.investment_investor_id,
  e.name AS investor_entity_name
FROM investment_transactions t
JOIN investment_investors ii ON ii.id = t.investment_investor_id
JOIN entities e ON e.id = ii.entity_id
WHERE ii.investment_id = (SELECT id FROM target_investment)
  AND t.description LIKE 'Capital Call Round%'
ORDER BY t.transaction_date, t.created_at;

-- Step 3: if the rows above look right (27 misrouted capital calls all on
-- the same investor entity), run this DELETE. It's wrapped in a transaction
-- with an explicit count so you can verify before committing.

-- BEGIN;
--
-- WITH target_investment AS (
--   SELECT id FROM investments WHERE name ILIKE '%Silverhawk%Incline%' LIMIT 1
-- ),
-- deleted AS (
--   DELETE FROM investment_transactions t
--     USING investment_investors ii
--    WHERE ii.id = t.investment_investor_id
--      AND ii.investment_id = (SELECT id FROM target_investment)
--      AND t.description LIKE 'Capital Call Round%'
--    RETURNING t.id
-- )
-- SELECT count(*) AS deleted_count FROM deleted;
--
-- -- If deleted_count looks right (~27), commit. Otherwise rollback.
-- COMMIT;
-- -- ROLLBACK;
