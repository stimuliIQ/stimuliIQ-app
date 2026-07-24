-- Migration: payment_reference
-- Adds nullable `reference` column to the `payments` table for offline payment audit trail.
-- ManualPaymentRequestSchema requires a `reference` field (cheque/NEFT/receipt no.) but it
-- was previously not persisted — M-6 security fix adds this column so the key audit artifact
-- for offline money-in events is not silently discarded.
-- Also adds optional `notes` column for staff free-text annotations on manual payments.
-- Both columns are nullable: only manual/offline payments will carry these values.
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8).

ALTER TABLE "payments"
  ADD COLUMN "reference" TEXT,
  ADD COLUMN "notes" TEXT;
