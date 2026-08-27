-- Course types become CRM-managed DATA instead of a Postgres enum.
--
-- Why: `StudentCourseType` ('btech','degree','diploma','mca','mba','other') was written for
-- the original B.Tech/MCA/MBA audience. Adding or renaming a qualification cost a migration
-- and a deploy, so in practice nobody ever did it and the truth went into "Other". Staff can
-- now maintain the list from Admin ▸ Course types (same call as onboarding_fields in P12).
--
-- Forward-only and additive to existing data: every value currently stored on a student row
-- is carried into `course_types` for that student's tenant, so no student changes meaning and
-- no dropdown loses an option. Nothing else is seeded — a course type is a live business
-- option, and inventing "MBA" for a tenant that has never had one is fabricated data.

-- 1. The option list.
CREATE TABLE "course_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "course_types_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "course_types_tenant_id_active_sort_order_idx" ON "course_types"("tenant_id", "active", "sort_order");
CREATE INDEX "course_types_tenant_id_deleted_at_idx" ON "course_types"("tenant_id", "deleted_at");

-- Prisma cannot express a partial unique — same pattern as onboarding_fields.key.
CREATE UNIQUE INDEX "course_types_tenant_id_key_active_uniq"
    ON "course_types"("tenant_id", "key")
    WHERE "deleted_at" IS NULL;

ALTER TABLE "course_types"
    ADD CONSTRAINT "course_types_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Carry forward exactly the values that are actually in use, per tenant. The labels match
--    what the CRM has always displayed for these six keys, so nothing on screen changes.
INSERT INTO "course_types" ("id", "tenant_id", "key", "label", "sort_order", "active", "created_at", "updated_at")
SELECT
    gen_random_uuid(),
    s."tenant_id",
    s."course_type"::text,
    CASE s."course_type"::text
        WHEN 'btech'   THEN 'B.Tech'
        WHEN 'degree'  THEN 'Degree'
        WHEN 'diploma' THEN 'Diploma'
        WHEN 'mca'     THEN 'MCA'
        WHEN 'mba'     THEN 'MBA'
        WHEN 'other'   THEN 'Other'
        ELSE INITCAP(s."course_type"::text)
    END,
    CASE s."course_type"::text
        WHEN 'btech'   THEN 1
        WHEN 'degree'  THEN 2
        WHEN 'diploma' THEN 3
        WHEN 'mca'     THEN 4
        WHEN 'mba'     THEN 5
        WHEN 'other'   THEN 6
        ELSE 7
    END,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "tenant_id", "course_type" FROM "student_profiles") AS s;

-- 3. The student column becomes the option's key, and becomes nullable: website
--    self-registration and onboarding activation never ask for a course type, and were
--    writing a hardcoded 'btech'/'other' to satisfy the NOT NULL — a fabricated answer.
ALTER TABLE "student_profiles"
    ALTER COLUMN "course_type" TYPE TEXT USING "course_type"::text,
    ALTER COLUMN "course_type" DROP NOT NULL;

DROP TYPE "StudentCourseType";
