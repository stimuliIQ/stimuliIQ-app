// Career application contract — the public apply form and the CRM review queue.
// Backs `model CareerApplication`. Spec: docs/specs/careers-hiring.md, ADR-0066.
// Openings themselves live in `content/job-openings.schemas.ts`.
//
// Public apply at POST /api/v1/public/careers/apply (captcha-gated + rate-limited); the
// resume is uploaded FIRST through POST /api/v1/public/careers/resume-upload-url, which
// hands back a signed PUT URL and the `resumeStorageKey` this DTO accepts. A raw file
// never touches the API server.
//
// ── REVIEW IS FOUR VERBS, NOT A STATUS PICKER ───────────────────────────────────────
// A career application's `status` is never chosen directly. It is the residue of a
// decision, and each decision is its own endpoint under /api/v1/crm/career-applications/:id:
//
//   POST .../hold      → on_hold      NO email. The internal parking state.
//   POST .../shortlist → shortlisted  Emails the candidate the round + what to expect.
//   POST .../offer     → selected     Requires an uploaded offer letter; emails it attached.
//   POST .../reject    → rejected     Emails a plain decline. `internalNotes` is NEVER sent.
//
// This follows the P4 grade/send-back and P12 accept/reject precedents for the same reason
// they exist: every one of these transitions mails a real person, and a dropdown that fires
// an irreversible email on a mis-click is the wrong control. It also gives each verb a place
// to carry what only it needs — the round name, the offer letter — which a single
// `{status}` PATCH has nowhere to put.

import { z } from "zod";
import { UuidSchema, PhoneSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { PublicJobOpeningSchema } from "./job-openings.schemas.js";

/**
 * new         — arrived, nobody has decided anything. The queue's default filter.
 * on_hold     — parked by a reviewer. Deliberately silent: "we are still thinking" is not
 *               a message worth mailing, and a candidate told they are on hold reads it as
 *               a soft no anyway.
 * shortlisted — moved to a further round. The candidate has been told.
 * selected    — offered. An offer letter exists on the row and has been emailed.
 * rejected    — declined. The candidate has been told; the reason has not.
 *
 * `reviewing` and `hired` were the pre-review-surface values. Nothing ever wrote them (there
 * was no CRM screen) and migration `20260819140000_careers_openings_and_review` folds them
 * into `new` and `selected`.
 */
export const CareerApplicationStatusSchema = z.enum(["new", "on_hold", "shortlisted", "selected", "rejected"]);
export type CareerApplicationStatus = z.infer<typeof CareerApplicationStatusSchema>;

/**
 * SECURITY (Wave 6 M3): allow-list of resume MIME types. `contentType` is echoed into
 * the signed PUT's Content-Type constraint, so an arbitrary string would let an
 * anonymous uploader stage HTML/SVG/scripts under our bucket. Restrict to document
 * formats a resume actually is.
 */
export const ResumeContentTypeSchema = z.enum([
  "application/pdf",
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
]);
export type ResumeContentType = z.infer<typeof ResumeContentTypeSchema>;

/**
 * SECURITY (Wave 6 M3): a client-supplied `resumeStorageKey` is later fed to
 * StorageProvider.getSignedDownloadUrl() when a CRM admin opens the application. Without
 * a prefix guard an attacker could submit a key pointing at ANY object in the bucket
 * (another namespace / another tenant) and have the API mint a signed URL for it. The
 * key MUST live under the careers/ namespace; the service additionally pins it to the
 * caller's tenant (careers/{tenantId}/...).
 */
export const ResumeStorageKeySchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^careers\/[A-Za-z0-9._/-]+$/, "resumeStorageKey must be a careers/ object key issued by the resume upload-url endpoint");

/**
 * The offer letter's key is under its OWN namespace, not `careers/`. Resumes are written by
 * anonymous strangers through a public endpoint; offer letters are written by authenticated
 * staff. Keeping them in separate prefixes means the public apply endpoint's prefix guard
 * can never be satisfied by an offer-letter key, and vice versa.
 */
export const OfferLetterStorageKeySchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^offer-letters\/[A-Za-z0-9._/-]+$/, "offerLetterStorageKey must be an offer-letters/ object key issued by the offer-letter upload-url endpoint");

/** Offer letters are documents a candidate signs. PDF only — no editable formats. */
export const OfferLetterContentTypeSchema = z.enum(["application/pdf"]);
export type OfferLetterContentType = z.infer<typeof OfferLetterContentTypeSchema>;

/** POST /api/v1/public/careers/apply (UNAUTHENTICATED) */
export const SubmitCareerApplicationRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(254),
    phone: PhoneSchema.optional(),
    /**
     * The opening being applied to. Optional so an application submitted from a stale page
     * whose opening has since been closed still reaches the CRM rather than 404-ing at the
     * candidate — the API re-checks that the opening is live and, if it is not, records the
     * application against the role title alone. Losing an applicant to a race is worse than
     * an unlinked row a reviewer can re-link by hand.
     */
    jobOpeningId: UuidSchema.optional(),
    /** Snapshot of the role title. Kept even when `jobOpeningId` resolves — see the model
     *  comment in schema.prisma on why the application never re-reads the opening's title. */
    role: z.string().min(1).max(200),
    resumeStorageKey: ResumeStorageKeySchema.describe("StorageProvider object key from the resume upload-url endpoint. NOT a raw file/URL."),
    coverLetter: z.string().max(4000).optional(),
    captchaToken: z.string().min(1),
  })
  .strict();
export type SubmitCareerApplicationRequest = z.infer<typeof SubmitCareerApplicationRequestSchema>;

export const SubmitCareerApplicationResponseSchema = z.object({
  id: UuidSchema,
  message: z.string(),
});
export type SubmitCareerApplicationResponse = z.infer<typeof SubmitCareerApplicationResponseSchema>;

// ── Public resume upload-url (UNAUTHENTICATED — closes the anonymous-upload gap) ──

/**
 * POST /api/v1/public/careers/resume-upload-url (UNAUTHENTICATED)
 *
 * Mints a short-lived signed PUT URL scoped to careers/{tenantId}/... for an
 * anonymous applicant's resume, BEFORE calling POST /public/careers/apply with the
 * resulting storageKey. Captcha-gated + rate-limited (same posture as every other
 * anonymous write in this module — newsletter/contact/careers-apply). Distinct from
 * the authenticated POST /storage/upload-url (JwtAuthGuard) used by
 * students/faculty — an anonymous site visitor has no session to authenticate with.
 */
export const PublicCareerResumeUploadUrlRequestSchema = z
  .object({
    contentType: ResumeContentTypeSchema.describe("MIME type of the resume file. PDF/DOC/DOCX only (Wave 6 M3 allow-list)."),
    fileName: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(1).max(10_485_760).describe("Max 10 MB for a resume upload."),
    captchaToken: z.string().min(1),
  })
  .strict();
export type PublicCareerResumeUploadUrlRequest = z.infer<typeof PublicCareerResumeUploadUrlRequestSchema>;

export const PublicCareerResumeUploadUrlResponseSchema = z.object({
  storageKey: z.string().min(1).describe("Server-assigned object key. Include this as `resumeStorageKey` in the apply() call. NOT a URL."),
  uploadUrl: z.string().url().describe("Short-lived signed PUT URL. PUT the file directly here. Never proxy through the API server."),
  expiresAt: IsoDateTimeSchema,
  additionalHeaders: z.record(z.string(), z.string()).optional(),
  maxSizeBytes: z.number().int().min(1),
});
export type PublicCareerResumeUploadUrlResponse = z.infer<typeof PublicCareerResumeUploadUrlResponseSchema>;

// ── Admin (CRM) reads ───────────────────────────────────────────────────────

export const ListCareerApplicationsQuerySchema = z
  .object({
    status: CareerApplicationStatusSchema.optional(),
    jobOpeningId: UuidSchema.optional().describe("Filter to one opening's applicants."),
    /** Legacy free-text role match, kept for applications with no `jobOpeningId`. */
    role: z.string().min(1).max(200).optional(),
    search: z.string().min(1).max(200).optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListCareerApplicationsQuery = z.infer<typeof ListCareerApplicationsQuerySchema>;

export const CareerApplicationSummarySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  jobOpeningId: UuidSchema.nullable(),
  /** The title applied for, as it read at apply time. Never re-read from the opening. */
  role: z.string(),
  /** The opening's CURRENT title, when it still exists. Shown next to `role` only when the
   *  two differ, which is the one moment a reviewer needs to know the role was renamed. */
  jobOpeningTitle: z.string().nullable(),
  status: CareerApplicationStatusSchema,
  /** Null means the acknowledgement email never went out — see the model comment. */
  acknowledgedAt: IsoDateTimeSchema.nullable(),
  decidedAt: IsoDateTimeSchema.nullable(),
  decidedByName: z.string().nullable(),
  hasOfferLetter: z.boolean(),
  createdAt: IsoDateTimeSchema,
});
export type CareerApplicationSummary = z.infer<typeof CareerApplicationSummarySchema>;

export const CareerApplicationDetailSchema = CareerApplicationSummarySchema.extend({
  coverLetter: z.string().nullable(),
  resumeDownloadUrl: z.string().url().nullable().describe("Short-lived signed URL, minted on demand. Never a raw storage key."),
  offerLetterDownloadUrl: z.string().url().nullable().describe("Short-lived signed URL, minted on demand. Never a raw storage key."),
  offerLetterFileName: z.string().nullable(),
  /** Reviewer-only. The API never exposes this on any public surface and no email quotes it. */
  internalNotes: z.string().nullable(),
  nextRoundName: z.string().nullable(),
  nextRoundDetails: z.string().nullable(),
  /** The opening as it stands today, for the reviewer's context. Null once it is deleted. */
  jobOpening: PublicJobOpeningSchema.nullable(),
});
export type CareerApplicationDetail = z.infer<typeof CareerApplicationDetailSchema>;

// ── Admin (CRM) review verbs ────────────────────────────────────────────────

/**
 * Every verb carries `internalNotes`, and it means the same thing in all four: a note for
 * colleagues. It is stored, shown in the CRM, and never sent to the candidate — the same
 * rule as `OnboardingSubmission.reviewNotes` (P12), for the same reason. A rejection reason
 * is a conversation a person has, not a line in an automated mail nobody can reply to.
 */
const InternalNotesSchema = z.string().max(2000).nullish();

/** POST /api/v1/crm/career-applications/:id/hold — the only verb that sends no email. */
export const HoldCareerApplicationRequestSchema = z
  .object({ internalNotes: InternalNotesSchema })
  .strict();
export type HoldCareerApplicationRequest = z.infer<typeof HoldCareerApplicationRequestSchema>;

/** POST /api/v1/crm/career-applications/:id/shortlist — "you are through to the next round". */
export const ShortlistCareerApplicationRequestSchema = z
  .object({
    /** Named, not numbered: "Technical round" tells a candidate something, "Round 2" does not. */
    roundName: z.string().min(1).max(120).describe('e.g. "Technical interview", "Teaching demo".'),
    /**
     * What the candidate is told to expect — format, duration, who they will meet, how
     * scheduling will happen. Required, because "you are shortlisted" with no next action is
     * the email that generates a support ticket.
     */
    details: z.string().min(1).max(2000),
    internalNotes: InternalNotesSchema,
  })
  .strict();
export type ShortlistCareerApplicationRequest = z.infer<typeof ShortlistCareerApplicationRequestSchema>;

/**
 * POST /api/v1/crm/career-applications/:id/offer — "we are offering you the role".
 *
 * `offerLetterStorageKey` is REQUIRED. An offer email with no letter attached is not an
 * offer, and making the letter optional here is exactly how a candidate ends up with a
 * congratulatory email and nothing to sign.
 */
export const OfferCareerApplicationRequestSchema = z
  .object({
    offerLetterStorageKey: OfferLetterStorageKeySchema,
    offerLetterFileName: z.string().min(1).max(255),
    /** Optional covering note added above the standard offer copy. */
    message: z.string().max(2000).nullish(),
    internalNotes: InternalNotesSchema,
  })
  .strict();
export type OfferCareerApplicationRequest = z.infer<typeof OfferCareerApplicationRequestSchema>;

/** POST /api/v1/crm/career-applications/:id/reject — emails a decline; the reason stays internal. */
export const RejectCareerApplicationRequestSchema = z
  .object({ internalNotes: InternalNotesSchema })
  .strict();
export type RejectCareerApplicationRequest = z.infer<typeof RejectCareerApplicationRequestSchema>;

/**
 * POST /api/v1/crm/career-applications/:id/offer-letter-upload-url (AUTHENTICATED, staff).
 * Mints a signed PUT URL under offer-letters/{tenantId}/... Distinct from the public resume
 * upload-url in both auth and namespace — see OfferLetterStorageKeySchema.
 */
export const OfferLetterUploadUrlRequestSchema = z
  .object({
    contentType: OfferLetterContentTypeSchema,
    fileName: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(1).max(10_485_760).describe("Max 10 MB. An offer letter is a few pages."),
  })
  .strict();
export type OfferLetterUploadUrlRequest = z.infer<typeof OfferLetterUploadUrlRequestSchema>;

/**
 * POST /api/v1/crm/career-applications/:id/resend-acknowledgement — re-send the
 * "thanks for applying" mail when the first attempt failed (`acknowledgedAt` is null).
 * Body-less; the response carries whether the provider accepted it this time.
 */
export const ResendAcknowledgementResponseSchema = z.object({
  sent: z.boolean(),
  acknowledgedAt: IsoDateTimeSchema.nullable(),
});
export type ResendAcknowledgementResponse = z.infer<typeof ResendAcknowledgementResponseSchema>;
