// Certificate contracts — Phase 4, Wave 2
// (docs/plans/phase-4.md task #2, docs/specs/phase-4-learning-depth.md).
//
// Design decisions:
//   - One certificate per enrollment (unique FK). Reissue soft-deletes the old row.
//   - cert_uid is a server-signed hash; public verify RECOMPUTES the signature.
//     A fabricated row or guessed uid fails even if it exists in the DB (plan §6 Risk #2).
//   - VerifyResultDto is MINIMAL: { valid, status, program, issuedAt, holderName }.
//     No internal IDs, no enrollment ID, no student email, no payment data (plan §7 Q6,
//     docs/specs AC-H7). This is a hard security requirement.
//   - Download returns a short-lived signed GET URL via StorageProvider.
//     Raw bucket URLs are never returned (AC-I2).
//   - Revocation is instant: the next public verify call reflects it immediately.
//     No cache window (AC-G2).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

export const CertificateStatusSchema = z.enum(["valid", "revoked"]);
export type CertificateStatus = z.infer<typeof CertificateStatusSchema>;

/**
 * WHICH of the two certificates this is. A student can hold one of each for the same
 * enrollment — the DB's partial-unique is on (enrollment_id, kind).
 *
 *   training   — earned by finishing the BATCH. Auto-issued to EVERY active enrollment in
 *                a batch the moment it closes, with no eligibility gate: being in the
 *                batch is the bar.
 *   internship — earned by doing the WORK. Issued only after a project submission has been
 *                verified by staff in CRM ▸ Projects.
 *
 * When the batch's program has no project attached there is nothing to verify, so both are
 * issued together at batch close.
 */
export const CertificateKindSchema = z.enum(["training", "internship"]);
export type CertificateKind = z.infer<typeof CertificateKindSchema>;

/** Human label for a kind — one definition, so CRM/LMS/PDF never drift. */
export const CERTIFICATE_KIND_LABEL: Record<CertificateKind, string> = {
  training: "Training Certificate",
  internship: "Internship Certificate",
};

// ─────────────────────────────────────────────────────────────────────────
// Certificate serial — the SHORT, human-typeable public identifier
// ─────────────────────────────────────────────────────────────────────────
//
// Format: STMQ-<YYYY>-XXXX-XXXX where the 8 X's are Crockford base32
// (alphabet 0-9 A-H J K M N P-T V-Z — excludes the visually ambiguous
// I, L, O, U). ~40 bits of entropy in the random half, so it is short enough
// to read off a printed certificate and type into the /verify form, yet not
// practically enumerable. It is a SECOND way to reach a certificate; the long,
// HMAC-signed `certUid` remains the QR/link identifier (unguessable by design).
//
// SECURITY NOTE: unlike `certUid`, the serial is NOT signed — verification by
// serial is a plain (rate-limited) DB lookup that returns only the same public
// display fields. Enumeration resistance comes from the entropy above plus the
// per-IP rate limiter on the public verify endpoint.

/** Crockford base32 char class (excludes I, L, O, U). */
const CROCKFORD_CLASS = "[0-9A-HJKMNP-TV-Z]";

/** Canonical serial regex: STMQ-YYYY-XXXX-XXXX (uppercase, grouped 4-4). */
export const CERT_SERIAL_REGEX = new RegExp(
  `^STMQ-\\d{4}-${CROCKFORD_CLASS}{4}-${CROCKFORD_CLASS}{4}$`,
);

export const CertificateSerialSchema = z
  .string()
  .regex(CERT_SERIAL_REGEX, "Invalid certificate serial format (expected STMQ-YYYY-XXXX-XXXX).");

/**
 * Normalise raw user input toward the canonical serial form: trim, uppercase,
 * and strip spaces. Returns the normalised string unchanged if it does not look
 * like a serial (so a case-sensitive base64url `certUid` is never mangled).
 *
 * Shared FE + BE so the entry form and the verify endpoint agree on what counts
 * as a serial.
 */
export function normalizeCertificateSerial(input: string): string {
  const trimmed = input.trim();
  // Only fold case for serial-shaped input; a certUid is base64url (case-sensitive).
  if (/^stmq-/i.test(trimmed)) {
    return trimmed.replace(/\s+/g, "").toUpperCase();
  }
  return trimmed;
}

/** True when the (already-normalised) input matches the canonical serial format. */
export function isCertificateSerial(input: string): boolean {
  return CERT_SERIAL_REGEX.test(input);
}

// ─────────────────────────────────────────────────────────────────────────
// Eligibility (eligibility engine result, used in CRM eligibility list)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Result of the eligibility engine for a single enrollment.
 * Returned by GET /crm/certificates/eligibility/:enrollmentId.
 * Matches the canonical TypeScript signature in docs/specs §Part 2.
 */
export const EligibilityResultSchema = z.object({
  eligible: z.boolean(),
  reasons: z.object({
    completionPct: z.number().int().min(0).max(100).describe("enrollment.progress_pct value."),
    completionPassed: z.boolean().describe("completion_pct >= 90 (COMPLETION_THRESHOLD)."),
    requiredAssessmentsPassed: z.boolean().describe(
      "All assessments with is_required=true have a passing attempt (passed=true).",
    ),
    finalProjectApproved: z.boolean().describe(
      "The final project (is_final=true) has all milestones graded. " +
        "Vacuously true if no is_final=true assignment exists.",
    ),
  }),
  recommendedAt: IsoDateTimeSchema.nullable().describe(
    "When a faculty member flagged this enrollment as recommended for issuance. Null if not recommended.",
  ),
});
export type EligibilityResult = z.infer<typeof EligibilityResultSchema>;

/**
 * Eligibility list row (CRM Content > Certificates view).
 */
export const EligibilityListItemSchema = z.object({
  enrollmentId: UuidSchema,
  studentId: UuidSchema,
  studentName: z.string(),
  programId: UuidSchema,
  programTitle: z.string(),
  batchId: UuidSchema,
  batchName: z.string(),
  eligibility: EligibilityResultSchema,
  certificateStatus: CertificateStatusSchema.nullable().describe(
    "Current certificate status, or null if no certificate has been issued.",
  ),
  certificateId: UuidSchema.nullable(),
  certUid: z.string().nullable().describe("The long signed verification uid. Null if not issued."),
  serial: CertificateSerialSchema.nullable().describe(
    "Short human-typeable public certificate ID. Null if not issued.",
  ),
  issuedAt: IsoDateTimeSchema.nullable(),
});
export type EligibilityListItem = z.infer<typeof EligibilityListItemSchema>;

/**
 * One row of the BATCH-FIRST landing view of CRM ▸ Certificates
 * (GET /crm/certificates/eligibility-batches). Reviewers work cohort-first:
 * they open the page to clear one batch, so the page opens on batches and
 * drills into `GET /crm/certificates/eligibility?batchId=…` for the students.
 *
 * Every count here is a plain aggregate over `enrollments`/`certificates` —
 * deliberately NOT the three-gate eligibility engine, which costs ~5 queries
 * per enrollment (running it across every batch just to paint a landing page
 * would be an N+1 sweep). `completionReadyCount` is the one gate that IS a
 * single column read, so it is named for exactly what it measures and is never
 * presented as "eligible": the other two gates are only resolved on drill-in.
 */
export const EligibilityBatchSummarySchema = z.object({
  batchId: UuidSchema,
  batchName: z.string(),
  programId: UuidSchema,
  programTitle: z.string(),
  studentCount: z.number().int().min(0).describe(
    "COUNT(enrollments) WHERE batch_id=B AND status IN ('active','completed'), the same " +
      "non-dropped population the eligibility list itself pages over.",
  ),
  issuedCount: z.number().int().min(0).describe(
    "COUNT of those enrollments holding a certificate with status='valid'.",
  ),
  revokedCount: z.number().int().min(0).describe(
    "COUNT of those enrollments whose only live certificate row is status='revoked' (needs a reissue).",
  ),
  completionReadyCount: z.number().int().min(0).describe(
    "COUNT of those enrollments with progress_pct >= 90 (the COMPLETION gate ALONE, assessments " +
      "and final project are NOT checked here). A hint for which batch to open, never an eligibility verdict.",
  ),
});
export type EligibilityBatchSummary = z.infer<typeof EligibilityBatchSummarySchema>;

// ─────────────────────────────────────────────────────────────────────────
// CRM author/ops DTOs
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/crm/certificates
 *
 * Ops issues a certificate for an eligible enrollment.
 * Server runs eligibility engine before creating the cert row.
 * On success: generates cert_uid (signed), renders PDF (CertificatePdfPort),
 * stores PDF via StorageProvider, inserts certificates row.
 * Writes an audit log entry (issued_at, issued_by, enrollment_id).
 *
 * Permission: certificates.issue (scope: all | branch per RBAC matrix).
 * Errors:
 *   422 NOT_ELIGIBLE (with reasons object)
 *   409 CERTIFICATE_ALREADY_EXISTS (if valid cert exists for enrollment)
 *   409 CERTIFICATE_REVOKED_REISSUE (if revoked cert exists — use reissue endpoint instead)
 */
export const IssueCertificateRequestSchema = z
  .object({
    enrollmentId: UuidSchema.describe("The enrollment to issue the certificate for."),
    kind: CertificateKindSchema.default("training").describe(
      "Which certificate to issue. `training` skips the eligibility gate entirely, batch " +
        "completion is the bar. `internship` is normally issued by verifying a project " +
        "submission in CRM ▸ Projects rather than through this endpoint.",
    ),
    templateId: UuidSchema.describe(
      "The seeded CertificateTemplate to use for rendering the PDF.",
    ),
    overrideEligibility: z
      .boolean()
      .default(false)
      .describe(
        "Admin override to issue even if eligibility gates are not fully met. " +
          "Requires certificates.issue + all scope. Audited.",
      ),
  })
  .strict();
export type IssueCertificateRequest = z.infer<typeof IssueCertificateRequestSchema>;

/**
 * POST /api/v1/crm/certificates/bulk (Phase-9-completion gap #7)
 *
 * Issues a certificate for a LIST of eligible enrollments in ONE audited call —
 * replaces the CRM bulk-issue dialog's former client-side per-row loop
 * (apps/crm/src/components/certificates/bulk-issue-dialog.tsx). Runs the SAME
 * per-enrollment eligibility + duplicate checks as POST /crm/certificates for
 * EACH enrollmentId; one row failing does not abort the others (partial success
 * is expected — same UX contract `BulkActionResponse` already offers elsewhere).
 * Every successful issuance still writes its own `certificate.issue` audit row
 * (same as the single-issue path); this endpoint additionally writes ONE
 * `certificate.bulk_issue` summary audit row.
 *
 * Permission: certificates.issue (scope: all | branch).
 */
export const BulkIssueCertificatesRequestSchema = z
  .object({
    enrollmentIds: z.array(UuidSchema).min(1).max(200),
    templateId: UuidSchema,
    kind: CertificateKindSchema.default("training"),
    overrideEligibility: z.boolean().default(false),
  })
  .strict();
export type BulkIssueCertificatesRequest = z.infer<typeof BulkIssueCertificatesRequestSchema>;

export const BulkIssueCertificateResultSchema = z.object({
  enrollmentId: UuidSchema,
  success: z.boolean(),
  certificateId: UuidSchema.nullable().describe("Set when success=true."),
  errorCode: z.string().nullable().describe("Machine-readable error code when success=false (e.g. NOT_ELIGIBLE, CERTIFICATE_ALREADY_EXISTS)."),
  errorMessage: z.string().nullable(),
});
export type BulkIssueCertificateResult = z.infer<typeof BulkIssueCertificateResultSchema>;

export const BulkIssueCertificatesResponseSchema = z.object({
  results: z.array(BulkIssueCertificateResultSchema),
  successCount: z.number().int().min(0),
  failureCount: z.number().int().min(0),
});
export type BulkIssueCertificatesResponse = z.infer<typeof BulkIssueCertificatesResponseSchema>;

/**
 * POST /api/v1/crm/certificates/:enrollmentId/recommend
 *
 * Faculty recommends an enrollment for certificate issuance (flag only, no cert row).
 * The recommendation timestamp is stored and shown in the eligibility list.
 *
 * Permission: certificates.recommend (scope: assigned).
 */
export const RecommendCertificateRequestSchema = z
  .object({
    note: z.string().max(1000).optional().describe("Optional faculty note for the recommendation."),
  })
  .strict();
export type RecommendCertificateRequest = z.infer<typeof RecommendCertificateRequestSchema>;

/**
 * PATCH /api/v1/crm/certificates/:id/revoke
 *
 * Ops revokes an issued certificate. Revocation is instant (no cache window).
 * The cert_uid no longer resolves to `valid` on the public verify endpoint.
 * Writes an audit log entry (revoked_at, revoked_by, revoked_reason, enrollment_id).
 *
 * Permission: certificates.revoke (scope: all).
 * Error: 409 ALREADY_REVOKED if already revoked.
 */
export const RevokeCertificateRequestSchema = z
  .object({
    reason: z.string().min(1).max(1000).describe("Reason for revocation (required, audited)."),
  })
  .strict();
export type RevokeCertificateRequest = z.infer<typeof RevokeCertificateRequestSchema>;

/**
 * POST /api/v1/crm/certificates/:enrollmentId/reissue
 *
 * Ops reissues a revoked certificate.
 * Old certificate row is soft-deleted; a new cert row + cert_uid + PDF is created.
 * The old cert_uid is invalidated (soft-deleted row → 404 on public verify, AC-G4).
 * Writes an audit log entry.
 *
 * Permission: certificates.issue (scope: all | branch).
 */
export const ReissueCertificateRequestSchema = z
  .object({
    templateId: UuidSchema.optional().describe("Template to use for the new cert. Defaults to the original template."),
  })
  .strict();
export type ReissueCertificateRequest = z.infer<typeof ReissueCertificateRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs — Student view (LMS /me/certificates)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Certificate list item — student view (GET /me/certificates).
 * No raw storage URLs. Download is via /me/certificates/:id/download.
 */
export const CertificateListItemSchema = z.object({
  id: UuidSchema,
  certUid: z.string().describe("The long, HMAC-signed verification uid. Used for the QR/link."),
  serial: CertificateSerialSchema.describe(
    "Short, human-typeable public certificate ID (STMQ-YYYY-XXXX-XXXX). " +
      "Printed on the certificate; can be typed into /verify.",
  ),
  programId: UuidSchema,
  programTitle: z.string(),
  kind: CertificateKindSchema,
  status: CertificateStatusSchema,
  issuedAt: IsoDateTimeSchema,
  revokedAt: IsoDateTimeSchema.nullable(),
  verifyUrl: z.string().url().describe("Public verification URL (e.g. https://stimuliiq.com/verify/<certUid>)."),
});
export type CertificateListItem = z.infer<typeof CertificateListItemSchema>;

/**
 * Certificate detail — student view (GET /me/certificates/:id).
 * Never includes storage_key or any raw bucket URL.
 */
export const CertificateDetailSchema = CertificateListItemSchema.extend({
  enrollmentId: UuidSchema,
  templateName: z.string(),
  issuedByName: z.string().describe("Display name of the staff member who issued the certificate."),
  revokedReason: z.string().nullable(),
});
export type CertificateDetail = z.infer<typeof CertificateDetailSchema>;

/**
 * Download response — GET /me/certificates/:id/download
 *
 * Returns a short-lived signed GET URL for the certificate PDF.
 * The URL is minted by StorageProvider and expires quickly.
 * NEVER a raw bucket URL.
 *
 * Errors:
 *   410 CERTIFICATE_REVOKED if status=revoked
 *   404 if no certificate row exists
 */
export const CertificateDownloadResponseSchema = z.object({
  downloadUrl: z.string().url().describe(
    "Short-lived signed GET URL for the certificate PDF. Expires at expiresAt. " +
      "NOT a raw S3/R2 URL. Re-call this endpoint to get a fresh URL.",
  ),
  expiresAt: IsoDateTimeSchema.describe("When the signed URL expires."),
  filename: z.string().describe("Suggested filename for download (e.g. 'Certificate-ProgramName.pdf')."),
});
export type CertificateDownloadResponse = z.infer<typeof CertificateDownloadResponseSchema>;

/**
 * Query for the CRM download — GET /crm/certificates/:id/download
 *
 * `disposition` decides whether the signed URL forces a save or renders in place, and it
 * exists because staff need BOTH. The CRM shows the certificate inside a preview panel so a
 * reviewer can see the document a student receives without leaving the queue, and a browser
 * will not render a PDF served as `Content-Disposition: attachment` — it downloads it. The
 * same panel's Download button asks for `attachment`, which is also what makes saving work
 * cross-origin, since the HTML `download` attribute is ignored for a foreign origin.
 *
 * Default `attachment`, matching the student's own download: a caller that says nothing gets
 * a file, not a render.
 */
export const CertificateDownloadQuerySchema = z.object({
  disposition: z
    .enum(["attachment", "inline"])
    .default("attachment")
    .describe("attachment = force save (default); inline = render in a viewer or a frame."),
});
export type CertificateDownloadQuery = z.infer<typeof CertificateDownloadQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// CRM certificate detail (ops view — includes enrollment + student info)
// ─────────────────────────────────────────────────────────────────────────

export const CertificateCrmDetailSchema = z.object({
  id: UuidSchema,
  certUid: z.string(),
  serial: CertificateSerialSchema.describe("Short human-typeable public certificate ID (STMQ-YYYY-XXXX-XXXX)."),
  enrollmentId: UuidSchema,
  studentId: UuidSchema,
  studentName: z.string(),
  programId: UuidSchema,
  programTitle: z.string(),
  batchId: UuidSchema,
  batchName: z.string(),
  templateId: UuidSchema,
  templateName: z.string(),
  kind: CertificateKindSchema,
  status: CertificateStatusSchema,
  issuedAt: IsoDateTimeSchema,
  // Null = issued automatically by the system (CertificatesService.autoIssueOnCompletion)
  // when a student reaches 100% progress, as opposed to a staff member issuing it
  // manually via CRM. issuedByName stays a non-nullable string ("System (automatic)"
  // in that case) so display code never has to null-check it.
  issuedById: UuidSchema.nullable(),
  issuedByName: z.string(),
  revokedAt: IsoDateTimeSchema.nullable(),
  revokedByName: z.string().nullable(),
  revokedReason: z.string().nullable(),
  verifyUrl: z.string().url(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type CertificateCrmDetail = z.infer<typeof CertificateCrmDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC VERIFY DTO — the most security-sensitive DTO in P4
//
// AC-H7 (hard requirement): The response MUST NOT contain:
//   - email address, phone number
//   - enrollment ID, student ID (internal IDs)
//   - payment information
//   - batch name, faculty name
//   - ANY data not in this explicit DTO
//
// The integration test scans all keys in the raw response JSON and asserts
// only `valid`, `status`, `program`, `issuedAt`, and `holderName` are present.
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/verify/:certUid (PUBLIC — no authentication required)
 *
 * Public certificate verification result.
 * AC-H1: valid cert → { valid: true, status: 'valid', ... }
 * AC-H2: revoked cert → { valid: false, status: 'revoked', ... }
 * AC-H3/H4/H5: invalid/fabricated/nonexistent → 404
 *
 * SECURITY REQUIREMENTS:
 *   1. Verification RECOMPUTES the cert_uid signature. A fabricated row or guessed uid
 *      without a valid HMAC fails before any DB fields are returned (plan §6 Risk #2).
 *   2. This DTO is MINIMAL — no PII beyond holder name.
 *   3. No internal IDs (enrollment_id, student_id, certificate.id) in this response.
 *   4. Rate-limited by IP (429 + Retry-After on excess — AC-H6).
 *   5. Unauthenticated — no cookieAuth required (AC-H8).
 *
 * The `valid` field uses the literal type pattern from docs/specs LOCK-5:
 *   - boolean `true` for valid certificates.
 *   - string literal `"revoked"` for revoked certificates.
 * This matches the spec's discriminated shape and makes it impossible to confuse
 * a boolean `false` (network error / unexpected) with an intentional revocation.
 */
export const VerifyResultSchema = z.discriminatedUnion("valid", [
  z.object({
    valid: z.literal(true),
    status: z.literal("valid"),
    program: z.string().describe("Program name. The only program-related field in this response."),
    issuedAt: IsoDateTimeSchema.describe("ISO-8601 issue datetime."),
    holderName: z.string().describe("Certificate holder's full name. The only PII in this response."),
    // BANNED FIELDS (never add these):
    // - enrollmentId, studentId, certificateId (internal IDs)
    // - email, phone (PII beyond holder name)
    // - batchName, facultyName (internal structure)
    // - paymentInfo, orderId (commerce data)
  }),
  z.object({
    valid: z.literal("revoked"),
    status: z.literal("revoked"),
    program: z.string(),
    issuedAt: IsoDateTimeSchema,
    holderName: z.string(),
    // Revocation details are intentionally OMITTED from the public response.
    // The reason for revocation is internal (not exposed publicly).
  }),
]);
export type VerifyResult = z.infer<typeof VerifyResultSchema>;

// ─── COMPILE-TIME ASSERTIONS: VerifyResult has no banned fields ───────────
// These assertions prove at type level that VerifyResult cannot contain
// any PII beyond holderName, and no internal IDs.

type _VerifyValid = Extract<VerifyResult, { valid: true }>;
type _VerifyRevoked = Extract<VerifyResult, { valid: "revoked" }>;

// No enrollmentId
type _AssertNoEnrollmentId_Valid = "enrollmentId" extends keyof _VerifyValid ? never : true;
const _a1: _AssertNoEnrollmentId_Valid = true;

type _AssertNoEnrollmentId_Revoked = "enrollmentId" extends keyof _VerifyRevoked ? never : true;
const _a2: _AssertNoEnrollmentId_Revoked = true;

// No studentId
type _AssertNoStudentId_Valid = "studentId" extends keyof _VerifyValid ? never : true;
const _a3: _AssertNoStudentId_Valid = true;

// No email
type _AssertNoEmail_Valid = "email" extends keyof _VerifyValid ? never : true;
const _a4: _AssertNoEmail_Valid = true;

// No phone
type _AssertNoPhone_Valid = "phone" extends keyof _VerifyValid ? never : true;
const _a5: _AssertNoPhone_Valid = true;

void _a1; void _a2; void _a3; void _a4; void _a5;

// ─────────────────────────────────────────────────────────────────────────
// Certificate template (for ops to select at issuance time)
// ─────────────────────────────────────────────────────────────────────────

export const CertificateTemplateSummarySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  /**
   * WHICH award this template issues, read server-side from its `design.certificateKind`.
   *
   * Surfaced on the summary because the template IS the kind — its artwork says TRAINING or
   * INTERNSHIP in the ribbon — so any caller that picks a template has already picked a
   * kind. Before this, the CRM's issue dialogs had to ask separately, which allowed the two
   * to contradict each other: an internship template issuing a row marked training.
   */
  kind: CertificateKindSchema,
  status: z.enum(["active", "inactive"]),
  createdAt: IsoDateTimeSchema,
});
export type CertificateTemplateSummary = z.infer<typeof CertificateTemplateSummarySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Certificate template layout persistence (Phase-9-completion gap #5) — the CRM
// designer's drag-positioned merge-field layout. Mirrors @repo/ui's
// `CertTemplateField` shape exactly (packages/ui/src/components/cert-template-
// canvas.tsx) so the designer can round-trip `fields` straight through this DTO.
// `layout` is UI-designer-only in this pass — the PDF renderer (CertificatePdfPort)
// continues to read `design`/`fields` unchanged; wiring layout -> render is a
// tracked follow-up, not silently implied by persistence alone.
// ─────────────────────────────────────────────────────────────────────────

export const CertificateTemplateLayoutFieldSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["text", "image"]),
    label: z.string().min(1),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    width: z.number().min(0).max(100).optional(),
    height: z.number().min(0).max(100).optional(),
    fontSize: z.number().positive().optional(),
    color: z.string().optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    fontWeight: z.enum(["normal", "bold"]).optional(),
    placeholder: z.string().optional(),
    imageUrl: z.string().optional(),
  })
  .strict();
export type CertificateTemplateLayoutField = z.infer<typeof CertificateTemplateLayoutFieldSchema>;

export const CertificateTemplateLayoutSchema = z.array(CertificateTemplateLayoutFieldSchema);
export type CertificateTemplateLayout = z.infer<typeof CertificateTemplateLayoutSchema>;

export const CertificateTemplateDetailSchema = CertificateTemplateSummarySchema.extend({
  design: z.record(z.string(), z.unknown()).describe("Visual layout directives consumed by CertificatePdfPort (orientation, colours, logoUrl, etc.)."),
  fields: z.array(z.record(z.string(), z.unknown())).describe("Dynamic field descriptors declared by the template (key/label/emphasis)."),
  layout: CertificateTemplateLayoutSchema.nullable().describe("CRM designer's saved field positions. Null until first saved from the designer."),
  updatedAt: IsoDateTimeSchema,
});
export type CertificateTemplateDetail = z.infer<typeof CertificateTemplateDetailSchema>;

/**
 * `GET /api/v1/crm/certificate-templates/:id/specimen` — the REAL certificate this
 * template issues, rendered with obviously-sample values.
 *
 * WHY THIS EXISTS. Every other way to look at a certificate needs one to already have been
 * issued to a real student, so the only way to check a template before using it was to
 * award a certificate to somebody and look at that. The CRM's "template designer" appeared
 * to fill this gap and did not: it positioned merge-field placeholders
 * ("{{student_name}}", "{{program_title}}") on a blank canvas, and since the certificate
 * became the approved artwork with four values drawn onto it, neither those field names
 * nor that canvas corresponded to anything the renderer does.
 *
 * This runs the SAME CertificatePdfPort.render() that issuance runs, on the same artwork,
 * with the same placements. What comes back is the document, not a likeness of it.
 *
 * DELIVERED AS BYTES, NEVER A STORED OBJECT OR A SIGNED URL. A rendered certificate is
 * ~1.4 MB and a clean unwatermarked one is a forger's starting point — which is exactly why
 * the PUBLIC specimens on the marketing site have a watermark burned into their pixels
 * (scripts/build-sample-certificates.cjs). Storing this one would put a shareable link to
 * an unwatermarked certificate PDF in the bucket; base64 in a response body reaches the
 * staff member's browser and nowhere else. It also means the preview works where the
 * storage provider is unconfigured, which is most of local development.
 *
 * No watermark on THIS one, deliberately: it is gated on `certificates.view`, and anyone
 * holding that can already download real certificates through
 * `GET /crm/certificates/:id/download`. A watermark would obscure the layout somebody
 * opened this to check while granting no capability they did not already have.
 */
export const CertificateSpecimenResponseSchema = z.object({
  contentType: z.literal("application/pdf"),
  bytesBase64: z.string().describe("The rendered PDF, base64. Not stored anywhere server-side."),
  templateName: z.string(),
  certificateKind: z
    .enum(["training", "internship"])
    .describe("Which approved artwork this template prints, resolved from design.certificateKind."),
  /**
   * The placeholder values drawn onto the artwork, returned so the UI can caption them
   * rather than leaving a reader to guess whether "Sample Student" is a real person.
   */
  sample: z.object({
    holderName: z.string(),
    programName: z.string(),
    certificateId: z.string(),
    issuedAt: IsoDateTimeSchema,
  }),
});
export type CertificateSpecimenResponse = z.infer<typeof CertificateSpecimenResponseSchema>;

/** POST /api/v1/crm/certificate-templates */
export const CreateCertificateTemplateRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    design: z.record(z.string(), z.unknown()).default({}),
    fields: z.array(z.record(z.string(), z.unknown())).default([]),
    layout: CertificateTemplateLayoutSchema.optional(),
    status: z.enum(["active", "inactive"]).default("active"),
  })
  .strict();
export type CreateCertificateTemplateRequest = z.infer<typeof CreateCertificateTemplateRequestSchema>;

/** PATCH /api/v1/crm/certificate-templates/:id — the designer's "Save layout" action sends `{ layout }` only. */
export const UpdateCertificateTemplateRequestSchema = CreateCertificateTemplateRequestSchema.partial().strict();
export type UpdateCertificateTemplateRequest = z.infer<typeof UpdateCertificateTemplateRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// List query params
// ─────────────────────────────────────────────────────────────────────────

export const ListCertificatesQuerySchema = z
  .object({
    status: CertificateStatusSchema.optional(),
    kind: CertificateKindSchema.optional(),
    programId: UuidSchema.optional(),
    search: z.string().min(1).max(200).optional().describe("Filter by student name, cert_uid, or serial."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListCertificatesQuery = z.infer<typeof ListCertificatesQuerySchema>;

export const ListEligibilityQuerySchema = z
  .object({
    programId: UuidSchema.optional(),
    batchId: UuidSchema.optional(),
    eligible: z.coerce.boolean().optional().describe("Filter by eligibility state."),
    hasRecommendation: z.coerce.boolean().optional(),
    search: z.string().min(1).max(200).optional().describe("Filter by student name."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListEligibilityQuery = z.infer<typeof ListEligibilityQuerySchema>;

/**
 * GET /api/v1/crm/certificates/eligibility-batches — the batch-first landing
 * page of CRM ▸ Certificates. `search` matches the BATCH or the PROGRAM name
 * here (not the student name, which is what `ListEligibilityQuery.search`
 * matches once you are inside a batch).
 */
export const ListEligibilityBatchesQuerySchema = z
  .object({
    programId: UuidSchema.optional(),
    search: z.string().min(1).max(200).optional().describe("Filter by batch name or program title."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListEligibilityBatchesQuery = z.infer<typeof ListEligibilityBatchesQuerySchema>;
