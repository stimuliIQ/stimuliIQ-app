// apps/api/src/modules/lms/video-library.service.ts
//
// Business logic for the video-library ingest surface (T26, docs/plans/
// phase-9-completion.md). No Prisma here (CLAUDE.md §3.3) — persistence via
// VideoLibraryRepository.
//
// INGEST PATH (deliberate choice — see dto/video-library.schemas.ts file header for the
// full rationale): uses `VideoProvider.createUploadTarget()` (the interface's OWN
// documented "CRM / faculty upload flow" seam — cloudflare-stream-video.provider.ts's
// createUploadTarget() calls the real Cloudflare Stream API and IS fully implemented),
// NOT StorageProvider. Video transcode ingest needs the CDN's native one-time upload
// target so the vendor can transcode it — routing through generic S3/R2 storage first
// would need a separate S3->CDN pipeline that does not exist anywhere in this codebase.
//
// TRANSCODE STATUS: handled entirely by the EXISTING VideoWebhookController /
// VideoWebhookProcessorPort (lms-video-webhook.seam.ts) — this service never touches
// `videos.status` beyond the initial `processing` on ingest/replace.

import { ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { Video as VideoRow } from "@prisma/client";
import { VideoLibraryRepository, type VideoWithLesson } from "./video-library.repository";
import { VIDEO_PROVIDER, DEFAULT_HLS_TTL_SECONDS, type VideoProvider } from "./providers/video/video-provider.interface";
import { EnrollmentScopeRepository } from "../common-scope/enrollment-scope.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { validateEnv } from "../../config/env";
import type {
  CreateVideoAssetRequest,
  CreateVideoAssetResponse,
  ListVideoAssetsQuery,
  VideoAsset,
  AttachCaptionsRequest,
  MarkVideoUploadedRequest,
  VideoPreviewUrlResponse,
} from "./dto/video-library.schemas";

const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

function toDto(row: VideoWithLesson): VideoAsset {
  return {
    id: row.id,
    lessonId: row.lessonId,
    lessonTitle: row.lesson.title,
    provider: row.provider,
    status: row.status,
    durationS: row.durationS,
    captions: (row.captions as VideoAsset["captions"]) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class VideoLibraryService {
  constructor(
    private readonly repository: VideoLibraryRepository,
    private readonly scopeRepository: EnrollmentScopeRepository,
    @Inject(VIDEO_PROVIDER) private readonly videoProvider: VideoProvider,
  ) {}

  /** Resolves "assigned" (faculty) scope into the set of program ids the caller may act within. `undefined` = no restriction ("all"). */
  private async resolveAllowedProgramIds(tenantId: string, actorId: string): Promise<string[] | undefined> {
    const scope = requireScopeContext();
    if (scope.scope === "all") return undefined;
    if (scope.scope === "assigned") {
      const facultyId = await this.repository.findOwnFacultyProfileId(tenantId, actorId);
      if (!facultyId) return []; // fail-closed — no faculty profile, no assigned programs.
      return this.scopeRepository.resolveProgramIdsForFaculty(tenantId, facultyId);
    }
    throw new ForbiddenException({
      code: "videolib.scope_unresolvable",
      title: "Scope not supported",
      detail: `The "${scope.scope}" data-scope is not resolvable for the video-library module.`,
    });
  }

  async create(tenantId: string, actorId: string, body: CreateVideoAssetRequest): Promise<CreateVideoAssetResponse> {
    const allowedProgramIds = await this.resolveAllowedProgramIds(tenantId, actorId);

    const lesson = await this.repository.findLessonForIngest(tenantId, body.lessonId);
    if (!lesson || (allowedProgramIds && !allowedProgramIds.includes(lesson.programId))) {
      throw new NotFoundException({ code: "videolib.lesson_not_found", title: "Lesson not found" }); // IDOR -> 404
    }

    const uploadTarget = await this.videoProvider.createUploadTarget({
      maxSizeBytes: body.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES,
      metadata: { lessonId: lesson.id },
    });

    // A lesson whose content is a video IS a video lesson. The CRM lets an author attach to
    // any lesson (its picker used to hide everything else, which read as "lessons aren't
    // loading"), and the LMS only renders a player for `type === "video"` — so without this
    // the upload would complete and the student would never see it. No-op when it already is.
    await this.repository.promoteLessonToVideo(lesson.id);

    const existing = await this.repository.findActiveVideoByLessonId(tenantId, body.lessonId);
    const row: VideoRow = existing
      ? await this.repository.replaceVideo(existing.id, { provider: this.providerKey(), providerAssetId: uploadTarget.providerAssetId })
      : await this.repository.createVideo(tenantId, body.lessonId, { provider: this.providerKey(), providerAssetId: uploadTarget.providerAssetId });

    const withLesson = await this.repository.findById(tenantId, row.id);
    return { video: toDto(withLesson!), uploadUrl: uploadTarget.uploadUrl };
  }

  async list(tenantId: string, actorId: string, query: ListVideoAssetsQuery): Promise<PaginatedResult<VideoAsset>> {
    const allowedProgramIds = await this.resolveAllowedProgramIds(tenantId, actorId);
    const { rows, total } = await this.repository.list({
      tenantId,
      status: query.status,
      search: query.search,
      restrictToProgramIds: allowedProgramIds,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, actorId: string, id: string): Promise<VideoAsset> {
    const allowedProgramIds = await this.resolveAllowedProgramIds(tenantId, actorId);
    const row = await this.repository.findById(tenantId, id);
    if (!row || (allowedProgramIds && !allowedProgramIds.includes(row.lesson.module.programId))) {
      throw new NotFoundException({ code: "videolib.not_found", title: "Video not found" });
    }
    return toDto(row);
  }

  async attachCaptions(tenantId: string, actorId: string, id: string, body: AttachCaptionsRequest): Promise<VideoAsset> {
    const allowedProgramIds = await this.resolveAllowedProgramIds(tenantId, actorId);
    const row = await this.repository.findById(tenantId, id);
    if (!row || (allowedProgramIds && !allowedProgramIds.includes(row.lesson.module.programId))) {
      throw new NotFoundException({ code: "videolib.not_found", title: "Video not found" });
    }

    await this.repository.updateCaptions(id, body.captions);
    const updated = await this.repository.findById(tenantId, id);
    return toDto(updated!);
  }

  /**
   * POST /crm/videos/:id/uploaded — the browser finished PUTting the file.
   *
   * Providers that transcode (cloudflare_stream / mux) keep their status
   * webhook-driven: "uploaded" is not "ready" there, so this is a status no-op and
   * the asset stays `processing` until the webhook lands. Providers that DON'T
   * transcode (noop/local dev) would otherwise sit on `processing` forever — no
   * webhook is ever sent — making every stream-url call 503. For those we flip to
   * `ready` here, which is the honest state: the file is stored and streamable.
   */
  async markUploaded(tenantId: string, actorId: string, id: string, body: MarkVideoUploadedRequest): Promise<VideoAsset> {
    const allowedProgramIds = await this.resolveAllowedProgramIds(tenantId, actorId);
    const row = await this.repository.findById(tenantId, id);
    if (!row || (allowedProgramIds && !allowedProgramIds.includes(row.lesson.module.programId))) {
      throw new NotFoundException({ code: "videolib.not_found", title: "Video not found" });
    }

    if (this.providerTranscodes()) {
      return toDto(row); // webhook owns status — nothing to do.
    }

    await this.repository.markReady(id, body.durationS ?? null);
    const updated = await this.repository.findById(tenantId, id);
    return toDto(updated!);
  }

  /**
   * GET /crm/videos/:id/preview-url — staff-scoped signed playback URL.
   *
   * Same security contract as the student stream-url (short TTL, signed, no raw
   * key/asset id in the response), but authorised by staff permission + program
   * scope rather than an enrollment. Fails closed: an unconfigured provider throws,
   * which the controller surfaces as 503 — never a raw/unsigned fallback URL.
   */
  async getPreviewUrl(tenantId: string, actorId: string, id: string): Promise<VideoPreviewUrlResponse> {
    const allowedProgramIds = await this.resolveAllowedProgramIds(tenantId, actorId);
    const row = await this.repository.findById(tenantId, id);
    if (!row || (allowedProgramIds && !allowedProgramIds.includes(row.lesson.module.programId))) {
      throw new NotFoundException({ code: "videolib.not_found", title: "Video not found" });
    }
    if (row.status !== "ready" || !row.providerAssetId) {
      throw new ServiceUnavailableException({
        code: "videolib.not_ready",
        title: "Video not ready",
        detail: `This video is "${row.status}". It can be previewed once processing completes.`,
      });
    }

    const minted = await this.videoProvider.mintSignedHlsUrl({
      assetId: row.providerAssetId,
      userId: actorId,
      lessonId: row.lessonId,
      ttlSeconds: DEFAULT_HLS_TTL_SECONDS,
    });

    return {
      url: minted.url,
      expiresAt: minted.expiresAt.toISOString(),
      provider: minted.provider,
    };
  }

  /** The VideoProvider adapter doesn't self-report its key — derived from the same validated env var VideoProviderModule reads (documented small duplication, avoids threading a "which provider" value through the interface just for this one label). */
  private providerKey(): string {
    return validateEnv().VIDEO_PROVIDER;
  }

  /** True for vendors with a real transcode pipeline (status is webhook-driven). */
  private providerTranscodes(): boolean {
    const key = this.providerKey();
    return key === "cloudflare_stream" || key === "mux";
  }
}
