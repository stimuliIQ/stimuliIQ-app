-- Program display order + marketing badge.
--
-- ORDER: staff had no way to control the sequence programs appear in on the public site.
-- Public listings sorted by rating_count DESC ("popularity") and, since rating_count is
-- null/0 for every current program, the effective order was an unstable Postgres tie-break
-- — programs appeared scrambled relative to how staff added them. The CRM's own table
-- separately sorted created_at DESC, so staff and visitors never even saw the same order.
-- This column becomes the single curated sequence both sides read.
--
-- BADGE: three columns rather than one, because they answer three separate questions —
-- which colour (badge_tone), what text (badge_label), and whether it is currently visible
-- (badge_enabled). Tone is stored rather than inferred from the label so a custom label
-- reading "Hot" cannot silently inherit the preset's red. badge_enabled is independent of
-- the other two so staff can configure a badge once and toggle it seasonally.

CREATE TYPE "ProgramBadgeTone" AS ENUM ('hot', 'new', 'trending', 'custom');

ALTER TABLE "programs" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "programs" ADD COLUMN "badge_tone" "ProgramBadgeTone";
ALTER TABLE "programs" ADD COLUMN "badge_label" VARCHAR(24);
ALTER TABLE "programs" ADD COLUMN "badge_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill `order` from creation time, per tenant. Without this every existing row sits at
-- 0, so the first reorder in the CRM would start from an arbitrary tie rather than a
-- meaningful baseline. Oldest-created-first is the closest available approximation of
-- "the order staff added them" — exactly the sequence the user expected to see.
-- Soft-deleted rows are included so their order values do not collide if restored.
UPDATE "programs" SET "order" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at ASC) - 1 AS rn
  FROM "programs"
) sub
WHERE "programs".id = sub.id;
