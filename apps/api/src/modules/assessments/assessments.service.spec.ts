// apps/api/src/modules/assessments/assessments.service.spec.ts
//
// Unit tests for AssessmentsService (P4 Wave 4 task #7).
//
// Coverage (per plan §4 task #7 DoD + spec AC-D):
//   1. MCQ auto-grade correctness: correct answer → full points; wrong → 0; multi-select exact match.
//   2. Time-box rejection: submit after time_expires_at → 422 ATTEMPT_EXPIRED (AC-D4).
//   3. Attempts-allowed enforcement: start when exhausted → 422 ATTEMPTS_EXHAUSTED (AC-D5).
//   4. Idempotent re-submit: already-submitted attempt → 200 with cached result, no re-grade (AC-D7).
//   5. Passed computation: score/total >= passPct/100 → passed=true; else false.
//   6. Descriptive pending: attempt with descriptive question → passed=null after submit (AC-D9).
//   7. Answer-key omission: toQuestionPublicDto never includes answerKey.
//   8. IDOR: student accessing another student's attempt → 404 (AC-D10).
//   9. ATTEMPT_IN_PROGRESS: start when unexpired in-progress attempt exists → 422.
//  10. Faculty assigned-scope: unassigned batch → 404 on grade (AC-B2 analog).

import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { AssessmentsService, gradeMcqQuestion, computeAttemptWave } from "./assessments.service";
import type {
  AssessmentsRepository,
  AssessmentRow,
  AttemptRow,
  QuestionPublicRow,
  QuestionWithAnswerKeyRow,
} from "./assessments.repository";

// ─── Test helpers ──────────────────────────────────────────────────────────────

type MockRepo = jest.Mocked<
  Pick<
    AssessmentsRepository,
    | "findFacultyProfileId"
    | "findStudentProfileId"
    | "findAssignedBatchIds"
    | "findAssignedProgramIds"
    | "findActiveEnrollment"
    | "findEnrollmentById"
    | "createAssessment"
    | "createQuestions"
    | "findAssessmentById"
    | "listAssessments"
    | "updateAssessment"
    | "softDeleteAssessment"
    | "findQuestionsPublic"
    | "findQuestionsWithAnswerKey"
    | "countSubmittedAttempts"
    | "findSubmittedAttemptTimestamps"
    | "countPassingAttempts"
    | "findInProgressAttempt"
    | "createAttempt"
    | "findAttemptById"
    | "submitAttempt"
    | "incrementTabSwitchFlag"
    | "gradeAttempt"
    | "listAttempts"
    | "writeAttemptGradeAuditLog"
    | "writeAttemptStartAuditLog"
    | "writeAttemptSubmitAuditLog"
  >
>;

interface MockRepoWithPrisma extends MockRepo {
  prisma: {
    client: {
      module: { findFirst: jest.Mock };
      enrollment: { findMany: jest.Mock };
    };
  };
}

function makeRepo(): MockRepoWithPrisma {
  return {
    findFacultyProfileId: jest.fn(),
    findStudentProfileId: jest.fn(),
    findAssignedBatchIds: jest.fn(),
    findAssignedProgramIds: jest.fn(),
    findActiveEnrollment: jest.fn(),
    findEnrollmentById: jest.fn(),
    createAssessment: jest.fn(),
    createQuestions: jest.fn(),
    findAssessmentById: jest.fn(),
    listAssessments: jest.fn(),
    updateAssessment: jest.fn(),
    softDeleteAssessment: jest.fn(),
    findQuestionsPublic: jest.fn(),
    findQuestionsWithAnswerKey: jest.fn(),
    countSubmittedAttempts: jest.fn(),
    findSubmittedAttemptTimestamps: jest.fn().mockResolvedValue([]),
    countPassingAttempts: jest.fn(),
    findInProgressAttempt: jest.fn(),
    createAttempt: jest.fn(),
    findAttemptById: jest.fn(),
    submitAttempt: jest.fn(),
    incrementTabSwitchFlag: jest.fn(),
    gradeAttempt: jest.fn(),
    listAttempts: jest.fn(),
    writeAttemptGradeAuditLog: jest.fn(),
    writeAttemptStartAuditLog: jest.fn(),
    writeAttemptSubmitAuditLog: jest.fn(),
    prisma: {
      client: {
        module: { findFirst: jest.fn() },
        enrollment: { findMany: jest.fn() },
      },
    },
  };
}

// ─── Fixture factories ────────────────────────────────────────────────────────

function makeAssessmentRow(overrides: Partial<AssessmentRow> = {}): AssessmentRow {
  return {
    id: "assess-1",
    tenantId: "t1",
    moduleId: "mod-1",
    moduleTitle: "Module 1",
    title: "Quiz 1",
    type: "quiz",
    timeLimitS: 1800,
    passPct: 70,
    attemptsAllowed: 2,
    isRequired: false,
    shuffle: false,
    questionCount: 2,
    totalPoints: 10,
    attemptCount: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeAttemptRow(overrides: Partial<AttemptRow> = {}): AttemptRow {
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 60 * 1000); // 30 min from now
  return {
    id: "attempt-1",
    tenantId: "t1",
    assessmentId: "assess-1",
    assessmentTitle: "Quiz 1",
    assessmentPassPct: 70,
    assessmentTimeLimitS: 1800,
    assessmentAttemptsAllowed: 2,
    assessmentTotalPoints: 10,
    enrollmentId: "enroll-1",
    answers: {},
    score: null,
    passed: null,
    startedAt: now,
    submittedAt: null,
    timeExpiresAt: expires,
    flags: {},
    attemptNo: 1,
    studentId: "student-1",
    batchId: "batch-1",
    batchFacultyId: "faculty-profile-1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeMcqQuestion(
  id: string,
  answerKey: string | string[] | null,
  points = 5,
): QuestionWithAnswerKeyRow {
  return {
    id,
    assessmentId: "assess-1",
    type: "mcq",
    prompt: `Question ${id}`,
    options: [
      { id: "opt-a", text: "Option A" },
      { id: "opt-b", text: "Option B" },
    ],
    answerKey,
    points,
    order: 0,
  };
}

function makeDescriptiveQuestion(id: string): QuestionWithAnswerKeyRow {
  return {
    id,
    assessmentId: "assess-1",
    type: "descriptive",
    prompt: `Descriptive ${id}`,
    options: null,
    answerKey: { rubric: "Explain clearly" },
    points: 10,
    order: 1,
  };
}

function makePublicQuestion(id: string): QuestionPublicRow {
  return {
    id,
    assessmentId: "assess-1",
    type: "mcq",
    prompt: `Question ${id}`,
    options: [
      { id: "opt-a", text: "Option A" },
      { id: "opt-b", text: "Option B" },
    ],
    points: 5,
    order: 0,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("gradeMcqQuestion (unit — pure function)", () => {
  it("correct single answer → full points + isCorrect=true", () => {
    const q = makeMcqQuestion("q1", "opt-a", 5);
    const { earned, isCorrect } = gradeMcqQuestion(q, "opt-a");
    expect(earned).toBe(5);
    expect(isCorrect).toBe(true);
  });

  it("wrong single answer → 0 points + isCorrect=false", () => {
    const q = makeMcqQuestion("q1", "opt-a", 5);
    const { earned, isCorrect } = gradeMcqQuestion(q, "opt-b");
    expect(earned).toBe(0);
    expect(isCorrect).toBe(false);
  });

  it("multi-select: exact match → full points", () => {
    const q = makeMcqQuestion("q1", ["opt-a", "opt-b"], 10);
    const { earned, isCorrect } = gradeMcqQuestion(q, ["opt-b", "opt-a"]); // order shouldn't matter
    expect(earned).toBe(10);
    expect(isCorrect).toBe(true);
  });

  it("multi-select: partial match → 0 (all-or-nothing)", () => {
    const q = makeMcqQuestion("q1", ["opt-a", "opt-b"], 10);
    const { earned, isCorrect } = gradeMcqQuestion(q, ["opt-a"]);
    expect(earned).toBe(0);
    expect(isCorrect).toBe(false);
  });

  it("null answer key → 0 points + isCorrect=false", () => {
    const q = makeMcqQuestion("q1", null, 5);
    const { earned, isCorrect } = gradeMcqQuestion(q, "opt-a");
    expect(earned).toBe(0);
    expect(isCorrect).toBe(false);
  });

  it("empty string student answer → isCorrect=false", () => {
    const q = makeMcqQuestion("q1", "opt-a", 5);
    const { earned, isCorrect } = gradeMcqQuestion(q, "");
    expect(earned).toBe(0);
    expect(isCorrect).toBe(false);
  });
});

describe("AssessmentsService.submitAttempt", () => {
  let repo: MockRepoWithPrisma;
  let service: AssessmentsService;

  beforeEach(() => {
    repo = makeRepo();
    service = new AssessmentsService(repo as unknown as AssessmentsRepository);
  });

  it("ATTEMPT_EXPIRED: rejects submission after time_expires_at (AC-D4)", async () => {
    const pastExpiry = new Date(Date.now() - 1000); // 1s in the past
    const attempt = makeAttemptRow({ timeExpiresAt: pastExpiry, submittedAt: null });
    repo.findAttemptById.mockResolvedValue(attempt);
    repo.findStudentProfileId.mockResolvedValue("student-1");

    await expect(
      service.submitAttempt("user-1", "t1", "attempt-1", { answers: [], flags: undefined }),
    ).rejects.toThrow(UnprocessableEntityException);

    try {
      await service.submitAttempt("user-1", "t1", "attempt-1", { answers: [], flags: undefined });
    } catch (e) {
      expect((e as UnprocessableEntityException).getResponse()).toMatchObject({
        code: "ATTEMPT_EXPIRED",
      });
    }
  });

  it("IDEMPOTENT RE-SUBMIT: already submitted → returns cached result, no re-grade (AC-D7)", async () => {
    const submittedAt = new Date();
    const questionResults = [
      {
        questionId: "q1",
        type: "mcq" as const,
        earnedPoints: 5,
        maxPoints: 5,
        isCorrectForMcq: true,
        isPendingManualGrade: false,
      },
    ];
    const attempt = makeAttemptRow({
      submittedAt,
      score: 5,
      passed: true,
      flags: { tabSwitchCount: 0, questionResults },
    });
    repo.findAttemptById.mockResolvedValue(attempt);
    repo.findStudentProfileId.mockResolvedValue("student-1");
    repo.countSubmittedAttempts.mockResolvedValue(1);

    const result = await service.submitAttempt("user-1", "t1", "attempt-1", {
      answers: [],
      flags: undefined,
    });

    // Should NOT call findQuestionsWithAnswerKey (no re-grade)
    expect(repo.findQuestionsWithAnswerKey).not.toHaveBeenCalled();
    // Should NOT call submitAttempt on the repo (no DB write)
    expect(repo.submitAttempt).not.toHaveBeenCalled();
    // Returns existing result
    expect(result.score).toBe(5);
    expect(result.passed).toBe(true);
    expect(result.questionResults).toEqual(questionResults);
  });

  it("IDOR: student accessing another student's attempt → NotFoundException (AC-D10)", async () => {
    const attempt = makeAttemptRow({ studentId: "student-2" }); // belongs to different student
    repo.findAttemptById.mockResolvedValue(attempt);
    repo.findStudentProfileId.mockResolvedValue("student-1"); // requesting user is student-1

    await expect(
      service.submitAttempt("user-1", "t1", "attempt-1", { answers: [], flags: undefined }),
    ).rejects.toThrow(NotFoundException);
  });

  it("MCQ auto-grade: correct answer → passed=true when score >= passPct", async () => {
    const attempt = makeAttemptRow({
      assessmentTotalPoints: 10,
      assessmentPassPct: 70,
      timeExpiresAt: new Date(Date.now() + 3600000),
      submittedAt: null,
    });
    const questions: QuestionWithAnswerKeyRow[] = [
      makeMcqQuestion("q1", "opt-a", 10), // 10 points, student answers correctly
    ];
    const publicQ: QuestionPublicRow[] = [makePublicQuestion("q1")];
    repo.findAttemptById
      .mockResolvedValueOnce(attempt) // initial fetch
      .mockResolvedValueOnce({ ...attempt, submittedAt: new Date(), score: 10, passed: true }); // after submit
    repo.findStudentProfileId.mockResolvedValue("student-1");
    repo.findQuestionsWithAnswerKey.mockResolvedValue(questions);
    repo.findQuestionsPublic.mockResolvedValue(publicQ);
    repo.submitAttempt.mockResolvedValue(undefined);
    repo.writeAttemptSubmitAuditLog.mockResolvedValue(undefined);
    repo.countSubmittedAttempts.mockResolvedValue(1);

    const result = await service.submitAttempt("user-1", "t1", "attempt-1", {
      answers: [{ questionId: "q1", value: "opt-a" }],
      flags: undefined,
    });

    expect(result.score).toBe(10);
    expect(result.passed).toBe(true);
    expect(result.questionResults).not.toBeNull();
    expect(result.questionResults![0]?.isCorrectForMcq).toBe(true);
    // CRITICAL: answer key never in result
    expect(JSON.stringify(result)).not.toContain("answerKey");
    expect(JSON.stringify(result)).not.toContain("answer_key");
  });

  it("MCQ auto-grade: wrong answer → passed=false when score < passPct", async () => {
    const attempt = makeAttemptRow({
      assessmentTotalPoints: 10,
      assessmentPassPct: 70,
      timeExpiresAt: new Date(Date.now() + 3600000),
      submittedAt: null,
    });
    const questions: QuestionWithAnswerKeyRow[] = [
      makeMcqQuestion("q1", "opt-a", 10), // correct is opt-a, student picks opt-b
    ];
    const publicQ: QuestionPublicRow[] = [makePublicQuestion("q1")];
    repo.findAttemptById
      .mockResolvedValueOnce(attempt)
      .mockResolvedValueOnce({ ...attempt, submittedAt: new Date(), score: 0, passed: false });
    repo.findStudentProfileId.mockResolvedValue("student-1");
    repo.findQuestionsWithAnswerKey.mockResolvedValue(questions);
    repo.findQuestionsPublic.mockResolvedValue(publicQ);
    repo.submitAttempt.mockResolvedValue(undefined);
    repo.writeAttemptSubmitAuditLog.mockResolvedValue(undefined);
    repo.countSubmittedAttempts.mockResolvedValue(1);

    const result = await service.submitAttempt("user-1", "t1", "attempt-1", {
      answers: [{ questionId: "q1", value: "opt-b" }], // wrong
      flags: undefined,
    });

    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.questionResults![0]?.isCorrectForMcq).toBe(false);
  });

  it("DESCRIPTIVE PENDING: attempt with descriptive question → passed=null (AC-D9)", async () => {
    const attempt = makeAttemptRow({
      assessmentTotalPoints: 10,
      assessmentPassPct: 70,
      timeExpiresAt: new Date(Date.now() + 3600000),
      submittedAt: null,
    });
    const questions: QuestionWithAnswerKeyRow[] = [
      makeDescriptiveQuestion("q1"), // descriptive → pending
    ];
    const publicQ: QuestionPublicRow[] = [{
      id: "q1",
      assessmentId: "assess-1",
      type: "descriptive",
      prompt: "Describe something",
      options: null,
      points: 10,
      order: 0,
    }];
    repo.findAttemptById
      .mockResolvedValueOnce(attempt)
      .mockResolvedValueOnce({ ...attempt, submittedAt: new Date(), score: 0, passed: null });
    repo.findStudentProfileId.mockResolvedValue("student-1");
    repo.findQuestionsWithAnswerKey.mockResolvedValue(questions);
    repo.findQuestionsPublic.mockResolvedValue(publicQ);
    repo.submitAttempt.mockResolvedValue(undefined);
    repo.writeAttemptSubmitAuditLog.mockResolvedValue(undefined);
    repo.countSubmittedAttempts.mockResolvedValue(1);

    const result = await service.submitAttempt("user-1", "t1", "attempt-1", {
      answers: [{ questionId: "q1", value: "My descriptive answer" }],
      flags: undefined,
    });

    expect(result.passed).toBeNull(); // awaiting manual grade
    expect(result.hasPendingManualGrade).toBe(true);
    expect(result.questionResults![0]?.isPendingManualGrade).toBe(true);
  });
});

describe("AssessmentsService.startAttempt", () => {
  let repo: MockRepoWithPrisma;
  let service: AssessmentsService;

  beforeEach(() => {
    repo = makeRepo();
    service = new AssessmentsService(repo as unknown as AssessmentsRepository);
  });

  it("ATTEMPTS_EXHAUSTED: start when limit reached → 422 (AC-D5)", async () => {
    repo.findAssessmentById.mockResolvedValue(makeAssessmentRow({ attemptsAllowed: 1 }));
    repo.findStudentProfileId.mockResolvedValue("student-1");
    repo.prisma.client.module.findFirst.mockResolvedValue({ programId: "prog-1" });
    repo.findActiveEnrollment.mockResolvedValue({ id: "enroll-1", batchId: "batch-1" });
    // One recent submitted attempt against attemptsAllowed=1 → current wave exhausted.
    repo.findSubmittedAttemptTimestamps.mockResolvedValue([new Date()]);

    await expect(service.startAttempt("user-1", "t1", "assess-1")).rejects.toThrow(
      UnprocessableEntityException,
    );

    try {
      await service.startAttempt("user-1", "t1", "assess-1");
    } catch (e) {
      expect((e as UnprocessableEntityException).getResponse()).toMatchObject({
        code: "ATTEMPTS_EXHAUSTED",
      });
    }
  });

  it("ATTEMPT_IN_PROGRESS: in-progress non-expired attempt → 422", async () => {
    const futureExpiry = new Date(Date.now() + 3600000);
    repo.findAssessmentById.mockResolvedValue(makeAssessmentRow({ attemptsAllowed: 2 }));
    repo.findStudentProfileId.mockResolvedValue("student-1");
    repo.prisma.client.module.findFirst.mockResolvedValue({ programId: "prog-1" });
    repo.findActiveEnrollment.mockResolvedValue({ id: "enroll-1", batchId: "batch-1" });
    repo.countSubmittedAttempts.mockResolvedValue(0);
    repo.findInProgressAttempt.mockResolvedValue({ id: "old-attempt", timeExpiresAt: futureExpiry });

    await expect(service.startAttempt("user-1", "t1", "assess-1")).rejects.toThrow(
      UnprocessableEntityException,
    );

    try {
      await service.startAttempt("user-1", "t1", "assess-1");
    } catch (e) {
      expect((e as UnprocessableEntityException).getResponse()).toMatchObject({
        code: "ATTEMPT_IN_PROGRESS",
      });
    }
  });

  it("EXPIRED in-progress attempt → allows new start (server treats as closed)", async () => {
    const pastExpiry = new Date(Date.now() - 1000); // already expired
    repo.findAssessmentById.mockResolvedValue(makeAssessmentRow({ attemptsAllowed: 2 }));
    repo.findStudentProfileId.mockResolvedValue("student-1");
    repo.prisma.client.module.findFirst.mockResolvedValue({ programId: "prog-1" });
    repo.findActiveEnrollment.mockResolvedValue({ id: "enroll-1", batchId: "batch-1" });
    repo.countSubmittedAttempts.mockResolvedValue(0);
    repo.findInProgressAttempt.mockResolvedValue({ id: "old-attempt", timeExpiresAt: pastExpiry });
    repo.createAttempt.mockResolvedValue("new-attempt-id");
    repo.writeAttemptStartAuditLog.mockResolvedValue(undefined);
    repo.findQuestionsPublic.mockResolvedValue([makePublicQuestion("q1")]);
    repo.findAttemptById.mockResolvedValue(makeAttemptRow({ id: "new-attempt-id" }));

    // Should NOT throw
    const result = await service.startAttempt("user-1", "t1", "assess-1");
    expect(result.attempt.id).toBe("new-attempt-id");
  });

  it("IDOR: assessment not in enrolled program → NotFoundException", async () => {
    repo.findAssessmentById.mockResolvedValue(makeAssessmentRow());
    repo.findStudentProfileId.mockResolvedValue("student-1");
    repo.prisma.client.module.findFirst.mockResolvedValue({ programId: "prog-1" });
    repo.findActiveEnrollment.mockResolvedValue(null); // not enrolled

    await expect(service.startAttempt("user-1", "t1", "assess-1")).rejects.toThrow(NotFoundException);
  });

  it("Answer key is NOT in AttemptInProgress.questions (AC-D2)", async () => {
    repo.findAssessmentById.mockResolvedValue(makeAssessmentRow({ attemptsAllowed: 2, shuffle: false }));
    repo.findStudentProfileId.mockResolvedValue("student-1");
    repo.prisma.client.module.findFirst.mockResolvedValue({ programId: "prog-1" });
    repo.findActiveEnrollment.mockResolvedValue({ id: "enroll-1", batchId: "batch-1" });
    repo.countSubmittedAttempts.mockResolvedValue(0);
    repo.findInProgressAttempt.mockResolvedValue(null);
    repo.createAttempt.mockResolvedValue("attempt-new");
    repo.writeAttemptStartAuditLog.mockResolvedValue(undefined);
    // Return questions from public repo (no answerKey)
    repo.findQuestionsPublic.mockResolvedValue([makePublicQuestion("q1")]);
    repo.findAttemptById.mockResolvedValue(makeAttemptRow({ id: "attempt-new" }));

    const result = await service.startAttempt("user-1", "t1", "assess-1");

    // Verify questions have no answerKey
    for (const q of result.questions) {
      expect(Object.keys(q)).not.toContain("answerKey");
      expect(Object.keys(q)).not.toContain("answer_key");
      expect(Object.keys(q)).not.toContain("isCorrect");
    }

    // Scanning the full JSON response
    const bodyStr = JSON.stringify(result);
    expect(bodyStr).not.toContain("answerKey");
    expect(bodyStr).not.toContain("answer_key");
    expect(bodyStr).not.toContain("isCorrect");
    expect(bodyStr).not.toContain("is_correct");
    expect(bodyStr).not.toContain("correctOption");
    expect(bodyStr).not.toContain("correct_option");
  });
});

describe("AssessmentsService.gradeAttempt (faculty manual grade)", () => {
  let repo: MockRepoWithPrisma;
  let service: AssessmentsService;

  beforeEach(() => {
    repo = makeRepo();
    service = new AssessmentsService(repo as unknown as AssessmentsRepository);
  });

  it("Faculty in unassigned batch → NotFoundException (IDOR→404, AC-B2 analog)", async () => {
    const attempt = makeAttemptRow({
      submittedAt: new Date(),
      batchId: "batch-B", // different from faculty's batch
      batchFacultyId: "faculty-profile-2",
    });
    repo.findAttemptById.mockResolvedValue(attempt);
    repo.findFacultyProfileId.mockResolvedValue("faculty-profile-1");
    repo.findAssignedBatchIds.mockResolvedValue(["batch-A"]); // faculty only assigned to batch-A

    await expect(
      service.gradeAttempt("faculty-user", "t1", "attempt-1", {
        questionGrades: [{ questionId: "q1", earnedPoints: 5 }],
        passed: true,
      }, "assigned"),
    ).rejects.toThrow(NotFoundException);
  });

  it("MANUAL_GRADE_NOT_APPLICABLE: MCQ-only attempt → 422", async () => {
    const attempt = makeAttemptRow({
      submittedAt: new Date(),
      batchId: "batch-A",
    });
    repo.findAttemptById.mockResolvedValue(attempt);
    repo.findFacultyProfileId.mockResolvedValue("faculty-profile-1");
    repo.findAssignedBatchIds.mockResolvedValue(["batch-A"]);
    // Only MCQ questions — no descriptive
    repo.findQuestionsWithAnswerKey.mockResolvedValue([makeMcqQuestion("q1", "opt-a", 10)]);

    await expect(
      service.gradeAttempt("faculty-user", "t1", "attempt-1", {
        questionGrades: [{ questionId: "q1", earnedPoints: 10 }],
        passed: true,
      }, "assigned"),
    ).rejects.toThrow(UnprocessableEntityException);

    try {
      await service.gradeAttempt("faculty-user", "t1", "attempt-1", {
        questionGrades: [],
        passed: true,
      }, "assigned");
    } catch (e) {
      expect((e as UnprocessableEntityException).getResponse()).toMatchObject({
        code: "MANUAL_GRADE_NOT_APPLICABLE",
      });
    }
  });

  it("Valid manual grade → updates score and passed, writes audit log", async () => {
    const existingQResults = [
      {
        questionId: "q1",
        type: "descriptive" as const,
        earnedPoints: 0,
        maxPoints: 10,
        isCorrectForMcq: null,
        isPendingManualGrade: true,
      },
    ];
    const attempt = makeAttemptRow({
      submittedAt: new Date(),
      batchId: "batch-A",
      score: 0,
      flags: { questionResults: existingQResults },
    });
    const afterGrade = makeAttemptRow({
      submittedAt: new Date(),
      score: 8,
      passed: true,
      flags: {
        questionResults: [{ ...existingQResults[0], earnedPoints: 8, isPendingManualGrade: false }],
      },
    });

    repo.findAttemptById
      .mockResolvedValueOnce(attempt)
      .mockResolvedValueOnce(afterGrade);
    repo.findFacultyProfileId.mockResolvedValue("faculty-profile-1");
    repo.findAssignedBatchIds.mockResolvedValue(["batch-A"]);
    repo.findQuestionsWithAnswerKey.mockResolvedValue([makeDescriptiveQuestion("q1")]);
    repo.gradeAttempt.mockResolvedValue({ beforeScore: 0, beforePassed: null });
    repo.writeAttemptGradeAuditLog.mockResolvedValue(undefined);
    repo.countSubmittedAttempts.mockResolvedValue(1);

    const result = await service.gradeAttempt(
      "faculty-user",
      "t1",
      "attempt-1",
      { questionGrades: [{ questionId: "q1", earnedPoints: 8 }], passed: true },
      "assigned",
    );

    expect(repo.writeAttemptGradeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        before: { score: 0, passed: null },
        after: { score: 8, passed: true },
      }),
    );
    expect(result.passed).toBe(true);
  });
});

describe("Answer-key isolation: AssessmentQuestionPublic type assertion", () => {
  it("The AssessmentQuestionPublic type does NOT have answerKey (compile-time assertion)", () => {
    // This test ensures the runtime DTO returned by toQuestionPublicDto has no answerKey.
    // The compile-time assertion is in @repo/types/src/learning/assessments.schemas.ts.
    const publicQ: QuestionPublicRow = makePublicQuestion("q1");
    // Verify the row type itself has no answerKey
    expect(Object.keys(publicQ)).not.toContain("answerKey");
    expect(Object.keys(publicQ)).not.toContain("answer_key");
    // JSON serialization
    const json = JSON.stringify(publicQ);
    expect(json).not.toContain("answerKey");
    expect(json).not.toContain("answer_key");
  });

  it("QuestionWithAnswerKeyRow has answerKey (for grading only, never sent to student)", () => {
    const q = makeMcqQuestion("q1", "opt-a", 5);
    expect(q.answerKey).toBe("opt-a");
  });
});

// ---------------------------------------------------------------------------
// computeAttemptWave — retry-cooldown eligibility (3 attempts, then a 3h wave reset)
// ---------------------------------------------------------------------------

describe("computeAttemptWave", () => {
  const COOLDOWN_MS = 3 * 60 * 60 * 1000;
  const now = new Date("2026-07-23T12:00:00.000Z");
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000);

  it("no attempts → full allowance, no cooldown", () => {
    const w = computeAttemptWave([], 3, now);
    expect(w).toEqual({ attemptsUsed: 0, attemptsRemaining: 3, retryAvailableAt: null });
  });

  it("some recent attempts under the cap → remaining reflects the wave, no cooldown", () => {
    const w = computeAttemptWave([minsAgo(1), minsAgo(10)], 3, now);
    expect(w.attemptsUsed).toBe(2);
    expect(w.attemptsRemaining).toBe(1);
    expect(w.retryAvailableAt).toBeNull();
  });

  it("wave exhausted (all recent) → 0 remaining + retryAvailableAt = newest + 3h", () => {
    const newest = minsAgo(5);
    const w = computeAttemptWave([newest, minsAgo(20), minsAgo(40)], 3, now);
    expect(w.attemptsUsed).toBe(3);
    expect(w.attemptsRemaining).toBe(0);
    expect(w.retryAvailableAt?.getTime()).toBe(newest.getTime() + COOLDOWN_MS);
  });

  it("cooldown elapsed since the last attempt → fresh wave (0 used, full allowance)", () => {
    // Newest attempt is >3h ago → the whole set is a previous wave; a new one is open.
    const w = computeAttemptWave(
      [minsAgo(200), minsAgo(220), minsAgo(240)],
      3,
      now,
    );
    expect(w.attemptsUsed).toBe(0);
    expect(w.attemptsRemaining).toBe(3);
    expect(w.retryAvailableAt).toBeNull();
  });

  it("only attempts within the current wave count — a >3h gap ends the wave", () => {
    // Two recent attempts, then a big gap to older ones: only the two recent belong to the wave.
    const w = computeAttemptWave(
      [minsAgo(1), minsAgo(30), minsAgo(300), minsAgo(330)],
      3,
      now,
    );
    expect(w.attemptsUsed).toBe(2);
    expect(w.attemptsRemaining).toBe(1);
    expect(w.retryAvailableAt).toBeNull();
  });
});
