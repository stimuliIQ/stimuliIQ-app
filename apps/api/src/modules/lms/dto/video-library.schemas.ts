// apps/api/src/modules/lms/dto/video-library.schemas.ts
//
// LOCAL zod DTOs for the video-library ingest surface (T26, docs/plans/
// phase-9-completion.md).
//
// DEVIATION FROM CONVENTION (flagged, not silent): every other module's dto/index.ts
// re-exports schemas from @repo/types. No video-library schema file exists anywhere
// under packages/types/src — Wave-2 (T14) shipped every OTHER Phase-9 contract (flags,
// settings, emi, referrals, invoices/receipt, password-reset) but not this one. This
// task's mandate is apps/api-only ("Do NOT touch packages/*"), so this contract is
// declared locally instead. FOLLOW-UP: backport into
// packages/types/src/lms/video-library.schemas.ts in a future wave.
//
// SCHEMA REALITY (also flagged): `videos.lesson_id` is NOT NULL + UNIQUE (1:1 with
// lesson) in the shipped Wave-1 schema — there is no separate "unattached library" state
// a video can sit in before being attached to a lesson. "Ingest" and "attach to a
// lesson" are therefore the SAME operation (`lessonId` is required at creation) rather
// than two sequential steps. Re-ingesting for a lesson that already has a video REPLACES
// it (soft-deletes the old row, same "reissue" pattern as Certificate.enrollmentId).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "@repo/types";
import { PageQuerySchema } from "@repo/types";

export const VideoStatusSchema = z.enum(["processing", "ready", "errored"]);
export type VideoStatus = z.infer<typeof VideoStatusSchema>;

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
    maxSizeBytes: z.number().int().positive().max(5 * 1024 * 1024 * 1024).optional().describe("Defaults to a 5GB server-side ceiling."),
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
  uploadUrl: z.string().describe("One-time upload URL from the VideoProvider (Cloudflare Stream/Mux/Noop). The client PUTs the file here directly."),
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
 * For providers that DON'T transcode (noop/local dev) the asset flips to `ready`
 * here, because no transcode webhook will ever arrive and the asset would sit on
 * `processing` forever (every stream-url call → 503). For real providers
 * (Cloudflare Stream / Mux) this is a NO-OP on status: "uploaded" is not
 * "transcoded" there, so the existing webhook stays the only thing that can mark
 * an asset ready.
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
 * GET /api/v1/crm/videos/:id/preview-url — a SHORT-TTL signed playback URL so
 * STAFF can verify which file is attached to a lesson before students see it.
 *
 * Mirrors the student stream-url security contract (short TTL, signed, raw
 * storage key / provider asset id never exposed) but is gated on the staff
 * `videolib.view` permission + the module's program scope instead of an
 * enrollment. Never cache the URL — re-call this endpoint on expiry.
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
 * operation.
 */
export const DeleteVideoAssetResponseSchema = z.object({ deleted: z.literal(true) });
export type DeleteVideoAssetResponse = z.infer<typeof DeleteVideoAssetResponseSchema>;
