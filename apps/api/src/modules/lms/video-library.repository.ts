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
//
// THE SAME UNIQUE IS WHY DELETE NEEDS A RESTORE PATH. `videos` carries TWO uniques on
// `lesson_id`: the partial `videos_active_lesson_id_key` (WHERE deleted_at IS NULL) and
// the FULL `videos_lesson_id_key` from the Prisma `@unique`, which has no WHERE clause
// and was never dropped. A soft-deleted row therefore keeps holding the slot, so
// `createVideo` for that lesson would hit P2002 and the lesson could never be given a
// video again — delete would be a one-way door. Re-ingesting after a delete RESTORES the
// soft-deleted row instead (`findAnyVideoByLessonId` -> `restoreVideo`), the same shape
// `UsersRepository.findAnyByEmail` -> `restore` uses for the full unique on user email.

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

  /**
   * Make a lesson a VIDEO lesson.
   *
   * Called when a video is attached to a lesson of any other type. The LMS renders the
   * player only for `type === "video"` (lesson-detail-content.tsx), so without this the
   * upload succeeds, the transcode completes, and the student sees a reading page with no
   * video anywhere on it — a silent dead end for whoever uploaded it.
   *
   * Idempotent, and narrow on purpose: only the type changes, never the lesson's title,
   * order or content.
   */
  async promoteLessonToVideo(lessonId: string): Promise<void> {
    await this.prisma.client.lesson.updateMany({
      where: { id: lessonId, type: { not: "video" } },
      data: { type: "video" },
    });
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

  /**
   * Any row for this lesson, INCLUDING a soft-deleted one.
   *
   * `deletedAt: undefined` is not a no-op here: softDeleteExtension merges
   * `deletedAt: null` into every `where` that does not already mention the key, and it
   * tests key PRESENCE (`"deletedAt" in where`), so naming it with an undefined value is
   * the documented opt-out. Without this the caller cannot see the soft-deleted row that
   * is still occupying the lesson's unique slot, and would try to create a second one.
   */
  findAnyVideoByLessonId(tenantId: string, lessonId: string): Promise<VideoRow | null> {
    return this.prisma.client.video.findFirst({ where: { tenantId, lessonId, deletedAt: undefined } });
  }

  /**
   * Bring a soft-deleted row back as a NEW upload: undelete and overwrite every field the
   * old file owned.
   *
   * Deliberately identical in effect to `replaceVideo` plus `deletedAt: null` — somebody
   * who deleted a video and then uploaded another one to the same lesson expects the file
   * they just chose, not a half-resurrection still carrying the deleted video's duration
   * and caption tracks. Same call `UsersRepository.restore` makes.
   */
  async restoreVideo(id: string, data: { provider: string; providerAssetId: string }): Promise<VideoRow> {
    return this.prisma.client.video.update({
      where: { id },
      data: {
        deletedAt: null,
        provider: data.provider,
        providerAssetId: data.providerAssetId,
        status: "processing",
        durationS: null,
        captions: Prisma.JsonNull,
      },
    });
  }

  /**
   * Detach the video from its lesson.
   *
   * `delete` is rewritten to `update { deleted_at: now() }` by softDeleteExtension — no
   * row is hard-deleted, and the audit extension records it. The lesson's `type` is left
   * alone on purpose: it is not knowable what the lesson was before a video was attached
   * (`promoteLessonToVideo` does not record it), and the student-facing result is already
   * honest — `LmsService` answers a video lesson with no video row with
   * `lms.video_not_ready`, which the LMS renders as "Video not available yet".
   */
  async softDeleteVideo(id: string): Promise<void> {
    await this.prisma.client.video.delete({ where: { id } });
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
    // SCOPE FIX: both conditions below live under `lesson`, and they used to be spread as
    // two separate `{ lesson: ... }` keys — so the LAST one replaced the first. A faculty
    // member typing in the search box lost `restrictToProgramIds` and saw videos from
    // programs they don't teach (CLAUDE.md §3.5 — the server is the boundary, not the UI).
    // One merged filter makes them additive, which is what they were always meant to be.
    const lessonFilter: Prisma.LessonWhereInput = {
      ...(filters.restrictToProgramIds ? { module: { programId: { in: filters.restrictToProgramIds } } } : {}),
      ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" } } : {}),
    };

    const where: Prisma.VideoWhereInput = {
      tenantId: filters.tenantId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(Object.keys(lessonFilter).length > 0 ? { lesson: lessonFilter } : {}),
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
