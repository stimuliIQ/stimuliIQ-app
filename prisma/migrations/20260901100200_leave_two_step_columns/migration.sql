-- Two-step leave approval: the first-step reviewer (docs/specs/org-teams.md, ADR-0070).
--
-- ADDITIVE ONLY — three nullable columns. Separate from the enum migration beside it because
-- Postgres will not let a transaction use an enum value it added itself.
--
-- `reviewed_by_id` / `reviewed_at` / `review_note` are KEPT and keep their meaning: the FINAL
-- decision, or the lead who turned the request down at step one. They are not renamed,
-- because every existing row already carries a meaning under those names and a rename would
-- be a lie about history.
ALTER TABLE "leave_requests" ADD COLUMN "lead_approved_by_id" UUID;
ALTER TABLE "leave_requests" ADD COLUMN "lead_approved_at" TIMESTAMP(3);
ALTER TABLE "leave_requests" ADD COLUMN "lead_approval_note" TEXT;

ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_lead_approved_by_id_fkey"
    FOREIGN KEY ("lead_approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
