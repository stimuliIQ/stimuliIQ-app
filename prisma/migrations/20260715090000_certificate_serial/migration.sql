-- Certificate short serial (STMQ-YYYY-XXXX-XXXX) — a SHORT, human-typeable public
-- identifier alongside the long HMAC-signed cert_uid (see ADR-0061). Lets someone
-- read the ID off a printed certificate and type it into /verify; the long cert_uid
-- stays the QR/link id. Forward-only, additive (CLAUDE.md §3.8).
--
-- NOTE: hand-written (not `prisma migrate dev` diff output), matching the established
-- precedent in this repo (e.g. 20260709100000_certificate_template_layout) — the live
-- DB carries intentional raw-SQL drift (generated search_vector columns, timestamp
-- drift) that the interactive diff engine would try to "fix" by dropping. This applies
-- ONLY the single additive column + its backfill + unique index.
--
-- Steps:
--   1. Add the column nullable so existing rows survive the ALTER.
--   2. Backfill every existing certificate with a unique serial. The random half uses
--      Crockford base32 (alphabet excludes I/L/O/U). random() is fine here — this is a
--      one-time backfill of existing dev/seed data, not a security boundary; the app
--      mints serials with crypto-strong randomness going forward.
--   3. Enforce NOT NULL + UNIQUE (matches `serial String @unique` in schema.prisma).

ALTER TABLE "certificates" ADD COLUMN "serial" TEXT;

DO $$
DECLARE
  r RECORD;
  alphabet TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; -- Crockford base32 (no I/L/O/U)
  candidate TEXT;
  i INT;
BEGIN
  FOR r IN SELECT "id", "issued_at" FROM "certificates" WHERE "serial" IS NULL LOOP
    LOOP
      candidate := 'STMQ-' || to_char(r."issued_at", 'YYYY') || '-';
      FOR i IN 1..8 LOOP
        IF i = 5 THEN
          candidate := candidate || '-';
        END IF;
        candidate := candidate || substr(alphabet, 1 + floor(random() * 32)::int, 1);
      END LOOP;
      -- candidate is now STMQ-YYYY-XXXX-XXXX; retry on the (astronomically rare) clash.
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "certificates" WHERE "serial" = candidate);
    END LOOP;
    UPDATE "certificates" SET "serial" = candidate WHERE "id" = r."id";
  END LOOP;
END $$;

ALTER TABLE "certificates" ALTER COLUMN "serial" SET NOT NULL;

CREATE UNIQUE INDEX "certificates_serial_key" ON "certificates"("serial");
