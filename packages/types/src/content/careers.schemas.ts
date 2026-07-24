// Career application contract — Phase 9 Completion, T14/T32. Backs `model
// CareerApplication`. Public apply at POST /api/v1/public/careers/apply (captcha-gated
// + rate-limited); resume upload uses the existing StorageProvider signed-upload flow
// (learning/storage.schemas.ts GetUploadUrlRequest/SignedUploadResponse, purpose extended
// to 'career_resume' by backend-builder) — this DTO accepts the resulting `storageKey`,
// never a raw file. Admin list/get/update-status under /api/v1/crm/career-applications.

import { z } from "zod";
import { UuidSchema, PhoneSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

export const CareerApplicationStatusSchema = z.enum(["new", "reviewing", "shortlisted", "rejected", "hired"]);
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

/** POST /api/v1/public/careers/apply (UNAUTHENTICATED) */
export const SubmitCareerApplicationRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(254),
    phone: PhoneSchema.optional(),
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
    contentType: ResumeContentTypeSchema.describe("MIME type of the resume file — PDF/DOC/DOCX only (Wave 6 M3 allow-list)."),
    fileName: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(1).max(10_485_760).describe("Max 10 MB for a resume upload."),
    captchaToken: z.string().min(1),
  })
  .strict();
export type PublicCareerResumeUploadUrlRequest = z.infer<typeof PublicCareerResumeUploadUrlRequestSchema>;

export const PublicCareerResumeUploadUrlResponseSchema = z.object({
  storageKey: z.string().min(1).describe("Server-assigned object key. Include this as `resumeStorageKey` in the apply() call. NOT a URL."),
  uploadUrl: z.string().url().describe("Short-lived signed PUT URL. PUT the file directly here — never proxy through the API server."),
  expiresAt: IsoDateTimeSchema,
  additionalHeaders: z.record(z.string(), z.string()).optional(),
  maxSizeBytes: z.number().int().min(1),
});
export type PublicCareerResumeUploadUrlResponse = z.infer<typeof PublicCareerResumeUploadUrlResponseSchema>;

// ── Admin (CRM) ─────────────────────────────────────────────────────────

export const UpdateCareerApplicationStatusRequestSchema = z
  .object({
    status: CareerApplicationStatusSchema,
  })
  .strict();
export type UpdateCareerApplicationStatusRequest = z.infer<typeof UpdateCareerApplicationStatusRequestSchema>;

export const ListCareerApplicationsQuerySchema = z
  .object({
    status: CareerApplicationStatusSchema.optional(),
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
  role: z.string(),
  status: CareerApplicationStatusSchema,
  createdAt: IsoDateTimeSchema,
});
export type CareerApplicationSummary = z.infer<typeof CareerApplicationSummarySchema>;

export const CareerApplicationDetailSchema = CareerApplicationSummarySchema.extend({
  coverLetter: z.string().nullable(),
  resumeDownloadUrl: z.string().url().nullable().describe("Short-lived signed URL, minted on demand. Never a raw storage key."),
});
export type CareerApplicationDetail = z.infer<typeof CareerApplicationDetailSchema>;
