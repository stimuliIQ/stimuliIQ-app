-- Remove feature flags entirely.
--
-- The seam was built complete in Phase 9 (T9/T14/T23) — table, CRM screen, RBAC-gated CRUD,
-- and a Redis-cached `GET /feature-flags/evaluate` designed to be called by every
-- authenticated surface — and then never used. Nothing in `web`, `lms`, `api` or `crm` ever
-- evaluated a flag; the single seeded flag (`live_class_reminders`) was read by no code, so
-- the toggle in Admin ▸ Feature Flags wrote a row and changed no behaviour.
--
-- An admin switch that appears to control something and does not is worse than no switch:
-- sooner or later someone flips it during an incident and believes they have acted. Removed
-- rather than left in place, and rather than wired up to something for the sake of it.
--
-- DESTRUCTIVE, deliberately: this drops the table and its data. That data is one seeded row
-- per environment describing a feature that no longer consults it. Everything needed to
-- bring the seam back lives in git history (the module, the schema block and the screen were
-- deleted in the same change).
--
-- The two RBAC keys go with it. `role_permissions` rows are removed first so the
-- `permissions` delete cannot fail on a foreign key; both tables are otherwise untouched.

DROP TABLE IF EXISTS "feature_flags";

DELETE FROM "role_permissions"
WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "key" IN ('flags.view', 'flags.edit'));

DELETE FROM "permissions" WHERE "key" IN ('flags.view', 'flags.edit');
