// LMS Lesson contracts — Phase 3, Wave 2 (docs/plans/phase-3.md task #2).
//
// Two distinct endpoints:
//
//   1. `GET /api/v1/lessons/:id` — LessonDetailResponse
//      Returns full lesson metadata + content body + resource list (metadata only,
//      no download URLs in P3) + the student's current progress snapshot.
//      ENROLLMENT-GATED for non-preview lessons: a student must have an active
//      enrollment in the lesson's program. `is_preview=true` lessons are open
//      (no enrollment required). Backend returns 403 for non-enrolled, non-preview
//      access.
//
//   2. `GET /api/v1/lessons/:id/stream-url` — StreamUrlResponse
//      The security-critical endpoint. Mints a SHORT-TTL, PER-USER signed HLS URL
//      via the VideoProvider only AFTER verifying:
//        a) The requesting student owns an active enrollment in the lesson's program
//           (OR the lesson is_preview=true).
//        b) `videos.stream` RBAC permission, scope=own.
//        c) The lesson has a `videos` row with status=ready.
//      Returns ONLY the signed URL + expiry + watermark metadata.
//      NEVER returns: provider_asset_id, a raw manifest URL, a long-lived token,
//      or any signing secret. The URL expires in ≤5 minutes (configured server-side).
//      The player MUST re-call this endpoint on expiry — do NOT cache the URL.
//      This endpoint mints an audit-log row on every call (stream-url mint = auditable).
//
// NO raw video URLs anywhere in this file or in any response DTO.
// The `StreamUrlResponse.url` IS a URL, but it is a short-TTL SIGNED HLS
// manifest URL produced by the VideoProvider, NOT a raw asset URL.
//
// Resources: P3 returns metadata only (title, type, size). Signed download URLs
// are deferred to P4 (needs StorageProvider). The `storageKey` is NEVER exposed
// to the client.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { LessonProgressSnapshotSchema } from "./curriculum.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Video metadata (NO raw URL, NO provider_asset_id)
// ─────────────────────────────────────────────────────────────────────────

export const VideoStatusSchema = z.enum(["processing", "ready", "errored"]);
export type VideoStatus = z.infer<typeof VideoStatusSchema>;

/**
 * Public video metadata embedded in LessonDetailResponse.
 * Deliberately does NOT expose `provider_asset_id` or any raw URL.
 * `captionTracks` is a list of language codes when captions are available
 * (derived from `videos.captions` json column — actual caption data is streamed
 * via the HLS manifest, not returned in this DTO).
 */
export const VideoMetaSchema = z.object({
  status: VideoStatusSchema.describe(
    "processing = transcode not yet complete; ready = streamable; errored = transcode failed.",
  ),
  durationS: z.number().int().min(0).nullable().describe(
    "Duration in seconds. Null while still processing.",
  ),
  captionTracks: z.array(z.string()).describe(
    "Language codes (e.g. ['en', 'hi']) for available caption tracks. " +
    "Actual caption data comes via the HLS manifest, not exposed here.",
  ),
  provider: z.enum(["noop", "cloudflare_stream", "mux"]).describe(
    "Which VideoProvider backend holds the asset. Informational for the player; " +
    "the player does NOT need this to play. It uses the signed HLS URL from stream-url.",
  ),
});
export type VideoMeta = z.infer<typeof VideoMetaSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Resource metadata (P3: title/type/size only — no download URL)
// ─────────────────────────────────────────────────────────────────────────

export const ResourceTypeSchema = z.enum(["pdf", "slide", "dataset", "cheatsheet", "link", "other"]);
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

/**
 * Lesson resource metadata. P3 returns ONLY metadata (title, type, size).
 * Signed download URL minting is deferred to P4 (needs StorageProvider).
 * `storageKey` is NEVER returned to the client — it is a server-internal ref.
 */
export const ResourceMetaSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  type: ResourceTypeSchema,
  sizeBytes: z.number().int().min(0).nullable().describe("File size in bytes. Null if unknown."),
}).describe(
  "P3: metadata only. Download URL minting (signed S3/R2 link) is deferred to P4. " +
  "The `storageKey` is a server-internal field and is never returned to the client.",
);
export type ResourceMeta = z.infer<typeof ResourceMetaSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Resource signed download URL (GET /api/v1/lessons/:id/resources/:resourceId/download-url)
// — P4 follow-up, closed in Phase-9-completion gap #2.
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/lessons/:lessonId/resources/:resourceId/download-url → data field.
 *
 * Mints a SHORT-LIVED signed GET URL for a lesson resource file, mirroring the
 * certificate download pattern (`CertificateDownloadResponseSchema`). Enrollment-gated:
 * the same `resolveEnrollmentForLesson` gate used by lesson-detail/stream-url applies —
 * a student must own an active enrollment in the lesson's program (or the lesson must be
 * `is_preview=true`). NEVER a raw S3/R2 bucket URL. Re-call this endpoint to get a fresh
 * URL — do NOT cache it.
 */
export const ResourceDownloadResponseSchema = z.object({
  downloadUrl: z.string().url().describe(
    "Short-lived signed GET URL for the resource file. Expires at expiresAt. " +
      "NOT a raw S3/R2 URL. Re-call this endpoint to get a fresh URL.",
  ),
  expiresAt: IsoDateTimeSchema.describe("When the signed URL expires."),
  filename: z.string().describe("Suggested filename for download (the resource's title)."),
});
export type ResourceDownloadResponse = z.infer<typeof ResourceDownloadResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Lesson detail (GET /api/v1/lessons/:id)
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/lessons/:id → data field.
 *
 * Enrollment-gated for non-preview lessons (is_preview=false): the requesting
 * student must own an active enrollment in the lesson's program. Returns 403
 * otherwise. Preview lessons (is_preview=true) are accessible without enrollment.
 *
 * `content` is the rich lesson body (HTML/Markdown or structured JSON depending
 * on lesson type). Treated as `unknown` in the contract because its internal
 * structure is type-specific and may evolve; the frontend must handle null.
 *
 * `videoMeta` is present only when `type === 'video'` and a `videos` row exists.
 * To get a playable stream URL call `GET /api/v1/lessons/:id/stream-url`.
 *
 * `resources` lists attached files/links (metadata only in P3).
 */
export const LessonDetailResponseSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  type: z.enum(["video", "reading", "assignment", "quiz"]),
  order: z.number().int().min(0),
  isPreview: z.boolean(),
  moduleId: UuidSchema,
  moduleTitle: z.string(),
  programId: UuidSchema,
  programTitle: z.string(),
  enrollmentId: UuidSchema.nullable().describe(
    "The student's enrollment id for this program. Null for preview lessons " +
    "accessed without enrollment. Always populated for enrolled access.",
  ),
  content: z.unknown().nullable().describe(
    "Rich lesson body, set for ANY lesson type. HTML string for reading; on a video lesson " +
    "it is the summary/notes shown under the player (optional, so often null); structured " +
    "JSON for quiz/assignment. Treat as opaque; handle null gracefully.",
  ),
  videoMeta: VideoMetaSchema.nullable().describe(
    "Present only when type='video' and a videos row exists. Null otherwise. " +
    "No raw URL here. Call GET /lessons/:id/stream-url to get a playable signed HLS URL.",
  ),
  resources: z.array(ResourceMetaSchema).describe(
    "Lesson attachments (metadata only in P3). Empty array if none.",
  ),
  progress: LessonProgressSnapshotSchema.nullable().describe(
    "The student's progress for this lesson. Null = never started or no enrollment.",
  ),
  nextLessonId: UuidSchema.nullable().describe(
    "The id of the next lesson in curriculum order within the same module, or null if last.",
  ),
  prevLessonId: UuidSchema.nullable().describe(
    "The id of the previous lesson in curriculum order, or null if first.",
  ),
});
export type LessonDetailResponse = z.infer<typeof LessonDetailResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Stream URL (GET /api/v1/lessons/:id/stream-url) — the security-critical DTO
// ─────────────────────────────────────────────────────────────────────────

/**
 * Watermark payload embedded in the stream-url response.
 * Used by the frontend player to render a per-user overlay (name + student id).
 * P3 = client-side overlay (semi-transparent text). Provider-side burned-in
 * forensic watermark is deferred (docs/plans/phase-3.md §Risks #3).
 */
export const WatermarkPayloadSchema = z.object({
  text: z.string().describe(
    "Display text for the overlay, e.g. 'Priya Sharma · STU-00123'. " +
    "Derived server-side from the student's name + user id/student-id. " +
    "The frontend renders this as a semi-transparent overlay on the video.",
  ),
  studentId: UuidSchema.describe("The authenticated student's user id, for traceability."),
});
export type WatermarkPayload = z.infer<typeof WatermarkPayloadSchema>;

/**
 * GET /api/v1/lessons/:id/stream-url → data field.
 *
 * *** SECURITY-CRITICAL — READ CAREFULLY ***
 *
 * This endpoint is the ONLY way a client gets a playable video URL.
 * It must NEVER be bypassed or cached long-term.
 *
 * Contract guarantees:
 *   1. SHORT-TTL: `url` expires at `expiresAt` (≤5 min from mint time, server-configured).
 *   2. PER-USER: minted for the specific (student, lesson) pair. The same URL
 *      shared with another user will be rejected by the VideoProvider CDN.
 *   3. NO RAW URL: `url` is a SIGNED HLS manifest URL produced by the VideoProvider.
 *      It is NOT a raw asset URL, NOT a long-lived CDN link, NOT the `provider_asset_id`.
 *   4. ENROLLMENT-GATED: the backend verifies an active enrollment before minting.
 *      Non-enrolled, non-preview → 403. preview=true → 200 without enrollment.
 *   5. AUDITED: every mint writes an audit-log row (actor, lessonId, timestamp).
 *   6. PROVIDER FAIL-CLOSED: if VideoProvider keys are unconfigured → 503 (never a
 *      raw/unsigned fallback URL).
 *
 * Frontend player MUST:
 *   - Call this endpoint just before starting or resuming playback (not on page load).
 *   - Monitor `expiresAt`; re-call on expiry (before or after the URL is rejected).
 *   - NEVER store `url` in localStorage, a Redux store, or any persistent cache.
 *   - NEVER log the `url` value.
 *   - Use `watermark.text` to render a per-user overlay on the player.
 */
export const StreamUrlResponseSchema = z.object({
  url: z.string().url().describe(
    "Short-TTL signed HLS manifest URL. Expires at `expiresAt`. " +
    "Minted per-(user, lesson) by the VideoProvider. NOT a raw asset URL. " +
    "Re-call this endpoint on expiry. Do NOT cache this URL.",
  ),
  expiresAt: IsoDateTimeSchema.describe(
    "ISO-8601 datetime when `url` expires. The player should re-call this endpoint " +
    "before this time (or immediately on a 403 from the CDN). Typically ≤5 min from now.",
  ),
  provider: z.enum(["noop", "cloudflare_stream", "mux"]).describe(
    "Which VideoProvider produced this URL. Informational, the player does not " +
    "need to branch on this; all providers return a standard HLS manifest URL.",
  ),
  watermark: WatermarkPayloadSchema.describe(
    "Per-user watermark payload. The player MUST render this as a visible overlay " +
    "on the video surface (docs/02 §7.3, docs/02 §17). " +
    "P3 = client-side overlay; server-side burned-in watermark is a P4+ feature.",
  ),
});
export type StreamUrlResponse = z.infer<typeof StreamUrlResponseSchema>;
