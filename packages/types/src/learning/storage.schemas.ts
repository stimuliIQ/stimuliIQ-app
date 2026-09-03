// StorageProvider signed-URL contracts — Phase 4, Wave 2
// (docs/plans/phase-4.md task #2, docs/specs/phase-4-learning-depth.md AC-I).
//
// Design decisions:
//   - The `POST /storage/upload-url` endpoint mints a signed PUT URL.
//     The client PUTs the file directly to S3/R2 without routing through the API server.
//     After the upload completes, the client includes the returned `storageKey` in the
//     submission payload (SubmitAssignmentRequest.files array).
//   - Raw bucket URLs are NEVER returned to the client (AC-I2).
//   - The Noop adapter returns deterministic fake signed URLs for test/local environments.
//   - Purpose discriminates between submission files and (future) resources.
//   - Key scoping is enforced server-side: submissions/{tenantId}/{enrollmentId}/...
//     Any key not matching the expected pattern is rejected (plan §3 StorageProvider).

import { z } from "zod";
import { IsoDateTimeSchema } from "../common/primitives.js";

// ─────────────────────────────────────────────────────────────────────────
// Upload URL request (client → API server)
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/storage/upload-url
 *
 * Student (or faculty) requests a signed PUT URL to upload a file directly to
 * the StorageProvider (S3/R2). The client then PUTs the file to the returned
 * `uploadUrl` with the returned `headers` (content-type, content-length, etc.)
 * WITHOUT routing through the API server.
 *
 * After the upload completes, include `storageKey` in the submission payload.
 *
 * Server enforces:
 *   - Content-type must match the declared `contentType`.
 *   - File size must not exceed `sizeBytes` (embedded in the signed URL policy).
 *   - Key is scoped by server to submissions/{tenantId}/{enrollmentId}/... (AC-I1).
 *   - URL expires in ≤15 minutes (AC-I1).
 *
 * Permission: submissions.create (scope: own) for student file uploads.
 */

/**
 * Allow-list of MIME types a student may upload as assignment work.
 *
 * `contentType` is not advisory: it is locked into the signed PUT and is the
 * Content-Type S3/R2 replays when a faculty member later opens the file through a
 * signed download URL. Accepted as a free string, a student could store `text/html`
 * or `image/svg+xml` under `submissions/` and have the storage origin render their
 * markup in the reviewer's browser. The careers and lesson-resource upload paths
 * already pin their own enums (`ResumeContentTypeSchema`,
 * `LessonResourceContentTypeSchema`); this is the same guard for the one upload path
 * that was still open.
 *
 * The list mirrors what the LMS submission form actually offers
 * (`assignment-detail-content.tsx` — PDF, images, zip, plain text) plus the Office
 * document formats a written assignment is normally handed in as.
 */
export const SubmissionContentTypeSchema = z.enum([
  "application/pdf",
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-powerpoint", // .ppt
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/zip",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
export type SubmissionContentType = z.infer<typeof SubmissionContentTypeSchema>;

export const GetUploadUrlRequestSchema = z
  .object({
    contentType: SubmissionContentTypeSchema.describe(
      "MIME type of the file being uploaded. Allow-listed — the value is locked into the " +
        "signed PUT and replayed on download, so renderable types (text/html, image/svg+xml) " +
        "are refused.",
    ),
    fileName: z
      .string()
      .min(1)
      .max(255)
      .describe("Original filename (used for key generation and download filename hint)."),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(104_857_600) // 100 MB max per upload
      .describe("Exact file size in bytes. Used to set the content-length constraint on the signed URL."),
    // ONE value on purpose. This endpoint mints exactly one kind of key —
    // submissions/{tenantId}/{enrollmentId}/… — and the ONLY branch that verifies the
    // caller owns that enrollment is the `submission` branch. The enum previously also
    // advertised 'resource' and 'career_resume'; neither was ever sent by any client,
    // and both walked straight past the ownership check:
    //   - 'career_resume' fell through to the submissions key builder with a
    //     CLIENT-SUPPLIED, unverified enrollmentId — i.e. any student could mint a
    //     signed PUT into another student's submission prefix.
    //   - 'resource' skipped the check too and then threw (the resources namespace
    //     needs a lessonId scope this endpoint never passes), surfacing as a 500.
    // Lesson resources have their own authenticated endpoint
    // (CoursesService.getResourceUploadUrl) and anonymous resumes have their own public,
    // captcha-gated one (POST /public/careers/resume-upload-url) which forces its own
    // namespace server-side. Neither belongs here.
    purpose: z
      .literal("submission")
      .default("submission")
      .describe(
        "Upload purpose. Only 'submission' is served by this endpoint — the key is always " +
          "submissions/{tenantId}/{enrollmentId}/…, and the server verifies the caller owns " +
          "that enrollment. Lesson resources use POST /crm/lessons/:id/resource-upload-url; " +
          "anonymous career resumes use POST /public/careers/resume-upload-url.",
      ),
    enrollmentId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Required when purpose='submission'. The enrollment the file belongs to. " +
          "Server validates the student owns this enrollment.",
      ),
  })
  .strict();
export type GetUploadUrlRequest = z.infer<typeof GetUploadUrlRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Signed upload URL response (API server → client)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Response from POST /storage/upload-url.
 *
 * USAGE:
 *   1. PUT `file` to `uploadUrl` with header `Content-Type: <originalContentType>`
 *      and optionally `Content-Length: <sizeBytes>`.
 *   2. Use `additionalHeaders` if present (some S3-compatible providers require
 *      extra signed headers).
 *   3. After successful PUT (204), include `storageKey` in your submission payload.
 *   4. NEVER store `uploadUrl` or `downloadUrl` long-term — they are short-lived.
 *
 * The `storageKey` is the server-internal S3/R2 object key (NOT a URL).
 * It is the opaque reference included in submission payloads and stored in the DB.
 * Signed download URLs are minted separately via the submission detail endpoint
 * (or GET /submissions/:id/download-url).
 */
export const SignedUploadResponseSchema = z.object({
  storageKey: z
    .string()
    .min(1)
    .describe(
      "Server-assigned S3/R2 object key. Opaque to the client, include this in the " +
        "submission payload. NOT a URL. Example: 'submissions/t-abc/e-xyz/report.pdf'.",
    ),
  uploadUrl: z
    .string()
    .url()
    .describe(
      "Short-lived signed PUT URL. PUT the file directly to this URL. " +
        "NOT an API endpoint. This is the S3/R2 presigned URL. " +
        "NEVER proxy through the API server. Expires at `expiresAt`.",
    ),
  expiresAt: IsoDateTimeSchema.describe("When the signed upload URL expires (≤15 min from now)."),
  additionalHeaders: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Additional headers to include in the PUT request if present " +
        "(required by some S3-compatible providers for request signing).",
    ),
  maxSizeBytes: z.number().int().min(1).describe("Maximum allowed file size in bytes (server policy)."),
});
export type SignedUploadResponse = z.infer<typeof SignedUploadResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Signed download URL response (minted on demand, per-resource)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Short-lived signed GET URL for a stored file.
 * Returned by:
 *   - GET /submissions/:id/download-url (per-file, RBAC checked)
 *   - GET /me/certificates/:id/download (own cert PDF)
 *   - Embedded in SubmissionDetailSchema.fileDownloadUrls
 *
 * NEVER a raw bucket URL (AC-I2).
 */
export const SignedDownloadUrlSchema = z.object({
  url: z.string().url().describe(
    "Short-lived signed GET URL. Expires at `expiresAt`. NOT a raw bucket URL.",
  ),
  expiresAt: IsoDateTimeSchema.describe("When this URL expires."),
  contentType: z.string().describe("MIME type of the file."),
  filename: z.string().describe("Suggested filename for download."),
  sizeBytes: z.number().int().nullable().describe("File size in bytes, or null if unknown."),
});
export type SignedDownloadUrl = z.infer<typeof SignedDownloadUrlSchema>;
