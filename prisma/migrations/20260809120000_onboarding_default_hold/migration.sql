-- Onboarding submissions arrive ON HOLD.
--
-- The CRM review drawer now offers exactly two decisions — Accept and Reject — so
-- "pending" (system-set, nobody has looked) and "hold" (a human parked it) described the
-- same state and split the queue across two filters for no benefit. `hold` wins because it
-- is the word staff use; `pending` is left in the enum because dropping a Postgres enum
-- value is not a safe forward-only migration (CLAUDE.md §3.8) and old backups must parse.
--
-- Forward-only and additive: no column is dropped, no data is lost — every `pending` row
-- moves to the state it already meant.

ALTER TABLE "onboarding_submissions" ALTER COLUMN "status" SET DEFAULT 'hold';

UPDATE "onboarding_submissions" SET "status" = 'hold' WHERE "status" = 'pending';
