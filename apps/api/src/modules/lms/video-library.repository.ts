// apps/api/src/modules/lms/video-library.repository.ts
//
// Prisma data access ONLY for the video-library ingest surface (T26, docs/plans/
// phase-9-completion.md). VideoLibraryService is the only caller. Soft-delete + audit
// are handled transparently by the Prisma client extensions (Video is already
// registered in both).
//
// REPLACE-IN-PLACE (not reissue-via-soft-delete): `videos.lesson_id` carries a HARD
// Prisma `@unique` (not a partial/raw-SQL unique like Certificate.enrollmentId /
// EmiPlan.orderId), so a soft-deleted row still occupies the uniqueness slot for that
// lessonId. Re-ingesting for a lesson that already has a video therefore UPDATES the
// EXISTING row in place (fresh provider identifiers, status reset to `processing`,
// duration/captions cleared) rather than soft-delete + recreate.

import { Injectable } from "@nestjs/common";
import { Prisma, type Video as VideoRow, type VideoStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface VideoWithLesson extends VideoRow {
  lesson: { id: string; title: string; module: { programId: string } };
}

export interface ListVideoAssetsFilters {
  tenantId: string;
  status?: VideoStatus;
  search?: string;
  /** "assigned" scope (faculty) — restrict to lessons within these program ids. Omit for "all". */
  restrictToProgramIds?: string[];
  page: number;
  pageSize: number;
}

const VIDEO_INCLUDE_LESSON = {
  lesson: { select: { id: true, title: true, module: { select: { programId: true } } } },
} satisfies Prisma.VideoInclude;

@Injectable()
export class VideoLibraryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** For ownership/scope validation at ingest time. `lessons` carries no `tenant_id` column — tenant scoping goes through module -> program -> tenantId. */
  findLessonForIngest(
    tenantId: string,
    lessonId: string,
  ): Promise<{ id: string; title: string; programId: string } | null> {
    return this.prisma.client.lesson
      .findFirst({
        where: { id: lessonId, deletedAt: null, module: { program: { tenantId } } },
        select: { id: true, title: true, module: { select: { programId: true } } },
      })
      .then((row) => (row ? { id: row.id, title: row.title, programId: row.module.programId } : null));
  }

  findActiveVideoByLessonId(tenantId: string, lessonId: string): Promise<VideoRow | null> {
    return this.prisma.client.video.findFirst({ where: { tenantId, lessonId, deletedAt: null } });
  }

  async createVideo(
    tenantId: string,
    lessonId: string,
    data: { provider: string; providerAssetId: string },
  ): Promise<VideoRow> {
    return this.prisma.client.video.create({
      data: { tenantId, lessonId, provider: data.provider, providerAssetId: data.providerAssetId, status: "processing" },
    });
  }

  /** Replace-in-place — see file header. */
  async replaceVideo(id: string, data: { provider: string; providerAssetId: string }): Promise<VideoRow> {
    return this.prisma.client.video.update({
      where: { id },
      data: {
        provider: data.provider,
        providerAssetId: data.providerAssetId,
        status: "processing",
        durationS: null,
        captions: Prisma.JsonNull,
      },
    });
  }

  async updateCaptions(id: string, captions: Prisma.InputJsonValue): Promise<VideoRow> {
    return this.prisma.client.video.update({ where: { id }, data: { captions } });
  }

  /**
   * Marks an asset streamable after the browser's direct upload succeeded.
   *
   * ONLY used for providers that do NOT transcode (noop/local dev). Real providers
   * (Cloudflare Stream / Mux) keep `status` webhook-driven — see
   * lms-video-webhook.seam.ts — because "uploaded" != "transcoded" there.
   */
  async markReady(id: string, durationS: number | null): Promise<VideoRow> {
    return this.prisma.client.video.update({
      where: { id },
      data: { status: "ready", ...(durationS != null ? { durationS } : {}) },
    });
  }

  async list(filters: ListVideoAssetsFilters): Promise<{ rows: VideoWithLesson[]; total: number }> {
    const where: Prisma.VideoWhereInput = {
      tenantId: filters.tenantId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.restrictToProgramIds ? { lesson: { module: { programId: { in: filters.restrictToProgramIds } } } } : {}),
      ...(filters.search ? { lesson: { title: { contains: filters.search, mode: "insensitive" } } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.video.findMany({
        where,
        include: VIDEO_INCLUDE_LESSON,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.video.count({ where }),
    ]);

    return { rows, total };
  }

  findById(tenantId: string, id: string): Promise<VideoWithLesson | null> {
    return this.prisma.client.video.findFirst({ where: { id, tenantId }, include: VIDEO_INCLUDE_LESSON });
  }

  findOwnFacultyProfileId(tenantId: string, userId: string): Promise<string | null> {
    return this.prisma.client.facultyProfile
      .findFirst({ where: { tenantId, userId, deletedAt: null }, select: { id: true } })
      .then((row) => row?.id ?? null);
  }
}
