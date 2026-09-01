-- student_profiles.owner_id — who a member belongs to.
--
-- WHY THIS EXISTS
--
-- Ownership lived only on `leads.owner_id`, and a payment reached it through
-- `leads.converted_student_id`. Anyone who was never a lead therefore belonged to nobody:
-- a member enrolled through the onboarding form (P12) has no `leads` row at all, so their
-- payment attributed to no person and appeared in no per-person revenue figure. The money
-- was counted in the company total and silently absent from every individual one — a
-- discrepancy that only ever makes somebody's own number look SMALLER, which is the
-- direction nobody queries.
--
-- NULLABLE on purpose. A self-registered member genuinely belongs to nobody until somebody
-- claims them, and inventing an owner to satisfy NOT NULL is the same fabrication that made
-- `course_type` nullable in P16. Reports render an "Unassigned" bucket rather than dropping
-- the row, so unowned money stays visible instead of vanishing.
ALTER TABLE "student_profiles" ADD COLUMN "owner_id" UUID;

ALTER TABLE "student_profiles"
  ADD CONSTRAINT "student_profiles_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BACKFILL from the lead that converted into this member, so no existing attribution moves.
-- Every figure that reads the new column reproduces exactly what the old three-table join
-- through `leads` produced, and the only rows that change meaning are the ones that had no
-- meaning before: members who never were leads, who go from "attributed to nobody by
-- accident" to "attributed to nobody explicitly", until somebody tags them.
--
-- Deleted leads are excluded to match the reporting query this replaces, which carried
-- `l.deleted_at IS NULL`. A member whose lead was later deleted keeps no owner rather than
-- gaining one the reports never counted.
UPDATE "student_profiles" sp
SET "owner_id" = l."owner_id"
FROM "leads" l
WHERE l."converted_student_id" = sp."id"
  AND l."deleted_at" IS NULL
  AND l."owner_id" IS NOT NULL
  AND sp."owner_id" IS NULL;

-- Every per-owner report filters on (tenant, owner); the team roll-up filters on a SET of
-- owners, which this index serves equally.
CREATE INDEX "student_profiles_tenant_id_owner_id_idx"
  ON "student_profiles"("tenant_id", "owner_id");
