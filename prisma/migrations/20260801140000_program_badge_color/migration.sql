-- Program badge: staff-chosen colour replaces the fixed tone presets.
--
-- The badge shipped with a closed ProgramBadgeTone enum (hot/new/trending/custom) that
-- decided the chip colour. Staff asked to pick the colour themselves, so any label can now
-- take any colour. The CRM still offers the old names as one-click swatches, but they are
-- an authoring shortcut that resolves to a hex — the column stores the decision, not the
-- route taken to it, so there is no second source of truth to drift.
--
-- Only the BACKGROUND is stored; the text colour is derived from its luminance at render
-- time, so a freely-chosen colour cannot produce an unreadable chip.

ALTER TABLE "programs" ADD COLUMN "badge_color" VARCHAR(7);

-- Carry existing badges across at the exact colours they were rendering, so nothing on the
-- live site changes appearance. These hexes are the resolved values of the semantic tokens
-- the old tones mapped to (danger / success / info), and the neutral card background for
-- "custom".
UPDATE "programs" SET "badge_color" = CASE "badge_tone"::text
  WHEN 'hot'      THEN '#DC2626'
  WHEN 'new'      THEN '#16A34A'
  WHEN 'trending' THEN '#2563EB'
  WHEN 'custom'   THEN '#E5E7EB'
END
WHERE "badge_tone" IS NOT NULL;

-- Backstop: a badge switched on without a resolvable colour would render an invisible
-- chip. Nothing should match after the mapping above — this only catches a row written
-- between the two statements by a concurrent deploy.
UPDATE "programs" SET "badge_color" = '#DC2626'
WHERE "badge_enabled" = true AND "badge_color" IS NULL;

ALTER TABLE "programs" DROP COLUMN "badge_tone";

DROP TYPE "ProgramBadgeTone";
