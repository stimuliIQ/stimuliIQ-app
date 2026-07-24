// apps/api/src/modules/lms/lms-progress.service.ts
//
// Business logic for the LMS progress + attendance surface (docs/04 §2.1).
// Wave 4b: progress ping, mark-complete (with completion rollup + recorded attendance),
// and the student's progress/attendance read views.
//
// ─── LAYERING ─────────────────────────────────────────────────────────────────
//   This service lives in the same LmsModule (cohesive, bounded) as LmsService.
//   It depends on:
//     - LmsRepository (injected): all DB access, including the new Wave 4b methods.
//     - resolveEnrollmentForLesson (imported from lms-enrollment-gate.ts): THE GATE.
//     - PrismaService.client (audited) for $transaction on completion.
//
// ─── SECURITY CONTRACT ────────────────────────────────────────────────────────
//   1. EVERY write resolves the enrollment via resolveEnrollmentForLesson FIRST.
//      Null result → 404 (no existence disclosure, per the gate contract).
//   2. A student cannot write progress for a lesson they are not enrolled in.
//   3. A student cannot write progress for another student (userId from JWT only).
//   4. Enrollment ids, tenant ids are NEVER trusted from the request body.
//   5. Position pings use the NON-AUDITED client (base) — per db-architect decision
//      to avoid audit-log churn on high-frequency heartbeats.
//   6. Completion uses the AUDITED client inside a $transaction — one audit row per
//      meaningful completion event, not per ping.
//
// ─── IDEMPOTENCY CONTRACT (completion) ────────────────────────────────────────
//   - State-check idempotency: if lesson_progress.status is already "completed",
//     the completion transaction does NOT re-set completedAt, does NOT re-create
//     attendance (already exists), and returns the existing state.
//   - Attendance partial-unique index: UNIQUE(enrollment_id, lesson_id) WHERE
//     source='recorded' (db-architect enforced) means even a concurrent second
//     completion cannot create a duplicate attendance row (the repo catches P2002
//     and treats it as a no-op).
//   - The Idempotency-Key header (from docs/04 §2.14) is the belt-and-suspenders
//     layer at the HTTP boundary — the real idempotency lives in the DB.
//
// ─── PROGRESS_PCT ROLLUP FORMULA ─────────────────────────────────────────────
//   progress_pct = Math.round(completed_lessons / total_lessons_in_program × 100)
//   Clamped to [0, 100]. "total" counts non-soft-deleted lessons across all modules
//   of the program. Computed inside the completion $transaction and written to
//   enrollment.progress_pct atomically.

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  ProgressResponse,
  MyProgressResponse,
  MyAttendanceItem,
  AttendanceSummary,
  AttendanceRecord,
  SetAttendanceRequest,
} from "@repo/types";
import { resolveEnrollmentForLesson } from "./lms-enrollment-gate";
import { LmsRepository } from "./lms.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { EnrollmentScopeRepository } from "../common-scope/enrollment-scope.repository";
import { CertificatesService } from "../certificates/certificates.service";
import type { ListMyAttendanceQuery, UpdateProgressRequest } from "./dto";

@Injectable()
export class LmsProgressService {
  private readonly logger = new Logger(LmsProgressService.name);

  constructor(
    private readonly repo: LmsRepository,
    private readonly prisma: PrismaService,
    private readonly enrollmentScope: EnrollmentScopeRepository,
    private readonly certificatesService: CertificatesService,
  ) {}

  // ─── POSITION PING ────────────────────────────────────────────────────────

  /**
   * PUT /api/v1/me/lessons/:id/progress — position ping.
   *
   * HIGH-FREQUENCY path: the player calls this every 5-10 s during playback.
   *
   * Gate:
   *   - Resolves enrollment via resolveEnrollmentForLesson (the ONE gate).
   *   - Preview lesson with no enrollment → ForbiddenException (cannot write progress
   *     without an enrollment to scope it to).
   *   - Not enrolled and not preview → NotFoundException (404, no existence disclosure).
   *
   * Write:
   *   - Upserts lesson_progress by (enrollment_id, lesson_id) using the BASE
   *     (non-audited) client (no audit row per ping — see audit.extension.ts comment).
   *   - Status transitions: not_started → in_progress; completed stays completed.
   *
   * Returns ProgressResponse including enrollmentProgressPct so the UI can update
   * the progress ring without a separate GET /me/progress call.
   *
   * Permission: progress.edit (own).
   */
  async pingProgress(
    userId: string,
    tenantId: string,
    lessonId: string,
    body: UpdateProgressRequest,
  ): Promise<ProgressResponse> {
    // Gate: enrollment check — THE SINGLE GATE, never bypass.
    const gate = await resolveEnrollmentForLesson(userId, tenantId, lessonId, this.repo);
    if (!gate) {
      // Not enrolled and not preview → 404 (no existence disclosure).
      throw new NotFoundException({ code: "lms.lesson_not_found", title: "Lesson not found" });
    }
    if (!gate.enrollment) {
      // Preview lesson but no enrollment → cannot write progress.
      throw new ForbiddenException({
        code: "lms.progress_requires_enrollment",
        title: "Enrollment required",
        detail: "Cannot write progress for a preview lesson without an active enrollment.",
      });
    }

    const enrollment = gate.enrollment;

    // Clamp lastPositionS: if video has a known duration, clamp to it.
    // If duration is unknown (video still processing), trust the reported value
    // as long as it is ≥ 0 (validated by ZodValidationPipe on the DTO).
    let lastPositionS = body.lastPositionS;
    const video = await this.repo.findVideoForLesson(lessonId);
    if (video?.durationS != null && lastPositionS > video.durationS) {
      lastPositionS = video.durationS;
    }

    // Upsert via NON-AUDITED client (position pings must NOT write audit rows).
    const progress = await this.repo.upsertProgressPing({
      tenantId,
      enrollmentId: enrollment.id,
      lessonId,
      lastPositionS,
    });

    // Get the enrollment's current progress_pct (already stored; no recalc on ping).
    const currentEnrollment = await this.repo.findEnrollmentByIdForStudent(
      tenantId,
      enrollment.id,
      enrollment.studentId,
    );

    this.logger.log(
      `[progress.ping] userId=${userId} lessonId=${lessonId} enrollmentId=${enrollment.id} ` +
      `lastPositionS=${lastPositionS} status=${progress.status}`,
    );

    return {
      lessonId,
      enrollmentId: enrollment.id,
      status: progress.status,
      lastPositionS: progress.lastPositionS,
      completedAt: progress.completedAt ? progress.completedAt.toISOString() : null,
      updatedAt: progress.updatedAt.toISOString(),
      enrollmentProgressPct: currentEnrollment?.progressPct ?? enrollment.progressPct,
    };
  }

  // ─── MARK COMPLETE ────────────────────────────────────────────────────────

  /**
   * POST /api/v1/me/lessons/:id/complete — explicit lesson completion.
   *
   * SECURITY + IDEMPOTENCY:
   *   - Gate via resolveEnrollmentForLesson (same gate as ping).
   *   - Inside ONE $transaction (audited client):
   *       1. Upsert lesson_progress → status=completed + completed_at.
   *       2. Upsert recorded attendance (idempotent, partial-unique enforced by DB).
   *       3. Recalculate enrollment.progress_pct.
   *   - The transaction uses PrismaService.client (audited) so the completion
   *     transition writes exactly ONE audit row for LessonProgress.
   *   - Idempotent: replaying on an already-completed lesson is a no-op.
   *     The attendance repo method checks for an existing row before creating,
   *     and catches P2002 for concurrent race conditions.
   *
   * Permission: progress.edit (own).
   */
  async markComplete(
    userId: string,
    tenantId: string,
    lessonId: string,
  ): Promise<ProgressResponse> {
    // Gate: enrollment check.
    const gate = await resolveEnrollmentForLesson(userId, tenantId, lessonId, this.repo);
    if (!gate) {
      throw new NotFoundException({ code: "lms.lesson_not_found", title: "Lesson not found" });
    }
    if (!gate.enrollment) {
      throw new ForbiddenException({
        code: "lms.progress_requires_enrollment",
        title: "Enrollment required",
        detail: "Cannot mark a preview lesson complete without an active enrollment.",
      });
    }

    const enrollment = gate.enrollment;

    // ONE $transaction on the AUDITED client (completion = meaningful audit event).
    // This ensures: progress row + attendance row + enrollment.progress_pct are committed
    // atomically, and exactly one audit row is written for the LessonProgress mutation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma extended client $transaction typing (pattern from commerce.repository.ts)
    const { progress, newProgressPct, justCompleted } = await (this.prisma.client as any).$transaction(async (tx: any) => {
      // 1. Upsert lesson_progress → completed.
      const progressRow = await this.repo.markLessonCompleted(tx, {
        tenantId,
        enrollmentId: enrollment.id,
        lessonId,
      });

      // 2. Upsert recorded attendance (idempotent: no dup per partial-unique).
      await this.repo.upsertRecordedAttendance(tx, {
        tenantId,
        enrollmentId: enrollment.id,
        lessonId,
      });

      // 3. Recalculate and persist enrollment.progress_pct.
      const { progressPct, justCompleted } = await this.repo.recalcEnrollmentProgressPct(tx, {
        enrollmentId: enrollment.id,
        programId: enrollment.programId,
      });

      return { progress: progressRow, newProgressPct: progressPct, justCompleted };
    });

    this.logger.log(
      `[progress.complete] userId=${userId} lessonId=${lessonId} ` +
      `enrollmentId=${enrollment.id} newProgressPct=${newProgressPct}`,
    );

    // AFTER the $transaction commits (never inside it): PDF render + storage write +
    // notification are external/slow and must not lengthen or block the DB txn. A
    // failure here must never fail the lesson-completion response — the progress is
    // already durably committed above.
    //
    // Gate on `justCompleted` (the active→completed transition), NOT on newProgressPct===100:
    // an already-completed enrollment whose lesson is re-marked stays at 100 but must not
    // re-enter auto-issue every time (security review Low-2). autoIssueOnCompletion is
    // itself idempotent (existing-cert guard), so this is defense-in-depth + an eligibility-
    // recompute saver, not the sole correctness guard.
    if (justCompleted) {
      try {
        const outcome = await this.certificatesService.autoIssueOnCompletion(tenantId, enrollment.id);
        this.logger.debug(
          `[progress.complete] autoIssueOnCompletion enrollmentId=${enrollment.id} ` +
          `issued=${outcome.issued}${outcome.reason ? ` reason=${outcome.reason}` : ""}`,
        );
      } catch (err) {
        this.logger.warn(
          `[progress.complete] autoIssueOnCompletion failed (non-fatal) enrollmentId=${enrollment.id}: ${String(err)}`,
        );
      }
    }

    return {
      lessonId,
      enrollmentId: enrollment.id,
      status: progress.status,
      lastPositionS: progress.lastPositionS,
      completedAt: progress.completedAt ? progress.completedAt.toISOString() : null,
      updatedAt: progress.updatedAt.toISOString(),
      enrollmentProgressPct: newProgressPct,
    };
  }

  // ─── PROGRESS ROLLUP (READ) ───────────────────────────────────────────────

  /**
   * GET /api/v1/me/progress — per-program/module rollup.
   *
   * Returns completion percentages + lesson counts for all of the student's
   * enrollments, with per-module breakdown. Enrollment-scoped (studentId from JWT).
   *
   * Permission: progress.view (own).
   */
  async getProgressRollup(
    userId: string,
    tenantId: string,
  ): Promise<MyProgressResponse> {
    const studentId = await this.repo.findStudentProfileId(tenantId, userId);
    if (!studentId) {
      // Not a student — return empty rollup.
      return {
        programs: [],
        overallLessonsCompleted: 0,
        overallLessonsTotal: 0,
        overallProgressPct: 0,
      };
    }

    const rows = await this.repo.getProgressRollup(tenantId, studentId);

    let overallTotal = 0;
    let overallCompleted = 0;

    const programs = rows.map((row) => {
      overallTotal += row.lessonsTotal;
      overallCompleted += row.lessonsCompleted;
      return {
        enrollmentId: row.enrollmentId,
        programId: row.programId,
        programTitle: row.programTitle,
        programSlug: row.programSlug,
        lessonsTotal: row.lessonsTotal,
        lessonsCompleted: row.lessonsCompleted,
        progressPct: row.progressPct,
        status: row.status,
        modules: row.modules.map((mod) => ({
          moduleId: mod.moduleId,
          moduleTitle: mod.moduleTitle,
          order: mod.order,
          lessonsTotal: mod.lessonsTotal,
          lessonsCompleted: mod.lessonsCompleted,
          progressPct: mod.progressPct,
        })),
      };
    });

    const overallProgressPct = overallTotal > 0 ? Math.round((overallCompleted / overallTotal) * 100) : 0;

    return {
      programs,
      overallLessonsCompleted: overallCompleted,
      overallLessonsTotal: overallTotal,
      overallProgressPct,
    };
  }

  // ─── ATTENDANCE (READ) ────────────────────────────────────────────────────

  /**
   * GET /api/v1/me/attendance — student's recorded attendance (paginated).
   *
   * Read-only. Attendance is always created server-side as a side-effect of
   * lesson completion (or future live class join). The client never POSTs attendance.
   *
   * Enrollment-scoped: only returns rows belonging to this student's enrollments.
   * IDOR: if `enrollmentId` filter is supplied and does not belong to this student,
   * the query returns an empty result (no 403 disclosure of existence).
   *
   * Permission: attendance.view (own).
   */
  async listAttendance(
    userId: string,
    tenantId: string,
    query: ListMyAttendanceQuery,
  ): Promise<{ data: { items: MyAttendanceItem[]; summaries: AttendanceSummary[] }; meta: { page: number; pageSize: number; total: number; hasMore: boolean } }> {
    const studentId = await this.repo.findStudentProfileId(tenantId, userId);
    if (!studentId) {
      return {
        data: { items: [], summaries: [] },
        meta: { page: query.page, pageSize: query.pageSize, total: 0, hasMore: false },
      };
    }

    const [{ rows, total }, summaries] = await Promise.all([
      this.repo.listAttendanceForStudent(tenantId, studentId, {
        enrollmentId: query.enrollmentId,
        source: query.source,
        status: query.status,
        page: query.page,
        pageSize: query.pageSize,
      }),
      this.repo.getAttendanceSummaries(tenantId, studentId),
    ]);

    const items: MyAttendanceItem[] = rows.map((row) => ({
      id: row.id,
      enrollmentId: row.enrollmentId,
      programId: row.programId,
      programTitle: row.programTitle,
      lessonId: row.lessonId,
      lessonTitle: row.lessonTitle,
      liveClassId: row.liveClassId,
      status: row.status,
      source: row.source,
      markedAt: row.markedAt.toISOString(),
    }));

    const summaryDtos: AttendanceSummary[] = summaries.map((s) => ({
      enrollmentId: s.enrollmentId,
      programTitle: s.programTitle,
      totalRecorded: s.totalRecorded,
      totalLessons: s.totalLessons,
      attendancePct: s.attendancePct,
    }));

    return {
      data: { items, summaries: summaryDtos },
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        hasMore: query.page * query.pageSize < total,
      },
    };
  }

  // ─── ATTENDANCE (CRM WRITE — Phase-9-completion gap #6) ──────────────────

  /**
   * PATCH /api/v1/crm/attendance — staff sets/corrects a student's attendance for a
   * (enrollment, lesson) pair. Closes the "attendance is read-only" gap flagged in
   * apps/crm/src/components/attendance/batch-attendance-roster.tsx.
   *
   * SCOPE:
   *   - scope=all (admin/super_admin): any enrollment in the tenant.
   *   - scope=assigned (faculty): only enrollments in batches they teach
   *     (EnrollmentScopeRepository.resolveBatchIdsForFaculty) — IDOR → 404 otherwise
   *     (no existence disclosure, matches certificates.service.ts's identical pattern).
   *
   * Also verifies the lessonId belongs to the enrollment's program (defense-in-depth
   * — rejects a lessonId from an unrelated program even though the FK alone would
   * allow it). AUDITED (Attendance is in AUDITED_MODELS — the repository write itself
   * triggers the audit_logs row via the Prisma extension).
   */
  async setAttendance(
    tenantId: string,
    actorId: string,
    scope: "all" | "assigned" | "branch",
    body: SetAttendanceRequest,
  ): Promise<AttendanceRecord> {
    const enrollment = await this.repo.findEnrollmentForStaff(tenantId, body.enrollmentId);
    if (!enrollment) {
      throw new NotFoundException({ code: "lms.enrollment_not_found", title: "Enrollment not found" });
    }

    if (scope === "assigned") {
      const facultyProfileId = await this.repo.findFacultyProfileId(tenantId, actorId);
      if (!facultyProfileId) {
        throw new NotFoundException({ code: "lms.enrollment_not_found", title: "Enrollment not found" });
      }
      const assignedBatchIds = await this.enrollmentScope.resolveBatchIdsForFaculty(tenantId, facultyProfileId);
      if (!assignedBatchIds.includes(enrollment.batchId)) {
        // IDOR → 404 (no existence disclosure), mirrors certificates.service.ts.
        throw new NotFoundException({ code: "lms.enrollment_not_found", title: "Enrollment not found" });
      }
    } else if (scope !== "all") {
      throw new ForbiddenException({
        code: "attendance.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope}" data-scope is not resolvable for the attendance editor.`,
      });
    }

    const lessonProgramId = await this.repo.findLessonProgramId(tenantId, body.lessonId);
    if (!lessonProgramId || lessonProgramId !== enrollment.programId) {
      throw new NotFoundException({ code: "lms.lesson_not_found", title: "Lesson not found for this enrollment's program" });
    }

    const row = await this.repo.upsertAttendanceForStaff({
      tenantId,
      enrollmentId: body.enrollmentId,
      lessonId: body.lessonId,
      status: body.status,
    });

    this.logger.log(
      `[attendance.edit] actor=${actorId} enrollmentId=${body.enrollmentId} lessonId=${body.lessonId} status=${body.status}`,
    );

    return {
      id: row.id,
      enrollmentId: row.enrollmentId,
      lessonId: row.lessonId,
      status: row.status,
      source: row.source,
      markedAt: row.markedAt.toISOString(),
    };
  }
}
