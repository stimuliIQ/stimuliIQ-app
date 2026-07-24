// Typed CRM video-library SDK — Phase 9 Completion T26 follow-up (promoted from a
// backend-local schema; see @repo/types lms/video-library.schemas.ts file header).
//
// Namespace: client.crm.videoLibrary.*
//
// "Ingest" and "attach to a lesson" are the SAME operation (`lessonId` required at
// creation, see file header) — re-ingesting for a lesson that already has a video
// REPLACES it. `create()` returns both the video row and the one-time upload URL the
// caller PUTs the raw file to directly (never proxied through this API).

import type {
  CreateVideoAssetRequest,
  CreateVideoAssetResponse,
  ListVideoAssetsQuery,
  VideoAsset,
  AttachCaptionsRequest,
  MarkVideoUploadedRequest,
  VideoPreviewUrlResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class VideoLibraryApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/videos — permission: videolib.view */
  async list(query: Partial<ListVideoAssetsQuery> = {}) {
    return this.client.requestPaginated<VideoAsset>("GET", `/api/v1/crm/videos${toQueryString(query)}`);
  }

  /** GET /api/v1/crm/videos/:id — permission: videolib.view */
  async get(id: string): Promise<VideoAsset> {
    return this.client.request<VideoAsset>("GET", `/api/v1/crm/videos/${id}`);
  }

  /**
   * POST /api/v1/crm/videos — ingest (== attach to a lesson, see file header) +
   * presigned upload URL. Permission: videolib.upload.
   */
  async create(
    body: CreateVideoAssetRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CreateVideoAssetResponse> {
    return this.client.request<CreateVideoAssetResponse>("POST", "/api/v1/crm/videos", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/videos/:id/captions — replaces the full caption-track list. Permission: videolib.edit */
  async attachCaptions(
    id: string,
    body: AttachCaptionsRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<VideoAsset> {
    return this.client.request<VideoAsset>("PATCH", `/api/v1/crm/videos/${id}/captions`, { body, idempotencyKey });
  }

  /**
   * POST /api/v1/crm/videos/:id/uploaded — confirm the direct PUT finished.
   * Marks non-transcoding providers (local dev) `ready`; a status no-op for
   * Cloudflare Stream / Mux, where the transcode webhook stays authoritative.
   * Permission: videolib.upload.
   */
  async markUploaded(
    id: string,
    body: MarkVideoUploadedRequest = {},
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<VideoAsset> {
    return this.client.request<VideoAsset>("POST", `/api/v1/crm/videos/${id}/uploaded`, { body, idempotencyKey });
  }

  /**
   * GET /api/v1/crm/videos/:id/preview-url — short-TTL signed playback URL so staff
   * can verify the attached file. Do NOT cache the URL; re-call on expiry.
   * Permission: videolib.view.
   */
  async previewUrl(id: string): Promise<VideoPreviewUrlResponse> {
    return this.client.request<VideoPreviewUrlResponse>("GET", `/api/v1/crm/videos/${id}/preview-url`);
  }
}
