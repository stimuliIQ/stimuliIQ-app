// apps/api/src/modules/lms/lms.service.ts
//
// Business logic for the LMS content + stream-url module (docs/04 §2.1: "service —
// business logic, transactions, orchestrates repositories + providers").
//
// SECURITY RESPONSIBILITIES:
//   1. Calls resolveEnrollmentForLesson() BEFORE any content is returned or URL minted.
//   2. Calls mintSignedHlsUrl() ONLY after the gate passes (enrolled or preview).
//   3. NEVER returns a raw asset id, raw manifest URL, or provider credential.
//   4. Builds the per-user watermark text server-side from session data.
//   5. Audits every stream-url mint (audit_logs entry: action="video.stream_url_minted").
//   6. Returns 503 (ServiceUnavailableException) if the VideoProvider throws (fail-closed).
//
// TENANT SCOPING:
//   Every method receives tenantId from req.user.tenantId (JWT). Never trusts
//   client-supplied tenantId or enrollmentId to widen scope.

import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  MeDashboardResponse,
  MyEnrollmentSummary,
  MyEnrollmentDetail,
  CurriculumResponse,
  CurriculumModuleNode,
  CurriculumLessonNode,
  LessonDetailResponse,
  StreamUrlResponse,
  ResourceDownloadResponse,
  LearningPathResponse,
  LearningPathStep,
} from "@repo/types";
import { VIDEO_PROVIDER, DEFAULT_HLS_TTL_SECONDS } from "./providers/video/video-provider.interface";
import type { VideoProvider } from "./providers/video/video-provider.interface";
import {
  STORAGE_PROVIDER,
  DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS,
  type StorageProvider,
} from "../storage/providers/storage/storage-provider.interface";
import { LmsRepository } from "./lms.repository";
import type { LessonProgressRow, EnrollmentRow } from "./lms.repository";
import { mintCdnUrl } from "../content/content.util";
import { resolveEnrollmentForLesson } from "./lms-enrollment-gate";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { PrismaService } from "../../prisma/prisma.service";
import type { ListMyEnrollmentsQuery } from "./dto";

@Injectable()
export class LmsService {
  private readonly logger = new Logger(LmsService.name);

  constructor(
    private readonly repo: LmsRepository,
    private readonly prisma: PrismaService,
    @Inject(VIDEO_PROVIDER) private readonly videoProvider: VideoProvider,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  // ─── DASHBOARD ───────────────────────────────────────────────────────────

  /**
   * GET /api/v1/me/dashboard — student's own dashboard data.
   * Scoped to the requesting user's own enrollments only.
   * Permission: courses.view (own).
   */
  async getDashboard(userId: string, tenantId: string): Promise<MeDashboardResponse> {
    // 1. Resolve the student's profile id.
    const studentId = await this.repo.findStudentProfileId(tenantId, userId);
    if (!studentId) {
      // Not a student — return an empty dashboard (no enrollments).
      return buildEmptyDashboard();
    }

    // 2. Get all enrollments for this student.
    const { rows: enrollments } = await this.repo.listEnrollmentsForStudent(tenantId, studentId, {
      page: 1,
      pageSize: 100, // Dashboard shows all; cap at 100.
    });

    // 3. Build enrollment cards.
    const enrollmentCards = enrollments.map(toEnrollmentCard);

    // 4. Continue-learning: the most-recent in-progress lesson.
    const inProgress = await this.repo.getMostRecentInProgressLesson(tenantId, studentId);
    const continueLearning = inProgress
      ? {
          lessonId: inProgress.lesson.id,
          lessonTitle: inProgress.lesson.title,
          lessonType: inProgress.lesson.type as "video" | "reading" | "assignment" | "quiz",
          moduleId: inProgress.lesson.module.id,
          moduleTitle: inProgress.lesson.module.title,
          programId: inProgress.lesson.module.program.id,
          programTitle: inProgress.lesson.module.program.title,
          enrollmentId: inProgress.enrollment.id,
          lastPositionS: inProgress.lastPositionS,
          durationS: inProgress.lesson.video?.durationS ?? null,
          progressStatus: "in_progress" as const,
          updatedAt: inProgress.updatedAt.toISOString(),
        }
      : null;

    // 5. Progress summary: per-program completion rings.
    const progressSummary = await Promise.all(
      enrollments.map(async (e) => {
        const total = await this.repo.countLessonsForProgram(e.programId);
        const completed = await this.repo.countCompletedLessonsForEnrollment(e.id);
        return {
          enrollmentId: e.id,
          programId: e.programId,
          programTitle: e.program.title,
          progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
          lessonsCompleted: completed,
          lessonsTotal: total,
          status: e.status,
        };
      }),
    );

    // 6. Upcoming lessons: next not-started lesson per enrolled program.
    const upcomingLessons = [];
    for (const e of enrollments) {
      if (e.status !== "active") continue;

      // Get completed lesson ids for this enrollment.
      const progress = await this.repo.getLessonProgressForEnrollment(e.id);
      const completedIds = new Set(
        progress.filter((p) => p.status === "completed").map((p) => p.lessonId),
      );

      const next = await this.repo.getNextUnstartedLesson(e.programId, e.id, completedIds);
      if (next) {
        upcomingLessons.push({
          lessonId: next.id,
          lessonTitle: next.title,
          lessonType: next.type,
          moduleId: next.moduleId,
          moduleTitle: next.moduleTitle,
          programId: e.programId,
          programTitle: e.program.title,
          enrollmentId: e.id,
          order: next.order,
          durationS: next.durationS,
          hasVideo: next.hasVideo,
        });
      }
      if (upcomingLessons.length >= 10) break; // Cap at 10.
    }

    return {
      enrollments: enrollmentCards,
      continueLearning,
      progressSummary,
      upcomingLessons,
      totalEnrollments: enrollments.length,
      totalCompleted: enrollments.filter((e) => e.status === "completed").length,
    };
  }

  // ─── LEARNING PATH ───────────────────────────────────────────────────────

  /**
   * GET /api/v1/me/learning-path — "what to do next" across the student's own
   * active enrollments. One next-up step per active enrollment (the next lesson
   * that isn't completed yet), derived live from lesson_progress — never a
   * parallel progress table. Own-scope only. Permission: progress.view (own).
   *
   * Reuses the exact same per-enrollment "next lesson" computation as the
   * dashboard's upcomingLessons rail (getNextUnstartedLesson), so the two views
   * never disagree about what comes next.
   */
  async getLearningPath(userId: string, tenantId: string): Promise<LearningPathResponse> {
    const studentId = await this.repo.findStudentProfileId(tenantId, userId);
    if (!studentId) {
      return { steps: [] }; // Not a student — no path.
    }

    const { rows: enrollments } = await this.repo.listEnrollmentsForStudent(tenantId, studentId, {
      page: 1,
      pageSize: 100,
    });

    const steps: LearningPathStep[] = [];
    for (const e of enrollments) {
      if (e.status !== "active") continue;

      const progress = await this.repo.getLessonProgressForEnrollment(e.id);
      const statusByLesson = new Map(progress.map((p) => [p.lessonId, p.status]));
      const completedIds = new Set(
        progress.filter((p) => p.status === "completed").map((p) => p.lessonId),
      );

      const next = await this.repo.getNextUnstartedLesson(e.programId, e.id, completedIds);
      if (!next) continue; // Fully completed (or empty) program — nothing next.

      steps.push({
        enrollmentId: e.id,
        programId: e.programId,
        programTitle: e.program.title,
        moduleId: next.moduleId,
        moduleTitle: next.moduleTitle,
        lessonId: next.id,
        lessonTitle: next.title,
        status: (statusByLesson.get(next.id) ?? "not_started") as LearningPathStep["status"],
        isNextUp: true,
      });
    }

    return { steps };
  }

  // ─── ENROLLMENTS ─────────────────────────────────────────────────────────

  /**
   * GET /api/v1/me/enrollments — list the student's own enrollments.
   * Permission: courses.view (own).
   */
  async listEnrollments(
    userId: string,
    tenantId: string,
    query: ListMyEnrollmentsQuery,
  ): Promise<PaginatedResult<MyEnrollmentSummary>> {
    const studentId = await this.repo.findStudentProfileId(tenantId, userId);
    if (!studentId) {
      return new PaginatedResult<MyEnrollmentSummary>([], {
        page: query.page,
        pageSize: query.pageSize,
        total: 0,
        hasMore: false,
      });
    }

    const { rows, total } = await this.repo.listEnrollmentsForStudent(tenantId, studentId, {
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });

    return new PaginatedResult<MyEnrollmentSummary>(
      rows.map(toEnrollmentSummary),
      { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total },
    );
  }

  /**
   * GET /api/v1/me/enrollments/:id — get a specific enrollment.
   * IDOR: returns 404 if the enrollment does not belong to the requesting student.
   * Permission: courses.view (own).
   */
  async getEnrollmentById(
    userId: string,
    tenantId: string,
    enrollmentId: string,
  ): Promise<MyEnrollmentDetail> {
    const studentId = await this.repo.findStudentProfileId(tenantId, userId);
    if (!studentId) {
      throw new NotFoundException({ code: "lms.enrollment_not_found", title: "Enrollment not found" });
    }

    const enrollment = await this.repo.findEnrollmentByIdForStudent(tenantId, enrollmentId, studentId);
    if (!enrollment) {
      // IDOR → 404 (no existence disclosure).
      throw new NotFoundException({ code: "lms.enrollment_not_found", title: "Enrollment not found" });
    }

    // Calculate lesson counts for the detail view.
    const [lessonsTotal, lessonsCompleted] = await Promise.all([
      this.repo.countLessonsForProgram(enrollment.programId),
      this.repo.countCompletedLessonsForEnrollment(enrollmentId),
    ]);

    return {
      ...toEnrollmentSummary(enrollment),
      programDomain: enrollment.program.domain,
      programLevel: (enrollment.program.level ?? "beginner") as "beginner" | "intermediate" | "advanced",
      programDurationWeeks: enrollment.program.durationWeeks ?? 0,
      batchStartDate: (enrollment.batch.startDate.toISOString().split("T")[0] ?? null) as string | null,
      batchEndDate: enrollment.batch.endDate ? (enrollment.batch.endDate.toISOString().split("T")[0] ?? null) : null,
      lessonsTotal,
      lessonsCompleted,
      source: enrollment.source,
    };
  }

  // ─── CURRICULUM ──────────────────────────────────────────────────────────

  /**
   * GET /api/v1/me/enrollments/:id/curriculum — full curriculum tree.
   * Enrollment-gated: the enrollment MUST belong to the requesting student.
   * Per-lesson progress is embedded in the tree.
   * Permission: courses.view (own).
   */
  async getCurriculum(
    userId: string,
    tenantId: string,
    enrollmentId: string,
  ): Promise<CurriculumResponse> {
    // Verify the enrollment belongs to this student (IDOR → 404).
    const studentId = await this.repo.findStudentProfileId(tenantId, userId);
    if (!studentId) {
      throw new NotFoundException({ code: "lms.enrollment_not_found", title: "Enrollment not found" });
    }

    const enrollment = await this.repo.findEnrollmentByIdForStudent(tenantId, enrollmentId, studentId);
    if (!enrollment) {
      throw new NotFoundException({ code: "lms.enrollment_not_found", title: "Enrollment not found" });
    }

    // Get curriculum tree.
    const program = await this.repo.getCurriculumForProgram(tenantId, enrollment.programId);
    if (!program) {
      throw new NotFoundException({ code: "lms.program_not_found", title: "Program not found" });
    }

    // Get all progress rows for this enrollment.
    const progressRows = await this.repo.getLessonProgressForEnrollment(enrollmentId);
    const progressByLessonId = new Map<string, LessonProgressRow>(
      progressRows.map((p) => [p.lessonId, p]),
    );

    // Build curriculum tree with progress and lock flags.
    let totalLessons = 0;
    let completedLessons = 0;

    const modules: CurriculumModuleNode[] = program.modules.map((mod) => {
      let modTotal = 0;
      let modCompleted = 0;

      const lessons: CurriculumLessonNode[] = mod.lessons.map((lesson) => {
        totalLessons++;
        modTotal++;

        const progress = progressByLessonId.get(lesson.id);
        const isCompleted = progress?.status === "completed";
        if (isCompleted) {
          completedLessons++;
          modCompleted++;
        }

        const captionsAvailable =
          lesson.video?.captions !== null &&
          lesson.video?.captions !== undefined &&
          (Array.isArray(lesson.video.captions)
            ? (lesson.video.captions as unknown[]).length > 0
            : true);

        return {
          id: lesson.id,
          title: lesson.title,
          type: lesson.type as "video" | "reading" | "assignment" | "quiz",
          order: lesson.order,
          isPreview: lesson.isPreview,
          locked: false, // P3: no sequential locking for enrolled students.
          hasVideo: lesson.video?.status === "ready",
          durationS: lesson.video?.durationS ?? null,
          captionsAvailable,
          progress: progress
            ? {
                status: progress.status,
                lastPositionS: progress.lastPositionS,
                completedAt: progress.completedAt ? progress.completedAt.toISOString() : null,
              }
            : null,
        };
      });

      const moduleProgressPct = modTotal > 0 ? Math.round((modCompleted / modTotal) * 100) : 0;

      return {
        id: mod.id,
        title: mod.title,
        order: mod.order,
        lessons,
        progress: {
          lessonsTotal: modTotal,
          lessonsCompleted: modCompleted,
          progressPct: moduleProgressPct,
        },
      };
    });

    const progressPct = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    return {
      enrollmentId,
      programId: program.id,
      programTitle: program.title,
      programSlug: program.slug,
      modules,
      totalLessons,
      completedLessons,
      progressPct,
    };
  }

  // ─── LESSON DETAIL ───────────────────────────────────────────────────────

  /**
   * GET /api/v1/lessons/:id — lesson detail.
   * Enrollment-gated: non-preview lessons require an active enrollment.
   * Preview lessons are accessible without enrollment.
   * Permission: lessons.view (own).
   */
  async getLessonDetail(
    userId: string,
    tenantId: string,
    lessonId: string,
  ): Promise<LessonDetailResponse> {
    // Gate: resolves lesson → program → enrollment (or preview exception).
    const gate = await resolveEnrollmentForLesson(userId, tenantId, lessonId, this.repo);
    if (!gate) {
      // Not enrolled and not preview → 404 (no existence disclosure).
      throw new NotFoundException({ code: "lms.lesson_not_found", title: "Lesson not found" });
    }

    // gate.enrollment is non-null if enrolled, null if preview-only.
    const lesson = await this.repo.findLessonById(tenantId, lessonId);
    if (!lesson) {
      throw new NotFoundException({ code: "lms.lesson_not_found", title: "Lesson not found" });
    }

    // Get adjacent lesson IDs for prev/next navigation.
    const { prevId, nextId } = await this.repo.findAdjacentLessons(lesson.moduleId, lesson.order);

    // Get the student's progress for this lesson (null if no enrollment or not started).
    let progressSnapshot: { status: "not_started" | "in_progress" | "completed"; lastPositionS: number; completedAt: string | null } | null = null;
    if (gate.enrollment) {
      const progress = await this.repo.getLessonProgress(gate.enrollment.id, lessonId);
      if (progress) {
        progressSnapshot = {
          status: progress.status,
          lastPositionS: progress.lastPositionS,
          completedAt: progress.completedAt ? progress.completedAt.toISOString() : null,
        };
      }
    }

    // Build video meta (no raw URL, no provider_asset_id).
    let videoMeta: LessonDetailResponse["videoMeta"] = null;
    if (lesson.video) {
      const captionTracks = extractCaptionTracks(lesson.video.captions);
      videoMeta = {
        status: lesson.video.status as "processing" | "ready" | "errored",
        durationS: lesson.video.durationS,
        captionTracks,
        provider: lesson.video.provider as "noop" | "cloudflare_stream" | "mux",
      };
    }

    // Build resource metadata (storage_key NEVER exposed in this response — only metadata).
    //
    // TODO(P4 — resource download wave): add a separate endpoint
    //   GET /lessons/:lessonId/resources/:resourceId/download-url
    // that:
    //   1. Re-verifies enrollment + RBAC (lessons.view, scope=own).
    //   2. Looks up `resources.storage_key` (NOT returned here — excluded from the Prisma
    //      select in lms.repository.ts findLessonById for this reason).
    //   3. Calls `storageProvider.getSignedDownloadUrl({ key: resource.storageKey, ttlSeconds: 300 })`.
    //   4. Returns only `{ url, expiresAt }` — NEVER the raw storage key or bucket URL.
    // The STORAGE_PROVIDER DI token (STORAGE_PROVIDER Symbol, StorageProviderModule) is
    // available since P4 task #3.  Wiring into LmsModule requires:
    //   - Import StorageProviderModule in lms.module.ts.
    //   - @Inject(STORAGE_PROVIDER) in LmsService constructor.
    //   - Add `storageKey` to the resources Prisma select in lms.repository.ts.
    const resources = lesson.resources.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type as "pdf" | "slide" | "dataset" | "cheatsheet" | "link" | "other",
      sizeBytes: r.size,
    }));

    return {
      id: lesson.id,
      title: lesson.title,
      type: lesson.type,
      order: lesson.order,
      isPreview: lesson.isPreview,
      moduleId: lesson.moduleId,
      moduleTitle: lesson.module.title,
      programId: lesson.module.program.id,
      programTitle: lesson.module.program.title,
      enrollmentId: gate.enrollment?.id ?? null,
      content: lesson.content,
      videoMeta,
      resources,
      progress: progressSnapshot,
      nextLessonId: nextId,
      prevLessonId: prevId,
    };
  }

  // ─── RESOURCE DOWNLOAD URL (P4 follow-up — closed here) ──────────────────

  /**
   * GET /api/v1/lessons/:lessonId/resources/:resourceId/download-url
   *
   * Mints a short-lived signed GET URL for a lesson resource file. Mirrors
   * CertificatesService.downloadStudentCertificate's pattern exactly:
   *   1. Re-verifies enrollment via the SAME gate as lesson-detail/stream-url
   *      (resolveEnrollmentForLesson) — enrolled OR preview lesson.
   *   2. Looks up the resource's storageKey (never exposed by findLessonById).
   *   3. Mints via StorageProvider.getSignedDownloadUrl.
   *   4. Returns ONLY { downloadUrl, expiresAt, filename } — never the raw storage key.
   *
   * 404 (no existence disclosure) if: lesson not found, not enrolled and not preview,
   * or the resource does not belong to this lesson.
   *
   * Permission: lessons.view (scope: own).
   */
  async getResourceDownloadUrl(
    userId: string,
    tenantId: string,
    lessonId: string,
    resourceId: string,
  ): Promise<ResourceDownloadResponse> {
    const gate = await resolveEnrollmentForLesson(userId, tenantId, lessonId, this.repo);
    if (!gate) {
      throw new NotFoundException({ code: "lms.lesson_not_found", title: "Lesson not found" });
    }

    const resource = await this.repo.findResourceById(tenantId, lessonId, resourceId);
    if (!resource) {
      throw new NotFoundException({ code: "lms.resource_not_found", title: "Resource not found" });
    }

    const signed = await this.storage.getSignedDownloadUrl({
      key: resource.storageKey,
      ttlSeconds: DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS,
    });

    return {
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
      filename: resource.title,
    };
  }

  // ─── STREAM URL (THE CRITICAL ENDPOINT) ──────────────────────────────────

  /**
   * GET /api/v1/lessons/:id/stream-url — mint a short-TTL signed HLS URL.
   *
   * SECURITY CONTRACT:
   *   a) resolveEnrollmentForLesson gate MUST pass (enrolled OR preview).
   *   b) video row MUST exist and status MUST be "ready".
   *   c) videoProvider.mintSignedHlsUrl() is called with assetId (internal ref).
   *   d) Signed URL + expiry + watermark returned. NEVER raw asset id or manifest URL.
   *   e) Audit log written (action="video.stream_url_minted"). URL value NOT logged.
   *   f) If provider throws → 503 (fail-closed). NEVER return a raw fallback URL.
   *
   * Permission: videos.stream (own).
   */
  async mintStreamUrl(
    userId: string,
    tenantId: string,
    lessonId: string,
  ): Promise<StreamUrlResponse> {
    // Step a: Enrollment + RBAC gate.
    const gate = await resolveEnrollmentForLesson(userId, tenantId, lessonId, this.repo);
    if (!gate) {
      // Not enrolled and not preview → 404 (no existence disclosure).
      throw new NotFoundException({ code: "lms.lesson_not_found", title: "Lesson not found or not accessible" });
    }

    // Step b: Load the video row. Must be "ready".
    const video = await this.repo.findVideoForLesson(lessonId);
    if (!video) {
      throw new ConflictException({
        code: "lms.video_not_ready",
        title: "Video not ready",
        detail: "This lesson has no video or the video is not yet ready for streaming.",
      });
    }
    if (video.status !== "ready") {
      throw new ConflictException({
        code: "lms.video_not_ready",
        title: "Video not ready",
        detail: `Video is currently ${video.status}. Please try again once processing is complete.`,
      });
    }
    if (!video.providerAssetId) {
      throw new ServiceUnavailableException({
        code: "lms.video_not_ready",
        title: "Video not ready",
        detail: "Video asset is not yet available for streaming.",
      });
    }

    // Step c: Mint the signed HLS URL. Fail-closed: throws → 503.
    let mintResult: { url: string; expiresAt: Date; provider: "noop" | "cloudflare_stream" | "mux" };
    try {
      mintResult = await this.videoProvider.mintSignedHlsUrl({
        assetId: video.providerAssetId,
        userId,
        lessonId,
        ttlSeconds: DEFAULT_HLS_TTL_SECONDS,
      });
    } catch (err) {
      this.logger.error(
        `[stream-url] VideoProvider.mintSignedHlsUrl failed for lessonId=${lessonId} — returning 503`,
        err instanceof Error ? err.message : String(err),
      );
      // FAIL CLOSED: never return a raw/unsigned fallback URL.
      throw new ServiceUnavailableException({
        code: "lms.video_provider_unavailable",
        title: "Video provider unavailable",
        detail: "The video streaming service is temporarily unavailable. Please try again shortly.",
      });
    }

    // Step d: Build watermark text server-side from the authenticated user's profile.
    // This is server-authoritative — the client cannot inject their own watermark text.
    const userInfo = await this.repo.getStudentDisplayInfo(userId);
    const watermarkText = userInfo
      ? `${userInfo.name} · ${userId.slice(0, 8)}`
      : `User · ${userId.slice(0, 8)}`;

    // Step e: Audit the mint. NEVER log the URL value (it is a credential).
    this.logger.log(
      `[stream-url] Minted for userId=${userId} lessonId=${lessonId} provider=${mintResult.provider} ` +
        `expiresAt=${mintResult.expiresAt.toISOString()} [URL NOT LOGGED]`,
    );

    // Write an explicit audit log row via the LmsRepository (using the audited Prisma client).
    // We write it directly against the Prisma client to keep the audit in-request with full context.
    await this.prisma.client.auditLog.create({
      data: {
        tenantId,
        actorId: userId,
        entity: "Lesson",
        entityId: lessonId,
        action: "video.stream_url_minted",
        after: {
          lessonId,
          provider: mintResult.provider,
          expiresAt: mintResult.expiresAt.toISOString(),
          // URL value deliberately omitted — it is a credential.
        },
      },
    });

    // Step f: Return StreamUrlResponse. No raw asset id, no provider_asset_id.
    return {
      url: mintResult.url,
      expiresAt: mintResult.expiresAt.toISOString(),
      provider: mintResult.provider,
      watermark: {
        text: watermarkText,
        studentId: userId,
      },
    };
  }
}

// ─── MAPPING HELPERS ──────────────────────────────────────────────────────────

function toEnrollmentCard(e: EnrollmentRow) {
  return {
    enrollmentId: e.id,
    programId: e.programId,
    programTitle: e.program.title,
    programSlug: e.program.slug,
    // Public CDN URL minted from the raw storage key (content.util convention);
    // the key itself is never exposed to the client. Same source toEnrollmentSummary uses.
    programImageUrl: mintCdnUrl(e.program.ogImageKey),
    batchId: e.batchId,
    batchName: e.batch.name,
    status: e.status,
    progressPct: e.progressPct,
    enrolledAt: e.enrolledAt.toISOString(),
    completedAt: e.completedAt ? e.completedAt.toISOString() : null,
  };
}

function toEnrollmentSummary(e: EnrollmentRow): MyEnrollmentSummary {
  return {
    id: e.id,
    programId: e.programId,
    programTitle: e.program.title,
    programSlug: e.program.slug,
    programMode: e.program.mode,
    // Public CDN URL minted from the raw storage key (content.util convention);
    // the key itself is never exposed to the client.
    programImageUrl: mintCdnUrl(e.program.ogImageKey),
    batchId: e.batchId,
    batchName: e.batch.name,
    status: e.status,
    progressPct: e.progressPct,
    enrolledAt: e.enrolledAt.toISOString(),
    completedAt: e.completedAt ? e.completedAt.toISOString() : null,
  };
}

function buildEmptyDashboard(): MeDashboardResponse {
  return {
    enrollments: [],
    continueLearning: null,
    progressSummary: [],
    upcomingLessons: [],
    totalEnrollments: 0,
    totalCompleted: 0,
  };
}

/** Extract caption language codes from the videos.captions JSON column. */
function extractCaptionTracks(captions: unknown): string[] {
  if (!Array.isArray(captions)) return [];
  return captions
    .filter((c): c is { language: string } => typeof c === "object" && c !== null && typeof (c as { language?: unknown }).language === "string")
    .map((c) => c.language);
}
