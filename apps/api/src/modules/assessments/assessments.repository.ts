// apps/api/src/modules/assessments/assessments.repository.ts
//
// Prisma data-access layer for the Assessments + Attempts module.
// (CLAUDE.md §3.3: "repository — Prisma data access only, applies soft-delete
// + data-scope filters (all|branch|assigned|own). No business logic.")
//
// SECURITY-CRITICAL DESIGN DECISIONS:
//
// 1. ANSWER-KEY ISOLATION (AC-J9, plan §6 Risk #3):
//    Student-facing question queries MUST use an EXPLICIT Prisma `select` that
//    excludes `answerKey`. NEVER use `include` or omit `select` on AssessmentQuestion
//    for student-facing paths. Only `findQuestionsWithAnswerKey` (server-only,
//    used solely for auto-grading) selects the `answerKey` column.
//    All other question selectors (findQuestionsPublic, findAttemptWithQuestions)
//    explicitly list every column except `answerKey`.
//
// 2. FACULTY ASSIGNED-SCOPE (plan §6 Risk #1, resolves ADR-0009 deferral):
//    Faculty sees only assessments in modules of programs whose batches have
//    batch.faculty_id = faculty_profiles.id for the actor.
//    For attempt grading: attempt → enrollment → batch → batch.faculty_id.
//
// 3. IDOR → 404 (ADR-0022):
//    Every query is tenant-scoped. Cross-student/cross-tenant returns null;
//    service converts null → NotFoundException(404).
//
// 4. Soft-delete:
//    PrismaService.client has softDeleteExtension applied — deleted_at IS NULL
//    filter is automatic. Nested relations use explicit `deletedAt: null` where
//    the soft-delete extension may not propagate.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@prisma/client";
import type { QuestionType, AssessmentType } from "@prisma/client";

// ─── Row types ───────────────────────────────────────────────────────────────

export interface AssessmentRow {
  id: string;
  tenantId: string;
  moduleId: string;
  moduleTitle: string;
  title: string;
  type: AssessmentType;
  timeLimitS: number | null;
  passPct: number;
  attemptsAllowed: number;
  isRequired: boolean;
  shuffle: boolean;
  questionCount: number;
  totalPoints: number;
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Question row WITHOUT answerKey — safe for student-facing responses.
 * SECURITY: The repository projection for this type explicitly excludes answerKey.
 */
export interface QuestionPublicRow {
  id: string;
  assessmentId: string;
  type: QuestionType;
  prompt: string;
  options: unknown; // JSON array of McqOption ({id, text}) — NO isCorrect
  points: number;
  order: number;
}

/**
 * Question row WITH answerKey — ONLY for server-side auto-grading.
 * NEVER include this in any student-facing response.
 */
export interface QuestionWithAnswerKeyRow extends QuestionPublicRow {
  answerKey: unknown; // Correct option id(s) for MCQ, rubric for descriptive
}

export interface AttemptRow {
  id: string;
  tenantId: string;
  assessmentId: string;
  assessmentTitle: string;
  assessmentPassPct: number;
  assessmentTimeLimitS: number | null;
  assessmentAttemptsAllowed: number;
  assessmentTotalPoints: number;
  enrollmentId: string;
  answers: unknown;
  score: number | null;
  passed: boolean | null;
  startedAt: Date;
  submittedAt: Date | null;
  timeExpiresAt: Date | null;
  flags: unknown;
  attemptNo: number;
  // for own-scope checks
  studentId: string;
  batchId: string;
  batchFacultyId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class AssessmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Profile resolution ───────────────────────────────────────────────────

  async findFacultyProfileId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.facultyProfile.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async findStudentProfileId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.studentProfile.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async findAssignedBatchIds(tenantId: string, facultyProfileId: string): Promise<string[]> {
    const rows = await this.prisma.client.batch.findMany({
      where: { tenantId, facultyId: facultyProfileId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async findAssignedProgramIds(tenantId: string, facultyProfileId: string): Promise<string[]> {
    const batchIds = await this.findAssignedBatchIds(tenantId, facultyProfileId);
    if (batchIds.length === 0) return [];
    const rows = await this.prisma.client.batch.findMany({
      where: { id: { in: batchIds }, tenantId },
      select: { programId: true },
    });
    return [...new Set(rows.map((r) => r.programId))];
  }

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

  // ─── Assessment CRUD (CRM / faculty) ─────────────────────────────────────

  async createAssessment(data: {
    tenantId: string;
    moduleId: string;
    title: string;
    type: AssessmentType;
    timeLimitS?: number | null;
    passPct: number;
    attemptsAllowed: number;
    isRequired: boolean;
    shuffle: boolean;
  }): Promise<string> {
    const row = await this.prisma.client.assessment.create({
      data: {
        tenantId: data.tenantId,
        moduleId: data.moduleId,
        title: data.title,
        type: data.type,
        timeLimitS: data.timeLimitS ?? null,
        passPct: data.passPct,
        attemptsAllowed: data.attemptsAllowed,
        isRequired: data.isRequired,
        shuffle: data.shuffle,
      },
      select: { id: true },
    });
    return row.id;
  }

  async createQuestions(
    tenantId: string,
    assessmentId: string,
    questions: Array<{
      type: QuestionType;
      prompt: string;
      options?: unknown;
      answerKey?: unknown;
      points: number;
      order: number;
    }>,
  ): Promise<void> {
    if (questions.length === 0) return;
    await this.prisma.client.assessmentQuestion.createMany({
      data: questions.map((q) => ({
        tenantId,
        assessmentId,
        type: q.type,
        prompt: q.prompt,
        options: q.options !== undefined ? (q.options as Prisma.InputJsonValue) : Prisma.DbNull,
        answerKey: q.answerKey !== undefined ? (q.answerKey as Prisma.InputJsonValue) : Prisma.DbNull,
        points: q.points,
        order: q.order,
      })),
    });
  }

  /**
   * Find a single assessment with aggregated metadata (NO questions here).
   * Tenant-scoped. Returns null if not found (IDOR → 404).
   */
  async findAssessmentById(tenantId: string, id: string): Promise<AssessmentRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma aggregate returns complex generic
    const row: any = await this.prisma.client.assessment.findFirst({
      where: { id, tenantId },
      include: {
        module: { select: { title: true } },
        _count: {
          select: {
            questions: { where: { deletedAt: null } },
            attempts: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!row) return null;

    const totalPoints = await this.sumQuestionPoints(tenantId, id);
    return toAssessmentRow(row, totalPoints);
  }

  /**
   * List assessments, tenant-scoped with optional program-id filter for faculty scope.
   */
  async listAssessments(
    tenantId: string,
    filters: {
      programIds?: string[];
      moduleId?: string;
      type?: AssessmentType;
      isRequired?: boolean;
      search?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{ rows: AssessmentRow[]; total: number }> {
    const where: Prisma.AssessmentWhereInput = {
      tenantId,
      ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.isRequired !== undefined ? { isRequired: filters.isRequired } : {}),
      ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" } } : {}),
      ...(filters.programIds !== undefined
        ? { module: { programId: { in: filters.programIds } } }
        : {}),
    };

    const [rawRows, total] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
      this.prisma.client.assessment.findMany({
        where,
        include: {
          module: { select: { title: true } },
          _count: {
            select: {
              questions: { where: { deletedAt: null } },
              attempts: { where: { deletedAt: null } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }) as Promise<any[]>,
      this.prisma.client.assessment.count({ where }),
    ]);

    const rows: AssessmentRow[] = await Promise.all(
      rawRows.map(async (row) => {
        const totalPoints = await this.sumQuestionPoints(tenantId, row.id);
        return toAssessmentRow(row, totalPoints);
      }),
    );

    return { rows, total };
  }

  async updateAssessment(
    tenantId: string,
    id: string,
    data: {
      title?: string;
      type?: AssessmentType;
      timeLimitS?: number | null;
      passPct?: number;
      attemptsAllowed?: number;
      isRequired?: boolean;
      shuffle?: boolean;
    },
  ): Promise<void> {
    await this.prisma.client.assessment.updateMany({
      where: { id, tenantId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.timeLimitS !== undefined ? { timeLimitS: data.timeLimitS } : {}),
        ...(data.passPct !== undefined ? { passPct: data.passPct } : {}),
        ...(data.attemptsAllowed !== undefined ? { attemptsAllowed: data.attemptsAllowed } : {}),
        ...(data.isRequired !== undefined ? { isRequired: data.isRequired } : {}),
        ...(data.shuffle !== undefined ? { shuffle: data.shuffle } : {}),
      },
    });
  }

  async softDeleteAssessment(tenantId: string, id: string): Promise<void> {
    await this.prisma.client.assessment.deleteMany({ where: { id, tenantId } });
  }

  // ─── Question queries ─────────────────────────────────────────────────────

  /**
   * STUDENT-SAFE: Fetch questions WITHOUT answerKey.
   * The explicit `select` NEVER includes the answerKey column (AC-J9).
   */
  async findQuestionsPublic(
    tenantId: string,
    assessmentId: string,
  ): Promise<QuestionPublicRow[]> {
    const rows = await this.prisma.client.assessmentQuestion.findMany({
      where: { assessmentId, tenantId, deletedAt: null },
      // SECURITY: explicit select — answerKey is NOT listed here
      select: {
        id: true,
        assessmentId: true,
        type: true,
        prompt: true,
        options: true,
        points: true,
        order: true,
        // answerKey: intentionally OMITTED — answer-key isolation (AC-J9)
      },
      orderBy: { order: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      assessmentId: r.assessmentId,
      type: r.type as QuestionType,
      prompt: r.prompt,
      options: r.options,
      points: r.points,
      order: r.order,
    }));
  }

  /**
   * AUTHOR VIEW: Fetch questions WITH answerKey.
   * FOR CRM / FACULTY USE ONLY. NEVER use in student-facing code paths.
   */
  async findQuestionsWithAnswerKey(
    tenantId: string,
    assessmentId: string,
  ): Promise<QuestionWithAnswerKeyRow[]> {
    const rows = await this.prisma.client.assessmentQuestion.findMany({
      where: { assessmentId, tenantId, deletedAt: null },
      select: {
        id: true,
        assessmentId: true,
        type: true,
        prompt: true,
        options: true,
        answerKey: true, // FOR GRADING AND AUTHOR VIEW ONLY
        points: true,
        order: true,
      },
      orderBy: { order: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      assessmentId: r.assessmentId,
      type: r.type as QuestionType,
      prompt: r.prompt,
      options: r.options,
      answerKey: r.answerKey,
      points: r.points,
      order: r.order,
    }));
  }

  private async sumQuestionPoints(tenantId: string, assessmentId: string): Promise<number> {
    const agg = await this.prisma.client.assessmentQuestion.aggregate({
      where: { assessmentId, tenantId, deletedAt: null },
      _sum: { points: true },
    });
    return agg._sum.points ?? 0;
  }

  // ─── Attempt queries ──────────────────────────────────────────────────────

  /**
   * Count submitted (non-null submittedAt) attempts for (enrollment, assessment).
   * Used to enforce attempts_allowed before starting a new attempt.
   */
  async countSubmittedAttempts(
    tenantId: string,
    assessmentId: string,
    enrollmentId: string,
  ): Promise<number> {
    return this.prisma.client.attempt.count({
      where: {
        tenantId,
        assessmentId,
        enrollmentId,
        submittedAt: { not: null },
        deletedAt: null,
      },
    });
  }

  /**
   * Submitted-attempt timestamps for (enrollment, assessment), newest first.
   * Used to compute the attempt "wave" (attempts cluster within a cooldown window, then a
   * fresh set opens — see AssessmentsService.computeAttemptWave).
   */
  async findSubmittedAttemptTimestamps(
    tenantId: string,
    assessmentId: string,
    enrollmentId: string,
  ): Promise<Date[]> {
    const rows = await this.prisma.client.attempt.findMany({
      where: {
        tenantId,
        assessmentId,
        enrollmentId,
        submittedAt: { not: null },
        deletedAt: null,
      },
      select: { submittedAt: true },
      orderBy: { submittedAt: "desc" },
    });
    // submittedAt is non-null by the WHERE filter; assert for the type.
    return rows.map((r) => r.submittedAt as Date);
  }

  /**
   * Find the currently in-progress (not yet submitted) attempt for (enrollment, assessment).
   * Used to enforce ATTEMPT_IN_PROGRESS guard (AC-D5 / edge case).
   */
  async findInProgressAttempt(
    tenantId: string,
    assessmentId: string,
    enrollmentId: string,
  ): Promise<{ id: string; timeExpiresAt: Date | null } | null> {
    const row = await this.prisma.client.attempt.findFirst({
      where: {
        tenantId,
        assessmentId,
        enrollmentId,
        submittedAt: null,
        deletedAt: null,
      },
      select: { id: true, timeExpiresAt: true },
    });
    return row ?? null;
  }

  /**
   * Create a new attempt row.
   * Caller is responsible for enforcing attempts_allowed BEFORE calling this.
   */
  async createAttempt(data: {
    tenantId: string;
    assessmentId: string;
    enrollmentId: string;
    attemptNo: number;
    startedAt: Date;
    timeExpiresAt: Date | null;
  }): Promise<string> {
    const row = await this.prisma.client.attempt.create({
      data: {
        tenantId: data.tenantId,
        assessmentId: data.assessmentId,
        enrollmentId: data.enrollmentId,
        attemptNo: data.attemptNo,
        startedAt: data.startedAt,
        timeExpiresAt: data.timeExpiresAt,
        answers: {},
        flags: {},
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * Find an attempt by id.
   * Returns null if not found (IDOR → 404 in service).
   */
  async findAttemptById(tenantId: string, attemptId: string): Promise<AttemptRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
    const row: any = await this.prisma.client.attempt.findFirst({
      where: { id: attemptId, tenantId },
      include: {
        assessment: {
          select: {
            title: true,
            passPct: true,
            timeLimitS: true,
            attemptsAllowed: true,
            // NOTE: no questions here — questions fetched separately to enforce answer-key isolation
          },
        },
        enrollment: {
          select: {
            studentId: true,
            batchId: true,
            batch: { select: { facultyId: true } },
          },
        },
      },
    });
    if (!row) return null;

    // Compute total points for this assessment
    const totalPoints = await this.sumQuestionPoints(tenantId, row.assessmentId);
    return toAttemptRow(row, totalPoints);
  }

  /**
   * Submit an attempt: store answers, trigger auto-grade results (written by service),
   * and set submittedAt. Returns the before-state for idempotency check.
   *
   * IDEMPOTENCY (AC-D7): if submittedAt is already set, the service checks and returns
   * the existing result WITHOUT calling this method again.
   */
  async submitAttempt(
    tenantId: string,
    attemptId: string,
    data: {
      answers: Record<string, unknown>;
      score: number;
      passed: boolean | null;
      submittedAt: Date;
      flags: Record<string, unknown>;
      questionResults: unknown; // stored as JSON in flags for post-submit display
    },
  ): Promise<void> {
    await this.prisma.client.attempt.updateMany({
      where: { id: attemptId, tenantId },
      data: {
        answers: data.answers as Prisma.InputJsonValue,
        score: data.score,
        passed: data.passed,
        submittedAt: data.submittedAt,
        flags: data.flags as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Increment the tab-switch count in flags.
   * PATCH /me/attempts/:id/flag — client reports focus-loss event (AC-D6).
   * Reads current flags, increments tabSwitchCount, writes back.
   */
  async incrementTabSwitchFlag(tenantId: string, attemptId: string): Promise<void> {
    const row = await this.prisma.client.attempt.findFirst({
      where: { id: attemptId, tenantId },
      select: { flags: true },
    });
    if (!row) return;

    const flags = (row.flags as Record<string, unknown>) ?? {};
    const current = typeof flags["tabSwitchCount"] === "number" ? flags["tabSwitchCount"] : 0;
    const updated = { ...flags, tabSwitchCount: current + 1 };

    await this.prisma.client.attempt.updateMany({
      where: { id: attemptId, tenantId },
      data: { flags: updated as Prisma.InputJsonValue },
    });
  }

  /**
   * Manually grade descriptive questions on an attempt.
   * PUT /crm/attempts/:id/grade — faculty sets per-question points + overall passed.
   * Returns before-state for audit logging.
   */
  async gradeAttempt(
    tenantId: string,
    attemptId: string,
    data: {
      score: number;
      passed: boolean;
      updatedQuestionResults: unknown;
    },
  ): Promise<{ beforeScore: number | null; beforePassed: boolean | null }> {
    const before = await this.prisma.client.attempt.findFirst({
      where: { id: attemptId, tenantId },
      select: { score: true, passed: true },
    });

    const beforeScore = before?.score ?? null;
    const beforePassed = before?.passed ?? null;

    await this.prisma.client.attempt.updateMany({
      where: { id: attemptId, tenantId },
      data: {
        score: data.score,
        passed: data.passed,
        flags: data.updatedQuestionResults as Prisma.InputJsonValue,
      },
    });

    return { beforeScore, beforePassed };
  }

  /**
   * List attempts for an assessment.
   * Faculty assigned-scope: filter by enrolled batch being assigned to the faculty.
   */
  async listAttempts(
    tenantId: string,
    assessmentId: string,
    filters: {
      allowedBatchIds?: string[];
      enrollmentId?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{ rows: AttemptRow[]; total: number }> {
    const where: Prisma.AttemptWhereInput = {
      tenantId,
      assessmentId,
      ...(filters.enrollmentId ? { enrollmentId: filters.enrollmentId } : {}),
      ...(filters.allowedBatchIds !== undefined
        ? { enrollment: { batchId: { in: filters.allowedBatchIds } } }
        : {}),
      submittedAt: { not: null }, // only submitted attempts in the grading queue
    };

    const [rawRows, total] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
      this.prisma.client.attempt.findMany({
        where,
        include: {
          assessment: {
            select: {
              title: true,
              passPct: true,
              timeLimitS: true,
              attemptsAllowed: true,
            },
          },
          enrollment: {
            select: {
              studentId: true,
              batchId: true,
              batch: { select: { facultyId: true } },
            },
          },
        },
        orderBy: { submittedAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }) as Promise<any[]>,
      this.prisma.client.attempt.count({ where }),
    ]);

    const rows: AttemptRow[] = await Promise.all(
      rawRows.map(async (row) => {
        const totalPoints = await this.sumQuestionPoints(tenantId, row.assessmentId);
        return toAttemptRow(row, totalPoints);
      }),
    );

    return { rows, total };
  }

  /**
   * Count submitted (passed=true) attempts for a given assessment and enrollment.
   * Used by certificate eligibility engine.
   */
  async countPassingAttempts(
    tenantId: string,
    assessmentId: string,
    enrollmentId: string,
  ): Promise<number> {
    return this.prisma.client.attempt.count({
      where: {
        tenantId,
        assessmentId,
        enrollmentId,
        passed: true,
        submittedAt: { not: null },
        deletedAt: null,
      },
    });
  }

  /**
   * Write a manual audit log entry for attempt grade changes (manual descriptive grading).
   */
  async writeAttemptGradeAuditLog(data: {
    tenantId: string;
    actorId: string;
    attemptId: string;
    before: { score: number | null; passed: boolean | null };
    after: { score: number; passed: boolean };
  }): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: data.tenantId,
        actorId: data.actorId,
        entity: "Attempt",
        entityId: data.attemptId,
        action: "attempt.manual_grade",
        before: (data.before ?? {}) as unknown as Prisma.InputJsonValue,
        after: data.after as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Write an audit log entry for attempt start.
   */
  async writeAttemptStartAuditLog(data: {
    tenantId: string;
    actorId: string;
    attemptId: string;
    assessmentId: string;
    enrollmentId: string;
    attemptNo: number;
  }): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: data.tenantId,
        actorId: data.actorId,
        entity: "Attempt",
        entityId: data.attemptId,
        action: "attempt.start",
        before: Prisma.DbNull,
        after: {
          assessmentId: data.assessmentId,
          enrollmentId: data.enrollmentId,
          attemptNo: data.attemptNo,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Write an audit log entry for attempt submit.
   */
  async writeAttemptSubmitAuditLog(data: {
    tenantId: string;
    actorId: string;
    attemptId: string;
    score: number;
    passed: boolean | null;
  }): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: data.tenantId,
        actorId: data.actorId,
        entity: "Attempt",
        entityId: data.attemptId,
        action: "attempt.submit",
        before: Prisma.DbNull,
        after: {
          score: data.score,
          passed: data.passed,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
function toAssessmentRow(row: any, totalPoints: number): AssessmentRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    moduleId: row.moduleId,
    moduleTitle: row.module?.title ?? "",
    title: row.title,
    type: row.type as AssessmentType,
    timeLimitS: row.timeLimitS,
    passPct: row.passPct,
    attemptsAllowed: row.attemptsAllowed,
    isRequired: row.isRequired,
    shuffle: row.shuffle,
    questionCount: row._count?.questions ?? 0,
    totalPoints,
    attemptCount: row._count?.attempts ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
function toAttemptRow(row: any, totalPoints: number): AttemptRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    assessmentId: row.assessmentId,
    assessmentTitle: row.assessment?.title ?? "",
    assessmentPassPct: row.assessment?.passPct ?? 0,
    assessmentTimeLimitS: row.assessment?.timeLimitS ?? null,
    assessmentAttemptsAllowed: row.assessment?.attemptsAllowed ?? 1,
    assessmentTotalPoints: totalPoints,
    enrollmentId: row.enrollmentId,
    answers: row.answers,
    score: row.score,
    passed: row.passed,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    timeExpiresAt: row.timeExpiresAt,
    flags: row.flags,
    attemptNo: row.attemptNo,
    studentId: row.enrollment?.studentId ?? "",
    batchId: row.enrollment?.batchId ?? "",
    batchFacultyId: row.enrollment?.batch?.facultyId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
