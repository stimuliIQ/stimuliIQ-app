// apps/api/src/modules/assignments/assignments.service.ts
//
// Business logic for Assignments + Submissions + Projects module (P4 Wave 4 task #6).
// (CLAUDE.md §3.3: "service — business logic, transactions, idempotency, emits domain events
// post-commit. No Prisma in controllers.")
//
// SECURITY RESPONSIBILITIES:
//   1. Enrollment-gate: student may only submit to assignments in their enrolled program.
//   2. IDOR → 404: cross-student submission access returns NotFoundException (404), not 403.
//   3. Resubmit policy: enforce allow_resubmit flag BEFORE inserting (service guard).
//   4. Faculty assigned-scope: faculty resolves to their own batch ids; any submission
//      not in those batches → NotFoundException (404, as per plan §6 Risk #1).
//   5. Due-date enforcement: submission after due_at → 422 ASSIGNMENT_OVERDUE.
//   6. Audit: every grade write includes before/after log entry (AC-B1, AC-B3).
//   7. Signed file download URLs: minted on demand; storage keys NEVER returned raw.

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  AssignmentDetail,
  AssignmentSummary,
  AssignmentListItem,
  AssignmentStudentDetail,
  CreateAssignmentRequest,
  UpdateAssignmentRequest,
  SubmitAssignmentRequest,
  GradeSubmissionRequest,
  ReturnSubmissionRequest,
  SubmissionDetail,
  SubmissionSummary,
  ProjectDetail,
  ListAssignmentsQuery,
  ListSubmissionsQuery,
  MilestoneReviewState,
  SignedUploadResponse,
  GetUploadUrlRequest,
} from "@repo/types";
import { STORAGE_PROVIDER } from "../storage/providers/storage/storage-provider.interface";
import { S3StorageProvider, type BuildKeyOptions } from "../storage/providers/storage/s3-storage.provider";
import type { StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import { AssignmentsRepository } from "./assignments.repository";
import type { AssignmentRow, SubmissionRow, MilestoneRow } from "./assignments.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import type { AssignmentKind } from "@prisma/client";
import { NotificationsService } from "../notifications/notifications.service";
import { StudentsRepository } from "../students/students.repository";

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    private readonly repo: AssignmentsRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly notifSvc: NotificationsService,
    private readonly studentsRepository: StudentsRepository,
  ) {}

  // ─── SIGNED UPLOAD URL (storage endpoint) ────────────────────────────────

  /**
   * POST /api/v1/storage/upload-url
   * Mint a signed PUT URL for a student file upload.
   * Key is scoped to submissions/{tenantId}/{enrollmentId}/...
   * Server validates the student owns the enrollment.
   */
  async getUploadUrl(
    userId: string,
    tenantId: string,
    body: GetUploadUrlRequest,
  ): Promise<SignedUploadResponse> {
    // Validate enrollment ownership for submission purpose.
    if (body.purpose === "submission" || body.purpose === undefined) {
      if (!body.enrollmentId) {
        throw new UnprocessableEntityException({
          code: "ENROLLMENT_ID_REQUIRED",
          title: "enrollmentId is required for purpose=submission",
          detail: "Provide the enrollmentId of the enrollment you are submitting for.",
        });
      }

      const studentId = await this.repo.findStudentProfileId(tenantId, userId);
      if (!studentId) {
        throw new NotFoundException("Student profile not found.");
      }

      const enrollment = await this.repo.findEnrollmentById(tenantId, body.enrollmentId);
      if (!enrollment || enrollment.studentId !== studentId) {
        // IDOR → 404
        throw new NotFoundException("Enrollment not found.");
      }
    }

    // Build a scoped key to prevent path traversal.
    const { randomUUID } = await import("node:crypto");
    const buildKeyOpts: BuildKeyOptions =
      body.purpose === "resource"
        ? {
            namespace: "resources",
            tenantId,
            uniqueId: randomUUID(),
            filename: body.fileName,
          }
        : {
            namespace: "submissions",
            tenantId,
            uniqueId: randomUUID(),
            scopeId: body.enrollmentId,
            filename: body.fileName,
          };

    const key = S3StorageProvider.buildKey(buildKeyOpts);

    const result = await this.storage.getSignedUploadUrl({
      key,
      contentType: body.contentType,
      maxBytes: body.sizeBytes,
      ttlSeconds: 900, // 15 min max per AC-I1
    });

    return {
      storageKey: result.storageKey,
      uploadUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
      additionalHeaders: result.requiredHeaders,
      maxSizeBytes: body.sizeBytes,
    };
  }

  // ─── CRM: ASSIGNMENT AUTHORING ────────────────────────────────────────────

  /**
   * POST /api/v1/crm/assignments
   * Create an assignment (or project with milestones) on a lesson.
   * Faculty must have assigned-scope to the lesson's program.
   * Assignment-scope validated via programIds from faculty batch assignments.
   */
  async createAssignment(
    actorId: string,
    tenantId: string,
    body: CreateAssignmentRequest,
    scope: "all" | "assigned" | "branch" | null,
  ): Promise<AssignmentDetail> {
    // Validate faculty scope if assigned.
    if (scope === "assigned") {
      const facultyProfileId = await this.repo.findFacultyProfileId(tenantId, actorId);
      if (!facultyProfileId) {
        throw new ForbiddenException({
          code: "FACULTY_PROFILE_NOT_FOUND",
          title: "Permission denied",
          detail: "Faculty profile not found.",
        });
      }
      // Verify the lesson belongs to a program in the faculty's assigned batches.
      const programIds = await this.getAssignedProgramIds(tenantId, facultyProfileId);
      const allowed = await this.isLessonInPrograms(tenantId, body.lessonId, programIds);
      if (!allowed) {
        throw new ForbiddenException({
          code: "LESSON_NOT_IN_ASSIGNED_BATCH",
          title: "Permission denied",
          detail: "You can only create assignments for lessons in your assigned batches.",
        });
      }
    }

    const assignmentId = await this.repo.createAssignment({
      tenantId,
      lessonId: body.lessonId,
      kind: body.kind as AssignmentKind,
      title: body.title,
      instructions: body.instructions,
      maxScore: body.maxScore,
      dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
      allowResubmit: body.allowResubmit,
      isFinal: body.isFinal,
    });

    // Create milestones for project kind.
    if (body.kind === "project" && body.milestones && body.milestones.length > 0) {
      await this.repo.createMilestones(
        tenantId,
        assignmentId,
        body.milestones.map((m) => ({
          title: m.title,
          order: m.order,
          dueAt: m.dueAt ? new Date(m.dueAt) : undefined,
        })),
      );
    }

    const row = await this.repo.findAssignmentById(tenantId, assignmentId);
    if (!row) throw new NotFoundException("Assignment not found after creation.");

    this.logger.log(`[AssignmentsService] Assignment created: id=${assignmentId} tenant=${tenantId} actor=${actorId}`);

    return toAssignmentDetailDto(row);
  }

  /**
   * GET /api/v1/crm/assignments
   * List assignments for CRM (faculty assigned-scope or admin all-scope).
   */
  async listAssignments(
    tenantId: string,
    query: ListAssignmentsQuery,
    scope: "all" | "assigned" | "branch",
    actorId: string,
  ): Promise<PaginatedResult<AssignmentSummary>> {
    let programIds: string[] | undefined = undefined;

    if (scope === "assigned") {
      const facultyProfileId = await this.repo.findFacultyProfileId(tenantId, actorId);
      if (!facultyProfileId) {
        // No faculty profile → fail closed → return empty.
        return new PaginatedResult<AssignmentSummary>([], {
          page: query.page,
          pageSize: query.pageSize,
          total: 0,
          hasMore: false,
        });
      }
      programIds = await this.getAssignedProgramIds(tenantId, facultyProfileId);
    }

    const { rows, total } = await this.repo.listAssignments(tenantId, {
      programIds,
      lessonId: query.lessonId,
      kind: query.kind as AssignmentKind | undefined,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
    });

    return new PaginatedResult<AssignmentSummary>(rows.map(toAssignmentSummaryDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  /**
   * GET /api/v1/crm/assignments/:id
   * Full assignment detail (CRM). Scope-checked for faculty.
   */
  async getAssignment(
    tenantId: string,
    assignmentId: string,
    scope: "all" | "assigned" | "branch",
    actorId: string,
  ): Promise<AssignmentDetail> {
    const row = await this.repo.findAssignmentById(tenantId, assignmentId);
    if (!row) throw new NotFoundException("Assignment not found.");

    if (scope === "assigned") {
      await this.assertFacultyCanAccessAssignment(tenantId, actorId, row);
    }

    return toAssignmentDetailDto(row);
  }

  /**
   * PATCH /api/v1/crm/assignments/:id
   */
  async updateAssignment(
    tenantId: string,
    assignmentId: string,
    body: UpdateAssignmentRequest,
    scope: "all" | "assigned" | "branch",
    actorId: string,
  ): Promise<AssignmentDetail> {
    const existing = await this.repo.findAssignmentById(tenantId, assignmentId);
    if (!existing) throw new NotFoundException("Assignment not found.");

    if (scope === "assigned") {
      await this.assertFacultyCanAccessAssignment(tenantId, actorId, existing);
    }

    await this.repo.updateAssignment(tenantId, assignmentId, {
      title: body.title,
      instructions: body.instructions,
      maxScore: body.maxScore,
      dueAt: body.dueAt !== undefined ? (body.dueAt ? new Date(body.dueAt) : null) : undefined,
      allowResubmit: body.allowResubmit,
      isFinal: body.isFinal,
    });

    const updated = await this.repo.findAssignmentById(tenantId, assignmentId);
    if (!updated) throw new NotFoundException("Assignment not found after update.");

    return toAssignmentDetailDto(updated);
  }

  /**
   * DELETE /api/v1/crm/assignments/:id (soft-delete)
   */
  async softDeleteAssignment(
    tenantId: string,
    assignmentId: string,
    scope: "all" | "assigned" | "branch",
    actorId: string,
  ): Promise<AssignmentDetail> {
    const existing = await this.repo.findAssignmentById(tenantId, assignmentId);
    if (!existing) throw new NotFoundException("Assignment not found.");

    if (scope === "assigned") {
      await this.assertFacultyCanAccessAssignment(tenantId, actorId, existing);
    }

    await this.repo.softDeleteAssignment(tenantId, assignmentId);
    return toAssignmentDetailDto(existing);
  }

  // ─── CRM: SUBMISSION GRADING ──────────────────────────────────────────────

  /**
   * GET /api/v1/crm/assignments/:id/submissions
   * Faculty grading queue — only assigned-batch submissions.
   */
  async listSubmissions(
    tenantId: string,
    assignmentId: string,
    query: ListSubmissionsQuery,
    scope: "all" | "assigned" | "branch",
    actorId: string,
  ): Promise<PaginatedResult<SubmissionSummary>> {
    let allowedBatchIds: string[] | undefined = undefined;

    if (scope === "assigned") {
      const facultyProfileId = await this.repo.findFacultyProfileId(tenantId, actorId);
      if (!facultyProfileId) {
        return new PaginatedResult<SubmissionSummary>([], {
          page: query.page,
          pageSize: query.pageSize,
          total: 0,
          hasMore: false,
        });
      }
      allowedBatchIds = await this.repo.findAssignedBatchIds(tenantId, facultyProfileId);
    }

    const { rows, total } = await this.repo.listSubmissionsForAssignment(tenantId, assignmentId, {
      allowedBatchIds,
      status: query.status as SubmissionRow["status"] | undefined,
      search: query.search,
      // Reviewer-chosen cohort. Layered ON TOP of allowedBatchIds in the repository, never
      // instead of it — naming a batch outside your scope returns nothing, not more.
      batchId: query.batchId,
      page: query.page,
      pageSize: query.pageSize,
    });

    return new PaginatedResult<SubmissionSummary>(rows.map(toSubmissionSummaryDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  /**
   * GET /api/v1/crm/submissions/:id
   * Submission detail for faculty (with signed file download URLs).
   */
  async getSubmission(
    tenantId: string,
    submissionId: string,
    scope: "all" | "assigned" | "branch",
    actorId: string,
  ): Promise<SubmissionDetail> {
    const row = await this.repo.findSubmissionById(tenantId, submissionId);
    if (!row) throw new NotFoundException("Submission not found.");

    if (scope === "assigned") {
      await this.assertFacultyCanAccessSubmission(tenantId, actorId, row);
    }

    return this.toSubmissionDetailDto(row);
  }

  /**
   * PATCH /api/v1/crm/submissions/:id/grade
   *
   * Grade a submission. Writes audit log with before/after (AC-B1, AC-B3).
   * Faculty can only grade assigned-batch submissions (AC-B2).
   */
  /**
   * `POST /crm/submissions/:id/return` — send the work back for changes.
   *
   * The other half of review. `SubmissionStatus.returned` shipped in Phase 4 and nothing
   * ever wrote it, so a reviewer could only approve: work that needed another attempt had to
   * be graded low (final, no route back) or left pending forever.
   *
   * It is NOT a fail. No score is written; the student is told what to change and resubmits.
   * A genuine fail remains `gradeSubmission` with a low score.
   *
   * Three things have to be true for the loop to actually close, and each is handled here
   * rather than assumed:
   *   1. Only a PENDING (`submitted`) attempt can be returned — the repository re-checks it
   *      in the WHERE so two reviewers working the same queue cannot both return one attempt.
   *   2. The project must ALLOW resubmission, or the student is asked to fix something the
   *      submit endpoint will then refuse. If it does not, this turns it on.
   *   3. The student has to be told, with the reason — see notifySubmissionReturned.
   *
   * `dueAt` is deliberately NOT enforced here: the submit endpoint blocks resubmission past
   * the deadline, so returning late work is legitimate (the reviewer may be extending the
   * date next) but the reviewer needs to know. The CRM warns before confirming; the API
   * stays permissive rather than second-guessing a decision it has no context for.
   */
  async returnSubmission(
    actorId: string,
    tenantId: string,
    submissionId: string,
    body: ReturnSubmissionRequest,
    scope: "all" | "assigned" | "branch",
  ): Promise<SubmissionDetail> {
    const row = await this.repo.findSubmissionById(tenantId, submissionId);
    if (!row) throw new NotFoundException("Submission not found.");

    // Same authority boundary as grading — returning IS a review decision.
    if (scope === "assigned") {
      await this.assertFacultyCanAccessSubmission(tenantId, actorId, row);
    }

    if (row.status !== "submitted") {
      throw new UnprocessableEntityException({
        code: "SUBMISSION_NOT_PENDING",
        title: "This submission isn't awaiting review",
        detail:
          row.status === "returned"
            ? "It has already been sent back, the student hasn't resubmitted yet."
            : "It has already been graded. Re-grade it instead of sending it back.",
      });
    }

    const { updated } = await this.repo.returnSubmission(tenantId, submissionId, {
      reason: body.reason,
      returnedById: actorId,
    });
    if (updated === 0) {
      // Lost the race against another reviewer between the read and the write.
      throw new UnprocessableEntityException({
        code: "SUBMISSION_NOT_PENDING",
        title: "This submission isn't awaiting review",
        detail: "Someone else reviewed it a moment ago. Reload the queue.",
      });
    }

    // Without this the student is told to fix and resend something the submit endpoint
    // refuses with RESUBMIT_NOT_ALLOWED — a dead end neither side can escape.
    const assignment = await this.repo.findAssignmentById(tenantId, row.assignmentId);
    if (assignment && !assignment.allowResubmit) {
      await this.repo.enableResubmission(tenantId, row.assignmentId);
      this.logger.log(
        `[AssignmentsService] Resubmission enabled on assignment=${row.assignmentId} because a submission was returned.`,
      );
    }

    await this.repo.writeGradeAuditLog({
      tenantId,
      actorId,
      submissionId,
      before: { score: row.score, status: row.status },
      after: { score: null, status: "returned" },
    });

    this.logger.log(`[AssignmentsService] Submission returned: id=${submissionId} actor=${actorId}`);

    // Best-effort, past the commit point: the decision is durable, and a student who never
    // got the email can still see the state and the reason in the LMS.
    try {
      const student = await this.studentsRepository.findById(tenantId, row.studentId);
      if (student) {
        await this.notifSvc.notifySubmissionReturned(
          student.userId,
          tenantId,
          {
            assignmentId: row.assignmentId,
            assignmentTitle: row.assignmentTitle,
            reason: body.reason,
            studentName: student.name,
          },
          { toEmail: student.email, toPhone: student.phone ?? undefined },
        );
      }
    } catch (err) {
      this.logger.warn(`[AssignmentsService] notifySubmissionReturned failed (non-fatal): ${String(err)}`);
    }

    const updatedRow = await this.repo.findSubmissionById(tenantId, submissionId);
    if (!updatedRow) throw new NotFoundException("Submission not found.");
    return this.toSubmissionDetailDto(updatedRow);
  }

  async gradeSubmission(
    actorId: string,
    tenantId: string,
    submissionId: string,
    body: GradeSubmissionRequest,
    scope: "all" | "assigned" | "branch",
  ): Promise<SubmissionDetail> {
    const row = await this.repo.findSubmissionById(tenantId, submissionId);
    if (!row) throw new NotFoundException("Submission not found.");

    // Faculty assigned-scope check (AC-B2, plan §6 Risk #1).
    if (scope === "assigned") {
      await this.assertFacultyCanAccessSubmission(tenantId, actorId, row);
    }

    // Validate score ≤ maxScore.
    if (body.score > row.assignmentMaxScore) {
      throw new UnprocessableEntityException({
        code: "SCORE_EXCEEDS_MAX",
        title: "Score exceeds maximum",
        detail: `Score ${body.score} exceeds assignment max_score ${row.assignmentMaxScore}.`,
      });
    }

    // Perform grade update + capture before-state.
    const { beforeScore, beforeStatus } = await this.repo.gradeSubmission(tenantId, submissionId, {
      score: body.score,
      rubric: body.rubric as Record<string, unknown> | undefined,
      feedback: body.feedback,
      gradedById: actorId,
    });

    // Write audit log entry with before/after (AC-B1, AC-B3).
    await this.repo.writeGradeAuditLog({
      tenantId,
      actorId,
      submissionId,
      before: { score: beforeScore, status: beforeStatus },
      after: { score: body.score, status: "graded" },
    });

    this.logger.log(
      `[AssignmentsService] Submission graded: id=${submissionId} actor=${actorId} score=${body.score} (was ${beforeScore})`,
    );

    // Phase-9 Completion T31 / R3: wire the (previously orphaned) grade-ready notifier
    // at its real event site — the student is notified as soon as grading commits.
    // Best-effort: a notification failure must never fail the grading request itself
    // (the grade is already durably written above).
    try {
      const student = await this.studentsRepository.findById(tenantId, row.studentId);
      if (student) {
        await this.notifSvc.notifyGradeReady(
          student.userId,
          tenantId,
          {
            submissionId,
            assignmentTitle: row.assignmentTitle,
            score: body.score,
            studentName: student.name,
          },
          { toEmail: student.email, toPhone: student.phone ?? undefined },
        );
      }
    } catch (err) {
      this.logger.warn(`[AssignmentsService] notifyGradeReady failed (non-fatal): ${String(err)}`);
    }

    // Return updated row.
    const updated = await this.repo.findSubmissionById(tenantId, submissionId);
    if (!updated) throw new NotFoundException("Submission not found after grading.");

    return this.toSubmissionDetailDto(updated);
  }

  /**
   * GET /api/v1/crm/assignments/:id/project
   * Project detail with per-milestone review states (faculty view).
   */
  async getProjectCrm(
    tenantId: string,
    assignmentId: string,
    scope: "all" | "assigned" | "branch",
    actorId: string,
  ): Promise<ProjectDetail> {
    const assignment = await this.repo.findAssignmentById(tenantId, assignmentId);
    if (!assignment || assignment.kind !== "project") {
      throw new NotFoundException("Project assignment not found.");
    }

    if (scope === "assigned") {
      await this.assertFacultyCanAccessAssignment(tenantId, actorId, assignment);
    }

    let allowedBatchIds: string[] | undefined = undefined;
    if (scope === "assigned") {
      const facultyProfileId = await this.repo.findFacultyProfileId(tenantId, actorId);
      if (facultyProfileId) {
        allowedBatchIds = await this.repo.findAssignedBatchIds(tenantId, facultyProfileId);
      }
    }

    const milestoneSubmissions = await this.repo.getMilestoneSubmissionsForAssignment(
      tenantId,
      assignmentId,
      allowedBatchIds,
    );

    return buildProjectDetailFromAssignment(assignment, milestoneSubmissions);
  }

  // ─── LMS: STUDENT ASSIGNMENT VIEWS ───────────────────────────────────────

  /**
   * GET /api/v1/me/assignments
   * List assignments for the student's own enrollments.
   */
  async listMyAssignments(
    userId: string,
    tenantId: string,
    query: ListAssignmentsQuery,
  ): Promise<PaginatedResult<AssignmentListItem>> {
    const studentId = await this.repo.findStudentProfileId(tenantId, userId);
    if (!studentId) {
      return new PaginatedResult<AssignmentListItem>([], {
        page: query.page,
        pageSize: query.pageSize,
        total: 0,
        hasMore: false,
      });
    }

    const { rows, total } = await this.repo.listAssignmentsForStudent(tenantId, studentId, {
      kind: query.kind as AssignmentKind | undefined,
      page: query.page,
      pageSize: query.pageSize,
    });

    // For each assignment, get the student's latest submission for status derivation.
    const enrollments = await this.getStudentEnrollments(tenantId, studentId);
    const programToEnrollment = new Map(enrollments.map((e) => [e.programId, e.id]));

    const items = await Promise.all(
      rows.map(async (row) => {
        // Find enrollmentId for the program this assignment belongs to.
        const enrollmentId = await this.findEnrollmentIdForAssignment(tenantId, studentId, row.lessonId, programToEnrollment);
        const latestSub = enrollmentId
          ? await this.repo.findLatestSubmission(tenantId, row.id, enrollmentId)
          : null;

        return toAssignmentListItemDto(row, latestSub);
      }),
    );

    return new PaginatedResult<AssignmentListItem>(items, {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  /**
   * GET /api/v1/me/assignments/:id
   * Assignment detail + own submission snapshot.
   */
  async getMyAssignment(
    userId: string,
    tenantId: string,
    assignmentId: string,
  ): Promise<AssignmentStudentDetail> {
    const { studentId, enrollmentId } = await this.resolveStudentEnrollmentForAssignment(
      userId,
      tenantId,
      assignmentId,
    );

    const assignment = await this.repo.findAssignmentById(tenantId, assignmentId);
    if (!assignment) throw new NotFoundException("Assignment not found.");

    const latestSub = await this.repo.findLatestSubmission(tenantId, assignmentId, enrollmentId);

    // Suppress unused variable.
    void studentId;

    return toAssignmentStudentDetailDto(assignment, latestSub);
  }

  /**
   * POST /api/v1/me/assignments/:id/submit
   * Student submits an assignment.
   */
  async submitAssignment(
    userId: string,
    tenantId: string,
    assignmentId: string,
    body: SubmitAssignmentRequest,
  ): Promise<SubmissionDetail> {
    const { enrollmentId } = await this.resolveStudentEnrollmentForAssignment(
      userId,
      tenantId,
      assignmentId,
    );

    const assignment = await this.repo.findAssignmentById(tenantId, assignmentId);
    if (!assignment) throw new NotFoundException("Assignment not found.");

    return this.doSubmit(tenantId, enrollmentId, assignment, body, undefined);
  }

  /**
   * POST /api/v1/me/assignments/:id/milestones/:milestoneId/submit
   */
  async submitMilestone(
    userId: string,
    tenantId: string,
    assignmentId: string,
    milestoneId: string,
    body: SubmitAssignmentRequest,
  ): Promise<SubmissionDetail> {
    const { enrollmentId } = await this.resolveStudentEnrollmentForAssignment(
      userId,
      tenantId,
      assignmentId,
    );

    const assignment = await this.repo.findAssignmentById(tenantId, assignmentId);
    if (!assignment || assignment.kind !== "project") {
      throw new NotFoundException("Project assignment not found.");
    }

    // Verify milestone belongs to this assignment.
    const milestone = await this.repo.findMilestone(tenantId, assignmentId, milestoneId);
    if (!milestone) throw new NotFoundException("Milestone not found.");

    return this.doSubmit(tenantId, enrollmentId, assignment, body, milestoneId);
  }

  /**
   * GET /api/v1/me/assignments/:id/my-submission
   * Student's own submission with signed file download URLs.
   */
  async getMySubmission(
    userId: string,
    tenantId: string,
    assignmentId: string,
  ): Promise<SubmissionDetail> {
    const { enrollmentId } = await this.resolveStudentEnrollmentForAssignment(
      userId,
      tenantId,
      assignmentId,
    );

    const sub = await this.repo.findLatestSubmission(tenantId, assignmentId, enrollmentId);
    if (!sub) throw new NotFoundException("No submission found.");

    return this.toSubmissionDetailDto(sub);
  }

  /**
   * GET /api/v1/me/assignments/:id/project
   * Project milestone states for the student's own enrollment.
   */
  async getMyProject(
    userId: string,
    tenantId: string,
    assignmentId: string,
  ): Promise<ProjectDetail> {
    const { enrollmentId } = await this.resolveStudentEnrollmentForAssignment(
      userId,
      tenantId,
      assignmentId,
    );

    const assignment = await this.repo.findAssignmentById(tenantId, assignmentId);
    if (!assignment || assignment.kind !== "project") {
      throw new NotFoundException("Project assignment not found.");
    }

    const milestoneStates = await this.repo.getMilestoneSubmissions(tenantId, assignmentId, enrollmentId);

    return buildProjectDetailFromStudentMilestones(assignment, milestoneStates);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Core submit logic shared by assignment + milestone submit.
   * Enforces: due-date, resubmit policy, attempt_no.
   */
  private async doSubmit(
    tenantId: string,
    enrollmentId: string,
    assignment: AssignmentRow,
    body: SubmitAssignmentRequest,
    milestoneId: string | undefined,
  ): Promise<SubmissionDetail> {
    // Check due-date (AC-A2).
    if (assignment.dueAt && new Date() > assignment.dueAt) {
      throw new UnprocessableEntityException({
        code: "ASSIGNMENT_OVERDUE",
        title: "Assignment overdue",
        detail: `The due date was ${assignment.dueAt.toISOString()}.`,
      });
    }

    // Check existing submission (resubmit policy).
    const existing = await this.repo.findLatestSubmission(tenantId, assignment.id, enrollmentId, milestoneId);

    if (existing) {
      if (!assignment.allowResubmit) {
        // AC-A5, AC-A6: resubmit not allowed.
        throw new ConflictException({
          code: "RESUBMIT_NOT_ALLOWED",
          title: "Resubmission not allowed",
          detail: "This assignment does not allow resubmission.",
        });
      }
      // AC from edge case table: if previous is still pending (submitted, not graded/returned)
      if (existing.status === "submitted") {
        throw new ConflictException({
          code: "PREVIOUS_SUBMISSION_PENDING",
          title: "Previous submission still pending",
          detail: "Wait for your current submission to be graded before resubmitting.",
        });
      }
    }

    // H-1 (security): submission file keys are CLIENT-SUPPLIED. Validate every key is
    // scoped to THIS student's own submission prefix before persisting — otherwise a
    // student could submit a key pointing at another object (another enrollment's file,
    // another tenant, or a public `certificates/...` PDF) and later obtain a signed
    // download URL for it via getMySubmission (broken object-level authorization /
    // storage-key IDOR). The upload-URL endpoint scopes keys at mint time; this closes
    // the gap where submit trusted arbitrary keys.
    this.assertOwnedSubmissionKeys(body.files, tenantId, enrollmentId);

    // Compute attempt_no.
    const prevCount = await this.repo.countSubmissions(tenantId, assignment.id, enrollmentId, milestoneId);
    const attemptNo = prevCount + 1;

    const submissionId = await this.repo.createSubmission({
      tenantId,
      assignmentId: assignment.id,
      milestoneId,
      enrollmentId,
      files: body.files,
      text: body.text,
      link: body.link,
      attemptNo,
    });

    this.logger.log(
      `[AssignmentsService] Submission created: id=${submissionId} assignment=${assignment.id} enrollment=${enrollmentId} attempt=${attemptNo}`,
    );

    const sub = await this.repo.findSubmissionById(tenantId, submissionId);
    if (!sub) throw new NotFoundException("Submission not found after creation.");

    return this.toSubmissionDetailDto(sub);
  }

  /**
   * H-1 remediation: every client-supplied submission file key MUST be scoped to this
   * student's own submission prefix `submissions/{tenant}/{enrollment}/`. Rejects any
   * key pointing at another object (other enrollments, other tenants, or non-submission
   * prefixes such as `certificates/...`) — which would otherwise yield a signed download
   * URL to an object the student does not own (storage-key IDOR / broken object-level
   * authorization). Also rejects traversal/null-byte sequences defensively.
   */
  private assertOwnedSubmissionKeys(
    files: string[] | undefined,
    tenantId: string,
    enrollmentId: string,
  ): void {
    if (!files || files.length === 0) return;
    const requiredPrefix = `submissions/${tenantId}/${enrollmentId}/`;
    for (const key of files) {
      if (
        typeof key !== "string" ||
        !key.startsWith(requiredPrefix) ||
        key.includes("..") ||
        key.includes("\0")
      ) {
        throw new UnprocessableEntityException({
          code: "INVALID_STORAGE_KEY",
          title: "Invalid file reference",
          detail:
            "A submitted file key is not scoped to your submission. Upload files via the " +
            "provided upload URL and submit only the storage keys it returns.",
        });
      }
    }
  }

  /**
   * Resolve and verify that a student has an active enrollment for the program
   * containing the given assignment. IDOR guard.
   */
  private async resolveStudentEnrollmentForAssignment(
    userId: string,
    tenantId: string,
    assignmentId: string,
  ): Promise<{ studentId: string; enrollmentId: string }> {
    const studentId = await this.repo.findStudentProfileId(tenantId, userId);
    if (!studentId) throw new NotFoundException("Assignment not found.");

    // Get all active enrollments for the student.
    const enrollments = await this.getStudentEnrollments(tenantId, studentId);
    if (enrollments.length === 0) throw new NotFoundException("Assignment not found.");

    // Check assignment belongs to one of the student's enrolled programs.
    for (const enrollment of enrollments) {
      const row = await this.repo.findAssignmentForEnrollment(tenantId, assignmentId, enrollment.programId);
      if (row) {
        return { studentId, enrollmentId: enrollment.id };
      }
    }

    // No matching enrollment — IDOR → 404.
    throw new NotFoundException("Assignment not found.");
  }

  /**
   * Assert that the faculty member can access an assignment (assigned-scope guard).
   * Returns without error if allowed; throws NotFoundException (IDOR → 404) if not.
   */
  private async assertFacultyCanAccessAssignment(
    tenantId: string,
    actorId: string,
    assignment: AssignmentRow,
  ): Promise<void> {
    const facultyProfileId = await this.repo.findFacultyProfileId(tenantId, actorId);
    if (!facultyProfileId) throw new NotFoundException("Assignment not found.");

    const programIds = await this.getAssignedProgramIds(tenantId, facultyProfileId);
    // Find the assignment's program via its lesson→module→program chain.
    const row = await this.repo.findAssignmentById(tenantId, assignment.id);
    if (!row) throw new NotFoundException("Assignment not found.");

    // Check if lesson is in an assigned program.
    const allowed = await this.isLessonInPrograms(tenantId, row.lessonId, programIds);
    if (!allowed) throw new NotFoundException("Assignment not found.");
  }

  /**
   * Assert that the faculty member can access a submission (assigned-scope guard).
   * Returns without error if allowed; throws NotFoundException if not.
   * Resolution: submission → enrollment → batch → batch.faculty_id (plan §6 Risk #1).
   */
  private async assertFacultyCanAccessSubmission(
    tenantId: string,
    actorId: string,
    submission: SubmissionRow,
  ): Promise<void> {
    const facultyProfileId = await this.repo.findFacultyProfileId(tenantId, actorId);
    if (!facultyProfileId) throw new NotFoundException("Submission not found.");

    const allowedBatchIds = await this.repo.findAssignedBatchIds(tenantId, facultyProfileId);
    if (!allowedBatchIds.includes(submission.batchId)) {
      // IDOR → 404 for unassigned batch (not 403, per IDOR rule).
      throw new NotFoundException("Submission not found.");
    }
  }

  /**
   * Get assigned program ids for a faculty member.
   * Derived from batch.program_id where batch.faculty_id = facultyProfileId.
   */
  private async getAssignedProgramIds(tenantId: string, facultyProfileId: string): Promise<string[]> {
    const batchIds = await this.repo.findAssignedBatchIds(tenantId, facultyProfileId);
    if (batchIds.length === 0) return [];
    // Resolve batches → programIds (Phase-7 Wave 2 security hardening batch B, item 3:
    // routed through the repository's own method — no private-client reach-through).
    return this.repo.findProgramIdsForBatches(tenantId, batchIds);
  }

  /**
   * Check whether a lesson belongs to one of the given programs.
   */
  private async isLessonInPrograms(
    tenantId: string,
    lessonId: string,
    programIds: string[],
  ): Promise<boolean> {
    return this.repo.isLessonInPrograms(tenantId, lessonId, programIds);
  }

  /**
   * Get all active enrollments for a student (programId, id, batchId).
   */
  private async getStudentEnrollments(
    tenantId: string,
    studentId: string,
  ): Promise<Array<{ id: string; programId: string; batchId: string }>> {
    return this.repo.findActiveEnrollmentsForStudent(tenantId, studentId);
  }

  /**
   * Find the enrollment id for the student that covers the program containing the lesson.
   */
  private async findEnrollmentIdForAssignment(
    tenantId: string,
    studentId: string,
    lessonId: string,
    programToEnrollment: Map<string, string>,
  ): Promise<string | null> {
    // Resolve lesson → program.
    const programId = await this.repo.findLessonProgramId(lessonId);
    if (!programId) return null;
    return programToEnrollment.get(programId) ?? null;
  }

  /**
   * Mint signed download URLs for a list of storage keys.
   * Returns an array of { key, url, expiresAt }.
   */
  private async mintFileDownloadUrls(
    keys: string[],
  ): Promise<Array<{ key: string; url: string; expiresAt: string }>> {
    return Promise.all(
      keys.map(async (key) => {
        const result = await this.storage.getSignedDownloadUrl({ key });
        return { key, url: result.url, expiresAt: result.expiresAt.toISOString() };
      }),
    );
  }

  /**
   * Convert a SubmissionRow to the SubmissionDetail DTO, minting signed download URLs.
   */
  private async toSubmissionDetailDto(row: SubmissionRow): Promise<SubmissionDetail> {
    const files = Array.isArray(row.files) ? (row.files as string[]) : [];
    const fileDownloadUrls = await this.mintFileDownloadUrls(files);

    const assignment = await this.repo.findAssignmentById(row.tenantId, row.assignmentId);

    return {
      id: row.id,
      assignmentId: row.assignmentId,
      milestoneId: row.milestoneId,
      enrollmentId: row.enrollmentId,
      status: row.status,
      attemptNo: row.attemptNo,
      fileDownloadUrls,
      text: row.text,
      link: row.link,
      submittedAt: row.createdAt.toISOString(),
      score: row.score,
      maxScore: row.assignmentMaxScore,
      rubric: row.rubric as Record<string, unknown> | null,
      feedback: row.feedback,
      gradedAt: row.gradedAt ? row.gradedAt.toISOString() : null,
      gradedByName: row.gradedByName,
    };
  }
}

// ─── DTO mapping helpers ──────────────────────────────────────────────────────

function toAssignmentDetailDto(row: AssignmentRow): AssignmentDetail {
  return {
    id: row.id,
    lessonId: row.lessonId,
    lessonTitle: row.lessonTitle,
    programId: row.programId,
    programTitle: row.programTitle,
    kind: row.kind,
    title: row.title,
    instructions: row.instructions,
    maxScore: row.maxScore,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    allowResubmit: row.allowResubmit,
    isFinal: row.isFinal,
    milestones: row.milestones.map(toMilestoneDto),
    submissionCount: row.submissionCount,
    gradedCount: row.gradedCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAssignmentSummaryDto(row: AssignmentRow): AssignmentSummary {
  return {
    id: row.id,
    lessonId: row.lessonId,
    lessonTitle: row.lessonTitle,
    kind: row.kind,
    title: row.title,
    maxScore: row.maxScore,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    allowResubmit: row.allowResubmit,
    isFinal: row.isFinal,
    milestoneCount: row.milestones.length,
    submissionCount: row.submissionCount,
    gradedCount: row.gradedCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMilestoneDto(m: MilestoneRow) {
  return {
    id: m.id,
    title: m.title,
    order: m.order,
    dueAt: m.dueAt ? m.dueAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
  };
}

function toSubmissionSummaryDto(row: SubmissionRow): SubmissionSummary {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    assignmentTitle: row.assignmentTitle,
    milestoneId: row.milestoneId,
    milestoneTitle: row.milestoneTitle,
    enrollmentId: row.enrollmentId,
    studentId: row.studentId,
    studentName: row.studentName,
    batchId: row.batchId,
    batchName: row.batchName,
    status: row.status,
    attemptNo: row.attemptNo,
    score: row.score,
    maxScore: row.assignmentMaxScore,
    submittedAt: row.createdAt.toISOString(),
    gradedAt: row.gradedAt ? row.gradedAt.toISOString() : null,
  };
}

/**
 * What the STUDENT is shown for an assignment.
 *
 * `returned` is surfaced rather than collapsed into `submitted`, which is what this function
 * used to do: a reviewer sent work back, and the student's screen still said "Submitted", so
 * they waited for a verdict that had already arrived and never saw the resubmit form. It is
 * the one post-submission state that asks the student to act, so it has to be visible.
 *
 * Overdue is still only for work never handed in — a student who submitted on time and was
 * asked for changes has not missed a deadline, and telling them they have would be both
 * wrong and demoralising.
 */
function deriveAssignmentStatus(
  assignment: AssignmentRow,
  submission: SubmissionRow | null,
): "assigned" | "submitted" | "returned" | "graded" | "overdue" {
  if (submission) {
    if (submission.status === "graded") return "graded";
    if (submission.status === "returned") return "returned";
    return "submitted";
  }
  if (assignment.dueAt && new Date() > assignment.dueAt) return "overdue";
  return "assigned";
}

function toAssignmentListItemDto(
  row: AssignmentRow,
  submission: SubmissionRow | null,
): AssignmentListItem {
  const status = deriveAssignmentStatus(row, submission);
  return {
    id: row.id,
    lessonId: row.lessonId,
    lessonTitle: row.lessonTitle,
    kind: row.kind,
    title: row.title,
    maxScore: row.maxScore,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    allowResubmit: row.allowResubmit,
    isFinal: row.isFinal,
    milestoneCount: row.milestones.length,
    status,
    submittedAt: submission ? submission.createdAt.toISOString() : null,
    score: submission?.score ?? null,
    maxScoreDisplay: row.maxScore,
  };
}

function toAssignmentStudentDetailDto(
  row: AssignmentRow,
  submission: SubmissionRow | null,
): AssignmentStudentDetail {
  const status = deriveAssignmentStatus(row, submission);
  return {
    id: row.id,
    lessonId: row.lessonId,
    lessonTitle: row.lessonTitle,
    kind: row.kind,
    title: row.title,
    instructions: row.instructions,
    maxScore: row.maxScore,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    allowResubmit: row.allowResubmit,
    isFinal: row.isFinal,
    milestones: row.milestones.map(toMilestoneDto),
    status,
    mySubmission: submission
      ? {
          id: submission.id,
          status: submission.status,
          attemptNo: submission.attemptNo,
          submittedAt: submission.createdAt.toISOString(),
          score: submission.score,
          feedback: submission.feedback,
          milestoneId: submission.milestoneId,
        }
      : null,
  };
}

function buildProjectDetailFromStudentMilestones(
  assignment: AssignmentRow,
  milestoneStates: Array<{
    milestoneId: string;
    submissionId: string | null;
    status: SubmissionRow["status"] | null;
    score: number | null;
    feedback: string | null;
    submittedAt: Date | null;
    gradedAt: Date | null;
  }>,
): ProjectDetail {
  const milestoneMap = new Map(assignment.milestones.map((m) => [m.id, m]));

  const states: MilestoneReviewState[] = milestoneStates.map((ms) => {
    const m = milestoneMap.get(ms.milestoneId);
    return {
      milestone: m ? toMilestoneDto(m) : { id: ms.milestoneId, title: "", order: 0, dueAt: null, createdAt: new Date().toISOString() },
      submissionId: ms.submissionId,
      submissionStatus: ms.status,
      score: ms.score,
      feedback: ms.feedback,
      submittedAt: ms.submittedAt ? ms.submittedAt.toISOString() : null,
      gradedAt: ms.gradedAt ? ms.gradedAt.toISOString() : null,
    };
  });

  const overallStatus = deriveProjectStatus(states);

  return {
    assignment: toAssignmentDetailDto(assignment),
    milestoneStates: states,
    overallStatus,
  };
}

function buildProjectDetailFromAssignment(
  assignment: AssignmentRow,
  milestoneSubmissions: Array<{
    milestoneId: string;
    enrollmentId: string;
    submissionId: string | null;
    status: SubmissionRow["status"] | null;
    score: number | null;
    feedback: string | null;
    submittedAt: Date | null;
    gradedAt: Date | null;
  }>,
): ProjectDetail {
  const milestoneMap = new Map(assignment.milestones.map((m) => [m.id, m]));

  // Group by milestone — take most-recent submission per milestone.
  const latestByMilestone = new Map<string, (typeof milestoneSubmissions)[0]>();
  for (const ms of milestoneSubmissions) {
    const existing = latestByMilestone.get(ms.milestoneId);
    if (!existing || (ms.submittedAt && existing.submittedAt && ms.submittedAt > existing.submittedAt)) {
      latestByMilestone.set(ms.milestoneId, ms);
    }
  }

  const states: MilestoneReviewState[] = assignment.milestones.map((m) => {
    const ms = latestByMilestone.get(m.id);
    return {
      milestone: toMilestoneDto(m),
      submissionId: ms?.submissionId ?? null,
      submissionStatus: ms?.status ?? null,
      score: ms?.score ?? null,
      feedback: ms?.feedback ?? null,
      submittedAt: ms?.submittedAt ? ms.submittedAt.toISOString() : null,
      gradedAt: ms?.gradedAt ? ms.gradedAt.toISOString() : null,
    };
  });

  // Suppress unused variable.
  void milestoneMap;

  const overallStatus = deriveProjectStatus(states);

  return {
    assignment: toAssignmentDetailDto(assignment),
    milestoneStates: states,
    overallStatus,
  };
}

function deriveProjectStatus(
  states: MilestoneReviewState[],
): "not_started" | "in_progress" | "under_review" | "graded" {
  if (states.length === 0) return "not_started";
  const allGraded = states.every((s) => s.submissionStatus === "graded");
  if (allGraded) return "graded";
  const allSubmitted = states.every((s) => s.submissionStatus !== null);
  if (allSubmitted) return "under_review";
  const anySubmitted = states.some((s) => s.submissionStatus !== null);
  if (anySubmitted) return "in_progress";
  return "not_started";
}

/**
 * Sanitize a filename for use in a storage key (prevent path traversal).
 * Strips directory separators and replaces unsafe chars with underscores.
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[/\\]/g, "_") // no directory separators
    .replace(/\.{2,}/g, "_") // no ..
    .replace(/[^a-zA-Z0-9._-]/g, "_") // only safe chars
    .slice(0, 200);
}
