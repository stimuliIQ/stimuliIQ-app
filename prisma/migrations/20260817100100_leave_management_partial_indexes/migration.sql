-- Partial unique indexes for leave management, split out of `20260817100000_leave_management`
-- the same way `mentors_partial_indexes` follows `mentors_core`.
--
-- Prisma cannot express `UNIQUE ... WHERE deleted_at IS NULL`, so these constraints exist
-- ONLY here and not in schema.prisma — see docs/phase-11-followups.md's standing note that
-- some UNIQUE constraints live in migration SQL alone, and check the live database rather
-- than the Prisma schema when reasoning about them.
--
-- Partial rather than plain UNIQUE in every case for one reason: soft-deleting a row must
-- not permanently burn its identity. Deleting the "Casual" leave type and later re-adding
-- it, or removing a wrongly-dated holiday and re-entering the right one on the same day,
-- both have to work.

CREATE UNIQUE INDEX "leave_types_tenant_id_key_active_uq"
  ON "leave_types" ("tenant_id", "key") WHERE "deleted_at" IS NULL;

-- One allocation per type per year. This is what makes the yearly quota upsert safe to run
-- repeatedly (the CRM saves the whole year's grid at once) without accumulating duplicates
-- that would silently double somebody's entitlement.
CREATE UNIQUE INDEX "leave_quotas_tenant_id_year_leave_type_id_uq"
  ON "leave_quotas" ("tenant_id", "year", "leave_type_id") WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "holidays_tenant_id_date_uq"
  ON "holidays" ("tenant_id", "date") WHERE "deleted_at" IS NULL;

-- Exactly one working-week configuration per tenant. The API upserts against this, so the
-- index is not merely defensive — it is the thing that makes two concurrent saves converge
-- on one row instead of quietly creating a second the reader would never see.
CREATE UNIQUE INDEX "leave_settings_tenant_id_uq"
  ON "leave_settings" ("tenant_id") WHERE "deleted_at" IS NULL;
