// apps/api/src/prisma/audit.extension.ts
//
// Audit Prisma Client Extension (docs/05-database-design.md §6).
//
// For a configurable set of "sensitive" models, every create/update/delete-like
// mutation writes a row into `audit_logs` post-commit, capturing:
//   - tenant_id        — from the audit request-context (see audit-context.ts) or,
//                         failing that, from the row itself when the model has a
//                         `tenantId` field.
//   - actor_id         — from the audit request-context (undefined for system/
//                         unauthenticated operations -> stored as null).
//   - entity/entity_id — the model name + the affected row's id.
//   - action           — "create" | "update" | "delete".
//   - before/after     — best-effort snapshots (before = pre-mutation read for
//                         update/delete, after = the mutation result for create/update).
//   - ip               — from the audit request-context.
//
// This is a "post-commit, best-effort" writer: the audit write happens after the
// underlying Prisma operation resolves successfully, using the *same* extended
// client, so audit_logs benefits from the same connection pool / transaction
// semantics. If the caller is already inside an interactive `$transaction`, the
// audit insert participates in that transaction too (so a rollback also rolls back
// the audit entry — intentional, since an audit log for a mutation that never
// committed would be misleading).
//
// SEAM FOR BACKEND-BUILDER (Wave 4): see audit-context.ts for how to populate
// tenantId/actorId/ip per request. Until that middleware is wired, audit rows will
// be written with `actor_id: null` and `tenant_id` inferred from the row data
// (when present) — never silently skipped.
//
// COMPOSITION ORDER (critical): this extension must be applied BEFORE
// `softDeleteExtension` (i.e. `client.$extends(auditExtension).$extends(softDeleteExtension)`),
// so audit is the *inner* layer and soft-delete is the *outer* layer. `softDeleteExtension`
// redirects `delete`/`deleteMany` into `update`/`updateMany` by re-entering the client —
// for that redirected call to still pass through (and be captured by) this audit layer,
// audit must already be "underneath" it. See prisma.service.ts for the canonical
// composition and soft-delete.extension.ts for the redirect mechanics.
//
// ALS GOTCHA: `PrismaPromise`s are lazy — the underlying engine request (where this
// hook actually runs) only fires once something `await`s/`.then()`s the promise.
// Callers using `audit-context.ts`'s `auditContextStorage.run(ctx, fn)` MUST `await`
// (or otherwise resolve) the Prisma call *inside* `fn` — an `async` callback that
// `return`s the un-awaited PrismaPromise works (its own Promise wrapper still captures
// the AsyncLocalStorage context at creation time), but a plain non-async callback that
// merely `return`s the PrismaPromise does NOT, because `.run()` then exits the ALS scope
// before the engine request is ever triggered. See soft-delete-audit.integration.spec.ts
// for a worked example and a failing-pattern callout.

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getAuditContext } from "./audit-context";
import { maskEmail, maskPhone, maskPiiString } from "../observability/pii-mask";

// DECISION (Wave 6 security audit, reviewer's "should Session even be audited" question):
// keep `Session` in AUDITED_MODELS. The reviewer's concern was login-volume churn
// (create-on-login, update-on-every-refresh-rotation) blowing up audit_logs row count —
// that's real, but it's a *volume/retention* problem, not a correctness one, and it is
// solvable later (Wave 7+) with audit_logs partitioning/retention policy without touching
// this extension. Dropping Session create/update audit now (keeping only revoke/delete)
// would remove the only durable record of refresh-token rotation timing, which is exactly
// the kind of forensic trail you want intact for incident response (e.g. "was this
// session rotated from an unexpected IP before it was used maliciously"). Since the
// actual leak (H-1/H-2) was the secret fields, not the existence of the audit row, and
// redaction now fully neutralizes that, the safer Phase-0 call is: keep auditing Session
// create/update/delete, redact via SENSITIVE_MODEL_ALLOWLISTS below. Revisit row-volume
// via retention/partitioning, not by reducing audit coverage, if it becomes a real problem.
/** Sensitive models whose mutations must be audited. Extend as new sensitive models land. */
const AUDITED_MODELS = new Set<string>([
  "Tenant",
  "Branch",
  "User",
  "Role",
  "Permission",
  "RolePermission",
  "UserRole",
  "Session",
  "Program",
  "Module",
  "Lesson",
  // Phase 1 (CRM core, docs/plans/phase-1.md task #1): none of these four carry
  // secret/verifier columns, so denylist-only redaction (SECRET_FIELDS, see
  // `redactRow` below) is sufficient — no entry in SENSITIVE_MODEL_ALLOWLISTS is
  // required. Listed explicitly here (rather than relying on a default) so audit
  // coverage is an intentional decision, not an accident of a future rename.
  "StudentProfile",
  "FacultyProfile",
  "Batch",
  "Enrollment",
  // Phase-2 Commerce (docs/plans/phase-2.md task #1): all carry money in paise (Int),
  // external provider IDs (provider_payment_id, provider_order_id, provider_refund_id),
  // and sensitive financial state. None carry password/token/secret fields, so
  // denylist-only redaction (SECRET_FIELDS) is sufficient — the denylist catches any
  // future secret-shaped column added without an allowlist update.
  //
  // DELIBERATE CHOICE on provider IDs: provider_payment_id/provider_order_id/
  // provider_refund_id are Razorpay-assigned external identifiers (not secrets — they
  // appear in Razorpay dashboards and webhooks). They are fine to audit. The denylist
  // will not strip them (they contain no "token"/"secret"/"hash" in their names), and
  // we intentionally do NOT add an allowlist for Payment/Order/Refund, for the same
  // reason P1's four models had none: denylist-default provides the safety net for any
  // future field, and none of these models carry verifier/bearer columns today.
  "Order",
  "Payment",
  "Invoice",
  "Refund",
  "Coupon",
  // Phase-2 CRM & leads: leads carry PII (name/phone/email/utm). None carry
  // secret/verifier columns, so denylist-only is correct. The PII read-access
  // logging question (docs/plans/phase-2.md "PII read-access logging S1-2") is
  // tracked as a follow-up — the current write-mutation audit coverage is the gate.
  "Lead",
  "Activity",
  "Booking",
  // Phase-3 LMS core (docs/plans/phase-3.md task #1):
  //
  // Video: audited (create + status transitions from transcode webhook). provider_asset_id
  // is an external CDN identifier (not a secret — it appears in provider dashboards, and
  // the signed-HLS URL is minted separately by VideoProvider, not stored here). Denylist-
  // only redaction (SECRET_FIELDS) is sufficient; no allowlist required. The signing key
  // (CLOUDFLARE_STREAM_SIGNING_KEY_PEM etc.) never appears in the Video row.
  "Video",
  //
  // LessonProgress: INCLUDED with the following audit-volume caveat (see schema.prisma
  // header for full decision rationale):
  //   This table is HIGH-FREQUENCY. The video player reports position on every heartbeat
  //   (throttled, e.g. every 5s). If every upsert hit the audited client, audit_logs would
  //   accumulate thousands of rows per student-lesson session — analogous to the Session
  //   refresh-rotation concern documented in the Phase-0 DECISION comment above.
  //
  //   Decision: INCLUDE LessonProgress in AUDITED_MODELS (so create + status=completed
  //   transitions ARE recorded), but the backend-builder (Wave 4) MUST split the progress
  //   write path into:
  //     a) Position-ping path: uses the BASE (non-audited) client for last_position_s-only
  //        updates (no audit row generated).
  //     b) Completion path: uses the EXTENDED (audited) client when status transitions to
  //        "completed" (audit row generated — this is the meaningful event).
  //   This mirrors the backend pattern used for Session (where the ALS rotation audit is
  //   kept but review flagged volume concern). The db-architect commits the "table IS
  //   auditable" contract; frequency management is the service layer's responsibility.
  //
  //   Denylist-only redaction is sufficient — LessonProgress carries no secrets
  //   (lastPositionS, status, completedAt are all non-sensitive progress data).
  "LessonProgress",
  //
  // Attendance: audited (create + status changes = meaningful compliance events for
  // attendance policy enforcement). source=recorded rows are created once per lesson
  // completion (idempotent), so volume is bounded by lesson count × enrollment count.
  // Denylist-only redaction is sufficient — no secrets in Attendance rows.
  "Attendance",
  //
  // Resource: audited (create/update/delete of lesson attachments). CMS content mutations
  // are meaningful audit events (faculty/content-editor uploading/deleting course materials).
  // Denylist-only redaction is sufficient — storageKey is the S3/R2 object key (not a
  // secret; signed download URLs are minted at request time, not stored).
  "Resource",
  // Phase-4 Learning Depth (docs/plans/phase-4.md task #1):
  //
  // Assignment: audited (create/update — faculty authoring content). Denylist-only sufficient.
  "Assignment",
  // AssignmentMilestone: audited (create/update — project milestone management).
  "AssignmentMilestone",
  // Submission: HIGHLY SENSITIVE — audited with special note (docs/plans/phase-4.md §8):
  //   Grade changes (score, rubric, feedback, status, gradedBy, gradedAt) must be audited
  //   with BEFORE/AFTER snapshots showing who graded what (compliance + grade-dispute
  //   forensics). The audit extension fires on every update; the backend-builder (Wave 4)
  //   is responsible for using the audited client on ALL submission grade mutations.
  //   Denylist-only redaction is sufficient — submissions contain no password/token fields.
  //   NOTE: the `rubric` JSON and `feedback` text are student-submitted or faculty-authored
  //   content (not secrets) — they appear in audit snapshots intentionally for grade audit.
  "Submission",
  // Assessment: audited (create/update — faculty authoring assessment structure).
  "Assessment",
  // AssessmentQuestion: audited (create/update/delete — question bank mutations).
  //   SECURITY NOTE: answer_key IS present in the raw row (and thus in audit snapshots).
  //   This is intentional — audit_logs is an admin-only append-only table. The denylist
  //   redaction does NOT strip answerKey (it matches neither SECRET_FIELDS names nor any
  //   SENSITIVE_MODEL_ALLOWLIST entry for AssessmentQuestion — there is none). The
  //   answer key MUST appear in audit_logs for faculty authoring audit trails; it is only
  //   forbidden in STUDENT-FACING API responses (a separate enforcement at the repo layer).
  "AssessmentQuestion",
  // Attempt: audited (create = attempt start; update = submit/auto-grade).
  //   score/passed/submittedAt transitions are meaningful eligibility-audit events.
  //   Denylist-only redaction is sufficient — no secrets in Attempt rows.
  "Attempt",
  // CertificateTemplate: audited (create/update — template lifecycle management).
  "CertificateTemplate",
  // Certificate: CRITICAL audit target — every issuance and revocation must produce
  //   a complete before/after audit row (docs/plans/phase-4.md §8 DoD, plan task #1).
  //   Denylist-only redaction is sufficient — storageKey is an S3/R2 object key (not
  //   a secret; signed download URL is minted at request time, not stored here).
  //   certUid is the verifiable identifier (not a secret — it is embedded in public
  //   share URLs and appears on the certificate PDF itself). The HMAC signing secret
  //   lives only in the env (CERT_SIGNING_SECRET) and never in the Certificate row.
  "Certificate",
  // Phase-6 Engagement (docs/plans/phase-6.md task #1):
  //
  // Notification: audited (create/update — tracks in-app delivery lifecycle changes).
  //   Not high-frequency at the audit level (one row per fan-out event, not per
  //   heartbeat); full create + read-state-change auditing is appropriate.
  //   Denylist-only redaction is sufficient — no secrets in Notification rows.
  "Notification",
  // NotificationPref: audited (create/update — user changes their delivery preferences).
  //   Preference mutations are meaningful security-relevant events (changing which
  //   channels fire for security alerts, etc.). Denylist-only sufficient.
  "NotificationPref",
  // NotificationSuppression: audited (create/soft-delete — suppression list mutations
  //   are compliance-critical; adding or removing a suppression has regulatory impact
  //   under India DLT/DPDP rules). Denylist-only sufficient.
  "NotificationSuppression",
  // CampaignTemplate: audited (create/update — template authoring).
  //   dlt_template_id is a public DLT registration id, not a secret. Denylist-only ok.
  "CampaignTemplate",
  // Campaign: SENSITIVE — every status change (draft→scheduled→sending→sent|paused|
  //   cancelled|failed) must produce an audit row (campaign send operations have
  //   compliance/DLT/consent implications). Denylist-only sufficient.
  "Campaign",
  // CampaignRecipient: audited (create + status updates from webhook ingestion).
  //   Delivery receipt trail is a compliance artifact (India DLT audit). The `to`
  //   field carries the recipient address (PII) — intentional, audit_logs is admin-only.
  //   Denylist-only sufficient (no secrets; provider_message_id is an external id, not
  //   a secret per the same logic as provider_payment_id on Payment).
  "CampaignRecipient",
  // Badge: audited (create/update — catalog management). Denylist-only sufficient.
  "Badge",
  // UserBadge: audited (create/soft-delete — badge award/revocation lifecycle).
  //   Award decisions are meaningful academic-integrity events. Denylist-only sufficient.
  "UserBadge",
  // PointsLedger: APPEND-ONLY by design. The ledger IS the audit trail for point awards
  //   and reversals; writing an audit_logs row per insert is additive coverage (not
  //   redundant — the audit_log captures the actor and ip, which the ledger lacks).
  //   Volume concern: one row per domain event × enrolled user; comparable to Submission
  //   (accepted). Denylist-only sufficient.
  "PointsLedger",
  // ForumThread: audited (create/update/soft-delete — thread moderation is a meaningful
  //   event; status transitions to hidden/resolved/pinned require accountability).
  //   Denylist-only sufficient — body is on ForumPost, not ForumThread.
  "ForumThread",
  // ForumPost: SENSITIVE — every moderation action (status=hidden, hidden_by, hidden_reason)
  //   must produce a before/after audit row for faculty/admin accountability.
  //   body is user-generated text (UGC, not a secret) — intentionally in audit snapshots
  //   (the content that was moderated must be auditable). Denylist-only sufficient.
  "ForumPost",
  // ForumPostVote: audited (create/soft-delete — vote cast/removed for leaderboard integrity).
  //   Volume is bounded: one row per user per post per vote event. Denylist-only sufficient.
  "ForumPostVote",
  // Phase-7 Analytics + Hardening (docs/plans/phase-7.md Wave 1 task #4):
  //
  // ExportJob: audited (create + status transitions). AC-36 additionally requires the
  //   export SERVICE to write its own `audit_logs` row on export completion (actor,
  //   entity='export', filters/scope, row count) — that is a separate, explicit audit
  //   write the Wave-2 export service makes; this AUDITED_MODELS entry additionally
  //   captures the ExportJob row's own create/update lifecycle (queued→running→
  //   succeeded|failed) as a secondary trail. params (JSON filter snapshot) and
  //   storage_key (S3/R2 object key, not a raw URL) are not secrets. Denylist-only
  //   redaction is sufficient.
  "ExportJob",
  // ReportSchedule: audited (create/update/soft-delete — recurring report definitions,
  //   and the dispatch cron's own active=false auto-deactivation on lost creator access,
  //   are meaningful accountability events). `params` is a filter-shape JSON snapshot
  //   (not a secret); `recipientEmail` is PII but audit_logs is an admin-only table, same
  //   posture as Lead.email/CampaignRecipient.to. Denylist-only redaction is sufficient.
  "ReportSchedule",
  // Phase-8 Mentor (human mentor, hired-from-external-institute — corrected direction;
  // the earlier "AI mentor" plan in docs/plans/phase-8.md / docs/specs/
  // phase-8-ai-mentor.md was never implemented in the schema, so there is no prior
  // audit-coverage entry to remove):
  //
  // Mentor: audited (create/update/soft-delete — onboarding, engagement-status
  //   transitions, and profile edits by admin/staff are meaningful accountability
  //   events, same posture as FacultyProfile). No secret/verifier columns; denylist-only
  //   redaction is sufficient. `email`/`phone` are PII but audit_logs is an admin-only
  //   table (same posture as Lead.email).
  "Mentor",
  // BatchMentor: audited (create/soft-delete — assigning/unassigning a mentor to a
  //   batch, and lead-mentor flag changes, are meaningful operational events with
  //   compliance relevance, same posture as UserBadge award/revocation). Denylist-only
  //   redaction is sufficient — no secrets in this row.
  "BatchMentor",
  // Phase-9 Completion (docs/plans/phase-9-completion.md Wave 1 T6-T12): every new
  // table is a meaningful CRM/support/CMS/financial business mutation. None carry
  // secret/verifier columns, so denylist-only redaction (SECRET_FIELDS) is sufficient
  // for all of them — no SENSITIVE_MODEL_ALLOWLISTS entries required. PII fields that
  // ARE genuine "unsolicited data about a person" (not consented public content) are
  // additionally registered in PII_FIELD_REGISTRY below (ContactSubmission,
  // CareerApplication, NewsletterSubscription) — see the doc comments on Testimonial/
  // FacultyBio in schema.prisma for why those two are deliberately NOT masked.
  "LiveClass",
  "Ticket",
  "TicketMessage",
  "CannedResponse",
  "KbArticle",
  "BlogCategory",
  "BlogPost",
  "Testimonial",
  "Partner",
  "FacultyBio",
  "ContentPage",
  "NewsletterSubscription",
  "ContactSubmission",
  "CareerApplication",
  "Setting",
  "Bookmark",
  "LessonNote",
  "Referral",
  "EmiPlan",
  "EmiInstallment",
  "LandingPage",
  "LeadForm",
  // Phase-10 Page Builder (docs/specs/phase-10-page-builder.md): every builder save/
  // revert and every site-setting change is a mutation on a sensitive, public-facing
  // entity and must produce an audit row (spec "Audit" requirement). `ContentPage`
  // itself is already audited above (its `update` — the "apply new content live" half
  // of save-before-apply — is captured there); `ContentPageVersion` additionally
  // audits the immutable snapshot CREATE (the "before" half). Neither carries a secret
  // column; denylist-only redaction is sufficient. `createdById` (the acting user) is
  // already captured as a first-class column, redundant with but not replacing
  // `audit_logs.actor_id`.
  "ContentPageVersion",
  // SiteSetting: nav/footer/SEO/contact/stats primitives are sitewide, public-facing
  // marketing config — every create/update is a meaningful accountability event
  // (super_admin-only, site_settings.edit). No secrets; denylist-only sufficient.
  "SiteSetting",
  // Student onboarding form (stimuliiq.com/onboarding):
  //
  // OnboardingField: audited. The question set is what every future submission is
  //   measured against — "who removed the payment-receipt question, and when" is
  //   exactly the accountability trail this table exists to provide. No secrets.
  "OnboardingField",
  // OnboardingSubmission: audited (create + the staff status/notes transitions that
  //   move it new → verified/rejected). Carries a real student's PII, so it is ALSO
  //   registered in PII_FIELD_REGISTRY below — same posture as CareerApplication.
  //   Note the free-form `answers` snapshot can itself contain PII in staff-defined
  //   fields; see the registry comment for why that is bounded, not ignored.
  "OnboardingSubmission",
  // Staff leave management (docs/specs/leave-management.md). All five audited, and this is
  // the whole accountability story for the feature — "who approved this", "who changed the
  // 2026 allocation after the year started", "who removed that holiday" are the questions
  // an HR trail exists to answer, and the module writes no log of its own. No secrets and
  // no PII: the applicant and the reviewer are both foreign keys, and `reason` /
  // `review_note` are work-context free text, not personal data by any other route.
  "LeaveType",
  "LeaveQuota",
  "Holiday",
  "LeaveSetting",
  "LeaveRequest",
]);

// --- Secret redaction (Wave 6 security audit H-1/H-2) ----------------------------------
//
// `audit_logs` is append-only and explicitly EXEMPT from soft-delete (it is the durable
// record of what happened, including to deleted rows) — so anything written into its
// before/after JSONB columns is effectively permanent. Snapshotting full Prisma rows
// (as this extension does for `before`/`after`) was writing `User.passwordHash` and
// `Session.refreshHash` straight into that durable table on every login/rotation/user
// mutation, i.e. leaking the password verifier and the bearer-equivalent refresh-token
// verifier into a table many more people (support, analytics, future read-replicas) can
// read than can read `users`/`sessions` directly.
//
// Defense in depth, two layers:
//   1. SECRET_FIELDS — a central DENYLIST of field names that must NEVER appear in an
//      audit snapshot, for ANY model, present or future. This is the safety net: if a
//      new sensitive column lands on an audited model and nobody updates this file, it
//      is still stripped by name. Matched case-sensitively against the exact Prisma
//      field name (not column name) since `before`/`after` snapshots are Prisma rows.
//   2. SENSITIVE_MODEL_ALLOWLISTS — an explicit ALLOWLIST of columns for the two models
///     that actually hold secrets today (`User`, `Session`). Allowlisting (rather than
//      "denylist only") means a brand-new secret-shaped field on these two specific
//      models is redacted by default even before anyone adds its name to
//      SECRET_FIELDS — belt and suspenders for exactly the two models the reviewer
//      flagged. Models with no allowlist entry fall back to denylist-only redaction.
const SECRET_FIELDS = new Set<string>([
  "passwordHash",
  "password",
  "refreshHash",
  "refreshToken",
  "otpHash",
  "otp",
  "token",
  "secret",
  "csrfSecret",
]);

/**
 * Explicit per-model allowlists for the models known to carry secret/verifier columns.
 * Only fields listed here survive into an audit snapshot for that model; everything else
 * (including any future column nobody remembered to allowlist) is dropped. Models not
 * listed here fall back to SECRET_FIELDS denylist-only redaction (see `redactRow`).
 */
const SENSITIVE_MODEL_ALLOWLISTS: Record<string, ReadonlySet<string>> = {
  User: new Set([
    "id",
    "tenantId",
    "email",
    "phone",
    "name",
    "avatar",
    "status",
    "lastLoginAt",
    "twoFaEnabled",
    "createdAt",
    "updatedAt",
    "deletedAt",
  ]),
  Session: new Set([
    "id",
    "tenantId",
    "userId",
    "device",
    "ip",
    "expiresAt",
    "revokedAt",
    "createdAt",
    "updatedAt",
    "deletedAt",
  ]),
};

/**
 * Redacts a single row before it is allowed anywhere near an audit_logs before/after
 * snapshot. For models with an explicit allowlist (User, Session today), only allowlisted
 * keys survive. For every other model, the SECRET_FIELDS denylist is stripped — this
 * is the minimum guarantee for any model added to AUDITED_MODELS in the future without
 * a matching allowlist update.
 */
function redactRow(model: string, row: unknown): unknown {
  if (!row || typeof row !== "object") {
    return row;
  }

  const allowlist = SENSITIVE_MODEL_ALLOWLISTS[model];
  const entries = Object.entries(row as Record<string, unknown>);

  if (allowlist) {
    return Object.fromEntries(entries.filter(([key]) => allowlist.has(key)));
  }

  return Object.fromEntries(entries.filter(([key]) => !SECRET_FIELDS.has(key)));
}

// --- PII masking at WRITE time (DPDP, Phase-7 Wave 2 security hardening batch B, item 2a;
// pays down P5 L-1 + P6 L-2 going forward) --------------------------------------------------
//
// SECRET_FIELDS/SENSITIVE_MODEL_ALLOWLISTS above answer "is this a credential that must
// NEVER appear in an audit snapshot" (stripped entirely). PII is a different question:
// email/phone/name ARE useful in an audit trail (support needs to see "who changed what"),
// so DPDP minimization calls for MASKING them (one-way, non-reversible without the DB row
// itself), not deleting them outright — the audit row stays useful; only the raw
// identifier is no longer readable straight off the snapshot.
//
// THE PII FIELD REGISTRY (single source of truth — do not duplicate this list elsewhere;
// `dpdp-erasure.service.ts` imports `PII_FIELD_REGISTRY`/`maskPiiValue` from this exact
// module to redact the SAME fields in EXISTING historical audit_logs rows on an erasure
// request, so the write-time mask and the erasure-time mask can never drift apart):
//
//   User.email / User.phone / User.name             — direct identifiers on the account.
//   Lead.email / Lead.phone / Lead.name              — a prospective student's PII.
//   NotificationSuppression.email / .phone           — the unsubscribed/bounced address.
//   ReportSchedule.recipientEmail                    — the scheduled report's mailbox.
//   CampaignRecipient.to                              — resolved email OR phone address
//                                                        (kind: "contact" masks BOTH shapes).
//   Mentor.email / Mentor.phone / Mentor.fullName     — a real external person's PII
//                                                        (Phase 8, hired-from-institute mentor).
//
// NOT included today (no raw column exists yet, but the registry is where a future column
// must be added the moment it lands — see AC-66's "fails loud" CI-coverage intent):
//   raw postal address (StudentProfile only has `city`/`college`, not a full address —
//   Branch.address is an organizational branch address, not a person's, and is left
//   unmasked so branch-management audit trails stay legible), date-of-birth (no DOB column
//   exists in the schema), unsubscribe/reset tokens (no raw token column is ever persisted
//   — see NotificationsService's HMAC-based unsubscribe token, which is never stored).
//
// `kind` selects which masking transform is applied:
//   "email"   -> maskEmail (e.g. "j***@e***.com")
//   "phone"   -> maskPhone (e.g. "+91XXXXX1234")
//   "contact" -> maskPiiString (tries both email- and phone-shaped patterns; used for
//                fields whose value could be either, e.g. CampaignRecipient.to)
//   "name"    -> first-character-preserving mask (e.g. "J***") — names have no fixed
//                machine-checkable format, so no regex-based masker applies.
type PiiFieldKind = "email" | "phone" | "contact" | "name";

export const PII_FIELD_REGISTRY: Readonly<Record<string, Readonly<Record<string, PiiFieldKind>>>> = {
  User: { email: "email", phone: "phone", name: "name" },
  Lead: { email: "email", phone: "phone", name: "name" },
  NotificationSuppression: { email: "email", phone: "phone" },
  ReportSchedule: { recipientEmail: "email" },
  CampaignRecipient: { to: "contact" },
  // Phase-8 Mentor: a real external person's PII (name/email/phone) — same DPDP
  // posture as Lead. Note there is deliberately no allowlist in
  // SENSITIVE_MODEL_ALLOWLISTS for Mentor (it carries no secret/verifier columns), so
  // this registry entry is the only redaction layer needed beyond denylist-only.
  Mentor: { email: "email", phone: "phone", fullName: "name" },
  // Phase-9 Completion: unsolicited PII submitted through public forms — same DPDP
  // posture as Lead (the person did not necessarily consent to public display, unlike
  // Testimonial.studentName / FacultyBio.name, which are deliberately NOT masked — see
  // the doc comments on those two models in schema.prisma).
  ContactSubmission: { name: "name", email: "email", phone: "phone" },
  CareerApplication: { name: "name", email: "email", phone: "phone" },
  NewsletterSubscription: { email: "email" },
  // Onboarding form intake — same posture as CareerApplication (unsolicited PII from a
  // public form). Only the three DENORMALISED identity columns are registered, because
  // those are the ones with a known kind. The `answers` JSON snapshot is deliberately
  // NOT masked here: it is a staff-authored key/value bag whose shape this registry
  // cannot know ahead of time, and a blanket mask would destroy the legibility that
  // makes the audit row useful. The mitigation is that `answers` duplicates the same
  // three identifiers that ARE masked in the columns, and audit_logs is an admin-only
  // table. If a future field type introduces a new machine-checkable identifier
  // (Aadhaar, PAN), mask it at the service write boundary before it reaches this row.
  OnboardingSubmission: { fullName: "name", email: "email", phone: "phone" },
};

/** Masks a personal name: keeps the first character, replaces the rest with "***". */
function maskName(value: string): string {
  if (value.length === 0) return value;
  if (value.length === 1) return "*";
  return `${value[0]}***`;
}

/**
 * Masks a single PII field value per its registered `kind`. Non-string values (null,
 * numbers, already-masked/undefined) pass through unchanged — masking only ever applies
 * to the literal raw string that would otherwise appear verbatim in the snapshot.
 */
export function maskPiiValue(kind: PiiFieldKind, value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }
  switch (kind) {
    case "email":
      return maskEmail(value);
    case "phone":
      return maskPhone(value);
    case "contact":
      return maskPiiString(value);
    case "name":
      return maskName(value);
  }
}

/**
 * Applies the PII_FIELD_REGISTRY mask to every registered field present on `row` for
 * `model`. Fields not in the registry (including non-PII columns literally named "name"
 * on OTHER models — Role.name, Program.name, Batch.name, CampaignTemplate.name, etc. —
 * which are catalog/organizational labels, not personal names) are left untouched. Exported
 * so the DPDP erasure job (dpdp-erasure.service.ts) can apply the IDENTICAL mask to
 * historical rows without duplicating the kind-per-field mapping.
 */
export function maskPiiRow(model: string, row: unknown): unknown {
  const registry = PII_FIELD_REGISTRY[model];
  if (!registry || !row || typeof row !== "object") {
    return row;
  }
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const [field, kind] of Object.entries(registry)) {
    if (field in out) {
      out[field] = maskPiiValue(kind, out[field]);
    }
  }
  return out;
}

/**
 * Stable one-way hash reference for a raw PII value, used ONLY by the erasure job when a
 * field must be redacted but no format-specific mask applies. Not currently used by the
 * write-time path (every registered field above has a format-specific masker), but kept
 * here — alongside the registry it redacts against — as the fallback the erasure job (and
 * any future registry entry) can reach for. `[REDACTED:<16-hex>]` — the truncated SHA-256
 * hash is stable (same input -> same output) but not reversible.
 */
export function hashPiiValue(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `[REDACTED:${digest}]`;
}

const MUTATION_OPERATIONS: Record<string, "create" | "update" | "delete"> = {
  create: "create",
  createMany: "create",
  update: "update",
  updateMany: "update",
  upsert: "update",
  delete: "delete",
  deleteMany: "delete",
};

function isAudited(model: string | undefined): boolean {
  return !!model && AUDITED_MODELS.has(model);
}

function extractRowId(row: unknown): string | undefined {
  if (row && typeof row === "object" && "id" in row) {
    const id = (row as { id?: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

function extractTenantId(row: unknown): string | undefined {
  if (row && typeof row === "object" && "tenantId" in row) {
    const tenantId = (row as { tenantId?: unknown }).tenantId;
    return typeof tenantId === "string" ? tenantId : undefined;
  }
  return undefined;
}

/** Maps a Prisma `ModelName` (e.g. "Branch") to its client delegate property (e.g. "branch"). */
function toDelegateProperty(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

interface FindFirstDelegate {
  findFirst: (args: { where: unknown }) => Promise<unknown>;
}

interface AuditLogDelegate {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
}

// Defence in depth for `audit_logs` immutability (the DB trigger from migration
// audit_logs_immutability is the real enforcement — see prisma/migrations — this is the
// belt to that suspenders, and the only layer that runs against a Supabase dashboard
// session bound by RLS-less superuser access is the trigger, not this file). `create`/
// `createMany` pass straight through with NO recursion (writing the audit row here must
// never itself write another audit row). Every other mutation shape — update, updateMany,
// upsert, delete, deleteMany — throws: nothing may edit or remove an audit row through the
// extended client. The ONE sanctioned edit (DPDP erasure redacting `before`/`after`,
// dpdp.repository.ts `redactAuditRow`) does not go through this client at all — it uses
// `PrismaService.baseClient` (soft-delete only, no audit layer, so this guard never sees
// it), and is itself still bounded by the Postgres trigger to touching only
// before/after/redacted_at. Reads (findMany, count, ...) are untouched — `action` is
// `undefined` for them, so they fall through below.
function guardAuditLogMutation(
  operation: string,
  args: unknown,
  query: (args: unknown) => Promise<unknown>,
): Promise<unknown> {
  const shape = MUTATION_OPERATIONS[operation];
  if (shape === "create") {
    return query(args);
  }
  if (shape) {
    throw new Error(
      `[audit] audit_logs is append-only: "${operation}" is blocked on the extended Prisma ` +
        "client. The only sanctioned mutation is DPDP redaction of before/after/redacted_at, " +
        "via PrismaService.baseClient (dpdp.repository.ts), enforced by the audit_logs_guard " +
        "Postgres trigger.",
    );
  }
  return query(args);
}

export const auditExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: "audit-log",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model === "AuditLog") {
            return guardAuditLogMutation(operation, args, query);
          }

          const action = MUTATION_OPERATIONS[operation];

          if (!isAudited(model) || !action) {
            return query(args);
          }

          // Best-effort "before" snapshot for update/delete single-row ops. We read
          // through the outer `client` closure (captured by `Prisma.defineExtension`'s
          // factory form) rather than `query`/`this`, since `query` is permanently bound
          // to the original operation and `Prisma.getExtensionContext(this)` only ever
          // exposes the *current* model's delegate — never a different model
          // (`auditLog`) and not reliably a different *method* on the same model either.
          let before: unknown;
          if ((operation === "update" || operation === "delete") && "where" in args) {
            try {
              const delegate = (client as unknown as Record<string, FindFirstDelegate | undefined>)[
                toDelegateProperty(model)
              ];
              before = await delegate?.findFirst({ where: (args as { where: unknown }).where });
            } catch {
              before = undefined;
            }
          }

          const result = await query(args);

          const auditCtx = getAuditContext();
          const entityId = extractRowId(result) ?? extractRowId(before);
          const tenantId = auditCtx.tenantId ?? extractTenantId(result) ?? extractTenantId(before);

          // Without a tenant_id we cannot satisfy the audit_logs FK/NOT NULL contract —
          // skip rather than throw, so a missing context never breaks the business
          // mutation itself. (Wave 4 wiring of audit-context.ts closes this gap.)
          if (!tenantId || !entityId || !model) {
            return result;
          }

          // Redact BEFORE the row is ever serialized into audit_logs — see the
          // "Secret redaction" block above (Wave 6 H-1/H-2). Applied to both snapshots;
          // never write the raw `before`/`result` objects below this point.
          const secretsStrippedBefore = redactRow(model, before);
          const secretsStrippedAfter = redactRow(model, result);

          // Mask PII (email/phone/name/contact) — see "PII masking at WRITE time" block
          // above (DPDP, Phase-7 Wave 2 batch B, item 2a). Runs AFTER secret-stripping so
          // masking never has to reason about already-removed fields. This is what closes
          // P5 L-1 / P6 L-2 for every audit row written FROM NOW ON; historical rows
          // written before this change still carry raw PII until the erasure job
          // (dpdp-erasure.service.ts) is run for the affected subject (AC-64).
          const redactedBefore = maskPiiRow(model, secretsStrippedBefore);
          const redactedAfter = maskPiiRow(model, secretsStrippedAfter);

          try {
            const auditLogDelegate = (client as unknown as { auditLog: AuditLogDelegate }).auditLog;
            await auditLogDelegate.create({
              data: {
                tenantId,
                actorId: auditCtx.actorId ?? null,
                entity: model,
                entityId,
                action,
                before: redactedBefore ? (redactedBefore as Prisma.InputJsonValue) : undefined,
                after: redactedAfter ? (redactedAfter as Prisma.InputJsonValue) : undefined,
                ip: auditCtx.ip ?? null,
              },
            });
          } catch {
            // Audit-write failures must never block or roll back the underlying
            // business mutation outside of an explicit transaction; they are logged
            // by the app's pino logger at the call site (left to backend-builder to
            // wrap with proper error reporting/alerting in Wave 4).
          }

          return result;
        },
      },
    },
  }),
);
