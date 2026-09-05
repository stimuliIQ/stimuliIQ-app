-- CRM-editable overrides of the automatic transactional emails.
--
-- Additive only: one new table, nothing existing is touched. No backfill on purpose — a row
-- here is an OVERRIDE, and seeding one for every key would turn every email into "customised"
-- on day one, hiding which text the company actually wrote and making "reset to default" a
-- no-op. Absence of a row IS the default.
--
-- The unique on (tenant_id, key) is FULL rather than partial-on-deleted_at. Reset soft-deletes,
-- so the row keeps the slot; saving upserts and clears deleted_at rather than inserting a
-- second row. A partial unique here would instead allow two rows for one key, one of them
-- invisible, which is the worse failure.

CREATE TABLE "email_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "footnote" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_templates_tenant_id_key_key" ON "email_templates"("tenant_id", "key");

CREATE INDEX "email_templates_tenant_id_deleted_at_idx" ON "email_templates"("tenant_id", "deleted_at");

ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
