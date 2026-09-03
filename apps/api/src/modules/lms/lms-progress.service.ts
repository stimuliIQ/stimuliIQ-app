// apps/api/src/modules/lms/lms-progress.service.ts
//
// Business logic for the LMS progress surface (docs/04 §2.1).
// Wave 4b: progress ping, mark-complete (with completion rollup), and the student's
// progress read view.
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
//     the existing state.
//     and treats it as a no-op).
//   - The Idempotency-Key header (from docs/04 §2.14) is the belt-and-suspenders
//     layer at the HTTP boundary — the real idempotency lives in the DB.
//
// ─── PROGRESS_PCT ROLLUP FORMULA ─────────────────────────────────────────────
//   summariseCourseProgress(completed_lessons, total_lessons_in_program) — @repo/types,
//   the ONE definition, shared with both frontends. "total" counts non-soft-deleted
//   lessons across all modules of the program. Computed inside the completion
//   $transaction and written to enrollment.progress_pct atomically.
//
//   The stored column is a CACHE of that function and moves in BOTH directions: see
//   LmsRepository.recalcEnrollmentProgressPct, and resyncProgramProgress below for the
//   case where the denominator changes rather than the numerator.

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { summariseCourseProgress } from "@repo/types";
import type {
  ProgressResponse,
  MyProgressResponse,
} from "@repo/types";
import { resolveEnrollmentForLesson } from "./lms-enrollment-gate";
import { LmsRepository } from "./lms.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { EnrollmentScopeRepository } from "../common-scope/enrollment-scope.repository";
import { CertificatesService } from "../certificates/certificates.service";
import { GamificationService } from "../gamification/gamification.service";
import type { UpdateProgressRequest } from "./dto";

@Injectable()
export class LmsProgressService {
  private readonly logger = new Logger(LmsProgressService.name);

  constructor(
    private readonly repo: LmsRepository,
    private readonly prisma: PrismaService,
    private readonly enrollmentScope: EnrollmentScopeRepository,
    private readonly certificatesService: CertificatesService,
    private readonly gamification: GamificationService,
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
   *       3. Recalculate enrollment.progress_pct.
   *   - The transaction uses PrismaService.client (audited) so the completion
   *     transition writes exactly ONE audit row for LessonProgress.
   *   - Idempotent: replaying on an already-completed lesson is a no-op.
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
    // This ensures: progress row + enrollment.progress_pct are committed
    // atomically, and exactly one audit row is written for the LessonProgress mutation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma extended client $transaction typing (pattern from commerce.repository.ts)
    const { progress, newProgressPct, justCompleted } = await (this.prisma.client as any).$transaction(async (tx: any) => {
      // 1. Upsert lesson_progress → completed.
      const progressRow = await this.repo.markLessonCompleted(tx, {
        tenantId,
        enrollmentId: enrollment.id,
        lessonId,
      });


      // 2. Recalculate and persist enrollment.progress_pct.
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
    // Points for the lesson. Idempotent by `(user_id, reason, ref)` — the ledger's partial
    // unique makes a replay a no-op — and non-fatal, exactly like the certificate call
    // below: a scoring failure must never cost the student the lesson they just finished.
    //
    // This call site is why the gamification module existed but did nothing. Awards were
    // built, tested and idempotent, and the only references to them anywhere in the API
    // were the TODO comments naming the call sites nobody added, so `points_ledger` and
    // `user_badges` were never written. The LMS renders XP, badges, a streak and a
    // leaderboard on the Progress page; every student saw zeroes forever.
    try {
      await this.gamification.awardForLessonCompleted(userId, tenantId, progress.id);
    } catch (err) {
      this.logger.warn(
        `[progress.complete] gamification award failed (non-fatal) lessonProgressId=${progress.id}: ${String(err)}`,
      );
    }

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
        batchId: row.batchId,
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

    const overallProgressPct = summariseCourseProgress(overallCompleted, overallTotal).progressPct;

    return {
      programs,
      overallLessonsCompleted: overallCompleted,
      overallLessonsTotal: overallTotal,
      overallProgressPct,
    };
  }

  /**
   * Resync every enrollment in a programme after its curriculum changed.
   *
   * Called by CoursesService when a lesson is added, i.e. when the DENOMINATOR of everyone's
   * progress moves under them. Without it, a student who had finished the programme keeps a
   * stored 100% and a "Completed" badge while every screen that recomputes the fraction
   * shows the real, lower number — which is exactly what happened in production.
   *
   * Best-effort by contract: the caller must not fail a curriculum edit because the resync
   * did. A staff member adding a lesson has done nothing wrong, and the numbers are
   * recoverable (the same sweep runs again on the next edit, and `pnpm resync:progress`
   * fixes a whole tenant). Losing the lesson they just wrote is not recoverable.
   */
  async resyncProgramProgress(
    programId: string,
  ): Promise<{ scanned: number; updated: number; reopened: number }> {
    return this.repo.resyncProgramEnrollments(programId);
  }
}
