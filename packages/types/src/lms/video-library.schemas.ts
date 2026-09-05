// packages/types/src/lms/video-library.schemas.ts
//
// Shared contract for the CRM video-library ingest surface (T26, Phase 9 Completion) —
// PROMOTED from the STOPGAP local schema at
// apps/api/src/modules/lms/dto/video-library.schemas.ts (see that file's header for
// the full original rationale). This package is now the canonical shared contract;
// the backend controller/service currently still import their own local copy — the
// two shapes MUST stay structurally identical.
//
// SCHEMA REALITY (carried over from the original file header): `videos.lesson_id` is
// NOT NULL + UNIQUE (1:1 with lesson) in the shipped Wave-1 schema — there is no
// separate "unattached library" state a video can sit in before being attached to a
// lesson. "Ingest" and "attach to a lesson" are therefore the SAME operation
// (`lessonId` is required at creation) rather than two sequential steps. Re-ingesting
// for a lesson that already has a video REPLACES it (soft-deletes the old row, same
// "reissue" pattern as Certificate.enrollmentId).
//
// Endpoints (CRM, authenticated):
//   GET   /api/v1/crm/videos               — permission: videolib.view
//   GET   /api/v1/crm/videos/:id           — permission: videolib.view
//   POST  /api/v1/crm/videos               — permission: videolib.upload
//   PATCH /api/v1/crm/videos/:id/captions  — permission: videolib.edit

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
// Reused verbatim from lessons.schemas.ts (identical enum: processing/ready/errored) —
// one canonical VideoStatus definition, not a second divergent one (CLAUDE.md §3.2).
// NOT re-exported here (avoids an ambiguous-export collision in index.ts) — import
// VideoStatusSchema/VideoStatus directly from @repo/types (already exported via
// lessons.schemas.js) when needed alongside this file's DTOs.
import { VideoStatusSchema } from "./lessons.schemas.js";

export const VideoCaptionSchema = z.object({
  language: z.string().min(2).max(10).describe("BCP-47-ish language code, e.g. 'en', 'hi'."),
  url: z.string().url(),
  label: z.string().max(100).optional(),
});
export type VideoCaption = z.infer<typeof VideoCaptionSchema>;

/** POST /api/v1/crm/videos — ingest (== attach, see file header) a video asset for a lesson. */
export const CreateVideoAssetRequestSchema = z
  .object({
    lessonId: UuidSchema,
    maxSizeBytes: z
      .number()
      .int()
      .positive()
      .max(5 * 1024 * 1024 * 1024)
      .optional()
      .describe("Defaults to a 5GB server-side ceiling."),
  })
  .strict();
export type CreateVideoAssetRequest = z.infer<typeof CreateVideoAssetRequestSchema>;

export const VideoAssetSchema = z.object({
  id: UuidSchema,
  lessonId: UuidSchema,
  lessonTitle: z.string(),
  provider: z.string(),
  status: VideoStatusSchema,
  durationS: z.number().int().nullable(),
  captions: z.array(VideoCaptionSchema).nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type VideoAsset = z.infer<typeof VideoAssetSchema>;

export const CreateVideoAssetResponseSchema = z.object({
  video: VideoAssetSchema,
  uploadUrl: z
    .string()
    .describe(
      "One-time upload URL from the VideoProvider (Cloudflare Stream/Mux/Noop). The client PUTs the file here directly.",
    ),
});
export type CreateVideoAssetResponse = z.infer<typeof CreateVideoAssetResponseSchema>;

export const ListVideoAssetsQuerySchema = z
  .object({
    status: VideoStatusSchema.optional(),
    search: z.string().min(1).max(200).optional().describe("Match by lesson title."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListVideoAssetsQuery = z.infer<typeof ListVideoAssetsQuerySchema>;

/** PATCH /api/v1/crm/videos/:id/captions — replaces the full caption-track list. */
export const AttachCaptionsRequestSchema = z
  .object({
    captions: z.array(VideoCaptionSchema).max(20),
  })
  .strict();
export type AttachCaptionsRequest = z.infer<typeof AttachCaptionsRequestSchema>;

/**
 * POST /api/v1/crm/videos/:id/uploaded — the CRM confirms the browser's direct
 * PUT to the signed upload URL finished.
 *
 * Providers that DON'T transcode (noop/local dev) flip to `ready` here, because no
 * transcode webhook will ever arrive and the asset would sit on `processing`
 * forever (every stream-url call → 503). For Cloudflare Stream / Mux this is a
 * status no-op: "uploaded" is not "transcoded", so the webhook stays authoritative.
 */
export const MarkVideoUploadedRequestSchema = z
  .object({
    durationS: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60)
      .optional()
      .describe("Duration read from the browser's <video> metadata, if available."),
  })
  .strict();
export type MarkVideoUploadedRequest = z.infer<typeof MarkVideoUploadedRequestSchema>;

/**
 * GET /api/v1/crm/videos/:id/preview-url — SHORT-TTL signed playback URL so STAFF
 * can verify which file is attached to a lesson before students see it.
 *
 * Same security contract as the student stream-url (short TTL, signed, raw storage
 * key / provider asset id never exposed), but gated on the staff `videolib.view`
 * permission + program scope instead of an enrollment. Never cache the URL.
 */
export const VideoPreviewUrlResponseSchema = z.object({
  url: z.string().url().describe("Short-TTL signed playback URL. Do NOT cache."),
  expiresAt: IsoDateTimeSchema,
  provider: z.string(),
});
export type VideoPreviewUrlResponse = z.infer<typeof VideoPreviewUrlResponseSchema>;

/**
 * `DELETE /crm/videos/:id` response — soft-delete, mirroring the `{ deleted: true }`
 * shape every other delete route in the CRM returns (colleges, partners, content pages).
 *
 * The video row is soft-deleted, not purged: uploading again to the same lesson RESTORES
 * that row as a new asset, because `videos.lesson_id` carries a full unique a deleted row
 * keeps occupying. The remote CDN asset is left in place — `VideoProvider` has no delete
 * operation (see VideoLibraryService.remove).
 */
export const DeleteVideoAssetResponseSchema = z.object({ deleted: z.literal(true) });
export type DeleteVideoAssetResponse = z.infer<typeof DeleteVideoAssetResponseSchema>;
