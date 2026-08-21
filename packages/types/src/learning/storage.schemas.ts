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
export const GetUploadUrlRequestSchema = z
  .object({
    contentType: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "MIME type of the file being uploaded (e.g. 'application/pdf', 'image/jpeg'). " +
          "The signed URL policy enforces this content-type on the S3/R2 PUT.",
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
    purpose: z
      .enum(["submission", "resource", "career_resume"])
      .default("submission")
      .describe(
        "Upload purpose determines the storage key prefix: " +
          "'submission' → submissions/{tenantId}/{enrollmentId}/... " +
          "'resource' → resources/{tenantId}/... (faculty/admin only) " +
          "'career_resume' → careers/{tenantId}/.... NOT served by this authenticated " +
          "endpoint (POST /storage/upload-url requires JwtAuthGuard); anonymous site " +
          "visitors use the dedicated PUBLIC endpoint instead: " +
          "POST /public/careers/resume-upload-url (client.public.careers." +
          "getResumeUploadUrl()), which is captcha-gated + rate-limited and always " +
          "forces this purpose server-side.",
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
