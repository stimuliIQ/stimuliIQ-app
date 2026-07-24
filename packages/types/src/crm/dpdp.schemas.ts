// DPDP erasure contracts — Phase 7, Wave 2 (docs/plans/phase-7.md task #13,
// docs/specs/phase-7-analytics-hardening.md WS-E, AC-64/65/66).
//
// Covers a PRIVILEGED, admin-only "right to be forgotten" action that redacts a
// subject's direct-identifier PII (email, phone, name) inside EXISTING `audit_logs`
// before/after snapshots, WITHOUT deleting the audit rows themselves (Rule H-5,
// AC-64) — an append-only-preserving redaction, not an erasure of the audit trail.
//
// This does NOT delete/anonymize the subject's live business rows (User, enrollments,
// orders, certificates) — those are out of scope for this endpoint (AC-64's own edge
// case: "Business-record rows ... are NOT deleted"). It only reaches historical
// `audit_logs` snapshots that predate the write-time PII masking added alongside this
// endpoint (see apps/api/src/prisma/audit.extension.ts's PII_FIELD_REGISTRY, which
// masks all NEW audit rows going forward).
//
// Permission: `dpdp.erasure.execute` — scope=all, granted ONLY to super_admin/admin
// (docs/specs/phase-7-analytics-hardening.md Part 8 RBAC table). AC-65: a non-privileged
// caller triggering erasure for another user's data must be rejected (403).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";

/** POST /dpdp/erasure body — identifies the subject whose historical audit PII is redacted. */
export const DpdpErasureRequestSchema = z
  .object({
    subjectUserId: UuidSchema,
  })
  .strict();
export type DpdpErasureRequest = z.infer<typeof DpdpErasureRequestSchema>;

/** POST /dpdp/erasure response — a summary of what was redacted, never the raw PII itself. */
export const DpdpErasureResponseSchema = z
  .object({
    subjectUserId: UuidSchema,
    /** Count of audit_logs rows whose before/after snapshot had at least one PII field redacted. */
    redactedRowCount: z.number().int().nonnegative(),
    /** Whether this run found nothing left to redact (a repeat/idempotent erasure request). */
    alreadyRedacted: z.boolean(),
    processedAt: IsoDateTimeSchema,
  })
  .strict();
export type DpdpErasureResponse = z.infer<typeof DpdpErasureResponseSchema>;
