-- Move the two gamification leaderboard flags OUT of `notification_prefs.matrix`
-- and into first-class columns.
--
-- WHY
--   `GamificationRepository.upsertGamificationPrefs` wrote `leaderboardOptIn` and
--   `leaderboardDisplayName` as keys *inside* the `matrix` JSON column. That column
--   is the type×channel notification matrix, and its published contract
--   (`NotificationPrefMatrixSchema` in @repo/types) is `.strict()` and admits only
--   NotificationType keys mapping to a full ChannelPrefs object.
--
--   The result was a broken round trip on a user who had ever touched the leaderboard
--   opt-in: `GET /api/v1/me/notification-prefs` returned
--       { "matrix": { "leaderboardOptIn": false } }
--   and feeding that straight back to `PUT /api/v1/me/notification-prefs` failed with
--   400 validation.failed. A client could not send back what the server had just given
--   it, and the row no longer carried any real notification-type preferences.
--
-- FORWARD-ONLY and idempotent-safe: adds the columns, backfills them from whatever is
-- currently in the JSON, then strips both keys from `matrix` so the column once again
-- satisfies its own schema.

ALTER TABLE "notification_prefs"
  ADD COLUMN IF NOT EXISTS "leaderboard_opt_in" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "leaderboard_display_name" TEXT;

-- Backfill from the matrix JSON before removing the keys.
UPDATE "notification_prefs"
SET "leaderboard_opt_in" = COALESCE(("matrix" ->> 'leaderboardOptIn')::boolean, false)
WHERE "matrix" ? 'leaderboardOptIn';

UPDATE "notification_prefs"
SET "leaderboard_display_name" = NULLIF("matrix" ->> 'leaderboardDisplayName', '')
WHERE "matrix" ? 'leaderboardDisplayName';

-- Strip the two non-NotificationType keys so `matrix` validates against
-- NotificationPrefMatrixSchema again.
UPDATE "notification_prefs"
SET "matrix" = ("matrix" - 'leaderboardOptIn') - 'leaderboardDisplayName'
WHERE "matrix" ? 'leaderboardOptIn'
   OR "matrix" ? 'leaderboardDisplayName';
