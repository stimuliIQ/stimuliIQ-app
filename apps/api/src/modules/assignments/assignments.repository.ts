// apps/api/src/modules/assignments/assignments.repository.ts
//
// Prisma data-access layer for the Assignments + Submissions + Projects module.
// (CLAUDE.md §3.3: "repository — Prisma data access only, applies soft-delete
// + data-scope filters (all|branch|assigned|own). No business logic.")
//
// KEY DESIGN DECISIONS:
//
// 1. Faculty assigned-scope (plan §6 Risk #1 — resolves ADR-0009 deferral):
//    A faculty member may grade/view ONLY submissions whose enrollment's batch
//    has batch.faculty_id = currentUser.id (resolved as faculty profile id via
//    the faculty_profiles table).
//    Resolution path: submission → enrollment → batch → batch.faculty_id.
//    All faculty-scope queries include a WHERE clause via the
//    `requireFacultyBatchScope` helper.
//
// 2. IDOR → 404 (ADR-0022): every query is tenant-scoped from the caller's
//    tenantId (JWT). Cross-student access returns null (service returns 404).
//    Cross-faculty (unassigned batch) returns null (service returns 404 for
//    the "assigned" scope).
//
// 3. Soft-delete: PrismaService.client has softDeleteExtension applied —
//    deleted_at IS NULL filter is automatic. Only `deletedAt: null` explicit
//    filters are added where nested relations need explicit exclusion.
//
// 4. No business logic here — resubmit policy, eligibility, audit writes, and
//    signed URL minting are all in the service layer.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@prisma/client";
import type { AssignmentKind, SubmissionStatus } from "@prisma/client";

// ─── Row types for service layer ─────────────────────────────────────────────

export interface AssignmentRow {
  id: string;
  tenantId: string;
  lessonId: string;
  lessonTitle: string;
  /** The owning course. Populated by findAssignmentById only; empty on list rows. */
  programId: string;
  programTitle: string;
  kind: AssignmentKind;
  title: string;
  instructions: string | null;
  maxScore: number;
  dueAt: Date | null;
  allowResubmit: boolean;
  isFinal: boolean;
  createdAt: Date;
  updatedAt: Date;
  milestones: MilestoneRow[];
  submissionCount: number;
  gradedCount: number;
}

export interface MilestoneRow {
  id: string;
  assignmentId: string;
  title: string;
  order: number;
  dueAt: Date | null;
  createdAt: Date;
}

export interface SubmissionRow {
  id: string;
  tenantId: string;
  assignmentId: string;
  assignmentTitle: string;
  assignmentMaxScore: number;
  milestoneId: string | null;
  milestoneTitle: string | null;
  enrollmentId: string;
  studentId: string;
  studentName: string;
  files: unknown; // JSON array of storage keys
  text: string | null;
  link: string | null;
  attemptNo: number;
  status: SubmissionStatus;
  score: number | null;
  rubric: unknown | null;
  feedback: string | null;
  gradedById: string | null;
  gradedByName: string | null;
  gradedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // for assigned-scope checks — batchName is additionally surfaced to reviewers.
  batchId: string;
  batchName: string;
  batchFacultyId: string | null;
}

export interface FacultyProfileRow {
  id: string;
  userId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class AssignmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Faculty profile resolution ──────────────────────────────────────────

  /**
   * Resolve the faculty profile id for a given user id + tenant.
   * Used to translate req.user.id → facultyProfiles.id for assigned-scope queries.
   * Returns null if the user has no faculty profile in this tenant.
   */
  async findFacultyProfileId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.facultyProfile.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Resolve batch ids assigned to the faculty profile.
   * A faculty member may grade only submissions in THESE batches.
   * Returns an empty array when the faculty has no assigned batches.
   */
  async findAssignedBatchIds(tenantId: string, facultyProfileId: string): Promise<string[]> {
    const rows = await this.prisma.client.batch.findMany({
      where: { tenantId, facultyId: facultyProfileId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Resolve the distinct set of program ids for a list of batch ids (used to derive a
   * faculty member's assigned PROGRAMS from their assigned BATCHES — Phase-7 Wave 2
   * security hardening batch B, item 3: replaces a prior `this.repo["prisma"]`
   * private-client reach-through in AssignmentsService, the same anti-pattern batch A
   * fixed in campaigns.service.ts).
   */
  async findProgramIdsForBatches(tenantId: string, batchIds: string[]): Promise<string[]> {
    if (batchIds.length === 0) return [];
    const rows = await this.prisma.client.batch.findMany({
      where: { id: { in: batchIds }, tenantId },
      select: { programId: true },
      distinct: ["programId"],
    });
    return rows.map((r) => r.programId);
  }

  /**
   * Whether the given lesson belongs to one of the given (tenant-scoped) programs.
   */
  async isLessonInPrograms(tenantId: string, lessonId: string, programIds: string[]): Promise<boolean> {
    if (programIds.length === 0) return false;
    const lesson = await this.prisma.client.lesson.findFirst({
      where: {
        id: lessonId,
        module: { programId: { in: programIds }, program: { tenantId } },
      },
      select: { id: true },
    });
    return lesson !== null;
  }

  /**
   * All active enrollments for a student (id, programId, batchId) — used to map a
   * student's enrollments to the program containing a given assignment/lesson.
   */
  async findActiveEnrollmentsForStudent(
    tenantId: string,
    studentId: string,
  ): Promise<Array<{ id: string; programId: string; batchId: string }>> {
    return this.prisma.client.enrollment.findMany({
      where: { tenantId, studentId, status: "active" },
      select: { id: true, programId: true, batchId: true },
    });
  }

  /** Resolves a lesson's parent program id (via its module), or null if not found. */
  async findLessonProgramId(lessonId: string): Promise<string | null> {
    const lesson = await this.prisma.client.lesson.findFirst({
      where: { id: lessonId },
      select: { module: { select: { programId: true } } },
    });
    return lesson?.module.programId ?? null;
  }

  // ─── Student profile resolution ──────────────────────────────────────────

  /**
   * Resolve the student profile id for a given user id + tenant.
   */
  async findStudentProfileId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.studentProfile.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Find the student's active enrollment for a given program.
   * Used to validate that the student is enrolled before allowing submission.
   */
  async findActiveEnrollment(
    tenantId: string,
    studentId: string,
    programId: string,
  ): Promise<{ id: string; batchId: string } | null> {
    const row = await this.prisma.client.enrollment.findFirst({
      where: { tenantId, studentId, programId, status: "active" },
      select: { id: true, batchId: true },
    });
    return row ?? null;
  }

  /**
   * Find any active enrollment for the student in enrollments filtered by id.
   * Used for own-scope IDOR checks.
   */
  async findEnrollmentById(
    tenantId: string,
    enrollmentId: string,
  ): Promise<{ id: string; studentId: string; batchId: string; programId: string } | null> {
    const row = await this.prisma.client.enrollment.findFirst({
      where: { tenantId, id: enrollmentId },
      select: { id: true, studentId: true, batchId: true, programId: true },
    });
    return row ?? null;
  }

  // ─── Assignment CRUD (CRM / faculty) ─────────────────────────────────────

  /**
   * Create an assignment. Tenant-scoped insert.
   */
  async createAssignment(data: {
    tenantId: string;
    lessonId: string;
    kind: AssignmentKind;
    title: string;
    instructions?: string;
    maxScore: number;
    dueAt?: Date;
    allowResubmit: boolean;
    isFinal: boolean;
  }): Promise<string> {
    const row = await this.prisma.client.assignment.create({
      data: {
        tenantId: data.tenantId,
        lessonId: data.lessonId,
        kind: data.kind,
        title: data.title,
        instructions: data.instructions ?? null,
        maxScore: data.maxScore,
        dueAt: data.dueAt ?? null,
        allowResubmit: data.allowResubmit,
        isFinal: data.isFinal,
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * Create milestones for a project assignment.
   */
  async createMilestones(
    tenantId: string,
    assignmentId: string,
    milestones: Array<{ title: string; order: number; dueAt?: Date }>,
  ): Promise<void> {
    if (milestones.length === 0) return;
    await this.prisma.client.assignmentMilestone.createMany({
      data: milestones.map((m) => ({
        tenantId,
        assignmentId,
        title: m.title,
        order: m.order,
        dueAt: m.dueAt ?? null,
      })),
    });
  }

  /**
   * Find a single assignment with full detail.
   * Tenant-scoped. Returns null if not found (IDOR → 404).
   */
  async findAssignmentById(tenantId: string, id: string): Promise<AssignmentRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
    const row: any = await this.prisma.client.assignment.findFirst({
      where: { id, tenantId },
      include: {
        // The owning COURSE, for the CRM's review panel: it scopes the batch picker and is
        // how staff actually refer to a project ("the Neurology case study"). Joined only on
        // the single-assignment read — the list query has no use for it.
        lesson: { select: { title: true, module: { select: { programId: true, program: { select: { title: true } } } } } },
        milestones: {
          where: { deletedAt: null },
          orderBy: { order: "asc" },
          select: { id: true, assignmentId: true, title: true, order: true, dueAt: true, createdAt: true },
        },
        _count: {
          select: {
            submissions: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!row) return null;

    const gradedCount = await this.prisma.client.submission.count({
      where: { assignmentId: id, tenantId, status: "graded", deletedAt: null },
    });

    return toAssignmentRow(row, gradedCount);
  }

  /**
   * Find an assignment scoped to a lesson's program for a given enrollment.
   * Used by the student submit flow to verify the assignment belongs to the
   * student's enrolled program (IDOR guard).
   *
   * Resolution: assignment → lesson → module → program.
   */
  async findAssignmentForEnrollment(
    tenantId: string,
    assignmentId: string,
    enrollmentProgramId: string,
  ): Promise<AssignmentRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
    const row: any = await this.prisma.client.assignment.findFirst({
      where: {
        id: assignmentId,
        tenantId,
        lesson: {
          module: {
            programId: enrollmentProgramId,
          },
        },
      },
      include: {
        lesson: { select: { title: true } },
        milestones: {
          where: { deletedAt: null },
          orderBy: { order: "asc" },
          select: { id: true, assignmentId: true, title: true, order: true, dueAt: true, createdAt: true },
        },
        _count: {
          select: {
            submissions: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!row) return null;

    const gradedCount = await this.prisma.client.submission.count({
      where: { assignmentId, tenantId, status: "graded", deletedAt: null },
    });

    return toAssignmentRow(row, gradedCount);
  }

  /**
   * List assignments, scoped by tenant + (optional) assigned batch ids.
   *
   * For faculty (assigned scope): filters to lessons in programs that have
   * batches with the faculty's id, using programIds derived from batch assignments.
   *
   * For admin/ops (all scope): no additional batch filter.
   */
  async listAssignments(
    tenantId: string,
    filters: {
      programIds?: string[]; // assigned-scope: only these programs
      lessonId?: string;
      kind?: AssignmentKind;
      search?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{ rows: AssignmentRow[]; total: number }> {
    const where: Prisma.AssignmentWhereInput = {
      tenantId,
      ...(filters.lessonId ? { lessonId: filters.lessonId } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" } } : {}),
      ...(filters.programIds !== undefined
        ? { lesson: { module: { programId: { in: filters.programIds } } } }
        : {}),
    };

    const [rawRows, total] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
      this.prisma.client.assignment.findMany({
        where,
        include: {
          lesson: { select: { title: true } },
          milestones: {
            where: { deletedAt: null },
            orderBy: { order: "asc" },
            select: { id: true, assignmentId: true, title: true, order: true, dueAt: true, createdAt: true },
          },
          _count: {
            select: {
              submissions: { where: { deletedAt: null } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }) as Promise<any[]>,
      this.prisma.client.assignment.count({ where }),
    ]);

    const rows: AssignmentRow[] = await Promise.all(
      rawRows.map(async (row) => {
        const gradedCount = await this.prisma.client.submission.count({
          where: { assignmentId: row.id, tenantId, status: "graded", deletedAt: null },
        });
        return toAssignmentRow(row, gradedCount);
      }),
    );

    return { rows, total };
  }

  /**
   * Update an assignment (partial update). Returns the updated row.
   */
  async updateAssignment(
    tenantId: string,
    id: string,
    data: {
      title?: string;
      instructions?: string;
      maxScore?: number;
      dueAt?: Date | null;
      allowResubmit?: boolean;
      isFinal?: boolean;
    },
  ): Promise<void> {
    await this.prisma.client.assignment.updateMany({
      where: { id, tenantId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.instructions !== undefined ? { instructions: data.instructions } : {}),
        ...(data.maxScore !== undefined ? { maxScore: data.maxScore } : {}),
        ...(data.dueAt !== undefined ? { dueAt: data.dueAt } : {}),
        ...(data.allowResubmit !== undefined ? { allowResubmit: data.allowResubmit } : {}),
        ...(data.isFinal !== undefined ? { isFinal: data.isFinal } : {}),
      },
    });
  }

  /**
   * Soft-delete an assignment (sets deletedAt).
   * The softDeleteExtension handles the actual column update.
   */
  async softDeleteAssignment(tenantId: string, id: string): Promise<void> {
    await this.prisma.client.assignment.deleteMany({
      where: { id, tenantId },
    });
  }

  // ─── Milestone queries ────────────────────────────────────────────────────

  /**
   * Find a specific milestone by id within an assignment, tenant-scoped.
   */
  async findMilestone(
    tenantId: string,
    assignmentId: string,
    milestoneId: string,
  ): Promise<MilestoneRow | null> {
    const row = await this.prisma.client.assignmentMilestone.findFirst({
      where: { id: milestoneId, assignmentId, tenantId },
      select: { id: true, assignmentId: true, title: true, order: true, dueAt: true, createdAt: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      assignmentId: row.assignmentId,
      title: row.title,
      order: row.order,
      dueAt: row.dueAt,
      createdAt: row.createdAt,
    };
  }

  // ─── Submission queries ───────────────────────────────────────────────────

  /**
   * Find the most recent active submission for (assignment, enrollment).
   * Used by the resubmit policy check and own-submission view.
   */
  async findLatestSubmission(
    tenantId: string,
    assignmentId: string,
    enrollmentId: string,
    milestoneId?: string,
  ): Promise<SubmissionRow | null> {
    const where: Prisma.SubmissionWhereInput = {
      tenantId,
      assignmentId,
      enrollmentId,
      ...(milestoneId !== undefined ? { milestoneId } : { milestoneId: null }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
    const row: any = await this.prisma.client.submission.findFirst({
      where,
      orderBy: { attemptNo: "desc" },
      include: {
        assignment: { select: { title: true, maxScore: true } },
        milestone: { select: { title: true } },
        enrollment: { select: { student: { select: { user: { select: { name: true } }, id: true } }, batchId: true, batch: { select: { facultyId: true } } } },
        gradedBy: { select: { name: true } },
      },
    });

    if (!row) return null;
    return toSubmissionRow(row);
  }

  /**
   * Count active submissions for (assignment, enrollment) — used to compute attempt_no.
   */
  async countSubmissions(
    tenantId: string,
    assignmentId: string,
    enrollmentId: string,
    milestoneId?: string,
  ): Promise<number> {
    return this.prisma.client.submission.count({
      where: {
        tenantId,
        assignmentId,
        enrollmentId,
        ...(milestoneId !== undefined ? { milestoneId } : { milestoneId: null }),
        deletedAt: null,
      },
    });
  }

  /**
   * Create a new submission row.
   */
  async createSubmission(data: {
    tenantId: string;
    assignmentId: string;
    milestoneId?: string;
    enrollmentId: string;
    files: string[]; // storage keys
    text?: string;
    link?: string;
    attemptNo: number;
  }): Promise<string> {
    const row = await this.prisma.client.submission.create({
      data: {
        tenantId: data.tenantId,
        assignmentId: data.assignmentId,
        milestoneId: data.milestoneId ?? null,
        enrollmentId: data.enrollmentId,
        files: data.files,
        text: data.text ?? null,
        link: data.link ?? null,
        attemptNo: data.attemptNo,
        status: "submitted",
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * Find a submission by id.
   * Returns null if not found (IDOR → 404).
   */
  async findSubmissionById(tenantId: string, submissionId: string): Promise<SubmissionRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
    const row: any = await this.prisma.client.submission.findFirst({
      where: { id: submissionId, tenantId },
      include: {
        assignment: { select: { title: true, maxScore: true } },
        milestone: { select: { title: true } },
        enrollment: {
          select: {
            student: { select: { user: { select: { name: true } }, id: true } },
            batchId: true,
            batch: { select: { facultyId: true } },
          },
        },
        gradedBy: { select: { name: true } },
      },
    });
    if (!row) return null;
    return toSubmissionRow(row);
  }

  /**
   * List submissions for an assignment.
   *
   * Faculty assigned-scope: filters to enrollments in assigned batches only.
   * Admin all-scope: no batch filter.
   */
  async listSubmissionsForAssignment(
    tenantId: string,
    assignmentId: string,
    filters: {
      allowedBatchIds?: string[]; // assigned-scope: only these batches
      status?: SubmissionStatus;
      search?: string; // student name
      batchId?: string; // reviewer narrowed the queue to one cohort
      page: number;
      pageSize: number;
    },
  ): Promise<{ rows: SubmissionRow[]; total: number }> {
    // SCOPE FIX: every one of these three conditions lives under `enrollment`, and they used
    // to be spread as separate `{ enrollment: ... }` keys — so the LAST one silently
    // replaced the earlier ones. A faculty member typing in the search box lost their
    // `allowedBatchIds` restriction and saw submissions from batches they do not teach
    // (CLAUDE.md §3.5 — the server, not the UI, is the boundary). Building ONE enrollment
    // filter makes the conditions additive, which is what they were always meant to be.
    const enrollmentFilter: Prisma.EnrollmentWhereInput = {
      // Reviewer-chosen batch AND scope-allowed batches must both hold; `AND` rather than a
      // merged `batchId` so a request naming a batch outside the caller's scope returns
      // nothing instead of widening it.
      ...(filters.allowedBatchIds !== undefined ? { batchId: { in: filters.allowedBatchIds } } : {}),
      ...(filters.batchId
        ? { AND: [{ batchId: filters.batchId }] }
        : {}),
      ...(filters.search
        ? { student: { user: { name: { contains: filters.search, mode: "insensitive" } } } }
        : {}),
    };

    const where: Prisma.SubmissionWhereInput = {
      tenantId,
      assignmentId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(Object.keys(enrollmentFilter).length > 0 ? { enrollment: enrollmentFilter } : {}),
    };

    const [rawRows, total] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
      this.prisma.client.submission.findMany({
        where,
        include: {
          assignment: { select: { title: true, maxScore: true } },
          milestone: { select: { title: true } },
          enrollment: {
            select: {
              student: { select: { user: { select: { name: true } }, id: true } },
              batchId: true,
              // `name` alongside facultyId: the cohort is what a reviewer works in, so it
              // belongs on the row rather than behind a second lookup per submission.
              batch: { select: { facultyId: true, name: true } },
            },
          },
          gradedBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }) as Promise<any[]>,
      this.prisma.client.submission.count({ where }),
    ]);

    return { rows: rawRows.map(toSubmissionRow), total };
  }

  /**
   * Grade a submission: update status, score, rubric, feedback, graded_by, graded_at.
   * Returns the before-state for audit logging.
   */
  async gradeSubmission(
    tenantId: string,
    submissionId: string,
    data: {
      score: number;
      rubric?: Record<string, unknown>;
      feedback?: string;
      gradedById: string;
    },
  ): Promise<{ beforeScore: number | null; beforeStatus: SubmissionStatus }> {
    // Fetch before-state for audit.
    const before = await this.prisma.client.submission.findFirst({
      where: { id: submissionId, tenantId },
      select: { score: true, status: true },
    });

    const beforeScore = before?.score ?? null;
    const beforeStatus = (before?.status ?? "submitted") as SubmissionStatus;

    await this.prisma.client.submission.updateMany({
      where: { id: submissionId, tenantId },
      data: {
        status: "graded",
        score: data.score,
        rubric: data.rubric !== undefined ? (data.rubric as Prisma.InputJsonValue) : Prisma.DbNull,
        feedback: data.feedback ?? null,
        gradedById: data.gradedById,
        gradedAt: new Date(),
      },
    });

    return { beforeScore, beforeStatus };
  }

  /**
   * Return a submission to the student for changes: status=returned, reason into `feedback`.
   *
   * NO SCORE is written and `gradedAt` stays null — returning is not grading, and a row that
   * looked graded would land in `gradedCount` and read as reviewed-and-done on every
   * progress figure in the product. `gradedById` records WHO acted, which is the only part
   * of the grading trio that is true here.
   *
   * Guarded on `status: "submitted"` in the WHERE rather than trusting a prior read: two
   * reviewers opening the same queue must not both return the same attempt, and the second
   * write matching zero rows is how the service learns it lost the race.
   */
  async returnSubmission(
    tenantId: string,
    submissionId: string,
    data: { reason: string; returnedById: string },
  ): Promise<{ updated: number }> {
    const result = await this.prisma.client.submission.updateMany({
      where: { id: submissionId, tenantId, status: "submitted" },
      data: {
        status: "returned",
        feedback: data.reason,
        score: null,
        gradedById: data.returnedById,
        gradedAt: null,
      },
    });
    return { updated: result.count };
  }

  /**
   * Turn on resubmission for an assignment. Called when work is returned on a project that
   * was created without `allowResubmit` — otherwise the student is told to fix and resend
   * something the submit endpoint will refuse (RESUBMIT_NOT_ALLOWED), which is a dead end
   * with no way out from either side of the product.
   */
  async enableResubmission(tenantId: string, assignmentId: string): Promise<void> {
    await this.prisma.client.assignment.updateMany({
      where: { id: assignmentId, tenantId },
      data: { allowResubmit: true },
    });
  }

  /**
   * List assignments for a student's own enrollments.
   * Scoped to the student's enrolled programs.
   */
  async listAssignmentsForStudent(
    tenantId: string,
    studentId: string,
    filters: {
      kind?: AssignmentKind;
      page: number;
      pageSize: number;
    },
  ): Promise<{ rows: AssignmentRow[]; total: number }> {
    // Get the student's active enrollment program ids.
    const enrollments = await this.prisma.client.enrollment.findMany({
      where: { tenantId, studentId, status: "active" },
      select: { programId: true },
    });
    const programIds = enrollments.map((e) => e.programId);

    if (programIds.length === 0) {
      return { rows: [], total: 0 };
    }

    return this.listAssignments(tenantId, {
      programIds,
      kind: filters.kind,
      page: filters.page,
      pageSize: filters.pageSize,
    });
  }

  /**
   * Get all milestone submission states for a project (used in project detail view).
   * Returns per-milestone: latest submission status, score, feedback.
   */
  async getMilestoneSubmissions(
    tenantId: string,
    assignmentId: string,
    enrollmentId: string,
  ): Promise<
    Array<{
      milestoneId: string;
      submissionId: string | null;
      status: SubmissionStatus | null;
      score: number | null;
      feedback: string | null;
      submittedAt: Date | null;
      gradedAt: Date | null;
    }>
  > {
    // Get all milestones for this assignment.
    const milestones = await this.prisma.client.assignmentMilestone.findMany({
      where: { assignmentId, tenantId, deletedAt: null },
      orderBy: { order: "asc" },
      select: { id: true },
    });

    const result = await Promise.all(
      milestones.map(async (m) => {
        const sub = await this.prisma.client.submission.findFirst({
          where: { tenantId, assignmentId, milestoneId: m.id, enrollmentId, deletedAt: null },
          orderBy: { attemptNo: "desc" },
          select: { id: true, status: true, score: true, feedback: true, createdAt: true, gradedAt: true },
        });
        return {
          milestoneId: m.id,
          submissionId: sub?.id ?? null,
          status: (sub?.status ?? null) as SubmissionStatus | null,
          score: sub?.score ?? null,
          feedback: sub?.feedback ?? null,
          submittedAt: sub?.createdAt ?? null,
          gradedAt: sub?.gradedAt ?? null,
        };
      }),
    );

    return result;
  }

  /**
   * Get milestone submission states for ALL enrollments (faculty view of project).
   */
  async getMilestoneSubmissionsForAssignment(
    tenantId: string,
    assignmentId: string,
    allowedBatchIds?: string[],
  ): Promise<
    Array<{
      milestoneId: string;
      enrollmentId: string;
      submissionId: string | null;
      status: SubmissionStatus | null;
      score: number | null;
      feedback: string | null;
      submittedAt: Date | null;
      gradedAt: Date | null;
    }>
  > {
    const where: Prisma.SubmissionWhereInput = {
      tenantId,
      assignmentId,
      milestoneId: { not: null },
      ...(allowedBatchIds !== undefined
        ? { enrollment: { batchId: { in: allowedBatchIds } } }
        : {}),
    };

    const subs = await this.prisma.client.submission.findMany({
      where,
      select: {
        id: true,
        milestoneId: true,
        enrollmentId: true,
        status: true,
        score: true,
        feedback: true,
        createdAt: true,
        gradedAt: true,
      },
      orderBy: { attemptNo: "desc" },
    });

    return subs.map((s) => ({
      milestoneId: s.milestoneId!,
      enrollmentId: s.enrollmentId,
      submissionId: s.id,
      status: s.status as SubmissionStatus,
      score: s.score,
      feedback: s.feedback,
      submittedAt: s.createdAt,
      gradedAt: s.gradedAt,
    }));
  }

  /**
   * Write a manual audit log entry for grade changes (AC-B1, AC-B3).
   * Audit extension handles most model mutations, but grade changes need
   * explicit before/after payload for the assignment context.
   */
  async writeGradeAuditLog(data: {
    tenantId: string;
    actorId: string;
    submissionId: string;
    before: { score: number | null; status: string };
    // `score: null` is legitimate on the AFTER side too — returning a submission for changes
    // clears the score by design (it is not a grade). Widened when returnSubmission landed.
    after: { score: number | null; status: string };
  }): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: data.tenantId,
        actorId: data.actorId,
        entity: "Submission",
        entityId: data.submissionId,
        action: "submission.grade",
        before: (data.before ?? {}) as unknown as Prisma.InputJsonValue,
        after: data.after as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // ─── Phase-9 Completion T31 / R3: deadline reminders ─────────────────────────

  /**
   * Assignments/projects (kind is irrelevant — both carry `due_at`) whose `due_at`
   * falls within `[windowStart, windowEnd)`, across ALL tenants (the scheduler is a
   * system-level cron, not a per-request tenant-scoped call — DeadlineRemindersScheduler
   * iterates the returned `tenantId` per row itself). Bounded by `DEADLINE_REMINDER_BATCH_LIMIT`
   * (defensive ceiling, mirrors the R2 `findQueuedRecipients` cap precedent).
   */
  async findAssignmentsDueInWindow(
    windowStart: Date,
    windowEnd: Date,
    limit: number,
  ): Promise<Array<{ id: string; tenantId: string; title: string; dueAt: Date; programId: string }>> {
    const rows = await this.prisma.client.assignment.findMany({
      where: { dueAt: { gte: windowStart, lt: windowEnd }, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        title: true,
        dueAt: true,
        lesson: { select: { module: { select: { programId: true } } } },
      },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      title: r.title,
      dueAt: r.dueAt!,
      programId: r.lesson.module.programId,
    }));
  }

  /**
   * Active-enrollment students in `programId` who have NOT yet submitted `assignmentId`
   * — the recipient set for a deadline reminder (already-submitted students don't need
   * a nag). Returns contact fields directly (userId/email/phone/name) so the caller
   * doesn't need a second round-trip through StudentsRepository per row.
   */
  async findEnrolledStudentsWithoutSubmission(
    tenantId: string,
    programId: string,
    assignmentId: string,
  ): Promise<Array<{ studentId: string; userId: string; email: string; phone: string | null; name: string }>> {
    const enrollments = await this.prisma.client.enrollment.findMany({
      where: {
        tenantId,
        programId,
        status: "active",
        deletedAt: null,
        submissions: { none: { assignmentId, deletedAt: null } },
      },
      select: {
        studentId: true,
        student: { select: { user: { select: { id: true, email: true, phone: true, name: true } } } },
      },
    });
    return enrollments
      .filter((e) => e.student?.user)
      .map((e) => ({
        studentId: e.studentId,
        userId: e.student!.user.id,
        email: e.student!.user.email,
        phone: e.student!.user.phone,
        name: e.student!.user.name,
      }));
  }
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
function toAssignmentRow(row: any, gradedCount: number): AssignmentRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    lessonId: row.lessonId,
    lessonTitle: row.lesson?.title ?? "",
    programId: row.lesson?.module?.programId ?? "",
    programTitle: row.lesson?.module?.program?.title ?? "",
    kind: row.kind as AssignmentKind,
    title: row.title,
    instructions: row.instructions,
    maxScore: row.maxScore,
    dueAt: row.dueAt,
    allowResubmit: row.allowResubmit,
    isFinal: row.isFinal,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    milestones: (row.milestones ?? []).map((m: any) => ({
      id: m.id,
      assignmentId: m.assignmentId,
      title: m.title,
      order: m.order,
      dueAt: m.dueAt,
      createdAt: m.createdAt,
    })),
    submissionCount: row._count?.submissions ?? 0,
    gradedCount,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
function toSubmissionRow(row: any): SubmissionRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    assignmentId: row.assignmentId,
    assignmentTitle: row.assignment?.title ?? "",
    assignmentMaxScore: row.assignment?.maxScore ?? 0,
    milestoneId: row.milestoneId,
    milestoneTitle: row.milestone?.title ?? null,
    enrollmentId: row.enrollmentId,
    studentId: row.enrollment?.student?.id ?? "",
    studentName: row.enrollment?.student?.user?.name ?? "",
    files: row.files,
    text: row.text,
    link: row.link,
    attemptNo: row.attemptNo,
    status: row.status as SubmissionStatus,
    score: row.score,
    rubric: row.rubric,
    feedback: row.feedback,
    gradedById: row.gradedById,
    gradedByName: row.gradedBy?.name ?? null,
    gradedAt: row.gradedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    batchId: row.enrollment?.batchId ?? "",
    batchName: row.enrollment?.batch?.name ?? "",
    batchFacultyId: row.enrollment?.batch?.facultyId ?? null,
  };
}
