-- Staff leave management (docs/specs/leave-management.md, ADR-0065).
--
-- Staff apply for time off, the super_admin approves or rejects, and one shared calendar
-- shows public holidays, weekly offs and who is out. Nothing in the product modelled staff
-- absence before this: the retired `attendance` table hangs off `enrollments` (students),
-- so it is structurally unrelated and is deliberately not extended here.
--
-- WHY DURATIONS ARE INTEGER HALF-DAYS (`half_days`), NOT A DECIMAL:
--   Half-day leave is a hard requirement, and 0.5 is not exactly representable in binary
--   floating point. This database contains no DECIMAL/NUMERIC column anywhere — money is
--   stored as integer paise (CLAUDE.md §3.6) — and leave follows the same discipline. The
--   API divides by two on the way out, so the UI still reads "3.5 days" while the database
--   only ever sees whole numbers and a balance can never drift by a rounding error.
--
-- WHY THERE IS NO BALANCE COLUMN AND NO LEDGER TABLE:
--   Remaining = leave_quotas.half_days for the year MINUS the SUM of half_days over that
--   user's APPROVED requests for that type and year. With a staff-sized table that
--   aggregate is trivial. A stored balance is a second source of truth, and it drifts the
--   first time a request is cancelled through a path that forgets to credit it back.
--
-- WHY FOUR CONFIG TABLES RATHER THAN ONE JSON SETTINGS BLOB:
--   leave_types, leave_quotas and holidays are all list-shaped things staff add to and
--   delete from one row at a time, and every one of them is read inside the transaction
--   that creates a request. They need indexes and foreign keys, not a JSON lookup.
--   leave_settings is the one genuinely singleton row (the working week), and it is a typed
--   INTEGER[] for the same reason.
--
-- WHY leave_quotas IS TENANT-WIDE AND NOT PER STAFF MEMBER:
--   The allocation is a single company-wide policy per type per year. A per-user override
--   table would be machinery for a rule nobody has asked for; if it is ever needed, the
--   balance calculation is the only code that would have to learn about it.
--
-- A REQUEST MAY NOT SPAN A CALENDAR YEAR. The quota is per year, so one row cannot deduct
-- from two. The API rejects it with a 422 asking the applicant to split it, rather than
-- silently charging the whole thing to the starting year.

-- Only the FIRST and LAST day of a request can be half — a half day in the middle of a
-- range is not something anyone means by it.
CREATE TYPE "LeaveDayPart" AS ENUM ('full', 'first_half', 'second_half');

-- `pending` is the only state the system sets by itself. `approved`/`rejected` are always a
-- named super_admin's decision (recorded in reviewed_by_id); `cancelled` is the requester
-- withdrawing, and is the only transition the applicant can make themselves. There is no
-- path back to `pending` — re-opening a decided request would erase who decided it.
CREATE TYPE "LeaveRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

CREATE TABLE "leave_types" (
  "id"             UUID NOT NULL,
  "tenant_id"      UUID NOT NULL,
  "key"            TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "paid"           BOOLEAN NOT NULL DEFAULT true,
  "allow_half_day" BOOLEAN NOT NULL DEFAULT true,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "sort_order"     INTEGER NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  "deleted_at"     TIMESTAMP(3),
  CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "leave_quotas" (
  "id"            UUID NOT NULL,
  "tenant_id"     UUID NOT NULL,
  "leave_type_id" UUID NOT NULL,
  "year"          INTEGER NOT NULL,
  "half_days"     INTEGER NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  "deleted_at"    TIMESTAMP(3),
  CONSTRAINT "leave_quotas_pkey" PRIMARY KEY ("id")
);

-- `optional` marks a restricted/optional holiday: shown on the calendar but still counted
-- as a working day, because taking it is a choice the person makes by applying for leave.
CREATE TABLE "holidays" (
  "id"          UUID NOT NULL,
  "tenant_id"   UUID NOT NULL,
  "date"        DATE NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "optional"    BOOLEAN NOT NULL DEFAULT false,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "deleted_at"  TIMESTAMP(3),
  CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- weekly_off_days: 0 = Sunday … 6 = Saturday. Default '{0}' — a six-day week is still the
-- norm in this market, so Sunday-only is the default that surprises the fewest people.
CREATE TABLE "leave_settings" (
  "id"              UUID NOT NULL,
  "tenant_id"       UUID NOT NULL,
  "weekly_off_days" INTEGER[] NOT NULL DEFAULT ARRAY[0]::INTEGER[],
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  "deleted_at"      TIMESTAMP(3),
  CONSTRAINT "leave_settings_pkey" PRIMARY KEY ("id")
);

-- `half_days` is computed SERVER-SIDE from the tenant's weekly offs and holidays and then
-- STORED, rather than recomputed on read: editing next year's holiday list must not
-- silently rewrite the length of leave somebody already took.
--
-- `user_id` is always the authenticated actor — the API never accepts a user id on create,
-- so nobody can file leave in a colleague's name.
CREATE TABLE "leave_requests" (
  "id"             UUID NOT NULL,
  "tenant_id"      UUID NOT NULL,
  "user_id"        UUID NOT NULL,
  "leave_type_id"  UUID NOT NULL,
  "start_date"     DATE NOT NULL,
  "end_date"       DATE NOT NULL,
  "start_day_part" "LeaveDayPart" NOT NULL DEFAULT 'full',
  "end_day_part"   "LeaveDayPart" NOT NULL DEFAULT 'full',
  "half_days"      INTEGER NOT NULL,
  "reason"         TEXT NOT NULL,
  "status"         "LeaveRequestStatus" NOT NULL DEFAULT 'pending',
  "reviewed_by_id" UUID,
  "reviewed_at"    TIMESTAMP(3),
  "review_note"    TEXT,
  "cancelled_at"   TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  "deleted_at"     TIMESTAMP(3),
  CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leave_types_tenant_id_active_sort_order_idx" ON "leave_types" ("tenant_id", "active", "sort_order");
CREATE INDEX "leave_types_tenant_id_deleted_at_idx" ON "leave_types" ("tenant_id", "deleted_at");

CREATE INDEX "leave_quotas_tenant_id_year_idx" ON "leave_quotas" ("tenant_id", "year");
CREATE INDEX "leave_quotas_tenant_id_deleted_at_idx" ON "leave_quotas" ("tenant_id", "deleted_at");

CREATE INDEX "holidays_tenant_id_date_idx" ON "holidays" ("tenant_id", "date");
CREATE INDEX "holidays_tenant_id_deleted_at_idx" ON "holidays" ("tenant_id", "deleted_at");

CREATE INDEX "leave_settings_tenant_id_deleted_at_idx" ON "leave_settings" ("tenant_id", "deleted_at");

-- (tenant_id, status, start_date) drives the approval queue; (tenant_id, user_id,
-- start_date) drives both "my leave" and the balance aggregate; (tenant_id, start_date,
-- end_date) drives the calendar's date-range scan and the overlap check on create.
CREATE INDEX "leave_requests_tenant_id_status_start_date_idx" ON "leave_requests" ("tenant_id", "status", "start_date");
CREATE INDEX "leave_requests_tenant_id_user_id_start_date_idx" ON "leave_requests" ("tenant_id", "user_id", "start_date");
CREATE INDEX "leave_requests_tenant_id_start_date_end_date_idx" ON "leave_requests" ("tenant_id", "start_date", "end_date");
CREATE INDEX "leave_requests_tenant_id_deleted_at_idx" ON "leave_requests" ("tenant_id", "deleted_at");

ALTER TABLE "leave_types"
  ADD CONSTRAINT "leave_types_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leave_quotas"
  ADD CONSTRAINT "leave_quotas_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "holidays"
  ADD CONSTRAINT "holidays_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leave_settings"
  ADD CONSTRAINT "leave_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT on leave_type_id (both tables): a leave type is soft-deleted, never hard-deleted,
-- so this constraint should only ever fire if somebody bypasses the application to remove a
-- type that historical requests still point at. Losing the label on somebody's past leave
-- is worse than the failed delete.
ALTER TABLE "leave_quotas"
  ADD CONSTRAINT "leave_quotas_leave_type_id_fkey"
  FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_leave_type_id_fkey"
  FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT on the applicant: a leave record is evidence of an approved absence and must
-- outlive routine account churn. Users are soft-deleted here anyway.
ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL on the reviewer: offboarding the super_admin who approved something must not
-- cascade away the approval itself.
ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
