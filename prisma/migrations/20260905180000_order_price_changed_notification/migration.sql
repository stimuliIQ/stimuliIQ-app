-- `order_price_changed` — the super-admin notification for a manual order reprice.
--
-- ALONE IN ITS OWN MIGRATION ON PURPOSE. Postgres refuses to USE a new enum value in the same
-- transaction that added it ("unsafe use of new value of enum type"), so a migration that both
-- adds the value and inserts a row carrying it fails at deploy. The same split was made for
-- `leave_status_lead_approved`. Nothing here writes the value; the column change that
-- accompanies this feature is the next migration.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'order_price_changed';
