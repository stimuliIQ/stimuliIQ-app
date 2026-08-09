-- Lead ownership + accountability pass.
--
-- Problem this solves: assigning a lead to a staff member was a silent single-column
-- UPDATE. Nothing recorded WHO handed the lead over, nothing recorded when the assignee
-- first actually made contact, and nothing told the assignee it had happened. The audit
-- log does hold "user X changed owner_id" rows, but it is an append-only, admin-only,
-- polymorphic table — fine for forensics on ONE record, hopeless as the source for a
-- per-rep performance report that has to aggregate thousands of leads over a date range.
--
-- So we denormalise the five facts a lead-management report actually needs onto the lead
-- row itself. All five are nullable and all five default to NULL for every existing row:
-- this migration cannot change the meaning of any lead already in the table.
--
--   created_by_id       staff user who keyed the lead in by hand. NULL = inbound (website
--                       form, book-a-slot, newsletter, API). NULL is MEANINGFUL here —
--                       it distinguishes "marketing sourced this" from "the web did".
--   assigned_by_id      staff user who set the CURRENT owner. NULL = round-robin picked
--                       it; no human made this call.
--   assigned_at         when the current owner was set. Powers time-to-assignment and
--                       the "newest on your desk" ordering.
--   first_contacted_at  first call/whatsapp/email/note logged against the lead. WRITE
--                       ONCE — the service only sets it when it is still NULL, because
--                       overwriting it would destroy the first-response-time metric.
--   last_activity_at    most recent logged activity; drives the "going cold" sort.
--
-- Backfill is deliberately NOT attempted. created_by_id / assigned_by_id for historic
-- leads are only recoverable from audit_logs, and a partial, best-effort backfill would
-- produce a report that silently mixes real and inferred attribution. Historic leads read
-- as "unattributed", which is honest; the report is correct from this migration forward.

ALTER TABLE "leads" ADD COLUMN "created_by_id" UUID;
ALTER TABLE "leads" ADD COLUMN "assigned_by_id" UUID;
ALTER TABLE "leads" ADD COLUMN "assigned_at" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "first_contacted_at" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "last_activity_at" TIMESTAMP(3);

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_assigned_by_id_fkey"
  FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The two report queries this table now has to serve fast:
--   "leads created by X between from..to"  and  "leads assigned to X between from..to".
CREATE INDEX "leads_tenant_id_created_by_id_created_at_idx"
  ON "leads" ("tenant_id", "created_by_id", "created_at");
CREATE INDEX "leads_tenant_id_owner_id_assigned_at_idx"
  ON "leads" ("tenant_id", "owner_id", "assigned_at");

-- Staff-facing notification type: "a lead was just assigned to you".
-- Safe inside Prisma's migration transaction on PG 12+ because the new label is only
-- ADDED here — it is not read or written by any statement in this same transaction.
ALTER TYPE "NotificationType" ADD VALUE 'lead_assigned';
