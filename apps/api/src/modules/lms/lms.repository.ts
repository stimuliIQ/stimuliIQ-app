// apps/api/src/modules/lms/lms.repository.ts
//
// Prisma data-access layer for the LMS content + stream-url module (docs/04 §2.1:
// "repository — data access only, no business logic"). All business logic lives in
// lms.service.ts. All queries are tenant-scoped from the caller's tenantId (CLAUDE.md §3).
//
// The enrollment-scope gate (resolveEnrollmentForLesson) is in lms.service.ts.
// This repository only performs the raw DB queries needed by the service.
//
// Soft-delete: PrismaService.client has the softDeleteExtension applied — any query
// without `deletedAt: undefined` automatically filters out soft-deleted rows. We rely
// on this global filter; we only pass `deletedAt: undefined` when we intentionally
// want to include soft-deleted rows.

import { Injectable } from "@nestjs/common";
import type { Prisma, VideoStatus } from "@prisma/client";
import { summariseCourseProgress } from "@repo/types";
import { PrismaService } from "../../prisma/prisma.service";

// ─── Row types for service layer consumption ─────────────────────────────────

export interface LessonRow {
  id: string;
  moduleId: string;
  title: string;
  type: "video" | "reading" | "assignment" | "quiz";
  order: number;
  content: string | null;
  isPreview: boolean;
  module: {
    id: string;
    title: string;
    order: number;
    program: {
      id: string;
      title: string;
      slug: string;
      durationWeeks: number | null;
      level: string | null;
      domain: string;
    };
  };
  video: VideoRow | null;
  resources: ResourceRow[];
}

export interface VideoRow {
  id: string;
  lessonId: string;
  provider: string;
  providerAssetId: string | null;
  durationS: number | null;
  status: VideoStatus;
  captions: unknown;
}

export interface ResourceRow {
  id: string;
  title: string;
  type: string;
  size: number | null;
  // storage_key is NOT included — never exposed to the client.
}

export interface EnrollmentRow {
  id: string;
  tenantId: string;
  studentId: string;
  batchId: string;
  programId: string;
  status: "active" | "completed" | "dropped";
  progressPct: number;
  enrolledAt: Date;
  completedAt: Date | null;
  source: "manual" | "order" | "conversion";
  batch: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date | null;
  };
  program: {
    id: string;
    title: string;
    slug: string;
    domain: string;
    level: string | null;
    durationWeeks: number | null;
    mode: "live" | "recorded" | "hybrid";
    // Raw storage key of the course-card image. The service mints a public CDN
    // URL from it — the key itself is NEVER returned to the client.
    ogImageKey: string | null;
  };
}

export interface LessonProgressRow {
  id: string;
  enrollmentId: string;
  lessonId: string;
  status: "not_started" | "in_progress" | "completed";
  lastPositionS: number;
  completedAt: Date | null;
  updatedAt: Date;
}

@Injectable()
export class LmsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── LESSON QUERIES ──────────────────────────────────────────────────────

  /**
   * Find a lesson with its full context (module → program, video, resources).
   * Used by the enrollment gate and lesson-detail endpoint.
   * Never exposes storage_key of resources.
   *
   * TENANT-SCOPED (Wave 7 security M-1): the lookup is constrained to the caller's
   * tenant via `module.program.tenantId`. This closes a cross-tenant leak on the
   * PREVIEW path — an unscoped `where:{id}` would let an authenticated student in
   * tenant A resolve (and mint a stream-url for) a preview lesson belonging to
   * tenant B. The enrolled path was already tenant-safe via the enrollment lookup;
   * this makes the gate tenant-safe for BOTH paths.
   */
  async findLessonById(tenantId: string, lessonId: string): Promise<LessonRow | null> {
    const row = await this.prisma.client.lesson.findFirst({
      where: { id: lessonId, module: { program: { tenantId } } },
      include: {
        module: {
          include: {
            program: {
              select: { id: true, title: true, slug: true, durationWeeks: true, level: true, domain: true },
            },
          },
        },
        video: {
          select: {
            id: true,
            lessonId: true,
            provider: true,
            providerAssetId: true,
            durationS: true,
            status: true,
            captions: true,
          },
        },
        resources: {
          select: {
            id: true,
            title: true,
            type: true,
            size: true,
            // storageKey intentionally excluded — never returned to client.
          },
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!row) return null;
    return toLessonRow(row);
  }

  /**
   * Get adjacent lesson IDs (prev/next) in curriculum order within the same module.
   */
  async findAdjacentLessons(
    moduleId: string,
    currentOrder: number,
  ): Promise<{ prevId: string | null; nextId: string | null }> {
    const [prev, next] = await Promise.all([
      this.prisma.client.lesson.findFirst({
        where: { moduleId, order: { lt: currentOrder } },
        orderBy: { order: "desc" },
        select: { id: true },
      }),
      this.prisma.client.lesson.findFirst({
        where: { moduleId, order: { gt: currentOrder } },
        orderBy: { order: "asc" },
        select: { id: true },
      }),
    ]);
    return { prevId: prev?.id ?? null, nextId: next?.id ?? null };
  }

  /**
   * Find a single resource attached to a lesson, INCLUDING storageKey (unlike
   * findLessonById's resource projection, which deliberately excludes it).
   * Used ONLY by the download-url mint path — never returned in any list/detail DTO.
   * TENANT-SCOPED via the lesson→module→program chain (mirrors findLessonById).
   */
  async findResourceById(
    tenantId: string,
    lessonId: string,
    resourceId: string,
  ): Promise<{ id: string; title: string; type: string; storageKey: string } | null> {
    const row = await this.prisma.client.resource.findFirst({
      where: { id: resourceId, lessonId, deletedAt: null, lesson: { module: { program: { tenantId } } } },
      select: { id: true, title: true, type: true, storageKey: true },
    });
    return row ?? null;
  }

  // ─── ENROLLMENT QUERIES ──────────────────────────────────────────────────

  /**
   * Find the student profile id for a given userId + tenantId.
   * Used to resolve userId → studentId for enrollment queries.
   */
  async findStudentProfileId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.studentProfile.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Find the faculty profile id for a given userId + tenantId. Used by the CRM
   * "assigned" scope check (staff acting on their own batch's records)
   */
  async findFacultyProfileId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.facultyProfile.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Staff-scope enrollment lookup (unlike findEnrollmentByIdForStudent, NOT scoped to a
   * single student — staff look up ANY enrollment by id, then the
   * service layer applies the "assigned" scope check via EnrollmentScopeRepository).
   * TENANT-SCOPED. Returns null (caller 404s — no existence disclosure) if not found.
   */
  async findEnrollmentForStaff(
    tenantId: string,
    enrollmentId: string,
  ): Promise<{ id: string; batchId: string; studentId: string; programId: string } | null> {
    const row = await this.prisma.client.enrollment.findFirst({
      where: { id: enrollmentId, tenantId, deletedAt: null },
      select: { id: true, batchId: true, studentId: true, programId: true },
    });
    return row ?? null;
  }

  /**
   * Verify a lesson belongs to the given tenant + (indirectly) to the enrollment's
   * program, via the module→program chain. Used to reject
   * a lessonId that does not belong to the enrollment's program (defense-in-depth; the
   * FK alone would allow any tenant lesson).
   */
  async findLessonProgramId(tenantId: string, lessonId: string): Promise<string | null> {
    const row = await this.prisma.client.lesson.findFirst({
      where: { id: lessonId, module: { program: { tenantId } } },
      select: { module: { select: { programId: true } } },
    });
    return row?.module.programId ?? null;
  }

  /**
   * Find a student's active enrollment in a specific program.
   * Returns null if the student is not actively enrolled.
   */
  async findActiveEnrollmentForProgram(
    tenantId: string,
    studentId: string,
    programId: string,
  ): Promise<EnrollmentRow | null> {
    const row = await this.prisma.client.enrollment.findFirst({
      where: {
        tenantId,
        studentId,
        programId,
        status: "active",
      },
      include: {
        batch: {
          select: { id: true, name: true, startDate: true, endDate: true },
        },
        program: {
          select: { id: true, title: true, slug: true, domain: true, level: true, durationWeeks: true, mode: true, ogImageKey: true },
        },
      },
    });
    if (!row) return null;
    return toEnrollmentRow(row);
  }

  /**
   * Find a specific enrollment by ID, verifying it belongs to the given student.
   * Used for IDOR prevention on /me/enrollments/:id.
   */
  async findEnrollmentByIdForStudent(
    tenantId: string,
    enrollmentId: string,
    studentId: string,
  ): Promise<EnrollmentRow | null> {
    const row = await this.prisma.client.enrollment.findFirst({
      where: { id: enrollmentId, tenantId, studentId },
      include: {
        batch: {
          select: { id: true, name: true, startDate: true, endDate: true },
        },
        program: {
          select: { id: true, title: true, slug: true, domain: true, level: true, durationWeeks: true, mode: true, ogImageKey: true },
        },
      },
    });
    if (!row) return null;
    return toEnrollmentRow(row);
  }

  /**
   * List all enrollments for a student (for /me/enrollments).
   */
  async listEnrollmentsForStudent(
    tenantId: string,
    studentId: string,
    filters: { status?: "active" | "completed" | "dropped"; page: number; pageSize: number },
  ): Promise<{ rows: EnrollmentRow[]; total: number }> {
    const where: Prisma.EnrollmentWhereInput = {
      tenantId,
      studentId,
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.enrollment.findMany({
        where,
        include: {
          batch: { select: { id: true, name: true, startDate: true, endDate: true } },
          program: { select: { id: true, title: true, slug: true, domain: true, level: true, durationWeeks: true, mode: true, ogImageKey: true } },
        },
        orderBy: { enrolledAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.enrollment.count({ where }),
    ]);

    return { rows: rows.map(toEnrollmentRow), total };
  }

  // ─── CURRICULUM QUERIES ──────────────────────────────────────────────────

  /**
   * Get the full curriculum tree for a program (modules → lessons → video meta).
   * Ordered by module.order then lesson.order.
   */
  async getCurriculumForProgram(tenantId: string, programId: string): Promise<CurriculumProgramRow | null> {
    // tenantId used in program lookup to ensure isolation.
    const program = await this.prisma.client.program.findFirst({
      where: { id: programId, tenantId },
      select: {
        id: true,
        title: true,
        slug: true,
        modules: {
          where: { deletedAt: null },
          orderBy: { order: "asc" },
          select: {
            id: true,
            title: true,
            order: true,
            lessons: {
              where: { deletedAt: null },
              orderBy: { order: "asc" },
              select: {
                id: true,
                title: true,
                type: true,
                order: true,
                isPreview: true,
                video: {
                  select: { status: true, durationS: true, captions: true },
                },
              },
            },
          },
        },
      },
    });
    return program;
  }

  /**
   * Get lesson progress rows for an enrollment (for curriculum embedding).
   */
  async getLessonProgressForEnrollment(
    enrollmentId: string,
  ): Promise<LessonProgressRow[]> {
    const rows = await this.prisma.client.lessonProgress.findMany({
      where: { enrollmentId },
      select: {
        id: true,
        enrollmentId: true,
        lessonId: true,
        status: true,
        lastPositionS: true,
        completedAt: true,
        updatedAt: true,
      },
    });
    return rows.map((r) => ({ ...r, status: r.status as LessonProgressRow["status"] }));
  }

  /**
   * Get the lesson progress row for a single (enrollment, lesson) pair.
   */
  async getLessonProgress(
    enrollmentId: string,
    lessonId: string,
  ): Promise<LessonProgressRow | null> {
    const row = await this.prisma.client.lessonProgress.findFirst({
      where: { enrollmentId, lessonId },
      select: {
        id: true,
        enrollmentId: true,
        lessonId: true,
        status: true,
        lastPositionS: true,
        completedAt: true,
        updatedAt: true,
      },
    });
    if (!row) return null;
    return { ...row, status: row.status as LessonProgressRow["status"] };
  }

  // ─── DASHBOARD QUERIES ───────────────────────────────────────────────────

  /**
   * Get the most-recent in-progress lesson progress row for a student across all enrollments.
   * Used for the continue-learning rail.
   */
  async getMostRecentInProgressLesson(
    tenantId: string,
    studentId: string,
  ): Promise<MostRecentProgressRow | null> {
    // Join lesson_progress → enrollment (scoped to studentId) → lesson → module → program.
    const row = await this.prisma.client.lessonProgress.findFirst({
      where: {
        tenantId,
        status: "in_progress",
        enrollment: { studentId, tenantId },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        lessonId: true,
        lastPositionS: true,
        status: true,
        updatedAt: true,
        enrollment: {
          select: { id: true, programId: true },
        },
        lesson: {
          select: {
            id: true,
            title: true,
            type: true,
            module: {
              select: {
                id: true,
                title: true,
                program: { select: { id: true, title: true } },
              },
            },
            video: { select: { durationS: true } },
          },
        },
      },
    });
    return row as MostRecentProgressRow | null;
  }

  /**
   * Count total and completed lessons for a program (for rollup).
   */
  async countLessonsForProgram(programId: string): Promise<number> {
    return this.prisma.client.lesson.count({
      where: { module: { programId }, deletedAt: null },
    });
  }

  /**
   * Count completed lesson_progress rows for an enrollment.
   */
  async countCompletedLessonsForEnrollment(enrollmentId: string): Promise<number> {
    return this.prisma.client.lessonProgress.count({
      where: { enrollmentId, status: "completed" },
    });
  }

  /**
   * Get the next not-started lesson for an enrollment (for upcoming lessons rail).
   */
  async getNextUnstartedLesson(
    programId: string,
    enrollmentId: string,
    completedLessonIds: Set<string>,
  ): Promise<NextLessonRow | null> {
    // Get all lessons ordered by module.order then lesson.order.
    const lessons = await this.prisma.client.lesson.findMany({
      where: {
        module: { programId },
        deletedAt: null,
      },
      orderBy: [
        { module: { order: "asc" } },
        { order: "asc" },
      ],
      select: {
        id: true,
        title: true,
        type: true,
        order: true,
        module: { select: { id: true, title: true, order: true } },
        video: { select: { durationS: true, status: true } },
      },
    });

    // Return the first lesson that is NOT completed.
    for (const lesson of lessons) {
      if (!completedLessonIds.has(lesson.id)) {
        return {
          id: lesson.id,
          title: lesson.title,
          type: lesson.type as "video" | "reading" | "assignment" | "quiz",
          order: lesson.order,
          moduleId: lesson.module.id,
          moduleTitle: lesson.module.title,
          durationS: lesson.video?.durationS ?? null,
          hasVideo: lesson.video?.status === "ready",
        };
      }
    }
    return null;
  }

  // ─── VIDEO QUERIES ───────────────────────────────────────────────────────

  /**
   * Find a video by its provider asset id (used by the webhook processor).
   * Tenant-agnostic — the webhook does not carry a tenant_id; provider_asset_id is globally unique.
   */
  async findVideoByProviderAssetId(
    providerAssetId: string,
  ): Promise<{ id: string; status: VideoStatus; durationS: number | null } | null> {
    const row = await this.prisma.client.video.findFirst({
      where: { providerAssetId },
      select: { id: true, status: true, durationS: true },
    });
    return row;
  }

  /**
   * Find the video for a specific lesson (used in stream-url minting).
   * Returns null if the lesson has no video or it is soft-deleted.
   */
  async findVideoForLesson(
    lessonId: string,
  ): Promise<VideoRow | null> {
    const row = await this.prisma.client.video.findFirst({
      where: { lessonId },
      select: {
        id: true,
        lessonId: true,
        provider: true,
        providerAssetId: true,
        durationS: true,
        status: true,
        captions: true,
      },
    });
    return row ?? null;
  }

  /**
   * Update a video's transcode status (and optionally duration_s). Used by the webhook.
   * Uses the AUDITED prisma client so the status change is recorded in audit_logs.
   */
  async updateVideoTranscodeStatus(
    videoId: string,
    update: { status: VideoStatus; durationS?: number },
  ): Promise<void> {
    await this.prisma.client.video.update({
      where: { id: videoId },
      data: {
        status: update.status,
        ...(update.durationS !== undefined ? { durationS: update.durationS } : {}),
      },
    });
  }

  // ─── STUDENT USER QUERIES ────────────────────────────────────────────────

  /**
   * Get the student's display name and user id for watermark construction.
   */
  async getStudentDisplayInfo(
    userId: string,
  ): Promise<{ name: string; id: string } | null> {
    const row = await this.prisma.client.user.findFirst({
      where: { id: userId },
      select: { id: true, name: true },
    });
    return row;
  }

  // ─── PROGRESS WRITES (Wave 4b) ───────────────────────────────────────────

  /**
   * POSITION PING — upserts lesson_progress (enrollment_id, lesson_id).
   *
   * Uses the NON-AUDITED (base) client because this is called on every player
   * heartbeat (throttled every 5-10 s). Writing an audit row on each ping would
   * produce thousands of audit_logs rows per session. The db-architect's decision
   * (audit.extension.ts §LessonProgress) is: position-ping → base client (no audit);
   * completion transition → audited client.
   *
   * Transitions:
   *   - not_started → in_progress  (status upgraded on first ping)
   *   - in_progress → in_progress  (position updated, status unchanged)
   *   - completed  → completed     (position updated, status NOT downgraded — never regress)
   *
   * Returns the upserted row (for ProgressResponse construction).
   */
  async upsertProgressPing(args: {
    tenantId: string;
    enrollmentId: string;
    lessonId: string;
    lastPositionS: number;
  }): Promise<LessonProgressRow> {
    // We use the base (non-audited) client for this high-frequency path.
    // Prisma does not have a native upsert-with-conditional-status-update, so we
    // do a two-phase findFirst + create/update. The UNIQUE(enrollment_id, lesson_id)
    // constraint prevents duplicate rows even under concurrent pings.
    const existing = await this.prisma.baseClient.lessonProgress.findFirst({
      where: { enrollmentId: args.enrollmentId, lessonId: args.lessonId },
      select: {
        id: true,
        enrollmentId: true,
        lessonId: true,
        status: true,
        lastPositionS: true,
        completedAt: true,
        updatedAt: true,
      },
    });

    if (!existing) {
      // First ping — create with status=in_progress.
      const created = await this.prisma.baseClient.lessonProgress.create({
        data: {
          tenantId: args.tenantId,
          enrollmentId: args.enrollmentId,
          lessonId: args.lessonId,
          status: "in_progress",
          lastPositionS: args.lastPositionS,
        },
        select: {
          id: true,
          enrollmentId: true,
          lessonId: true,
          status: true,
          lastPositionS: true,
          completedAt: true,
          updatedAt: true,
        },
      });
      return { ...created, status: created.status as LessonProgressRow["status"] };
    }

    // Row exists — update position. Never downgrade status from completed.
    const newStatus = existing.status === "not_started" ? "in_progress" : existing.status;
    const updated = await this.prisma.baseClient.lessonProgress.update({
      where: { id: existing.id },
      data: {
        lastPositionS: args.lastPositionS,
        status: newStatus,
      },
      select: {
        id: true,
        enrollmentId: true,
        lessonId: true,
        status: true,
        lastPositionS: true,
        completedAt: true,
        updatedAt: true,
      },
    });
    return { ...updated, status: updated.status as LessonProgressRow["status"] };
  }

  /**
   * COMPLETION — upserts lesson_progress to completed.
   * Called inside a $transaction on the AUDITED client (PrismaService.client).
   *
   * This method receives a transactional prisma client (tx) from the service's
   * $transaction call and uses it for all writes, so both the progress update and
   *
   * Returns the final lesson_progress row.
   */
  async markLessonCompleted(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma extended client $transaction typing limitation (pattern from commerce.repository.ts)
    tx: Prisma.TransactionClient | any,
    args: {
      tenantId: string;
      enrollmentId: string;
      lessonId: string;
    },
  ): Promise<LessonProgressRow> {
    const now = new Date();

    // Upsert lesson_progress: create or update to completed.
    // Using findFirst + create/update (same as ping path) — Prisma's upsert requires
    // both create + update, and the compound unique key is what we check.
    const existing = await tx.lessonProgress.findFirst({
      where: { enrollmentId: args.enrollmentId, lessonId: args.lessonId },
      select: { id: true, status: true, completedAt: true },
    });

    let progress: LessonProgressRow;
    if (!existing) {
      const created = await tx.lessonProgress.create({
        data: {
          tenantId: args.tenantId,
          enrollmentId: args.enrollmentId,
          lessonId: args.lessonId,
          status: "completed",
          lastPositionS: 0,
          completedAt: now,
        },
        select: {
          id: true,
          enrollmentId: true,
          lessonId: true,
          status: true,
          lastPositionS: true,
          completedAt: true,
          updatedAt: true,
        },
      });
      progress = { ...created, status: "completed" };
    } else if (existing.status !== "completed") {
      // Only update if not already completed (idempotency — avoid overwriting completedAt).
      const updated = await tx.lessonProgress.update({
        where: { id: existing.id },
        data: { status: "completed", completedAt: now },
        select: {
          id: true,
          enrollmentId: true,
          lessonId: true,
          status: true,
          lastPositionS: true,
          completedAt: true,
          updatedAt: true,
        },
      });
      progress = { ...updated, status: "completed" };
    } else {
      // Already completed — fetch the full row for the response.
      const row = await tx.lessonProgress.findFirst({
        where: { id: existing.id },
        select: {
          id: true,
          enrollmentId: true,
          lessonId: true,
          status: true,
          lastPositionS: true,
          completedAt: true,
          updatedAt: true,
        },
      });
      // row must exist (we found it above via findFirst on existing.id)
      if (!row) throw new Error("[lms.repository] markLessonCompleted: expected row to exist");
      progress = { ...row, status: "completed" };
    }

    return progress;
  }

  /**
   * Recalculate and persist enrollment.progress_pct + status.
   *
   * The formula is `summariseCourseProgress` (@repo/types) and nothing else — the stored
   * column is a CACHE of that function, never an independent number.
   *
   * IT MOVES IN BOTH DIRECTIONS. It used to flip active→completed at 100% and refuse to do
   * anything below that, on the reasoning that "lessons are never un-completed" so progress
   * could only ever rise. That is true of the numerator and says nothing about the
   * denominator: staff added a module to a programme a student had already finished, and the
   * enrollment sat at "Completed, 100%" while every screen that recomputed the fraction said
   * 98%. So completed→active is now a real transition, taken whenever the work is genuinely
   * unfinished again.
   *
   * TWO THINGS IT DELIBERATELY DOES NOT DO:
   *   - It never touches a `dropped` enrollment. Dropping is somebody's decision, not a
   *     consequence of arithmetic, and re-opening one because the curriculum grew would
   *     quietly re-enroll a student who left.
   *   - It never revokes a certificate. An issued certificate is its own row recording what
   *     was true when it was earned; the student completed the programme as it stood that
   *     day. Re-opening the enrollment asks them to do the new module, it does not withdraw
   *     what they already hold.
   *
   * Called inside the completion $transaction (same tx as markLessonCompleted).
   */
  async recalcEnrollmentProgressPct(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma extended client $transaction typing limitation
    tx: Prisma.TransactionClient | any,
    args: {
      enrollmentId: string;
      programId: string;
    },
  ): Promise<{ progressPct: number; justCompleted: boolean }> {
    // Count total lessons in the program (non-deleted).
    const totalLessons = await tx.lesson.count({
      where: { module: { programId: args.programId }, deletedAt: null },
    });

    // Count completed lesson_progress rows for this enrollment.
    const completedLessons = await tx.lessonProgress.count({
      where: { enrollmentId: args.enrollmentId, status: "completed" },
    });

    const { progressPct, isComplete } = summariseCourseProgress(completedLessons, totalLessons);

    const current = await tx.enrollment.findUnique({
      where: { id: args.enrollmentId },
      select: { status: true },
    });

    // At 100%, flip to `completed` + stamp completedAt — this is what makes an enrollment
    // certificate-worthy (CertificatesService.autoIssueOnCompletion is triggered by the
    // caller right after this transaction commits). Below 100%, flip back: an enrollment
    // reading "Completed" next to unfinished lessons is a lie on every screen at once.
    const shouldFlipToCompleted = isComplete && current?.status === "active";
    const shouldReopen = !isComplete && current?.status === "completed";

    await tx.enrollment.update({
      where: { id: args.enrollmentId },
      data: {
        progressPct,
        ...(shouldFlipToCompleted ? { status: "completed", completedAt: new Date() } : {}),
        // completedAt is cleared with the status: a completion date on an unfinished
        // enrollment is what would let a stale "finished on 3 Aug" survive the reopen.
        ...(shouldReopen ? { status: "active", completedAt: null } : {}),
      },
    });

    // `justCompleted` = this call is the active→completed TRANSITION, not a replay of an
    // already-complete enrollment. The caller fires certificate auto-issue ONLY on the
    // transition, so re-completing a lesson on an already-100% enrollment doesn't re-run
    // the (multi-query) eligibility check every time (security review Low-2).
    return { progressPct, justCompleted: shouldFlipToCompleted };
  }

  /**
   * Resync every enrollment in a programme against the current curriculum.
   *
   * Called whenever the DENOMINATOR moves — today that is adding a lesson (CoursesService),
   * the only path in the codebase that changes a programme's lesson count. One `status`
   * write per row that actually changed, so a curriculum edit on a programme nobody has
   * finished is a couple of reads and no writes at all.
   *
   * Same rules as the single-enrollment recompute above: `dropped` rows are left alone, and
   * certificates are never touched.
   */
  async resyncProgramEnrollments(
    programId: string,
  ): Promise<{ scanned: number; updated: number; reopened: number }> {
    const totalLessons = await this.prisma.client.lesson.count({
      where: { module: { programId }, deletedAt: null },
    });

    const enrollments = await this.prisma.client.enrollment.findMany({
      where: { programId, deletedAt: null, status: { not: "dropped" } },
      select: { id: true, status: true, progressPct: true, completedAt: true },
    });
    if (enrollments.length === 0) return { scanned: 0, updated: 0, reopened: 0 };

    // One grouped count for the whole programme rather than a query per student — a batch
    // of 200 would otherwise be 200 round trips on every lesson somebody adds.
    const completedCounts = await this.prisma.client.lessonProgress.groupBy({
      by: ["enrollmentId"],
      where: { enrollmentId: { in: enrollments.map((e) => e.id) }, status: "completed" },
      _count: { _all: true },
    });
    const completedByEnrollment = new Map<string, number>(
      completedCounts.map((c) => [c.enrollmentId, c._count._all]),
    );

    let updated = 0;
    let reopened = 0;

    for (const enrollment of enrollments) {
      const { progressPct, isComplete } = summariseCourseProgress(
        completedByEnrollment.get(enrollment.id) ?? 0,
        totalLessons,
      );
      const nextStatus = isComplete ? "completed" : "active";
      const pctChanged = enrollment.progressPct !== progressPct;
      const statusChanged = enrollment.status !== nextStatus;
      if (!pctChanged && !statusChanged) continue;

      await this.prisma.client.enrollment.update({
        where: { id: enrollment.id },
        data: {
          progressPct,
          ...(statusChanged
            ? {
                status: nextStatus,
                completedAt: isComplete ? (enrollment.completedAt ?? new Date()) : null,
              }
            : {}),
        },
      });
      updated += 1;
      if (statusChanged && !isComplete) reopened += 1;
    }

    return { scanned: enrollments.length, updated, reopened };
  }

  // ─── PROGRESS READ QUERIES (Wave 4b) ─────────────────────────────────────

  /**
   * Get per-program/module progress rollup for all of a student's enrollments.
   * Used by GET /me/progress.
   * Scoped to the requesting student via studentId (never trusts client-supplied value).
   */
  async getProgressRollup(
    tenantId: string,
    studentId: string,
  ): Promise<ProgressRollupRow[]> {
    // Get all enrollments for the student.
    const enrollments = await this.prisma.client.enrollment.findMany({
      where: { tenantId, studentId },
      select: {
        id: true,
        // The cohort. Carried through to the rollup DTO because the Progress page's
        // leaderboard is scoped by batch and had no batch id to scope with.
        batchId: true,
        programId: true,
        status: true,
        progressPct: true,
        program: {
          select: {
            id: true,
            title: true,
            slug: true,
            modules: {
              where: { deletedAt: null },
              orderBy: { order: "asc" },
              select: {
                id: true,
                title: true,
                order: true,
                lessons: {
                  where: { deletedAt: null },
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });

    const result: ProgressRollupRow[] = [];

    for (const enrollment of enrollments) {
      // Get all lesson_progress rows for this enrollment.
      const progressRows = await this.prisma.client.lessonProgress.findMany({
        where: { enrollmentId: enrollment.id },
        select: { lessonId: true, status: true },
      });
      const completedLessonIds = new Set(
        progressRows.filter((p) => p.status === "completed").map((p) => p.lessonId),
      );

      let totalLessons = 0;
      let completedLessons = 0;
      const modules: ProgressRollupRow["modules"] = [];

      for (const mod of enrollment.program.modules) {
        const modTotal = mod.lessons.length;
        const modCompleted = mod.lessons.filter((l) => completedLessonIds.has(l.id)).length;
        totalLessons += modTotal;
        completedLessons += modCompleted;
        modules.push({
          moduleId: mod.id,
          moduleTitle: mod.title,
          order: mod.order,
          lessonsTotal: modTotal,
          lessonsCompleted: modCompleted,
          progressPct: summariseCourseProgress(modCompleted, modTotal).progressPct,
        });
      }

      result.push({
        enrollmentId: enrollment.id,
        batchId: enrollment.batchId,
        programId: enrollment.programId,
        programTitle: enrollment.program.title,
        programSlug: enrollment.program.slug,
        lessonsTotal: totalLessons,
        lessonsCompleted: completedLessons,
        progressPct: summariseCourseProgress(completedLessons, totalLessons).progressPct,
        status: enrollment.status as "active" | "completed" | "dropped",
        modules,
      });
    }

    return result;
  }
}

// ─── INTERMEDIATE ROW TYPES (internal to lms.repository) ─────────────────────

export interface CurriculumProgramRow {
  id: string;
  title: string;
  slug: string;
  modules: Array<{
    id: string;
    title: string;
    order: number;
    lessons: Array<{
      id: string;
      title: string;
      type: string;
      order: number;
      isPreview: boolean;
      video: {
        status: VideoStatus;
        durationS: number | null;
        captions: unknown;
      } | null;
    }>;
  }>;
}

interface MostRecentProgressRow {
  lessonId: string;
  lastPositionS: number;
  status: "in_progress";
  updatedAt: Date;
  enrollment: { id: string; programId: string };
  lesson: {
    id: string;
    title: string;
    type: string;
    module: {
      id: string;
      title: string;
      program: { id: string; title: string };
    };
    video: { durationS: number | null } | null;
  };
}

interface NextLessonRow {
  id: string;
  title: string;
  type: "video" | "reading" | "assignment" | "quiz";
  order: number;
  moduleId: string;
  moduleTitle: string;
  durationS: number | null;
  hasVideo: boolean;
}

// ─── ADDITIONAL ROW TYPES (Wave 4b) ──────────────────────────────────────────

export interface ProgressRollupRow {
  enrollmentId: string;
  batchId: string | null;
  programId: string;
  programTitle: string;
  programSlug: string;
  lessonsTotal: number;
  lessonsCompleted: number;
  progressPct: number;
  status: "active" | "completed" | "dropped";
  modules: Array<{
    moduleId: string;
    moduleTitle: string;
    order: number;
    lessonsTotal: number;
    lessonsCompleted: number;
    progressPct: number;
  }>;
}



// ─── MAPPING HELPERS ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
function toLessonRow(row: any): LessonRow {
  return {
    id: row.id,
    moduleId: row.moduleId,
    title: row.title,
    type: row.type as "video" | "reading" | "assignment" | "quiz",
    order: row.order,
    content: row.content,
    isPreview: row.isPreview,
    module: {
      id: row.module.id,
      title: row.module.title,
      order: row.module.order,
      program: {
        id: row.module.program.id,
        title: row.module.program.title,
        slug: row.module.program.slug,
        durationWeeks: row.module.program.durationWeeks,
        level: row.module.program.level,
        domain: row.module.program.domain,
      },
    },
    video: row.video
      ? {
          id: row.video.id,
          lessonId: row.video.lessonId,
          provider: row.video.provider,
          providerAssetId: row.video.providerAssetId,
          durationS: row.video.durationS,
          status: row.video.status as VideoStatus,
          captions: row.video.captions,
        }
      : null,
    resources: (row.resources ?? []).map((r: { id: string; title: string; type: string; size: number | null }) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      size: r.size,
    })),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
function toEnrollmentRow(row: any): EnrollmentRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    batchId: row.batchId,
    programId: row.programId,
    status: row.status as "active" | "completed" | "dropped",
    progressPct: row.progressPct,
    enrolledAt: row.enrolledAt,
    completedAt: row.completedAt,
    source: row.source as "manual" | "order" | "conversion",
    batch: {
      id: row.batch.id,
      name: row.batch.name,
      startDate: row.batch.startDate,
      endDate: row.batch.endDate,
    },
    program: {
      id: row.program.id,
      title: row.program.title,
      slug: row.program.slug,
      domain: row.program.domain,
      level: row.program.level,
      durationWeeks: row.program.durationWeeks,
      mode: row.program.mode as "live" | "recorded" | "hybrid",
      ogImageKey: row.program.ogImageKey ?? null,
    },
  };
}
